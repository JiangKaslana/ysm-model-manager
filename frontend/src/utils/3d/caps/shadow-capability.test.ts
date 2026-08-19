// @vitest-environment node
// ===== ShadowCapability 测试（utils/3d/caps/shadow-capability.ts）=====
// 覆盖：构造默认值、启用禁用、分辨率/软硬切换、bias/normalBias/cameraSize、持久化、getMenuControls。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import {
  ShadowCapability,
  DEFAULT_SHADOW_PARAMS,
  SHADOW_PRESETS,
} from "./shadow-capability.ts";

// 拦截 apply（内部依赖灯对象 shadow 管线，node 不可用）
beforeEach(() => {
  vi.spyOn(ShadowCapability.prototype as unknown as { apply: () => void }, "apply").mockImplementation(function (this: ShadowCapability) {
    // 只更新 renderer shadowMap 状态，跳过灯/网格遍历
    if (this.isEnabled()) {
      // no-op
    }
  });
});

function makeFakeRenderer() {
  return {
    shadowMap: {
      enabled: false,
      type: THREE.PCFSoftShadowMap,
      needsUpdate: false,
    },
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

function newCap(opts: { enabled?: boolean; params?: Partial<import("./shadow-capability.ts").ShadowParams> } = {}) {
  const scene = new THREE.Scene();
  const renderer = makeFakeRenderer();
  return new ShadowCapability({ scene, renderer, params: opts.params, enabled: opts.enabled });
}

describe("ShadowCapability — 构造与默认值", () => {
  it("构造默认值完整", () => {
    const cap = newCap();
    expect(cap.isEnabled()).toBe(false);
    expect(cap.getMapSize()).toBe(1024);
    expect(cap.isSoft()).toBe(false); // "hard" ≠ soft
    expect(cap.getBias()).toBe(-0.0005);
    expect(cap.getNormalBias()).toBe(0.02);
    expect(cap.getCameraSize()).toBe(15);
  });

  it("enabled:true 初始启用", () => {
    const cap = newCap({ enabled: true });
    expect(cap.isEnabled()).toBe(true);
  });

  it("params 覆盖生效", () => {
    const cap = newCap({ params: { mapSize: 2048, type: "soft", cameraSize: 20 } });
    expect(cap.getMapSize()).toBe(2048);
    expect(cap.isSoft()).toBe(true);
    expect(cap.getCameraSize()).toBe(20);
  });
});

describe("ShadowCapability — 启用/禁用", () => {
  it("setEnabled 切换", () => {
    const cap = newCap();
    cap.setEnabled(true);
    expect(cap.isEnabled()).toBe(true);
    cap.setEnabled(false);
    expect(cap.isEnabled()).toBe(false);
  });
});

describe("ShadowCapability — 分辨率", () => {
  it("setMapSize 合法值", () => {
    const cap = newCap();
    cap.setMapSize(2048);
    expect(cap.getMapSize()).toBe(2048);
    cap.setMapSize(4096);
    expect(cap.getMapSize()).toBe(4096);
  });

  it("setMapSize 非法值回退默认", () => {
    const cap = newCap();
    cap.setMapSize(3000); // 不在 [512,1024,2048,4096] 中
    expect(cap.getMapSize()).toBe(DEFAULT_SHADOW_PARAMS.mapSize);
  });
});

describe("ShadowCapability — 软硬切换", () => {
  it("setSoft 切换", () => {
    const cap = newCap();
    cap.setSoft(true);
    expect(cap.isSoft()).toBe(true);
    cap.setSoft(false);
    expect(cap.isSoft()).toBe(false);
  });
});

describe("ShadowCapability — bias/normalBias", () => {
  it("setBias 读写", () => {
    const cap = newCap();
    cap.setBias(-0.001);
    expect(cap.getBias()).toBe(-0.001);
  });

  it("setNormalBias 读写", () => {
    const cap = newCap();
    cap.setNormalBias(0.05);
    expect(cap.getNormalBias()).toBe(0.05);
  });
});

describe("ShadowCapability — cameraSize", () => {
  it("setCameraSize 限制 [5, 80]", () => {
    const cap = newCap();
    cap.setCameraSize(30);
    expect(cap.getCameraSize()).toBe(30);
    cap.setCameraSize(3); // clamp 到 5
    expect(cap.getCameraSize()).toBe(5);
    cap.setCameraSize(100); // clamp 到 80
    expect(cap.getCameraSize()).toBe(80);
  });
});

describe("ShadowCapability — 持久化", () => {
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { localStorage.clear(); });

  it("saveState / loadState 完整周期", () => {
    const cap = newCap({ enabled: true, params: { mapSize: 2048, type: "soft", bias: -0.001, normalBias: 0.05, cameraSize: 20 } });
    cap.saveState();
    const cap2 = newCap();
    cap2.loadState();
    expect(cap2.isEnabled()).toBe(true);
    expect(cap2.getMapSize()).toBe(2048);
    expect(cap2.isSoft()).toBe(true);
    expect(cap2.getBias()).toBe(-0.001);
    expect(cap2.getNormalBias()).toBe(0.05);
    expect(cap2.getCameraSize()).toBe(20);
  });

  it("loadState 空存储时保持默认值", () => {
    const cap = newCap({ params: { mapSize: 4096 } });
    cap.loadState();
    expect(cap.getMapSize()).toBe(4096);
  });

  it("loadState 兼容旧 soft 字段", () => {
    localStorage.setItem("ysm-scene-cap-shadow", JSON.stringify({ enabled: true, soft: true, mapSize: 2048, bias: -0.001, normalBias: 0.02, cameraSize: 15 }));
    const cap = newCap();
    cap.loadState();
    expect(cap.isEnabled()).toBe(true);
    expect(cap.isSoft()).toBe(true);
    expect(cap.getMapSize()).toBe(2048);
  });
});

describe("ShadowCapability — getMenuControls 结构", () => {
  it("返回完整控件列表", () => {
    const cap = newCap();
    const controls = cap.getMenuControls();
    expect(controls.length).toBeGreaterThanOrEqual(6);
    // 总开关
    const enabledCtrl = controls.find((c) => c.id === "shadow-enabled");
    expect(enabledCtrl).toBeDefined();
    expect(enabledCtrl!.kind).toBe("toggle");
    expect(enabledCtrl!.getValue()).toBe(false);
    // 分辨率选择器
    const mapSizeCtrl = controls.find((c) => c.id === "shadow-map-size");
    expect(mapSizeCtrl).toBeDefined();
    expect(mapSizeCtrl!.kind).toBe("select");
    expect(mapSizeCtrl!.select?.length).toBe(4);
    // 软阴影开关
    const softCtrl = controls.find((c) => c.id === "shadow-soft");
    expect(softCtrl).toBeDefined();
    expect(softCtrl!.kind).toBe("toggle");
    expect(softCtrl!.getValue()).toBe(false);
    // bias / normalBias / cameraSize 滑块
    expect(controls.find((c) => c.id === "shadow-bias")).toBeDefined();
    expect(controls.find((c) => c.id === "shadow-normal-bias")).toBeDefined();
    expect(controls.find((c) => c.id === "shadow-camera-size")).toBeDefined();
  });

  it("toggle 开关同步状态", () => {
    const cap = newCap();
    const controls = cap.getMenuControls();
    const enabledCtrl = controls.find((c) => c.id === "shadow-enabled")!;
    enabledCtrl.setValue(true);
    expect(cap.isEnabled()).toBe(true);
    enabledCtrl.setValue(false);
    expect(cap.isEnabled()).toBe(false);
  });

  it("分辨率选择同步", () => {
    const cap = newCap();
    const controls = cap.getMenuControls();
    const mapSizeCtrl = controls.find((c) => c.id === "shadow-map-size")!;
    mapSizeCtrl.setValue("2048");
    expect(cap.getMapSize()).toBe(2048);
  });

  it("非总开关控件均含 group 字段", () => {
    const cap = newCap();
    const controls = cap.getMenuControls();
    controls.filter((c) => c.id !== "shadow-enabled").forEach((c) => {
      expect(c.group).toBeDefined();
      expect(c.group!.startsWith("preview.")).toBe(true);
    });
  });
});

describe("ShadowCapability — 预设数据完整性", () => {
  it("DEFAULT_SHADOW_PARAMS 默认值完整", () => {
    expect(DEFAULT_SHADOW_PARAMS.enabled).toBe(false);
    expect(DEFAULT_SHADOW_PARAMS.type).toBe("hard");
    expect(DEFAULT_SHADOW_PARAMS.mapSize).toBe(1024);
    expect(typeof DEFAULT_SHADOW_PARAMS.bias).toBe("number");
    expect(typeof DEFAULT_SHADOW_PARAMS.normalBias).toBe("number");
    expect(typeof DEFAULT_SHADOW_PARAMS.cameraSize).toBe("number");
  });

  it("SHADOW_PRESETS 覆盖所有预设键", () => {
    const expectedKeys = ["default", "prop", "small", "architecture", "scene", "character", "creature"];
    for (const k of expectedKeys) {
      expect(SHADOW_PRESETS[k]).toBeDefined();
    }
  });
});