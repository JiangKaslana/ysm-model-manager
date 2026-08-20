// ===== buildPmxScene / buildPmxSceneSliced 根骨骼挂载测试 =====
// 回归锁（review P3）：PMX 常有多个根骨骼（parentBoneIndex < 0，如「操作中心」+
// 「全ての親」），漏挂的根及整棵子树成为孤儿 → matrixWorld 不更新 →
// calculateInverses() 用 identity 算逆矩阵 → 蒙皮把顶点拉到骨骼世界位置
//（「空气角色」/几何放大 N 倍）。本测试锁死 attachRootBones：所有根骨骼
// 都挂到 mesh，且蒙皮矩阵恢复 identity。
// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  buildPmxScene,
  buildPmxSceneSliced,
} from "./mmd-pmx-parser.ts";
import type { PmxParseResponse } from "./mmd-pmx-parser.worker.ts";

/** 合成 PMX 解析结果：2 个根骨骼（parent=-1）+ 1 个子骨骼 + 最小顶点/面 */
function syntheticPmx(): PmxParseResponse {
  return {
    id: 0,
    ok: true,
    vertices: {
      count: 3,
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
      boneIndices: new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      boneWeights: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]),
    },
    faces: {
      count: 3,
      indices: new Uint32Array([0, 1, 2]),
    },
    textures: [],
    materials: [],
    bones: [
      { name: "rootA", englishName: "", parentBoneIndex: -1, position: [0, 0, 0], rotation: [0, 0, 0, 1], flag: 0, hasIK: false },
      { name: "rootB", englishName: "", parentBoneIndex: -1, position: [0, 10, 0], rotation: [0, 0, 0, 1], flag: 0, hasIK: false },
      { name: "child", englishName: "", parentBoneIndex: 1, position: [0, 5, 0], rotation: [0, 0, 0, 1], flag: 0, hasIK: false },
    ],
    rigidBodies: [],
    joints: [],
    morphs: [],
    displayFrames: [],
  };
}

/** 断言：所有根骨骼都挂到 mesh.children，且全部骨骼蒙皮矩阵恢复 identity */
function assertRootsAttached(mesh: THREE.SkinnedMesh, pmx: PmxParseResponse): void {
  // 所有根骨骼（parent < 0）都在 mesh.children
  const rootNames = pmx.bones!.filter((b) => b.parentBoneIndex < 0).map((b) => b.name);
  const childNames = mesh.children.map((c) => (c as THREE.Bone).name);
  for (const name of rootNames) {
    expect(childNames).toContain(name);
  }
  // 全部骨骼 updateMatrixWorld 后，matrixWorld × boneInverse 应为 identity（蒙皮正确）
  mesh.updateMatrixWorld(true);
  mesh.skeleton.update();
  for (let i = 0; i < mesh.skeleton.bones.length; i++) {
    const mw = mesh.skeleton.bones[i].matrixWorld;
    const inv = mesh.skeleton.boneInverses[i];
    const prod = mw.clone().multiply(inv);
    const e = prod.elements;
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const expected = r === c ? 1 : 0;
        expect(Math.abs(e[c * 4 + r] - expected)).toBeLessThan(1e-3);
      }
    }
  }
}

describe("buildPmxScene — 多根骨骼挂载", () => {
  it("两个根骨骼都挂到 mesh（漏挂 → 蒙皮拉飞「空气角色」回归）", () => {
    const pmx = syntheticPmx();
    const built = buildPmxScene(pmx, { texUrlMap: new Map() });
    expect(built).not.toBeNull();
    assertRootsAttached(built!.mesh, pmx);
  });

  it("单根骨骼：attachRootBones 不误挂多余子骨骼", () => {
    const pmx = syntheticPmx();
    // 只有一个根：把 rootB 改成 rootA 的子骨骼
    pmx.bones![1].parentBoneIndex = 0;
    const built = buildPmxScene(pmx, { texUrlMap: new Map() });
    expect(built).not.toBeNull();
    const mesh = built!.mesh;
    expect(mesh.children.map((c) => (c as THREE.Bone).name)).toEqual(["rootA"]);
  });
});

describe("buildPmxSceneSliced — 多根骨骼挂载（切片版同锁）", () => {
  it("两个根骨骼都挂到 mesh，蒙皮矩阵 identity", async () => {
    const pmx = syntheticPmx();
    const built = await buildPmxSceneSliced(pmx, { texUrlMap: new Map() });
    expect(built).not.toBeNull();
    assertRootsAttached(built!.mesh, pmx);
  });
});
