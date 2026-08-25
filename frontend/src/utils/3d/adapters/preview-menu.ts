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
import { safeGet, safeSet } from "../../../utils/dom/storage.ts";
import { t } from "../../../core/i18n/t.ts";
import type { MenuControlDef, SceneCapability } from "../caps/scene-capability.ts";
import { sceneCapabilityRegistry } from "../caps/scene-capability-registry.ts";
import { ENV_PRESET_LINKAGE, type EnvPresetId } from "../caps/environment-capability.ts";
import { sceneRegistry, type ModelEntry } from "./scene-registry.ts";
import type { FogCapability } from "../caps/fog-capability.ts";
import { isFrustumCullEnabled, setFrustumCullEnabled } from "../frustum-cull.ts";
import { getMaxFps, invalidateMaxFpsCache, MAX_FPS_KEY, getMaxPixelRatio, MAX_PIXEL_RATIO_KEY } from "../render-budget.ts";

/**
 * 空桩 action ctx：适配器动作目前拿不到真 ctx（PreviewMenuCtx 无 toast/setStatus/closeAllOverlays 字段）。
 * 收敛成单一常量避免五处调用点重复字面量漂移；接真 ctx 时只需改这一处。
 */
const noopActionCtx: PreviewActionMenuCtx = {
  toast: () => {},
  setStatus: () => {},
  closeAllOverlays: () => {},
};

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
  /** 适配器注入声明式节点（内部转换为 PreviewMenuItemDef 兼容渲染链） */
  setAdapterItems(items: PreviewMenuNode[]): void;
  openPanel(id: string): void;
  refreshDock(): void;
}

