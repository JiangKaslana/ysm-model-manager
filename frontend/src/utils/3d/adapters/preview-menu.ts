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
import type { LightCapability } from "../caps/light-capability.ts";
import { createHeaderToggle } from "../../../ui/ui-header-toggle.ts";
import { ensureFabStyles } from "../../../utils/dom/fab.ts";
import { t } from "../../../core/i18n/t.ts";

/** 根菜单上下文：core 在 mount3D 内组装，全部经 getter 暴露避免闭包捕获过期值 */
export interface PreviewMenuCtx {
  selfMode: boolean;
  getSkyCap: () => SkyCapability | null;
  getGroundCap: () => GroundCapability | null;
  getLightCap: () => LightCapability | null;
  getCamBridge: () => CameraControlBridge;
  getSiblings: () => string[];
  getCurrentPath: () => string;
  /** 3D 渲染器容器：点击该区域关闭菜单（不再全局点击杀弹窗） */
  getViewContainer: () => HTMLElement;
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
  // 兼容既有 e2e 选择器：关闭按钮保留 preview-close-3d
  menu.root.querySelector<HTMLElement>(".slide-back")?.setAttribute("id", "preview-close-3d");

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
    lighting: (list) => fillLighting(list, ctx),
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
      btn.innerHTML = `<span class="preview-ic">${g.icon}</span><span class="preview-dock-navlabel">${g.fallback}</span>`;
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

