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

  it("classifies per-component textures by their own slot space (texIdx ≠ 0)", () => {
    // 组件纹理数组槽位 1 是 blend：分类必须用组件局部空间的 mesh.texIdx，
    // 而非组件槽位 0 或全局数组（任一错位都会把 blend 组件误判 opaque 烘掉）
    const near = { ...triangle("near", [0, 0, 0], [0, 0, 0, 1]), texIdx: 1 };
    const far = { ...triangle("far", [0, 0, 2], [0, 0, 0, 1]), texIdx: 1 };
    const spec = specWithMeshes([near, far]);
    const componentTextures = new Map([
      ["main", [rgbaTexture(255), rgbaTexture(128)]],
    ]);

    const handle = buildYsmObject(spec, [rgbaTexture(255)], componentTextures, 0);
    const bone = handle.boneGroupMap.get("0:root")!;
    const meshes = bone.children.filter((child) => child instanceof THREE.Mesh);

    expect(meshes).toHaveLength(2);
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
});

function rgbaTexture(alpha: number): THREE.DataTexture {
  return new THREE.DataTexture(
    new Uint8Array([255, 255, 255, alpha]),
    1,
    1,
    THREE.RGBAFormat,
  );
}
