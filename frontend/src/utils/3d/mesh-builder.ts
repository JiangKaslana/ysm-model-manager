// ===== 3D 单个网格构建（从 model3d.ts 拆出，ADR-040 P1 第6轮）=====
// 负责将 SpecMeshGroup3D 数据构建为 THREE.Mesh 并添加到目标组。
import * as THREE from "three";
import type { SpecMeshGroup3D, SpecModelGroup3D } from "./model3d.ts";

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

  // ysmview 风格材质：FrontSide + transparent + alphaTest 0.1 + depthWrite
  const mat = mt
    ? new THREE.MeshBasicMaterial({
        map: mt,
        side: THREE.FrontSide,
        transparent: true,
        alphaTest: 0.1,
        depthWrite: true,
      })
    : new THREE.MeshBasicMaterial({
        color: texIdxMismatch ? 0xff00ff : 0xcccccc,
        side: THREE.FrontSide,
      });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(
    md.localPosition?.[0] ?? 0,
    md.localPosition?.[1] ?? 0,
    md.localPosition?.[2] ?? 0,
  );
  if (
    md.localRotation?.[3] !== 1 ||
    md.localRotation?.[0] !== 0 ||
    md.localRotation?.[1] !== 0 ||
    md.localRotation?.[2] !== 0
  ) {
    mesh.quaternion.set(
      md.localRotation?.[0] ?? 0,
      md.localRotation?.[1] ?? 0,
      md.localRotation?.[2] ?? 0,
      md.localRotation?.[3] ?? 1,
    );
  }
  bg.add(mesh);
}
