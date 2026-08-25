// ===== 3D 预览底部根菜单（ADR-076 v3）=====
// 对齐 MikuMikuAR：底部根按钮 → createSlideMenu 多层导航。
// 能力驱动：有模型/骨骼项 → 🧍 模型；有动作/播放项 → 💃 动作；有环境能力 → 🌍 环境；有场景/相机能力 → 🎛️ 场景。
// 每组按钮点击：
//   - 组内仅一个 panel 项 → 直接打开该面板（快捷直达）
//   - 组内多个项 → home 到组根视图（项列表），点击项 navigate 下钻面板
// 关闭统一走 SlideMenu header ✕（根级）/ ←（子级），外部点击关闭。

import { CORE_MENU_ITEMS, PREVIEW_MENU_GROUPS, type PreviewMenuGroupDef } from "./preview-menu-defs.ts";
import type { PreviewMenuNode } from "./preview-menu-node-types.ts";
import type { PreviewActionMenuCtx } from "./preview-menu-node-types.ts";
import { renderEnvLevel } from "./preview-menu-env.ts";
import { renderCapControls } from "./preview-menu-cap-controls.ts";
import { safeErrorMessage } from "../../safe-error-msg.ts";
import { createSlideMenu, type SlideMenuView, type SlideMenuHandle } from "../../../ui/ui-slide-menu.ts";
import { buildCameraControls, type CameraControlBridge } from "./camera-controls.ts";
import type { SkyCapability } from "../caps/sky-capability.ts";
import type { GroundCapability } from "../caps/ground-capability.ts";
import type { LightCapability } from "../caps/light-capability.ts";
import { createHeaderToggle } from "../../../ui/ui-header-toggle.ts";
import { RESOURCE_TYPE_LABELS, resolveTypeSafe, getPreviewableTypeTabs } from "../../resource/types.ts";
import { ensureFabStyles } from "../../../utils/dom/fab.ts";
import { attachTooltip } from "../../../utils/dom/tooltip.ts";
import { safeGet, safeSet } from "../../../utils/dom/storage.ts";
import { t } from "../../../core/i18n/t.ts";
import type { MenuControlDef, SceneCapability } from "../caps/scene-capability.ts";
import { sceneCapabilityRegistry } from "../caps/scene-capability-registry.ts";
import { ENV_PRESET_LINKAGE, type EnvPresetId } from "../caps/environment-capability.ts";
import { sceneRegistry, type ModelEntry } from "./scene-registry.ts";
import type { FogCapability } from "../caps/fog-capability.ts";
import { isFrustumCullEnabled, setFrustumCullEnabled } from "../frustum-cull.ts";
import { getMaxFps, invalidateMaxFpsCache, MAX_FPS_KEY, getMaxPixelRatio, MAX_PIXEL_RATIO_KEY } from "../render-budget.ts";

/** 根菜单上下文：core 在 mount3D 内组装，全部经 getter 暴露避免闭包捕获过期值 */
export interface PreviewMenuCtx {
  selfMode: boolean;
  getSkyCap: () => SkyCapability | null;
  getGroundCap: () => GroundCapability | null;
  getLightCap: () => LightCapability | null;
  getCamBridge: () => CameraControlBridge;
  getSiblings: () => string[];
  getCurrentPath: () => string;
  /** 当前会话资源类型（如 ysm/EntityPlayer/vrm/resourcepack；空串未知）——类型 tab 点击时判断同类型走 switchTo */
  getCurrentRtype?: () => string;
  /** 当前会话子类型（如 EntityPlayer/CustomAnim；空串未知）——传递给 getModelsByType 做扩展名隔离 */
  getCurrentSubtype?: () => string;
  /** 按资源类型（+可选子类型）扫描候选模型路径（点击切换模型的类型 tab 时懒加载；缺省回退 siblings） */
  getModelsByType?: (rtype: string, subtype?: string) => Promise<string[]>;
  /** 类型 tab 列表（如 ["ysm","EntityPlayer","vrm","resourcepack"]；缺省仅「当前目录」tab） */
  getTypeTabs?: () => string[];
  /** 3D 渲染器容器：点击该区域关闭菜单（不再全局点击杀弹窗） */
  getViewContainer: () => HTMLElement;
  close: () => void;
  /** 切换模型（同源复用外壳替换）。返回 Promise 供调用方在完成后局部刷新（如 fillSwitch 列表重渲染）；mount 层透传 handle.switchTo 的 Promise */
  switchTo: (path: string, options?: { keepInScene?: boolean }) => Promise<void> | void;
  /** 跨类型跳转（切换模型选中不同类型：关当前 + 开目标，由 app 层 openModel3DFullscreen 提供）。
   *  第二参透传 siblings，切换后新会话「当前目录」tab 有候选（P1-2） */
  switchExternal?: (path: string, siblings?: string[], options?: { keepInScene?: boolean }) => Promise<void> | void;
  /** 卸载已加载角色（mount3D 注入：移除 roots + dispose + 注册表注销 + 相机重算） */
  unloadRole?: (id: string) => void;
  /** 动作节点真 ctx：mount3D 注入真实现，适配器动作可 toast/closeAllOverlays */
  toast: (message: string) => void;
  closeAllOverlays: () => void;
}

/** i18n 安全取值：键缺失时回退，杜绝菜单项退化显示原始键名 */
const tr = (key: string, fallback: string): string => {
  const v = t(key);
  return v === key ? fallback : v;
};

/** 通用控件渲染器：将 MenuControlDef[] 渲染为 DOM 行，替代手写 fill* 函数 */
export { renderCapControls };


/** 根菜单句柄：dispose 解绑；setAdapterItems 替换适配器专属项；openPanel 直接打开指定面板；refreshDock 在 caps 创建后重渲染底栏（ADR-085 S3） */
export interface PreviewMenuHandle {
  dispose(): void;
  /** 适配器注入声明式节点（直接存 PreviewMenuNode[]，方案 A 已统一） */
  setAdapterItems(items: PreviewMenuNode[]): void;
  openPanel(id: string): void;
  refreshDock(): void;
}

/** 挂载预览底部根菜单，返回句柄 */
// ===================================================================
// mountPreviewRootMenu — 子函数（原 6 闭包升格 + 6 阶段拆 9 子）
// ===================================================================

/** mount 状态壳：handle 在 dock 按钮 onclick 之后才赋值，fillRoles 回调经此壳读取，避免闭包前向捕获 */
interface PreviewHandleShell {
  handle: PreviewMenuHandle | null;
}

/** [子函数 1/9] 装配底部 dock + SlideMenu popup/menu 外壳，返回 show/hide 句柄 */
function buildPreviewMenuShell(
  overlay: HTMLElement,
  ctx: PreviewMenuCtx,
): {
  dock: HTMLElement;
  popup: HTMLElement;
  menu: SlideMenuHandle;
  showMenu: (view: SlideMenuView) => void;
  hideMenu: () => void;
} {
  ensureFabStyles();
  const dock = document.createElement("div");
  dock.className = "preview-dock-nav";
  overlay.appendChild(dock);

  const popup = document.createElement("div");
  popup.className = "ysm-preview-menu";
  popup.style.cssText =
    "position:absolute;left:16px;bottom:84px;width:300px;max-height:70vh;" +
    "display:none;z-index:25";
  overlay.appendChild(popup);

  const menu = createSlideMenu({ title: "", closeIcon: "✕" });
  popup.appendChild(menu.root);
  menu.root.querySelector<HTMLElement>(".slide-back")?.setAttribute("id", "preview-close-3d");

  const showMenu = (view: SlideMenuView): void => {
    menu.home(view);
    popup.style.display = "flex";
  };
  const hideMenu = (): void => {
    popup.style.display = "none";
  };
  // 根级 ✕ 语义 = 关闭整个 3D 预览
  menu.setOnClose(() => {
    hideMenu();
    ctx.close();
  });
  return { dock, popup, menu, showMenu, hideMenu };
}

/** [子函数 2/9] 行工厂（原 makeRow 闭包升格）：可选 chevron 箭头导航提示 */
function makePreviewMenuRow(node: PreviewMenuNode, opts?: { chevron?: boolean }): HTMLElement {
  const row = document.createElement("div");
  row.className = "ysm-preview-menu-row";
  row.dataset.testid = "preview-" + node.id;
  if (node.legacyTestId) row.id = node.legacyTestId;
  row.style.cssText =
    "display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;cursor:pointer;font-size:13px";
  if (node.danger) row.style.color = "#ff7b7b";
  const ic = document.createElement("span");
  ic.textContent = node.icon ?? "";
  ic.style.cssText = "font-size:15px;width:18px;text-align:center";
  const lb = document.createElement("span");
  lb.textContent = tr(node.labelKey ?? node.id, node.fallback ?? node.id);
  row.append(ic, lb);
  if (opts?.chevron) {
    const chev = document.createElement("span");
    chev.textContent = ">";
    chev.dataset.testid = "row-chevron";
    chev.style.cssText =
      "margin-left:auto;font-size:13px;font-weight:700;opacity:0.4;user-select:none";
    row.append(chev);
  }
  row.onmouseenter = (): void => {
    row.style.background = "rgba(255,255,255,0.08)";
  };
  row.onmouseleave = (): void => {
    row.style.background = "transparent";
  };
  return row;
}

