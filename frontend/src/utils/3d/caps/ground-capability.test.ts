// @vitest-environment node
// ===== GroundCapability 测试（utils/3d/caps/ground-capability.ts）=====
// 覆盖：apply 挂入场景（GridHelper）、setVisible/getVisible 开关切换、
// 默认可见/参数覆盖、dispose 移除并释放、水面法线贴图。
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

describe("GroundCapability — getMenuControls 分组", () => {
  it("总开关无 group；水面参数组含 group", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    const controls = cap.getMenuControls();
    // 总开关 + 4 个水面参数（湿润度/水色/不透明度/法线强度）
    expect(controls.length).toBe(5);
    expect(controls[0]!.id).toBe("ground-visible");
    expect(controls[0]!.group).toBeUndefined();
    // 水面参数组：湿润度/水色/不透明度/法线强度
    const waterControls = controls.filter((c) => c.group === "preview.groundGroupWater");
    expect(waterControls.length).toBe(4);
    expect(waterControls.map((c) => c.id).sort()).toEqual(
      ["ground-wetness", "ground-water-color", "ground-water-opacity", "ground-normal-strength"].sort(),
    );
  });

  it("getMenuControls 含 ground-normal-strength slider", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    const controls = cap.getMenuControls();
    const normalCtrl = controls.find((c) => c.id === "ground-normal-strength");
    expect(normalCtrl).toBeDefined();
    expect(normalCtrl!.kind).toBe("slider");
    expect(normalCtrl!.group).toBe("preview.groundGroupWater");
    expect(normalCtrl!.slider).toEqual({ min: 0, max: 1, step: 0.05 });
  });

  it("setNormalStrength 影响 waterMat.normalScale", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    cap.apply();
    expect(cap.getNormalStrength()).toBe(0.3);
    cap.setNormalStrength(0.8);
    expect(cap.getNormalStrength()).toBe(0.8);
    const mat = cap["water"].material as THREE.MeshStandardMaterial;
    expect(mat.normalScale.x).toBeCloseTo(0.8);
    expect(mat.normalScale.y).toBeCloseTo(0.8);
  });

  it("generateNormalMap 返回 DataTexture，尺寸 256x256", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    const tex = cap["generateNormalMap"](256);
    expect(tex).toBeInstanceOf(THREE.DataTexture);
    expect(tex.width).toBe(256);
    expect(tex.height).toBe(256);
  });

  it("generateNormalMap 像素值合法：R/G 有变化，B 接近 255", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    const tex = cap["generateNormalMap"](256) as THREE.DataTexture;
    expect(tex.image.data).toBeDefined();
    const data = tex.image.data as Uint8Array;
    expect(data.length).toBe(256 * 256 * 4);

    let rMin = 255, rMax = 0, gMin = 255, gMax = 0;
    let bCount = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (r < rMin) rMin = r; if (r > rMax) rMax = r;
      if (g < gMin) gMin = g; if (g > gMax) gMax = g;
      if (b >= 240) bCount++;
    }
    // R/G 通道应有变化（不为单一值）
    expect(rMax - rMin).toBeGreaterThan(5);
    expect(gMax - gMin).toBeGreaterThan(5);
    // B 通道大部分接近 255（朝上法线）
    expect(bCount).toBeGreaterThan(data.length / 4 * 0.9);
  });

  it("saveState/loadState 持久化 normalStrength", () => {
    const scene = new THREE.Scene();
    const cap = new GroundCapability({ scene });
    cap.setNormalStrength(0.7);
    cap.saveState();
    const cap2 = new GroundCapability({ scene });
    cap2.loadState();
    expect(cap2.getNormalStrength()).toBe(0.7);
  });
});
