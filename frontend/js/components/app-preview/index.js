// ===== <app-preview> 鍏ュ彛 =====
import { bus } from "../../bus.js";
import { previewCSS } from "./preview-css.js";
import { statsHTML, modelDetailHTML, statsCardHTML } from "./tpl.js";
import { bindBusUpdates } from "./events.js";
import { bindActions } from "./preview-actions.js";
import { showPackageDetail, registerMmdEvents } from "./preview-pack.js";
import { loadLogsPreview } from "./preview-logs.js";
import { openFullPreview } from "./preview-zoom.js";
import { summaryCardHTML } from "../../utils/summarize.js";
import {
  cacheGet,
  cacheSet,
  cacheSetEvictHandler,
} from "../../utils/preview-cache.js";
import { devLog, getPrefer3D, stripYsgpTextHeader } from "./preview-utils.js";
import { decodeYsmViaWasm } from "./preview-wasm.js";
import { create3DPreview } from "./preview-3d.js";
import { showModelDetail, showResourcePack } from "./preview-detail.js";
import { loadModelData } from "./preview-loader.js";
import { setupBoneExport } from "./preview-bone-export.js";
import {
  isDirectoryPath,
  resolvePreviewSelection,
} from "./preview-selection.js";
import { applyModelVariant } from "./utils.js";
import { getFolderIcon } from "../../core/folder-icons.js";

// 娉ㄥ唽缂撳瓨娣樻卑鍥炶皟锛氶噴鏀?blob URL
cacheSetEvictHandler((key, val) => {
  if (!val) return;
  // geometry.textures 鏁扮粍涓殑 blob URL
  const urls = [];
  if (val.geometry?.textures) urls.push(...val.geometry.textures);
  if (val.geometry?.texture && !urls.includes(val.geometry.texture))
    urls.push(val.geometry.texture);
  if (val.texture && !urls.includes(val.texture)) urls.push(val.texture);
  for (const u of urls) {
    if (u?.startsWith("blob:")) URL.revokeObjectURL(u);
  }
});

class AppPreview extends HTMLElement {
  constructor() {
    super();
    this._root = this.attachShadow({ mode: "open" });
    this._root.adoptedStyleSheets = [new CSSStyleSheet()];
    this._root.adoptedStyleSheets[0].replaceSync(previewCSS);
    this._unsubs = [];
    this._selectedPkg = null;
    this._mode = "stat";
    this._selectSeq = 0;
  }

  static get observedAttributes() {
    return ["mode"];
  }

  attributeChangedCallback(name, _, newVal) {
    if (name === "mode") {
      this._mode = newVal === "model" ? "model" : "stat";
      if (this._root.isConnected) this._render();
    }
  }

  connectedCallback() {
    this._mode = this.getAttribute("mode") === "model" ? "model" : "stat";
    this._render();

    if (this._mode === "stat") {
      bindBusUpdates(this._root, this._unsubs);

      // Register MMD variant events once for the preview panel.
      registerMmdEvents(this._root);

      this._loadLogsPreview();

      this._unsubs.push(
        bus.on("package:selected", (pkg) => {
          this._selectedPkg = pkg;
          showPackageDetail(this._root, pkg);
        }),
      );

      this._unsubs.push(bus.on("logs:refresh", () => this._loadLogsPreview()));

      this._unsubs.push(bus.on("stats:refresh", () => this._loadLogsPreview()));
    }

    if (this._mode === "model") {
      this._unsubs.push(
        bus.on("model:select", async (selection) => {
          const seq = ++this._selectSeq;
          const target = await resolvePreviewSelection(selection);
          if (seq !== this._selectSeq || !target.path) return;
          if (target.kind === "directory") {
            this._showPackInfo(target.path);
          } else {
            this._showModelDetail(target.path);
          }
        }),
      );
    }
  }

  disconnectedCallback() {
    this._cleanupModelListeners();
    this._unsubs.forEach((fn) => fn());
  }

  /** 娓呯悊妯″瀷鎷栨嫿 window 绾х洃鍚?*/
  _cleanupModelListeners() {
    if (this._modelCleanup) {
      this._modelCleanup();
      this._modelCleanup = null;
    }
  }

  _render() {
    if (this._mode === "stat") {
      this._root.innerHTML = statsHTML();
      bindActions(this._root);
    } else {
      this._root.innerHTML = modelDetailHTML(null);
    }
  }