/** [子函数 3/9] 声明式 Schema 面板内容渲染器（原 renderSchemaContent 闭包升格） */
function renderPreviewSchemaContent(
  list: HTMLElement,
  nodes: PreviewMenuNode[],
  hideMenu: () => void,
): void {
  for (const node of nodes) {
    if (node.visibleWhen && !node.visibleWhen()) continue;
    if (node.kind === "sectionTitle") {
      const st = document.createElement("div");
      st.className = "section-title";
      st.dataset.testid = node.id;
      st.textContent = node.labelKey
        ? tr(node.labelKey, node.fallback ?? node.id)
        : node.id;
      list.appendChild(st);
      continue;
    }
    if (node.kind === "divider") {
      const hr = document.createElement("div");
      hr.dataset.testid = node.id;
      hr.style.cssText = "height:1px;background:rgba(255,255,255,0.1);margin:6px 10px";
      list.appendChild(hr);
      continue;
    }
    if (node.kind === "field") {
      const row = document.createElement("div");
      row.className = "slide-item field-row";
      row.dataset.testid = "preview-" + node.id;
      const k = document.createElement("span");
      k.className = "field-label";
      k.textContent = node.labelKey ? tr(node.labelKey, node.id) : node.id;
      const v = document.createElement("span");
      v.className = "field-value";
      v.textContent = String(
        node.value ?? (node.labelKey ? tr(node.labelKey, node.id) : node.id),
      );
      row.append(k, v);
      list.appendChild(row);
      continue;
    }
    const fn = node.renderCustom;
    if (fn) {
      fn(list, hideMenu);
      continue;
    }
  }
}

/** buildPreviewMenuRouters 返回类型：面板路由 + 声明式 schema 映射 */
interface PreviewMenuRouters {
  schemaBuilders: Record<string, (menu?: SlideMenuHandle) => PreviewMenuNode[]>;
  fillers: Record<string, (list: HTMLElement, menu?: SlideMenuHandle) => void>;
  runners: Record<string, () => void>;
}

/**
 * [子函数 4/9] 构建 core 面板路由表（schema 声明式 → fillers 过程式 → runners 动作式，三级衰退链）。
 *   roles 面板需要 setAdapterItems 回写 dock——handle 尚未构造时经 shell 延迟读取。
 */
function buildPreviewMenuRouters(
  ctx: PreviewMenuCtx,
  hideMenu: () => void,
  menu: SlideMenuHandle,
  actionCtx: PreviewActionMenuCtx,
  shell: PreviewHandleShell,
): PreviewMenuRouters {
  const makeRow = makePreviewMenuRow;
  const makePanelView = (node: PreviewMenuNode): SlideMenuView =>
    previewMakePanelView(node, (l, n) =>
      renderPreviewPanel(l, n, routers, menu, hideMenu, actionCtx),
    );
  // 先占位：makePanelView 上面的闭包会立即引用 routers，routers 下面立即赋值
  const routers: PreviewMenuRouters = {
    schemaBuilders: {
      lighting: (_menu) => buildLightingSchema(ctx),
      shadow: () => buildShadowSchema(ctx),
      postproc: () => buildPostprocessingSchema(ctx),
      settings: () => buildSettingsSchema(ctx),
      camera: () => buildCameraSchema(ctx),
    },
    fillers: {
      environment: (list, m) => renderEnvLevel(list, ctx, m),
      roles: (list, m) =>
        fillRoles(
          list,
          ctx,
          hideMenu,
          makeRow,
          makePanelView,
          m!,
          (items) => shell.handle?.setAdapterItems(items),
        ),
    },
    runners: {
      close: () => ctx.close(),
    },
  };
  return routers;
}

/** [子函数 5/9] 单面板渲染（原 renderPanel 闭包升格）：schema → renderCustom → action → fillers 四级衰退 + try-catch 错误边界 */
function renderPreviewPanel(
  list: HTMLElement,
  node: PreviewMenuNode,
  routers: PreviewMenuRouters,
  menu: SlideMenuHandle,
  hideMenu: () => void,
  actionCtx: PreviewActionMenuCtx,
): void {
  list.innerHTML = "";
  try {
    if (routers.schemaBuilders[node.id]) {
      renderPreviewSchemaContent(list, routers.schemaBuilders[node.id]!(menu), hideMenu);
    } else if (node.renderCustom) {
      node.renderCustom(list, () => hideMenu());
    } else if (node.action) {
      node.action(actionCtx);
    } else {
      routers.fillers[node.id]?.(list, menu);
    }
  } catch (err) {
    console.error("[preview-menu] renderPanel FAILED", node.id, err);
    const errRow = document.createElement("div");
    errRow.style.cssText = "padding:8px 10px;color:#ff7b7b;font-size:12px";
    errRow.textContent = "面板渲染失败: " + safeErrorMessage(err);
    list.appendChild(errRow);
  }
}

/** [子函数 6/9] SlideMenuView 工厂（原 makePanelView 闭包升格） */
function previewMakePanelView(
  node: PreviewMenuNode,
  renderPanelFn: (list: HTMLElement, node: PreviewMenuNode) => void,
): SlideMenuView {
  return {
    title: tr(node.labelKey ?? node.id, node.fallback ?? node.id),
    render: (list) => renderPanelFn(list, node),
  };
}

/** [子函数 7/9] 组根视图：列出组内项，panel 型带箭头下钻 / action 型直接执行并关菜单 */
function previewMakeGroupView(
  g: PreviewMenuGroupDef,
  groupItems: PreviewMenuNode[],
  menu: SlideMenuHandle,
  makeRowFn: (n: PreviewMenuNode, opts?: { chevron?: boolean }) => HTMLElement,
  makePanelViewFn: (n: PreviewMenuNode) => SlideMenuView,
  actionCtx: PreviewActionMenuCtx,
  hideMenu: () => void,
): SlideMenuView {
  return {
    title: g.fallback,
    render: (list) => {
      list.innerHTML = "";
      for (const node of groupItems) {
        const row = makeRowFn(node, { chevron: node.kind === "panel" });
        row.onclick = (e: MouseEvent): void => {
          e.stopPropagation();
          if (node.kind === "panel") {
            menu.navigate(makePanelViewFn(node));
          } else if (node.action) {
            hideMenu();
            node.action(actionCtx);
          }
        };
        list.appendChild(row);
      }
    },
  };
}

/** dock 组内工具过滤链（共用：model 捷径的 allItems.find 与通用分支同条件，防两处漂移） */
function dockGroupItemsFor(
  g: PreviewMenuGroupDef,
  allItems: PreviewMenuNode[],
  ctx: PreviewMenuCtx,
): PreviewMenuNode[] {
  const hasEnv =
    !!sceneCapabilityRegistry.getById("sky") ||
    !!sceneCapabilityRegistry.getById("ground") ||
    !!ctx.getSkyCap() ||
    !!ctx.getGroundCap();
  return allItems
    .filter((d) => d.dockGroup === g.id && d.kind !== "divider")
    .filter((d) => !(d.sharedOnly && ctx.selfMode))
    .filter((d) => !(d.hideInSelfMode && ctx.selfMode))
    .filter((d) => !(d.requiresEnvironment && !hasEnv));
}

/**
 * [子函数 8/9] 底部 dock 渲染（原 renderDock 闭包升格）。
 *   两大捷径分支：🧍 model 直达 roles；💃 motion 有活跃角色则直达详情的动作 section。
 *   通用分支：组内仅 1 个 panel 项 → 直达面板；否则进组根视图。
 */
