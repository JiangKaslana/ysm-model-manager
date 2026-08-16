// ===== MMD 底部根菜单（§5.7 范式：底部悬浮导航 + 分类弹窗，对齐 YSM buildYsmBottomNav）=====
// 弹窗内容接入 🥉 ui/ 库组件（cardContainer / addCollapsible / slideRow）组织；
// 毛玻璃导航样式复用 fab.ts ensureFabStyles（ysm-3d-nav / ysm-3d-popup / ysm-3d-navbtn 类）。

import * as THREE from "three";
import type { MMD } from "@moeru/three-mmd";
import { t } from "../../core/i18n/t.ts";
import { ensureFabStyles } from "../../utils/dom/fab.ts";
import { buildCameraControls, type CameraControlBridge } from "./mount-preview-core.ts";
import { cardContainer } from "../../ui/ui-card.ts";
import { addCollapsible, addSectionTitle } from "../../ui/ui-collapsible.ts";
import { slideRow } from "../../ui/ui-slide-row.ts";
import { resolveMmdSiblings } from "./mmd-3d.ts";

export interface MmdBottomNavCtx {
  mmd: MMD;
  mesh: THREE.SkinnedMesh;
  modelName: string;
  /** 当前模型完整路径（切换区「当前」高亮判断） */
  modelPath?: string;
  /** shared 模式下核心的相机控制桥（视图菜单复用；self 模式 undefined 时降级默认值） */
  cameraControls?: CameraControlBridge;
  /** 切换到另一模型（复用核心外壳重建内容层；undefined 时不渲染切换区） */
  switchTo?(path: string): Promise<void>;
}

