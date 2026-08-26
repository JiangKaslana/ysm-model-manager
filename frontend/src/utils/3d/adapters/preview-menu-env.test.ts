// ===== 环境菜单声明式 Schema 测试（对齐 MikuMikuAR getSkySchema() 范式）=====
import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildEnvSchema, renderEnvLevel } from "./preview-menu-env.ts";
import { sceneCapabilityRegistry } from "../caps/scene-capability-registry.ts";
import type { PreviewMenuCtx } from "./preview-menu.ts";
import type { SlideMenuHandle } from "../../../ui/ui-slide-menu.ts";

/** 构造最小 PreviewMenuCtx（测试用） */
function makeCtx(overrides: Partial<PreviewMenuCtx> = {}): PreviewMenuCtx {
  return {
    selfMode: false,
    getCap: () => null,
    getCamBridge: () => ({ mode: "orbit" as const, setMode: vi.fn(), reset: vi.fn() }) as never,
    getSiblings: () => [],
    getCurrentPath: () => "",
    getViewContainer: () => document.createElement("div"),
    close: vi.fn(),
    ...overrides,
  } as PreviewMenuCtx;
}

/** 构造 fake SlideMenuHandle */
function makeMenu(): SlideMenuHandle {
  const views: Array<{ title: string; render: (list: HTMLElement) => void }> = [];
  return {
    root: document.createElement("div"),
    list: document.createElement("div"),
    setTitle: vi.fn(),
    setOnClose: vi.fn(),
    home: vi.fn(),
    navigate: vi.fn((v) => views.push(v)),
    back: vi.fn(),
    refresh: vi.fn(),
    isShowing: vi.fn(),
    reset: vi.fn(),
    isAtRoot: () => true,
    dispose: vi.fn(),
  } as unknown as SlideMenuHandle;
}

describe("buildEnvSchema", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("无 cap 时返回空态节点", () => {
    const schema = buildEnvSchema(makeCtx());
    expect(schema.length).toBe(1);
    expect(schema[0].id).toBe("env-empty");
    expect(schema[0].kind).toBe("custom");
  });

  it("有 sky cap 时返回预设栏 + sky 摘要节点", () => {
    vi.spyOn(sceneCapabilityRegistry, "getAll").mockReturnValue([]);
    const fakeSkyCap = {
      id: "sky",
      labelKey: "preview.sky",
      icon: "🌤️",
      descKey: "",
      getMenuControls: () => [
        { id: "sky-time", kind: "slider", labelKey: "preview.timeOfDay", fallback: "时间", getValue: () => 12, setValue: () => {}, slider: { min: 0, max: 24, step: 0.25, unit: "h" } },
        { id: "sky-cloud", kind: "slider", labelKey: "preview.cloudCoverage", fallback: "云量", getValue: () => 0, setValue: () => {}, slider: { min: 0, max: 1, step: 0.01 } },
      ],
      apply: vi.fn(),
      dispose: vi.fn(),
      setEnabled: vi.fn(),
      isEnabled: () => true,
      saveState: vi.fn(),
      loadState: vi.fn(),
    };
    const ctx = makeCtx({ getCap: (id) => (id === "sky" ? (fakeSkyCap as never) : null) });
    const schema = buildEnvSchema(ctx);
    expect(schema.length).toBeGreaterThanOrEqual(2);
    expect(schema[0].id).toBe("env-presets");
    const skyNode = schema.find((n) => n.id === "env:sky");
    expect(skyNode).toBeDefined();
    expect(skyNode!.kind).toBe("custom");
    expect(skyNode!.icon).toBe("🌤️");
  });
});

