// ===== preview-menu 底部根菜单测试（ADR-076 v3：SlideMenu 多层派生 + 能力驱动 dock）=====
// 覆盖：CORE_MENU_ITEMS 表结构、mountPreviewRootMenu 挂载 dock、能力过滤、
// setAdapterItems/openPanel/dispose、单 panel 快捷直达、多 panel 组内下钻。
// ★ 测试断言全部从 PREVIEW_MENU_GROUPS / CORE_MENU_ITEMS 推导，不硬编码菜单 ID。
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CORE_MENU_ITEMS, PREVIEW_MENU_GROUPS } from "./preview-menu-defs.ts";
import { mountPreviewRootMenu, type PreviewMenuCtx } from "./preview-menu.ts";
import { sceneRegistry } from "./scene-registry.ts";
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

  it("契约锚点：camera=sharedOnly，roles 为模型组唯一 core 项（加载入口内嵌，dock 始终可见）", () => {
    expect(CORE_MENU_ITEMS.find((d) => d.id === "camera")?.sharedOnly).toBe(true);
    // 独立 switch 项已撤除（2026-08-21 合并）：模型组 core 项仅 roles，面板底部内嵌加载入口
    expect(CORE_MENU_ITEMS.filter((d) => d.dockGroup === "model").map((d) => d.id)).toEqual(["roles"]);
  });
});

