import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { buildYsmObject } from "./ysm-object.ts";
import type { Spec3D, SpecMeshGroup3D } from "./model3d.ts";

function triangle(
  id: string,
  localPosition: number[],
  localRotation: number[],
): SpecMeshGroup3D {
  return {
    id,
    boneId: "root",
    texIdx: 0,
    localPosition,
    localRotation,
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
    uvs: [0, 0, 1, 0, 0, 1],
    indices: [0, 1, 2],
  };
}

function specWithMeshes(meshGroups: SpecMeshGroup3D[]): Spec3D {
  return {
    models: [{
      id: "main",
      bones: [{
        id: "root",
        name: "root",
        localPosition: [0, 0, 0],
        localRotation: [0, 0, 0, 1],
      }],
      meshGroups,
    }],
  };
}

/** 双组件 spec（multiModel 分支用例用；第二组件无网格，验证全局 texArr 槽位回退） */
function specWithTwoModels(
  meshGroups0: SpecMeshGroup3D[],
  meshGroups1: SpecMeshGroup3D[],
): Spec3D {
  return {
    models: [
      { ...specWithMeshes(meshGroups0).models![0] },
      { ...specWithMeshes(meshGroups1).models![0], id: "arrow", name: "arrow" },
    ],
  };
}

describe("buildYsmObject mesh baking", () => {
  it("bakes rotated cubes on the same bone and texture into one draw object", () => {
    const halfTurnZ = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      Math.PI,
    );
    const spec = specWithMeshes([
      triangle("plain", [0, 0, 0], [0, 0, 0, 1]),
      triangle("rotated", [2, 0, 0], halfTurnZ.toArray()),
    ]);

    const handle = buildYsmObject(spec, [], 0);
    const bone = handle.boneGroupMap.get("0:root")!;
    const meshes = bone.children.filter((child) => child instanceof THREE.Mesh);

    expect(meshes).toHaveLength(1);
    const positions = (meshes[0] as THREE.Mesh).geometry.getAttribute("position");
    expect(positions.count).toBe(6);
    expect(positions.getX(4)).toBeCloseTo(1);
    expect(positions.getY(4)).toBeCloseTo(0);
    expect(positions.getZ(4)).toBeCloseTo(0);
    expect(spec.models?.[0]?.meshGroups).toHaveLength(2);
  });

  it("does not dispose textures owned by the shared texture cache", () => {
    const texture = rgbaTexture(255);
    const disposeSpy = vi.spyOn(texture, "dispose");
    const spec = specWithMeshes([
      triangle("plain", [0, 0, 0], [0, 0, 0, 1]),
    ]);
    const scene = new THREE.Scene();
    const handle = buildYsmObject(spec, [texture], 0);
    scene.add(handle.rootGroup);

    handle.removeFromScene(scene);

    expect(disposeSpy).not.toHaveBeenCalled();
  });

  it("keeps partial-alpha cubes separate for transparent depth sorting", () => {
    const spec = specWithMeshes([
      triangle("near", [0, 0, 0], [0, 0, 0, 1]),
      triangle("far", [0, 0, 2], [0, 0, 0, 1]),
    ]);

    const handle = buildYsmObject(spec, [rgbaTexture(128)], 0);
    const bone = handle.boneGroupMap.get("0:root")!;
    const meshes = bone.children.filter((child) => child instanceof THREE.Mesh);

    expect(meshes).toHaveLength(2);
    expect(meshes.map((mesh) => mesh.position.z)).toEqual([0, 2]);
  });

  it("uses the component texture when deciding transparent mesh batching", () => {
    const spec = specWithMeshes([
      triangle("near", [0, 0, 0], [0, 0, 0, 1]),
      triangle("far", [0, 0, 2], [0, 0, 0, 1]),
    ]);
    const componentTextures = new Map([
      ["main", [rgbaTexture(128)]],
    ]);

    const handle = buildYsmObject(spec, [rgbaTexture(255)], componentTextures, 0);
    const bone = handle.boneGroupMap.get("0:root")!;
    const meshes = bone.children.filter((child) => child instanceof THREE.Mesh);

    expect(meshes).toHaveLength(2);
    expect(meshes.map((mesh) => mesh.position.z)).toEqual([0, 2]);
  });

  it("classifies per-component textures by local slot 0, ignoring the global texIdx", () => {
    // 组件纹理绑定端（mesh-builder）对组件数组恒用局部槽 0（arr === compTexArr ? 0）；
    // 分类必须同用槽 0——mesh.texIdx 是全局槽位（WASM 路径 = 组件文件序 i），对组件
    // 数组（通常长 1）越界 → 误判 null → blend 组件被烘进不透明批次。
    // 槽 0 = opaque、槽 1 = blend，texIdx=1：分类按槽 0 → batchable → 烘焙成 1 个 mesh
    const near = { ...triangle("near", [0, 0, 0], [0, 0, 0, 1]), texIdx: 1 };
    const far = { ...triangle("far", [0, 0, 2], [0, 0, 0, 1]), texIdx: 1 };
    const spec = specWithMeshes([near, far]);
    const componentTextures = new Map([
      ["main", [rgbaTexture(255), rgbaTexture(128)]],
    ]);

    const handle = buildYsmObject(spec, [rgbaTexture(255)], componentTextures, 0);
    const bone = handle.boneGroupMap.get("0:root")!;
    const meshes = bone.children.filter((child) => child instanceof THREE.Mesh);

    expect(meshes).toHaveLength(1);
  });

  it("keeps per-component blend at local slot 0 translucent even with a non-zero global texIdx", () => {
    // 槽 0 = blend：即使 mesh.texIdx≠0，分类仍按局部槽 0 判 translucent（与绑定一致），
    // 不得因 texIdx 越界误判 opaque 而把透明组件烘焙掉
    const near = { ...triangle("near", [0, 0, 0], [0, 0, 0, 1]), texIdx: 1 };
    const far = { ...triangle("far", [0, 0, 2], [0, 0, 0, 1]), texIdx: 1 };
    const spec = specWithMeshes([near, far]);
    const componentTextures = new Map([
      ["main", [rgbaTexture(128)]],
    ]);

    const handle = buildYsmObject(spec, [rgbaTexture(255)], componentTextures, 0);
    const bone = handle.boneGroupMap.get("0:root")!;
    const meshes = bone.children.filter((child) => child instanceof THREE.Mesh);

    expect(meshes).toHaveLength(2);
  });

  it("non-component multi-model meshes bind the global texture slot (md.texIdx), not slot 0", () => {
    // 无组件纹理（componentTexMap 缺省）→ 非组件多组件：分类/绑定都用全局 texArr[mesh.texIdx]。
    // 回归：修复前 compTexArr = texArr（引用相等）被 mesh-builder 误判为组件数组 → 恒绑槽 0；
    // 修复后显式传 [] → 回退全局 → 绑定 texArr[1]（blend）→ 材质 map 应为 texArr[1]
    const near = { ...triangle("near", [0, 0, 0], [0, 0, 0, 1]), texIdx: 1 };
    const spec = specWithTwoModels([near], []);
    const texArr = [rgbaTexture(255), rgbaTexture(128)]; // 槽 1 = blend
    const handle = buildYsmObject(spec, texArr, 0);
    const bone = handle.boneGroupMap.get("0:root")!;
    const meshes = bone.children.filter((child) => child instanceof THREE.Mesh);

    expect(meshes).toHaveLength(1); // texArr[1] = blend → translucent → 不烘焙
    const material = (meshes[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
    expect(material.map).toBe(texArr[1]); // 绑定全局槽 1，而非槽 0
    expect(material.transparent).toBe(true);
  });

  it("sets material render flags from the resolved alpha mode", () => {
    const buildMaterial = (alpha: number): THREE.MeshBasicMaterial => {
      const spec = specWithMeshes([triangle("m", [0, 0, 0], [0, 0, 0, 1])]);
      const handle = buildYsmObject(spec, [rgbaTexture(alpha)], 0);
      const bone = handle.boneGroupMap.get("0:root")!;
      const mesh = bone.children.find((child) => child instanceof THREE.Mesh) as THREE.Mesh;
      return mesh.material as THREE.MeshBasicMaterial;
    };

    const opaque = buildMaterial(255);
    expect(opaque.transparent).toBe(false);
    expect(opaque.alphaTest).toBe(0);
    expect(opaque.depthWrite).toBe(true);

    const blend = buildMaterial(128);
    expect(blend.transparent).toBe(true);
    expect(blend.alphaTest).toBe(0);
    expect(blend.depthWrite).toBe(false);

    const cutout = buildMaterial(0);
    expect(cutout.transparent).toBe(false);
    expect(cutout.alphaTest).toBeCloseTo(0.1);
    expect(cutout.depthWrite).toBe(true);
  });

  it("routes faces of one mixed-alpha texture into cutout batch and separate blend mesh (ADR-118 Phase B)", () => {
    // 4×2 纹理：左半 alpha=0（hole→cutout 面），右半 alpha=128（translucent→blend 面）
    const data = new Uint8Array(4 * 2 * 4);
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 4; x++) {
        const o = (y * 4 + x) * 4;
        data[o] = 255;
        data[o + 1] = 255;
        data[o + 2] = 255;
        data[o + 3] = x < 2 ? 0 : 128;
      }
    }
    const mixed = new THREE.DataTexture(data, 4, 2, THREE.RGBAFormat);
    mixed.needsUpdate = true;

    const triAt = (u: number): SpecMeshGroup3D => ({
      id: `tri_${u}`,
      boneId: "root",
      texIdx: 0,
      localPosition: [0, 0, 0],
      localRotation: [0, 0, 0, 1],
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
      uvs: [u, 0, u + 0.25, 0, u, 1],
      indices: [0, 1, 2],
    });
    const spec = specWithMeshes([triAt(0), triAt(0.5)]);

    const handle = buildYsmObject(spec, [mixed], 0);
    const bone = handle.boneGroupMap.get("0:root")!;
    const meshes = bone.children.filter((child) => child instanceof THREE.Mesh) as THREE.Mesh[];

    expect(meshes).toHaveLength(2);
    const materials = meshes.map((mesh) => mesh.material as THREE.MeshBasicMaterial);
    const cutoutMesh = meshes.findIndex((_, i) => materials[i]!.alphaTest > 0);
    const blendMesh = meshes.findIndex((_, i) => materials[i]!.transparent);

    expect(cutoutMesh).toBeGreaterThanOrEqual(0);
    expect(blendMesh).toBeGreaterThanOrEqual(0);
    expect(meshes[cutoutMesh!]!.geometry.getAttribute("position").count).toBe(3);
    expect(materials[cutoutMesh!]!.transparent).toBe(false);
    expect(materials[cutoutMesh!]!.depthWrite).toBe(true);
    expect(meshes[blendMesh!]!.geometry.getAttribute("position").count).toBe(3);
    expect(materials[blendMesh!]!.depthWrite).toBe(false);
  });
});

function rgbaTexture(alpha: number): THREE.DataTexture {
  return new THREE.DataTexture(
    new Uint8Array([255, 255, 255, alpha]),
    1,
    1,
    THREE.RGBAFormat,
  );
}
