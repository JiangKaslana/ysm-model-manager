// ===== 3D 预览底部根菜单（ADR-076 v3）=====
// 对齐 MikuMikuAR：底部根按钮 → createSlideMenu 多层导航。
// 能力驱动：有模型/骨骼项 → 🧍 模型；有动作/播放项 → 💃 动作；有环境能力 → 🌍 环境；有场景/相机能力 → 🎛️ 场景。
// 每组按钮点击：
//   - 组内仅一个 panel 项 → 直接打开该面板（快捷直达）
//   - 组内多个项 → home 到组根视图（项列表），点击项 navigate 下钻面板
// 关闭统一走 SlideMenu header ✕（根级）/ ←（子级），外部点击关闭。

import { CORE_MENU_ITEMS, PREVIEW_MENU_GROUPS, type PreviewMenuItemDef, type PreviewMenuGroupDef } from "./preview-menu-defs.ts";
import { createSlideMenu, type SlideMenuView, type SlideMenuHandle } from "../../../ui/ui-slide-menu.ts";
import { buildCameraControls, type CameraControlBridge } from "./camera-controls.ts";
import type { SkyCapability } from "../caps/sky-capability.ts";
import type { GroundCapability } from "../caps/ground-capability.ts";
import type { LightCapability } from "../caps/light-capability.ts";
import { createHeaderToggle } from "../../../ui/ui-header-toggle.ts";
import { RESOURCE_TYPE_LABELS } from "../../resource/types.ts";
import { ensureFabStyles } from "../../../utils/dom/fab.ts";
import { t } from "../../../core/i18n/t.ts";
import type { MenuControlDef, SceneCapability } from "../caps/scene-capability.ts";
import { sceneCapabilityRegistry } from "../caps/scene-capability-registry.ts";
import { ENV_PRESET_LINKAGE, type EnvPresetId } from "../caps/environment-capability.ts";
import type { FogCapability } from "../caps/fog-capability.ts";

/** 根菜单上下文：core 在 mount3D 内组装，全部经 getter 暴露避免闭包捕获过期值 */
export interface PreviewMenuCtx {
  selfMode: boolean;
  getSkyCap: () => SkyCapability | null;
  getGroundCap: () => GroundCapability | null;
  getLightCap: () => LightCapability | null;
  getCamBridge: () => CameraControlBridge;
  getSiblings: () => string[];
  getCurrentPath: () => string;
  /** 当前会话资源类型（如 ysm/mmd-skin/vrchat-avatar/resourcepack；空串未知）——类型 tab 点击时判断同类型走 switchTo */
  getCurrentRtype?: () => string;
  /** 按资源类型扫描候选模型路径（点击切换模型的类型 tab 时懒加载；缺省回退 siblings） */
  getModelsByType?: (rtype: string) => Promise<string[]>;
  /** 类型 tab 列表（如 ["ysm","mmd-skin","vrchat-avatar","resourcepack"]；缺省仅「当前目录」tab） */
  getTypeTabs?: () => string[];
  /** 3D 渲染器容器：点击该区域关闭菜单（不再全局点击杀弹窗） */
  getViewContainer: () => HTMLElement;
  close: () => void;
  switchTo: (path: string, options?: { keepInScene?: boolean }) => void;
  /** 跨类型跳转（切换模型选中不同类型：关当前 + 开目标，由 app 层 openModel3DFullscreen 提供）。
   *  第二参透传 siblings，切换后新会话「当前目录」tab 有候选（P1-2） */
  switchExternal?: (path: string, siblings?: string[]) => Promise<void> | void;
}

/** i18n 安全取值：键缺失时回退，杜绝菜单项退化显示原始键名 */
const tr = (key: string, fallback: string): string => {
  const v = t(key);
  return v === key ? fallback : v;
};

