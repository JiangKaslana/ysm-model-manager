// ===== IK 求解器测试 =====

import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { solveIK } from "./ik-solver.ts";
import type { IKChain, IKResult } from "./ik-solver.ts";

/** 构建测试骨骼链：root → joint1 → joint2 → endEffector，均为独立 Object3D */
function makeChain(): { root: THREE.Object3D; joints: THREE.Object3D[]; end: THREE.Object3D; chain: IKChain } {
  const root = new THREE.Object3D();
  const j1 = new THREE.Object3D();
  const j2 = new THREE.Object3D();
  const end = new THREE.Object3D();

  // 线性排列：root(0,0,0) → j1(1,0,0) → j2(2,0,0) → end(3,0,0)
  root.position.set(0, 0, 0);
  j1.position.set(1, 0, 0);
  j2.position.set(1, 0, 0);
  end.position.set(1, 0, 0);

  root.add(j1);
  j1.add(j2);
  j2.add(end);

  return { root, joints: [j1, j2], end, chain: [root, j1, j2, end] };
}

describe("solveIK", () => {
  it("末端已在目标位置 → 零迭代收敛", () => {
    const { chain, end } = makeChain();
    end.updateMatrixWorld(true);
    const target = new THREE.Vector3();
    end.getWorldPosition(target);

    const result = solveIK(chain, target, { iterations: 1, tolerance: 0.001 });
    expect(result.achieved).toBe(true);
    expect(result.distance).toBeLessThan(0.001);
    expect(result.iterations).toBe(1);
  });

  it("简单弯曲：目标在末端上方 → 关节旋转使末端逼近", () => {
    const { chain, end } = makeChain();
    end.updateMatrixWorld(true);

    // 目标：末端正上方 0.5 单位
    const target = new THREE.Vector3(3, 0.5, 0);
    const result = solveIK(chain, target, { iterations: 8, tolerance: 0.01 });

    end.updateMatrixWorld(true);
    const finalPos = new THREE.Vector3();
    end.getWorldPosition(finalPos);
    expect(finalPos.distanceTo(target)).toBeLessThan(0.15); // 允许一定误差（CCD 非精确）
    expect(result.iterations).toBeGreaterThan(0);
  });

  it("目标超出链可达范围 → achieved=false 但末端已靠拢", () => {
    const { chain, end } = makeChain();
    end.updateMatrixWorld(true);

    // 链总长 3，目标在 10 单位外 → 永远达不到
    const target = new THREE.Vector3(10, 10, 10);
    const result = solveIK(chain, target, { iterations: 8, tolerance: 0.001 });

    expect(result.achieved).toBe(false);
    expect(result.distance).toBeGreaterThan(0);

    // 但末端应该已朝目标方向靠拢
    end.updateMatrixWorld(true);
    const finalPos = new THREE.Vector3();
    end.getWorldPosition(finalPos);
    expect(finalPos.length()).toBeGreaterThan(3); // 原始末端在 (3,0,0)，length=3
  });

  it("单关节链（root → end）→ 无中间关节可旋转", () => {
    const root = new THREE.Object3D();
    const end = new THREE.Object3D();
    end.position.set(1, 0, 0);
    root.add(end);

    const target = new THREE.Vector3(1, 1, 0);
    const result = solveIK([root, end], target, { iterations: 8 });

    // 只有 2 个节点，无中间关节，CCD 不旋转
    expect(result.achieved).toBe(false);
    expect(result.iterations).toBe(8);
  });

  it("空链 / 单节点 → 优雅降级", () => {
    const result = solveIK([], new THREE.Vector3(1, 0, 0));
    expect(result.achieved).toBe(false);
    expect(result.iterations).toBe(0);
  });

  it("关节角度约束生效：minAngle/maxAngle 限制旋转幅度", () => {
    const { chain, end } = makeChain();
    end.updateMatrixWorld(true);

    // 目标需要大角度旋转才能到达，但限制关节只能转 0.1 rad
    const target = new THREE.Vector3(3, 5, 0);
    const result = solveIK(chain, target, {
      iterations: 5,
      minAngle: -0.1,
      maxAngle: 0.1,
      tolerance: 0.001,
    });

    expect(result.achieved).toBe(false);
    // 关节角度受限，末端无法大幅移动
    end.updateMatrixWorld(true);
    const finalPos = new THREE.Vector3();
    end.getWorldPosition(finalPos);
    expect(finalPos.y).toBeLessThan(1); // 如果无约束，y 应该 > 1
  });
});
