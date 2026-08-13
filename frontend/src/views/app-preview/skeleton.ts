// ===== 2D 骨骼渲染层 =====
// 加载统一走 loadModelData，本文件只做 2D 骨骼渲染编排
import { getPrefer3D, setPrefer3D, type PreviewRoot, type YsmDecoder, type PreviewDebugger } from "./utils.ts";
import { loadModelData } from "./loader.ts";
import { renderModel2D } from "../../utils/3d/model2d.ts";
import { openFullPreview } from "./zoom.ts";
import { safeGet, safeSet } from "../../utils/dom/storage.ts";
import type { BedrockGeometry } from "./geometry.ts";
import type { BoneSelectInfo } from "../../utils/3d/model3d.ts";
import { esc } from "../../utils/dom/html.ts";
import { getApp } from "../../backend/app.ts";
import { bus } from "../../bus.ts";
import { friendlyError } from "../../utils/dom/errors.ts";
import { statsCardHTML } from "./tpl.ts";
import { buildBoneNamesText } from "./bone-names.ts";
import { screenshotPreview, renderModel3D } from "../../utils/3d/model3d.ts";
import { ensureFabStyles, createIconButton } from "../../utils/dom/fab.ts";
import { registerAndroidBackHandler } from "../../utils/dom/android-bridge.ts";
import { renderMultiAngle } from "./screenshot-renderer.ts";
import { preloadModel } from "./model3d-loader.ts";
import { t } from "../../core/i18n/t.ts";

// 2D 拖拽的 window 监听器槽位：loadModel2D 每次渲染模型都会绑定，
// 先移除上一轮处理器再绑定，防止 window 级监听器累积泄漏
let _prevWindowMove: ((e: PointerEvent) => void) | null = null;
let _prevWindowUp: ((e: PointerEvent) => void) | null = null;

/**
 * P2 修复（审核）：3D overlay 挂 document.body，不随预览面板 shadow DOM 重建消失。
 * 后台 model:select（导入队列/回收站自动选择）在 3D 打开期间触发时，若只叠新 overlay
 * 不清旧的全屏层，会造成双全屏叠加 + 旧 renderer 死屏残留。此模块级钩子让调用方
 * （app-preview/index.ts 的 model:select handler）在切换模型前先关掉活跃 3D。
 * 注意：关闭时保留 _prefer3D（skeleton.ts:64 注释的设计意图——切模型保持 3D 预览），
 * 仅清理 DOM 与 WebGL 资源。
 */
let _active3DClose: (() => void) | null = null;

/** 关闭当前活跃的 3D 全屏 overlay（若存在）。供 app-preview/index.ts 切换模型前调用。 */
export function closeActive3DOverlay(): void {
  _active3DClose?.();
  _active3DClose = null;
}

/** RenderModel3DHandle 运行时扩展（_keyHandler/_timeTimer/_boneDetailEl 为 JS 时代附加字段） */
type Model3DHandleX = import("../../utils/3d/model3d.ts").RenderModel3DHandle & {
  _keyHandler?: ((e: KeyboardEvent) => void) | null;
  _timeTimer?: ReturnType<typeof setInterval>;
  _boneDetailEl?: HTMLElement | null;
};

/**
 * 加载模型 2D 骨骼线条图 + 统计面板
 * ctx = 组件实例（提供 this.root, this.appendDebug 等）
 */