describe("mountPreviewRootMenu", () => {
  let overlay: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = "";
    sceneRegistry.reset();
    // code review P3：全局类型记忆 key 每个测试前清理——断言失败也不污染后续测试
    // （该 key 跨场景/跨会话共享，泄漏会翻转默认高亮与空状态文案，顺序依赖 flaky）
    localStorage.removeItem("ysm.preview.lastRtype");
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

  it("渲染器点按切换 chrome：首次隐藏、再次点按恢复同一面板（非关闭浮窗、非空白）", () => {
    const viewEl = document.createElement("div");
    mountPreviewRootMenu(
      overlay,
      makeCtx({ getViewContainer: () => viewEl, getSiblings: () => ["/m/b.ysm"] }),
    );
    // 经 dock 打开 scene 组菜单（菜单内容渲染进 .slide-list）
    (overlay.querySelector(`[data-testid="dock-scene"]`) as HTMLElement).click();
    const popup = overlay.querySelector(".ysm-preview-menu") as HTMLElement;
    expect(popup.style.display).toBe("flex");
    expect(popup.querySelector(".slide-list")?.childElementCount ?? 0).toBeGreaterThan(0);

    const tap = (): void => {
      viewEl.dispatchEvent(new MouseEvent("pointerdown", { clientX: 0, clientY: 0 }));
      viewEl.dispatchEvent(new MouseEvent("pointerup", { clientX: 0, clientY: 0 }));
    };
    // 点按 → 隐藏
    tap();
    expect(popup.style.display).toBe("none");
    // 面板 DOM 仍在（隐藏而非删除）
    expect(popup.querySelector(".slide-list")?.childElementCount ?? 0).toBeGreaterThan(0);
    // 再次点按 → 恢复同一面板（display 回 flex，内容仍在）
    tap();
    expect(popup.style.display).toBe("flex");
    expect(popup.querySelector(".slide-list")?.childElementCount ?? 0).toBeGreaterThan(0);
  });

  it("🧍 dock 按钮：已有加载角色（YS'M/PMX 多角色）→ 直达 roles 面板，adapter model 项不在 dock 根", () => {
    // 模拟 YS'M/PMX 加载后 sceneRegistry 非空（角色级管理成为主入口）
    sceneRegistry.register({ path: "/m/a.ysm", rtype: "ysm", roots: [], built: {} as never });
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
    // 直接进入 roles 面板（角色管理 + 内嵌加载入口），而非组根视图
    // 单模型实例工具（adapter model）不再作为 dock 根行出现 → 下沉到角色详情
    // （dockGroup:"model" 不变，roleDetailView 仍按它过滤该角色 menuItems）
    expect(overlay.querySelector(`[data-testid="preview-${adapterModelItem.id}"]`)).toBeNull();
    handle.dispose();
  });

  it("🧍 dock 按钮：始终直达 roles 面板（与是否加载角色无关），adapter model 项不在 dock 根", () => {
    // Phase A：🧍 永远开 roles 面板，单模型实例工具下沉角色详情，不再平铺 dock 根
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
    // adapter model 项不再作为 dock 根行出现（下沉到角色详情，未加载角色时不显示）
    expect(overlay.querySelector(`[data-testid="preview-${adapterModelItem.id}"]`)).toBeNull();
    handle.dispose();
  });

  it("组根视图：panel 行带下钻箭头（row-chevron），action 行不带（scene 组）", () => {
    const handle = mountPreviewRootMenu(overlay, makeCtx({ getSiblings: () => ["/m/b.ysm"] }));
    const actItem = {
      id: "act",
      icon: "⚡",
      labelKey: "",
      fallback: "执行动作",
      kind: "action" as const,
      dockGroup: "scene" as const,
      run: vi.fn(),
    };
    handle.setAdapterItems([actItem]);
    const sceneBtn = overlay.querySelector<HTMLElement>(`[data-testid="dock-scene"]`);
    expect(sceneBtn).not.toBeNull();
    sceneBtn!.click();
    // scene 组项含 lighting/shadow/postproc（panel）+ 注入 act（action）→ 组根视图
    const litItem = CORE_MENU_ITEMS.find((d) => d.id === "lighting")!;
    const litRow = overlay.querySelector(`[data-testid="preview-${litItem.id}"]`);
    expect(litRow!.querySelector('[data-testid="row-chevron"]')).not.toBeNull();
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

  it("角色面板加载入口：无 siblings → 显示空态（路径输入仍在，类型 tab 由 adapter 注入）", () => {
    const handle = mountPreviewRootMenu(overlay, makeCtx({ getSiblings: () => [] }));
    const modelGroupId = PREVIEW_MENU_GROUPS.find((g) => g.id === "model")!.id;
    const modelBtn = overlay.querySelector<HTMLElement>(`[data-testid="dock-${modelGroupId}"]`);
    expect(modelBtn).not.toBeNull();
    // 模型组仅 roles 一个 core 项 → 单 panel 快捷直达角色面板（内嵌加载入口）
    modelBtn!.click();
    const popup = overlay.querySelector(".ysm-preview-menu") as HTMLElement;
    expect(popup.style.display).toBe("flex");
    // 空态提示
    expect(overlay.textContent).toContain("无其他模型");
    handle.dispose();
  });

  it("角色面板加载入口：siblings 存在 → 列兄弟项", () => {
    const switchTo = vi.fn();
    const handle = mountPreviewRootMenu(overlay, makeCtx({
      getSiblings: () => ["/m/a.ysm", "/m/b.ysm"],
      getCurrentPath: () => "/m/a.ysm",
      switchTo,
    }));
    const modelBtn = overlay.querySelector<HTMLElement>(`[data-testid="dock-model"]`);
    modelBtn!.click();
    const popup = overlay.querySelector(".ysm-preview-menu") as HTMLElement;
    expect(popup.style.display).toBe("flex");
    // 兄弟项渲染
    expect(popup.querySelectorAll('[data-testid="preview-switch-item"]').length).toBe(2);
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
    // 当前项（/m/a.ysm）无 ➕，兄弟项（/m/b.ysm）有 ➕
    const appendBtns = overlay.querySelectorAll('[data-testid="preview-switch-append"]');
    expect(appendBtns.length).toBe(1);
    (appendBtns[0] as HTMLElement).click();
    expect(switchTo).toHaveBeenCalledWith("/m/b.ysm", { keepInScene: true });
    handle.dispose();
  });

  it("角色面板加载入口：跨类型兄弟行无 ➕（守卫恢复——跨类型追加走错适配器）", () => {
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
    // /m/b.vrm 是跨类型兄弟：无 ➕（code review P2 守卫恢复——追加走当前会话
    // adapter.build，跨类型会喂错格式解析失败）；行本体点击仍走 switchExternal
    const appendBtns = overlay.querySelectorAll('[data-testid="preview-switch-append"]');
    expect(appendBtns.length).toBe(0);
    expect(switchTo).not.toHaveBeenCalled();
    // 行本体点击仍是跨类型替换（switchExternal）——重建语义不变
    const rows = overlay.querySelectorAll('[data-testid="preview-switch-item"]');
    (rows[1] as HTMLElement).click();
    expect(switchExternal).toHaveBeenCalledWith("/m/b.vrm", ["/m/a.ysm", "/m/b.vrm"]);
    handle.dispose();
  });

  it("角色面板加载入口：类型 tab 同类型候选有 ➕，点击追加 → switchTo keepInScene", async () => {
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

  it("角色面板加载入口：类型 tab 跨类型候选行无 ➕（守卫恢复——跨类型追加走错适配器）", async () => {
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
    // 切到 vrm 类型 tab（懒加载候选）
    const tabs = overlay.querySelectorAll('[data-testid="preview-switch-tab"]');
    const vrmTab = Array.from(tabs).find((t) => (t as HTMLElement).dataset.rtype === "vrm") as HTMLElement;
    vrmTab.click();
    await vi.waitFor(() => {
      expect(overlay.querySelectorAll('[data-testid="preview-switch-item"]').length).toBe(1);
    });
    // 跨类型候选：无 ➕（code review P2 守卫恢复——追加走当前会话 adapter.build，
    // 跨类型会喂错格式解析失败）；行本体点击仍走 switchExternal
    const appendBtn = overlay.querySelector('[data-testid="preview-switch-append"]') as HTMLElement;
    expect(appendBtn).toBeNull();
    expect(switchTo).not.toHaveBeenCalled();
    // 行本体点击仍是跨类型替换（switchExternal）
    (overlay.querySelector('[data-testid="preview-switch-item"]') as HTMLElement).click();
    expect(switchExternal).toHaveBeenCalledWith("/m/x.vrm", ["/m/a.ysm"]);
    handle.dispose();
  });

  it("角色面板加载入口：当前目录 tab 歧义 .json 同源候选回退 switchTo（不复建）", () => {
    const switchTo = vi.fn();
    const switchExternal = vi.fn(async () => {});
    const handle = mountPreviewRootMenu(overlay, makeCtx({
      getSiblings: () => ["/m/a.ysm", "/m/b.json"],
      getCurrentPath: () => "/m/a.ysm",
      getCurrentRtype: () => "ysm",
      switchTo,
      switchExternal,
    }));
    const modelBtn = overlay.querySelector<HTMLElement>(`[data-testid="dock-model"]`);
    modelBtn!.click();
    // /m/b.json 是歧义扩展名（resolveTypeSafe 返回 null），但 siblings 即同目录兄弟契约，
    // 应回退为同源 → 行本体走 switchTo 复用外壳替换（不触发 switchExternal 重建）
    const rows = overlay.querySelectorAll('[data-testid="preview-switch-item"]');
    (rows[1] as HTMLElement).click();
    expect(switchTo).toHaveBeenCalledWith("/m/b.json");
    expect(switchExternal).not.toHaveBeenCalled();
    handle.dispose();
  });

  it("类型 tab 全局记忆：默认高亮上次点击的类型（localStorage 持久化）", async () => {
    const switchTo = vi.fn();
    localStorage.setItem("ysm.preview.lastRtype", "vrm");
    const handle = mountPreviewRootMenu(overlay, makeCtx({
      getSiblings: () => ["/m/a.ysm"],
      getCurrentPath: () => "/m/a.ysm",
      getCurrentRtype: () => "ysm",
      getTypeTabs: () => ["ysm", "vrm"],
      getModelsByType: async () => ["/m/x.vrm"],
      switchTo,
    }));
    const modelBtn = overlay.querySelector<HTMLElement>(`[data-testid="dock-model"]`);
    modelBtn!.click();
    // vrm tab 应为默认高亮（background 非 transparent，含高亮色 rgba(124,131,255,...)）
    const tabs = overlay.querySelectorAll<HTMLElement>('[data-testid="preview-switch-tab"]');
    const vrmTab = Array.from(tabs).find((t) => t.dataset.rtype === "vrm") as HTMLElement;
    expect(vrmTab.style.background).toContain("124");
    expect(vrmTab.style.background).toContain("131");
    await vi.waitFor(() => {
      expect(overlay.querySelectorAll('[data-testid="preview-switch-item"]').length).toBe(1);
    });
    handle.dispose();
  });

  it("类型 tab 默认高亮：记忆越界但当前模型类型在 tabs → 高亮当前类型（非当前目录）", () => {
    const switchTo = vi.fn();
    // 记忆一个越界类型（如之前看过的 litematic），但当前模型是 ysm
    localStorage.setItem("ysm.preview.lastRtype", "litematic");
    const handle = mountPreviewRootMenu(overlay, makeCtx({
      getSiblings: () => ["/m/a.ysm", "/m/b.ysm"],
      getCurrentPath: () => "/m/a.ysm",
      getCurrentRtype: () => "ysm",
      getTypeTabs: () => ["ysm", "vrm"],
      getModelsByType: async () => [],
      switchTo,
    }));
    const modelBtn = overlay.querySelector<HTMLElement>(`[data-testid="dock-model"]`);
    modelBtn!.click();
    const tabs = overlay.querySelectorAll<HTMLElement>('[data-testid="preview-switch-tab"]');
    const ysmTab = Array.from(tabs).find((t) => t.dataset.rtype === "ysm") as HTMLElement;
    const dirTab = Array.from(tabs).find((t) => t.dataset.rtype === "");
    // 当前类型 ysm 高亮（记忆越界不污染）；当前目录 tab 已根除——加载角色路径限定，不容其他
    expect(ysmTab.style.background).toContain("124");
    expect(ysmTab.style.background).toContain("131");
    expect(dirTab).toBeUndefined();
    handle.dispose();
  });

  it("类型 tab 默认高亮：记忆与当前类型均越界 → 高亮第一个类型 tab（无当前目录 tab）", () => {
    const switchTo = vi.fn();
    localStorage.setItem("ysm.preview.lastRtype", "litematic");
    const handle = mountPreviewRootMenu(overlay, makeCtx({
      getSiblings: () => ["/m/a.ysm", "/m/b.ysm"],
      getCurrentPath: () => "/m/a.ysm",
      getCurrentRtype: () => "unknown-rtype",
      getTypeTabs: () => ["ysm", "vrm"],
      getModelsByType: async () => [],
      switchTo,
    }));
    const modelBtn = overlay.querySelector<HTMLElement>(`[data-testid="dock-model"]`);
    modelBtn!.click();
    const tabs = overlay.querySelectorAll<HTMLElement>('[data-testid="preview-switch-tab"]');
    // 当前目录 tab 已根除：不存在 rtype="" 的按钮（加载角色路径限定，不容其他）
    const dirTab = Array.from(tabs).find((t) => t.dataset.rtype === "");
    expect(dirTab).toBeUndefined();
    const ysmTab = Array.from(tabs).find((t) => t.dataset.rtype === "ysm") as HTMLElement;
    // 记忆与当前类型都不在 tabs → 高亮第一个类型 tab（ysm）
    expect(ysmTab.style.background).toContain("124");
    expect(ysmTab.style.background).toContain("131");
    handle.dispose();
  });

  it("类型 tab 默认高亮：无记忆 + 当前类型在 tabs → 直接高亮当前类型", () => {
    const switchTo = vi.fn();
    const handle = mountPreviewRootMenu(overlay, makeCtx({
      getSiblings: () => ["/m/a.ysm", "/m/b.ysm"],
      getCurrentPath: () => "/m/a.ysm",
      getCurrentRtype: () => "ysm",
      getTypeTabs: () => ["ysm", "vrm"],
      getModelsByType: async () => [],
      switchTo,
    }));
    const modelBtn = overlay.querySelector<HTMLElement>(`[data-testid="dock-model"]`);
    modelBtn!.click();
    const tabs = overlay.querySelectorAll<HTMLElement>('[data-testid="preview-switch-tab"]');
    const ysmTab = Array.from(tabs).find((t) => t.dataset.rtype === "ysm") as HTMLElement;
    // 开 YSM 模型默认就高亮 YSM（你反馈的核心痛点）
    expect(ysmTab.style.background).toContain("124");
    expect(ysmTab.style.background).toContain("131");
    handle.dispose();
  });
});

