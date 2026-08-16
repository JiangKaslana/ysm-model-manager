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
    getCamBridge: () => ({
      getOrbit: () => true,
      setOrbit: vi.fn(),
      getSpeed: () => 20,
      setSpeed: vi.fn(),
      reset: vi.fn(),
    }),
    getSiblings: () => [],
    getCurrentPath: () => "/m/a.ysm",
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

  it("契约锚点：camera=sharedOnly，switch=needsSiblings", () => {
    expect(CORE_MENU_ITEMS.find((d) => d.id === "camera")?.sharedOnly).toBe(true);
    expect(CORE_MENU_ITEMS.find((d) => d.id === "switch")?.needsSiblings).toBe(true);
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

  it("无 siblings → model 组隐藏；selfMode → scene 组隐藏", () => {
    mountPreviewRootMenu(overlay, makeCtx({ selfMode: true }));
    expect(overlay.querySelector('[data-testid="dock-model"]')).toBeNull();
    expect(overlay.querySelector('[data-testid="dock-scene"]')).toBeNull();
  });

  it("点击 scene 组（单 panel camera）→ 快捷直达相机面板（select）", () => {
    const handle = mountPreviewRootMenu(overlay, makeCtx({ getSiblings: () => ["/m/b.ysm"] }));
    const sceneBtn = overlay.querySelector<HTMLElement>('[data-testid="dock-scene"]');
    expect(sceneBtn).not.toBeNull();
    sceneBtn!.click();
    const popup = overlay.querySelector(".ysm-preview-menu") as HTMLElement;
    expect(popup.style.display).toBe("flex");
    // 单 panel 直达：无 preview-camera 行，直接渲染相机面板 select
    expect(overlay.querySelector('[data-testid="preview-camera"]')).toBeNull();
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
});