  // ---- 点击 3D 渲染器区域关闭菜单（不全局杀弹窗）----
  const viewEl = ctx.getViewContainer();
  const onViewClick = (): void => {
    hideMenu();
  };
  viewEl.addEventListener("click", onViewClick);

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
      viewEl.removeEventListener("click", onViewClick);
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


/** 灯光面板（ADR-081 L1）：顶光/体积光锥/预设切换 */
function fillLighting(list: HTMLElement, ctx: PreviewMenuCtx): void {
  const lightCap = ctx.getLightCap();
  const noCap = (): void => {
    const row = document.createElement("div");
    row.style.cssText = "padding:8px 10px;color:rgba(255,255,255,0.5);font-size:12px";
    row.textContent = tr("preview.noLightCap", "\u8FDB\u5165 3D \u540E\u518D\u6253\u5F00\u706F\u5149\u9762\u677F");
    list.appendChild(row);
  };
  if (!lightCap) { noCap(); return; }
  const params = lightCap.getParams();

  // --- 顶光（SpotLight） ---
  const spotRow = document.createElement("div");
  spotRow.className = "slide-item";
  spotRow.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 10px";
  const spotLabel = document.createElement("span");
  spotLabel.className = "slide-label";
  spotLabel.textContent = tr("preview.spotlight", "\u9876\u5149");
  spotLabel.style.cssText = "flex:1;font-size:12px";
  const spotToggle = createHeaderToggle({
    value: params.spotlight.enabled,
    onChange: (v: boolean): void => lightCap.setSpotlight({ enabled: v }),
  });
  spotRow.append(spotLabel, spotToggle);
  list.appendChild(spotRow);

  // --- 主光强度 ---
  const keyRow = document.createElement("div");
  keyRow.className = "slide-item";
  keyRow.style.cssText = "display:flex;flex-direction:column;gap:4px;padding:6px 10px";
  const keyHead = document.createElement("div");
  keyHead.style.cssText = "display:flex;justify-content:space-between;font-size:12px;color:rgba(255,255,255,0.7)";
  const keyName = document.createElement("span");
  keyName.className = "slide-label";
  keyName.textContent = tr("preview.keyIntensity", "\u4E3B\u5149\u5F3A\u5EA6");
  const keyVal = document.createElement("span");
  keyVal.textContent = params.key.intensity.toFixed(2);
  keyHead.append(keyName, keyVal);
  const keySlider = document.createElement("input");
  keySlider.type = "range";
  keySlider.min = "0";
  keySlider.max = "3";
  keySlider.step = "0.1";
  keySlider.value = String(params.key.intensity);
  keySlider.style.cssText = "width:100%;cursor:pointer;accent-color:var(--accent,#7c83ff)";
  keySlider.oninput = (): void => {
    const v = Number(keySlider.value);
    lightCap.setParams({ key: { intensity: v } });
    keyVal.textContent = v.toFixed(2);
  };
  keyRow.append(keyHead, keySlider);
  list.appendChild(keyRow);

  // --- 环境光强度 ---
  const ambRow = document.createElement("div");
  ambRow.className = "slide-item";
  ambRow.style.cssText = "display:flex;flex-direction:column;gap:4px;padding:6px 10px";
  const ambHead = document.createElement("div");
  ambHead.style.cssText = "display:flex;justify-content:space-between;font-size:12px;color:rgba(255,255,255,0.7)";
  const ambName = document.createElement("span");
  ambName.className = "slide-label";
  ambName.textContent = tr("preview.ambientIntensity", "\u73AF\u5883\u5149");
  const ambVal = document.createElement("span");
  ambVal.textContent = params.ambient.intensity.toFixed(2);
  ambHead.append(ambName, ambVal);
  const ambSlider = document.createElement("input");
  ambSlider.type = "range";
  ambSlider.min = "0";
  ambSlider.max = "2";
  ambSlider.step = "0.05";
  ambSlider.value = String(params.ambient.intensity);
  ambSlider.style.cssText = "width:100%;cursor:pointer;accent-color:var(--accent,#7c83ff)";
  ambSlider.oninput = (): void => {
    const v = Number(ambSlider.value);
    lightCap.setParams({ ambient: { color: 0xffffff, intensity: v } });
    ambVal.textContent = v.toFixed(2);
  };
  ambRow.append(ambHead, ambSlider);
  list.appendChild(ambRow);

  // --- 体积光锥 ---
  const volRow = document.createElement("div");
  volRow.className = "slide-item";
  volRow.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 10px";
  const volLabel = document.createElement("span");
  volLabel.className = "slide-label";
  volLabel.textContent = tr("preview.volumetricCone", "\u4F53\u79EF\u5149\u952F");
  volLabel.style.cssText = "flex:1;font-size:12px";
  const volToggle = createHeaderToggle({
    value: params.volumetric.enabled,
    onChange: (v: boolean): void => {
      lightCap.setVolumetric({ enabled: v });
      if (v && !params.spotlight.enabled) lightCap.setSpotlight({ enabled: true });
    },
  });
  volRow.append(volLabel, volToggle);
  list.appendChild(volRow);

  // --- 锥角 ---
  const angleRow = document.createElement("div");
  angleRow.className = "slide-item";
  angleRow.style.cssText = "display:flex;flex-direction:column;gap:4px;padding:6px 10px";
  const angleHead = document.createElement("div");
  angleHead.style.cssText = "display:flex;justify-content:space-between;font-size:12px;color:rgba(255,255,255,0.7)";
  const angleName = document.createElement("span");
  angleName.className = "slide-label";
  angleName.textContent = tr("preview.coneAngle", "\u952F\u89D2");
  const angleVal = document.createElement("span");
  angleVal.textContent = params.spotlight.angle + "\u00B0";
  angleHead.append(angleName, angleVal);
  const angleSlider = document.createElement("input");
  angleSlider.type = "range";
  angleSlider.min = "10";
  angleSlider.max = "60";
  angleSlider.step = "1";
  angleSlider.value = String(params.spotlight.angle);
  angleSlider.style.cssText = "width:100%;cursor:pointer;accent-color:var(--accent,#7c83ff)";
  angleSlider.oninput = (): void => {
    const v = Number(angleSlider.value);
    lightCap.setSpotlight({ angle: v });
    angleVal.textContent = v + "\u00B0";
  };
  angleRow.append(angleHead, angleSlider);
  list.appendChild(angleRow);

  // --- 预设 ---
  const presetRow = document.createElement("div");
  presetRow.style.cssText = "display:flex;flex-direction:column;gap:4px;padding:6px 10px";
  const presetHead = document.createElement("div");
  presetHead.style.cssText = "display:flex;align-items:center;gap:8px;font-size:12px;color:rgba(255,255,255,0.7)";
  const presetName = document.createElement("span");
  presetName.className = "slide-label";
  presetName.textContent = tr("preview.lightPreset", "\u98DE\u5149\u9884\u8BBE");
  const presetSel = document.createElement("select");
  presetSel.className = "setting-select";
  presetSel.style.cssText = "font-size:11px;padding:2px 4px";
  const presets = [
    { v: "default",  t: "\u9ED8\u8BA4" },
    { v: "ysm",      t: "YSM\u65B9\u5757" },
    { v: "vrm",      t: "VRM\u89D2\u8272" },
    { v: "mmd",      t: "MMD\u89D2\u8272" },
    { v: "litematic", t: "\u4F53\u7D20" },
    { v: "resourcepack", t: "MC\u5757\u5305" },
  ];
  presets.forEach((pr) => {
    const opt = document.createElement("option");
    opt.value = pr.v;
    opt.textContent = pr.t;
    presetSel.appendChild(opt);
  });
  presetSel.value = params.spotlight.enabled ? "resourcepack" : "default";
  presetSel.onchange = (): void => lightCap.setPreset(presetSel.value);
  presetHead.append(presetName, presetSel);
  presetRow.appendChild(presetHead);
  list.appendChild(presetRow);
}