  /** 鑷姩鍖归厤缂╃暐鍥撅細鏌ョ紦瀛?鈫?.ysm/.json 璧?WASM 鈫?Go 鍏滃簳 */
  async _loadPreviewImage(modelPath) {
    // 鏌ョ紦瀛橈紙妯″潡绾э紝璺ㄧ粍浠剁敓鍛藉懆鏈熸寔涔咃級
    const cached = cacheGet(modelPath);
    if (cached?.texture) return cached.texture;
    if (cached?.geometry?.texture) return cached.geometry.texture;

    // .ysm 鎴?.json锛堣В鍘嬬殑 ysm.json锛夐兘璧?WASM 瑙ｇ爜
    if (/\.(ysm|json)$/i.test(modelPath)) {
      const decoded = await this._decodeYsmViaWasm(modelPath);
      if (decoded?.texture) {
        cacheSet(modelPath, { ...decoded, _decodedBy: "WASM 内置解码" });
        return decoded.texture;
      }
      if (decoded?.geometry) {
        // Cache geometry-only results for the 2D/3D preview path.
        cacheSet(modelPath, { ...decoded, _wasmTried: true });
      } else {
        // Mark that the WASM path has already been tried.
        cacheSet(modelPath, { _wasmTried: true });
      }
    }
    try {
      const { FindPreviewImage, ExtractPreviewTexture } =
        await import("../../../wailsjs/go/main/App.js");
      const loose = await FindPreviewImage(modelPath);
      if (loose) {
        cacheSet(modelPath, { texture: loose, _decodedBy: "" });
        return loose;
      }
      const tex = await ExtractPreviewTexture(modelPath);
      if (tex) cacheSet(modelPath, { texture: tex, _decodedBy: "" });
      return tex || null;
    } catch (_) {
      return null;
    }
  }

