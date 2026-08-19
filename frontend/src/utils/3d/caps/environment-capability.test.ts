// @vitest-environment node
// ===== EnvironmentCapability 测试（utils/3d/caps/environment-capability.ts）=====
// 覆盖：构造默认值、预设切换、强度控制、背景开关、持久化、告警回退、getMenuControls 结构。
//
// 设计说明：
// - buildEnvironment 内部调用 document.createElement("canvas") 和 PMREMGenerator，
//   在 node 环境无法执行。所有测试通过 spyOn 将 buildEnvironment 拦截为 no-op，
//   专注测试状态管理逻辑（参数读写、条件分支、持久化）。
// - 预设数据完整性测试不依赖实例，不需要 mock。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import {
  EnvironmentCapability,
  DEFAULT_ENV_PARAMS,
  ENV_PRESETS,
  ENV_PRESET_BY_MODEL,
} from "./environment-capability.ts";

// 拦截 buildEnvironment（所有实例共享原型，PMREM/canvas 在 node 不可用）
beforeEach(() => {
  vi.spyOn(EnvironmentCapability.prototype as unknown as { buildEnvironment: () => void }, "buildEnvironment").mockImplementation(() => {
    // no-op：跳过 canvas/PMREM 渲染路径
  });
});

// ---- 假渲染器（仅需构造时不报错，PMREM 路径已被 mock 拦截）----
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

function newCap(opts: {
  enabled?: boolean;
  params?: Partial<import("./environment-capability.ts").EnvironmentParams>;
} = {}) {
  const scene = new THREE.Scene();
  const renderer = makeFakeRenderer();
  return new EnvironmentCapability({
    scene,
    renderer,
    params: opts.params as import("./environment-capability.ts").EnvironmentParams | undefined,
    enabled: opts.enabled,
  });
}

describe("EnvironmentCapability — 构造与默认值", () => {
  it("构造默认值完整", () => {
    const cap = newCap();
    expect(cap.isEnabled()).toBe(true);
    expect(cap.getPresetId()).toBe("sky");
    expect(cap.getIntensity()).toBe(1.0);
    expect(cap.isUseAsBackground()).toBe(false);
    expect(cap.hasCustomHdr()).toBe(false);
    expect(cap.isCustomHdrLoading()).toBe(false);
    expect(cap.getCustomHdrName()).toBe("");
  });

  it("enabled:false 初始禁用", () => {
    const cap = newCap({ enabled: false });
    expect(cap.isEnabled()).toBe(false);
  });

  it("params 覆盖生效", () => {
    const cap = newCap({ params: { preset: "studio", intensity: 1.5, useAsBackground: true } });
    expect(cap.getPresetId()).toBe("studio");
    expect(cap.getIntensity()).toBe(1.5);
    expect(cap.isUseAsBackground()).toBe(true);
  });
});

describe("EnvironmentCapability — 预设切换", () => {
  it("setPresetId 切换预设（sky→studio→sunset）", () => {
    const cap = newCap();
    cap.setPresetId("studio");
    expect(cap.getPresetId()).toBe("studio");
    cap.setPresetId("sunset");
    expect(cap.getPresetId()).toBe("sunset");
    cap.setPresetId("night");
    expect(cap.getPresetId()).toBe("night");
  });

  it("setPresetId('custom') 无缓存时不切换（保持当前预设）", () => {
    const cap = newCap();
    const orig = cap.getPresetId();
    cap.setPresetId("custom");
    // 无 custom HDR 缓存 → 不切换
    expect(cap.getPresetId()).toBe(orig);
    expect(cap.hasCustomHdr()).toBe(false);
  });

  it("setPreset 按模型类别套用（ENV_PRESET_BY_MODEL）", () => {
    const cap = newCap();
    cap.setPreset("vrm");
    // vrm → studio
    expect(cap.getPresetId()).toBe("studio");
    expect(cap.getIntensity()).toBe(ENV_PRESETS.studio.defaultIntensity);
    cap.setPreset("litematic");
    // litematic → forest
    expect(cap.getPresetId()).toBe("forest");
  });

  it("setPreset 未知模型类型回退 default（sky）", () => {
    const cap = newCap();
    cap.setPreset("unknown_type");
    expect(cap.getPresetId()).toBe(ENV_PRESET_BY_MODEL.default.preset ?? "sky");
  });

  it("setPreset 不会跳到 custom（由用户主动选 HDR 才进）", () => {
    const cap = newCap();
    cap.setPreset("default");
    expect(cap.getPresetId()).not.toBe("custom");
  });
});

describe("EnvironmentCapability — 强度控制", () => {
  it("setIntensity 设置反射强度（0~5 有效范围）", () => {
    const cap = newCap();
    cap.setIntensity(2.0);
    expect(cap.getIntensity()).toBe(2.0);
    cap.setIntensity(0.5);
    expect(cap.getIntensity()).toBe(0.5);
  });

  it("setIntensity clamp 到 [0, 5]", () => {
    const cap = newCap();
    cap.setIntensity(-1);
    expect(cap.getIntensity()).toBe(0);
    cap.setIntensity(10);
    expect(cap.getIntensity()).toBe(5);
  });
});

