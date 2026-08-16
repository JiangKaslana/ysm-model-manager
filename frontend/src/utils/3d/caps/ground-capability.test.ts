// @vitest-environment node
// ===== GroundCapability 测试（utils/3d/caps/ground-capability.ts）=====
// 覆盖：apply 挂入场景（GridHelper）、setVisible/getVisible 开关切换、
// 默认可见/参数覆盖、dispose 移除并释放。
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { GroundCapability, DEFAULT_GROUND_PARAMS } from "./ground-capability.ts";

describe("GroundCapability", () => {
  it("apply 挂入场景（GridHelper + 名称 ysm-ground），默认可见", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    expect(cap.getVisible()).toBe(true);
    cap.apply();
    const grid = scene.getObjectByName("ysm-ground") as THREE.GridHelper | undefined;
    expect(grid).toBeDefined();
    expect(grid).toBeInstanceOf(THREE.GridHelper);
    expect(grid!.visible).toBe(true);
  });

  it("setVisible 切换 + getVisible 同步", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    cap.apply();
    cap.setVisible(false);
    expect(cap.getVisible()).toBe(false);
    expect((scene.getObjectByName("ysm-ground") as THREE.Object3D).visible).toBe(false);
    cap.setVisible(true);
    expect(cap.getVisible()).toBe(true);
  });

  it("参数覆盖（enabled:false 不挂入；params 定制网格尺寸）", () => {
    const scene = new THREE.Scene();
    const off = new GroundCapability({ scene, enabled: false });
    off.apply();
    expect(scene.getObjectByName("ysm-ground")).toBeUndefined(); // disabled 不挂入
    const custom = new GroundCapability({ scene, params: { size: 100, visible: false } });
    custom.apply();
    const grid = scene.getObjectByName("ysm-ground") as THREE.GridHelper;
    expect(grid).toBeDefined();
    expect(grid.visible).toBe(false); // params.visible 覆盖
    expect(DEFAULT_GROUND_PARAMS.size).toBe(50); // 默认参数基线
  });

  it("dispose 移除网格并释放几何/材质（重复 dispose 幂等）", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    cap.apply();
    const grid = scene.getObjectByName("ysm-ground") as THREE.GridHelper;
    expect(grid).toBeDefined();
    cap.dispose();
    expect(scene.getObjectByName("ysm-ground")).toBeUndefined();
    cap.dispose(); // 幂等：已移除不再抛错
  });
});
