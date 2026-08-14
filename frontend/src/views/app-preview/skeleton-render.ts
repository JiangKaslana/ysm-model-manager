// ===== 骨骼渲染逻辑 =====
// 纯 DOM 创建/HTML 生成函数，不含事件绑定
import { safeGet, safeSet } from "../../utils/dom/storage.ts";
import type { BedrockGeometry } from "./geometry.ts";
import { esc } from "../../utils/dom/html.ts";
import { getApp } from "../../backend/app.ts";
import { statsCardHTML } from "./tpl.ts";
import { buildBoneNamesText } from "./bone-names.ts";
import { screenshotPreview } from "../../utils/3d/model3d.ts";
import { createIconButton } from "../../utils/dom/fab.ts";
import { renderMultiAngle } from "./screenshot-renderer.ts";
import { t } from "../../core/i18n/t.ts";
import { sec, iRow, buildDepthMap } from "./skeleton-utils.ts";
import type { PreviewRoot, YsmDecoder, PreviewDebugger } from "./utils.ts";
// P1 修复（ADR-040）：fill3DPanel 已拆至 skeleton-fill-panel.ts，此处 re-export 兼容
export { fill3DPanel } from "./skeleton-fill-panel.ts";

/** RenderModel3DHandle 运行时扩展（_keyHandler/_timeTimer/_boneDetailEl 为 JS 时代附加字段） */
export type Model3DHandleX = import("../../utils/3d/model3d.ts").RenderModel3DHandle & {
  _keyHandler?: ((e: KeyboardEvent) => void) | null;
  _timeTimer?: ReturnType<typeof setInterval>;
  _boneDetailEl?: HTMLElement | null;
};

/**
 * 创建 2D 骨骼画布并异步加载纹理
 */
export async function setup2DCanvas(
  container: HTMLElement,
  model: BedrockGeometry & { texture?: string | null; _modelPath?: string },
): Promise<{ canvas: HTMLCanvasElement; textureImg: HTMLImageElement | null }> {
  const canvas = document.createElement("canvas");
  canvas.width = 180;
  canvas.height = 180;
  canvas.className = "ysm-canvas";
  container.appendChild(canvas);

  let textureImg: HTMLImageElement | null = null;
  if (model.texture) {
    textureImg = new Image();
    await new Promise((r) => {
      textureImg!.onload = r;
      textureImg!.onerror = r;
      textureImg!.src = model.texture as string;
    });
  }
  return { canvas, textureImg };
}

/**
 * 构建骨骼名开关行（不含放大按钮，放大按钮由调用方单独添加）
 */
export function buildToggleRow(
  container: HTMLElement,
): {
  toggleRow: HTMLElement;
  eyeBtn: HTMLButtonElement;
  eyeHint: HTMLSpanElement;
  getLabelsOn: () => boolean;
  setLabelsOn: (v: boolean) => void;
} {
  const toggleRow = document.createElement("div");
  toggleRow.className = "ysm-toggle-row";
  const eyeBtn = document.createElement("button");
  eyeBtn.className = "ysm-btn";
  const savedState = safeGet("ysm_showBoneLabels") !== "false";
  let _labelsOn = savedState;
  eyeBtn.innerHTML = _labelsOn ? `👁 ${t("preview.boneLabels")}` : `👁‍🗨 ${t("preview.boneLabels")}`;
  eyeBtn.title = "切换骨骼名称显示";
  const eyeHint = document.createElement("span");
  eyeHint.className = "ysm-hint";
  eyeHint.textContent = _labelsOn ? t("preview.on") : t("preview.off");
  toggleRow.appendChild(eyeBtn);
  toggleRow.appendChild(eyeHint);
  container.appendChild(toggleRow);

  return {
    toggleRow,
    eyeBtn,
    eyeHint,
    getLabelsOn: () => _labelsOn,
    setLabelsOn: (v: boolean) => {
      _labelsOn = v;
      eyeBtn.innerHTML = _labelsOn ? `👁 ${t("preview.boneLabels")}` : `👁‍🗨 ${t("preview.boneLabels")}`;
      eyeHint.textContent = _labelsOn ? t("preview.on") : t("preview.off");
    },
  };
}

/**
 * 构建统计卡片（含作者列表）
 */
