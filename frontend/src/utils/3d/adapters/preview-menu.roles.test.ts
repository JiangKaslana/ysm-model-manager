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

  it("模型组根视图列出 preview-roles 行，点击进入角色面板", () => {
    const handle = mountPreviewRootMenu(overlay, makeCtx({ getSiblings: () => ["/m/b.ysm"] }));
    (overlay.querySelector('[data-testid="dock-model"]') as HTMLElement).click();
    const rolesRow = overlay.querySelector('[data-testid="preview-roles"]');
    expect(rolesRow).not.toBeNull();
    (rolesRow as HTMLElement).click();
    expect(overlay.querySelector('[data-testid="preview-roles-list"]')).not.toBeNull();
    handle.dispose();
  });

  it("注册 2 角色 → 面板列出 2 行，焦点行 radio 为 ● 且行高亮", () => {
    const a = regRole("/m/a.ysm");
    const b = regRole("/m/b.ysm"); // b 为 active（register 即置活跃）
    const handle = mountPreviewRootMenu(overlay, makeCtx());
    (overlay.querySelector('[data-testid="dock-model"]') as HTMLElement).click();
    (overlay.querySelector('[data-testid="preview-roles"]') as HTMLElement).click();
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
    (overlay.querySelector('[data-testid="preview-roles"]') as HTMLElement).click();
    const aRow = overlay.querySelector(`[data-testid="preview-role-row"][data-role-id="${a}"]`);
    (aRow!.querySelector('[data-testid="preview-role-focus"]') as HTMLElement).click();
    expect(sceneRegistry.getActiveId()).toBe(a);
    const aRow2 = overlay.querySelector(`[data-testid="preview-role-row"][data-role-id="${a}"]`);
    expect((aRow2!.querySelector('[data-testid="preview-role-focus"]') as HTMLElement).textContent).toBe("●");
    handle.dispose();
  });

  it("点击角色名 → 详情子面板按该角色 menuItems（model 组 panel）列出，点击项渲染其面板", () => {
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
    (overlay.querySelector('[data-testid="dock-model"]') as HTMLElement).click();
    (overlay.querySelector('[data-testid="preview-roles"]') as HTMLElement).click();
    const aRow = overlay.querySelector('[data-testid="preview-role-row"][data-role-id="m1"]');
    (aRow!.querySelector('[data-testid="preview-role-name"]') as HTMLElement).click();
    // 详情子面板：material 行出现（makeRow 的 testid = preview-<id>）
    const matRow = overlay.querySelector('[data-testid="preview-material"]');
    expect(matRow).not.toBeNull();
    (matRow as HTMLElement).click();
    expect(overlay.textContent).toContain("MAT-PANEL");
    handle.dispose();
  });

  it("点击 ⚙ → 工具子面板含卸载角色；点击卸载 → ctx.unloadRole 收到该角色 id", () => {
    const unloadRole = vi.fn();
    regRole("/m/a.ysm");
    const handle = mountPreviewRootMenu(overlay, makeCtx({ unloadRole }));
    (overlay.querySelector('[data-testid="dock-model"]') as HTMLElement).click();
    (overlay.querySelector('[data-testid="preview-roles"]') as HTMLElement).click();
    const aRow = overlay.querySelector('[data-testid="preview-role-row"][data-role-id="m1"]');
    (aRow!.querySelector('[data-testid="preview-role-tools"]') as HTMLElement).click();
    const unload = overlay.querySelector('[data-testid="preview-role-unload"]');
    expect(unload).not.toBeNull();
    (unload as HTMLElement).click();
    expect(unloadRole).toHaveBeenCalledWith("m1");
    handle.dispose();
  });

  it("无已加载角色 → 空态提示（加载入口仍在）", () => {
    const handle = mountPreviewRootMenu(overlay, makeCtx({ getSiblings: () => ["/m/b.ysm"] }));
    (overlay.querySelector('[data-testid="dock-model"]') as HTMLElement).click();
    (overlay.querySelector('[data-testid="preview-roles"]') as HTMLElement).click();
    expect(overlay.querySelector('[data-testid="preview-roles-empty"]')).not.toBeNull();
    // 加载入口（switch 面板的路径输入）仍保留
    expect(overlay.querySelector("input[type='text']")).not.toBeNull();
    handle.dispose();
  });
});
