// ===== 2D 骨骼渲染层 =====
// 加载统一走 loadModelData，本文件只做 2D 骨骼渲染编排
import { getPrefer3D, setPrefer3D, type PreviewRoot, type YsmDecoder, type PreviewDebugger } from "./utils.ts";
import { loadModelData } from "./loader.ts";
import { renderModel2D } from "../../utils/3d/model2d.ts";
import { openFullPreview } from "./zoom.ts";
import { safeGet, safeSet } from "../../utils/dom/storage.ts";
import type { BoneSelectInfo } from "../../utils/3d/model3d.ts";
import type { BedrockGeometry } from "./geometry.ts";
import { esc } from "../../utils/dom/html.ts";
import { bus } from "../../bus.ts";
import { friendlyError } from "../../utils/dom/errors.ts";
import { ensureFabStyles, createIconButton } from "../../utils/dom/fab.ts";
import { registerAndroidBackHandler } from "../../utils/dom/android-bridge.ts";
import { preloadModel } from "./model3d-loader.ts";
import { renderModel3D } from "../../utils/3d/model3d.ts";
import { t } from "../../core/i18n/t.ts";
import { sec, iRow } from "./skeleton-utils.ts";
import {
  setup2DCanvas, buildToggleRow, buildStatsCard, buildBoneExportRow,
  build3DOverlay, fill3DPanel, saveScreenshot, type Model3DHandleX,
} from "./skeleton-render.ts";

// 2D 拖拽的 window 监听器槽位：loadModel2D 每次渲染模型都会绑定，
// 先移除上一轮处理器再绑定，防止 window 级监听器累积泄漏
let _prevWindowMove: ((e: PointerEvent) => void) | null = null;
let _prevWindowUp: ((e: PointerEvent) => void) | null = null;

/**
 * P2 修复（审核）：3D overlay 挂 document.body，不随预览面板 shadow DOM 重建消失。
 * 后台 model:select（导入队列/回收站自动选择）在 3D 打开期间触发时，若只叠新 overlay
 * 不清旧的全屏层，会造成双全屏叠加 + 旧 renderer 死屏残留。此模块级钩子让调用方
 * （app-preview/index.ts 的 model:select handler）在切换模型前先关掉活跃 3D。
 * 注意：关闭时保留 _prefer3D（切模型保持 3D 预览），仅清理 DOM 与 WebGL 资源。
 */
let _active3DClose: (() => void) | null = null;

/** 关闭当前活跃的 3D 全屏 overlay（若存在）。供 app-preview/index.ts 切换模型前调用。 */
export function closeActive3DOverlay(): void {
  _active3DClose?.();
  _active3DClose = null;
}

/** 连点/多菜单触发时忽略并发（防重复保存文件） */
function makeShotGuard(shotBtn: HTMLElement): {
  saving: boolean; setSaving: (v: boolean) => void; setIcon: (icon: string) => void;
} {
  let _saving = false;
  const setIcon = (icon: string): void => {
    const ic = shotBtn.querySelector<HTMLElement>(".ysm-ic");
    if (ic) ic.textContent = icon;
  };
  return { get saving() { return _saving; }, setSaving: (v: boolean) => { _saving = v; }, setIcon };
}

