// @vitest-environment node
// ===== ReflectorCapability 测试（utils/3d/caps/reflector-capability.ts）=====
// 覆盖：构造默认值、启用禁用、透明度/颜色、尺寸/精度、预设、持久化、getMenuControls。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import {
  ReflectorCapability,
  DEFAULT_REFLECTOR_PARAMS,
  REFLECTOR_PRESETS,
} from "./reflector-capability.ts";

// 拦截 buildReflector（内部依赖 Reflector 3D 对象，node 不可用）
beforeEach(() => {
  vi.spyOn(ReflectorCapability.prototype as unknown as { buildReflector: () => void }, "buildReflector").mockImplementation(() => {
    // no-op
  });
});

function newCap(opts: { enabled?: boolean; params?: Partial<import("./reflector-capability.ts").ReflectorParams> } = {}) {
  const scene = new THREE.Scene();
  const renderer = {
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
  return new ReflectorCapability({ scene, renderer, params: opts.params, enabled: opts.enabled });
}

describe("ReflectorCapability — 构造与默认值", () => {
  it("构造默认值完整", () => {
    const cap = newCap();
    const p = cap.getParams();
    expect(cap.isEnabled()).toBe(false);
    expect(p.opacity).toBe(0.6);
    expect(p.size).toBe(100);
    expect(p.resolution).toBe(1024);
    expect(p.color).toBe(0xffffff);
    expect(p.clipBias).toBe(0.003);
  });

  it("enabled:true 初始启用", () => {
    const cap = newCap({ enabled: true });
    expect(cap.isEnabled()).toBe(true);
  });

  it("params 覆盖生效", () => {
    const cap = newCap({ params: { opacity: 0.8, size: 200, resolution: 2048 } });
    const p = cap.getParams();
    expect(p.opacity).toBe(0.8);
    expect(p.size).toBe(200);
    expect(p.resolution).toBe(2048);
  });
});

describe("ReflectorCapability — 启用/禁用", () => {
  it("setEnabled 切换", () => {
    const cap = newCap();
    cap.setEnabled(true);
    expect(cap.isEnabled()).toBe(true);
    cap.setEnabled(false);
    expect(cap.isEnabled()).toBe(false);
  });
});

describe("ReflectorCapability — 透明度与颜色", () => {
  it("setOpacity 限制 [0, 1]", () => {
    const cap = newCap();
    cap.setOpacity(0.5);
    expect(cap.getParams().opacity).toBe(0.5);
    cap.setOpacity(1.5);
    expect(cap.getParams().opacity).toBe(1);
    cap.setOpacity(-0.5);
    expect(cap.getParams().opacity).toBe(0);
  });

  it("setColor 设置颜色", () => {
    const cap = newCap();
    cap.setColor(0xff0000);
    expect(cap.getParams().color).toBe(0xff0000);
  });
});

describe("ReflectorCapability — 尺寸与精度", () => {
  it("setSize 设置地面大小", () => {
    const cap = newCap();
    cap.setSize(300);
    expect(cap.getParams().size).toBe(300);
  });

  it("setResolution 设置反射精度", () => {
    const cap = newCap();
    cap.setResolution(512);
    expect(cap.getParams().resolution).toBe(512);
  });
});

describe("ReflectorCapability — 预设", () => {
  it("setPreset 按模型类别套用", () => {
    const cap = newCap();
    cap.setPreset("vrm");
    const p = cap.getParams();
    expect(p.opacity).toBe(0.5);
    expect(p.size).toBe(60);
    cap.setPreset("litematic");
    const p2 = cap.getParams();
    expect(p2.opacity).toBe(0.25);
    expect(p2.size).toBe(500);
  });
});

describe("ReflectorCapability — 持久化", () => {
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { localStorage.clear(); });

  it("saveState / loadState 完整周期", () => {
    const cap = newCap({ enabled: true, params: { opacity: 0.8, size: 200, resolution: 2048, color: 0xffeedd, clipBias: 0.005 } });
    cap.saveState();
    const cap2 = newCap();
    cap2.loadState();
    expect(cap2.isEnabled()).toBe(true);
    const p = cap2.getParams();
    expect(p.opacity).toBe(0.8);
    expect(p.size).toBe(200);
    expect(p.resolution).toBe(2048);
    expect(p.color).toBe(0xffeedd);
    expect(p.clipBias).toBe(0.005);
  });

  it("loadState 空存储时保持默认值", () => {
    const cap = newCap({ params: { opacity: 0.3 } });
    cap.loadState();
    expect(cap.getParams().opacity).toBe(0.3);
  });
});

describe("ReflectorCapability — getMenuControls 结构", () => {
  it("返回完整控件列表", () => {
    const cap = newCap();
    const controls = cap.getMenuControls();
    expect(controls.length).toBeGreaterThanOrEqual(4);
    // 总开关
    const enabledCtrl = controls.find((c) => c.id === "reflector-enabled");
    expect(enabledCtrl).toBeDefined();
    expect(enabledCtrl!.kind).toBe("toggle");
    expect(enabledCtrl!.getValue()).toBe(false);
    // 透明度滑块
    expect(controls.find((c) => c.id === "reflector-opacity")).toBeDefined();
    // 精度滑块
    expect(controls.find((c) => c.id === "reflector-resolution")).toBeDefined();
    // 地面大小滑块
    expect(controls.find((c) => c.id === "reflector-size")).toBeDefined();
  });

  it("toggle 开关同步状态", () => {
    const cap = newCap();
    const controls = cap.getMenuControls();
    const enabledCtrl = controls.find((c) => c.id === "reflector-enabled")!;
    enabledCtrl.setValue(true);
    expect(cap.isEnabled()).toBe(true);
    enabledCtrl.setValue(false);
    expect(cap.isEnabled()).toBe(false);
  });
});

describe("ReflectorCapability — 预设数据完整性", () => {
  it("DEFAULT_REFLECTOR_PARAMS 默认值完整", () => {
    expect(DEFAULT_REFLECTOR_PARAMS.enabled).toBe(false);
    expect(DEFAULT_REFLECTOR_PARAMS.size).toBe(100);
    expect(DEFAULT_REFLECTOR_PARAMS.resolution).toBe(1024);
    expect(DEFAULT_REFLECTOR_PARAMS.opacity).toBe(0.6);
    expect(DEFAULT_REFLECTOR_PARAMS.clipBias).toBe(0.003);
  });

  it("REFLECTOR_PRESETS 覆盖所有模型类型", () => {
    const expectedTypes = ["default", "ysm", "vrm", "mmd", "litematic", "resourcepack"];
    for (const t of expectedTypes) {
      expect(REFLECTOR_PRESETS[t]).toBeDefined();
    }
  });
});