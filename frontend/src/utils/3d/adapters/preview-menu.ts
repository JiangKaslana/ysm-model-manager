// ===== 3D 预览底部根菜单（ADR-076 v3）=====
// 对齐 MikuMikuAR：底部根按钮 → createSlideMenu 多层导航。
// 能力驱动：有模型/骨骼项 → 🧍 模型；有动作/播放项 → 💃 动作；有场景/相机/环境能力 → 🌍 场景。
// 每组按钮点击：
//   - 组内仅一个 panel 项 → 直接打开该面板（快捷直达）
//   - 组内多个项 → home 到组根视图（项列表），点击项 navigate 下钻面板
// 关闭统一走 SlideMenu header ✕（根级）/ ←（子级），外部点击关闭。

import { CORE_MENU_ITEMS, PREVIEW_MENU_GROUPS, type PreviewMenuItemDef, type PreviewMenuGroupDef } from "./preview-menu-defs.ts";
import { createSlideMenu, type SlideMenuView } from "../../../ui/ui-slide-menu.ts";
import { buildCameraControls, type CameraControlBridge } from "./mount-preview-core.ts";
import type { SkyCapability } from "../caps/sky-capability.ts";
import type { GroundCapability } from "../caps/ground-capability.ts";
import { createHeaderToggle } from "../../../ui/ui-header-toggle.ts";
import { ensureFabStyles } from "../../../utils/dom/fab.ts";
import { t } from "../../../core/i18n/t.ts";

/** 根菜单上下文：core 在 mount3D 内组装，全部经 getter 暴露避免闭包捕获过期值 */
export interface PreviewMenuCtx {
  selfMode: boolean;
  getSkyCap: () => SkyCapability | null;
  getGroundCap: () => GroundCapability | null;
  getCamBridge: () => CameraControlBridge;
  getSiblings: () => string[];
  getCurrentPath: () => string;
  close: () => void;
  switchTo: (path: string) => void;
}

/** i18n 安全取值：键缺失时回退，杜绝菜单项退化显示原始键名 */
const tr = (key: string, fallback: string): string => {
  const v = t(key);
  return v === key ? fallback : v;
};

/** 根菜单句柄：dispose 解绑；setAdapterItems 替换适配器专属项；openPanel 直接打开指定面板 */
export interface PreviewMenuHandle {
  dispose(): void;
  setAdapterItems(items: PreviewMenuItemDef[]): void;
  openPanel(id: string): void;
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
  // 兼容既有 e2e 选择器：关闭按钮保留 ysm-close-3d
  menu.root.querySelector<HTMLElement>(".slide-back")?.setAttribute("id", "ysm-close-3d");

  const showMenu = (view: SlideMenuView): void => {
    menu.home(view);
    popup.style.display = "flex";
  };
  const hideMenu = (): void => {
    popup.style.display = "none";
    menu.reset();
  };
  // 根级 ✕（SlideMenu onClose）语义 = 关闭整个 3D 预览（对齐旧 close 菜单项）
  menu.setOnClose(() => {
    hideMenu();
    ctx.close();
  });

  // ---- 行/分隔线工厂 ----
  const makeRow = (def: PreviewMenuItemDef): HTMLElement => {
    const row = document.createElement("div");
    row.className = "ysm-preview-menu-row";
    row.dataset.testid = "preview-" + def.id;
    if (def.legacyTestId) row.id = def.legacyTestId;
    row.style.cssText =
      "display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;cursor:pointer;font-size:13px";
    if (def.danger) row.style.color = "#ff7b7b";
    const ic = document.createElement("span");
    ic.textContent = def.icon;
    ic.style.cssText = "font-size:15px;width:18px;text-align:center";
    const lb = document.createElement("span");
    lb.textContent = tr(def.labelKey, def.fallback);
    row.append(ic, lb);
    row.onmouseenter = (): void => {
      row.style.background = "rgba(255,255,255,0.08)";
    };
    row.onmouseleave = (): void => {
      row.style.background = "transparent";
    };
    return row;
  };

  // ---- core 填充器 ----
  const fillers: Record<string, (list: HTMLElement) => void> = {
    environment: (list) => fillEnvironment(list, ctx),
    camera: (list) => buildCameraControls(list, ctx.getCamBridge()),
    switch: (list) => fillSwitch(list, ctx, hideMenu),
  };
  const runners: Record<string, () => void> = {
    close: () => ctx.close(),
  };