function renderPreviewDock(
  dock: HTMLElement,
  ctx: PreviewMenuCtx,
  menu: SlideMenuHandle,
  showMenu: (view: SlideMenuView) => void,
  makeRowFn: (n: PreviewMenuNode, opts?: { chevron?: boolean }) => HTMLElement,
  makePanelViewFn: (n: PreviewMenuNode) => SlideMenuView,
  makeGroupViewFn: (g: PreviewMenuGroupDef, items: PreviewMenuNode[]) => SlideMenuView,
  actionCtx: PreviewActionMenuCtx,
  hideMenu: () => void,
  adapterItemsRef: { v: PreviewMenuNode[] },
): void {
  dock.innerHTML = "";
  const allItems = [...CORE_MENU_ITEMS, ...adapterItemsRef.v];
  for (const g of PREVIEW_MENU_GROUPS) {
    const groupItems = dockGroupItemsFor(g, allItems, ctx);
    if (groupItems.length === 0) continue;

    const btn = document.createElement("button");
    btn.className = "preview-dock-navbtn";
    btn.dataset.testid = "dock-" + g.id;
    btn.innerHTML =
      `<span class="preview-ic">${g.icon}</span><span class="preview-dock-navlabel">${g.fallback}</span>`;
    btn.onclick = (e: MouseEvent): void => {
      e.stopPropagation();
      const rolesDef = allItems.find((d) => d.id === "roles" && d.kind === "panel");
      // 🧍 模型组：直达 roles 角色列表（新手第一跳）
      if (g.id === "model") {
        if (rolesDef) {
          showMenu(makePanelViewFn(rolesDef));
          return;
        }
      }
      // 💃 动作组：有活跃角色+技能 → 直达详情聚焦动作 section
      if (g.id === "motion") {
        const activeId = sceneRegistry.getActiveId();
        const active = activeId ? sceneRegistry.getAll().find((x) => x.id === activeId) : undefined;
        if (active?.menuItems) {
          showMenu(
            roleDetailView(active, {
              makeRow: makeRowFn,
              makePanelView: makePanelViewFn,
              menu,
              actionCtx,
              initialSection: "motion",
              onSwitchRole: rolesDef
                ? () => showMenu(makePanelViewFn(rolesDef))
                : undefined,
            }),
          );
          return;
        }
      }
      const panels = groupItems.filter((d) => d.kind === "panel");
      if (panels.length === 1 && groupItems.length === 1) {
        showMenu(makePanelViewFn(panels[0]));
      } else {
        showMenu(makeGroupViewFn(g, groupItems));
      }
    };
    dock.appendChild(btn);
  }
}

/**
 * [子函数 9/9] 渲染器点按 vs 拖拽识别。
 *   点按 = 位移≤5 且 时长≤400ms，此时切换 popup 显隐（仅切 display，DOM/栈保留）。
 *   返回 abort 句柄供 dispose 解绑。
 */
function bindPreviewTapToggle(
  viewEl: HTMLElement,
  popup: HTMLElement,
): () => void {
  const tapAbort = new AbortController();
  let downX = 0;
  let downY = 0;
  let downT = 0;
  viewEl.addEventListener(
    "pointerdown",
    (e: PointerEvent): void => {
      downX = e.clientX;
      downY = e.clientY;
      downT = performance.now();
    },
    { signal: tapAbort.signal },
  );
  viewEl.addEventListener(
    "pointerup",
    (e: PointerEvent): void => {
      const moved = Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY);
      if (moved > 5 || performance.now() - downT > 400) return;
      const list = popup.querySelector<HTMLElement>(".slide-list");
      if (popup.style.display !== "none") {
        popup.style.display = "none";
      } else if (list && list.childElementCount > 0) {
        popup.style.display = "flex";
      }
    },
    { signal: tapAbort.signal },
  );
  return (): void => tapAbort.abort();
}

/** setAdapterItems 的 id 冲突守卫（ADR-085 S1）：发现重复/冲突抛错阻断 */
function validateAdapterItemIds(items: PreviewMenuNode[]): void {
  const seen = new Set<string>();
  for (const it of items) {
    if (seen.has(it.id)) {
      throw new Error(
        `[preview-menu] setAdapterItems 重复 id: "${it.id}"（适配器项之间冲突）`,
      );
    }
    if (CORE_MENU_ITEMS.some((c) => c.id === it.id)) {
      throw new Error(
        `[preview-menu] setAdapterItems id "${it.id}" 与 CORE_MENU_ITEMS 冲突`,
      );
    }
    seen.add(it.id);
  }
}

// ===================================================================
// mountPreviewRootMenu — 主函数
// ===================================================================

export function mountPreviewRootMenu(overlay: HTMLElement, ctx: PreviewMenuCtx): PreviewMenuHandle {
  // 阶段 1：dock + popup + SlideMenu 外壳装配（含 show/hide）
  const { dock, popup, menu, showMenu, hideMenu } = buildPreviewMenuShell(overlay, ctx);
  // 阶段 2：action ctx 与 handle 延迟壳（fillRoles 回调在 handle 构造前就能安全引用）
  const actionCtx: PreviewActionMenuCtx = {
    toast: ctx.toast,
    closeAllOverlays: ctx.closeAllOverlays,
  };
  const shell: PreviewHandleShell = { handle: null };
  const adapterItemsRef = { v: [] as PreviewMenuNode[] };
  // 阶段 3：面板路由表（schema / fillers / runners 三级衰退链）
  const routers = buildPreviewMenuRouters(ctx, hideMenu, menu, actionCtx, shell);
  // 阶段 4：面板/组视图工厂（引用 routers 做渲染）
  const renderPanelFn = (l: HTMLElement, n: PreviewMenuNode): void =>
    renderPreviewPanel(l, n, routers, menu, hideMenu, actionCtx);
  const makePanelViewFn = (n: PreviewMenuNode): SlideMenuView =>
    previewMakePanelView(n, renderPanelFn);
  const makeRowFn = makePreviewMenuRow;
  const makeGroupViewFn = (g: PreviewMenuGroupDef, items: PreviewMenuNode[]): SlideMenuView =>
    previewMakeGroupView(g, items, menu, makeRowFn, makePanelViewFn, actionCtx, hideMenu);
  // 阶段 5：dock 渲染器（闭包捕获 adapterItemsRef，setAdapterItems 后自动刷新）
  const refreshDock = (): void =>
    renderPreviewDock(
      dock,
      ctx,
      menu,
      showMenu,
      makeRowFn,
      makePanelViewFn,
      makeGroupViewFn,
      actionCtx,
      hideMenu,
      adapterItemsRef,
    );
  // 阶段 6：tap 识别（点击渲染器区域显隐菜单，拖拽不响应）
  const abortTap = bindPreviewTapToggle(ctx.getViewContainer(), popup);

  // ---- 句柄方法 ----
  const setAdapterItems = (items: PreviewMenuNode[]): void => {
    validateAdapterItemIds(items);
    adapterItemsRef.v = items;
    refreshDock();
  };
  const openPanel = (id: string): void => {
    const node = [...CORE_MENU_ITEMS, ...adapterItemsRef.v].find((d) => d.id === id);
    if (!node || node.kind !== "panel") return;
    showMenu(makePanelViewFn(node));
  };
  refreshDock();

  const handle: PreviewMenuHandle = {
    dispose: (): void => {
      abortTap();
      menu.dispose();
      dock.remove();
      popup.remove();
    },
    setAdapterItems,
    openPanel,
    refreshDock, // ADR-085 S3：caps 创建后调用，修复 litematic/pack environment 项时序
  };
  shell.handle = handle;
  return handle;
}

/** 环境面板（ADR-075 + 统一注册表）：只渲染环境类能力（sky/ground/environment/fog/reflector）
 *  独立面板排除项：light → lighting；shadow → shadow；postprocessing → postproc；避免同一能力控件双面板重复。
 *
 *  两级菜单（2026-08-20 改造）：
 *  - 第一层（环境根视图）：每个 cap 渲染一行摘要 = 主控件 + 名称 + ›
 *    · environment/fog/reflector：第一个控件是 *-enabled toggle → 第一层放该 toggle
 *    · sky：无 enabled toggle，第一个控件是 sky-time slider → 第一层直接放该 slider
 *    · ground：仅一个 visible toggle、无数值 → 纯 toggle 行，无 ›
 *  - › 点击 → menu.navigate(subView)，subView 渲染该 cap 的完整 getMenuControls()
 *  - 无 menu 句柄（旧调用路径）→ 回退到平铺渲染，保持向后兼容 */
/** 上次选中的类型 tab 持久化键（全局记忆，跨模型/跨会话）："" = 当前目录 */
const PREVIEW_LAST_RTYPE_KEY = "ysm.preview.lastRtype";

/** 3D 内模型切换面板：各资源类型 tab 懒加载候选，当前项高亮。
 *  默认高亮优先级：① 用户手动记忆的类型（localStorage）② 当前模型自身类型（getCurrentRtype）
 *  ③ 第一个类型 tab。「当前目录」tab 已移除（记忆/当前类型生效后可少一个 tab）；
 *  rtypes 为空（无注册路由）时仍走 siblings 列表兜底，不空白。 */
// ===================================================================
// fillSwitch — 子函数（原 3 闭包升格：mkTab / draw / renderRows）
// ===================================================================

/** ADR-111：tab 标签统一从 getPreviewableTypeTabs 派生，preview key 兜底 RESOURCE_TYPE_LABELS */
function switchTabLabelOf(key: string): string {
  const hit = getPreviewableTypeTabs().find((t) => t.key === key);
  return hit?.label ?? RESOURCE_TYPE_LABELS[key] ?? key;
}

/** 路径归一化：统一正斜杠 + 小写（跨平台分隔符比较一致，P2-5） */
function switchNormPath(s: string): string {
  return s.replace(/\\/g, "/").toLowerCase();
}

/** [子函数 1/6] 解析默认高亮 tab：手动记忆 → 当前模型类型 → 首项；兜底 ""（siblings） */
function resolveSwitchActiveTab(rtypes: string[], curRtype: string): string {
  const remembered = safeGet(PREVIEW_LAST_RTYPE_KEY);
  if (remembered !== null && rtypes.includes(remembered)) return remembered;
  if (curRtype && rtypes.includes(curRtype)) return curRtype;
  return rtypes[0] ?? "";
}