export function buildStatsCard(
  container: HTMLElement,
  model: BedrockGeometry & { _authors?: Array<{ avatarUrl?: string | null; name?: string; role?: string }>; _modelPath?: string },
  modelPath: string,
  _decodedBy: string,
  ctx: PreviewRoot & YsmDecoder & PreviewDebugger,
): void {
  const card = document.createElement("div");
  card.className = "ysm-card";
  card.innerHTML = statsCardHTML(model, modelPath, _decodedBy);
  const authors: Array<{ avatarUrl?: string | null; name?: string; role?: string }> =
    model._authors || [];
  if (authors.length > 0) {
    const authorHtml =
      '<div class="ysm-card-section-label" style="margin-top:6px">👥 ' + t("preview.authors") + '</div>' +
      authors
        .map(
          (au) => `<div style="display:flex;align-items:center;gap:6px;padding:3px 0">
        ${
          au.avatarUrl
            ? `<img src="${esc(au.avatarUrl)}" style="width:20px;height:20px;border-radius:50%;object-fit:cover;border:1px solid var(--bd)" onerror="this.style.display='none'">`
            : '<span style="width:20px;height:20px;border-radius:50%;background:var(--hover);display:inline-block"></span>'
        }
        <span style="font-size:11px;color:var(--txt)">${esc(au.name || "")}</span>
        ${
          au.role
            ? `<span style="font-size:9px;color:var(--muted)">(${esc(au.role)})</span>`
            : ""
        }
      </div>`,
        )
        .join("");
    card.innerHTML += authorHtml;
    const avatarContainer = ctx.root.getElementById("ysm-author-avatars");
    if (avatarContainer) {
      avatarContainer.innerHTML = authors
        .map(
          (au) =>
            `<img src="${esc(au.avatarUrl || "")}" title="${esc(au.name || "")}" style="width:24px;height:24px;border-radius:50%;object-fit:cover;border:1px solid var(--bd);margin:0 2px" onerror="this.style.display='none'">`,
        )
        .join("");
    }
  }
  container.appendChild(card);
}

/**
 * 构建导出骨骼名按钮行
 */
export function buildBoneExportRow(
  container: HTMLElement,
  model: BedrockGeometry & { boneCount?: number; bones?: Array<{ id: string; name: string; parentId?: string }> },
  modelPath: string,
): void {
  const boneRow = document.createElement("div");
  boneRow.className = "ysm-toggle-row";
  const boneBtn = document.createElement("button");
  boneBtn.className = "ysm-btn";
  boneBtn.textContent = "📋 " + t("preview.exportBones");
  boneBtn.title = "导出骨骼名称为文本文件";
  const boneHint = document.createElement("span");
  boneHint.className = "ysm-hint";
  boneHint.textContent = `${model.boneCount} ${t("preview.bones")}`;
  boneBtn.onclick = (): void => {
    const lines = buildBoneNamesText(modelPath, model.boneCount ?? 0, model.bones || []);
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const a = document.createElement("a");
    a.download = (modelPath.split(/[/\\]/).pop() || "model") + "_bones.txt";
    a.href = URL.createObjectURL(blob);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  };
  boneRow.appendChild(boneBtn);
  boneRow.appendChild(boneHint);
  container.appendChild(boneRow);
}

/**
 * 截图保存内部逻辑（供 3D overlay 使用）
 */
export async function saveScreenshot(
  model: BedrockGeometry & { textures?: string[] | null; _modelPath?: string },
  key: string,
  setShotState: (icon: string) => void,
): Promise<void> {
  const { SaveScreenshotFile } = await getApp();
  const p = (model._modelPath || "screenshot").replace(/\\/g, "/");
  const base = p.split("/").pop()?.replace(/\.\w+$/, "") || "";
  if (key === "current") {
    const b64 = screenshotPreview();
    if (!b64) {
      // 抛错而非静默吞错：让消费者统一 catch（setIcon ❌ + toast），
      // 否则用户只见 ❌ 无原因（陷阱 #3 静类：异步失败须可观测）
      throw new Error("screenshotPreview 返回空（3D 渲染尚未就绪）");
    }
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    await SaveScreenshotFile(base + "_" + ts + ".png", b64);
  } else if (key === "all") {
    for (const k of ["front", "45", "side", "back45"]) await saveScreenshot(model, k, setShotState);
  } else {
    const texUrls =
      model.textures && model.textures.length > 1
        ? model.textures
        : [model.texture || ""];
    const results = await renderMultiAngle(model._modelPath || "", texUrls, { size: 512 });
    if (!results) return;
    const hit = results.find((r) => r.name === key);
    if (hit) await SaveScreenshotFile(base + "_" + key + ".png", hit.base64);
  }
  setShotState("\u2705");
  setTimeout(() => setShotState("\u{1F4F7}"), 2000);
}