export async function loadModel2D(
  ctx: PreviewRoot & YsmDecoder & PreviewDebugger,
  modelPath: string,
  skelContainer: HTMLElement | null,
): Promise<void> {
  const content =
    skelContainer || ctx.root.getElementById("preview-content");
  if (!content) return;

  content.innerHTML = "";

  const container = document.createElement("div");
  container.style.cssText = "margin-bottom:8px;opacity:0.6";
  container.innerHTML = `<div class="ysm-loading-title">🏗️ ${t("preview.loadingStructure")}</div><div class="ysm-loading-bar"></div>`;
  content.appendChild(container);

  try {
    // 统一加载：缓存 → WASM → Go 兜底
    const loaded = await loadModelData(modelPath, {
      decodeYsmViaWasm: (p) => ctx.decodeYsmViaWasm(p),
      appendDebug: (_container, msg) => ctx.appendDebug(container, msg),
    });
    const model = loaded.model;
    const _decodedBy = loaded.decodedBy;

    // P1 守卫（审核反推）：loadModelData 是 fire-and-forget（detail.ts:90），await 期间
    // 用户可能已切到其他文件——showModelDetail 每次重建 ctx.root.innerHTML，本容器的
    // container 会被 detached。此时继续执行会把 A 的作者头像写进 B 的详情页（L143）、
    // 把 A 的 _toggle3D 绑到 B 的 3D 按钮（L840）、_prefer3D 时在 B 页自动弹 A 的 3D（L844）。
    // container.isConnected 是最通用的过期信号：detached 即放弃本次渲染。
    if (!container.isConnected) return;

    if (!model?.bones?.length) {
      container.innerHTML = `<div class="ysm-error-title">🏗️ ${t("preview.skeletonStructure")}</div><div class="ysm-error-body">⚠️ ${t("preview.noGeometry")}</div>`;
      return;
    }

    container.style.opacity = "1";
    container.innerHTML = "";

    // ---- 模型轨迹图 ----
    const canvas = document.createElement("canvas");
    canvas.width = 180;
    canvas.height = 180;
    canvas.className = "ysm-canvas";
    container.appendChild(canvas);

    // ---- 加载纹理（骨骼图用）----
    let textureImg: HTMLImageElement | null = null;
    if (model.texture) {
      textureImg = new Image();
      await new Promise((r) => {
        textureImg!.onload = r;
        textureImg!.onerror = r;
        textureImg!.src = model.texture as string;
      });
    }
    // P1 守卫：纹理加载也是 async 窗口，await 期间用户可能已切换模型，
    // 继续执行会把 A 的作者/按钮/3D 自动弹窗写到 B 的 DOM
    if (!container.isConnected) return;

    // ---- 骨骼名开关 + 放大按钮 ----
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

    // 放大按钮
    const zoomBtn = document.createElement("button");
    zoomBtn.className = "ysm-btn";
    zoomBtn.innerHTML = "🔍 " + t("preview.zoom");
    zoomBtn.title = "全窗口查看模型";
    zoomBtn.onclick = (): void => {
      openFullPreview(canvas, model, textureImg, _labelsOn);
    };
    toggleRow.appendChild(zoomBtn);

    container.appendChild(toggleRow);

    // ---- 统计卡片 ----
    const card = document.createElement("div");
    card.className = "ysm-card";
    card.innerHTML = statsCardHTML(model, modelPath, _decodedBy);
    // 作者列表（从 ysm.json 解析）
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
      // 同步填充详情页的作者头像区
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

    // ---- 渲染骨骼图 ----
    let _zoom = 1;
    let _rotation = 0;
    // BedrockGeometry.uv 含 string 形态（对象序列化），model2d 的 BedrockCube.uv 仅 number[]——cast 兼容
    const model2d = model as Parameters<typeof renderModel2D>[1];
    const doRender = (): void => {
      try {
        renderModel2D(canvas, model2d, textureImg, {
          showLabels: _labelsOn,
          zoom: _zoom,
          rotation: _rotation,
        });
      } catch (e) {
        console.warn("[preview] 2D 渲染跳过:", e);
      }
    };
    doRender();

    eyeBtn.onclick = (): void => {
      _labelsOn = !_labelsOn;
      safeSet("ysm_showBoneLabels", String(_labelsOn));
      eyeBtn.innerHTML = _labelsOn ? `👁 ${t("preview.boneLabels")}` : `👁‍🗨 ${t("preview.boneLabels")}`;
      eyeHint.textContent = _labelsOn ? t("preview.on") : t("preview.off");
      doRender();
    };

    // ---- 全窗放大 + 滚轮/拖拽旋转 ----
    canvas.classList.add("ysm-grab");
    canvas.title = "左键全窗放大 · 滚轮缩放 · 左右拖拽旋转";

    // 区分点击和拖拽：拖拽时 pointer 移动过则不触发 click
    let _dragging = false,
      _dragged = false,
      _lastX = 0;
    canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return; // 左键守卫（右键不触发拖拽/旋转）
      _dragging = true;
      _dragged = false;
      _lastX = e.clientX;
      canvas.setPointerCapture(e.pointerId);
    });
    // 幂等绑定：先移除上一轮处理器（每次 loadModel2D 都执行，防 window 监听器累积）
    if (_prevWindowMove) window.removeEventListener("pointermove", _prevWindowMove);
    if (_prevWindowUp) window.removeEventListener("pointerup", _prevWindowUp);
    const onWindowMove = (e: PointerEvent): void => {
      if (!_dragging) return;
      const dx = e.clientX - _lastX;
      if (Math.abs(dx) > 3) _dragged = true; // 移动超过 3px 判定为拖拽
      _lastX = e.clientX;
      _rotation = (_rotation + dx * 0.5) % 360;
      doRender();
    };
    const onWindowUp = (e: PointerEvent): void => {
      _dragging = false;
      if (canvas.hasPointerCapture(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId);
      }
    };
    _prevWindowMove = onWindowMove;
    _prevWindowUp = onWindowUp;
    window.addEventListener("pointermove", onWindowMove);
    window.addEventListener("pointerup", onWindowUp);
    // 组件销毁时移除 window 监听（与槽位"先移除再绑"互补：槽位管不累积，这里管销毁回收）
    ctx.unsubs?.push(() => {
      window.removeEventListener("pointermove", onWindowMove);
      window.removeEventListener("pointerup", onWindowUp);
      if (_prevWindowMove === onWindowMove) _prevWindowMove = null;
      if (_prevWindowUp === onWindowUp) _prevWindowUp = null;
    });
    canvas.addEventListener("click", (e) => {
      if (_dragged) {
        e.stopPropagation();
        return;
      }
      openFullPreview(canvas, model, textureImg, _labelsOn);
    });
    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        // 与 zoom.ts 同口径（比例式缩放，避免固定步长在高倍率下失真），但灵敏度系数
        // 不同：此处 0.002 为 2D 主预览（小画布），zoom.ts 全屏放大用 0.001（更精细）。
        // 两处钳制范围一致 [0.2, 10]；若统一灵敏度需两侧同步改（子代理审查备案）。
        _zoom = Math.max(0.2, Math.min(10, _zoom * Math.exp(-e.deltaY * 0.002)));
        doRender();
      },
      { passive: false },
    );

    // ---- 导出骨骼名按钮 ----
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
      const lines = buildBoneNamesText(modelPath, model.boneCount, model.bones || []);
      const blob = new Blob([lines.join("\n")], { type: "text/plain" });
      const a = document.createElement("a");
      a.download =
        (modelPath.split(/[/\\]/).pop() || "model") + "_bones.txt";
      a.href = URL.createObjectURL(blob);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    };
    boneRow.appendChild(boneBtn);
    boneRow.appendChild(boneHint);
    container.appendChild(boneRow);

    // ---- 3D 预览切换 ----
    let _model3d: Model3DHandleX | null = null;
    let _overlay3d: HTMLDivElement | null = null;
    let _is3D = false;
    let _prefer3D = getPrefer3D();
    let _loading3D = false; // 3D 加载中标记：忽略重复触发（防双击竞态）
    let _model3dGen = 0; // 3D 加载 generation：close3D 时自增，使 in-flight 渲染失效（防渲染器泄漏）

    const _toggle3D = async (): Promise<void> => {
      if (_loading3D) return;
      _is3D = !_is3D;
      _prefer3D = _is3D;
      setPrefer3D(_prefer3D);

      if (_is3D) {
        ensureFabStyles();
        _loading3D = true;
        const gen = ++_model3dGen;
        const overlay = document.createElement("div");
        overlay.id = "ysm-overlay-3d";
        overlay.className = "ysm-ovl-root";
        _overlay3d = overlay;

        const topBar = document.createElement("div");
        topBar.id = "ysm-topbar-3d";
        topBar.className = "ysm-ovl-bar";
        const closeBtn = createIconButton({ icon: "✕", label: t("preview.close3d") });
        closeBtn.id = "ysm-close-3d";
        closeBtn.onclick = (): void => {
          close3D();
        };
        topBar.appendChild(closeBtn);

        let _texIdx = 0;
        if ((model.textures?.length ?? 0) > 1) {
          const texSel = document.createElement("select");
          texSel.className = "ysm-ovl-select";
          model.textures!.forEach((_, i) => {
            const opt = document.createElement("option");
            opt.value = String(i);
            opt.textContent = `${t("preview.texture")} ${i + 1}`;
            texSel.appendChild(opt);
          });
          texSel.onchange = (): void => {
            _texIdx = parseInt(texSel.value, 10);
            close3D();
            _toggle3D();
          };
          topBar.appendChild(texSel);
        }

        const spacer = document.createElement("div");
        spacer.className = "ysm-ovl-spacer";
        topBar.appendChild(spacer);

        const shotWrap = document.createElement("div");
        shotWrap.className = "ysm-ovl-shotwrap";
        const shotBtn = document.createElement("button");
        shotBtn.textContent = "📷 " + t("preview.screenshot") + " ▾";
        shotBtn.className = "ysm-ovl-btn";
        const shotMenu = document.createElement("div");
        shotMenu.className = "ysm-ovl-shotmenu";
        const items = [
          { label: "📷 当前视角", key: "current" },
          { label: "👤 正面", key: "front" },
          { label: "↗ 45°", key: "45" },
          { label: "👉 侧面", key: "side" },
          { label: "↘ 后45°", key: "back45" },
          { label: "📸 全套", key: "all" },
        ];
        // 截图入口带守卫：连点/多菜单触发时忽略并发（防重复保存文件）
        let _saving = false;
        const saveShot = async (key: string): Promise<void> => {
          if (_saving) return;
          _saving = true;
          try {
            await saveShotInner(key);
          } catch (e) {
            shotBtn.textContent = "❌";
            console.error("[3D 截图]", e);
            bus.emit("toast:show", {
              msg: "截图保存失败：" + friendlyError(e),
              duration: 4000,
              type: "error",
            });
          } finally {
            _saving = false;
          }
        };
        const saveShotInner = async (key: string): Promise<void> => {
          const { SaveScreenshotFile } = await getApp();
          const p = (model._modelPath || "screenshot").replace(/\\/g, "/");
          const base = p.split("/").pop()?.replace(/\.\w+$/, "") || "";
          if (key === "current") {
            const b64 = screenshotPreview();
            if (!b64) {
              shotBtn.textContent = "❌";
              return;
            }
            const ts = new Date().toISOString().replace(/[:.]/g, "-");
            // Go SaveScreenshotFile 守卫拒绝含目录路径（filepath.Base==clean），只传 basename；
            // 落盘到系统临时目录 os.TempDir()/ysm-preview/，避免与模型目录冲突
            await SaveScreenshotFile(base + "_" + ts + ".png", b64);
          } else if (key === "all") {
            for (const k of ["front", "45", "side", "back45"]) await saveShotInner(k);
          } else {
            const texUrls =
              model.textures && model.textures.length > 1
                ? model.textures
                : [model.texture || ""];
            const results = await renderMultiAngle(model._modelPath || "", texUrls, {
              size: 512,
            });
            if (!results) return;
            const hit = results.find((r) => r.name === key);
            if (hit)
              await SaveScreenshotFile(
                base + "_" + key + ".png",
                hit.base64,
              );
          }
          shotBtn.textContent = "✅";
          setTimeout(() => {
            shotBtn.textContent = "📷 " + t("preview.screenshot") + " ▾";
          }, 2000);
        };
        items.forEach((item) => {
          const el = document.createElement("div");
          el.textContent = item.label;
          el.className = "ysm-ovl-shotitem";
          el.onclick = (): void => {
            shotMenu.style.display = "none";
            saveShot(item.key);
          };
          shotMenu.appendChild(el);
        });
        shotBtn.addEventListener("pointerenter", () => {
          shotMenu.style.display = "block";
        });
        // ADR-047：hover 菜单补 tap 兜底——触屏无 hover，点击按钮切换展开/收起
        shotBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          shotMenu.style.display = shotMenu.style.display === "block" ? "none" : "block";
        });
        shotWrap.addEventListener("pointerleave", () => {
          shotMenu.style.display = "none";
        });
        shotWrap.appendChild(shotBtn);
        shotWrap.appendChild(shotMenu);
        topBar.appendChild(shotWrap);

        // 重置视角按钮（图标按钮工厂统一创建，见 ADR-057 §2.6）
        const resetBtn = createIconButton({
          icon: "⟲",
          label: t("preview.resetView"),
          title: "重置相机视角到初始位置",
        });
        topBar.appendChild(resetBtn);

        // 模型选择下拉（多 section 时显示）
        const modelSel = document.createElement("select");
        modelSel.className = "ysm-ovl-select";
        modelSel.style.display = "none";
        topBar.appendChild(modelSel);

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

        // 主体：3D 渲染器全屏，信息面板作为右侧浮层覆盖其上（隐藏面板时渲染器天然填满，竖屏友好）
        const body = document.createElement("div");
        body.style.cssText = "flex:1;position:relative;overflow:hidden";
        const viewContainer = document.createElement("div");
        viewContainer.style.cssText = "position:absolute;inset:0;overflow:hidden";
        body.appendChild(viewContainer);

        const panel = document.createElement("div");
        panel.id = "ysm-3d-panel";
        panel.className = "ysm-3d-panel";

        // 面板宽度拖拽柄
        const resizeHandle = document.createElement("div");
        resizeHandle.style.cssText = "position:absolute;top:0;bottom:0;width:4px;cursor:col-resize;z-index:6;touch-action:none;background:rgba(255,255,255,0.2);border-radius:2px";
        // 定位到面板左缘（面板为 right 浮层；right 随拖拽同步）
        resizeHandle.style.right = panel.style.width || "260px";
        let _resizing = false;
        const onResizeMove = (e: PointerEvent): void => {
          if (!_resizing) return;
          const rect = body.getBoundingClientRect();
          panel.style.width = Math.max(160, Math.min(500, rect.right - e.clientX)) + "px";
          resizeHandle.style.right = panel.style.width;
        };
        const onResizeUp = (e: PointerEvent): void => {
          _resizing = false;
          if (resizeHandle.hasPointerCapture(e.pointerId)) {
            resizeHandle.releasePointerCapture(e.pointerId);
          }
        };
        resizeHandle.addEventListener("pointerdown", (e) => {
          if (e.button !== 0) return; // 左键守卫（右键不触发 resize）
          _resizing = true;
          e.preventDefault();
          resizeHandle.setPointerCapture(e.pointerId);
        });
        document.addEventListener("pointermove", onResizeMove);
        document.addEventListener("pointerup", onResizeUp);
        // 拖拽柄挂入 body（此前为孤儿节点，不可见不可拖）
        body.appendChild(resizeHandle);

        // ADR-057 §2.5：安卓返回键注销槽（overlay 打开时注册，close3D 内统一清理）
        let _backUnreg: (() => void) | null = null;
        // 统一关闭 3D：移除 resize/keydown 监听器 + 清理渲染资源（关闭按钮/ESC/切换纹理三条路径共用）
        const close3D = (keepPrefer = false): void => {
          // P3 修复（code_review）：正常关闭时把本次 push 的 close3D 从 unsubs 移除——
          // 否则每次打开 3D/切换纹理都 push 新闭包（捕获整个模型+纹理+DOM），
          // 组件销毁前永久累积（unsubs 挂在 AppPreview 实例上，整个浏览会话存活）。
          // 配合 disconnectedCallback 的快照遍历（slice）保证销毁时全部执行、不跳项。
          const unsubIdx = ctx.unsubs?.indexOf(close3D);
          if (unsubIdx !== undefined && unsubIdx > -1) ctx.unsubs?.splice(unsubIdx, 1);
          // P2 修复（审核）：任何关闭路径都同步清模块级钩子（模块级 3D 单例，关闭即失效）
          _active3DClose = null;
          // ADR-057 §2.5：overlay 关闭即注销返回键处理器，避免残留消费后续 back
          _backUnreg?.();
          _backUnreg = null;
          document.removeEventListener("pointermove", onResizeMove);
          document.removeEventListener("pointerup", onResizeUp);
          if (_model3d) {
            if (_model3d._timeTimer) clearInterval(_model3d._timeTimer);
            if (_model3d._keyHandler)
              document.removeEventListener("keydown", _model3d._keyHandler);
            _model3d.cleanup();
            _model3d = null;
          }
          _model3dGen++; // 使加载中的 renderModel3D 结果失效
          if (_overlay3d?.parentNode) _overlay3d.parentNode.removeChild(_overlay3d);
          _overlay3d = null;
          _is3D = false;
          // P2 修复（审核）：keepPrefer=true（切换模型路径）时保留 _prefer3D，新模型
          // loadModel2D 的 getPrefer3D() 仍返回 true 自动弹 3D（skeleton.ts:64 设计意图）；
          // 用户主动关闭/组件销毁（keepPrefer=false）才清 prefer3D。
          if (!keepPrefer) {
            _prefer3D = false;
            setPrefer3D(false);
          }
        };

        // 组件销毁时自动清理 3D overlay，防止 WebGL 上下文泄漏（默认 keepPrefer=false → 清 prefer3D）
        ctx.unsubs?.push(close3D);
        // P2 修复（审核）：登记模块级活跃 3D 钩子——切换模型时 app-preview/index.ts
        // 调 closeActive3DOverlay() 关闭本 overlay（keepPrefer=true → 保留 _prefer3D，
        // 新模型 loadModel2D 仍自动弹 3D，符合 skeleton.ts:64 设计意图）。
        // 用户主动关闭/ESC/组件销毁（走 close3D）会无条件清掉本引用，避免残留。
        _active3DClose = () => close3D(true);
        // ADR-057 §2.5：3D overlay 打开时消费安卓返回键关层（原生 onBackPressed 转发 emitAndroidBack 时生效；否则透传）
        _backUnreg = registerAndroidBackHandler(() => {
          close3D();
          return true;
        });

        // 辅助函数
        const sec = (text: string, gap = true): HTMLDivElement => {
          const d = document.createElement("div");
          // gap=false 用于面板首个分区（panel 已有 padding-top，避免顶部 10+12=22px 过空）
          d.style.cssText =
            "margin-top:" + (gap ? "12px" : "0") + ";margin-bottom:4px;font-weight:600;color:rgba(255,255,255,0.9);font-size:12px;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:3px";
          d.textContent = text;
          return d;
        };
        const iRow = (l: string, v: string): HTMLDivElement => {
          const d = document.createElement("div");
          d.style.cssText = "display:flex;justify-content:space-between;padding:2px 0";
          d.innerHTML = `<span style="color:rgba(255,255,255,0.5)">${l}</span><span>${v}</span>`;
          return d;
        };

        // 折叠按钮
        // 信息面板显隐按钮（直观文字：◀ 隐藏信息 / ▶ 显示信息）
        const panelToggle = document.createElement("button");
        let _panelVisible = true;
        panelToggle.textContent = t("preview.hidePanel");
        panelToggle.title = t("preview.hidePanel");
        panelToggle.className = "ysm-ovl-btn";
        panelToggle.onclick = (): void => {
          _panelVisible = !_panelVisible;
          panel.style.display = _panelVisible ? "" : "none";
          panelToggle.textContent = _panelVisible ? t("preview.hidePanel") : t("preview.showPanel");
          panelToggle.title = _panelVisible ? t("preview.hidePanel") : t("preview.showPanel");
        };
        // 置于顶部栏最右（相机速度数字之后），信息面板在右侧
        topBar.appendChild(panelToggle);

        const progStyle = document.createElement("style");
        progStyle.textContent = "@keyframes ysm-prog{0%{margin-left:-30%}100%{margin-left:130%}}";
        overlay.appendChild(progStyle);

        body.appendChild(panel);
        overlay.appendChild(body);
        document.body.appendChild(overlay);

        const loadingEl = document.createElement("div");
        loadingEl.style.cssText =
          "position:absolute;inset:0;top:40px;display:flex;flex-direction:column;align-items:center;justify-content:center;color:rgba(255,255,255,0.6);font-size:14px;gap:12px;z-index:10;background:rgba(26,27,46,0.9)";
        loadingEl.innerHTML =
          '<div style="font-size:32px">🧱</div><div>' + t("preview.loadingModel") + '</div><div style="width:200px;height:3px;background:rgba(255,255,255,0.1);border-radius:2px;overflow:hidden"><div style="height:100%;width:30%;background:var(--accent,#7c83ff);border-radius:2px;animation:ysm-prog 1.5s ease-in-out infinite"></div></div>';
        overlay.appendChild(loadingEl);

        // P2 修复（审核）：loadingEl 创建后立即检查 container.isConnected，
        // 防组件在创建 loadingEl 后、进入 async 前瞬间卸载时，loadingEl
        // 挂在已卸载的 DOM 树上（内存泄漏 + 潜在样式闪烁）。
        if (!container.isConnected) {
          loadingEl.remove();
          return;
        }

        try {
          const { texArr, spec } = await preloadModel(
            model as import("./model3d-loader.ts").ModelLike,
          );
          const handle3d = (await renderModel3D(
            viewContainer,
            texArr,
            spec as import("../../utils/3d/model3d.ts").Spec3D,
            _texIdx,
          )) as Model3DHandleX;
          // 加载期间用户已关闭（ESC/关闭按钮）：立即释放渲染器，防 WebGL 上下文泄漏
          if (gen !== _model3dGen) {
            handle3d.cleanup();
            _loading3D = false;
            return;
          }
          _model3d = handle3d;
          // 骨骼菜单容器（声明提前，供 onBoneSelect 闭包引用）
          let boneContainer: HTMLElement | null = null;
          // 重置视角按钮接线
          resetBtn.onclick = (): void => { _model3d?.resetCamera(); };
          // 3D 骨骼点击回调 → 详情框 + 骨骼菜单滚动定位
          _model3d.onBoneSelect = function (info: BoneSelectInfo) {
            const detailEl = _model3d?._boneDetailEl;
            if (detailEl) {
              let txt =
                "🦴 " + info.name + "\n" +
                "路径: " + info.path + "\n" +
                "父骨骼: " + (info.parent || "(无)") + "\n" +
                "子骨骼: " + info.children.length + " 个\n" +
                "Mesh: " + info.meshCount + "\n" +
                "localPos: (" + info.localPos.map(function (v) { return v.toFixed(3); }).join(", ") + ")\n" +
                "世界坐标: (" + info.worldPos.map(function (v) { return v.toFixed(2); }).join(", ") + ")";
              if (info.localRot) {
                txt += "\nlocalRot: (" + info.localRot.map(function (v) { return v.toFixed(4); }).join(", ") + ")";
              }
              if (info.cubeRot) {
                txt += "\ncubeRot: (" + info.cubeRot.map(function (v) { return v.toFixed(4); }).join(", ") + ")";
              }
              if (info.cubePos) {
                txt += "\ncubePos: (" + info.cubePos.map(function (v) { return v.toFixed(3); }).join(", ") + ")";
              }
              detailEl.textContent = txt;
              if (detailEl.parentNode)
                (detailEl.parentNode as HTMLElement).style.display = "block";
            }
            // 骨骼菜单跳转到对应行（boneContainer 声明在本函数闭包内，异步调用时已就绪）
            if (typeof boneContainer !== "undefined" && boneContainer) {
              const labels = boneContainer.querySelectorAll<HTMLLabelElement>("label");
              for (const lbl of labels) {
                const span = lbl.querySelector("span");
                if (span && span.textContent === info.name) {
                  lbl.scrollIntoView({ block: "nearest", behavior: "smooth" });
                  lbl.style.background = "rgba(124,131,255,0.25)";
                  setTimeout(function () { lbl.style.background = ""; }, 1500);
                  break;
                }
              }
            }
          };
          loadingEl.remove();

          // 填充面板
          const mg = spec.models?.[0] as
            | {
                bones?: Array<{ _cubeCount?: number }>;
                textureWidth?: number;
                textureHeight?: number;
                name?: string;
                id?: string;
              }
            | undefined;
          let totalCubes = 0;
          for (const b of mg?.bones || []) totalCubes += b._cubeCount || 0;
          panel.appendChild(sec("📐 模型统计", false));
          panel.appendChild(iRow("骨骼", (mg?.bones?.length || 0) + " 根"));
          panel.appendChild(iRow("立方体", totalCubes + " 个"));
          panel.appendChild(
            iRow("纹理尺寸", (mg?.textureWidth || "?") + "×" + (mg?.textureHeight || "?")),
          );

          // 纹理列表 + 缩略图
          if (texArr.length > 0) {
            panel.appendChild(sec("🎨 纹理 (" + texArr.length + ")"));
            for (let i = 0; i < texArr.length; i++) {
              const t = texArr[i];
              const w =
                t?.userData?.imgWidth || (t?.image as HTMLImageElement | undefined)?.naturalWidth || 0;
              const h =
                t?.userData?.imgHeight || (t?.image as HTMLImageElement | undefined)?.naturalHeight || 0;
              const url = model.textures?.[i] || "";
              // 优先用纹理名数组（Go/WASM 填充，去扩展名文件名）；base64/blob URL
              // 解析不出可读名（R1 修复），兜底"纹理 N"
              const name =
                model.textureNames?.[i] ||
                url.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, "") ||
                "纹理 " + (i + 1);
              const d = document.createElement("div");
              d.style.cssText = "display:flex;align-items:center;gap:8px;padding:3px 0;cursor:pointer";
              const img = document.createElement("canvas");
              img.width = 16;
              img.height = 16;
              img.style.cssText = "width:16px;height:16px;border-radius:2px;flex-shrink:0;border:1px solid rgba(255,255,255,0.1)";
              const ctx = img.getContext("2d");
              if (t?.image) ctx!.drawImage(t.image as HTMLImageElement, 0, 0, 16, 16);
              d.appendChild(img);
              d.innerHTML +=
                '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">' +
                esc(name) +
                '</span><span style="color:rgba(255,255,255,0.4);font-size:10px;flex-shrink:0">' +
                w +
                "×" +
                h +
                "</span>";
              panel.appendChild(d);
            }
          }

          // 模型选择器（YSMViewer 式组件切换；-1 = 全部组件 = 默认态）
          const mgCount = _model3d.getModelGroupCount();
          if (mgCount > 1) {
            modelSel.style.display = "";
            const allOpt = document.createElement("option");
            allOpt.value = "-1";
            allOpt.textContent = t("preview.allComponents");
            allOpt.selected = true;
            modelSel.appendChild(allOpt);
            for (let i = 0; i < mgCount; i++) {
              const mg = (spec.models || [])[i] as { name?: string; id?: string; bones?: unknown[] };
              const opt = document.createElement("option");
              opt.value = String(i);
              opt.textContent = (mg.name || mg.id || "model") + " (" + (mg.bones?.length || 0) + ")";
              modelSel.appendChild(opt);
            }
            modelSel.onchange = (): void => {
              _model3d?.showModelGroup(parseInt(modelSel.value, 10));
            };
          }

          // 骨骼：搜索 + 全显/全隐 + 缩进列表
          const boneList = _model3d.getBoneList();
          if (boneList.length > 0) {
            const secHdr = document.createElement("div");
            secHdr.style.cssText =
              "display:flex;align-items:center;justify-content:space-between;margin-top:12px;margin-bottom:4px";
            secHdr.innerHTML =
              '<span style="font-weight:600;color:rgba(255,255,255,0.9);font-size:12px">🦴 ' +
              t("preview.bones", { n: boneList.length }) +
              "</span>";
            const btnGroup = document.createElement("div");
            btnGroup.style.cssText = "display:flex;gap:4px";
            (
              [
                ["👁", true],
                ["⊘", false],
              ] as Array<[string, boolean]>
            ).forEach(([t, v]) => {
              const btn = document.createElement("button");
              btn.textContent = t;
              btn.style.cssText =
                "font-size:10px;padding:1px 4px;border-radius:3px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.3);color:rgba(255,255,255,0.6);cursor:pointer;line-height:1";
              btn.onclick = (): void => {
                boneList.forEach((b) => {
                  _model3d?.setBoneVisible(b.id, v);
                });
                document
                  .querySelectorAll("#ysm-3d-panel input[type=checkbox]")
                  .forEach((c) => ((c as HTMLInputElement).checked = v));
              };
              btnGroup.appendChild(btn);
            });
            secHdr.appendChild(btnGroup);
            panel.appendChild(secHdr);

            // 搜索框
            const searchInput = document.createElement("input");
            searchInput.type = "text";
            searchInput.placeholder = "🔍 过滤骨骼…";
            searchInput.style.cssText =
              "width:100%;padding:3px 6px;border-radius:4px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.3);color:rgba(255,255,255,0.8);font-size:11px;font-family:inherit;box-sizing:border-box;margin-bottom:4px;outline:none";

            // 构建层级深度映射
            const depthMap: Record<string, number> = {};
            const calcDepth = (name: string): number => {
              if (depthMap[name] !== undefined) return depthMap[name];
              const b = boneList.find((x) => x.id === name);
              if (!b || !b.parentId) {
                depthMap[name] = 0;
                return 0;
              }
              depthMap[name] = calcDepth(b.parentId) + 1;
              return depthMap[name];
            };
            boneList.forEach((b) => calcDepth(b.id));

            boneContainer = document.createElement("div");
            boneContainer.style.cssText = "max-height:300px;overflow-y:auto";

            const renderBones = (filter: string): void => {
              boneContainer!.innerHTML = "";
              for (const b of boneList) {
                if (filter && !b.name.toLowerCase().includes(filter.toLowerCase())) continue;
                const depth = depthMap[b.id] || 0;
                const label = document.createElement("label");
                label.style.cssText =
                  "display:flex;align-items:center;gap:6px;padding:2px 0;cursor:pointer;font-size:11px";
                const cb = document.createElement("input");
                cb.type = "checkbox";
                cb.checked = true;
                cb.style.cssText = "accent-color:var(--accent,#7c83ff);width:12px;height:12px;flex-shrink:0";
                cb.dataset.boneId = b.id;
                cb.onchange = (): void => {
                  _model3d?.setBoneVisible(b.id, cb.checked);
                };
                label.appendChild(cb);
                const span = document.createElement("span");
                span.textContent = b.name;
                span.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
                span.style.marginLeft = depth * 12 + "px";
                label.appendChild(span);
                boneContainer!.appendChild(label);
              }
            };
            searchInput.oninput = (): void => renderBones(searchInput.value);
            panel.appendChild(searchInput);
            panel.appendChild(boneContainer);
            renderBones("");
          }

          // 骨骼详情框（3D 视图点击更新）
          const boneDetail = document.createElement("div");
          boneDetail.style.cssText =
            "margin-top:6px;border-radius:3px;font-size:10px;color:rgba(255,255,255,0.7);line-height:1.5;display:none;font-family:inherit";
          const boneDetailText = document.createElement("div");
          boneDetailText.style.cssText =
            "padding:4px 6px;background:rgba(255,255,255,0.05);border-radius:3px 3px 0 0;white-space:pre;max-height:100px;overflow-y:auto";
          const boneDetailCopy = document.createElement("button");
          boneDetailCopy.textContent = "📋 " + t("common.copy");
          boneDetailCopy.style.cssText =
            "font-size:10px;padding:1px 6px;border:none;background:rgba(124,131,255,0.3);color:#fff;cursor:pointer;border-radius:0 0 3px 3px;width:100%;font-family:inherit";
          boneDetailCopy.onclick = function (): void {
            const txt = boneDetailText.textContent || "";
            navigator.clipboard
              .writeText(txt)
              .then(function () {
                boneDetailCopy.textContent = "✅ " + t("preview.copied");
                setTimeout(function () {
                  boneDetailCopy.textContent = "📋 " + t("common.copy");
                }, 1500);
              })
              .catch(function () {
                // 剪贴板写入失败（权限/焦点）→ 恢复按钮，不假成功
                boneDetailCopy.textContent = "📋 " + t("common.copy");
              });
          };
          boneDetail.appendChild(boneDetailText);
          boneDetail.appendChild(boneDetailCopy);
          panel.appendChild(boneDetail);
          _model3d._boneDetailEl = boneDetailText;

          const tip = document.createElement("div");
          tip.style.cssText =
            "padding:6px 12px;background:rgba(124,131,255,0.2);color:#fff;font-size:12px;text-align:center;flex-shrink:0;font-weight:500";
          // ADR-057 §2.4：触屏隐藏键盘提示，改为手势说明（与 ADR-036 键位可配置同源）
          const _isTouch = window.matchMedia?.("(pointer:coarse)").matches ?? false;
          tip.textContent = _isTouch
            ? "👆 拖拽旋转 · 双指缩放 · ✕ 关闭"
            : "🎮 WASD 移动 | 空格/Shift 上下 | 🖱 拖拽旋转 | 🔍 滚轮缩放 | ESC 关闭";
          overlay.insertBefore(tip, overlay.children[1]);
          setTimeout(() => {
            if (tip.parentNode) tip.remove();
          }, 6000);

          rotSel.onchange = (): void => {
            _model3d?.setRotationMode(rotSel.value === "true");
            safeSet("td-rot-mode", rotSel.value === "true" ? "orbit" : "free");
          };
          spdSlider.oninput = (): void => {
            spdVal.textContent = spdSlider.value;
            _model3d?.setSpeed(Number(spdSlider.value));
            localStorage.setItem("td-cam-speed", spdSlider.value);
          };

          const onKey = (e: KeyboardEvent): void => {
            if (e.key !== "Escape") return;
            close3D();
          };
          document.addEventListener("keydown", onKey);
          if (_model3d) _model3d._keyHandler = onKey;
        } catch (e) {
          console.error("[3D] 加载失败:", e);
          // P2 修复：失败时移除 loadingEl（z-index 10 近不透明），否则会盖住错误占位
          loadingEl.remove();
          viewContainer.innerHTML = `<div style="padding:40px;color:#ff6b6b;font-size:14px">⚠️ ${t("preview.preview3dLoadFailed")}: ${esc(
            e instanceof Error ? e.message : String(e),
          )}</div>`;
          bus.emit("toast:show", { msg: "❌ " + friendlyError(e, t("preview.preview3dLoadFailed")), duration: 5000, type: "error" });
        }
        _loading3D = false;
      }
    };

    // 接线 🎨 3D tab 按钮
    const btn3d = ctx.root.getElementById("btn-3d-preview");
    if (btn3d) btn3d.onclick = (): void => {
      _toggle3D();
    };
    if (_prefer3D) requestAnimationFrame(() => btn3d?.click());
  } catch (e) {
    container.innerHTML = `<div class="ysm-error-title" style="color:#ff6b6b">🏗️ ${t("preview.skeletonStructure")}</div><div class="ysm-error-body">⚠️ ${t("preview.parseFailed")}: ${esc(
      e instanceof Error ? e.message : String(e),
    )}</div>`;
  }
}