describe("EnvironmentCapability — 背景开关", () => {
  it("setUseAsBackground 切换", () => {
    const cap = newCap();
    expect(cap.isUseAsBackground()).toBe(false);
    cap.setUseAsBackground(true);
    expect(cap.isUseAsBackground()).toBe(true);
    cap.setUseAsBackground(false);
    expect(cap.isUseAsBackground()).toBe(false);
  });
});

describe("EnvironmentCapability — 启用/禁用", () => {
  it("setEnabled(false) 禁用环境贴图，setEnabled(true) 恢复", () => {
    const cap = newCap();
    cap.setEnabled(false);
    expect(cap.isEnabled()).toBe(false);
    cap.setEnabled(true);
    expect(cap.isEnabled()).toBe(true);
  });
});

describe("EnvironmentCapability — 持久化", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("saveState / loadState 完整周期", () => {
    const cap = newCap({ params: { preset: "sunset", intensity: 1.4, useAsBackground: true } });
    cap.saveState();
    // 新 cap 从 localStorage 恢复
    const cap2 = newCap();
    cap2.loadState();
    expect(cap2.getPresetId()).toBe("sunset");
    expect(cap2.getIntensity()).toBe(1.4);
    expect(cap2.isUseAsBackground()).toBe(true);
    expect(cap2.isEnabled()).toBe(true);
  });

  it("loadState 空存储时保持默认值", () => {
    const cap = newCap({ params: { preset: "night" } });
    cap.loadState(); // 无存储 → 不覆盖
    expect(cap.getPresetId()).toBe("night");
  });

  it("loadState 读回 preset=custom 但无缓存 → 回退 studio", () => {
    localStorage.setItem("ysm-scene-cap-environment", JSON.stringify({ preset: "custom", enabled: true, intensity: 1.0, resolution: 1024, useAsBackground: false }));
    const cap = newCap();
    cap.loadState();
    // custom 无缓存 → 回退 studio
    expect(cap.getPresetId()).toBe("studio");
  });

  it("loadState 读回合法 preset 时正确恢复", () => {
    localStorage.setItem("ysm-scene-cap-environment", JSON.stringify({ preset: "forest", enabled: false, intensity: 1.1, resolution: 1024, useAsBackground: true }));
    const cap = newCap();
    cap.loadState();
    expect(cap.getPresetId()).toBe("forest");
    expect(cap.isEnabled()).toBe(false);
    expect(cap.getIntensity()).toBe(1.1);
    expect(cap.isUseAsBackground()).toBe(true);
  });
});