/**
 * 构建 3D overlay 完整 DOM 结构
 * 返回所有关键节点引用及 state holder
 */
export function build3DOverlay(
  model: BedrockGeometry & { textures?: string[] | null; _modelPath?: string },
  ctx: PreviewRoot & YsmDecoder & PreviewDebugger,
): {
  overlay: HTMLDivElement;
  topBar: HTMLDivElement;
  body: HTMLDivElement;
  viewContainer: HTMLDivElement;
  panel: HTMLDivElement;
  shotBtn: HTMLElement;
  shotMenu: HTMLDivElement;
  resetBtn: HTMLElement;
  modelSel: HTMLSelectElement;
  rotSel: HTMLSelectElement;
  spdSlider: HTMLInputElement;
  spdVal: HTMLSpanElement;
  loadingEl: HTMLDivElement;
  closeBtn: HTMLElement;
  panelToggle: HTMLElement;
  resizeHandle: HTMLDivElement;
  shotWrap: HTMLDivElement;
} {
  const overlay = document.createElement("div");
  overlay.id = "ysm-overlay-3d";
  overlay.className = "ysm-ovl-root";

  const topBar = document.createElement("div");
  topBar.id = "ysm-topbar-3d";
  topBar.className = "ysm-ovl-bar";

  // 关闭按钮
  const closeBtn = createIconButton({ icon: "✕", label: t("preview.close3d") });
  closeBtn.id = "ysm-close-3d";
  topBar.appendChild(closeBtn);

  // 纹理选择器
  if ((model.textures?.length ?? 0) > 1) {
    const texSel = document.createElement("select");
    texSel.className = "ysm-ovl-select";
    model.textures!.forEach((_, i) => {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = `${t("preview.texture")} ${i + 1}`;
      texSel.appendChild(opt);
    });
    topBar.appendChild(texSel);
  }

  const spacer = document.createElement("div");
  spacer.className = "ysm-ovl-spacer";
  topBar.appendChild(spacer);

  // 截图按钮 + 菜单
  const shotWrap = document.createElement("div");
  shotWrap.className = "ysm-ovl-shotwrap";
  const shotBtn = createIconButton({
    icon: "\u{1F4F7}",
    label: t("preview.screenshot"),
    title: t("preview.screenshot"),
  });
  shotBtn.className = "ysm-ovl-btn ysm-ovl-shotbtn";
  shotBtn.setAttribute("aria-label", t("preview.screenshot") + " menu");
  const arrowSpan = document.createElement("span");
  arrowSpan.style.marginLeft = "4px";
  arrowSpan.textContent = " ▾";
  shotBtn.appendChild(arrowSpan);
  const shotMenu = document.createElement("div");
  shotMenu.className = "ysm-ovl-shotmenu";
  const shotItems = [
    { label: t("preview.screenshotCurrent"), key: "current" },
    { label: t("preview.screenshotFront"), key: "front" },
    { label: t("preview.screenshot45"), key: "45" },
    { label: t("preview.screenshotSide"), key: "side" },
    { label: t("preview.screenshotBack45"), key: "back45" },
    { label: t("preview.screenshotAll"), key: "all" },
  ];
  shotItems.forEach((item) => {
    const el = document.createElement("div");
    el.textContent = item.label;
    el.className = "ysm-ovl-shotitem";
    el.setAttribute("aria-label", t("preview.screenshot") + " — " + item.label);
    shotMenu.appendChild(el);
  });
  shotWrap.appendChild(shotBtn);
  shotWrap.appendChild(shotMenu);
  topBar.appendChild(shotWrap);

  // 重置视角按钮
  const resetBtn = createIconButton({
    icon: "⟲",
    label: t("preview.resetView"),
    title: "重置相机视角到初始位置",
  });
  topBar.appendChild(resetBtn);

  // 模型选择下拉
  const modelSel = document.createElement("select");
  modelSel.className = "ysm-ovl-select";
  modelSel.style.display = "none";
  topBar.appendChild(modelSel);

  // 旋转模式
  const rotLabel = document.createElement("span");
  rotLabel.className = "ysm-ovl-label";
  rotLabel.textContent = t("preview.cameraRotation") + ":";
  topBar.appendChild(rotLabel);
  const rotSel = document.createElement("select");
  rotSel.className = "ysm-ovl-select";
  rotSel.style.marginRight = "8px";
  [{ v: true, t: "环绕" }, { v: false, t: "自身" }].forEach((m) => {
    const opt = document.createElement("option");
    opt.value = String(m.v);
    opt.textContent = m.t;
    rotSel.appendChild(opt);
  });
  rotSel.value = safeGet("td-rot-mode") === "free" ? "false" : "true";
  topBar.appendChild(rotSel);

  // 速度控制
  const spdLabel = document.createElement("span");
  spdLabel.className = "ysm-ovl-label";
  spdLabel.textContent = t("preview.cameraSpeed") + ":";
  topBar.appendChild(spdLabel);
  const spdSlider = document.createElement("input");
  spdSlider.type = "range";
  spdSlider.min = "2";
  spdSlider.max = "200";
  spdSlider.value = safeGet("td-cam-speed") || "20";
  spdSlider.className = "ysm-ovl-slider";
  topBar.appendChild(spdSlider);
  const spdVal = document.createElement("span");
  spdVal.className = "ysm-ovl-val";
  spdVal.textContent = safeGet("td-cam-speed") || "20";
  topBar.appendChild(spdVal);

  overlay.appendChild(topBar);

  // 主体容器
  const body = document.createElement("div");
  body.style.cssText = "flex:1;position:relative;overflow:hidden";
  const viewContainer = document.createElement("div");
  viewContainer.style.cssText = "position:absolute;inset:0;overflow:hidden";
  body.appendChild(viewContainer);

  // 信息面板
  const panel = document.createElement("div");
  panel.id = "ysm-3d-panel";
  panel.className = "ysm-3d-panel";

  // 面板拖拽柄
  const resizeHandle = document.createElement("div");
  resizeHandle.style.cssText = "position:absolute;top:0;bottom:0;width:4px;cursor:col-resize;z-index:6;touch-action:none;background:rgba(255,255,255,0.2);border-radius:2px";
  resizeHandle.style.right = panel.style.width || "260px";
  body.appendChild(resizeHandle);

  // 折叠按钮
  const panelToggle = createIconButton({
    icon: "panel-hide",
    label: t("preview.hidePanel"),
    title: t("preview.hidePanel"),
  });
  topBar.appendChild(panelToggle);

  // 加载动画 keyframes
  const progStyle = document.createElement("style");
  progStyle.textContent = "@keyframes ysm-prog{0%{margin-left:-30%}100%{margin-left:130%}}";
  overlay.appendChild(progStyle);

  body.appendChild(panel);
  overlay.appendChild(body);
  document.body.appendChild(overlay);

  // 加载指示器
  const loadingEl = document.createElement("div");
  loadingEl.style.cssText =
    "position:absolute;inset:0;top:40px;display:flex;flex-direction:column;align-items:center;justify-content:center;color:rgba(255,255,255,0.6);font-size:14px;gap:12px;z-index:10;background:rgba(26,27,46,0.9)";
  loadingEl.innerHTML =
    '<div style="font-size:32px">🧱</div><div>' + t("preview.loadingModel") + '</div><div style="width:200px;height:3px;background:rgba(255,255,255,0.1);border-radius:2px;overflow:hidden"><div style="height:100%;width:30%;background:var(--accent,#7c83ff);border-radius:2px;animation:ysm-prog 1.5s ease-in-out infinite"></div></div>';
  overlay.appendChild(loadingEl);

  return {
    overlay, topBar, body, viewContainer, panel,
    shotBtn, shotMenu, resetBtn, modelSel, rotSel, spdSlider, spdVal,
    loadingEl, closeBtn, panelToggle, resizeHandle, shotWrap,
  };
}



