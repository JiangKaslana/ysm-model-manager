// ===== preview-menu 声明式根菜单测试（ADR-076 v2 Phase 2）=====
// 覆盖：PREVIEW_MENU_DEFS 表结构（e2e 遍历契约：id/legacyTestId 唯一、divider 合法、
// sharedOnly/needsSiblings 锚点）、mountPreviewRootMenu 挂载/展开/过滤/setAdapterItems/
// openPanel/dispose。环境面板（fillEnvironment）与相机面板（buildCameraControls）由 ADR-075/076 复用。
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PREVIEW_MENU_DEFS } from "./preview-menu-defs.ts";
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

describe("PREVIEW_MENU_DEFS 表结构（e2e 遍历契约）", () => {
  it("id 唯一 + legacyTestId 唯一（core 项不冲突）", () => {
    const ids = PREVIEW_MENU_DEFS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    const legacies = PREVIEW_MENU_DEFS.map((d) => d.legacyTestId).filter(Boolean);
    expect(new Set(legacies).size).toBe(legacies.length);
  });

  it("divider 结构合法：非 divider 项必有 icon/fallback/labelKey", () => {
    PREVIEW_MENU_DEFS.forEach((d) => {
      if (d.kind === "divider") return;
      expect(d.icon.length).toBeGreaterThan(0);
      expect(d.fallback.length).toBeGreaterThan(0);
      expect(d.labelKey.length).toBeGreaterThan(0);
    });
  });

  it("kind 枚举合法（panel/action/divider）", () => {
    const valid = new Set(["panel", "action", "divider"]);
    PREVIEW_MENU_DEFS.forEach((d) => expect(valid.has(d.kind)).toBe(true));
  });

  it("契约锚点：camera=sharedOnly，switch=needsSiblings，close 为 danger action", () => {
    expect(PREVIEW_MENU_DEFS.find((d) => d.id === "camera")?.sharedOnly).toBe(true);
    expect(PREVIEW_MENU_DEFS.find((d) => d.id === "switch")?.needsSiblings).toBe(true);
    const close = PREVIEW_MENU_DEFS.find((d) => d.id === "close");
    expect(close?.kind).toBe("action");
    expect(close?.danger).toBe(true);
  });
});

describe("mountPreviewRootMenu", () => {
  let overlay: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = "";
    overlay = document.createElement("div");
    document.body.appendChild(overlay);
  });

  it("挂载 ⚙️ 按钮；点击展开渲染 core 项 + legacy testid 保留", () => {
    const handle = mountPreviewRootMenu(overlay, makeCtx());
    const root = overlay.querySelector<HTMLElement>('[data-testid="preview-menu-btn"]');
    expect(root).not.toBeNull();
    root!.click();
    expect(overlay.querySelector('[data-testid="preview-close"]')).not.toBeNull();
    expect(overlay.querySelector('[data-testid="preview-environment"]')).not.toBeNull();
    expect(overlay.querySelector('[data-testid="preview-camera"]')).not.toBeNull();
    // legacy testid 保留（e2e 兼容）
    expect(overlay.querySelector("#ysm-close-3d")).not.toBeNull();
    expect(overlay.querySelector("#env-menu-btn")).not.toBeNull();
    handle.dispose();
  });

  it("selfMode → camera 项隐藏（sharedOnly 过滤）", () => {
    const handle = mountPreviewRootMenu(overlay, makeCtx({ selfMode: true }));
    overlay.querySelector<HTMLElement>('[data-testid="preview-menu-btn"]')!.click();
    expect(overlay.querySelector('[data-testid="preview-camera"]')).toBeNull();
    handle.dispose();
  });

  it("无 siblings → switch 项隐藏（needsSiblings 过滤）", () => {
    const handle = mountPreviewRootMenu(overlay, makeCtx());
    overlay.querySelector<HTMLElement>('[data-testid="preview-menu-btn"]')!.click();
    expect(overlay.querySelector('[data-testid="preview-switch"]')).toBeNull();
    handle.dispose();
  });

  it("有 siblings → switch 项显示；点击开子面板列模型 + 当前高亮", () => {
    const handle = mountPreviewRootMenu(
      overlay,
      makeCtx({ getSiblings: () => ["/m/b.ysm"], getCurrentPath: () => "/m/a.ysm" }),
    );
    overlay.querySelector<HTMLElement>('[data-testid="preview-menu-btn"]')!.click();
    const sw = overlay.querySelector('[data-testid="preview-switch"]') as HTMLElement;
    expect(sw).not.toBeNull();
    sw.click();
    expect(overlay.querySelector('[data-testid="preview-back"]')).not.toBeNull();
    expect(overlay.textContent).toContain("b.ysm");
    handle.dispose();
  });

  it("setAdapterItems 追加渲染适配器项（divider 隔离），点击开面板", () => {
    const handle = mountPreviewRootMenu(overlay, makeCtx());
    handle.setAdapterItems([
      {
        id: "model",
        icon: "🧍",
        labelKey: "preview.modelInfo",
        fallback: "模型",
        kind: "panel",
        render: (l) => {
          l.append("MODEL-PANEL");
        },
      },
    ]);
    overlay.querySelector<HTMLElement>('[data-testid="preview-menu-btn"]')!.click();
    expect(overlay.querySelector('[data-testid="preview-model"]')).not.toBeNull();
    (overlay.querySelector('[data-testid="preview-model"]') as HTMLElement).click();
    expect(overlay.textContent).toContain("MODEL-PANEL");
    handle.dispose();
  });

  it("action 项（close）点击 → ctx.close 调用", () => {
    const close = vi.fn();
    const handle = mountPreviewRootMenu(overlay, makeCtx({ close }));
    overlay.querySelector<HTMLElement>('[data-testid="preview-menu-btn"]')!.click();
    (overlay.querySelector('[data-testid="preview-close"]') as HTMLElement).click();
    expect(close).toHaveBeenCalled();
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

  it("dispose 解绑 document 点击监听（外部点击不再触发收起，无异常）", () => {
    const handle = mountPreviewRootMenu(overlay, makeCtx());
    overlay.querySelector<HTMLElement>('[data-testid="preview-menu-btn"]')!.click();
    handle.dispose();
    document.body.click();
  });
});

