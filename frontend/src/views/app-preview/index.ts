// ===== <app-preview> 入口 =====
import { bus } from "../../bus.ts";
import { previewCSS } from "./css.ts";
// 模块级样式表（HMR 热更新回注入用：export 给 hot.accept 拿新实例）
const appPreviewStyle = new CSSStyleSheet();
appPreviewStyle.replaceSync(previewCSS);
export { appPreviewStyle };
import { RESOURCE_TYPES, isYsmWasmPreview, extOf } from "../../utils/resource/types.ts";
import { modelDetailHTML } from "./tpl.ts";
import {
  cacheGet,
  cacheSet,
  cacheSetEvictHandler,
} from "./cache.ts";
import { getApp } from "../../backend/app.ts";
import { resolveWebMode } from "../../backend/platform.ts";
import { t } from "../../core/i18n/t.ts";
import { type PreviewCtx, type DecodedYsm } from "./utils.ts";
import { decodeYsmViaWasm } from "./wasm.ts";
import { showModelDetail, showResourcePack, showShaderpack, showSimplePreview, showVrmMeta, showMmdPreview } from "./detail.ts";
import { showLitematic, cleanupLitematic3D, invalidateLitematicPreview } from "./litematic-meta.ts";
import { cleanupVrm3D, invalidateVrmPreview } from "./vrm-3d.ts";
import { cleanupMmd3D, invalidateMmdPreview } from "./mmd-3d.ts";
import { closeActive3DOverlay } from "./skeleton.ts";
import { esc } from "../../utils/dom/html.ts";
import type { BedrockGeometry } from "./geometry.ts";

/** 预览 show 函数签名：ctx + path + 类型元信息（icon/label） */
type PreviewShowFn = (
  ctx: PreviewCtx,
  path: string,
  meta: { icon: string; label: string },
) => void;

/**
 * 类型 → show 派发映射表（ADR-072 D2：把 index.ts 手写 if 链替换为注册表驱动查表）。
 * 新增格式 = 注册表一条目 + 这里一行，不再改 _showModelDetail 的 if 链。
 * VRC 的 .vrm（3D meta 卡）/ .vrca/.zip（简单预览）分支收进 handler 内部。
 */
const PREVIEW_HANDLERS: Record<string, PreviewShowFn> = {
  [RESOURCE_TYPES.PACK]: (ctx, path) => showResourcePack(ctx, path),
  [RESOURCE_TYPES.YSM]: (ctx, path) => showModelDetail(ctx, path),
  [RESOURCE_TYPES.LITEMATIC]: (ctx, path) => showLitematic(ctx, path),
  [RESOURCE_TYPES.BLUEPRINT]: (ctx, path) => showLitematic(ctx, path),
  [RESOURCE_TYPES.SHADER]: (ctx, path, meta) => showShaderpack(ctx, path, meta),
  [RESOURCE_TYPES.MMD]: (ctx, path, meta) => showMmdPreview(ctx, path, meta),
  [RESOURCE_TYPES.VRC]: (ctx, path, meta) => {
    // .vrm 直引 three-vrm meta 卡 + FAB 进 3D；.vrca/.zip 暂不直接加载 → 简单预览
    if (extOf(path) === ".vrm") {
      showVrmMeta(ctx, path, meta);
    } else {
      showSimplePreview(ctx, path, meta);
    }
  },
};

// 注册缓存淘汰回调：释放 blob URL（Set 去重：重复 URL 只 revoke 一次，revoke 幂等无害）
cacheSetEvictHandler((key, val) => {
  if (!val) return;
  const urls = new Set<string>();
  // geometry.textures 数组中的 blob URL
  const geo = val.geometry as BedrockGeometry | undefined;
  if (geo?.textures) for (const u of geo.textures) urls.add(u);
  if (geo?.texture) urls.add(geo.texture);
  if (val.texture) urls.add(val.texture);
  // 作者头像 blob URL（preview-wasm 为头像 createObjectURL）：
  // authors[].avatarUrl 与 avatars 记录可能指向同一 URL，Set 天然去重
  for (const au of val.authors || []) {
    if (typeof au === "object" && au.avatarUrl) urls.add(au.avatarUrl);
  }
  for (const u of Object.values(val.avatars || {})) urls.add(u);
  for (const u of urls) {
    if (u?.startsWith("blob:")) URL.revokeObjectURL(u);
  }
});