/** 通用控件渲染器：将 MenuControlDef[] 渲染为 DOM 行，替代手写 fill* 函数 */
export function renderCapControls(list: HTMLElement, controls: MenuControlDef[]): void {
  // 分组折叠：同一 group 的控件归入一个可折叠 section（Map 查找表支持非连续同 group 归并），header 点击切换展开/收起。
  // group 为 undefined 的控件直接挂到 list（无 section 包裹），保持向后兼容。
  const sectionMap = new Map<string, { section: HTMLElement; body: HTMLElement }>();

  const ensureSection = (group: string | undefined): HTMLElement | null => {
    if (group === undefined) return null;
    const existing = sectionMap.get(group);
    if (existing) return existing.body;
    // 新分组：创建 section + header
    const section = document.createElement("div");
    section.className = "cap-section";
    section.style.cssText = "border-top:1px solid rgba(255,255,255,0.08)";
    const header = document.createElement("div");
    header.className = "cap-section-header";
    header.style.cssText = "display:flex;align-items:center;gap:6px;padding:8px 10px;min-height:32px;cursor:pointer;user-select:none;font-size:11px;color:rgba(255,255,255,0.6);text-transform:uppercase;letter-spacing:0.5px";
    const arrow = document.createElement("span");
    arrow.textContent = "▾";
    arrow.style.cssText = "font-size:10px;display:inline-block";
    const title = document.createElement("span");
    title.textContent = tr(group, group);
    header.append(arrow, title);
    const body = document.createElement("div");
    body.className = "cap-section-body";
    body.style.cssText = "display:block";
    let collapsed = false;
    header.onclick = (): void => {
      collapsed = !collapsed;
      body.style.display = collapsed ? "none" : "block";
      arrow.textContent = collapsed ? "▸" : "▾";
    };
    // 防御性：防止 header 点击冒泡到 SlideMenu 导航/关闭行为
    header.addEventListener("click", (e: MouseEvent): void => e.stopPropagation());
    section.append(header, body);
    list.appendChild(section);
    sectionMap.set(group, { section, body });
    return body;
  };

  for (const c of controls) {
    // target 为 section body（有 group）或 null（无 group，挂到 list 顶层）。
    // divider 无 group 时挂顶层作为组间视觉分隔；有 group 时挂 body 内作为组内分隔。
    const target = ensureSection(c.group);
    if (c.kind === "divider") {
      const hr = document.createElement("div");
      hr.style.cssText = "height:1px;background:rgba(255,255,255,0.12);margin:4px 10px";
      (target ?? list).appendChild(hr);
      continue;
    }
    if (c.kind === "toggle") {
      const row = document.createElement("div");
      row.className = "slide-item";
      row.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 10px";
      const labelBox = document.createElement("div");
      labelBox.style.cssText = "flex:1;display:flex;align-items:center;gap:8px;min-width:0";
      const label = document.createElement("span");
      label.className = "slide-label";
      label.textContent = tr(c.labelKey, c.fallback);
      label.style.cssText = "font-size:12px";
      const hint = document.createElement("span");
      hint.style.cssText = "font-size:10px;color:rgba(255,255,255,0.5);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
      hint.textContent = c.hintKey ? tr(c.hintKey, "") : "";
      labelBox.append(label, hint);
      const toggle = createHeaderToggle({
        value: c.getValue() as boolean,
        onChange: (v: boolean): void => c.setValue(v),
        bind: (): boolean => c.getValue() as boolean,
      });
      row.append(labelBox, toggle);
      (target ?? list).appendChild(row);
      continue;
    }
    if (c.kind === "slider") {
      const row = document.createElement("div");
      row.className = "slide-item";
      row.style.cssText = "display:flex;flex-direction:column;gap:4px;padding:6px 10px";
      const head = document.createElement("div");
      head.style.cssText = "display:flex;justify-content:space-between;font-size:12px;color:rgba(255,255,255,0.7)";
      const name = document.createElement("span");
      name.className = "slide-label";
      name.textContent = tr(c.labelKey, c.fallback);
      const val = document.createElement("span");
      const numVal = c.getValue() as number;
      val.textContent = c.slider?.unit === "%" ? `${Math.round(numVal * 100)}%` : c.slider?.unit === "h" ? `${String(Math.floor(numVal)).padStart(2, "0")}:${String(Math.round((numVal % 1) * 60)).padStart(2, "0")}` : c.slider?.unit ? `${numVal}${c.slider.unit}` : numVal.toFixed(2);
      head.append(name, val);
      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = String(c.slider?.min ?? 0);
      slider.max = String(c.slider?.max ?? 1);
      slider.step = String(c.slider?.step ?? 0.01);
      slider.value = String(numVal);
      slider.style.cssText = "width:100%;cursor:pointer;accent-color:var(--accent,#7c83ff)";
      slider.oninput = (): void => {
        const v = Number(slider.value);
        c.setValue(v);
        val.textContent = c.slider?.unit === "%" ? `${Math.round(v * 100)}%` : c.slider?.unit === "h" ? `${String(Math.floor(v)).padStart(2, "0")}:${String(Math.round((v % 1) * 60)).padStart(2, "0")}` : c.slider?.unit ? `${v}${c.slider.unit}` : v.toFixed(2);
      };
      row.append(head, slider);
      (target ?? list).appendChild(row);
      continue;
    }
    if (c.kind === "select") {
      const row = document.createElement("div");
      row.className = "slide-item";
      row.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 10px";
      const label = document.createElement("span");
      label.className = "slide-label";
      label.textContent = tr(c.labelKey, c.fallback);
      label.style.cssText = "flex:1;font-size:12px";
      const sel = document.createElement("select");
      sel.className = "setting-select";
      sel.style.cssText = "font-size:11px;padding:2px 4px";
      for (const opt of c.select ?? []) {
        const o = document.createElement("option");
        o.value = opt.value;
        o.textContent = opt.label;
        sel.appendChild(o);
      }
      sel.value = String(c.getValue());
      sel.onchange = (): void => c.setValue(sel.value);
      row.append(label, sel);
      (target ?? list).appendChild(row);
      continue;
    }
    if (c.kind === "button") {
      const row = document.createElement("div");
      row.className = "slide-item";
      row.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 10px";
      const label = document.createElement("span");
      label.className = "slide-label";
      label.textContent = tr(c.labelKey, c.fallback);
      label.style.cssText = "flex:1;font-size:12px";
      const btn = document.createElement("button");
      const variant = c.button?.variant ?? "ghost";
      const accent = "var(--accent,#7c83ff)";
      btn.style.cssText =
        variant === "primary"
          ? `padding:4px 10px;font-size:11px;border:0;border-radius:6px;cursor:pointer;background:${accent};color:#fff;`
          : `padding:4px 10px;font-size:11px;border:1px solid rgba(255,255,255,0.2);border-radius:6px;cursor:pointer;background:transparent;color:rgba(255,255,255,0.85);`;
      btn.textContent = c.button?.textKey ? tr(c.button.textKey, c.fallback) : c.fallback;
      const hint = document.createElement("span");
      hint.style.cssText = "font-size:10px;color:rgba(255,255,255,0.5);max-width:45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
      const syncHint = (): void => {
        const v = c.button?.getHint ? c.button.getHint() : "";
        hint.textContent = v ?? (c.button?.hintKey ? tr(c.button.hintKey, "") : "");
      };
      syncHint();
      let disabled = c.button?.disabled?.() ?? false;
      btn.disabled = disabled;
      btn.style.opacity = disabled ? "0.5" : "1";
      btn.onclick = async (): Promise<void> => {
        if (!c.button?.action) return;
        if (btn.disabled) return;
        btn.disabled = true;
        btn.style.opacity = "0.5";
        try {
          await c.button.action();
        } finally {
          disabled = c.button?.disabled?.() ?? false;
          btn.disabled = disabled;
          btn.style.opacity = disabled ? "0.5" : "1";
          syncHint();
        }
      };
      row.append(label, btn, hint);
      (target ?? list).appendChild(row);
      continue;
    }
    if (c.kind === "image") {
      const url = c.getValue() as string | null;
      if (!url) continue; // 无内容时跳过（不占位）
      const row = document.createElement("div");
      row.className = "slide-item";
      row.style.cssText = "padding:6px 10px";
      const img = document.createElement("img");
      img.src = url;
      img.alt = tr(c.labelKey, c.fallback);
      img.style.cssText = "width:100%;border-radius:6px;border:1px solid rgba(255,255,255,0.12);display:block";
      row.appendChild(img);
      (target ?? list).appendChild(row);
      continue;
    }
    if (c.kind === "color") {
      const row = document.createElement("div");
      row.className = "slide-item";
      row.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 10px";
      const label = document.createElement("span");
      label.className = "slide-label";
      label.textContent = tr(c.labelKey, c.fallback);
      label.style.cssText = "flex:1;font-size:12px";
      const hex = c.getValue() as number;
      // number 0xRRGGBB → "#rrggbb"
      const toHexStr = (v: number): string => {
        const s = (v >>> 0).toString(16).padStart(6, "0").slice(-6);
        return `#${s}`;
      };
      const picker = document.createElement("input");
      picker.type = "color";
      picker.value = toHexStr(hex);
      picker.style.cssText = "width:28px;height:20px;padding:0;border:1px solid rgba(255,255,255,0.2);border-radius:4px;cursor:pointer;background:transparent";
      picker.oninput = (): void => {
        const h = picker.value; // "#rrggbb"
        c.setValue(parseInt(h.slice(1), 16));
      };
      row.append(label, picker);
      (target ?? list).appendChild(row);
      continue;
    }
    if (c.kind === "timeline") {
      // 可视化时间轴：昼夜色带 + 太阳位置标记 + 可拖动调 timeOfDay
      const row = document.createElement("div");
      row.className = "slide-item";
      row.style.cssText = "display:flex;flex-direction:column;gap:4px;padding:6px 10px";

      // 顶部：当前时间数字 + 标签
      const head = document.createElement("div");
      head.style.cssText = "display:flex;justify-content:space-between;font-size:12px;color:rgba(255,255,255,0.85)";
      const name = document.createElement("span");
      name.className = "slide-label";
      name.textContent = tr(c.labelKey, c.fallback);
      const val = document.createElement("span");
      const numVal = c.getValue() as number;
      const fmtTime = (h: number): string =>
        `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;
      val.textContent = fmtTime(numVal);
      head.append(name, val);

      // 昼夜色带（0h 夜 → 6h 晨 → 12h 午 → 18h 暮 → 24h 夜）
      const bandH = 28;
      const band = document.createElement("div");
      band.style.cssText = `position:relative;width:100%;height:${bandH}px;border-radius:6px;overflow:hidden;cursor:pointer;touch-action:none`;
      const canvas = document.createElement("canvas");
      canvas.width = 240;
      canvas.height = bandH;
      canvas.style.cssText = "width:100%;height:100%;display:block";
      const cctx = canvas.getContext("2d");
      if (cctx) {
        // 简化昼夜渐变：黑→蓝→浅蓝→橙→深蓝→黑
        const stops = [
          { t: 0.0, c: "#04060f" },
          { t: 0.25, c: "#1a2b4a" }, // 6h 晨
          { t: 0.5, c: "#9bc4e8" },  // 12h 午
          { t: 0.75, c: "#ff8a5c" }, // 18h 暮
          { t: 1.0, c: "#04060f" },
        ];
        const grad = cctx.createLinearGradient(0, 0, canvas.width, 0);
        for (const s of stops) grad.addColorStop(s.t, s.c);
        cctx.fillStyle = grad;
        cctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      // 太阳位置标记（顶部圆点，y 由 elevation 决定）
      const marker = document.createElement("div");
      marker.style.cssText = "position:absolute;width:10px;height:10px;border-radius:50%;background:#fff4c2;border:1px solid rgba(0,0,0,0.3);box-shadow:0 0 6px rgba(255,244,194,0.8);transform:translate(-50%,-50%);pointer-events:none;transition:left 0.1s,top 0.1s";

      const updateMarker = (hour: number): void => {
        const h = ((hour % 24) + 24) % 24;
        // 昼夜对称：12h 太阳最高（y=4px），0h/24h 最低（y=bandH-4px）
        const dayProg = Math.sin(((h - 6) / 12) * Math.PI); // -1~1
        const xPct = (h / 24) * 100;
        const yPx = bandH / 2 - dayProg * (bandH / 2 - 4);
        marker.style.left = `${xPct}%`;
        marker.style.top = `${yPx}px`;
      };
      updateMarker(numVal);

      band.append(canvas, marker);

      // 拖动处理（pointer events，支持触屏）
      let dragging = false;
      const setFromPointer = (clientX: number): void => {
        const rect = band.getBoundingClientRect();
        const px = Math.max(0, Math.min(rect.width, clientX - rect.left));
        const hour = (px / rect.width) * 24;
        c.setValue(hour);
        val.textContent = fmtTime(hour);
        updateMarker(hour);
      };
      band.addEventListener("pointerdown", (e: PointerEvent): void => {
        dragging = true;
        band.setPointerCapture(e.pointerId);
        setFromPointer(e.clientX);
      });
      band.addEventListener("pointermove", (e: PointerEvent): void => {
        if (!dragging) return;
        setFromPointer(e.clientX);
      });
      band.addEventListener("pointerup", (e: PointerEvent): void => {
        dragging = false;
        try { band.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      });
      band.addEventListener("pointercancel", (): void => {
        dragging = false;
      });

      row.append(head, band);
      (target ?? list).appendChild(row);
      continue;
    }
    if (c.kind === "histogram") {
      // 亮度直方图：16 个柱子，值 = number[]
      const raw = c.getValue();
      const data = Array.isArray(raw) ? (raw as number[]) : [];
      const row = document.createElement("div");
      row.className = "slide-item";
      row.style.cssText = "display:flex;flex-direction:column;gap:4px;padding:6px 10px";

      const label = document.createElement("span");
      label.className = "slide-label";
      label.textContent = tr(c.labelKey, c.fallback);
      label.style.cssText = "font-size:12px;color:rgba(255,255,255,0.85)";
      row.appendChild(label);

      const canvas = document.createElement("canvas");
      const W = 240, H = 48;
      canvas.width = W;
      canvas.height = H;
      canvas.style.cssText = "width:100%;height:auto;border-radius:6px;border:1px solid rgba(255,255,255,0.12);display:block";
      const hctx = canvas.getContext("2d");
      if (hctx) {
        // 清背景
        hctx.fillStyle = "rgba(0,0,0,0.3)";
        hctx.fillRect(0, 0, W, H);
        if (data.length > 0) {
          const max = Math.max(...data, 1);
          const barW = W / data.length;
          const accent = "var(--accent,#7c83ff)";
          for (let i = 0; i < data.length; i++) {
            const barH = (data[i] / max) * (H - 4);
            const x = i * barW;
            const y = H - barH;
            // 渐变：低亮度偏蓝，高亮度偏白
            const t = i / Math.max(1, data.length - 1);
            const r = Math.round(t * 255);
            const g = Math.round(t * 255);
            const b = Math.round(120 + t * 135);
            hctx.fillStyle = `rgb(${r},${g},${b})`;
            hctx.fillRect(x + 1, y, Math.max(1, barW - 2), barH);
          }
        }
      }
      row.appendChild(canvas);
      (target ?? list).appendChild(row);
    }
  }
}

/** 根菜单句柄：dispose 解绑；setAdapterItems 替换适配器专属项；openPanel 直接打开指定面板；refreshDock 在 caps 创建后重渲染底栏（ADR-085 S3） */
export interface PreviewMenuHandle {
  dispose(): void;
  setAdapterItems(items: PreviewMenuItemDef[]): void;
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
    popup.style.display = "none";
    menu.reset();
  };
  // 根级 ✕（SlideMenu onClose）语义 = 关闭整个 3D 预览（对齐旧 close 菜单项）
  menu.setOnClose(() => {
    hideMenu();
    ctx.close();
  });

  // ---- 行/分隔线工厂 ----
  const makeRow = (def: PreviewMenuItemDef, opts?: { chevron?: boolean }): HTMLElement => {
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
  const fillers: Record<string, (list: HTMLElement, menu?: SlideMenuHandle) => void> = {
    environment: (list, _menu) => fillEnvironment(list, ctx, menu),
    camera: (list) => buildCameraControls(list, ctx.getCamBridge()),
    switch: (list) => fillSwitch(list, ctx, hideMenu),
    lighting: (list) => fillLighting(list, ctx),
    shadow: (list) => fillShadow(list, ctx),
    postproc: (list) => fillPostprocessing(list, ctx),
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
      else fillers[def.id]?.(list, menu);
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
        // panel 型 → 下钻导航，带 ">" 装饰箭头提示可进入
        const row = makeRow(def, { chevron: def.kind === "panel" });
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
        .filter((d) => !(d.requiresEnvironment && !sceneCapabilityRegistry.getById("sky") && !sceneCapabilityRegistry.getById("ground") && !ctx.getSkyCap() && !ctx.getGroundCap()));
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
    refreshDock: renderDock, // ADR-085 S3：caps 创建后调用，修复 litematic/pack environment 项时序
  };
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
function fillEnvironment(list: HTMLElement, ctx: PreviewMenuCtx, menu?: SlideMenuHandle): void {
  const ENV_IDS = new Set(["sky", "ground", "environment", "fog", "reflector"]);
  let allCaps = sceneCapabilityRegistry.getAll().filter((cap) => ENV_IDS.has(cap.id));

  // 注册表为空时回退到 ctx getter（测试场景）：把 skyCap/groundCap 当 cap 用
  if (allCaps.length === 0) {
    const skyCap = ctx.getSkyCap();
    const groundCap = ctx.getGroundCap();
    const fallback: SceneCapability[] = [];
    if (skyCap && "getMenuControls" in skyCap) {
      // 包装一层注入 id（fake cap 无 id 字段；注册表路径的 cap 自带 id）
      fallback.push({
        ...(skyCap as unknown as SceneCapability),
        id: "sky",
        labelKey: "preview.timeOfDay",
        icon: "🌤️",
        descKey: "",
      });
    }
    if (groundCap && "getMenuControls" in groundCap) {
      fallback.push({
        ...(groundCap as unknown as SceneCapability),
        id: "ground",
        labelKey: "preview.ground",
        icon: "🟫",
        descKey: "",
      });
    }
    allCaps = fallback;
  }

  if (allCaps.length === 0) {
    const row = document.createElement("div");
    row.style.cssText = "padding:8px 10px;color:rgba(255,255,255,0.5);font-size:12px";
    row.textContent = tr("preview.noEnvironment", "进入 3D 后再打开环境面板");
    list.appendChild(row);
    return;
  }

  // 无 menu 句柄 → 旧平铺路径（legacy 调用方）；collectAllControls 复用 allCaps
  const collectAllControls = (): MenuControlDef[] => {
    const controls: MenuControlDef[] = [];
    allCaps.forEach((cap, idx) => {
      if (idx > 0) {
        controls.push({
          id: "__divider_" + cap.id,
          kind: "divider",
          labelKey: "",
          fallback: "",
          getValue: () => false,
          setValue: () => { /* 占位 */ },
        });
      }
      controls.push(...cap.getMenuControls());
    });
    return controls;
  };

  if (!menu) {
    renderCapControls(list, collectAllControls());
    return;
  }

  // ── 预设快捷栏（第一层顶部）──
  // 一排按钮：☀️工作室 / 🌅日落 / 🌙夜景 / 🌳森林 / 🌤️天空
  // 点击 → ENV_PRESET_LINKAGE 联动 sky/fog/env，再 navigate 到 environment 子面板让用户看效果
  const presetBar = document.createElement("div");
  presetBar.style.cssText = "display:flex;gap:4px;padding:6px 10px;flex-wrap:wrap;border-bottom:1px solid rgba(255,255,255,0.08)";
  const PRESET_ORDER: Array<{ id: Exclude<EnvPresetId, "custom">; icon: string; labelKey: string }> = [
    { id: "studio", icon: "☀️", labelKey: "preview.presetQuickStudio" },
    { id: "sunset", icon: "🌅", labelKey: "preview.presetQuickSunset" },
    { id: "night", icon: "🌙", labelKey: "preview.presetQuickNight" },
    { id: "forest", icon: "🌳", labelKey: "preview.presetQuickForest" },
    { id: "sky", icon: "🌤️", labelKey: "preview.presetQuickSky" },
  ];

  const applyPresetLinkage = (presetId: Exclude<EnvPresetId, "custom">): void => {
    const link = ENV_PRESET_LINKAGE[presetId];
    if (!link) return;

    // sky 联动
    if (link.sky) {
      const skyCap = sceneCapabilityRegistry.getById("sky") as (SkyCapability & { setTime?(h: number): void; setCloudCoverage?(v: number, regen?: boolean): void }) | null;
      if (skyCap) {
        skyCap.setTime?.(link.sky.time);
        skyCap.setCloudCoverage?.(link.sky.cloud, true);
      } else {
        // 回退 ctx getter（测试场景）
        const fromCtx = ctx.getSkyCap() as (SkyCapability & { setTime?(h: number): void; setCloudCoverage?(v: number, regen?: boolean): void }) | null;
        if (fromCtx) {
          fromCtx.setTime?.(link.sky.time);
          fromCtx.setCloudCoverage?.(link.sky.cloud, true);
        }
      }
    }

    // fog 联动
    if (link.fog) {
      const fogCap = sceneCapabilityRegistry.getById("fog") as FogCapability | null;
      const target = fogCap ?? null;
      if (target) {
        target.setEnabled(link.fog.enabled);
        if (link.fog.mode) target.setMode(link.fog.mode);
        if (link.fog.density !== undefined) target.setDensity(link.fog.density);
        if (link.fog.near !== undefined || link.fog.far !== undefined) {
          target.setLinearRange(link.fog.near, link.fog.far);
        }
      }
    }

    // environment 联动：切 preset + intensity
    const envCap = sceneCapabilityRegistry.getById("environment") as (import("../caps/environment-capability.ts").EnvironmentCapability) | null;
    if (envCap) {
      envCap.setPresetId(presetId);
      if (link.envIntensity !== undefined) envCap.setIntensity(link.envIntensity);
    }
  };

  PRESET_ORDER.forEach((p) => {
    const btn = document.createElement("button");
    btn.style.cssText = "flex:1;min-width:48px;padding:4px 6px;border:1px solid rgba(255,255,255,0.15);border-radius:6px;background:transparent;color:rgba(255,255,255,0.85);cursor:pointer;font-size:11px;display:flex;flex-direction:column;align-items:center;gap:2px";
    const ic = document.createElement("span");
    ic.textContent = p.icon;
    ic.style.cssText = "font-size:14px";
    const lb = document.createElement("span");
    lb.textContent = tr(p.labelKey, p.id);
    btn.append(ic, lb);
    btn.onclick = (e: MouseEvent): void => {
      e.stopPropagation();
      applyPresetLinkage(p.id);
      // 应用后刷新当前视图（让第一层各 cap 的主控件读最新值）
      menu.refresh();
    };
    presetBar.appendChild(btn);
  });
  list.appendChild(presetBar);

  // 按 ENV_IDS 声明顺序渲染（注册顺序 = 菜单渲染顺序，见 scene_capability_registry 知识卡）
  const orderedIds = ["sky", "ground", "environment", "fog", "reflector"];
  const orderedCaps = orderedIds
    .map((id) => allCaps.find((c) => c.id === id))
    .filter((c): c is NonNullable<typeof c> => Boolean(c));

  orderedCaps.forEach((cap) => {
    const controls = cap.getMenuControls();
    if (controls.length === 0) return;

    // 第一层摘要行：第一个非 divider 控件作为该行的"主控件"
    const primaryIdx = controls.findIndex((c) => c.kind !== "divider");
    if (primaryIdx === -1) return;
    const primary = controls[primaryIdx];
    const hasSubPanel = controls.length > 1;

    const row = document.createElement("div");
    row.className = "slide-item";
    // hasSubPanel → 整行可点下钻（cursor:pointer）；纯开关行 → 默认 cursor
    row.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 10px";

    // 主控件渲染（toggle/slider 各自一行内控件）
    // 主控件容器 stopPropagation：点 toggle/slider 不触发 row 下钻
    const renderPrimaryInline = (): void => {
      if (primary.kind === "toggle") {
        const label = document.createElement("span");
        label.className = "slide-label";
        label.textContent = tr(primary.labelKey, primary.fallback);
        label.style.cssText = "flex:1;font-size:12px";
        const toggle = createHeaderToggle({
          value: primary.getValue() as boolean,
          onChange: (v: boolean): void => primary.setValue(v),
          bind: (): boolean => primary.getValue() as boolean,
        });
        // toggle 点击不冒泡到 row（否则会触发下钻）
        toggle.addEventListener("click", (e: MouseEvent): void => e.stopPropagation());
        row.append(label, toggle);
      } else if (primary.kind === "slider") {
        // sky 特例：第一层直接放 sky-time slider（无 toggle）
        const head = document.createElement("div");
        head.style.cssText = "display:flex;flex-direction:column;gap:2px;flex:1;min-width:0";
        const nameRow = document.createElement("div");
        nameRow.style.cssText = "display:flex;justify-content:space-between;font-size:12px;color:rgba(255,255,255,0.85)";
        const name = document.createElement("span");
        name.className = "slide-label";
        name.textContent = tr(primary.labelKey, primary.fallback);
        const val = document.createElement("span");
        const numVal = primary.getValue() as number;
        val.textContent = primary.slider?.unit === "h"
          ? `${String(Math.floor(numVal)).padStart(2, "0")}:${String(Math.round((numVal % 1) * 60)).padStart(2, "0")}`
          : primary.slider?.unit === "%"
            ? `${Math.round(numVal * 100)}%`
            : primary.slider?.unit
              ? `${numVal}${primary.slider.unit}`
              : numVal.toFixed(2);
        nameRow.append(name, val);
        const slider = document.createElement("input");
        slider.type = "range";
        slider.min = String(primary.slider?.min ?? 0);
        slider.max = String(primary.slider?.max ?? 1);
        slider.step = String(primary.slider?.step ?? 0.01);
        slider.value = String(numVal);
        slider.style.cssText = "width:100%;cursor:pointer;accent-color:var(--accent,#7c83ff)";
        slider.oninput = (): void => {
          const v = Number(slider.value);
          primary.setValue(v);
          val.textContent = primary.slider?.unit === "h"
            ? `${String(Math.floor(v)).padStart(2, "0")}:${String(Math.round((v % 1) * 60)).padStart(2, "0")}`
            : primary.slider?.unit === "%"
              ? `${Math.round(v * 100)}%`
              : primary.slider?.unit
                ? `${v}${primary.slider.unit}`
                : v.toFixed(2);
        };
        // slider 所有指针事件不冒泡到 row，防 mousedown→drag→mouseup 冒泡触发整行下钻
        slider.addEventListener("click", (e: MouseEvent): void => e.stopPropagation());
        slider.addEventListener("mousedown", (e: MouseEvent): void => e.stopPropagation());
        slider.addEventListener("touchstart", (e: TouchEvent): void => e.stopPropagation());
        head.append(nameRow, slider);
        row.appendChild(head);
      } else {
        // primary 是 select/button 等非 toggle/slider → 退化：整行点击下钻，不内联渲染
        const label = document.createElement("span");
        label.className = "slide-label";
        label.textContent = tr(cap.labelKey, cap.id);
        label.style.cssText = "flex:1;font-size:12px";
        row.appendChild(label);
      }
    };

    renderPrimaryInline();

    // 整行可点下钻（仅 hasSubPanel）；› 箭头纯装饰（pointer-events:none）
    if (hasSubPanel) {
      row.style.cursor = "pointer";
      row.onclick = (): void => {
        menu.navigate({
          title: tr(cap.labelKey, cap.id),
          render: (subList: HTMLElement): void => {
            subList.innerHTML = "";
            renderCapControls(subList, controls);
          },
        });
      };
      const chev = document.createElement("span");
      chev.textContent = "›";
      chev.dataset.testid = "row-chevron";
      // 装饰性：不抢点击、不改变 cursor（row 已 pointer）
      chev.style.cssText = "margin-left:auto;font-size:18px;font-weight:700;opacity:0.5;user-select:none;padding:0 4px;pointer-events:none";
      row.appendChild(chev);
    }

    list.appendChild(row);
  });
}

/** 3D 内模型切换面板：类型 tab（当前目录 + 各资源类型）懒加载候选，当前项高亮；
 *  底部提供手动路径输入支持跨类型切换。 */
function fillSwitch(list: HTMLElement, ctx: PreviewMenuCtx, closePopup: () => void): void {
  const cur = ctx.getCurrentPath();
  const rtypes = ctx.getTypeTabs?.() ?? [];
  let activeTab = ""; // "" = 当前目录（siblings）

  // 类型 tab 行：「当前目录」恒在首位，后接各资源类型（点击懒加载）
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
      "font-size:11px;padding:2px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.2);cursor:pointer;color:rgba(255,255,255,0.7);background:transparent" +
      (key === activeTab ? ";background:rgba(124,131,255,0.35);color:#fff" : "");
    b.onclick = (): void => {
      activeTab = key;
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
  mkTab("", tr("preview.switchDirTab", "当前目录"));
  for (const r of rtypes) mkTab(r, RESOURCE_TYPE_LABELS[r] || r);

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
      // 类型 tab 候选过滤当前项（避免点击自己整段重建，P3-4）；当前目录 tab 已由 getSiblings 过滤
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
        row.onclick = (): void => {
          closePopup();
          // 同类型（当前目录 tab 或类型 tab 与当前会话 rtype 一致）→ switchTo 复用外壳；
          // 跨类型 → switchExternal 整段重建，并透传 siblings（P1-1 / P1-2）
          const sameType = !viaType || activeTab === ctx.getCurrentRtype?.();
          if (!sameType && ctx.switchExternal) {
            void ctx.switchExternal(p, ctx.getSiblings());
          } else {
            void ctx.switchTo(p);
          }
        };
        listBody.appendChild(row);
      });
    };
    if (activeTab === "") {
      draw(ctx.getSiblings(), false);
    } else {
      void Promise.resolve(ctx.getModelsByType?.(activeTab) ?? Promise.resolve([])).then((paths) => {
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

  // 分隔线 + 手动路径输入（支持跨类型加载，无需退出 3D；P2-1 补回）
  const sep = document.createElement("div");
  sep.style.cssText = "height:1px;background:rgba(255,255,255,0.1);margin:6px 10px";
  list.appendChild(sep);

  const inputRow = document.createElement("div");
  inputRow.style.cssText = "display:flex;gap:4px;padding:4px 10px 8px";
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = tr("preview.switchPathPlaceholder", "输入模型文件路径…");
  input.style.cssText =
    "flex:1;font-size:12px;padding:4px 8px;border-radius:4px;border:1px solid rgba(255,255,255,0.15);" +
    "background:rgba(255,255,255,0.06);color:#fff;outline:none";
  const goByPath = (): void => {
    const path = input.value.trim();
    if (!path) return;
    closePopup();
    if (ctx.switchExternal) void ctx.switchExternal(path, ctx.getSiblings());
    else void ctx.switchTo(path);
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") goByPath();
  });
  const btn = document.createElement("button");
  btn.className = "ysm-btn";
  btn.textContent = tr("preview.switchByPath", "手动加载模型");
  btn.style.cssText = "font-size:12px;padding:4px 10px;white-space:nowrap";
  btn.onclick = goByPath;
  inputRow.append(input, btn);
  list.appendChild(inputRow);
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
  const noCap = (): void => {
    const row = document.createElement("div");
    row.style.cssText = "padding:8px 10px;color:rgba(255,255,255,0.5);font-size:12px";
    row.textContent = tr("preview.noLightCap", "\u8FDB\u5165 3D \u540E\u518D\u6253\u5F00\u706F\u5149\u9762\u677F");
    list.appendChild(row);
  };
  if (!lightCap) { noCap(); return; }

  renderCapControls(list, lightCap.getMenuControls());
}

/** 阴影面板：从注册表 shadow cap 的 getMenuControls() 渲染 */
function fillShadow(list: HTMLElement, _ctx: PreviewMenuCtx): void {
  const fromReg = sceneCapabilityRegistry.getById("shadow") as import("../caps/shadow-capability.ts").ShadowCapability | null;
  const noCap = (): void => {
    const row = document.createElement("div");
    row.style.cssText = "padding:8px 10px;color:rgba(255,255,255,0.5);font-size:12px";
    row.textContent = tr("preview.noShadowCap", "进入 3D 后再打开阴影面板");
    list.appendChild(row);
  };
  if (!fromReg) { noCap(); return; }
  renderCapControls(list, fromReg.getMenuControls());
}

/** 后处理面板：从注册表 postprocessing cap 的 getMenuControls() 渲染 */
function fillPostprocessing(list: HTMLElement, ctx: PreviewMenuCtx): void {
  const fromReg = sceneCapabilityRegistry.getById("postprocessing") as import("../caps/postprocessing-capability.ts").PostprocessingCapability | null;
  const noCap = (): void => {
    const row = document.createElement("div");
    row.style.cssText = "padding:8px 10px;color:rgba(255,255,255,0.5);font-size:12px";
    row.textContent = tr("preview.noPostprocCap", "进入 3D 后再打开后处理面板");
    list.appendChild(row);
  };
  if (!fromReg) { noCap(); return; }
  renderCapControls(list, fromReg.getMenuControls());
}
