// ===== 3D 单个网格构建（从 model3d.ts 拆出，ADR-040 P1 第6轮）=====
// 负责将 SpecMeshGroup3D 数据构建为 THREE.Mesh 并添加到目标组。
import * as THREE from "three";
import type { SpecMeshGroup3D } from "./model3d.ts";
import { applyRotationIfNonIdentity } from "./quaternion.ts";
import { getTextureAlphaMode } from "./texture-alpha.ts";

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
 */
export function addMeshToBoneGroup(
  bg: THREE.Group,
  md: SpecMeshGroup3D,
  compTexArr: (THREE.Texture | null)[],
  texIdx: number,
  multiModel: boolean,
  texArr: (THREE.Texture | null)[] = [],
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

  // Invalid slots fall back to the first valid texture. Keep the warning for diagnostics,
  // but do not turn a recoverable mapping problem into a magenta production render.
  let mt: THREE.Texture | null = null;
  if (arr.length > 0) {
    if (mti >= 0 && mti < arr.length && arr[mti]) {
      mt = arr[mti];
    } else {
      const fallbackIndex = arr.findIndex((texture) => texture !== null);
      if (fallbackIndex >= 0) mt = arr[fallbackIndex];
      console.warn(
        `[model3d] texIdx=${mti} 越界或缺图（arr长=${arr.length}），` +
          `组件 boneId=${md.boneId ?? "?"} 回退纹理槽 ${fallbackIndex}`,
        { multiModel, mdTexIdx: md.texIdx, callerTexIdx: texIdx, fallbackIndex },
      );
    }
  }

  // ysmview 风格材质：FrontSide + transparent + alphaTest 0.1 + depthWrite（配置收敛于 MATERIAL_OPTS）
  const alphaMode = mt ? getTextureAlphaMode(mt) : "opaque";
  const mat = mt
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
