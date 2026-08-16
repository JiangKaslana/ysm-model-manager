// ===== 3D 预览声明式根菜单渲染器（ADR-076 v2）=====
// 渲染 ⚙️ 根按钮 + 弹出菜单；项来自 PREVIEW_MENU_DEFS（唯一事实来源）。
// 面板型（environment / camera / switch）开子视图填充；动作型（close）直接执行。
// 环境面板复用 ADR-075 行（地面/时间/云量/IBL）；相机面板调 buildCameraControls；
// 切换面板列 siblings（经 ctx.switchTo 复用外壳重建，ADR-066 §5.6）。
//
// ctx 全部经 getter 暴露，避免构建期 capability 为 null / 后期赋值 / 切换后 currentPath 失效
// （对齐 ADR-075 构建期 null→never 收窄约定：初始值用 getter 实时读取，交互在闭包内 ?. 延迟调用）。
import { PREVIEW_MENU_DEFS, type PreviewMenuItemDef } from "./preview-menu-defs.ts";
import { buildCameraControls, type CameraControlBridge } from "./mount-preview-core.ts";
import type { SkyCapability } from "./caps/sky-capability.ts";
import type { GroundCapability } from "./caps/ground-capability.ts";
import { createHeaderToggle } from "../../../ui/ui-header-toggle.ts";
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

/** 挂载预览声明式根菜单，返回解绑函数（preview 拆卸时移除 document 监听，防泄漏） */
export function mountPreviewRootMenu(overlay: HTMLElement, ctx: PreviewMenuCtx): () => void {
  const root = document.createElement("button");
  root.className = "mode-btn";
  root.textContent = "⚙️";
  root.dataset.testid = "preview-menu-btn";
  root.title = tr("preview.settings", "设置");
  root.style.cssText =
    "position:absolute;top:8px;right:8px;z-index:12;width:36px;height:36px;font-size:18px;" +
    "display:flex;align-items:center;justify-content:center";
  overlay.appendChild(root);

  const popup = document.createElement("div");
  popup.className = "ysm-preview-menu";
  popup.style.cssText =
    "position:absolute;top:50px;right:8px;min-width:224px;max-height:80vh;overflow:auto;" +
    "padding:6px;background:rgba(20,21,38,0.98);border:1px solid rgba(255,255,255,0.15);" +
    "border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,0.5);color:#fff;font-size:13px;" +
    "display:none;z-index:12;flex-direction:column;gap:2px";
  overlay.appendChild(popup);

  const closePopup = (): void => {
    popup.style.display = "none";
  };

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

  const makeDivider = (): HTMLElement => {
    const d = document.createElement("div");
    d.style.cssText = "height:1px;background:rgba(255,255,255,0.12);margin:4px 2px";
    return d;
  };

  const fillers: Record<string, (list: HTMLElement) => void> = {
    environment: (list) => fillEnvironment(list, ctx),
    camera: (list) => buildCameraControls(list, ctx.getCamBridge()),
    switch: (list) => fillSwitch(list, ctx, closePopup),
  };
  const runners: Record<string, () => void> = {
    close: () => ctx.close(),
  };

  const renderRoot = (): void => {
    popup.innerHTML = "";
    PREVIEW_MENU_DEFS.forEach((def) => {
      if (def.sharedOnly && ctx.selfMode) return;
      if (def.needsSiblings && ctx.getSiblings().length === 0) return;
      if (def.kind === "divider") {
        popup.appendChild(makeDivider());
        return;
      }
      const row = makeRow(def);
      row.onclick = (): void => {
        if (def.kind === "action") {
          closePopup();
          runners[def.id]?.();
        } else {
          renderSub(def);
        }
      };
      popup.appendChild(row);
    });
  };

  const renderSub = (def: PreviewMenuItemDef): void => {
    popup.innerHTML = "";
    const back = makeRow({
      id: "back",
      icon: "←",
      labelKey: "",
      fallback: tr("preview.back", "返回"),
      kind: "action",
    });
    back.onclick = (): void => renderRoot();
    popup.appendChild(back);
    fillers[def.id]?.(popup);
  };

  root.onclick = (e: MouseEvent): void => {
    e.stopPropagation();
    if (popup.style.display === "none") {
      renderRoot();
      popup.style.display = "flex";
    } else {
      closePopup();
    }
  };

  const onDoc = (e: MouseEvent): void => {
    if (e.target !== root && !popup.contains(e.target as Node)) closePopup();
  };
  document.addEventListener("click", onDoc);

  return (): void => document.removeEventListener("click", onDoc);
}

/** 环境面板（ADR-075 已落地项的复用）：地面 / 时间-of-day / 云量 / 环境光(IBL) */
function fillEnvironment(list: HTMLElement, ctx: PreviewMenuCtx): void {
  // 地面开关
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

  // 时间-of-day：联动天空太阳方位/高度（打开面板时 skyCap 已赋值，实时读取真实值）
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

  // 云量：0=晴空 1=多云，联动天空与 IBL 环境
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

  // 环境光(IBL) 开关：可选 IBL 环境贴图联动（复用 createHeaderToggle，对齐地面行）
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
