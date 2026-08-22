import { describe, expect, it } from "vitest";
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

describe("buildYsmObject mesh baking", () => {
  it("bakes rotated cubes on the same bone and texture into one draw object", () => {
    const halfTurnZ = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      Math.PI,
    );
    const spec: Spec3D = {
      models: [{
        id: "main",
        bones: [{
          id: "root",
          name: "root",
          localPosition: [0, 0, 0],
          localRotation: [0, 0, 0, 1],
        }],
        meshGroups: [
          triangle("plain", [0, 0, 0], [0, 0, 0, 1]),
          triangle("rotated", [2, 0, 0], halfTurnZ.toArray()),
        ],
      }],
    };

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
});
