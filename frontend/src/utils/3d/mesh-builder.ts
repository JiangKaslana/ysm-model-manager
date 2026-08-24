// ===== 3D 单个网格构建（从 model3d.ts 拆出，ADR-040 P1 第6轮）=====
// 负责将 SpecMeshGroup3D 数据构建为 THREE.Mesh 并添加到目标组。
import * as THREE from "three";
import type { SpecMeshGroup3D } from "./model3d.ts";
import { applyRotationIfNonIdentity } from "./quaternion.ts";
import { getTextureAlphaMode } from "./texture-alpha.ts";
import type { TextureAlphaMode } from "./texture-alpha.ts";

/** ysmview 风格材质配置（索引 2.16 魔法数值收敛） */
const MATERIAL_OPTS = {
  side: THREE.FrontSide,
} as const;
/** 无纹理时的占位灰 */
const FALLBACK_COLOR_GRAY = 0xcccccc;

/**
 * 从 spec mesh group 数据构建 THREE.Mesh 并添加到 boneGroup。
 * ADR-114 perComponent：compTexArr 是当前组件自己的纹理数组（通常 1 张），
 * 不再用全局 texArr[texIdx] 查——根治 texOrder 顺序变动导致的错位。
 * @param bg 骨骼组（添加目标）
 * @param md 单个 mesh group 数据
 * @param compTexArr 当前组件的纹理数组（perComponent）
 * @param texIdx 调用方纹理索引（单组件场景）
 * @param multiModel 是否多组件场景
 * @param texArr 全局纹理数组（perComponent 缺省时回退用）
 * @param modeOverride 面级拆分产出的碎片模式（ADR-118 Phase B），缺省按整纹理判定
 */
export function addMeshToBoneGroup(
  bg: THREE.Group,
  md: SpecMeshGroup3D,
  compTexArr: (THREE.Texture | null)[],
  texIdx: number,
  multiModel: boolean,
  texArr: (THREE.Texture | null)[] = [],
  modeOverride?: TextureAlphaMode,
  glow: boolean = false,
): void {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(md.positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(md.normals, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(md.uvs, 2));
  geo.setIndex(md.indices);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();

  // ADR-114 perComponent：优先组件级纹理，缺则回退全局 texArr
  const arr = compTexArr.length > 0 ? compTexArr : texArr;
  // 索引空间（code review P3）：per-component 数组是组件自己的纹理（局部 0 基，
  // ADR-114 cube.TexSlot=0 → compTexArr[0]）；只有回退到全局 texArr 时才用
  // md.texIdx（Go 端全局槽位）/调用方 texIdx——混用两个索引空间会越界误报
  // 品红 warning（如 arrow texSlot=6 对 compTexArr 长度 1），多纹理组件还可能绑错
  const mti = arr === compTexArr ? 0 : multiModel ? (md.texIdx ?? 0) : (texIdx ?? 0);

  // 纹理槽位缺失时**不再静默兜底贴错图**（坏文明根除）：旧行为「找第一张可用」
  // 会把别的组件皮肤贴上还装没事（wine_fox 多组件渲染错乱的帮凶）；灰色占位 +
  // 明确报错至少诚实暴露映射断裂，便于定位数据源问题。
  let mt: THREE.Texture | null = null;
  if (arr.length > 0) {
    if (mti >= 0 && mti < arr.length && arr[mti]) {
      mt = arr[mti];
    } else {
      console.error(
        `[model3d] 纹理槽位缺失: 组件 ${md.boneId} 期望索引 ${mti}` +
          `（可用纹理 ${arr.filter(Boolean).length}/${arr.length}），以灰色占位渲染`,
        { multiModel, mdTexIdx: md.texIdx, callerTexIdx: texIdx },
      );
    }
  }

  // ysmview 风格材质：FrontSide + transparent + alphaTest 0.1 + depthWrite（配置收敛于 MATERIAL_OPTS）
  // ADR-118 Phase B：modeOverride 来自面级拆分（碎片级模式），优先于整纹理判定
  const alphaMode = modeOverride ?? (mt ? getTextureAlphaMode(mt) : "opaque");
  // 发光骨骼（名前缀 "ysmGlow"，对齐上游 GeoBone.glow + NativeModelRenderer:152
  // LightTexture.pack(15,15)）：改用 MeshStandardMaterial 设 emissive，
  // 模拟上游全亮渲染；非 glow 保持 MeshBasicMaterial 不变（无光照开销）。
  const mat = glow
    ? new THREE.MeshStandardMaterial({
        map: mt ?? undefined,
        color: mt ? 0xffffff : FALLBACK_COLOR_GRAY,
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: 1.0,
        emissiveMap: mt ?? undefined,
        ...MATERIAL_OPTS,
        transparent: alphaMode === "blend",
        alphaTest: alphaMode === "cutout" ? 0.1 : 0,
        depthWrite: alphaMode !== "blend",
      })
    : mt
      ? new THREE.MeshBasicMaterial({
          map: mt,
          ...MATERIAL_OPTS,
          transparent: alphaMode === "blend",
          alphaTest: alphaMode === "cutout" ? 0.1 : 0,
          depthWrite: alphaMode !== "blend",
        })
      : new THREE.MeshBasicMaterial({
          color: FALLBACK_COLOR_GRAY,
          side: THREE.FrontSide,
        });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(
    md.localPosition?.[0] ?? 0,
    md.localPosition?.[1] ?? 0,
    md.localPosition?.[2] ?? 0,
  );
  applyRotationIfNonIdentity(mesh, md.localRotation);
  bg.add(mesh);
}