class AppPreview extends HTMLElement implements PreviewCtx {
  root: ShadowRoot;
  unsubs: Array<() => void> = [];
  private _typeCache: Array<{ id: string; name?: string; icon?: string }> = [];
  private _typeReg: Record<string, { id: string; name?: string; icon?: string }> | null = null;
  /** 预览代际计数：快速点 A（慢）→ B（快）时，丢弃过期加载的渲染，防并发覆盖 */
  private _previewGen = 0;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: "open" });
    this.root.adoptedStyleSheets = [appPreviewStyle];
  }

  connectedCallback(): void {
    this._render();

    this._preloadTypeRegistry();
    this.unsubs.push(
      bus.on("model:select", async ({ path, isDir }) => {
        ++this._previewGen; // 代际计数：子方法 await 后校验 gen !== _previewGen 即丢弃过期渲染
        // P2 修复（审核）：切换模型前关闭活跃的 3D 全屏 overlay（挂 body、不随 shadow
        // DOM 重建消失）。后台 model:select（导入队列/回收站自动选择）触发时不清旧层会
        // 双全屏叠加 + 旧 renderer 死屏残留。closeActive3DOverlay 保留 _prefer3D，
        // 新模型 loadModel2D 仍会按设计自动弹 3D（skeleton.ts:64）。
        closeActive3DOverlay();
        // P2 修复（code_review）：任意新选择作废在途 litematic 解析——
        // litematicGen 只在 showLitematic 自身递增，切到 YSM/资源包（走 _detailGen）
        // 不触碰它，litematic A 迟到会写进 B 的 #preview-detail（跨类型污染）
        invalidateLitematicPreview();
        invalidateVrmPreview();
        invalidateMmdPreview();
        try {
          if (isDir) {
            await this._showPackInfo(path);
          } else {
            await this._showModelDetail(path);
          }
        } catch (e) {
          console.error("[preview] 加载失败:", e);
          this.root.innerHTML =
            '<div class="content"><div class="dp-placeholder"><div class="big-icon">⚠️</div><div class="dp-hint">' + t("preview.loadFailed") + '</div></div></div>';
        }
      }),
    );
  }

  disconnectedCallback(): void {
    // 快照遍历：unsub 内部可能 splice 自身（如 close3D 的 P3 修复），
    // 用 slice() 防止 forEach 遍历中移除元素导致跳项
    this.unsubs.slice().forEach((fn) => fn());
    // 清理体素 3D（WebGL renderer + rAF 循环）：防切页后 GPU 资源残留
    cleanupLitematic3D();
    cleanupVrm3D();
    cleanupMmd3D();
  }

  private _render(): void {
    this.root.innerHTML = modelDetailHTML(null);
  }

  /** 自动匹配缩略图：查缓存 → .ysm/.json 走 WASM → Go 兜底 */
  async loadPreviewImage(modelPath: string): Promise<string | null> {
    // 查缓存（模块级，跨组件生命周期持久）
    const cached = cacheGet(modelPath);
    if (cached?.texture) return cached.texture;
    const cachedGeo = cached?.geometry as BedrockGeometry | undefined;
    if (cachedGeo?.texture) return cachedGeo.texture;

    // .ysm 或 .json（解压的 ysm.json）走前端 WASM 解码；.zip/.7z 容器由下方 Go 兜底（ADR-066 解墙）
    if (isYsmWasmPreview(modelPath)) {
      const decoded = await this.decodeYsmViaWasm(modelPath);
      if (decoded?.texture) {
        cacheSet(modelPath, { ...decoded, _decodedBy: "🧠 WASM 内置解码" });
        return decoded.texture;
      }
      if (decoded?.geometry) {
        // 有 geometry 数据（含 _ysmMeta）但无纹理，缓存以备 _loadModel2D 使用
        // （无 _wasmTried 标记：Go 兜底成功会覆盖缓存，标记无消费方——P4 清理）
        cacheSet(modelPath, { ...decoded });
      }
      // WASM 完全失败 → 不缓存空条目，直接走 Go 兜底（兜底结果由下方 cacheSet 落缓存）
    }
    try {
      const { FindPreviewImage, ExtractPreviewTexture } =
        await getApp();
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

  /** 通过前端 WASM 解码 .ysm，返回 { texture, geometry }（缓存复用） */
  async decodeYsmViaWasm(modelPath: string): Promise<DecodedYsm | null> {
    return decodeYsmViaWasm(modelPath);
  }

  /** 在预览区追加调试小字 */
  appendDebug(container: HTMLElement | null, msg: string): void {
    try {
      const el =
        container || this.root.getElementById("preview-content") || this.root;
      const dbg = document.createElement("div");
      dbg.className = "ysm-debug";
      dbg.textContent = msg;
      el.appendChild(dbg);
    } catch (_) {}
  }

  private async _preloadTypeRegistry(): Promise<void> {
    try {
      const { LoadResourceTypes } = await getApp();
      const raw = await LoadResourceTypes();
      const reg = JSON.parse(raw) as { resourceTypes?: Array<{ id: string; name?: string; icon?: string }> };
      this._typeCache = reg.resourceTypes || [];
    } catch (_) {}
  }

  private async _showModelDetail(path: string): Promise<void> {
    const gen = this._previewGen;
    // ADR-071 M1：web 端 .7z 明确"暂不支持"（识别为 ysm 但 WASM/解压均无法处理——
    // 显示文件名即可，不尝试解析报错；替代原"点击预览必失败"）
    if (extOf(path) === ".7z" && resolveWebMode()) {
      bus.emit("toast:show", {
        msg: t("preview.web7zUnsupported"),
        duration: 3000,
        type: "warn",
      });
      showSimplePreview(this, path, this._typeMeta(RESOURCE_TYPES.YSM));
      return;
    }
    // 检测文件类型
    let rtype = "";
    try {
      const { DetectResourceType } = await getApp();
      rtype = (await DetectResourceType(path)) || "";
    } catch (_) {}
    // 过期守卫：await 期间用户已点其他文件，丢弃本次分流
    if (gen !== this._previewGen) return;
    // ADR-072 D2：注册表驱动查表派发——新增格式 = 注册表一条目 + PREVIEW_HANDLERS 一行，
    // 不再改 if 链。ysm 或无检测结果默认走 YSM handler；未命中走 showSimplePreview 兜底。
    const key = rtype || RESOURCE_TYPES.YSM;
    const handler = PREVIEW_HANDLERS[key];
    if (handler) {
      handler(this, path, this._typeMeta(key));
    } else {
      showSimplePreview(this, path, this._typeMeta(key));
    }
  }

  private _typeMeta(rtype: string): { icon: string; label: string } {
    if (!this._typeReg) {
      this._typeReg = {};
      for (const t of this._typeCache || []) this._typeReg[t.id] = t;
    }
    const def = this._typeReg[rtype];
    return { icon: def?.icon || "📦", label: def?.name || rtype };
  }

  /** 显示资源包信息（pack.mcmeta + pack.png）——直连 showResourcePack，无包装层 */
  private async _showPackInfo(dirPath: string): Promise<void> {
    const gen = this._previewGen;
    this.root.innerHTML = `<div class="content" id="preview-content"><h3>📦 ${t("preview.pack")}</h3><div class="dp-placeholder"><div class="big-icon">⏳</div></div></div>`;
    try {
      const { GetPackInfo } = await getApp();
      const pack = await GetPackInfo(dirPath);
      // 过期守卫：await 期间用户已点其他文件，丢弃本次渲染
      if (gen !== this._previewGen) return;
      if (!pack || (!pack.name && !pack.description)) {
        const folderName = dirPath.split(/[/\\]/).filter(Boolean).pop() || dirPath;
        this.root.innerHTML = `<div class="content" id="preview-content"><h3>📁 ${t("preview.folder")}</h3><div class="model-detail-title" style="font-size:13px;font-weight:600">${esc(folderName)}</div><div class="dp-placeholder" style="padding:12px 0"><div class="dp-hint">${t("preview.folderNoInfo")}</div></div></div>`;
        return;
      }
      this.root.innerHTML = `<div class="content" id="preview-content">
<h3>📦 ${t("preview.pack")}</h3>
${pack.imageBase64 ? `<div class="preview-thumb"><img src="${esc(pack.imageBase64)}" alt="封面"></div>` : ""}
<div class="model-detail-title" style="font-size:14px;font-weight:700">${esc(pack.name || "")}</div>
${pack.description ? `<div style="font-size:11px;color:var(--txt);margin-top:6px;line-height:1.6">${esc(pack.description)}</div>` : ""}
</div>`;
    } catch (err) {
      // P2 修复：catch 分支同样比对代际——A 目录 GetPackInfo 失败迟到时
      // 若用户已切到 B，不得把「无法读取整合包信息」覆盖到 B 的预览
      if (gen !== this._previewGen) return;
      this.root.innerHTML = `<div class="content" id="preview-content"><h3>📁 ${t("preview.folder")}</h3><div class="dp-placeholder"><div class="big-icon">📁</div><div class="dp-hint">${t("preview.packReadFailed")}</div></div></div>`;
    }
  }

}
// 注册组件（防 HMR/重复 import 时重复 define）
if (!customElements.get("app-preview")) {
  customElements.define("app-preview", AppPreview);
}
// HMR 热更新：previewCSS 变更时，将新样式表重新挂载到已存在的 shadow root
import.meta.hot?.accept((newModule) => {
  const style = (newModule as any).appPreviewStyle;
  document.querySelectorAll("app-preview").forEach((el: any) => {
    const root = el.shadowRoot;
    if (root) root.adoptedStyleSheets = [style];
  });
});
