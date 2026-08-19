// @vitest-environment node
// ===== SkyCapability 测试（utils/3d/caps/sky-capability.ts）=====
// 覆盖：构造默认值、时间/云量/环境 IBL、启用禁用、预设、持久化、getMenuControls。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import {
  SkyCapability,
  DEFAULT_SKY_PARAMS,
  MODEL_SKY_PRESETS,
} from "./sky-capability.ts";

// 拦截 apply（内部依赖 Sky 3D 对象 + PMREMGenerator，node 不可用）
beforeEach(() => {
  vi.spyOn(SkyCapability.prototype as unknown as { apply: () => void }, "apply").mockImplementation(() => {
    // no-op
  });
});

function makeFakeRenderer() {
  return {
    capabilities: { isWebGL2: true, maxTextures: 16 },
    properties: new Map(),
    info: { autoReset: true, memory: { textures: 0, geometries: 0 }, render: { calls: 0, triangles: 0, points: 0, frame: 0 }, reset: () => {} },
    domElement: { style: {}, tagName: "CANVAS" } as unknown as HTMLCanvasElement,
    getSize: () => ({ width: 512, height: 512 }),
    getPixelRatio: () => 1,
    getContext: () => null,
    outputColorSpace: THREE.SRGBColorSpace,
    toneMapping: THREE.ACESFilmicToneMapping,
    toneMappingExposure: 1,
  } as unknown as THREE.WebGLRenderer;
}

function newCap(opts: { enabled?: boolean; params?: Partial<import("./sky-capability.ts").SkyParams> } = {}) {
  const scene = new THREE.Scene();
  const renderer = makeFakeRenderer();
  return new SkyCapability({ scene, renderer, params: opts.params, enabled: opts.enabled });
}

describe("SkyCapability — 构造与默认值", () => {
  it("构造默认值完整", () => {
    const cap = newCap();
    expect(cap.isEnabled()).toBe(true);
    expect(cap.getTimeOfDay()).toBe(9);
    expect(cap.getCloudCoverage()).toBe(0);
    expect(cap.isEnvironmentEnabled()).toBe(true);
  });

  it("enabled:false 初始禁用", () => {
    const cap = newCap({ enabled: false });
    expect(cap.isEnabled()).toBe(false);
  });

  it("params 覆盖生效", () => {
    const cap = newCap({ params: { timeOfDay: 15, cloudCoverage: 0.5, environment: false } });
    expect(cap.getTimeOfDay()).toBe(15);
    expect(cap.getCloudCoverage()).toBe(0.5);
    expect(cap.isEnvironmentEnabled()).toBe(false);
  });
});

describe("SkyCapability — 时间控制", () => {
  it("setTime 设置时间（0-24 循环）", () => {
    const cap = newCap();
    cap.setTime(12);
    expect(cap.getTimeOfDay()).toBe(12);
    cap.setTime(6);
    expect(cap.getTimeOfDay()).toBe(6);
  });

  it("setTime 超范围取模（25→1, -1→23）", () => {
    const cap = newCap();
    cap.setTime(25);
    expect(cap.getTimeOfDay()).toBe(1);
    cap.setTime(-1);
    expect(cap.getTimeOfDay()).toBe(23);
  });
});

describe("SkyCapability — 云量控制", () => {
  it("setCloudCoverage 设置云量（0~1 clamp）", () => {
    const cap = newCap();
    cap.setCloudCoverage(0.5);
    expect(cap.getCloudCoverage()).toBe(0.5);
    cap.setCloudCoverage(1.5);
    expect(cap.getCloudCoverage()).toBe(1);
    cap.setCloudCoverage(-0.5);
    expect(cap.getCloudCoverage()).toBe(0);
  });
});

describe("SkyCapability — 环境 IBL 开关", () => {
  it("setEnvironmentEnabled 切换", () => {
    const cap = newCap();
    expect(cap.isEnvironmentEnabled()).toBe(true);
    cap.setEnvironmentEnabled(false);
    expect(cap.isEnvironmentEnabled()).toBe(false);
    cap.setEnvironmentEnabled(true);
    expect(cap.isEnvironmentEnabled()).toBe(true);
  });
});

describe("SkyCapability — 启用/禁用", () => {
  it("setEnabled 切换", () => {
    const cap = newCap();
    cap.setEnabled(false);
    expect(cap.isEnabled()).toBe(false);
    cap.setEnabled(true);
    expect(cap.isEnabled()).toBe(true);
  });
});