/** 加载模型 2D 骨骼线条图 + 统计面板 */
export async function loadModel2D(
  ctx: PreviewRoot & YsmDecoder & PreviewDebugger,
  modelPath: string,
  skelContainer: HTMLElement | null,
): Promise<void> {
  const content = skelContainer || ctx.root.getElementById("preview-content");
  if (!content) return;
  content.innerHTML = "";
  const container = document.createElement("div");
  container.style.cssText = "margin-bottom:8px;opacity:0.6";
  container.innerHTML = `<div class="ysm-loading-title">🏗️ ${t("preview.loadingStructure")}</div><div class="ysm-loading-bar"></div>`;
  content.appendChild(container);
  try {
    const loaded = await loadModelData(modelPath, {
      decodeYsmViaWasm: (p) => ctx.decodeYsmViaWasm(p),
      appendDebug: (_c, msg) => ctx.appendDebug(container, msg),
    });
    const model = loaded.model;
    const _decodedBy = loaded.decodedBy;
    if (!container.isConnected) return;
    if (!model?.bones?.length) {
      container.innerHTML = `<div class="ysm-error-title">🏗️ ${t("preview.skeletonStructure")}</div><div class="ysm-error-body">⚠️ ${t("preview.noGeometry")}</div>`;
      return;
    }
    container.style.opacity = "1";
    container.innerHTML = "";
    const { canvas, textureImg } = await setup2DCanvas(container, model);
    if (!container.isConnected) return;
    const { eyeBtn, eyeHint, getLabelsOn, setLabelsOn } = buildToggleRow(container);
    const zoomBtn = document.createElement("button");
    zoomBtn.className = "ysm-btn";
    zoomBtn.innerHTML = "🔍 " + t("preview.zoom");
    zoomBtn.title = "全窗口查看模型";
    zoomBtn.onclick = (): void => { openFullPreview(canvas, model, textureImg, getLabelsOn()); };
    container.querySelector<HTMLElement>(".ysm-toggle-row")!.appendChild(zoomBtn);
    let _zoom = 1, _rotation = 0;
    const model2d = model as Parameters<typeof renderModel2D>[1];
    const doRender = (): void => {
      try { renderModel2D(canvas, model2d, textureImg, { showLabels: getLabelsOn(), zoom: _zoom, rotation: _rotation }); }
      catch (e) { console.warn("[preview] 2D 渲染跳过:", e); }
    };
    doRender();
    eyeBtn.onclick = (): void => { const next = !getLabelsOn(); setLabelsOn(next); safeSet("ysm_showBoneLabels", String(next)); doRender(); };
    canvas.classList.add("ysm-grab");
    canvas.title = "左键全窗放大 · 滚轮缩放 · 左右拖拽旋转";
    let _dragging = false, _dragged = false, _lastX = 0;
    canvas.addEventListener("pointerdown", (e) => { if (e.button !== 0) return; _dragging = true; _dragged = false; _lastX = e.clientX; canvas.setPointerCapture(e.pointerId); });
    if (_prevWindowMove) window.removeEventListener("pointermove", _prevWindowMove);
    if (_prevWindowUp) window.removeEventListener("pointerup", _prevWindowUp);
    const onWindowMove = (e: PointerEvent): void => { if (!_dragging) return; const dx = e.clientX - _lastX; if (Math.abs(dx) > 3) _dragged = true; _lastX = e.clientX; _rotation = (_rotation + dx * 0.5) % 360; doRender(); };
    const onWindowUp = (e: PointerEvent): void => { _dragging = false; if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId); };
    _prevWindowMove = onWindowMove; _prevWindowUp = onWindowUp;
    window.addEventListener("pointermove", onWindowMove); window.addEventListener("pointerup", onWindowUp);
    ctx.unsubs?.push(() => { window.removeEventListener("pointermove", onWindowMove); window.removeEventListener("pointerup", onWindowUp); if (_prevWindowMove === onWindowMove) _prevWindowMove = null; if (_prevWindowUp === onWindowUp) _prevWindowUp = null; });
    canvas.addEventListener("click", (e) => { if (_dragged) { e.stopPropagation(); return; } openFullPreview(canvas, model, textureImg, getLabelsOn()); });
    canvas.addEventListener("wheel", (e) => { e.preventDefault(); _zoom = Math.max(0.2, Math.min(10, _zoom * Math.exp(-e.deltaY * 0.002))); doRender(); }, { passive: false });
    buildStatsCard(container, model, modelPath, _decodedBy, ctx);
    buildBoneExportRow(container, model as BedrockGeometry & { boneCount?: number; bones?: Array<{ id: string; name: string; parentId?: string }> }, modelPath);
    let _model3d: Model3DHandleX | null = null;
    let _overlay3d: HTMLDivElement | null = null;
    let _is3D = false, _prefer3D = getPrefer3D(), _loading3D = false, _model3dGen = 0;
    const _toggle3D = async (): Promise<void> => {
      if (_loading3D) return;
      _is3D = !_is3D; _prefer3D = _is3D; setPrefer3D(_prefer3D);
      if (!_is3D) return;
      ensureFabStyles(); _loading3D = true;
      const gen = ++_model3dGen;
      const { overlay, topBar, body, viewContainer, panel, shotBtn, shotMenu, resetBtn, modelSel, rotSel, spdSlider, spdVal, loadingEl, closeBtn, panelToggle, resizeHandle, shotWrap } = build3DOverlay(model, ctx);
      _overlay3d = overlay;
      if (!container.isConnected) { loadingEl.remove(); return; }
      const shot = makeShotGuard(shotBtn);
      const saveShot = async (key: string): Promise<void> => {
        if (shot.saving) return; shot.setSaving(true);
        try { await saveScreenshot(model, key, shot.setIcon); }
        catch (e) { shot.setIcon("\u274C"); console.error("[3D 截图]", e); bus.emit("toast:show", { msg: "截图保存失败：" + friendlyError(e), duration: 4000, type: "error" }); }
        finally { shot.setSaving(false); }
      };
      const shotKeys = ["current", "front", "45", "side", "back45", "all"];
      shotMenu.querySelectorAll<HTMLElement>(".ysm-ovl-shotitem").forEach((el, i) => { el.onclick = (): void => { shotMenu.style.display = "none"; saveShot(shotKeys[i]); }; });
      shotBtn.addEventListener("pointerenter", () => { shotMenu.style.display = "block"; });
      shotBtn.addEventListener("click", (e) => { e.stopPropagation(); shotMenu.style.display = shotMenu.style.display === "block" ? "none" : "block"; });
      shotWrap.addEventListener("pointerleave", () => { shotMenu.style.display = "none"; });
      let _texIdx = 0;
      const texSel = topBar.querySelector<HTMLSelectElement>(".ysm-ovl-select");
      if (texSel) texSel.onchange = (): void => { _texIdx = parseInt(texSel.value, 10); close3D(); _loading3D = false; _toggle3D(); };
      let _resizing = false;
      const onResizeMove = (e: PointerEvent): void => { if (!_resizing) return; const r = body.getBoundingClientRect(); panel.style.width = Math.max(160, Math.min(500, r.right - e.clientX)) + "px"; resizeHandle.style.right = panel.style.width; };
      const onResizeUp = (e: PointerEvent): void => { _resizing = false; if (resizeHandle.hasPointerCapture(e.pointerId)) resizeHandle.releasePointerCapture(e.pointerId); };
      resizeHandle.addEventListener("pointerdown", (e) => { if (e.button !== 0) return; _resizing = true; e.preventDefault(); resizeHandle.setPointerCapture(e.pointerId); });
      document.addEventListener("pointermove", onResizeMove); document.addEventListener("pointerup", onResizeUp);
      let _panelVisible = true;
      panelToggle.onclick = (): void => { _panelVisible = !_panelVisible; panel.style.display = _panelVisible ? "" : "none"; panelToggle.className = "ysm-ovl-btn" + (_panelVisible ? " ysm-ovl-panelbtn" : ""); const ic = panelToggle.querySelector<HTMLElement>(".ysm-ic"); if (ic) { ic.classList.remove("ysm-ic--panel-hide", "ysm-ic--panel-show"); ic.classList.add(_panelVisible ? "ysm-ic--panel-hide" : "ysm-ic--panel-show"); } };
      const close3D = (keepPrefer = false): void => { const idx = ctx.unsubs?.indexOf(close3D); if (idx !== undefined && idx > -1) ctx.unsubs?.splice(idx, 1); _active3DClose = null; document.removeEventListener("pointermove", onResizeMove); document.removeEventListener("pointerup", onResizeUp); if (_model3d) { if (_model3d._timeTimer) clearInterval(_model3d._timeTimer); if (_model3d._keyHandler) document.removeEventListener("keydown", _model3d._keyHandler); _model3d.cleanup(); _model3d = null; } _model3dGen++; if (_overlay3d?.parentNode) _overlay3d.parentNode.removeChild(_overlay3d); _overlay3d = null; _is3D = false; if (!keepPrefer) { _prefer3D = false; setPrefer3D(false); } };
      ctx.unsubs?.push(close3D); _active3DClose = () => close3D(true);
      registerAndroidBackHandler(() => { close3D(); return true; });
      try {
        const { texArr, spec } = await preloadModel(model as import("./model3d-loader.ts").ModelLike);
        const h = (await renderModel3D(viewContainer, texArr, spec as import("../../utils/3d/model3d.ts").Spec3D, _texIdx)) as Model3DHandleX;
        if (gen !== _model3dGen) { h.cleanup(); _loading3D = false; return; }
        _model3d = h; loadingEl.remove();
        resetBtn.onclick = (): void => { _model3d?.resetCamera(); };
        _model3d.onBoneSelect = (info: BoneSelectInfo) => {
          const detailEl = _model3d?._boneDetailEl;
          if (detailEl) {
            let txt = "🦴 " + info.name + "\n路径: " + info.path + "\n父骨骼: " + (info.parent || "(无)") + "\n子骨骼: " + info.children.length + " 个\nMesh: " + info.meshCount + "\nlocalPos: (" + info.localPos.map((v: number) => v.toFixed(3)).join(", ") + ")\n世界坐标: (" + info.worldPos.map((v: number) => v.toFixed(2)).join(", ") + ")";
            if (info.localRot) txt += "\nlocalRot: (" + info.localRot.map((v: number) => v.toFixed(4)).join(", ") + ")";
            if (info.cubeRot) txt += "\ncubeRot: (" + info.cubeRot.map((v: number) => v.toFixed(4)).join(", ") + ")";
            if (info.cubePos) txt += "\ncubePos: (" + info.cubePos.map((v: number) => v.toFixed(3)).join(", ") + ")";
            detailEl.textContent = txt;
            if (detailEl.parentNode) (detailEl.parentNode as HTMLElement).style.display = "block";
          }
          const bc = document.querySelector<HTMLElement>(`#ysm-3d-panel [style*="max-height:300px"]`);
          if (bc) { for (const lbl of bc.querySelectorAll<HTMLLabelElement>("label")) { const sp = lbl.querySelector("span"); if (sp && sp.textContent === info.name) { lbl.scrollIntoView({ block: "nearest", behavior: "smooth" }); lbl.style.background = "rgba(124,131,255,0.25)"; setTimeout(() => { lbl.style.background = ""; }, 1500); break; } } }
        };
        fill3DPanel(panel, model, texArr as import("three").Texture[], spec as import("../../utils/3d/model3d.ts").Spec3D, _model3d, modelSel);
        const tip = document.createElement("div"); tip.style.cssText = "padding:6px 12px;background:rgba(124,131,255,0.2);color:#fff;font-size:12px;text-align:center;flex-shrink:0;font-weight:500";
        const _isTouch = window.matchMedia?.("(pointer:coarse)").matches ?? false;
        tip.textContent = _isTouch ? "👆 拖拽旋转 · 双指缩放 · ✕ 关闭" : "🎮 WASD 移动 | 空格/Shift 上下 | 🖱 拖拽旋转 | 🔍 滚轮缩放 | ESC 关闭";
        overlay.insertBefore(tip, overlay.children[1]); setTimeout(() => { if (tip.parentNode) tip.remove(); }, 6000);
        rotSel.onchange = (): void => { _model3d?.setRotationMode(rotSel.value === "true"); safeSet("td-rot-mode", rotSel.value === "true" ? "orbit" : "free"); };
        spdSlider.oninput = (): void => { spdVal.textContent = spdSlider.value; _model3d?.setSpeed(Number(spdSlider.value)); localStorage.setItem("td-cam-speed", spdSlider.value); };
        modelSel.onchange = (): void => { _model3d?.showModelGroup(parseInt(modelSel.value, 10)); };
        const onKey = (e: KeyboardEvent): void => { if (e.key !== "Escape") return; close3D(); };
        document.addEventListener("keydown", onKey); if (_model3d) _model3d._keyHandler = onKey;
      } catch (e) { console.error("[3D] 加载失败:", e); loadingEl.remove(); viewContainer.innerHTML = `<div style="padding:40px;color:#ff6b6b;font-size:14px">⚠️ ${t("preview.preview3dLoadFailed")}: ${esc(e instanceof Error ? e.message : String(e))}</div>`; bus.emit("toast:show", { msg: "❌ " + friendlyError(e, t("preview.preview3dLoadFailed")), duration: 5000, type: "error" }); }
      _loading3D = false;
    };
    const btn3d = ctx.root.getElementById("btn-3d-preview");
    if (btn3d) btn3d.onclick = (): void => { _toggle3D(); };
    if (_prefer3D) requestAnimationFrame(() => btn3d?.click());
  } catch (e) { container.innerHTML = `<div class="ysm-error-title" style="color:#ff6b6b">🏗️ ${t("preview.skeletonStructure")}</div><div class="ysm-error-body">⚠️ ${t("preview.parseFailed")}: ${esc(e instanceof Error ? e.message : String(e))}</div>`; }
}