/**
 * [子函数 2/6] 构建 tabBar 容器并返回更新句柄。
 *   mkTab 闭包升格为包级函数；点击时透传 onSwitchTab 回调刷新 activeTab + 高亮 + 重渲染。
 */
function buildSwitchTabBar(
  rtypes: string[],
  initialActive: string,
  onSwitchTab: (key: string) => void,
): HTMLElement {
  const tabBar = document.createElement("div");
  tabBar.style.cssText =
    "display:flex;gap:4px;padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.12);flex-wrap:wrap;flex-shrink:0";
  tabBar.dataset.testid = "preview-switch-tabs";
  const highlightTab = (key: string): void => {
    for (const tb of Array.from(tabBar.children)) {
      (tb as HTMLElement).style.background =
        (tb as HTMLElement).dataset.rtype === key ? "rgba(124,131,255,0.35)" : "transparent";
    }
  };
  for (const r of rtypes) {
    const b = document.createElement("button");
    b.dataset.testid = "preview-switch-tab";
    b.dataset.rtype = r;
    b.textContent = switchTabLabelOf(r);
    b.style.cssText =
      "font-size:12px;padding:2px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.2);cursor:pointer;color:rgba(255,255,255,0.7);background:transparent" +
      (r === initialActive ? ";background:rgba(124,131,255,0.35);color:#fff" : "");
    b.onclick = (): void => {
      // 持久化选中类型（「当前目录」空串不持久化——临时视图）
      if (r !== "") safeSet(PREVIEW_LAST_RTYPE_KEY, r);
      highlightTab(r);
      onSwitchTab(r);
    };
    tabBar.appendChild(b);
  }
  return tabBar;
}

/**
 * [子函数 3/6] sameType 同源判定。
 *   sameType 仅用于行点击路由：同源 → switchTo 复用外壳替换，跨源 → switchExternal。
 *   类型判定：类型 tab 按 activeTab；当前目录 tab 按候选实际类型（resolveTypeSafe 解析）。
 *   候选类型无法可靠识别（歧义扩展名，resolveTypeSafe 返回 null）时保守判「不同源」。
 */
function switchSameTypeOf(
  viaType: boolean,
  activeTab: string,
  candType: string | null,
  curType: string,
): boolean {
  return viaType
    ? activeTab === curType || (curType === "" && activeTab === candType)
    : !!candType && (candType === curType || curType === "");
}

/**
 * [子函数 4/6] 执行点击行的替换/追加语义（原两段 10+ 行重复 inline onclick）。
 *   keepInScene=true→追加；false→替换。失败已由 mount 层 catch(logWarn) 记录，此处吞 unhandled rejection。
 */
function applySwitchRowClick(
  p: string,
  sameType: boolean,
  ctx: PreviewMenuCtx,
  keepInScene: boolean,
): void {
  const opts = keepInScene ? { keepInScene: true } : undefined;
  const r = !sameType && ctx.switchExternal
    ? ctx.switchExternal(p, ctx.getSiblings(), opts)
    : ctx.switchTo(p, opts);
  if (r && typeof (r as Promise<void>).then === "function") void (r as Promise<void>).catch(() => {});
}

/** [子函数 5/6] 绘制单条候选行：图标 / 标签 / ➕追加按钮 / 替换行点击。 */
function renderSwitchCandidateRow(
  listBody: HTMLElement,
  p: string,
  ctx: PreviewMenuCtx,
  curNorm: string,
  activeTab: string,
  viaType: boolean,
): void {
  const isCur = switchNormPath(p) === curNorm;
  const candType = resolveTypeSafe(p);
  const curType = ctx.getCurrentRtype?.() ?? "";
  const sameType = switchSameTypeOf(viaType, activeTab, candType, curType);
  const row = document.createElement("div");
  row.className = "ysm-preview-menu-row";
  row.dataset.testid = "preview-switch-item";
  row.style.cssText =
    "display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;cursor:pointer;font-size:13px" +
    (isCur ? ";background:rgba(124,131,255,0.25)" : "");
  const ic = document.createElement("span");
  ic.textContent = isCur ? "✓" : "📦";
  ic.style.cssText = "font-size:15px;width:18px;text-align:center";
  const lb = document.createElement("span");
  lb.textContent = p.split(/[/\\]/).pop() || p;
  row.append(ic, lb);
  if (!isCur) {
    const append = document.createElement("button");
    append.dataset.testid = "preview-switch-append";
    append.textContent = "➕";
    attachTooltip(append, () => tr("preview.appendModel", "追加到场景"));
    append.style.cssText =
      "width:22px;height:22px;flex-shrink:0;background:rgba(255,255,255,0.08);border:none;border-radius:4px;cursor:pointer;font-size:12px;line-height:1;margin-left:auto";
    append.onclick = (ev): void => {
      ev.stopPropagation();
      applySwitchRowClick(p, sameType, ctx, true);
    };
    row.appendChild(append);
  }
  row.onclick = (): void => {
    applySwitchRowClick(p, sameType, ctx, false);
  };
  listBody.appendChild(row);
}

/** [子函数 6/6] renderRows：代际守卫 + 异步扫描 + 空态 + 候选列表绘制。 */
function runSwitchRenderRows(
  listBody: HTMLElement,
  ctx: PreviewMenuCtx,
  getActiveTab: () => string,
  reqGen: { v: number },
): void {
  const gen = ++reqGen.v;
  listBody.innerHTML = "";
  const curNorm = switchNormPath(ctx.getCurrentPath());

  const draw = (paths: string[], viaType: boolean): void => {
    // 类型 tab 过滤当前项（siblings 分支已由 getSiblings 去当前项）
    const shown = viaType ? paths.filter((p) => switchNormPath(p) !== curNorm) : paths;
    if (shown.length === 0) {
      const empty = document.createElement("div");
      empty.style.cssText = "padding:8px 10px;color:rgba(255,255,255,0.5);font-size:12px";
      empty.textContent = viaType
        ? tr("preview.noTypeModel", "（该类型暂无模型）")
        : tr("preview.noOtherModel", "（无其他模型）");
      listBody.appendChild(empty);
      return;
    }
    const activeTab = getActiveTab();
    for (const p of shown) {
      renderSwitchCandidateRow(listBody, p, ctx, curNorm, activeTab, viaType);
    }
  };

  const activeTab = getActiveTab();
  if (activeTab === "") {
    draw(ctx.getSiblings(), false);
    return;
  }
  void Promise.resolve(
    ctx.getModelsByType?.(activeTab, ctx.getCurrentSubtype?.()) ?? Promise.resolve([]),
  )
    .then((paths) => {
      if (gen !== reqGen.v) return; // 过期请求丢弃（P1-3）
      if (!listBody.parentNode) return; // 面板已关闭
      draw(paths ?? [], true);
    })
    .catch(() => {
      // P3-3：扫描失败优雅降级为空列表
      if (gen !== reqGen.v) return;
      if (!listBody.parentNode) return;
      draw([], true);
    });
}

// ===================================================================
// fillSwitch — 主函数
// ===================================================================

function fillSwitch(list: HTMLElement, ctx: PreviewMenuCtx): void {
  const rtypes = ctx.getTypeTabs?.() ?? [];
  const curRtype = ctx.getCurrentRtype?.() ?? "";
  // 阶段 1：默认高亮 tab 解析（记忆 → 当前类型 → 首项）
  let activeTab = resolveSwitchActiveTab(rtypes, curRtype);
  // 阶段 2：tabBar + 高亮更新回写
  const tabBar = buildSwitchTabBar(rtypes, activeTab, (key) => {
    activeTab = key;
    // runSwitchRenderRows 内部读 reqGen，直接触发重新拉取+绘制
    runSwitchRenderRows(listBody, ctx, () => activeTab, reqGen);
  });
  // 阶段 3：列表容器 + 代际守卫 state
  const listBody = document.createElement("div");
  listBody.style.cssText = "max-height:240px;overflow-y:auto";
  const reqGen = { v: 0 };
  // 阶段 4：挂 DOM + 首调 renderRows
  list.append(tabBar, listBody);
  runSwitchRenderRows(listBody, ctx, () => activeTab, reqGen);
}

/**
 * 角色面板（MikuMikuAR buildModelRootItems 移植，2026-08-20）：
 * 顶部列出已加载角色（sceneRegistry），行首 radio 切换焦点、点名字进详情
 * （按该角色 menuItems 的 model 组 panel 能力显示——vrm/mmd/ysm 各显所能，
 * 间接解决不同格式可查看内容不一致的问题）、行尾 ⚙ 进工具面板（卸载角色，
 * 少用但重要）；底部复用 fillSwitch 加载入口（siblings + 类型 tab）。
 */