describe("renderEnvLevel", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    
  });

  it("无 menu 句柄时走平铺路径（renderCapControls）", () => {
    vi.spyOn(sceneCapabilityRegistry, "getAll").mockReturnValue([]);
    const fakeSkyCap = {
      id: "sky",
      labelKey: "preview.sky",
      icon: "🌤️",
      descKey: "",
      getMenuControls: () => [
        { id: "sky-toggle", kind: "toggle", labelKey: "preview.skyEnabled", fallback: "天空", getValue: () => true, setValue: () => {} },
      ],
      apply: vi.fn(), dispose: vi.fn(), setEnabled: vi.fn(), isEnabled: () => true, saveState: vi.fn(), loadState: vi.fn(),
    };
    const ctx = makeCtx({ getCap: (id) => (id === "sky" ? (fakeSkyCap as never) : null) });
    const list = document.createElement("div");
    renderEnvLevel(list, ctx, undefined);
    // 平铺路径：应有 cap-sky-toggle 控件行
    expect(list.querySelector('[data-testid="cap-sky-toggle"]')).not.toBeNull();
  });

  it("有 menu 句柄时渲染预设栏 + cap 摘要行", () => {
    const fakeSkyCap = {
      id: "sky",
      labelKey: "preview.sky",
      icon: "🌤️",
      descKey: "",
      getMenuControls: () => [
        { id: "sky-time", kind: "slider", labelKey: "preview.timeOfDay", fallback: "时间", getValue: () => 12, setValue: () => {}, slider: { min: 0, max: 24, step: 0.25, unit: "h" } },
      ],
      apply: vi.fn(), dispose: vi.fn(), setEnabled: vi.fn(), isEnabled: () => true, saveState: vi.fn(), loadState: vi.fn(),
    };
    const ctx = makeCtx({ getCap: (id) => (id === "sky" ? (fakeSkyCap as never) : null) });
    const menu = makeMenu();
    const list = document.createElement("div");
    renderEnvLevel(list, ctx, menu);

    // 预设按钮存在
    expect(list.querySelector('[data-testid="env-preset-studio"]')).not.toBeNull();
    expect(list.querySelector('[data-testid="env-preset-sunset"]')).not.toBeNull();
    // cap 摘要行存在
    expect(list.querySelector('[data-testid="cap-row-sky"]')).not.toBeNull();
  });

  it("cap 摘要行有 › 时点击触发 menu.navigate", () => {
    vi.spyOn(sceneCapabilityRegistry, "getAll").mockReturnValue([]);
    const fakeSkyCap = {
      id: "sky",
      labelKey: "preview.sky",
      icon: "🌤️",
      descKey: "",
      getMenuControls: () => [
        { id: "sky-toggle", kind: "toggle", labelKey: "preview.skyEnabled", fallback: "天空", getValue: () => true, setValue: () => {} },
        { id: "sky-time", kind: "slider", labelKey: "preview.timeOfDay", fallback: "时间", getValue: () => 12, setValue: () => {}, slider: { min: 0, max: 24, step: 0.25, unit: "h" } },
      ],
      apply: vi.fn(), dispose: vi.fn(), setEnabled: vi.fn(), isEnabled: () => true, saveState: vi.fn(), loadState: vi.fn(),
    };
    const ctx = makeCtx({ getCap: (id) => (id === "sky" ? (fakeSkyCap as never) : null) });
    const menu = makeMenu();
    const list = document.createElement("div");
    renderEnvLevel(list, ctx, menu);

    const row = list.querySelector('[data-testid="cap-row-sky"]') as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.style.cursor).toBe("pointer");
    expect(row.querySelector('[data-testid="row-chevron"]')).not.toBeNull();
    row.click();
    expect(menu.navigate).toHaveBeenCalled();
  });

  it("预设按钮点击调用 applyPreset（通过 menu.refresh）", () => {
    vi.spyOn(sceneCapabilityRegistry, "getAll").mockReturnValue([]);
    const fakeSkyCap = {
      id: "sky",
      labelKey: "preview.sky",
      icon: "🌤️",
      descKey: "",
      getMenuControls: () => [],
      apply: vi.fn(), dispose: vi.fn(), setEnabled: vi.fn(), isEnabled: () => true, saveState: vi.fn(), loadState: vi.fn(),
    };
    const ctx = makeCtx({ getCap: (id) => (id === "sky" ? (fakeSkyCap as never) : null) });
    const menu = makeMenu();
    const list = document.createElement("div");
    renderEnvLevel(list, ctx, menu);

    const btn = list.querySelector('[data-testid="env-preset-studio"]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    btn!.click();
    expect(menu.refresh).toHaveBeenCalled();
  });
});
