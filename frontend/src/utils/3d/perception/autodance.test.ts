// ===== 感知层：AutoDance 测试（autodance.ts）=====
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildBoneTree } from "../bone-tools.ts";
import { createAutoDanceController } from "./autodance.ts";
import { type SemanticBoneMap } from "../semantic-bones.ts";

function fakeMap(entries: Record<string, THREE.Object3D>): SemanticBoneMap {
  const map: SemanticBoneMap = {};
  for (const [id, obj] of Object.entries(entries)) {
    map[id as keyof SemanticBoneMap] = { id, object: obj };
  }
  return map;
}

describe("createAutoDanceController", () => {
  it("初始不抛错（warmup 延迟到首次 apply）", () => {
    const ctrl = createAutoDanceController({ bpm: 120, intensity: 0.5 });
    expect(() => ctrl.apply(0.016, {})).not.toThrow();
    ctrl.dispose();
  });

  it("有 hips 骨时产生旋转变化", () => {
    const hips = new THREE.Object3D();
    hips.rotation.set(0, 0, 0);
    const map = fakeMap({ hips });
    const ctrl = createAutoDanceController({ bpm: 120, intensity: 0.8 });
    ctrl.apply(0.016, map);
    // 第一轮后 rotation 应有变化
    expect(Math.abs(hips.rotation.y)).toBeGreaterThan(0.001);
  });

  it("空 map 不抛错", () => {
    const ctrl = createAutoDanceController();
    expect(() => ctrl.apply(0.016, {})).not.toThrow();
    ctrl.dispose();
  });

  it("disabled 时不驱动", () => {
    const hips = new THREE.Object3D();
    const map = fakeMap({ hips });
    const ctrl = createAutoDanceController({ enabled: false });
    ctrl.apply(0.016, map);
    expect(hips.rotation.y).toBeCloseTo(0, 6);
    ctrl.dispose();
  });

  it("dispose 后不再驱动", () => {
    const hips = new THREE.Object3D();
    const map = fakeMap({ hips });
    const ctrl = createAutoDanceController();
    ctrl.apply(0.016, map);
    const before = hips.rotation.y;
    ctrl.dispose();
    ctrl.apply(0.016, map);
    // dispose 后状态清零，不应继续变化
    expect(hips.rotation.y).toBeCloseTo(before, 6);
  });

  it("intensity=0 时不驱动", () => {
    const hips = new THREE.Object3D();
    const map = fakeMap({ hips });
    const ctrl = createAutoDanceController({ intensity: 0 });
    ctrl.apply(0.016, map);
    expect(hips.rotation.y).toBeCloseTo(0, 6);
    ctrl.dispose();
  });
});