/** 角色路径 basename：角色详情/工具面板标题复用（fillRoles 与 dock 🧍 捷径共享，防两处漂移）。
 *  剥离扩展名（.ysm/.json/.zip/.vrm/.pmx/.fbx/.litematic 等任意单段后缀）——
 *  用户实测 ysm.json 当标题反直觉：entry.path 可能指向包内入口文件（如 ysm.json），
 *  basename 直接展示会露出无意义的技术文件名；剥后缀后保留模型真名
 *  （如 [vup]子言-水手服(...)[VUP曼云]1.2.zip → [vup]子言-水手服(...)[VUP曼云]1.2）。 */
export function roleBaseName(e: ModelEntry): string {
  const base = e.path.split(/[/\\]/).pop() || e.path;
  // 剥最后一段 .ext（任意后缀，保留带点号的版本号如 1.2）
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

/**
 * 幂等注入 renderMenu 用的 CSS 类规则（仅注入一次，重复调用 no-op）。
 * 把内联 style.cssText 抽成类，避免 renderMenu 分支里重复硬编码样式串。
 */
let _menuStylesInjected = false;
function ensureMenuStyles(): void {
  if (_menuStylesInjected) return;
  const style = document.createElement("style");
  style.textContent = `
.cap-section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  min-height: 32px;
  cursor: pointer;
  user-select: none;
  font-size: 11px;
  color: rgba(255,255,255,0.6);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.cap-section-arrow {
  font-size: 10px;
  display: inline-block;
}
.menu-divider {
  height: 1px;
  background: rgba(255,255,255,0.1);
  margin: 6px 10px;
}
`;
  document.head.appendChild(style);
  _menuStylesInjected = true;
}

/**
 * 通用声明式渲染器（方案 A 第 2 步）：将 PreviewMenuNode[] 递归渲染进容器。
 *  - folder → 可折叠 section（testid = node.id，body testid = node.id + "-body"，兼容既有 e2e 选择器）
 *  - panel / action → 行（经 makeRow + navigate / run）
 *  - divider / sectionTitle → 轻量分隔/标题行
 *  - visibleWhen → 条件守卫（返回 false 不渲染）
 * 这是「单一渲染器吃树数据」的落点：新增/迁移菜单项时写 PreviewMenuNode 数据即可，
 * 渲染逻辑不随菜单项膨胀（对齐 MikuMikuAR renderMenu 范式）。
 */
export function renderMenu(
  container: HTMLElement,
  nodes: PreviewMenuNode[],
  deps: {
    makeRow: (node: PreviewMenuNode, opts?: { chevron?: boolean }) => HTMLElement;
    makePanelView: (node: PreviewMenuNode) => SlideMenuView;
    menu: SlideMenuHandle;
    actionCtx: PreviewActionMenuCtx;
  },
): void {
  ensureMenuStyles();
  for (const node of nodes) {
    if (node.visibleWhen && !node.visibleWhen()) continue;
    // folder：可折叠 section（kind==="folder" 或有 children）
    if (node.kind === "folder" || Array.isArray(node.children)) {
      const children = node.children ?? [];
      if (children.length === 0) continue;
      const section = document.createElement("div");
      section.dataset.testid = node.id;
      const header = document.createElement("div");
      header.className = "cap-section-header";
      const collapsed = node.defaultOpen === false;
      const arrow = document.createElement("span");
      arrow.textContent = collapsed ? "▸" : "▾";
      arrow.className = "cap-section-arrow";
      const title = document.createElement("span");
      title.textContent = node.labelKey ? tr(node.labelKey, node.fallback ?? node.id) : node.id;
      header.append(arrow, title);
      const body = document.createElement("div");
      body.dataset.testid = node.id + "-body";
      body.style.cssText = "display:" + (collapsed ? "none" : "block");
      header.addEventListener("click", (ev: MouseEvent): void => {
        ev.stopPropagation();
        const nowCollapsed = body.style.display === "none";
        body.style.display = nowCollapsed ? "block" : "none";
        arrow.textContent = nowCollapsed ? "▾" : "▸";
      });
      renderMenu(body, children, deps);
      section.append(header, body);
      container.appendChild(section);
      continue;
    }
    // field: 键值对行（统计/信息展示）
    if (node.kind === "field") {
      const row = document.createElement("div");
      row.className = "slide-item field-row";
      row.dataset.testid = "preview-" + node.id;
      const k = document.createElement("span"); k.className = "field-label"; k.textContent = node.labelKey ? tr(node.labelKey, node.id) : node.id;
      const v = document.createElement("span"); v.className = "field-value"; v.textContent = String(node.value ?? (node.labelKey ? tr(node.labelKey, node.id) : node.id));
      row.append(k, v);
      container.appendChild(row);
      continue;
    }
    // button: 操作按钮行
    if (node.kind === "button") {
      const row = document.createElement("div");
      row.className = "slide-item";
      row.dataset.testid = "preview-" + node.id;
      if (node.icon) { const ic = document.createElement("span"); ic.className = "slide-icon"; ic.textContent = node.icon; row.appendChild(ic); }
      const lb = document.createElement("span"); lb.className = "slide-label"; lb.textContent = node.labelKey ? tr(node.labelKey, node.id) : node.id; row.appendChild(lb);
      row.addEventListener("click", (ev: MouseEvent): void => {
        ev.stopPropagation();
        void node.action?.(deps.actionCtx);
      });
      container.appendChild(row);
      continue;
    }
    // row: 动态列表行（纹理/材质/bone 等）
    if (node.kind === "row") {
      const row = document.createElement("div");
      row.className = "slide-item";
      row.dataset.testid = "preview-" + node.id;
      if (node.icon) { const ic = document.createElement("span"); ic.className = "slide-icon"; ic.textContent = node.icon; row.appendChild(ic); }
      const lb = document.createElement("span"); lb.className = "slide-label"; lb.style.cssText = "font-size:12px"; lb.textContent = node.labelKey ? tr(node.labelKey, String(node.value || node.id)) : String(node.value || node.id); row.appendChild(lb);
      if (node.value && typeof node.value === "string") { const meta = document.createElement("span"); meta.className = "slide-sublabel"; meta.textContent = node.value; row.appendChild(meta); }
      row.addEventListener("click", (ev: MouseEvent): void => {
        ev.stopPropagation();
        void node.action?.(deps.actionCtx);
      });
      container.appendChild(row);
      continue;
    }
    // divider：轻量分隔线
    if (node.kind === "divider") {
      const hr = document.createElement("div");
      hr.dataset.testid = node.id;
      hr.className = "menu-divider";
      container.appendChild(hr);
      continue;
    }
    // sectionTitle：小标题行（不折叠）
    if (node.kind === "sectionTitle") {
      const st = document.createElement("div");
      st.dataset.testid = node.id;
      st.textContent = node.labelKey ? tr(node.labelKey, node.fallback ?? node.id) : node.id;
      st.className = "section-title";
      container.appendChild(st);
      continue;
    }
    // 叶节点：panel / action / custom —— 直接走 makeRow/navigate/action
    const row = deps.makeRow(node, { chevron: node.kind === "panel" });
    row.onclick = (ev: MouseEvent): void => {
      ev.stopPropagation();
      if (node.kind === "panel") {
        deps.menu.navigate(deps.makePanelView(node));
      } else if (node.action) {
        node.action(deps.actionCtx);
      }
    };
    container.appendChild(row);
  }
}

/**
 * 角色详情子面板（目标态「详情=模型信息面板本体」）：
 *  - model 组第一个 panel（恒为「模型信息」）→ renderCustom 直渲进详情主体（1 跳看内容，用户「最想进入」）；
 *  - 其余 model 项（截图/材质/骨骼）→ 工具区可折叠 section（点击 navigate 各自面板，不再平行平铺）；
 *  - motion 组 → 「动作」可折叠 section（dock 💃 直达时展开、模型主体隐藏）；
 *  - onSwitchRole → 详情底部工具行（不占首屏，用户批评「切换角色放第一位」）。
 * 模块级共享：fillRoles 点角色名进入；dock 🧍 / 💃 捷径直达。
 */
function roleDetailView(
  e: ModelEntry,
  deps: {
    makeRow: (node: PreviewMenuNode, opts?: { chevron?: boolean }) => HTMLElement;
    makePanelView: (node: PreviewMenuNode) => SlideMenuView;
    menu: SlideMenuHandle;
    actionCtx: PreviewActionMenuCtx;
    onSwitchRole?: () => void;
    initialSection?: "model" | "motion";
  },
): SlideMenuView {
  const modelItems = (e.menuItems ?? []).filter((d) => d.kind === "panel" && d.dockGroup === "model");
  const motionItems = (e.menuItems ?? []).filter((d) => d.kind === "panel" && d.dockGroup === "motion");
  const primary = modelItems[0];
  const toolItems = modelItems.slice(1);
  return {
    title: roleBaseName(e),
    render: (l) => {
      l.innerHTML = "";
      if (modelItems.length === 0 && motionItems.length === 0) {
        const empty = document.createElement("div");
        empty.style.cssText = "padding:8px 10px;color:rgba(255,255,255,0.5);font-size:12px";
        empty.textContent = tr("preview.roleNoDetail", "（该角色无可查看项）");
        l.appendChild(empty);
        return;
      }
      // ① 模型信息面板本体直渲（dock 🧍 / 默认聚焦模型时；💃 直达动作时隐藏本体）
      if (primary?.renderCustom && deps.initialSection !== "motion") {
        try {
          primary.renderCustom(l, () => deps.menu.back());
        } catch (err) {
          console.error("[preview-menu] 模型信息面板渲染失败", primary.id, err);
          const errRow = document.createElement("div");
          errRow.style.cssText = "padding:8px 10px;color:#ff7b7b;font-size:12px";
          errRow.textContent = "面板渲染失败: " + safeErrorMessage(err);
          l.appendChild(errRow);
        }
        const sep = document.createElement("div");
        sep.style.cssText = "height:1px;background:rgba(255,255,255,0.1);margin:6px 10px";
        l.appendChild(sep);
      }
      // ② 其余 model 项（截图/材质/骨骼）→ 工具区 section
      const sections: PreviewMenuNode[] = [];
      if (toolItems.length > 0) {
        sections.push({
          id: "preview-role-tools",
          kind: "folder",
          labelKey: "preview.roleToolsSection",
          fallback: "工具",
          defaultOpen: deps.initialSection === "motion",
          children: toolItems,
        });
      }
      // ③ motion 组 → 动作 section
      if (motionItems.length > 0) {
        sections.push({
          id: "preview-role-motion",
          kind: "folder",
          labelKey: "preview.roleMotionSection",
          fallback: "动作",
          defaultOpen: deps.initialSection === "motion",
          children: motionItems,
        });
      }
      // ④ onSwitchRole → 详情底部「切换角色 ›」工具行（不占首屏）
      if (deps.onSwitchRole) {
        sections.push({
          // id 不带 preview- 前缀：makeRow 渲染时自动补 preview- 前缀（data-testid="preview-role-switch"）
          id: "role-switch",
          kind: "action",
          labelKey: "preview.switchRole",
          fallback: "切换角色 ›",
          icon: "🎭",
          action: (): void => {
            deps.onSwitchRole?.();
          },
        });
      }
      renderMenu(l, sections, deps);
    },
  };
}

function fillRoles(
  list: HTMLElement,
  ctx: PreviewMenuCtx,
  closePopup: () => void,
  makeRow: (node: PreviewMenuNode, opts?: { chevron?: boolean }) => HTMLElement,
  makePanelView: (node: PreviewMenuNode) => SlideMenuView,
  menu: SlideMenuHandle,
  setAdapterItems: (items: PreviewMenuNode[]) => void,
): void {
  // 真 action ctx：从 PreviewMenuCtx 取 toast/closeAllOverlays
  const actionCtx: PreviewActionMenuCtx = {
    toast: ctx.toast,
    closeAllOverlays: ctx.closeAllOverlays,
  };
  list.innerHTML = "";

  // ---- 角色列表区（radio 焦点 + 名字详情 + ⚙ 工具）----
  const rolesBox = document.createElement("div");
  rolesBox.dataset.testid = "preview-roles-list";
  rolesBox.style.cssText = "max-height:220px;overflow-y:auto";
  list.appendChild(rolesBox);

  const renderRoles = (): void => {
    rolesBox.innerHTML = "";
    const entries = sceneRegistry.getAll();
    if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.dataset.testid = "preview-roles-empty";
      empty.style.cssText = "padding:8px 10px;color:rgba(255,255,255,0.5);font-size:12px";
      empty.textContent = tr("preview.noRoles", "（无已加载角色）");
      rolesBox.appendChild(empty);
      return;
    }
    const activeId = sceneRegistry.getActiveId();
    for (const e of entries) {
      const isActive = e.id === activeId;
      const row = document.createElement("div");
      row.dataset.testid = "preview-role-row";
      row.dataset.roleId = e.id;
      row.style.cssText =
        "display:flex;align-items:center;gap:6px;padding:6px 8px;border-radius:6px;cursor:pointer;font-size:13px" +
        (isActive ? ";background:rgba(124,131,255,0.25)" : "");
      // 行首 radio：点击切换焦点（对齐 MikuMikuAR leading 按钮）
      const radio = document.createElement("button");
      radio.dataset.testid = "preview-role-focus";
      radio.textContent = isActive ? "●" : "○";
      attachTooltip(radio, () => tr("preview.roleFocus", "设为焦点"));
      radio.style.cssText =
        "width:18px;height:18px;flex-shrink:0;background:transparent;border:none;cursor:pointer;font-size:14px;line-height:1" +
        (isActive ? ";color:#7c83ff" : ";color:rgba(255,255,255,0.5)");
      radio.onclick = (ev): void => {
        ev.stopPropagation();
        sceneRegistry.setActive(e.id);
        // setActive 仅在 menuItems truthy 时经 menuSink 换菜单；无专属项的角色
        // 需显式清空 dock 适配器项，避免残留上一角色的菜单（code_review P2）
        if (!e.menuItems) setAdapterItems([]);
        renderRoles();
      };
      // 角色名：点击 → 详情子面板（该角色能力内的 model 组面板项）
      const name = document.createElement("span");
      name.dataset.testid = "preview-role-name";
      name.textContent = roleBaseName(e);
      attachTooltip(name, e.path);
      name.style.cssText = "flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
      row.onclick = (): void => {
        menu.navigate(roleDetailView(e, { makeRow, makePanelView, menu, actionCtx }));
      };
      // 行尾 ⚙：工具面板（卸载角色等少用但重要操作）
      const tools = document.createElement("button");
      tools.dataset.testid = "preview-role-tools";
      tools.textContent = "⚙";
      attachTooltip(tools, () => tr("preview.roleTools", "模型工具"));
      tools.style.cssText =
        "width:22px;height:22px;flex-shrink:0;background:rgba(255,255,255,0.08);border:none;border-radius:4px;cursor:pointer;font-size:13px;line-height:1";
      tools.onclick = (ev): void => {
        ev.stopPropagation();
        menu.navigate(toolsView(e));
      };
      row.append(radio, name, tools);
      rolesBox.appendChild(row);
    }
  };

  // ---- 工具子面板：少用但重要（卸载角色）----
  const toolsView = (e: ModelEntry): SlideMenuView => ({
    title: `${roleBaseName(e)} ${tr("preview.roleTools", "模型工具")}`,
    render: (l) => {
      l.innerHTML = "";
      const unload = document.createElement("div");
      unload.dataset.testid = "preview-role-unload";
      unload.textContent = "🗑 " + tr("preview.unloadRole", "卸载角色");
      unload.style.cssText =
        "display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;cursor:pointer;font-size:13px;color:#ff7b7b";
      unload.onclick = (): void => {
        ctx.unloadRole?.(e.id);
        closePopup();
      };
      l.appendChild(unload);
    },
  });

  renderRoles();

  // ---- 分隔线 + 加载入口（复用 switch 面板：siblings + 类型 tab + 手动输入）----
  const sep = document.createElement("div");
  sep.style.cssText = "height:1px;background:rgba(255,255,255,0.1);margin:6px 10px";
  list.appendChild(sep);
  fillSwitch(list, ctx);
}