  // ---- 适配器注入项 ----
  let adapterItems: PreviewMenuItemDef[] = [];

  const renderPanel = (list: HTMLElement, def: PreviewMenuItemDef): void => {
    list.innerHTML = "";
    try {
      if (def.render) def.render(list, hideMenu);
      else fillers[def.id]?.(list);
    } catch (err) {
      console.error("[preview-menu] renderPanel FAILED", def.id, err);
      const errRow = document.createElement("div");
      errRow.style.cssText = "padding:8px 10px;color:#ff7b7b;font-size:12px";
      errRow.textContent = "面板渲染失败: " + (err instanceof Error ? err.message : String(err));
      list.appendChild(errRow);
    }
  };

  const makePanelView = (def: PreviewMenuItemDef): SlideMenuView => ({
    title: tr(def.labelKey, def.fallback),
    render: (list) => renderPanel(list, def),
  });

  /** 组根视图：列出组内项，点击 navigate 下钻面板 / action 直接执行 */
  const makeGroupView = (g: PreviewMenuGroupDef, groupItems: PreviewMenuItemDef[]): SlideMenuView => ({
    title: g.fallback,
    render: (list) => {
      list.innerHTML = "";
      groupItems.forEach((def) => {
        const row = makeRow(def);
        row.onclick = (e: MouseEvent): void => {
          e.stopPropagation();
          if (def.kind === "panel") {
            menu.navigate(makePanelView(def));
          } else {
            hideMenu();
            if (def.run) def.run();
            else runners[def.id]?.();
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
    PREVIEW_MENU_GROUPS.forEach((g) => {
      const groupItems = allItems
        .filter((d) => d.dockGroup === g.id && d.kind !== "divider")
        .filter((d) => !(d.sharedOnly && ctx.selfMode))
        .filter((d) => !(d.needsSiblings && ctx.getSiblings().length === 0))
        .filter((d) => !(d.requiresEnvironment && !ctx.getSkyCap() && !ctx.getGroundCap()));
      if (groupItems.length === 0) return;

      const btn = document.createElement("button");
      btn.className = "preview-dock-navbtn";
      btn.dataset.testid = "dock-" + g.id;
      btn.innerHTML = `<span class="ysm-ic">${g.icon}</span><span class="preview-dock-navlabel">${g.fallback}</span>`;
      btn.onclick = (e: MouseEvent): void => {
        e.stopPropagation();
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

  // ---- 外部点击关闭 ----
  const onDoc = (e: MouseEvent): void => {
    if (e.target !== dock && !popup.contains(e.target as Node)) hideMenu();
  };
  document.addEventListener("click", onDoc);

  // ---- 句柄 ----
  const setAdapterItems = (items: PreviewMenuItemDef[]): void => {
    adapterItems = items;
    renderDock();
  };

  const openPanel = (id: string): void => {
    const def = [...CORE_MENU_ITEMS, ...adapterItems].find((d) => d.id === id);
    if (!def || def.kind !== "panel") return;
    showMenu(makePanelView(def));
  };

  renderDock();

  return {
    dispose: (): void => {
      document.removeEventListener("click", onDoc);
      menu.dispose();
      dock.remove();
      popup.remove();
    },
    setAdapterItems,
    openPanel,
  };
}

/** 环境面板（ADR-075 已落地项的复用）：地面 / 时间-of-day / 云量 / 环境光(IBL) */
function fillEnvironment(list: HTMLElement, ctx: PreviewMenuCtx): void {
  const groundRow = document.createElement("div");
  groundRow.className = "slide-item";
  groundRow.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 10px";
  const groundLabel = document.createElement("span");
  groundLabel.className = "slide-label";
  groundLabel.textContent = t("preview.ground");
  groundLabel.style.cssText = "flex:1;font-size:12px";
  const groundToggle = createHeaderToggle({
    value: true,
    onChange: (v: boolean): void => ctx.getGroundCap()?.setVisible(v),
  });
  groundRow.append(groundLabel, groundToggle);
  list.appendChild(groundRow);

  const formatHour = (h: number): string =>
    `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;
  const timeRow = document.createElement("div");
  timeRow.className = "slide-item";
  timeRow.style.cssText = "display:flex;flex-direction:column;gap:4px;padding:6px 10px";
  const timeHead = document.createElement("div");
  timeHead.style.cssText =
    "display:flex;justify-content:space-between;font-size:12px;color:rgba(255,255,255,0.7)";
  const timeName = document.createElement("span");
  timeName.className = "slide-label";
  timeName.textContent = tr("preview.timeOfDay", "时间");
  const timeVal = document.createElement("span");
  const initHour = ctx.getSkyCap()?.getTimeOfDay() ?? 9;
  timeVal.textContent = formatHour(initHour);
  timeHead.append(timeName, timeVal);
  const timeSlider = document.createElement("input");
  timeSlider.type = "range";
  timeSlider.min = "0";
  timeSlider.max = "24";
  timeSlider.step = "0.5";
  timeSlider.value = String(initHour);
  timeSlider.style.cssText = "width:100%;cursor:pointer;accent-color:var(--accent,#7c83ff)";
  timeSlider.oninput = (): void => {
    const h = Number(timeSlider.value);
    ctx.getSkyCap()?.setTime(h);
    timeVal.textContent = formatHour(h);
  };
  timeRow.append(timeHead, timeSlider);
  list.appendChild(timeRow);

  const cloudRow = document.createElement("div");
  cloudRow.className = "slide-item";
  cloudRow.style.cssText = "display:flex;flex-direction:column;gap:4px;padding:6px 10px";
  const cloudHead = document.createElement("div");
  cloudHead.style.cssText =
    "display:flex;justify-content:space-between;font-size:12px;color:rgba(255,255,255,0.7)";
  const cloudName = document.createElement("span");
  cloudName.className = "slide-label";
  cloudName.textContent = tr("preview.cloudCoverage", "云量");
  const cloudVal = document.createElement("span");
  cloudVal.textContent = "0%";
  cloudHead.append(cloudName, cloudVal);
  const cloudSlider = document.createElement("input");
  cloudSlider.type = "range";
  cloudSlider.min = "0";
  cloudSlider.max = "1";
  cloudSlider.step = "0.05";
  cloudSlider.value = "0";
  cloudSlider.style.cssText = "width:100%;cursor:pointer;accent-color:var(--accent,#7c83ff)";
  cloudSlider.oninput = (): void => {
    const v = Number(cloudSlider.value);
    ctx.getSkyCap()?.setCloudCoverage(v, false);
    cloudVal.textContent = `${Math.round(v * 100)}%`;
  };
  cloudSlider.onchange = (): void => {
    ctx.getSkyCap()?.setCloudCoverage(Number(cloudSlider.value), true);
  };
  cloudRow.append(cloudHead, cloudSlider);
  list.appendChild(cloudRow);

  const ibRow = document.createElement("div");
  ibRow.className = "slide-item";
  ibRow.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 10px";
  const ibLabel = document.createElement("span");
  ibLabel.className = "slide-label";
  ibLabel.textContent = tr("preview.environmentLight", "环境光(IBL)");
  ibLabel.style.cssText = "flex:1;font-size:12px";
  const ibToggle = createHeaderToggle({
    value: true,
    onChange: (v: boolean): void => ctx.getSkyCap()?.setEnvironmentEnabled(v),
  });
  ibRow.append(ibLabel, ibToggle);
  list.appendChild(ibRow);
}

/** 3D 内模型切换面板：列 siblings，当前项高亮；点击经 ctx.switchTo 复用外壳重建 */
function fillSwitch(list: HTMLElement, ctx: PreviewMenuCtx, closePopup: () => void): void {
  const siblings = ctx.getSiblings();
  const cur = ctx.getCurrentPath();
  if (siblings.length === 0) {
    const empty = document.createElement("div");
    empty.style.cssText = "padding:8px 10px;color:rgba(255,255,255,0.5);font-size:12px";
    empty.textContent = tr("preview.noOtherModel", "（无其他模型）");
    list.appendChild(empty);
    return;
  }
  siblings.forEach((p) => {
    const isCur = p.toLowerCase() === cur.toLowerCase();
    const row = document.createElement("div");
    row.className = "ysm-preview-menu-row";
    row.style.cssText =
      "display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;cursor:pointer;font-size:13px" +
      (isCur ? ";background:rgba(124,131,255,0.25)" : "");
    const ic = document.createElement("span");
    ic.textContent = isCur ? "✓" : "📦";
    ic.style.cssText = "font-size:15px;width:18px;text-align:center";
    const lb = document.createElement("span");
    lb.textContent = p.split(/[/\\]/).pop() || p;
    row.append(ic, lb);
    row.onclick = (): void => {
      closePopup();
      void ctx.switchTo(p);
    };
    list.appendChild(row);
  });
}
