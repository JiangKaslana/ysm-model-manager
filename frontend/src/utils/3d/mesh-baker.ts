import * as THREE from "three";
import type { SpecMeshGroup3D } from "./model3d.ts";

const _position = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _rotation = new THREE.Quaternion();

/** Bake cube-local transforms once, then batch by animated bone and texture. */
export function bakeMeshGroups(meshGroups: readonly SpecMeshGroup3D[]): SpecMeshGroup3D[] {
  const batches = new Map<string, SpecMeshGroup3D[]>();
  for (const mesh of meshGroups) {
    const key = `${mesh.boneId}:${mesh.texIdx ?? 0}`;
    const batch = batches.get(key);
    if (batch) batch.push(mesh);
    else batches.set(key, [mesh]);
  }
  return Array.from(batches.values(), bakeBatch);
}

function bakeBatch(batch: SpecMeshGroup3D[]): SpecMeshGroup3D {
  const first = batch[0];
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let vertexOffset = 0;

  for (const mesh of batch) {
    const rotation = mesh.localRotation;
    _rotation.set(
      rotation?.[0] ?? 0,
      rotation?.[1] ?? 0,
      rotation?.[2] ?? 0,
      rotation?.[3] ?? 1,
    );
    const tx = mesh.localPosition?.[0] ?? 0;
    const ty = mesh.localPosition?.[1] ?? 0;
    const tz = mesh.localPosition?.[2] ?? 0;

    for (let i = 0; i < mesh.positions.length; i += 3) {
      _position
        .set(mesh.positions[i] ?? 0, mesh.positions[i + 1] ?? 0, mesh.positions[i + 2] ?? 0)
        .applyQuaternion(_rotation);
      positions.push(_position.x + tx, _position.y + ty, _position.z + tz);
    }
    for (let i = 0; i < mesh.normals.length; i += 3) {
      _normal
        .set(mesh.normals[i] ?? 0, mesh.normals[i + 1] ?? 0, mesh.normals[i + 2] ?? 0)
        .applyQuaternion(_rotation);
      normals.push(_normal.x, _normal.y, _normal.z);
    }
    uvs.push(...mesh.uvs);
    for (const index of mesh.indices) indices.push(index + vertexOffset);
    vertexOffset += mesh.positions.length / 3;
  }

  return {
    id: `${first.boneId}_baked_${first.texIdx ?? 0}`,
    boneId: first.boneId,
    texIdx: first.texIdx,
    localPosition: [0, 0, 0],
    localRotation: [0, 0, 0, 1],
    positions,
    normals,
    uvs,
    indices,
  };
}