/** 挂载预览底部根菜单，返回句柄 */
export function mountPreviewRootMenu(overlay: HTMLElement, ctx: PreviewMenuCtx): PreviewMenuHandle {
  ensureFabStyles();

  // ---- 底部 dock 容器 ----
  const dock = document.createElement("div");
  dock.className = "preview-dock-nav";
  overlay.appendChild(dock);

  // ---- SlideMenu 外壳（复用 MikuMikuAR 迁移组件）----
  const popup = document.createElement("div");
  popup.className = "ysm-preview-menu";
  popup.style.cssText =
    "position:absolute;left:16px;bottom:84px;width:300px;max-height:70vh;" +
    "display:none;z-index:25";
  overlay.appendChild(popup);

  const menu = createSlideMenu({ title: "", closeIcon: "✕" });
  popup.appendChild(menu.root);
  // 兼容既有 e2e 选择器：关闭按钮保留 preview-close-3d
  menu.root.querySelector<HTMLElement>(".slide-back")?.setAttribute("id", "preview-close-3d");

  const showMenu = (view: SlideMenuView): void => {
    menu.home(view);
    popup.style.display = "flex";
  };
  const hideMenu = (): void => {
    // 仅隐藏：display:none，DOM+导航栈保留（不调 menu.reset()）。
    // 这样「再点渲染器」能恢复【同一个面板】而非空白，且 ✕/← 语义不串。
    popup.style.display = "none";
  };
  // 根级 ✕（SlideMenu onClose）语义 = 关闭整个 3D 预览（对齐旧 close 菜单项）
  menu.setOnClose(() => {
    hideMenu();
    ctx.close();
  });

  // ---- 行/分隔线工厂 ----
  const makeRow = (node: PreviewMenuNode, opts?: { chevron?: boolean }): HTMLElement => {
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
    // 可下钻面板 → 右侧装饰箭头（导航提示：点击进入下级菜单）
    if (opts?.chevron) {
      const chev = document.createElement("span");
      chev.textContent = ">";
      chev.dataset.testid = "row-chevron";
      chev.style.cssText = "margin-left:auto;font-size:13px;font-weight:700;opacity:0.4;user-select:none";
      row.append(chev);
    }
    row.onmouseenter = (): void => {
      row.style.background = "rgba(255,255,255,0.08)";
    };
    row.onmouseleave = (): void => {
      row.style.background = "transparent";
    };
    return row;
  };

  // ---- core 填充器 ----
  // environment 需要 menu 句柄实现两级下钻；其余 filler 仅 list 即可。
  // menuHandleOut：roles 面板 radio 切换焦点后需清空 dock 适配器项，但 handle
  // 在函数末尾才构造——先声明占位，fillRoles 点击回调经闭包取用（调用时已赋值）。
  let menuHandleOut: PreviewMenuHandle | null = null;
  // ---- 声明式 Schema 构建器（方案 A 迁移：面板 → PreviewMenuNode[]）----
  // 优先用 schema 渲染，衰退到 fillers / def.render。
  type SchemaBuilder = (menu?: SlideMenuHandle) => PreviewMenuNode[];
  const schemaBuilders: Record<string, SchemaBuilder> = {
    lighting: (_menu) => buildLightingSchema(ctx),
    shadow: () => buildShadowSchema(ctx),
    postproc: () => buildPostprocessingSchema(ctx),
    settings: () => buildSettingsSchema(ctx),
    camera: () => buildCameraSchema(ctx),
  };

  const fillers: Record<string, (list: HTMLElement, menu?: SlideMenuHandle) => void> = {
    environment: (list, menu) => renderEnvLevel(list, ctx, menu),
    roles: (list, menu) => fillRoles(list, ctx, hideMenu, makeRow, makePanelView, menu!, (items) => menuHandleOut?.setAdapterItems(items)),
  };
  const runners: Record<string, () => void> = {
    close: () => ctx.close(),
  };

  // ---- 适配器注入项 ----
  let adapterItems: PreviewMenuNode[] = [];

  /** 渲染声明式节点数组为面板内容（不同于 renderMenu 的菜单行，这里是直接渲染内容） */
  const renderSchemaContent = (list: HTMLElement, nodes: PreviewMenuNode[]): void => {
    for (const node of nodes) {
      if (node.visibleWhen && !node.visibleWhen()) continue;
      if (node.kind === "sectionTitle") {
        const st = document.createElement("div");
        st.className = "section-title";
        st.dataset.testid = node.id;
        st.textContent = node.labelKey ? tr(node.labelKey, node.fallback ?? node.id) : node.id;
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
        const k = document.createElement("span"); k.className = "field-label"; k.textContent = node.labelKey ? tr(node.labelKey, node.id) : node.id;
        const v = document.createElement("span"); v.className = "field-value"; v.textContent = String(node.value ?? (node.labelKey ? tr(node.labelKey, node.id) : node.id));
        row.append(k, v);
        list.appendChild(row);
        continue;
      }
      // custom / 默认：renderCustom 逃生舱
      const fn = node.renderCustom;
      if (fn) {
        fn(list, hideMenu);
        continue;
      }
    }
  };

  const renderPanel = (list: HTMLElement, node: PreviewMenuNode): void => {
    list.innerHTML = "";
    try {
      // 优先声明式 Schema；其次 renderCustom 逃生舱；最后 fillers 映射
      if (schemaBuilders[node.id]) {
        renderSchemaContent(list, schemaBuilders[node.id]!(menu));
      } else if (node.renderCustom) {
        node.renderCustom(list, () => hideMenu());
      } else if (node.action) {
        node.action(noopActionCtx);
      } else {
        fillers[node.id]?.(list, menu);
      }
    } catch (err) {
      console.error("[preview-menu] renderPanel FAILED", node.id, err);
      const errRow = document.createElement("div");
      errRow.style.cssText = "padding:8px 10px;color:#ff7b7b;font-size:12px";
      errRow.textContent = "面板渲染失败: " + safeErrorMessage(err);
      list.appendChild(errRow);
    }
  };

  const makePanelView = (node: PreviewMenuNode): SlideMenuView => ({
    title: tr(node.labelKey ?? node.id, node.fallback ?? node.id),
    render: (list) => renderPanel(list, node),
  });

  /** 组根视图：列出组内项，点击 navigate 下钻面板 / action 直接执行 */
  const makeGroupView = (g: PreviewMenuGroupDef, groupItems: PreviewMenuNode[]): SlideMenuView => ({
    title: g.fallback,
    render: (list) => {
      list.innerHTML = "";
      groupItems.forEach((node) => {
        // panel 型 → 下钻导航，带 ">" 装饰箭头提示可进入
        const row = makeRow(node, { chevron: node.kind === "panel" });
        row.onclick = (e: MouseEvent): void => {
          e.stopPropagation();
          if (node.kind === "panel") {
            menu.navigate(makePanelView(node));
          } else if (node.action) {
            hideMenu();
            node.action(noopActionCtx);
          }
        };
        list.appendChild(row);
      });
    },
  });

  // ---- 底部 dock 渲染（能力驱动）----
  const renderDock = (): void => {
    dock.innerHTML = "";
    const allItems = [...CORE_MENU_ITEMS, ...adapterItems];
    // 组内工具过滤链（model 特殊分支与通用分支共用，防两处漂移——审核 P3）
    const groupItemsFor = (g: PreviewMenuGroupDef, allItems: PreviewMenuNode[]): PreviewMenuNode[] =>
      allItems
        .filter((d) => d.dockGroup === g.id && d.kind !== "divider")
        .filter((d) => !(d.sharedOnly && ctx.selfMode))
        .filter((d) => !(d.hideInSelfMode && ctx.selfMode))
        .filter((d) => !(d.requiresEnvironment && !sceneCapabilityRegistry.getById("sky") && !sceneCapabilityRegistry.getById("ground") && !ctx.getSkyCap() && !ctx.getGroundCap()));
    PREVIEW_MENU_GROUPS.forEach((g) => {
      const groupItems = groupItemsFor(g, allItems);
      if (groupItems.length === 0) return;

      const btn = document.createElement("button");
      btn.className = "preview-dock-navbtn";
      btn.dataset.testid = "dock-" + g.id;
      btn.innerHTML = `<span class="preview-ic">${g.icon}</span><span class="preview-dock-navlabel">${g.fallback}</span>`;
      btn.onclick = (e: MouseEvent): void => {
        e.stopPropagation();
        // 🧍 模型组：恒进 roles 角色列表（加载/切换模型入口，新手流第一跳）。
        // 点角色名 → 详情（模型信息面板本体 + 工具/动作 section）。
        // 不做「直达活跃角色详情」——用户实测反馈：🧍 直接跳模型介绍反直觉，
        // 切换模型被迫绕二级；列表点角色名同样 1 跳进详情，且切换不绕路。
        const isModelShortcut = g.id === "model";
        const rolesDef = allItems.find((d) => d.id === "roles" && d.kind === "panel");
        if (isModelShortcut) {
          if (rolesDef) {
            showMenu(makePanelView(rolesDef));
            return;
          }
        }
        // 💃 动作组：存在活跃角色且有其技能（menuItems）→ 直达其详情聚焦动作 section（1 跳播放）；
        // 否则回退组根。per-model 工具 + play/perception 统一收进角色详情。
        if (g.id === "motion") {
          const active = sceneRegistry.getActiveId()
            ? sceneRegistry.getAll().find((x) => x.id === sceneRegistry.getActiveId())
            : undefined;
          if (active?.menuItems) {
            showMenu(roleDetailView(active, {
              makeRow,
              makePanelView,
              menu,
              initialSection: "motion",
              onSwitchRole: () => {
                if (rolesDef) showMenu(makePanelView(rolesDef));
              },
            }));
            return;
          }
        }
        const panels = groupItems.filter((d) => d.kind === "panel");
        // 快捷直达：组内仅一个 panel 项
        if (panels.length === 1 && groupItems.length === 1) {
          showMenu(makePanelView(panels[0]));
        } else {
          showMenu(makeGroupView(g, groupItems));
        }
      };
      dock.appendChild(btn);
    });
  };

  // ---- 渲染器点按：切换 chrome 可见性（隐藏↔恢复同一面板，非关闭浮窗）----
  // 隐藏只切 display，DOM+导航栈保留 → 再点恢复的是同一个面板（不会变空白）。
  // pointerdown/up + 位移/时长阈值区分「点按」与「拖拽旋转」，避免旋转误触切换。
  const viewEl = ctx.getViewContainer();
  const tapAbort = new AbortController();
  let downX = 0, downY = 0, downT = 0;
  viewEl.addEventListener("pointerdown", (e: PointerEvent): void => {
    downX = e.clientX; downY = e.clientY; downT = performance.now();
  }, { signal: tapAbort.signal });
  viewEl.addEventListener("pointerup", (e: PointerEvent): void => {
    const moved = Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY);
    if (moved > 5 || performance.now() - downT > 400) return; // 拖拽/长按 → 交给 OrbitControls
    const list = popup.querySelector<HTMLElement>(".slide-list");
    if (popup.style.display !== "none") {
      popup.style.display = "none";                  // 隐藏（栈/DOM/面板内容保留）
    } else if (list && list.childElementCount > 0) {
      popup.style.display = "flex";                  // 恢复同一面板（从未打开过则不显空白）
    }
  }, { signal: tapAbort.signal });

  // ---- 句柄 ----
  const setAdapterItems = (items: PreviewMenuNode[]): void => {
    // ADR-085 S1：运行期 id 冲突守卫（抛错阻断，避免重复行静默渲染）
    const seen = new Set<string>();
    for (const it of items) {
      if (seen.has(it.id)) {
        throw new Error(`[preview-menu] setAdapterItems 重复 id: "${it.id}"（适配器项之间冲突）`);
      }
      if (CORE_MENU_ITEMS.some((c) => c.id === it.id)) {
        throw new Error(`[preview-menu] setAdapterItems id "${it.id}" 与 CORE_MENU_ITEMS 冲突`);
      }
      seen.add(it.id);
    }
    adapterItems = items;
    renderDock();
  };

  const openPanel = (id: string): void => {
    const node = [...CORE_MENU_ITEMS, ...adapterItems].find((d) => d.id === id);
    if (!node || node.kind !== "panel") return;
    showMenu(makePanelView(node));
  };

  renderDock();

  const handle: PreviewMenuHandle = {
    dispose: (): void => {
      tapAbort.abort();
      menu.dispose();
      dock.remove();
      popup.remove();
    },
    setAdapterItems,
    openPanel,
    refreshDock: renderDock, // ADR-085 S3：caps 创建后调用，修复 litematic/pack environment 项时序
  };
  menuHandleOut = handle;
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
function fillSwitch(list: HTMLElement, ctx: PreviewMenuCtx, menu: SlideMenuHandle): void {
  const cur = ctx.getCurrentPath();
  const rtypes = ctx.getTypeTabs?.() ?? [];
  const curRtype = ctx.getCurrentRtype?.() ?? "";
  // ADR-111 收口：tab 标签统一从 getPreviewableTypeTabs 派生（preview key → 类型中文标签，
  // 如 "vrm"/"mmd" → "角色模型"），不再依赖 RESOURCE_TYPE_LABELS[key]（preview key 不在其中）。
  const tabLabelOf = (key: string): string => {
    const hit = getPreviewableTypeTabs().find((t) => t.key === key);
    return hit?.label ?? RESOURCE_TYPE_LABELS[key] ?? key;
  };
  // 默认高亮：手动记忆优先；记忆无效（无/越界）则回退当前模型类型；再不行第一个类型（rtypes 空则 "" 走 siblings 兜底）
  const remembered = safeGet(PREVIEW_LAST_RTYPE_KEY);
  let activeTab: string;
  if (remembered !== null && rtypes.includes(remembered)) {
    activeTab = remembered;
  } else if (curRtype && rtypes.includes(curRtype)) {
    activeTab = curRtype;
  } else {
    activeTab = rtypes[0] ?? "";
  }

  // 类型 tab 行：各资源类型（点击懒加载），「当前目录」tab 已移除
  const tabBar = document.createElement("div");
  tabBar.style.cssText =
    "display:flex;gap:4px;padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.12);flex-wrap:wrap;flex-shrink:0";
  tabBar.dataset.testid = "preview-switch-tabs";
  const mkTab = (key: string, label: string): void => {
    const b = document.createElement("button");
    b.dataset.testid = "preview-switch-tab";
    b.dataset.rtype = key;
    b.textContent = label;
    b.style.cssText =
      "font-size:12px;padding:2px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.2);cursor:pointer;color:rgba(255,255,255,0.7);background:transparent" +
      (key === activeTab ? ";background:rgba(124,131,255,0.35);color:#fff" : "");
    b.onclick = (): void => {
      activeTab = key;
      // 全局记忆：持久化本次选中类型（「当前目录」tab 不持久化——临时视图，
      // 不污染跨会话类型记忆，code review P2）
      if (key !== "") safeSet(PREVIEW_LAST_RTYPE_KEY, key);
      // 高亮当前 tab
      for (const tb of Array.from(tabBar.children)) {
        (tb as HTMLElement).style.background = (tb as HTMLElement).dataset.rtype === key
          ? "rgba(124,131,255,0.35)"
          : "transparent";
      }
      renderRows();
    };
    tabBar.appendChild(b);
  };
  for (const r of rtypes) mkTab(r, tabLabelOf(r));

  const listBody = document.createElement("div");
  listBody.style.cssText = "max-height:240px;overflow-y:auto";

  // 请求代际守卫：快速切 tab 时丢弃过期异步结果（P1-3）
  let reqGen = 0;

  /** 路径归一化：统一正斜杠 + 小写（跨平台分隔符比较一致，P2-5） */
  const norm = (s: string): string => s.replace(/\\/g, "/").toLowerCase();

  const renderRows = (): void => {
    const gen = ++reqGen;
    listBody.innerHTML = "";
    const draw = (paths: string[], viaType: boolean): void => {
      // 类型 tab 候选过滤当前项（避免点击自己整段重建，P3-4）；siblings 分支（activeTab===""）已由 getSiblings 过滤当前项
      const shown = viaType ? paths.filter((p) => norm(p) !== norm(cur)) : paths;
      if (shown.length === 0) {
        const empty = document.createElement("div");
        empty.style.cssText = "padding:8px 10px;color:rgba(255,255,255,0.5);font-size:12px";
        empty.textContent = viaType
          ? tr("preview.noTypeModel", "（该类型暂无模型）")
          : tr("preview.noOtherModel", "（无其他模型）");
        listBody.appendChild(empty);
        return;
      }
      shown.forEach((p) => {
        const isCur = norm(p) === norm(cur);
        // sameType 仅用于 row.onclick（行本体点击）路由：同源 → switchTo 复用外壳替换，
        // 跨源 → switchExternal 跨适配器替换。与"追加"语义无关。
        // 类型判定：类型 tab 按 activeTab；当前目录 tab 按候选实际类型（resolveTypeSafe 解析）。
        // 候选类型无法可靠识别（歧义扩展名如 .vrm/.zip 经 resolveTypeSafe 返回 null）时，
        // 保守判定为「不同源」——走 switchExternal 跨适配器替换，避免用当前适配器 build
        // 认不得的类型导致加载失败。空 curType（未传 rtype）时判定层兜底为同源（见下）。
        const candType = resolveTypeSafe(p);
        const curType = ctx.getCurrentRtype?.() ?? "";
        // sameType 判定：类型 tab 按 activeTab；当前目录 tab 按候选实际类型。
        // 空 curType（空白页加载/未传 rtype）时：候选扩展名唯一归属可识别 → 视为同源
        // （走 switchTo 复用外壳，避免误判跨源触发 switchExternal → cleanupPreview 整段销毁）。
        // 候选类型无法可靠识别（歧义扩展名如 .vrm/.zip 经 resolveTypeSafe 返回 null）时
        // 保守判「不同源」——走 switchExternal，避免用当前适配器 build 认不得的类型。
        const sameType = viaType
          ? activeTab === curType || (curType === "" && activeTab === candType)
          : !!candType && (candType === curType || curType === "");
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
        // 行尾「➕ 追加」：keepInScene 多角色同框（角色面板内打通追加加载）。
        // 同类型候选走 ctx.switchTo keepInScene（当前会话 adapter）；跨类型候选
        // 走 ctx.switchExternal(keepInScene)——openModel3DFullscreen cooperate →
        // switchPreview 主门按类型路由同台追加（ADR-093 T4），用目标类型 opener，
        // 不喂给当前会话 adapter（避免走错适配器解析失败）。
        // stopPropagation 防触发行本体替换语义。
        if (!isCur) {
          const append = document.createElement("button");
          append.dataset.testid = "preview-switch-append";
          append.textContent = "➕";
          append.title = tr("preview.appendModel", "追加到场景");
          append.style.cssText =
            "width:22px;height:22px;flex-shrink:0;background:rgba(255,255,255,0.08);border:none;border-radius:4px;cursor:pointer;font-size:12px;line-height:1;margin-left:auto";
          append.onclick = (ev): void => {
            ev.stopPropagation();
            // 追加（keepInScene 同台）：不清场景、不关菜单——完成后局部刷新列表（✓ 高亮归位）
            const r = !sameType && ctx.switchExternal
              ? ctx.switchExternal(p, ctx.getSiblings(), { keepInScene: true })
              : ctx.switchTo(p, { keepInScene: true });
            if (r && typeof (r as Promise<void>).then === "function") {
              // 失败已由 mount 层 .catch(logWarn) 记录，这里吞掉避免 unhandled rejection
              void (r as Promise<void>).then(() => menu.refresh()).catch(() => {});
            }
          };
          row.appendChild(append);
        }
        row.onclick = (): void => {
          // 替换：不关菜单、不清场景——切换完成后局部刷新列表（renderRows 重读新当前路径）
          const r = !sameType && ctx.switchExternal
            ? ctx.switchExternal(p, ctx.getSiblings())
            : ctx.switchTo(p);
          if (r && typeof (r as Promise<void>).then === "function") {
            // 失败已由 mount 层 .catch(logWarn) 记录，这里吞掉避免 unhandled rejection
            void (r as Promise<void>).then(() => menu.refresh()).catch(() => {});
          }
        };
        listBody.appendChild(row);
      });
    };
    if (activeTab === "") {
      draw(ctx.getSiblings(), false);
    } else {
      void Promise.resolve(ctx.getModelsByType?.(activeTab, ctx.getCurrentSubtype?.()) ?? Promise.resolve([])).then((paths) => {
        if (gen !== reqGen) return; // 过期请求丢弃（P1-3）
        if (!listBody.parentNode) return; // 面板已关闭
        draw(paths ?? [], true);
      }).catch(() => {
        // P3-3：扫描失败优雅降级为空列表（不产生 unhandled rejection、不卡加载态）
        if (gen !== reqGen) return;
        if (!listBody.parentNode) return;
        draw([], true);
      });
    }
  };

  list.append(tabBar, listBody);
  renderRows();
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
        void node.action?.(noopActionCtx);
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
        void node.action?.(noopActionCtx);
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
        node.action(noopActionCtx);
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
      radio.title = tr("preview.roleFocus", "设为焦点");
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
      name.title = e.path;
      name.style.cssText = "flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
      row.onclick = (): void => {
        menu.navigate(roleDetailView(e, { makeRow, makePanelView, menu }));
      };
      // 行尾 ⚙：工具面板（卸载角色等少用但重要操作）
      const tools = document.createElement("button");
      tools.dataset.testid = "preview-role-tools";
      tools.textContent = "⚙";
      tools.title = tr("preview.roleTools", "模型工具");
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
  fillSwitch(list, ctx, menu);
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

/** 灯光面板（ADR-081 L1 + 统一注册表）：从 light cap 的 getMenuControls() 自动渲染 */
function fillLighting(list: HTMLElement, ctx: PreviewMenuCtx): void {
  const lightFromReg = sceneCapabilityRegistry.getById("light") as import("../caps/light-capability.ts").LightCapability | null;
  const lightCap = lightFromReg ?? (() => {
    // 注册表为空时回退到 ctx getter（测试场景）
    const fromCtx = ctx.getLightCap();
    if (fromCtx && "getMenuControls" in fromCtx) return fromCtx as unknown as import("../caps/light-capability.ts").LightCapability;
    return null;
  })();
  fillCapOrFallback(list, lightCap, "preview.noLightCap", "\u8FDB\u5165 3D \u540E\u518D\u6253\u5F00\u706F\u5149\u9762\u677F");
}

/** 阴影面板：从注册表 shadow cap 的 getMenuControls() 渲染 */
function fillShadow(list: HTMLElement, _ctx: PreviewMenuCtx): void {
  const fromReg = sceneCapabilityRegistry.getById("shadow") as import("../caps/shadow-capability.ts").ShadowCapability | null;
  fillCapOrFallback(list, fromReg, "preview.noShadowCap", "进入 3D 后再打开阴影面板");
}

/** 后处理面板：从注册表 postprocessing cap 的 getMenuControls() 渲染 */
function fillPostprocessing(list: HTMLElement, _ctx: PreviewMenuCtx): void {
  const fromReg = sceneCapabilityRegistry.getById("postprocessing") as import("../caps/postprocessing-capability.ts").PostprocessingCapability | null;
  fillCapOrFallback(list, fromReg, "preview.noPostprocCap", "进入 3D 后再打开后处理面板");
}

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

  // ── ⚡ 性能分组 ──
  const perfHeader = document.createElement("div");
  perfHeader.style.cssText = "padding:8px 10px 4px;font-size:11px;color:rgba(255,255,255,0.6);text-transform:uppercase;letter-spacing:0.5px";
  perfHeader.textContent = tr("preview.settingsPerf", "性能");
  list.appendChild(perfHeader);

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
  cullHint.style.cssText = "font-size:11px;color:rgba(255,255,255,0.45);overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
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
  // 仅控制 3D 渲染器的 rAF 循环节流，不影响弹窗 UI 响应（DOM 事件驱动）。
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
    invalidateMaxFpsCache(); // rAF 热路径缓存失效（render-budget 模块级）
  };
  fpsRow.append(fpsLabel, fpsSel);
  list.appendChild(fpsRow);

  // ── 🎨 画质分组（后续加渲染分辨率上限等，先占位）──
  const qualHeader = document.createElement("div");
  qualHeader.style.cssText = "padding:12px 10px 4px;font-size:11px;color:rgba(255,255,255,0.6);text-transform:uppercase;letter-spacing:0.5px";
  qualHeader.textContent = tr("preview.settingsQuality", "画质");
  list.appendChild(qualHeader);

  // 渲染分辨率上限 slider（控制 render-budget 的 pixelRatio cap，0.5–2.0）
  // 持久化键 ysm_3d_maxPixelRatio 由 render-budget.ts 的 getMaxPixelRatio 读取；
  // 写入用 safeSet（隐私模式安全）。改后需重新进入 3D 预览生效（renderer 创建时读）。
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

  // ── 🎨 画质：Bloom 总开关（PostprocessingCapability.setEnabled）──
  // Bloom 是后处理管线里最重的 pass，独立开关让用户精准降级。
  // cap 不存在（未进 3D）→ 跳过，不渲染空控件。
  const ppCap = sceneCapabilityRegistry.getById("postprocessing") as
    | (import("../caps/postprocessing-capability.ts").PostprocessingCapability & {
        setEnabled(v: boolean): void;
        isEnabled(): boolean;
      })
    | undefined;
  if (ppCap) {
    const bloomRow = document.createElement("div");
    bloomRow.className = "slide-item";
    bloomRow.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 10px";
    const bloomLabel = document.createElement("span");
    bloomLabel.className = "slide-label";
    bloomLabel.textContent = tr("preview.settingsBloom", "Bloom 辉光");
    bloomLabel.style.cssText = "flex:1;font-size:12px";
    const bloomToggle = createHeaderToggle({
      value: ppCap.isEnabled(),
      onChange: (v: boolean): void => ppCap.setEnabled(v),
      bind: (): boolean => ppCap.isEnabled(),
    });
    bloomRow.append(bloomLabel, bloomToggle);
    list.appendChild(bloomRow);
  }

  // ── 🎨 画质：PMREM 环境光开关（SkyCapability.setEnvironmentEnabled）──
  // PMREM 有计算开销，低配可关掉省算力；cap 不存在 → 跳过。
  const skyCap = sceneCapabilityRegistry.getById("sky") as
    | (import("../caps/sky-capability.ts").SkyCapability & {
        setEnvironmentEnabled(v: boolean): void;
        isEnvironmentEnabled(): boolean;
      })
    | undefined;
  if (skyCap) {
    const pmremRow = document.createElement("div");
    pmremRow.className = "slide-item";
    pmremRow.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 10px";
    const pmremLabel = document.createElement("span");
    pmremLabel.className = "slide-label";
    pmremLabel.textContent = tr("preview.settingsPmrem", "PMREM 环境光");
    pmremLabel.style.cssText = "flex:1;font-size:12px";
    const pmremToggle = createHeaderToggle({
      value: skyCap.isEnvironmentEnabled(),
      onChange: (v: boolean): void => skyCap.setEnvironmentEnabled(v),
      bind: (): boolean => skyCap.isEnvironmentEnabled(),
    });
    pmremRow.append(pmremLabel, pmremToggle);
    list.appendChild(pmremRow);
  }

  // 说明文字：改动下次打开 3D 预览生效（pixelRatio 在 renderer 创建时读取）
  const note = document.createElement("div");
  note.style.cssText = "padding:8px 10px;font-size:11px;color:rgba(255,255,255,0.4);line-height:1.5";
  note.textContent = tr("preview.settingsNote", "分辨率上限需重新进入 3D 预览生效；其余开关即时生效。");
  list.appendChild(note);
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