/** 在统一外壳（overlay）挂载 MMD 底部悬浮导航 + 分类弹窗（§5.7 范式，对齐 YSM） */
export function buildMmdBottomNav(overlay: HTMLElement, ctx: MmdBottomNavCtx): void {
  ensureFabStyles();

  const nav = document.createElement("div");
  nav.className = "ysm-3d-nav";
  const modelBtn = mkNavBtn("🧍", t("preview.modelInfo"));
  const viewBtn = mkNavBtn("🎥", t("preview.cameraView"));
  nav.appendChild(modelBtn);
  nav.appendChild(viewBtn);
  overlay.appendChild(nav);

  const popup = document.createElement("div");
  popup.className = "ysm-3d-popup";
  popup.style.display = "none";
  overlay.appendChild(popup);

  /** 关闭弹窗（nav 激活态同步）——对齐 YSM closePopup 口径 */
  const closePopup = (): void => {
    popup.style.display = "none";
    popup.innerHTML = "";
    nav
      .querySelectorAll<HTMLElement>(".ysm-3d-navbtn--on")
      .forEach((b) => b.classList.remove("ysm-3d-navbtn--on"));
  };

  /** 切换弹窗：同菜单再点收起，跨菜单切换内容（对齐 YSM togglePopup 口径） */
  const togglePopup = (fill: () => void, btn: HTMLElement): void => {
    const wasOpen = popup.style.display !== "none";
    const isSame = btn.classList.contains("ysm-3d-navbtn--on");
    closePopup();
    if (wasOpen && isSame) return;
    btn.classList.add("ysm-3d-navbtn--on");
    fill();
    popup.style.display = "flex";
  };

  /** 表情开/关切换（morphTargetInfluences 权重 0/1），切换后重绘菜单同步高亮 */
  const toggleMorph = (name: string): void => {
    const dict = ctx.mesh.morphTargetDictionary || {};
    const idx = dict[name];
    if (idx === undefined || !ctx.mesh.morphTargetInfluences) return;
    ctx.mesh.morphTargetInfluences[idx] = ctx.mesh.morphTargetInfluences[idx] > 0.5 ? 0 : 1;
    fillModelMenu();
  };
  const morphActive = (name: string): boolean => {
    const dict = ctx.mesh.morphTargetDictionary || {};
    const idx = dict[name];
    return idx !== undefined && (ctx.mesh.morphTargetInfluences?.[idx] ?? 0) > 0.5;
  };

  // ── 模型菜单：信息卡（ui/ 库 cardContainer）+ 表情列表（collapsible + slideRow）+ 切换模型区 ──
  /** 同类型模型候选缓存（类型根固定不随当前模型变，切换后无需刷新；首次打开菜单拉取） */
  let siblingsCache: string[] | null = null;
  const fillModelMenu = (): void => {
    popup.innerHTML = "";
    const pmx = ctx.mmd.pmx;
    cardContainer(popup, (c) => {
      addInfoRow(c, t("preview.nameLabel"), ctx.modelName);
      addInfoRow(
        c,
        t("preview.modelOverview"),
        `${pmx.bones.length} 骨骼 · ${pmx.materials.length} 材质 · ${pmx.morphs.length} 表情`,
      );
    });
    const morphNames = Object.keys(ctx.mesh.morphTargetDictionary || {});
    if (morphNames.length > 0) {
      addCollapsible(popup, {
        title: `😀 ${t("preview.mmdMorph")} (${morphNames.length})`,
        defaultOpen: true,
        testId: "mmd-morph-list",
        renderContent: (container) => {
          morphNames.forEach((name) => {
            slideRow(
              container,
              "🙂",
              name,
              false,
              () => toggleMorph(name),
              undefined,
              undefined,
              morphActive(name), // focused：当前开启的表情高亮
              undefined,
              { testId: "mmd-morph-" + name },
            );
          });
        },
      });
    }
    // 切换模型区：同类型候选列表（resolveMmdSiblings 函数声明提升，循环依赖安全）；
    // 点击经 ctx.switchTo 复用核心外壳重建内容层（ADR-066 §5.6）
    if (!ctx.switchTo) return;
    void resolveMmdSiblings().then((siblings) => {
      if (popup.style.display === "none" || siblings.length === 0) return; // 菜单已关 / 无候选
      siblingsCache = siblings;
      addSectionTitle(popup, `📦 ${t("preview.mmdLoadModel")} (${siblings.length})`);
      siblings.forEach((p) => {
        const isCurrent = !!ctx.modelPath && p.toLowerCase() === ctx.modelPath.toLowerCase();
        slideRow(
          popup,
          "📦",
          p.split(/[/\\]/).pop() || p,
          true,
          () => void ctx.switchTo?.(p),
          undefined,
          undefined,
          isCurrent, // focused：当前模型高亮
          undefined,
          { testId: "mmd-load-" + (p.split(/[/\\]/).pop() || "model") },
        );
      });
    });
  };

  // ── 视图菜单：相机控件（复用 core cameraControls bridge，对齐 YSM fillViewMenu）──
  const fillViewMenu = (): void => {
    popup.innerHTML = "";
    buildCameraControls(popup, {
      getOrbit: () => ctx.cameraControls?.getOrbit() ?? true,
      setOrbit: (v: boolean) => ctx.cameraControls?.setOrbit(v),
      getSpeed: () => ctx.cameraControls?.getSpeed() ?? 20,
      setSpeed: (n: number) => ctx.cameraControls?.setSpeed(n),
      reset: () => ctx.cameraControls?.reset(),
    });
  };

  modelBtn.onclick = (): void => togglePopup(fillModelMenu, modelBtn);
  viewBtn.onclick = (): void => togglePopup(fillViewMenu, viewBtn);
}

/** 底部导航按钮（毛玻璃 HUD 样式类来自 fab.ts ensureFabStyles） */
function mkNavBtn(icon: string, label: string): HTMLElement {
  const btn = document.createElement("button");
  btn.className = "ysm-3d-navbtn";
  btn.innerHTML = `<span class="ysm-ic">${icon}</span><span class="ysm-3d-navlabel">${label}</span>`;
  return btn;
}

/** 信息行（label + value，§19：颜色用 var(--*)） */
function addInfoRow(container: HTMLElement, label: string, value: string): void {
  const row = document.createElement("div");
  row.style.cssText = "display:flex;justify-content:space-between;gap:8px;padding:4px 0;font-size:12px";
  const l = document.createElement("span");
  l.style.cssText = "color:var(--muted)";
  l.textContent = label;
  const v = document.createElement("span");
  v.style.cssText = "color:var(--txt)";
  v.textContent = value;
  row.appendChild(l);
  row.appendChild(v);
  container.appendChild(row);
}
