// ===== 角色面板测试（MikuMikuAR buildModelRootItems 移植：多角色加载与设置）=====
// 覆盖：roles 项声明、角色列表渲染（焦点标记）、行首 radio 焦点切换、
// 点击角色名进详情（按该角色 menuItems 能力显示，vrm/mmd 内容各异）、
// ⚙ 工具含卸载角色、空态与加载入口共存。
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as THREE from "three";
import { CORE_MENU_ITEMS, type PreviewMenuItemDef } from "./preview-menu-defs.ts";
import { mountPreviewRootMenu, type PreviewMenuCtx } from "./preview-menu.ts";
import { sceneRegistry } from "./scene-registry.ts";

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
    unloadRole: vi.fn(),
    ...overrides,
  };
}

/** 注册一个测试角色（真实 SceneRegistry 单例，测试间 reset） */
function regRole(path: string, menuItems: PreviewMenuItemDef[] | null = null): string {
  return sceneRegistry.register({
    path,
    rtype: "test",
    roots: [new THREE.Object3D()],
    built: { dispose: vi.fn() } as never,
    boneMaps: null,
    menuItems,
    onBonePick: null,
  });
}

describe("CORE_MENU_ITEMS roles 项", () => {
  it("roles 项声明在 model 组（panel + icon/fallback/labelKey 齐全）", () => {
    const def = CORE_MENU_ITEMS.find((d) => d.id === "roles");
    expect(def).toBeDefined();
    expect(def!.kind).toBe("panel");
    expect(def!.dockGroup).toBe("model");
    expect(def!.icon.length).toBeGreaterThan(0);
    expect(def!.fallback.length).toBeGreaterThan(0);
  });
});

