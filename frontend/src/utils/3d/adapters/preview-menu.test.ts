// ===== preview-menu 底部根菜单测试（ADR-076 v3：SlideMenu 多层派生 + 能力驱动 dock）=====
// 覆盖：CORE_MENU_ITEMS 表结构、mountPreviewRootMenu 挂载 dock、能力过滤、
// setAdapterItems/openPanel/dispose、单 panel 快捷直达、多 panel 组内下钻。
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CORE_MENU_ITEMS } from "./preview-menu-defs.ts";
import { mountPreviewRootMenu, type PreviewMenuCtx } from "./preview-menu.ts";

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

  it("挂载底部 dock 按钮（能力驱动：有 siblings → model；shared → scene）", () => {
    mountPreviewRootMenu(overlay, makeCtx({ getSiblings: () => ["/m/b.ysm"] }));
    expect(overlay.querySelector('[data-testid="dock-model"]')).not.toBeNull();
    expect(overlay.querySelector('[data-testid="dock-scene"]')).not.toBeNull();
    expect(overlay.querySelector('[data-testid="dock-motion"]')).toBeNull();
  });

  it("selfMode → scene 组隐藏；model 组始终显示（路径输入兜底）", () => {
    mountPreviewRootMenu(overlay, makeCtx({ selfMode: true }));
    expect(overlay.querySelector('[data-testid="dock-model"]')).not.toBeNull();
    expect(overlay.querySelector('[data-testid="dock-scene"]')).toBeNull();
  });

  it("点击 scene 组（多 panel：camera + lighting）→ 组根视图列项，点击 camera 下钻出现 select", () => {
    const handle = mountPreviewRootMenu(overlay, makeCtx({ getSiblings: () => ["/m/b.ysm"] }));
    const sceneBtn = overlay.querySelector<HTMLElement>('[data-testid="dock-scene"]');
    expect(sceneBtn).not.toBeNull();
    sceneBtn!.click();
    const popup = overlay.querySelector(".ysm-preview-menu") as HTMLElement;
    expect(popup.style.display).toBe("flex");
    // 多 panel：进入组根视图，camera + lighting + environment 三行均出现
    expect(overlay.querySelector('[data-testid="preview-camera"]')).not.toBeNull();
    expect(overlay.querySelector('[data-testid="preview-lighting"]')).not.toBeNull();
    // 点击 camera 下钻：出现 select 控件
    (overlay.querySelector('[data-testid="preview-camera"]') as HTMLElement).click();
    expect(popup.querySelector("select")).not.toBeNull();
    handle.dispose();
  });

  it("点击 model 组（多 panel：switch + adapter model）→ 组根视图列项，点击项下钻面板", () => {
    const handle = mountPreviewRootMenu(overlay, makeCtx({ getSiblings: () => ["/m/b.ysm"] }));
    handle.setAdapterItems([
      {
        id: "model",
        icon: "🧍",
        labelKey: "preview.modelInfo",
        fallback: "模型",
        kind: "panel",
        dockGroup: "model",
        render: (l) => {
          l.append("MODEL-PANEL");
        },
      },
    ]);
    const modelBtn = overlay.querySelector<HTMLElement>('[data-testid="dock-model"]');
    expect(modelBtn).not.toBeNull();
    modelBtn!.click();
    const popup = overlay.querySelector(".ysm-preview-menu") as HTMLElement;
    expect(popup.style.display).toBe("flex");
    // 组根视图：switch + model 行都在
    expect(overlay.querySelector('[data-testid="preview-switch"]')).not.toBeNull();
    expect(overlay.querySelector('[data-testid="preview-model"]')).not.toBeNull();
    // 点击 model 项 → navigate 下钻面板
    (overlay.querySelector('[data-testid="preview-model"]') as HTMLElement).click();
    expect(overlay.textContent).toContain("MODEL-PANEL");
    handle.dispose();
  });

  it("setAdapterItems 注入 motion 组项 → dock-motion 按钮出现", () => {
    const handle = mountPreviewRootMenu(overlay, makeCtx());
    expect(overlay.querySelector('[data-testid="dock-motion"]')).toBeNull();
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
    expect(overlay.querySelector('[data-testid="dock-motion"]')).not.toBeNull();
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

  it("switch 面板：无 siblings → 显示空态 + 路径输入框（跨类型加载入口）", () => {
    const handle = mountPreviewRootMenu(overlay, makeCtx({ getSiblings: () => [] }));
    const modelBtn = overlay.querySelector<HTMLElement>('[data-testid="dock-model"]');
    expect(modelBtn).not.toBeNull();
    modelBtn!.click();
    const popup = overlay.querySelector(".ysm-preview-menu") as HTMLElement;
    expect(popup.style.display).toBe("flex");
    // 空态提示
    expect(overlay.textContent).toContain("无其他模型");
    // 路径输入行存在（input + 按钮）
    const input = popup.querySelector("input[type='text']") as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(input?.placeholder.length).toBeGreaterThan(0);
    const loadBtn = popup.querySelector(".ysm-btn") as HTMLElement | null;
    expect(loadBtn).not.toBeNull();
    handle.dispose();
  });

  it("switch 面板：siblings 存在 → 列兄弟项 + 路径输入行（分隔线以下）", () => {
    const switchTo = vi.fn();
    const handle = mountPreviewRootMenu(overlay, makeCtx({
      getSiblings: () => ["/m/a.ysm", "/m/b.ysm"],
      getCurrentPath: () => "/m/a.ysm",
      switchTo,
    }));
    const modelBtn = overlay.querySelector<HTMLElement>('[data-testid="dock-model"]');
    modelBtn!.click();
    const popup = overlay.querySelector(".ysm-preview-menu") as HTMLElement;
    expect(popup.style.display).toBe("flex");
    // 兄弟项渲染
    expect(popup.querySelectorAll('[data-testid="preview-switch-item"]').length).toBe(2);
    // 分隔线 + 输入行在兄弟项之后
    const rows = popup.querySelectorAll<HTMLElement>('.ysm-preview-menu-row');
    expect(rows.length).toBe(2);
    // 输入框在 rows 之后
    const input = popup.querySelector("input[type='text']") as HTMLInputElement | null;
    expect(input).not.toBeNull();
    // 点击兄弟项 → switchTo
    rows[1].click();
    expect(switchTo).toHaveBeenCalledWith("/m/b.ysm");
    handle.dispose();
  });

  it("switch 面板：路径输入 Enter → 调 switchExternal（跨类型）", async () => {
    const switchExt = vi.fn().mockResolvedValue(undefined);
    const handle = mountPreviewRootMenu(overlay, makeCtx({
      getSiblings: () => [],
      switchExternal: switchExt,
    }));
    const modelBtn = overlay.querySelector<HTMLElement>('[data-testid="dock-model"]');
    modelBtn!.click();
    const popup = overlay.querySelector(".ysm-preview-menu") as HTMLElement;
    const input = popup!.querySelector("input[type='text']") as HTMLInputElement;
    input.value = "/repo/model.vrm";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await new Promise((r) => setTimeout(r, 10));
    expect(switchExt).toHaveBeenCalledWith("/repo/model.vrm");
    handle.dispose();
  });

  it("switch 面板：无 switchExternal → 降级 switchTo", async () => {
    const switchTo = vi.fn();
    const handle = mountPreviewRootMenu(overlay, makeCtx({
      getSiblings: () => [],
      switchTo,
    }));
    const modelBtn = overlay.querySelector<HTMLElement>('[data-testid="dock-model"]');
    modelBtn!.click();
    const popup = overlay.querySelector(".ysm-preview-menu") as HTMLElement;
    const input = popup!.querySelector("input[type='text']") as HTMLInputElement;
    input.value = "/repo/model.ysm";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await new Promise((r) => setTimeout(r, 10));
    expect(switchTo).toHaveBeenCalledWith("/repo/model.ysm");
    handle.dispose();
  });
});