  /** Load the 2D bone outline and stats panel. */
  async _loadModel2D(modelPath, skelContainer) {
    const content =
      skelContainer || this._root.getElementById("preview-content");
    if (!content) return;

    content.innerHTML = "";

    const container = document.createElement("div");
    container.style.cssText = "margin-bottom:8px;opacity:0.6";
    container.innerHTML = `<div class="ysm-loading-title">模型结构读取中...</div><div class="ysm-loading-bar"></div>`;
    content.appendChild(container);

    try {
      // Load model data from cache, WASM, or Go fallback.
      let { model, decodedBy: _decodedBy } = await loadModelData(modelPath, {
        decodeYsmViaWasm: (p) => this._decodeYsmViaWasm(p),
        appendDebug: (msg) => this._appendDebug(container, msg),
      });

      if (!model?.bones?.length) {
        container.innerHTML = `<div class="ysm-error-title">模型结构</div><div class="ysm-error-body">未找到几何数据</div>`;
        return;
      }

      // Keep the source path for 3D rendering.
      model = applyModelVariant(model, model.activeVariant || 0);
      model._modelPath = modelPath;

      container.style.opacity = "1";
      container.innerHTML = "";

      // Model outline.
      const canvas = document.createElement("canvas");
      canvas.width = 180;
      canvas.height = 180;
      canvas.className = "ysm-canvas";
      container.appendChild(canvas);

      // Load texture for the 2D skeleton view.
      let textureImg = null;
      if (model.texture) {
        textureImg = new Image();
        await new Promise((r) => {
          textureImg.onload = r;
          textureImg.onerror = r;
          textureImg.src = model.texture;
        });
      }

      // Bone labels and zoom controls.
      const toggleRow = document.createElement("div");
      toggleRow.className = "ysm-toggle-row";
      const eyeBtn = document.createElement("button");
      eyeBtn.className = "ysm-btn";
      const savedState = localStorage.getItem("ysm_showBoneLabels") !== "false";
      let _labelsOn = savedState;
      eyeBtn.textContent = _labelsOn ? "骨骼名" : "隐藏骨骼名";
      eyeBtn.title = "切换骨骼名称显示";
      const eyeHint = document.createElement("span");
      eyeHint.className = "ysm-hint";
      eyeHint.textContent = _labelsOn ? "开启" : "关闭";
      toggleRow.appendChild(eyeBtn);
      toggleRow.appendChild(eyeHint);

      // 鏀惧ぇ鎸夐挳
      const zoomBtn = document.createElement("button");
      zoomBtn.className = "ysm-btn";
      zoomBtn.textContent = "放大";
      zoomBtn.title = "打开完整预览";
      zoomBtn.onclick = () => openFullPreview(canvas, model, textureImg, _labelsOn);
      toggleRow.appendChild(zoomBtn);

      container.appendChild(toggleRow);

      // ---- 缁熻鍗＄墖 ----
      const card = document.createElement("div");
      card.className = "ysm-card";
      card.innerHTML = statsCardHTML(model, modelPath, _decodedBy);
      container.appendChild(card);

      let _3dCtrl = null;
      const btn3d = this._root.getElementById("btn-3d-preview");
      const bind3D = () => {
        if (_3dCtrl) _3dCtrl.cleanup();
        _3dCtrl = create3DPreview(model);
        if (btn3d) btn3d.onclick = _3dCtrl.toggle3D;
      };

      if (model.variants?.length > 1) {
        const variantRow = document.createElement("div");
        variantRow.className = "ysm-toggle-row";
        const variantLabel = document.createElement("span");
        variantLabel.className = "ysm-hint";
        variantLabel.textContent = "形态";
        variantRow.appendChild(variantLabel);

        const variantSel = document.createElement("select");
        variantSel.className = "ysm-btn";
        variantSel.style.cssText = "min-width:150px;height:30px;font-size:11px";
        model.variants.forEach((variant, i) => {
          const opt = document.createElement("option");
          opt.value = String(i);
          opt.textContent =
            variant.name || variant.identifier || variant.source || `Model ${i + 1}`;
          opt.title = variant.source || variant.identifier || opt.textContent;
          if (i === (model.activeVariant || 0)) opt.selected = true;
          variantSel.appendChild(opt);
        });
        variantRow.appendChild(variantSel);
        container.appendChild(variantRow);

        variantSel.onchange = async () => {
          model = applyModelVariant(model, Number.parseInt(variantSel.value, 10) || 0);
          model._modelPath = modelPath;
          if (model.texture) {
            textureImg = new Image();
            await new Promise((r) => {
              textureImg.onload = r;
              textureImg.onerror = r;
              textureImg.src = model.texture;
            });
          }
          card.innerHTML = statsCardHTML(model, modelPath, _decodedBy);
          bind3D();
          doRender();
        };
      }

      // Render the 2D skeleton view.
      const { renderModel2D } = await import("../../utils/model2d.js");
      let _zoom = 1;
      let _rotation = 0;
      const doRender = () => {
        try {
          renderModel2D(canvas, model, textureImg, {
            showLabels: _labelsOn,
            zoom: _zoom,
            rotation: _rotation,
            boneTransforms: null,
          });
        } catch (e) {
        console.warn("[preview] 2D 渲染跳过:", e);
        }
      };
      doRender();

      eyeBtn.onclick = () => {
        _labelsOn = !_labelsOn;
        localStorage.setItem("ysm_showBoneLabels", _labelsOn);
        eyeBtn.textContent = _labelsOn ? "骨骼名" : "隐藏骨骼名";
        eyeHint.textContent = _labelsOn ? "开启" : "关闭";
        doRender();
      };

      // 3D preview toggle.
      bind3D();

      if (getPrefer3D()) requestAnimationFrame(() => btn3d?.click());

      // Fullscreen 2D preview and canvas gestures.
      canvas.classList.add("ysm-grab");
      canvas.title = "左键放大，滚轮缩放，拖拽旋转";
      canvas.addEventListener("click", () =>
        openFullPreview(canvas, model, textureImg, _labelsOn),
      );
      canvas.addEventListener(
        "wheel",
        (e) => {
          e.preventDefault();
          _zoom = Math.max(
            0.2,
            Math.min(10, _zoom + (e.deltaY > 0 ? -0.2 : 0.2)),
          );
          doRender();
        },
        { passive: false },
      );

      // 娓呯悊涓婁竴娆＄殑鎷栨嫿鐩戝惉锛堥伩鍏嶉噸澶嶆敞鍐岋級
      this._cleanupModelListeners();

      let _dragging = false,
        _lastX = 0;
      const _onMouseDown = (e) => {
        _dragging = true;
        _lastX = e.clientX;
      };
      const _onMouseMove = (e) => {
        if (!_dragging) return;
        _rotation = (_rotation + (e.clientX - _lastX) * 0.5) % 360;
        _lastX = e.clientX;
        doRender();
      };
      const _onMouseUp = () => {
        _dragging = false;
      };
      canvas.addEventListener("mousedown", _onMouseDown);
      window.addEventListener("mousemove", _onMouseMove);
      window.addEventListener("mouseup", _onMouseUp);
      this._modelCleanup = () => {
        canvas.removeEventListener("mousedown", _onMouseDown);
        window.removeEventListener("mousemove", _onMouseMove);
        window.removeEventListener("mouseup", _onMouseUp);
        _3dCtrl?.cleanup();
      };

      // Export bone names.
      setupBoneExport(container, model, modelPath);
    } catch (e) {
      container.innerHTML = `<div class="ysm-error-title" style="color:#ff6b6b">模型结构</div><div class="ysm-error-body">解析失败：${e?.message ?? e}</div>`;
    }
  }