describe("角色面板（roles）", () => {
  let overlay: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = "";
    sceneRegistry.reset();
    overlay = document.createElement("div");
    document.body.appendChild(overlay);
  });

  it("模型组仅 roles 单 panel → dock-model 快捷直达角色面板（不渲染组根行）", () => {
    const handle = mountPreviewRootMenu(overlay, makeCtx({ getSiblings: () => ["/m/b.ysm"] }));
    (overlay.querySelector('[data-testid="dock-model"]') as HTMLElement).click();
    expect(overlay.querySelector('[data-testid="preview-roles-list"]')).not.toBeNull();
    handle.dispose();
  });

  it("注册 2 角色 → 面板列出 2 行，焦点行 radio 为 ● 且行高亮", () => {
    const a = regRole("/m/a.ysm");
    const b = regRole("/m/b.ysm"); // b 为 active（register 即置活跃）
    const handle = mountPreviewRootMenu(overlay, makeCtx());
    (overlay.querySelector('[data-testid="dock-model"]') as HTMLElement).click();
    const rows = overlay.querySelectorAll('[data-testid="preview-role-row"]');
    expect(rows.length).toBe(2);
    const aRow = overlay.querySelector(`[data-testid="preview-role-row"][data-role-id="${a}"]`);
    const bRow = overlay.querySelector(`[data-testid="preview-role-row"][data-role-id="${b}"]`);
    expect(aRow).not.toBeNull();
    expect(bRow).not.toBeNull();
    expect((aRow!.querySelector('[data-testid="preview-role-focus"]') as HTMLElement).textContent).toBe("○");
    expect((bRow!.querySelector('[data-testid="preview-role-focus"]') as HTMLElement).textContent).toBe("●");
    // jsdom 会把 style.cssText 规范化（rgba 内加空格），断言前缀即可
    expect(bRow!.getAttribute("style")).toContain("rgba(124");
    handle.dispose();
  });

  it("点击行首 radio → 焦点切换到该角色（getActiveId 更新 + 行重渲染）", () => {
    const a = regRole("/m/a.ysm");
    regRole("/m/b.ysm");
    expect(sceneRegistry.getActiveId()).not.toBe(a);
    const handle = mountPreviewRootMenu(overlay, makeCtx());
    (overlay.querySelector('[data-testid="dock-model"]') as HTMLElement).click();
    const aRow = overlay.querySelector(`[data-testid="preview-role-row"][data-role-id="${a}"]`);
    (aRow!.querySelector('[data-testid="preview-role-focus"]') as HTMLElement).click();
    expect(sceneRegistry.getActiveId()).toBe(a);
    const aRow2 = overlay.querySelector(`[data-testid="preview-role-row"][data-role-id="${a}"]`);
    expect((aRow2!.querySelector('[data-testid="preview-role-focus"]') as HTMLElement).textContent).toBe("●");
    handle.dispose();
  });

  it("radio 切到无 menuItems 角色 → 显式清空 dock 适配器项（P2：不残留上一角色菜单）", () => {
    const a = regRole("/m/a.ysm"); // 无 menuItems
    regRole("/m/b.ysm"); // 无 menuItems（active）
    const handle = mountPreviewRootMenu(overlay, makeCtx());
    const spy = vi.spyOn(handle, "setAdapterItems");
    (overlay.querySelector('[data-testid="dock-model"]') as HTMLElement).click();
    const aRow = overlay.querySelector(`[data-testid="preview-role-row"][data-role-id="${a}"]`);
    (aRow!.querySelector('[data-testid="preview-role-focus"]') as HTMLElement).click();
    // setActive 对 menuItems 空角色不换菜单——fillRoles 显式清空 dock 项
    expect(spy).toHaveBeenCalledWith([]);
    handle.dispose();
  });

  it("dock-model 直达活跃角色详情（1 跳）；详情「切换角色 ›」回列表后点角色名仍进详情", () => {
    const matPanel: PreviewMenuItemDef = {
      id: "material",
      icon: "🎨",
      labelKey: "preview.material",
      fallback: "材质",
      kind: "panel",
      dockGroup: "model",
      render: (l) => {
        l.append("MAT-PANEL");
      },
    };
    regRole("/m/a.ysm", [matPanel]);
    const handle = mountPreviewRootMenu(overlay, makeCtx());
    // 1) dock 🧍 捷径：活跃角色有其 menuItems → 直达其详情，模型面板项直接可见（1 跳模型信息）
    (overlay.querySelector('[data-testid="dock-model"]') as HTMLElement).click();
    const matRow = overlay.querySelector('[data-testid="preview-material"]');
    expect(matRow).not.toBeNull();
    // 2) 详情顶部「切换角色 ›」→ 回角色列表（多角色同框仍可达）
    (overlay.querySelector('[data-testid="preview-role-switch"]') as HTMLElement).click();
    const aRow = overlay.querySelector(`[data-testid="preview-role-row"][data-role-id="m1"]`);
    expect(aRow).not.toBeNull();
    // 3) 点角色名 → 仍进详情，点击项渲染其面板
    (aRow!.querySelector('[data-testid="preview-role-name"]') as HTMLElement).click();
    const matRow2 = overlay.querySelector('[data-testid="preview-material"]');
    expect(matRow2).not.toBeNull();
    (matRow2 as HTMLElement).click();
    expect(overlay.textContent).toContain("MAT-PANEL");
    handle.dispose();
  });

  it("点击 ⚙ → 工具子面板含卸载角色；点击卸载 → ctx.unloadRole 收到该角色 id", () => {
    const unloadRole = vi.fn();
    regRole("/m/a.ysm");
    const handle = mountPreviewRootMenu(overlay, makeCtx({ unloadRole }));
    (overlay.querySelector('[data-testid="dock-model"]') as HTMLElement).click();
    const aRow = overlay.querySelector(`[data-testid="preview-role-row"][data-role-id="m1"]`);
    (aRow!.querySelector('[data-testid="preview-role-tools"]') as HTMLElement).click();
    const unload = overlay.querySelector('[data-testid="preview-role-unload"]');
    expect(unload).not.toBeNull();
    (unload as HTMLElement).click();
    expect(unloadRole).toHaveBeenCalledWith("m1");
    handle.dispose();
  });

  it("无已加载角色 → 空态提示", () => {
    const handle = mountPreviewRootMenu(overlay, makeCtx({ getSiblings: () => ["/m/b.ysm"] }));
    (overlay.querySelector('[data-testid="dock-model"]') as HTMLElement).click();
    expect(overlay.querySelector('[data-testid="preview-roles-empty"]')).not.toBeNull();
    handle.dispose();
  });

  it("dock 🧍 → 详情拆分模型/动作两 section，初始展开模型、折叠动作；点动作 header 可展开", () => {
    const defs = (): PreviewMenuItemDef[] => [
      { id: "material", icon: "🎨", labelKey: "", fallback: "材质", kind: "panel", dockGroup: "model", render: () => {} },
      { id: "play", icon: "▶️", labelKey: "", fallback: "播放", kind: "panel", dockGroup: "motion", render: () => {} },
    ];
    regRole("/m/a.jsm", defs());
    const handle = mountPreviewRootMenu(overlay, makeCtx());
    // 🧍 初始聚焦模型 section：model 展开、motion 折叠
    (overlay.querySelector('[data-testid="dock-model"]') as HTMLElement).click();
    expect((overlay.querySelector('[data-testid="preview-role-model-body"]') as HTMLElement).style.display).toBe("block");
    expect((overlay.querySelector('[data-testid="preview-role-motion-body"]') as HTMLElement).style.display).toBe("none");
    // 点动作 section header → 展开（保持模型 section 状态）
    (overlay.querySelector('[data-testid="preview-role-motion"] .cap-section-header') as HTMLElement).click();
    expect((overlay.querySelector('[data-testid="preview-role-motion-body"]') as HTMLElement).style.display).toBe("block");
    handle.dispose();
  });

  it("dock 💃 → 详情初始聚焦动作 section（play 行直达可见）；再点模型 section header 切换", () => {
    const defs = (): PreviewMenuItemDef[] => [
      { id: "material", icon: "🎨", labelKey: "", fallback: "材质", kind: "panel", dockGroup: "model", render: () => {} },
      { id: "play", icon: "▶️", labelKey: "", fallback: "播放", kind: "panel", dockGroup: "motion", render: () => {} },
    ];
    regRole("/m/a.jsm", defs());
    const handle = mountPreviewRootMenu(overlay, makeCtx());
    // mountPreviewRootMenu 不自动注入适配器项 → 先注入 motion 组项使 dock-motion 出现
    handle.setAdapterItems([
      { id: "dockPlay", icon: "▶️", labelKey: "", fallback: "播放", kind: "panel", dockGroup: "motion", render: () => {} },
    ]);
    // 💃 初始聚焦动作 section：motion 展开、model 折叠，且 play 行（motion 面板项）可见
    (overlay.querySelector('[data-testid="dock-motion"]') as HTMLElement).click();
    expect((overlay.querySelector('[data-testid="preview-role-motion-body"]') as HTMLElement).style.display).toBe("block");
    expect((overlay.querySelector('[data-testid="preview-role-model-body"]') as HTMLElement).style.display).toBe("none");
    expect(overlay.querySelector('[data-testid="preview-play"]')).not.toBeNull();
    // 点模型 section header → 展开（两 section 并存）
    (overlay.querySelector('[data-testid="preview-role-model"] .cap-section-header') as HTMLElement).click();
    expect((overlay.querySelector('[data-testid="preview-role-model-body"]') as HTMLElement).style.display).toBe("block");
    handle.dispose();
  });
});