describe("EnvironmentCapability — getMenuControls 结构", () => {
  it("返回完整控件列表，包含所有必需控件", () => {
    const cap = newCap();
    const controls = cap.getMenuControls();
    expect(controls.length).toBeGreaterThanOrEqual(6);
    // 检查总开关（env-enabled）
    const enabledCtrl = controls.find((c) => c.id === "env-enabled");
    expect(enabledCtrl).toBeDefined();
    expect(enabledCtrl!.kind).toBe("toggle");
    expect(enabledCtrl!.getValue()).toBe(true);
    // 检查预设选择器
    const presetCtrl = controls.find((c) => c.id === "env-preset");
    expect(presetCtrl).toBeDefined();
    expect(presetCtrl!.kind).toBe("select");
    expect(presetCtrl!.select?.length).toBeGreaterThanOrEqual(6); // 5 preset + custom
    // 检查强度滑块
    const intensityCtrl = controls.find((c) => c.id === "env-intensity");
    expect(intensityCtrl).toBeDefined();
    expect(intensityCtrl!.kind).toBe("slider");
    expect(intensityCtrl!.slider?.min).toBe(0);
    expect(intensityCtrl!.slider?.max).toBe(3);
    // 检查背景开关
    const bgCtrl = controls.find((c) => c.id === "env-use-as-background");
    expect(bgCtrl).toBeDefined();
    expect(bgCtrl!.kind).toBe("toggle");
    // 检查 HDR 按钮
    const pickCtrl = controls.find((c) => c.id === "env-pick-hdr");
    expect(pickCtrl).toBeDefined();
    expect(pickCtrl!.kind).toBe("button");
    expect(pickCtrl!.button?.variant).toBe("primary");
    const clearCtrl = controls.find((c) => c.id === "env-clear-hdr");
    expect(clearCtrl).toBeDefined();
    expect(clearCtrl!.kind).toBe("button");
    expect(clearCtrl!.button?.variant).toBe("ghost");
  });

  it("toggle 开关操作同步状态", () => {
    const cap = newCap();
    const controls = cap.getMenuControls();
    const enabledCtrl = controls.find((c) => c.id === "env-enabled")!;
    expect(enabledCtrl.getValue()).toBe(true);
    enabledCtrl.setValue(false);
    expect(cap.isEnabled()).toBe(false);
    expect(enabledCtrl.getValue()).toBe(false);
    enabledCtrl.setValue(true);
    expect(cap.isEnabled()).toBe(true);
  });

  it("强度滑块读写同步", () => {
    const cap = newCap();
    const controls = cap.getMenuControls();
    const intensityCtrl = controls.find((c) => c.id === "env-intensity")!;
    intensityCtrl.setValue(2.5);
    expect(cap.getIntensity()).toBe(2.5);
    expect(intensityCtrl.getValue()).toBe(2.5);
  });

  it("背景开关读写同步", () => {
    const cap = newCap();
    const controls = cap.getMenuControls();
    const bgCtrl = controls.find((c) => c.id === "env-use-as-background")!;
    bgCtrl.setValue(true);
    expect(cap.isUseAsBackground()).toBe(true);
    expect(bgCtrl.getValue()).toBe(true);
  });

  it("HDR 清除按钮 disabled 随 hasCustomHdr 变化", () => {
    const cap = newCap();
    const controls = cap.getMenuControls();
    const clearCtrl = controls.find((c) => c.id === "env-clear-hdr")!;
    // 无 custom HDR → 禁用
    expect(clearCtrl.button?.disabled?.()).toBe(true);
    // 注入假 HDR 缓存（模拟已加载）
    (cap as unknown as Record<string, unknown>).customHdrTex = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    (cap as unknown as Record<string, unknown>).customHdrName = "test.hdr";
    expect(clearCtrl.button?.disabled?.()).toBe(false);
  });

  it("HDR 选择按钮 disabled 随加载状态变化", () => {
    const cap = newCap();
    const controls = cap.getMenuControls();
    const pickCtrl = controls.find((c) => c.id === "env-pick-hdr")!;
    expect(pickCtrl.button?.disabled?.()).toBe(false);
    // 模拟加载中
    (cap as unknown as Record<string, unknown>).customHdrLoading = true;
    expect(pickCtrl.button?.disabled?.()).toBe(true);
  });

  it("预设选择器列出所有预设 + custom", () => {
    const cap = newCap();
    const controls = cap.getMenuControls();
    const presetCtrl = controls.find((c) => c.id === "env-preset")!;
    const values = presetCtrl.select!.map((o) => o.value);
    // 所有 ENV_PRESETS 的 key 都应出现
    for (const key of Object.keys(ENV_PRESETS)) {
      expect(values).toContain(key);
    }
    expect(values).toContain("custom");
  });

  it("非总开关控件均含 group 字段", () => {
    const cap = newCap();
    const controls = cap.getMenuControls();
    controls.filter((c) => c.id !== "env-enabled").forEach((c) => {
      expect(c.group).toBeDefined();
      expect(c.group!.startsWith("preview.env")).toBe(true);
    });
  });
});

describe("EnvironmentCapability — 预设数据完整性", () => {
  it("ENV_PRESETS 每个预设字段完整", () => {
    for (const [id, p] of Object.entries(ENV_PRESETS)) {
      expect(p.id).toBe(id);
      expect(typeof p.label).toBe("string");
      expect(typeof p.zenith).toBe("number");
      expect(typeof p.horizon).toBe("number");
      expect(typeof p.nadir).toBe("number");
      expect(typeof p.sunColor).toBe("number");
      expect(typeof p.sunPos.x).toBe("number");
      expect(typeof p.sunPos.y).toBe("number");
      expect(typeof p.sunRadius).toBe("number");
      expect(typeof p.hazeLayers).toBe("number");
      expect(typeof p.defaultIntensity).toBe("number");
      expect(p.sunPos.y).toBeGreaterThanOrEqual(0);
      expect(p.sunPos.y).toBeLessThanOrEqual(1);
      expect(p.sunRadius).toBeGreaterThanOrEqual(0);
      expect(p.defaultIntensity).toBeGreaterThanOrEqual(0);
    }
  });

  it("ENV_PRESET_BY_MODEL 覆盖所有已知模型类型", () => {
    const expectedTypes = ["default", "ysm", "vrm", "mmd", "mmd-scene", "litematic", "resourcepack"];
    for (const t of expectedTypes) {
      expect(ENV_PRESET_BY_MODEL[t]).toBeDefined();
    }
  });

  it("DEFAULT_ENV_PARAMS 默认值完整", () => {
    expect(DEFAULT_ENV_PARAMS.enabled).toBe(true);
    expect(DEFAULT_ENV_PARAMS.preset).toBe("sky");
    expect(typeof DEFAULT_ENV_PARAMS.intensity).toBe("number");
    expect(DEFAULT_ENV_PARAMS.resolution).toBeGreaterThan(0);
    expect(DEFAULT_ENV_PARAMS.useAsBackground).toBe(false);
  });
});