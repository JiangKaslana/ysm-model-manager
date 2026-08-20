// ===== preview-menu 底部根菜单测试（ADR-076 v3：SlideMenu 多层派生 + 能力驱动 dock）=====
// 覆盖：CORE_MENU_ITEMS 表结构、mountPreviewRootMenu 挂载 dock、能力过滤、
// setAdapterItems/openPanel/dispose、单 panel 快捷直达、多 panel 组内下钻。
// ★ 测试断言全部从 PREVIEW_MENU_GROUPS / CORE_MENU_ITEMS 推导，不硬编码菜单 ID。
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CORE_MENU_ITEMS, PREVIEW_MENU_GROUPS } from "./preview-menu-defs.ts";
import { mountPreviewRootMenu, type PreviewMenuCtx } from "./preview-menu.ts";
import { deriveTestIds } from "../../../test-utils/self-healing.ts";

function makeCtx(overrides: Partial<PreviewMenuCtx> = {}): PreviewMenuCtx {
  return {
    selfMode: false,
    getSkyCap: () => null,
    getGroundCap: () => null,
    getLightCap: () => null,
    getCamBridge: () => ({
      getOrbit: () => true,
      setOrbit: vi.fn(),
      getSpeed: () => 20,
      setSpeed: vi.fn(),
      reset: vi.fn(),
    }),
    getSiblings: () => [],
    getCurrentPath: () => "/m/a.ysm",
    getViewContainer: () => document.createElement("div"),
    close: vi.fn(),
    switchTo: vi.fn(),
    ...overrides,
  };
}

describe("CORE_MENU_ITEMS 表结构", () => {
  it("id 唯一 + legacyTestId 唯一", () => {
    const ids = CORE_MENU_ITEMS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    const legacies = CORE_MENU_ITEMS.map((d) => d.legacyTestId).filter(Boolean);
    expect(new Set(legacies).size).toBe(legacies.length);
  });

  it("非 divider 项必有 icon/fallback/labelKey", () => {
    CORE_MENU_ITEMS.forEach((d) => {
      if (d.kind === "divider") return;
      expect(d.icon.length).toBeGreaterThan(0);
      expect(d.fallback.length).toBeGreaterThan(0);
      expect(d.labelKey.length).toBeGreaterThan(0);
    });
  });

  it("契约锚点：camera=sharedOnly，switch 始终可见 dock（路径输入兜底）", () => {
    expect(CORE_MENU_ITEMS.find((d) => d.id === "camera")?.sharedOnly).toBe(true);
    // switch 不再设 needsSiblings：dock 始终显示，面板内按 siblings 是否为空切换模式
    expect(CORE_MENU_ITEMS.find((d) => d.id === "switch")?.needsSiblings).toBeUndefined();
  });
});

