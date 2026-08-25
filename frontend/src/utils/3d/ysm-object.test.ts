// ===== ysm-object.test.ts — buildYsmObject 成品的可见性/材质契约 =====
// 修复回归守卫：确保经 buildYsmObject（含不透明烘焙批 addMeshToBoneGroup）
// 产出的**所有** Mesh 都满足：
//   1) frustumCulled === false（关闭 Three.js 内置 mesh 级视锥，交给外层 Group 级）
//   2) 材质 side === THREE.DoubleSide（对齐 architecture.md 材质标准 / YSMViewer 双面）
// 防止脸部薄板 / 车部件"镜头转动消失"回归。
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildYsmObject, type YsmObjectHandle } from "./ysm-object.ts";
import type { Spec3D } from "./model3d.ts";

/** 构造含单 quad cube 的最小 Spec3D（无纹理 → opaque → 走烘焙批路径） */
function makeMinSpec(): Spec3D {
  return {
    models: [
      {
        id: "main",
        name: "main",
        bones: [{ id: "head", name: "head", localPosition: [0, 0, 0], localRotation: [0, 0, 0, 1] }],
        meshGroups: [
          {
            id: "head_0",
            boneId: "head",
            positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0],
            normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
            uvs: [0, 0, 1, 0, 0, 1, 1, 1],
            indices: [0, 2, 1, 2, 3, 1],
            texIdx: 0,
            localPosition: [0, 0, 0],
            localRotation: [0, 0, 0, 1],
          },
        ],
      },
    ],
  };
}

function collectMeshes(handle: YsmObjectHandle): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  handle.rootGroup.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
  });
  return out;
}

describe("buildYsmObject 成品见质性/材质契约", () => {
  it("所有 mesh（含不透明烘焙批）frustumCulled=false 且材质 DoubleSide", () => {
    const handle = buildYsmObject(makeMinSpec(), [], new Map(), 0);
    const meshes = collectMeshes(handle);
    expect(meshes.length).toBeGreaterThan(0);
    for (const m of meshes) {
      expect(m.frustumCulled).toBe(false);
      expect((m.material as THREE.MeshBasicMaterial).side).toBe(THREE.DoubleSide);
    }
  });
});