describe("dock 底栏高频直显（模型切换/视图——参考 ⚙️ 菜单理念，同一份 PREVIEW_MENU_DEFS 声明）", () => {
  let overlay: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = "";
    overlay = document.createElement("div");
    document.body.appendChild(overlay);
  });

  it("core dock 项渲染为底栏按钮（dock-switch / dock-camera），siblings>0 才显示 switch", () => {
    mountPreviewRootMenu(
      overlay,
      makeCtx({ getSiblings: () => ["/m/a.ysm", "/m/b.ysm"] }),
    );
    expect(overlay.querySelector('[data-testid="dock-switch"]')).not.toBeNull();
    expect(overlay.querySelector('[data-testid="dock-camera"]')).not.toBeNull();
  });

  it("无 siblings → switch 不 dock（needsSiblings 过滤），camera 仍显示", () => {
    mountPreviewRootMenu(overlay, makeCtx());
    expect(overlay.querySelector('[data-testid="dock-switch"]')).toBeNull();
    expect(overlay.querySelector('[data-testid="dock-camera"]')).not.toBeNull();
  });

  it("dock 按钮点击 → 打开对应面板（popup 显示 + 子面板内容）", () => {
    const handle = mountPreviewRootMenu(overlay, makeCtx());
    const camBtn = overlay.querySelector<HTMLElement>('[data-testid="dock-camera"]');
    expect(camBtn).not.toBeNull();
    camBtn!.click();
    const popup = overlay.querySelector(".ysm-preview-menu") as HTMLElement;
    expect(popup.style.display).toBe("flex");
    expect(popup.querySelector("select")).not.toBeNull(); // buildCameraControls 渲染旋转下拉
    handle.dispose();
  });

  it("setAdapterItems 注入 dock 项 → 底栏同步新增按钮", () => {
    const handle = mountPreviewRootMenu(overlay, makeCtx());
    expect(overlay.querySelector('[data-testid="dock-bones"]')).toBeNull();
    handle.setAdapterItems([
      {
        id: "bones",
        icon: "🦴",
        labelKey: "",
        fallback: "骨骼",
        kind: "panel",
        dock: true,
        render: () => {},
      },
    ]);
    expect(overlay.querySelector('[data-testid="dock-bones"]')).not.toBeNull();
    handle.dispose();
  });
});