/** 能力面板通用渲染：cap 存在 → renderCapControls；不存在 → 渲染单行 fallback 提示 */
function fillCapOrFallback(
  list: HTMLElement,
  cap: { getMenuControls: () => MenuControlDef[] } | null | undefined,
  noCapKey: string,
  noCapFallback: string,
): void {
  if (!cap) {
    const row = document.createElement("div");
    row.style.cssText = "padding:8px 10px;color:rgba(255,255,255,0.5);font-size:12px";
    row.textContent = tr(noCapKey, noCapFallback);
    list.appendChild(row);
    return;
  }
  renderCapControls(list, cap.getMenuControls());
}

// ===================================================================
// fillSettings — 子函数
// ===================================================================

/** 设置分组标题样式（性能/画质两段共享，避免重复硬编码 cssText） */
function appendSettingsHeader(list: HTMLElement, labelKey: string, fallback: string, extraPad = false): void {
  const h = document.createElement("div");
  h.style.cssText =
    (extraPad ? "padding:12px 10px 4px;" : "padding:8px 10px 4px;") +
    "font-size:11px;color:rgba(255,255,255,0.6);text-transform:uppercase;letter-spacing:0.5px";
  h.textContent = tr(labelKey, fallback);
  list.appendChild(h);
}

/** [子函数 1/4] 性能组：视锥裁剪 toggle + 帧率上限 select */
function appendSettingsPerfGroup(list: HTMLElement): void {
  appendSettingsHeader(list, "preview.settingsPerf", "性能");

  // 视锥裁剪开关
  const cullRow = document.createElement("div");
  cullRow.className = "slide-item";
  cullRow.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 10px";
  const cullLabelBox = document.createElement("div");
  cullLabelBox.style.cssText = "flex:1;display:flex;align-items:center;gap:8px;min-width:0";
  const cullLabel = document.createElement("span");
  cullLabel.className = "slide-label";
  cullLabel.textContent = tr("preview.settingsFrustumCull", "视锥裁剪");
  cullLabel.style.fontSize = "12px";
  const cullHint = document.createElement("span");
  cullHint.style.cssText =
    "font-size:11px;color:rgba(255,255,255,0.45);overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
  cullHint.textContent = tr("preview.settingsFrustumCullHint", "镜头外模型跳过渲染，省 GPU");
  cullLabelBox.append(cullLabel, cullHint);
  const cullToggle = createHeaderToggle({
    value: isFrustumCullEnabled(),
    onChange: (v: boolean): void => setFrustumCullEnabled(v),
    bind: (): boolean => isFrustumCullEnabled(),
  });
  cullRow.append(cullLabelBox, cullToggle);
  list.appendChild(cullRow);

  // 帧率上限 select（控制 render-budget 的 getFrameIntervalMs，30/60/120/不限）
  const fpsRow = document.createElement("div");
  fpsRow.className = "slide-item";
  fpsRow.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 10px";
  const fpsLabel = document.createElement("span");
  fpsLabel.className = "slide-label";
  fpsLabel.textContent = tr("preview.settingsMaxFps", "帧率上限");
  fpsLabel.style.cssText = "flex:1;font-size:12px";
  const fpsSel = document.createElement("select");
  fpsSel.className = "setting-select";
  fpsSel.style.cssText = "font-size:11px;padding:2px 4px";
  const FPS_OPTIONS: Array<{ value: string; labelKey: string; fallback: string }> = [
    { value: "30", labelKey: "preview.settingsFps30", fallback: "30 fps" },
    { value: "60", labelKey: "preview.settingsFps60", fallback: "60 fps" },
    { value: "120", labelKey: "preview.settingsFps120", fallback: "120 fps" },
    { value: "0", labelKey: "preview.settingsFpsUncapped", fallback: "不限" },
  ];
  for (const opt of FPS_OPTIONS) {
    const o = document.createElement("option");
    o.value = opt.value;
    o.textContent = tr(opt.labelKey, opt.fallback);
    fpsSel.appendChild(o);
  }
  fpsSel.value = String(getMaxFps());
  fpsSel.onchange = (): void => {
    safeSet(MAX_FPS_KEY, fpsSel.value);
    invalidateMaxFpsCache();
  };
  fpsRow.append(fpsLabel, fpsSel);
  list.appendChild(fpsRow);
}