  /** 閫氳繃鍓嶇 WASM 瑙ｇ爜 .ysm锛岃繑鍥?{ texture, geometry }锛堢紦瀛樺鐢級 */
  async _decodeYsmViaWasm(modelPath) {
    return decodeYsmViaWasm(modelPath);
  }

  /** 鍦ㄩ瑙堝尯杩藉姞璋冭瘯灏忓瓧 */
  _appendDebug(container, msg) {
    try {
      const el =
        container || this._root.getElementById("preview-content") || this._root;
      const dbg = document.createElement("div");
      dbg.className = "ysm-debug";
      dbg.textContent = msg;
      (el.appendChild ? el : this._root).appendChild(dbg);
    } catch (_) {}
  }

  async _showModelDetail(path) {
    if (await isDirectoryPath(path)) {
      this._showPackInfo(path);
      return;
    }

    // 妫€娴嬫枃浠剁被鍨嬶紝闈?YSM 璧伴€氱敤棰勮
    try {
      const { DetectResourceType } =
        await import("../../../wailsjs/go/main/App.js");
      const rtype = await DetectResourceType(path);
      if (rtype === "resourcepack") {
        showResourcePack(this, path);
        return;
      }
    } catch (_) {}
    showModelDetail(this, path);
  }

  /** Show lightweight resource-pack information. */
  async _showResourcePack(path) {
    showResourcePack(this, path);
  }
  async _showPackInfo(dirPath) {
    const esc = (s) =>
      (s || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    const folderIcon = getFolderIcon(dirPath);
    this._root.innerHTML = `<div class="content" id="preview-content"><h3>整合包</h3><div class="dp-placeholder"><div class="big-icon">...</div></div></div>`;
    try {
      const { GetPackInfo } = await import("../../../wailsjs/go/main/App.js");
      const pack = await GetPackInfo(dirPath);
      if (!pack || (!pack.name && !pack.description)) {
        const folderName =
          dirPath.split(/[/\\]/).filter(Boolean).pop() || dirPath;
        this._root.innerHTML = `<div class="content" id="preview-content"><h3>文件夹</h3>${folderIcon ? `<div class="preview-thumb"><img src="${folderIcon}" alt="封面"></div>` : ""}<div class="model-detail-title" style="font-size:13px;font-weight:600">${esc(folderName)}</div><div class="dp-placeholder" style="padding:12px 0"><div class="dp-hint">该文件夹暂无整合包信息</div></div></div>`;
        return;
      }
      const cover = pack.imageBase64 || folderIcon;
      this._root.innerHTML = `<div class="content" id="preview-content">
<h3>整合包</h3>
${cover ? `<div class="preview-thumb"><img src="${cover}" alt="封面"></div>` : ""}
<div class="model-detail-title" style="font-size:14px;font-weight:700">${esc(pack.name)}</div>
${pack.description ? `<div style="font-size:11px;color:var(--txt);margin-top:6px;line-height:1.6">${esc(pack.description)}</div>` : ""}
</div>`;
    } catch (err) {
      this._root.innerHTML = `<div class="content" id="preview-content"><h3>文件夹</h3><div class="dp-placeholder"><div class="big-icon">DIR</div><div class="dp-hint">无法读取整合包信息</div></div></div>`;
    }
  }

  async _loadLogsPreview() {
    try {
      const { GetImportLogs } = await import("../../../wailsjs/go/main/App.js");
      const logs = await GetImportLogs();
      loadLogsPreview(this._root, logs);
    } catch (_) {}
  }
}
customElements.define("app-preview", AppPreview);

// ===== Legacy JSON geometry helpers, moved to data.js =====
