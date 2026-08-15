// ===== 3D 单个网格构建（从 model3d.ts 拆出，ADR-040 P1 第6轮）=====
// 负责将 SpecMeshGroup3D 数据构建为 THREE.Mesh 并添加到目标组。
import * as THREE from "three";
import type { SpecMeshGroup3D, SpecModelGroup3D } from "./model3d.ts";
import { applyRotationIfNonIdentity } from "./quaternion.ts";

/** ysmview 风格材质配置（索引 2.16 魔法数值收敛） */
const MATERIAL_OPTS = {
  side: THREE.FrontSide,
  transparent: true,
  alphaTest: 0.1,
  depthWrite: true,
} as const;
/** 纹理缺失/越界时的品红错误色（可见化兜底） */
const ERROR_COLOR_MAGENTA = 0xff00ff;
/** 无纹理时的占位灰 */
const FALLBACK_COLOR_GRAY = 0xcccccc;

/**
 * 从 spec mesh group 数据构建 THREE.Mesh 并添加到 boneGroup。
 * @param bg 骨骼组（添加目标）
 * @param md 单个 mesh group 数据
 * @param texArr 纹理数组
 * @param texIdx 调用方指定的纹理索引（单组件模式）
 * @param multiModel 是否多组件模式
 */
export function addMeshToBoneGroup(
  bg: THREE.Group,
  md: SpecMeshGroup3D,
  texArr: (THREE.Texture | null)[],
  texIdx: number,
  multiModel: boolean,
): void {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(md.positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(md.normals, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(md.uvs, 2));
  geo.setIndex(md.indices);

  // 纹理索引：多组件用 md.texIdx（Go 端全局槽位），单组件用调用方 texIdx
  const mti = multiModel ? (md.texIdx ?? 0) : (texIdx ?? 0);

  // 错误可见化：texIdx 越界/缺图时不再静默顶替 texArr[0]
  let mt: THREE.Texture | null = null;
  let texIdxMismatch = false;
  if (texArr.length > 0) {
    if (mti >= 0 && mti < texArr.length && texArr[mti]) {
      mt = texArr[mti];
    } else {
      texIdxMismatch = true;
      console.warn(
        `[model3d] texIdx=${mti} 越界或缺图（texArr 长=${texArr.length}），` +
          `组件 boneId=${md.boneId ?? "?"} 无法定位纹理，改用品红错误材质`,
        { multiModel, mdTexIdx: md.texIdx, callerTexIdx: texIdx },
      );
    }
  }

  // ysmview 风格材质：FrontSide + transparent + alphaTest 0.1 + depthWrite（配置收敛于 MATERIAL_OPTS）
  const mat = mt
    ? new THREE.MeshBasicMaterial({
        map: mt,
        ...MATERIAL_OPTS,
      })
    : new THREE.MeshBasicMaterial({
        color: texIdxMismatch ? ERROR_COLOR_MAGENTA : FALLBACK_COLOR_GRAY,
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