describe("SkyCapability — 预设", () => {
  it("setPreset 按模型类别套用", () => {
    const cap = newCap();
    cap.setPreset("vrm");
    // vrm 预设覆盖 turbidity/exposure 等
    expect(cap.isEnabled()).toBe(true);
    cap.setPreset("mmd");
    expect(cap.isEnabled()).toBe(true);
  });
});

describe("SkyCapability — 持久化", () => {
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { localStorage.clear(); });

  it("saveState / loadState 完整周期", () => {
    const cap = newCap({ params: { timeOfDay: 15, cloudCoverage: 0.3, environment: false } });
    cap.saveState();
    const cap2 = newCap();
    cap2.loadState();
    expect(cap2.getTimeOfDay()).toBe(15);
    expect(cap2.getCloudCoverage()).toBe(0.3);
    expect(cap2.isEnvironmentEnabled()).toBe(false);
    expect(cap2.isEnabled()).toBe(true);
  });

  it("loadState 空存储时保持默认值", () => {
    const cap = newCap({ params: { timeOfDay: 18 } });
    cap.loadState();
    expect(cap.getTimeOfDay()).toBe(18);
  });
});

describe("SkyCapability — getMenuControls 结构", () => {
  it("返回完整控件列表", () => {
    const cap = newCap();
    const controls = cap.getMenuControls();
    expect(controls.length).toBeGreaterThanOrEqual(3);
    // 时间滑块
    const timeCtrl = controls.find((c) => c.id === "sky-time");
    expect(timeCtrl).toBeDefined();
    expect(timeCtrl!.kind).toBe("slider");
    expect(timeCtrl!.slider?.unit).toBe("h");
    expect(timeCtrl!.getValue()).toBe(9);
    // 云量滑块
    const cloudCtrl = controls.find((c) => c.id === "sky-cloud");
    expect(cloudCtrl).toBeDefined();
    expect(cloudCtrl!.kind).toBe("slider");
    expect(cloudCtrl!.slider?.unit).toBe("%");
    // 环境贴图开关
    const envCtrl = controls.find((c) => c.id === "sky-env");
    expect(envCtrl).toBeDefined();
    expect(envCtrl!.kind).toBe("toggle");
    expect(envCtrl!.getValue()).toBe(true);
  });

  it("控件操作同步状态", () => {
    const cap = newCap();
    const controls = cap.getMenuControls();
    // 时间滑块
    const timeCtrl = controls.find((c) => c.id === "sky-time")!;
    timeCtrl.setValue(18);
    expect(cap.getTimeOfDay()).toBe(18);
    expect(timeCtrl.getValue()).toBe(18);
    // 环境贴图开关
    const envCtrl = controls.find((c) => c.id === "sky-env")!;
    envCtrl.setValue(false);
    expect(cap.isEnvironmentEnabled()).toBe(false);
    envCtrl.setValue(true);
    expect(cap.isEnvironmentEnabled()).toBe(true);
  });

  it("非主控件均含 group 字段（云量/环境贴图/昼夜循环）", () => {
    const cap = newCap();
    const controls = cap.getMenuControls();
    controls.filter((c) => c.id !== "sky-time").forEach((c) => {
      expect(c.group).toBeDefined();
      expect(c.group!.startsWith("preview.sky")).toBe(true);
    });
  });
});

describe("SkyCapability — 预设数据完整性", () => {
  it("DEFAULT_SKY_PARAMS 默认值完整", () => {
    expect(DEFAULT_SKY_PARAMS.timeOfDay).toBe(9);
    expect(typeof DEFAULT_SKY_PARAMS.elevation).toBe("number");
    expect(typeof DEFAULT_SKY_PARAMS.turbidity).toBe("number");
    expect(typeof DEFAULT_SKY_PARAMS.cloudCoverage).toBe("number");
    expect(DEFAULT_SKY_PARAMS.scale).toBeGreaterThan(0);
  });

  it("MODEL_SKY_PRESETS 覆盖所有模型类型", () => {
    const expectedTypes = ["default", "vrm", "mmd", "mmd-scene", "ysm", "litematic"];
    for (const t of expectedTypes) {
      expect(MODEL_SKY_PRESETS[t]).toBeDefined();
    }
  });
});