import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { addMeshToBoneGroup } from "./mesh-builder.ts";
import type { SpecMeshGroup3D } from "./model3d.ts";

const meshData: SpecMeshGroup3D = {
  boneId: "root",
  positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
  normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
  uvs: [0, 0, 1, 0, 0, 1],
  indices: [0, 1, 2],
  localPosition: [0, 0, 0],
  localRotation: [0, 0, 0, 1],
};

function rgbaTexture(alpha: number): THREE.DataTexture {
  const texture = new THREE.DataTexture(
    new Uint8Array([255, 255, 255, alpha]),
    1,
    1,
    THREE.RGBAFormat,
  );
  texture.needsUpdate = true;
  return texture;
}

describe("YSM material alpha partition", () => {
  it("keeps an opaque texture out of Three.js transparent sorting", () => {
    const bone = new THREE.Group();
    addMeshToBoneGroup(bone, meshData, [rgbaTexture(255)], 0, false);

    const material = (bone.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
    const geometry = (bone.children[0] as THREE.Mesh).geometry;
    expect(material.transparent).toBe(false);
    expect(material.depthWrite).toBe(true);
    expect(geometry.boundingBox).not.toBeNull();
    expect(geometry.boundingSphere).not.toBeNull();
  });

  it("keeps genuine partial alpha in the transparent render path", () => {
    const bone = new THREE.Group();
    addMeshToBoneGroup(bone, meshData, [rgbaTexture(128)], 0, false);

    const material = (bone.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
  });

  it("renders binary alpha as an opaque cutout without transparent sorting", () => {
    const texture = new THREE.DataTexture(
      new Uint8Array([255, 255, 255, 255, 255, 255, 255, 0]),
      2,
      1,
      THREE.RGBAFormat,
    );
    const bone = new THREE.Group();
    addMeshToBoneGroup(bone, meshData, [texture], 0, false);

    const material = (bone.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
    expect(material.transparent).toBe(false);
    expect(material.alphaTest).toBe(0.1);
    expect(material.depthWrite).toBe(true);
  });

  it("falls back to the first valid texture instead of rendering magenta", () => {
    const fallback = rgbaTexture(255);
    const bone = new THREE.Group();
    addMeshToBoneGroup(
      bone,
      { ...meshData, texIdx: 2 },
      [fallback, null],
      0,
      true,
    );

    const material = (bone.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
    expect(material.map).toBe(fallback);
    expect(material.color.getHex()).toBe(0xffffff);
  });

  it("uses the per-component local slot 0 instead of the global md.texIdx (code review P3)", () => {
    const comp = rgbaTexture(255);
    const bone = new THREE.Group();
    const warnings: unknown[][] = [];
    const spy = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      warnings.push(args);
    });
    try {
      // compTexArr 非空（组件自己的纹理，长度 1）+ md.texIdx=6（全局槽位越界）：
      // 修复前混用索引空间 → 越界品红误报 + fallback 数组扫描；修复后局部索引 0 直接命中
      addMeshToBoneGroup(bone, { ...meshData, texIdx: 6 }, [comp], 0, true);
    } finally {
      spy.mockRestore();
    }
    const material = (bone.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
    expect(material.map).toBe(comp);
    expect(warnings).toHaveLength(0); // per-component 正常路径不误报 warning
  });
});