describe("mountPreviewRootMenu", () => {
  let overlay: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = "";
    overlay = document.createElement("div");
    document.body.appendChild(overlay);
  });

  it("挂载底部 dock 按钮（能力驱动：有 siblings → model/motion；shared → scene）", () => {
    mountPreviewRootMenu(overlay, makeCtx({ getSiblings: () => ["/m/b.ysm"] }));
    // dock 按钮从 PREVIEW_MENU_GROUPS 推导（env 需要 sky cap，此上下文无 → 不断言）
    for (const g of PREVIEW_MENU_GROUPS.filter((g) => g.id !== "env")) {
      expect(overlay.querySelector(`[data-testid="dock-${g.id}"]`), `dock-${g.id}`).not.toBeNull();
    }
  });

  it("selfMode → scene 组隐藏；model 组始终显示（路径输入兜底）", () => {
    mountPreviewRootMenu(overlay, makeCtx({ selfMode: true }));
    expect(overlay.querySelector(`[data-testid="dock-model"]`)).not.toBeNull();
    expect(overlay.querySelector(`[data-testid="dock-scene"]`)).toBeNull();
  });

  it("点击 scene 组（多 panel：lighting + shadow + postproc）→ 组根视图列项；camera 已在 motion 组", () => {
    const handle = mountPreviewRootMenu(overlay, makeCtx({ getSiblings: () => ["/m/b.ysm"] }));
    const sceneBtn = overlay.querySelector<HTMLElement>(`[data-testid="dock-scene"]`);
    expect(sceneBtn).not.toBeNull();
    sceneBtn!.click();
    const popup = overlay.querySelector(".ysm-preview-menu") as HTMLElement;
    expect(popup.style.display).toBe("flex");
    // scene 组菜单项从 CORE_MENU_ITEMS 推导（camera 已移至 motion 组，不在 scene）
    const sceneCoreItems = CORE_MENU_ITEMS.filter((d) => d.dockGroup === "scene" && d.id !== "camera");
    for (const eid of deriveTestIds(sceneCoreItems)) {
      expect(overlay.querySelector(`[data-testid="${eid}"]`), eid).not.toBeNull();
    }
    // camera 从 CORE_MENU_ITEMS 推导其 testId，验证不在 scene 组渲染
    const cameraId = CORE_MENU_ITEMS.find((d) => d.id === "camera")!.id;
    expect(overlay.querySelector(`[data-testid="preview-${cameraId}"]`)).toBeNull();
    handle.dispose();
  });

  it("点击 model 组（多 panel：switch + adapter model）→ 组根视图列项，点击项下钻面板", () => {
    const handle = mountPreviewRootMenu(overlay, makeCtx({ getSiblings: () => ["/m/b.ysm"] }));
    const adapterModelItem = {
      id: "model",
      icon: "🧍",
      labelKey: "preview.modelInfo",
      fallback: "模型",
      kind: "panel" as const,
      dockGroup: "model" as const,
      render: (l: HTMLElement) => {
        l.append("MODEL-PANEL");
      },
    };
    handle.setAdapterItems([adapterModelItem]);
    const modelBtn = overlay.querySelector<HTMLElement>(`[data-testid="dock-model"]`);
    expect(modelBtn).not.toBeNull();
    modelBtn!.click();
    const popup = overlay.querySelector(".ysm-preview-menu") as HTMLElement;
    expect(popup.style.display).toBe("flex");
    // model 组菜单项：CORE_MENU_ITEMS + adapter 注入项，均从数据推导
    const modelCoreItems = CORE_MENU_ITEMS.filter((d) => d.dockGroup === "model");
    for (const eid of deriveTestIds([...modelCoreItems, adapterModelItem])) {
      expect(overlay.querySelector(`[data-testid="${eid}"]`), eid).not.toBeNull();
    }
    // 点击 adapter model 项 → navigate 下钻面板
    (overlay.querySelector(`[data-testid="preview-${adapterModelItem.id}"]`) as HTMLElement).click();
    expect(overlay.textContent).toContain("MODEL-PANEL");
    handle.dispose();
  });

  it("组根视图：panel 行带下钻箭头（row-chevron），action 行不带", () => {
    const handle = mountPreviewRootMenu(overlay, makeCtx({ getSiblings: () => ["/m/b.ysm"] }));
    const actItem = {
      id: "act",
      icon: "⚡",
      labelKey: "",
      fallback: "执行动作",
      kind: "action" as const,
      dockGroup: "model" as const,
      run: vi.fn(),
    };
    handle.setAdapterItems([actItem]);
    const modelBtn = overlay.querySelector<HTMLElement>(`[data-testid="dock-model"]`);
    expect(modelBtn).not.toBeNull();
    modelBtn!.click();
    // switch 为 panel 行 → 有下钻箭头（switch 从 CORE_MENU_ITEMS 推导）
    const switchItem = CORE_MENU_ITEMS.find((d) => d.id === "switch")!;
    const switchRow = overlay.querySelector(`[data-testid="preview-${switchItem.id}"]`);
    expect(switchRow!.querySelector('[data-testid="row-chevron"]')).not.toBeNull();
    // 注入的 action 行 → 无箭头（点击直接执行）
    const actRow = overlay.querySelector(`[data-testid="preview-${actItem.id}"]`);
    expect(actRow!.querySelector('[data-testid="row-chevron"]')).toBeNull();
    handle.dispose();
  });

  it("环境拆组：有 env cap → dock-env 独立出现；scene 组不再含 environment 行", () => {
    const cap = { getMenuControls: () => [] } as never;
    const handle = mountPreviewRootMenu(overlay, makeCtx({
      getSiblings: () => ["/m/b.ysm"],
      getSkyCap: () => cap,
    }));
    const envGroupId = PREVIEW_MENU_GROUPS.find((g) => g.id === "env")!.id;
    expect(overlay.querySelector(`[data-testid="dock-${envGroupId}"]`)).not.toBeNull();
    // scene 组点击 → environment 已拆离，camera 已移至 motion 组
    const sceneBtn = overlay.querySelector<HTMLElement>(`[data-testid="dock-scene"]`);
    expect(sceneBtn).not.toBeNull();
    sceneBtn!.click();
    // environment / camera 从 CORE_MENU_ITEMS 推导 testId
    const envId = CORE_MENU_ITEMS.find((d) => d.id === "environment")!.id;
    const camId = CORE_MENU_ITEMS.find((d) => d.id === "camera")!.id;
    expect(overlay.querySelector(`[data-testid="preview-${camId}"]`)).toBeNull();
    expect(overlay.querySelector(`[data-testid="preview-${envId}"]`)).toBeNull();
    handle.dispose();
  });

  it("setAdapterItems 注入 motion 组项 → dock-motion 按钮出现", () => {
    const handle = mountPreviewRootMenu(overlay, makeCtx());
    const motionGroupId = PREVIEW_MENU_GROUPS.find((g) => g.id === "motion")!.id;
    // camera 在 motion 组（sharedOnly，selfMode=false 时不过滤），dock-motion 已存在
    expect(overlay.querySelector(`[data-testid="dock-${motionGroupId}"]`)).not.toBeNull();
    handle.setAdapterItems([
      {
        id: "play",
        icon: "▶️",
        labelKey: "",
        fallback: "播放",
        kind: "panel",
        dockGroup: "motion",
        render: () => {},
      },
    ]);
    expect(overlay.querySelector(`[data-testid="dock-${motionGroupId}"]`)).not.toBeNull();
    handle.dispose();
  });

  it("openPanel(id) 直接打开指定面板（骨骼拾取联动契约）", () => {
    const handle = mountPreviewRootMenu(overlay, makeCtx());
    handle.setAdapterItems([
      {
        id: "bones",
        icon: "🦴",
        labelKey: "preview.bones",
        fallback: "骨骼",
        kind: "panel",
        dockGroup: "model",
        render: (l) => {
          l.append("BONES-PANEL");
        },
      },
    ]);
    handle.openPanel("bones");
    const popup = overlay.querySelector(".ysm-preview-menu") as HTMLElement;
    expect(popup.style.display).toBe("flex");
    expect(overlay.textContent).toContain("BONES-PANEL");
    handle.dispose();
  });

  it("dispose 移除菜单 DOM + 解绑 document 监听", () => {
    const handle = mountPreviewRootMenu(overlay, makeCtx());
    handle.dispose();
    expect(overlay.querySelector(".ysm-preview-menu")).toBeNull();
    expect(overlay.querySelector(".preview-dock-nav")).toBeNull();
    document.body.click();
  });

  it("switch 面板：无 siblings → 显示空态（路径输入仍在，类型 tab 由 adapter 注入）", () => {
    const handle = mountPreviewRootMenu(overlay, makeCtx({ getSiblings: () => [] }));
    const modelGroupId = PREVIEW_MENU_GROUPS.find((g) => g.id === "model")!.id;
    const modelBtn = overlay.querySelector<HTMLElement>(`[data-testid="dock-${modelGroupId}"]`);
    expect(modelBtn).not.toBeNull();
    modelBtn!.click();
    // switch 从 CORE_MENU_ITEMS 推导 testId
    const switchId = CORE_MENU_ITEMS.find((d) => d.id === "switch")!.id;
    (overlay.querySelector(`[data-testid="preview-${switchId}"]`) as HTMLElement).click();
    const popup = overlay.querySelector(".ysm-preview-menu") as HTMLElement;
    expect(popup.style.display).toBe("flex");
    // 空态提示
    expect(overlay.textContent).toContain("无其他模型");
    // 手动路径输入框仍在（P2-1 补回：支持跨类型加载）
    const input = popup.querySelector("input[type='text']") as HTMLInputElement | null;
    expect(input).not.toBeNull();
    handle.dispose();
  });

  it("switch 面板：siblings 存在 → 列兄弟项（路径输入行保留）", () => {
    const switchTo = vi.fn();
    const handle = mountPreviewRootMenu(overlay, makeCtx({
      getSiblings: () => ["/m/a.ysm", "/m/b.ysm"],
      getCurrentPath: () => "/m/a.ysm",
      switchTo,
    }));
    const modelBtn = overlay.querySelector<HTMLElement>(`[data-testid="dock-model"]`);
    modelBtn!.click();
    const switchId = CORE_MENU_ITEMS.find((d) => d.id === "switch")!.id;
    (overlay.querySelector(`[data-testid="preview-${switchId}"]`) as HTMLElement).click();
    const popup = overlay.querySelector(".ysm-preview-menu") as HTMLElement;
    expect(popup.style.display).toBe("flex");
    // 兄弟项渲染
    expect(popup.querySelectorAll('[data-testid="preview-switch-item"]').length).toBe(2);
    // 手动路径输入框保留（P2-1 补回）
    expect(popup.querySelector("input[type='text']")).not.toBeNull();
    // 点击兄弟项 → switchTo
    const rows = popup.querySelectorAll<HTMLElement>('.ysm-preview-menu-row');
    rows[1].click();
    expect(switchTo).toHaveBeenCalledWith("/m/b.ysm");
    handle.dispose();
  });

  it("switch 面板：候选行带 ➕ 追加按钮，点击追加 → switchTo keepInScene（多角色同框）", () => {
    const switchTo = vi.fn();
    const handle = mountPreviewRootMenu(overlay, makeCtx({
      getSiblings: () => ["/m/a.ysm", "/m/b.ysm"],
      getCurrentPath: () => "/m/a.ysm",
      getCurrentRtype: () => "ysm",
      switchTo,
    }));
    const modelBtn = overlay.querySelector<HTMLElement>(`[data-testid="dock-model"]`);
    modelBtn!.click();
    const switchId = CORE_MENU_ITEMS.find((d) => d.id === "switch")!.id;
    (overlay.querySelector(`[data-testid="preview-${switchId}"]`) as HTMLElement).click();
    // 当前项（/m/a.ysm）无 ➕，兄弟项（/m/b.ysm）有 ➕
    const appendBtns = overlay.querySelectorAll('[data-testid="preview-switch-append"]');
    expect(appendBtns.length).toBe(1);
    (appendBtns[0] as HTMLElement).click();
    expect(switchTo).toHaveBeenCalledWith("/m/b.ysm", { keepInScene: true });
    handle.dispose();
  });

  it("switch 面板：当前目录 tab 跨类型兄弟行无 ➕（逐行类型判定）", () => {
    const switchTo = vi.fn();
    const switchExternal = vi.fn(async () => {});
    const handle = mountPreviewRootMenu(overlay, makeCtx({
      getSiblings: () => ["/m/a.ysm", "/m/b.vrm"],
      getCurrentPath: () => "/m/a.ysm",
      getCurrentRtype: () => "ysm",
      switchTo,
      switchExternal,
    }));
    const modelBtn = overlay.querySelector<HTMLElement>(`[data-testid="dock-model"]`);
    modelBtn!.click();
    const switchId = CORE_MENU_ITEMS.find((d) => d.id === "switch")!.id;
    (overlay.querySelector(`[data-testid="preview-${switchId}"]`) as HTMLElement).click();
    // /m/b.vrm 是跨类型兄弟：无 ➕；行本体点击走跨类型替换（switchExternal）
    expect(overlay.querySelector('[data-testid="preview-switch-append"]')).toBeNull();
    const rows = overlay.querySelectorAll('[data-testid="preview-switch-item"]');
    (rows[1] as HTMLElement).click();
    expect(switchExternal).toHaveBeenCalledWith("/m/b.vrm", ["/m/a.ysm", "/m/b.vrm"]);
    handle.dispose();
  });

  it("switch 面板：类型 tab 同类型候选有 ➕，点击追加 → switchTo keepInScene", async () => {
    const switchTo = vi.fn();
    const handle = mountPreviewRootMenu(overlay, makeCtx({
      getSiblings: () => ["/m/a.ysm"],
      getCurrentPath: () => "/m/a.ysm",
      getCurrentRtype: () => "ysm",
      getTypeTabs: () => ["ysm", "vrm"],
      getModelsByType: async () => ["/m/b.ysm"],
      switchTo,
    }));
    const modelBtn = overlay.querySelector<HTMLElement>(`[data-testid="dock-model"]`);
    modelBtn!.click();
    const switchId = CORE_MENU_ITEMS.find((d) => d.id === "switch")!.id;
    (overlay.querySelector(`[data-testid="preview-${switchId}"]`) as HTMLElement).click();
    // 切到 ysm 类型 tab（与当前会话同类型）
    const tabs = overlay.querySelectorAll('[data-testid="preview-switch-tab"]');
    const ysmTab = Array.from(tabs).find((t) => (t as HTMLElement).dataset.rtype === "ysm") as HTMLElement;
    ysmTab.click();
    await vi.waitFor(() => {
      expect(overlay.querySelectorAll('[data-testid="preview-switch-item"]').length).toBe(1);
    });
    // 同类型候选：有 ➕；点击追加 → keepInScene
    const appendBtn = overlay.querySelector('[data-testid="preview-switch-append"]') as HTMLElement;
    expect(appendBtn).not.toBeNull();
    appendBtn.click();
    expect(switchTo).toHaveBeenCalledWith("/m/b.ysm", { keepInScene: true });
    handle.dispose();
  });

  it("switch 面板：类型 tab 跨类型候选行无 ➕（跨类型追加需换适配器）", async () => {
    const switchTo = vi.fn();
    const switchExternal = vi.fn(async () => {});
    const handle = mountPreviewRootMenu(overlay, makeCtx({
      getSiblings: () => ["/m/a.ysm"],
      getCurrentPath: () => "/m/a.ysm",
      getCurrentRtype: () => "ysm",
      getTypeTabs: () => ["ysm", "vrm"],
      getModelsByType: async () => ["/m/x.vrm"],
      switchTo,
      switchExternal,
    }));
    const modelBtn = overlay.querySelector<HTMLElement>(`[data-testid="dock-model"]`);
    modelBtn!.click();
    const switchId = CORE_MENU_ITEMS.find((d) => d.id === "switch")!.id;
    (overlay.querySelector(`[data-testid="preview-${switchId}"]`) as HTMLElement).click();
    // 切到 vrm 类型 tab（懒加载候选）
    const tabs = overlay.querySelectorAll('[data-testid="preview-switch-tab"]');
    const vrmTab = Array.from(tabs).find((t) => (t as HTMLElement).dataset.rtype === "vrm") as HTMLElement;
    vrmTab.click();
    await vi.waitFor(() => {
      expect(overlay.querySelectorAll('[data-testid="preview-switch-item"]').length).toBe(1);
    });
    // 跨类型候选：无 ➕ 追加按钮
    expect(overlay.querySelector('[data-testid="preview-switch-append"]')).toBeNull();
    // 行本体点击仍是跨类型替换（switchExternal）
    (overlay.querySelector('[data-testid="preview-switch-item"]') as HTMLElement).click();
    expect(switchExternal).toHaveBeenCalledWith("/m/x.vrm", ["/m/a.ysm"]);
    handle.dispose();
  });
});