/** [子函数 2/4] 画质组：渲染分辨率 slider */
function appendSettingsQualityResCap(list: HTMLElement): void {
  appendSettingsHeader(list, "preview.settingsQuality", "画质", true);
  const resCap = getMaxPixelRatio();
  const resRow = document.createElement("div");
  resRow.className = "slide-item";
  resRow.style.cssText = "display:flex;flex-direction:column;gap:4px;padding:6px 10px";
  const resHead = document.createElement("div");
  resHead.style.cssText = "display:flex;justify-content:space-between;font-size:13px;color:rgba(255,255,255,0.7)";
  const resName = document.createElement("span");
  resName.className = "slide-label";
  resName.textContent = tr("preview.settingsMaxPixelRatio", "渲染分辨率上限");
  const resVal = document.createElement("span");
  resVal.textContent = `${resCap.toFixed(2)}x`;
  resHead.append(resName, resVal);
  const resSlider = document.createElement("input");
  resSlider.type = "range";
  resSlider.min = "0.5";
  resSlider.max = "2";
  resSlider.step = "0.25";
  resSlider.value = String(resCap);
  resSlider.style.cssText = "width:100%;cursor:pointer;accent-color:var(--accent,#7c83ff)";
  resSlider.oninput = (): void => {
    const v = Number(resSlider.value);
    safeSet(MAX_PIXEL_RATIO_KEY, String(v));
    resVal.textContent = `${v.toFixed(2)}x`;
  };
  resRow.append(resHead, resSlider);
  list.appendChild(resRow);
}

/** [子函数 3/4] 画质组：cap 条件开关（Bloom / PMREM）。cap 不存在不渲染控件。 */
function appendSettingsQualityCapToggles(list: HTMLElement): void {
  type CapToggle = { isEnabled(): boolean; setEnabled(v: boolean): void };
  const candidates: Array<{
    capId: string;
    labelKey: string;
    fallback: string;
    importAssert: (_: unknown) => asserts _ is CapToggle;
  }> = [
    {
      capId: "postprocessing",
      labelKey: "preview.settingsBloom",
      fallback: "Bloom 辉光",
      importAssert: (_): asserts _ is CapToggle => {},
    },
    {
      capId: "sky",
      labelKey: "preview.settingsPmrem",
      fallback: "PMREM 环境光",
      importAssert: (_): asserts _ is CapToggle => {},
    },
  ];
  for (const c of candidates) {
    const raw = sceneCapabilityRegistry.getById(c.capId);
    if (!raw) continue;
    c.importAssert(raw); // no-op：下面直接鸭子类型读取
    const cap = raw as CapToggle;
    if (typeof cap.isEnabled !== "function" || typeof cap.setEnabled !== "function") continue;
    const row = document.createElement("div");
    row.className = "slide-item";
    row.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 10px";
    const label = document.createElement("span");
    label.className = "slide-label";
    label.textContent = tr(c.labelKey, c.fallback);
    label.style.cssText = "flex:1;font-size:12px";
    const toggle = createHeaderToggle({
      value: cap.isEnabled(),
      onChange: (v: boolean): void => cap.setEnabled(v),
      bind: (): boolean => cap.isEnabled(),
    });
    row.append(label, toggle);
    list.appendChild(row);
  }
}

/** [子函数 4/4] 设置面板尾注（分辨率热更新说明） */
function appendSettingsNote(list: HTMLElement): void {
  const note = document.createElement("div");
  note.style.cssText =
    "padding:8px 10px;font-size:11px;color:rgba(255,255,255,0.4);line-height:1.5";
  note.textContent = tr(
    "preview.settingsNote",
    "分辨率上限需重新进入 3D 预览生效；其余开关即时生效。"
  );
  list.appendChild(note);
}

// ===================================================================
// fillSettings — 主函数
// ===================================================================

/**
 * 设置面板：3D 预览器的性能 / 画质总开关。
 *
 * 定位（2026-08-23 用户决策）：设置面板 = 性能/画质开关，
 * 与 🌍 环境面板（管环境能力参数）职责正交。
 *
 * 分组：
 * - ⚡ 性能：视锥裁剪开关（多模型同框省渲染）——关掉后镜头外模型仍渲染
 * - 🎨 画质：渲染分辨率上限（控制 pixelRatio cap）——降分辨率换帧率
 *
 * 后续可加：帧率上限、Bloom 总开关、PMREM 开关、能力检测降级等。
 * 每个开关都走 localStorage 持久化，用户调了即时生效。
 */
function fillSettings(list: HTMLElement, _ctx: PreviewMenuCtx): void {
  list.innerHTML = "";
  // 阶段1：⚡ 性能组（视锥裁剪 + 帧率上限）
  appendSettingsPerfGroup(list);
  // 阶段2：🎨 画质组（分辨率上限 slider）
  appendSettingsQualityResCap(list);
  // 阶段3：🎨 画质条件开关（Bloom/PMREM，cap 不存在不渲染）
  appendSettingsQualityCapToggles(list);
  // 阶段4：尾注说明
  appendSettingsNote(list);
}

// ── 声明式 Schema 构建器（供 schemaBuilders 映射调用）──

/** 相机面板 schema：wrap buildCameraControls 为声明式节点 */
function buildCameraSchema(ctx: PreviewMenuCtx): PreviewMenuNode[] {
  return [{
    id: "camera",
    kind: "custom",
    labelKey: "preview.cameraView",
    fallback: "视图",
    icon: "🎥",
    renderCustom: (list: HTMLElement): void => {
      buildCameraControls(list, ctx.getCamBridge());
    },
  }];
}

/** 灯光面板 schema：从 light cap 自报控件渲染 */
function buildLightingSchema(ctx: PreviewMenuCtx): PreviewMenuNode[] {
  const lightFromReg = sceneCapabilityRegistry.getById("light") as import("../caps/light-capability.ts").LightCapability | null;
  const lightCap = lightFromReg ?? (() => {
    const fromCtx = ctx.getLightCap();
    if (fromCtx && "getMenuControls" in fromCtx) return fromCtx as unknown as import("../caps/light-capability.ts").LightCapability;
    return null;
  })();
  if (!lightCap) {
    return [{ id: "lighting-empty", kind: "custom", renderCustom: (list) => {
      const row = document.createElement("div");
      row.style.cssText = "padding:8px 10px;color:rgba(255,255,255,0.5);font-size:12px";
      row.textContent = tr("preview.noLightCap", "进入 3D 后再打开灯光面板");
      list.appendChild(row);
    }}];
  }
  return [{ id: "lighting", kind: "custom", renderCustom: (list) => {
    renderCapControls(list, lightCap.getMenuControls());
  }}];
}

/** 阴影面板 schema：从 shadow cap 自报控件渲染 */
function buildShadowSchema(ctx: PreviewMenuCtx): PreviewMenuNode[] {
  const fromReg = sceneCapabilityRegistry.getById("shadow") as import("../caps/shadow-capability.ts").ShadowCapability | null;
  if (!fromReg) {
    return [{ id: "shadow-empty", kind: "custom", renderCustom: (list) => {
      const row = document.createElement("div");
      row.style.cssText = "padding:8px 10px;color:rgba(255,255,255,0.5);font-size:12px";
      row.textContent = tr("preview.noShadowCap", "进入 3D 后再打开阴影面板");
      list.appendChild(row);
    }}];
  }
  return [{ id: "shadow", kind: "custom", renderCustom: (list) => {
    renderCapControls(list, fromReg.getMenuControls());
  }}];
}

/** 后处理面板 schema：从 postprocessing cap 自报控件渲染 */
function buildPostprocessingSchema(ctx: PreviewMenuCtx): PreviewMenuNode[] {
  const fromReg = sceneCapabilityRegistry.getById("postprocessing") as import("../caps/postprocessing-capability.ts").PostprocessingCapability | null;
  if (!fromReg) {
    return [{ id: "postproc-empty", kind: "custom", renderCustom: (list) => {
      const row = document.createElement("div");
      row.style.cssText = "padding:8px 10px;color:rgba(255,255,255,0.5);font-size:12px";
      row.textContent = tr("preview.noPostprocCap", "进入 3D 后再打开后处理面板");
      list.appendChild(row);
    }}];
  }
  return [{ id: "postproc", kind: "custom", renderCustom: (list) => {
    renderCapControls(list, fromReg.getMenuControls());
  }}];
}

/** 设置面板 schema：性能/画质开关声明式节点 */
function buildSettingsSchema(ctx: PreviewMenuCtx): PreviewMenuNode[] {
  const nodes: PreviewMenuNode[] = [];
  // ⚡ 性能分组标题
  nodes.push({ id: "settings-perf-header", kind: "sectionTitle", labelKey: "preview.settingsPerf", fallback: "性能" });
  // 视锥裁剪 toggle
  nodes.push({
    id: "settings-frustum-cull",
    kind: "custom",
    labelKey: "preview.settingsFrustumCull",
    fallback: "视锥裁剪",
    renderCustom: (list: HTMLElement): void => {
      const row = document.createElement("div");
      row.className = "slide-item";
      row.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 10px";
      const labelBox = document.createElement("div");
      labelBox.style.cssText = "flex:1;display:flex;align-items:center;gap:8px;min-width:0";
      const label = document.createElement("span");
      label.className = "slide-label";
      label.textContent = tr("preview.settingsFrustumCull", "视锥裁剪");
      label.style.fontSize = "12px";
      const hint = document.createElement("span");
      hint.style.cssText = "font-size:11px;color:rgba(255,255,255,0.45);overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
      hint.textContent = tr("preview.settingsFrustumCullHint", "镜头外模型跳过渲染，省 GPU");
      labelBox.append(label, hint);
      const toggle = createHeaderToggle({
        value: isFrustumCullEnabled(),
        onChange: (v: boolean): void => setFrustumCullEnabled(v),
        bind: (): boolean => isFrustumCullEnabled(),
      });
      row.append(labelBox, toggle);
      list.appendChild(row);
    },
  });
  // 帧率上限 select
  nodes.push({
    id: "settings-fps",
    kind: "custom",
    labelKey: "preview.settingsMaxFps",
    fallback: "帧率上限",
    renderCustom: (list: HTMLElement): void => {
      const row = document.createElement("div");
      row.className = "slide-item";
      row.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 10px";
      const label = document.createElement("span");
      label.className = "slide-label";
      label.textContent = tr("preview.settingsMaxFps", "帧率上限");
      label.style.cssText = "flex:1;font-size:12px";
      const sel = document.createElement("select");
      sel.className = "setting-select";
      sel.style.cssText = "font-size:11px;padding:2px 4px";
      const FPS_OPTIONS: Array<{ value: string; labelKey: string; fallback: string }> = [
        { value: "30", labelKey: "preview.settingsFps30", fallback: "30 fps" },
        { value: "60", labelKey: "preview.settingsFps60", fallback: "60 fps" },
        { value: "120", labelKey: "preview.settingsFps120", fallback: "120 fps" },
        { value: "0", labelKey: "preview.settingsFpsUncapped", fallback: "不限" },
      ];
      for (const opt of FPS_OPTIONS) {
        const o = document.createElement("option");
        o.value = opt.value;
        o.textContent = tr(opt.labelKey, opt.fallback);
        sel.appendChild(o);
      }
      sel.value = String(getMaxFps());
      sel.onchange = (): void => {
        safeSet(MAX_FPS_KEY, sel.value);
        invalidateMaxFpsCache();
      };
      row.append(label, sel);
      list.appendChild(row);
    },
  });
  // 🎨 画质分组标题
  nodes.push({ id: "settings-quality-header", kind: "sectionTitle", labelKey: "preview.settingsQuality", fallback: "画质" });
  // 渲染分辨率上限 slider
  nodes.push({
    id: "settings-pixel-ratio",
    kind: "custom",
    labelKey: "preview.settingsMaxPixelRatio",
    fallback: "渲染分辨率上限",
    renderCustom: (list: HTMLElement): void => {
      const resCap = getMaxPixelRatio();
      const row = document.createElement("div");
      row.className = "slide-item";
      row.style.cssText = "display:flex;flex-direction:column;gap:4px;padding:6px 10px";
      const head = document.createElement("div");
      head.style.cssText = "display:flex;justify-content:space-between;font-size:13px;color:rgba(255,255,255,0.7)";
      const name = document.createElement("span");
      name.className = "slide-label";
      name.textContent = tr("preview.settingsMaxPixelRatio", "渲染分辨率上限");
      const val = document.createElement("span");
      val.textContent = `${resCap.toFixed(2)}x`;
      head.append(name, val);
      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = "0.5";
      slider.max = "2";
      slider.step = "0.25";
      slider.value = String(resCap);
      slider.style.cssText = "width:100%;cursor:pointer;accent-color:var(--accent,#7c83ff)";
      slider.oninput = (): void => {
        const v = Number(slider.value);
        safeSet(MAX_PIXEL_RATIO_KEY, String(v));
        val.textContent = `${v.toFixed(2)}x`;
      };
      row.append(head, slider);
      list.appendChild(row);
    },
  });
  // Bloom 开关（cap 存在时）
  const ppCap = sceneCapabilityRegistry.getById("postprocessing") as
    | (import("../caps/postprocessing-capability.ts").PostprocessingCapability & {
        setEnabled(v: boolean): void;
        isEnabled(): boolean;
      })
    | undefined;
  if (ppCap) {
    nodes.push({
      id: "settings-bloom",
      kind: "custom",
      labelKey: "preview.settingsBloom",
      fallback: "Bloom 辉光",
      renderCustom: (list: HTMLElement): void => {
        const row = document.createElement("div");
        row.className = "slide-item";
        row.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 10px";
        const label = document.createElement("span");
        label.className = "slide-label";
        label.textContent = tr("preview.settingsBloom", "Bloom 辉光");
        label.style.cssText = "flex:1;font-size:12px";
        const toggle = createHeaderToggle({
          value: ppCap.isEnabled(),
          onChange: (v: boolean): void => ppCap.setEnabled(v),
          bind: (): boolean => ppCap.isEnabled(),
        });
        row.append(label, toggle);
        list.appendChild(row);
      },
    });
  }
  // PMREM 开关（cap 存在时）
  const skyCap = sceneCapabilityRegistry.getById("sky") as
    | (import("../caps/sky-capability.ts").SkyCapability & {
        setEnvironmentEnabled(v: boolean): void;
        isEnvironmentEnabled(): boolean;
      })
    | undefined;
  if (skyCap) {
    nodes.push({
      id: "settings-pmrem",
      kind: "custom",
      labelKey: "preview.settingsPmrem",
      fallback: "PMREM 环境光",
      renderCustom: (list: HTMLElement): void => {
        const row = document.createElement("div");
        row.className = "slide-item";
        row.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 10px";
        const label = document.createElement("span");
        label.className = "slide-label";
        label.textContent = tr("preview.settingsPmrem", "PMREM 环境光");
        label.style.cssText = "flex:1;font-size:12px";
        const toggle = createHeaderToggle({
          value: skyCap.isEnvironmentEnabled(),
          onChange: (v: boolean): void => skyCap.setEnvironmentEnabled(v),
          bind: (): boolean => skyCap.isEnvironmentEnabled(),
        });
        row.append(label, toggle);
        list.appendChild(row);
      },
    });
  }
  // 说明文字
  nodes.push({ id: "settings-note", kind: "custom", renderCustom: (list) => {
    const note = document.createElement("div");
    note.style.cssText = "padding:8px 10px;font-size:11px;color:rgba(255,255,255,0.4);line-height:1.5";
    note.textContent = tr("preview.settingsNote", "分辨率上限需重新进入 3D 预览生效；其余开关即时生效。");
    list.appendChild(note);
  }});
  return nodes;
}
