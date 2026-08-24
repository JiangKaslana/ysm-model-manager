// ===== preview HTML 模板 =====
import { esc } from "../../utils/dom/html.ts";
import { t } from "../../core/i18n/t.ts";

/** 模型统计元数据（modelDetailHTML 入参） */
export interface ModelDetailMeta {
  name?: string;
  author?: string;
  version?: string;
  bones?: number;
  textures?: number;
  animations?: number;
  vertices?: number;
  faces?: number;
  hasError?: boolean;
  errorMsg?: string;
}

/** 模型详情面板（仓库页面） */
export function modelDetailHTML(meta: ModelDetailMeta | null): string {
  if (!meta) {
    return `<div class="content" id="preview-content">
<h3>📄 ${t("preview.modelInfo")}</h3>
<div class="dp-placeholder">
  <div class="big-icon"></div>
  <div class="dp-hint">${t("preview.clickFileHint")}</div>
  <div class="dp-hints">
    <span>💎 ${t("preview.ysmModel")}</span>
    <span> ${t("preview.mmdSkin")}</span>
    <span>🥽 ${t("preview.vrcAvatar")}</span>
    <span>🎨 ${t("preview.resourcePack")}</span>
  </div>
</div>
</div>`;
  }
  if (meta.hasError) {
    const errMsg = meta.errorMsg || t("preview.unknownError");
    return `<div class="content" id="preview-content">
<h3>📄 ${t("preview.modelInfo")}</h3>
<div class="err">⚠️ ${errMsg}</div>
</div>`;
  }
  return `<div class="content" id="preview-content">
<h3>📄 ${t("preview.modelInfo")}</h3>
<div class="md-row"><span class="md-label">${t("preview.nameLabel")}</span><span class="md-value">${esc(meta.name || "-")}</span></div>
<div class="md-row"><span class="md-label">${t("preview.authorLabel")}</span><span class="md-value">${esc(meta.author || "-")}</span></div>
<div class="md-row"><span class="md-label">${t("preview.versionLabel")}</span><span class="md-value">${esc(meta.version || "-")}</span></div>
<div class="md-divider"></div>
<div class="md-row"><span class="md-label">🦴 ${t("preview.bonesLabel")}</span><span class="md-value">${meta.bones || 0}</span></div>
<div class="md-row"><span class="md-label">🖼️ ${t("preview.texturesLabel")}</span><span class="md-value">${meta.textures || 0}</span></div>
<div class="md-row"><span class="md-label">🎬 ${t("preview.animationsLabel")}</span><span class="md-value">${meta.animations || 0}</span></div>
<div class="md-row"><span class="md-label">🔺 ${t("preview.verticesLabel")}</span><span class="md-value">${(meta.vertices || 0).toLocaleString()}</span></div>
<div class="md-row"><span class="md-label">◻️ ${t("preview.facesLabel")}</span><span class="md-value">${(meta.faces || 0).toLocaleString()}</span></div>
</div>`;
}

/** 模型统计卡片（statsCardHTML 入参的几何视图） */
export interface StatsCardModel {
  boneCount: number;
  cubeCount: number;
  texWidth?: number;
  texHeight?: number;
  textures?: unknown[];
}

/** 模型统计卡片 */
export function statsCardHTML(
  model: StatsCardModel,
  modelPath: string,
  decodedBy: string,
): string {
  const isYsm = /\.ysm$/i.test(modelPath);
  const isJson = /\.json$/i.test(modelPath);
  const fmt = isYsm
    ? ".ysm"
    : isJson
      ? ".json (解压目录)"
      : modelPath.endsWith(".zip")
        ? ".zip"
        : "其他";
  const badge = decodedBy ? `<span class="ysm-badge">${decodedBy}</span>` : "";
  // 多纹理概要（仅当存在额外纹理时）
  let texMapHtml = "";
  const texCount = model.textures?.length || 0;
  const extraCount = texCount > 0 ? texCount - 1 : 0;
  if (extraCount > 0) {
    texMapHtml = `<div class="pv-card-row" style="font-size:9px;color:var(--muted);padding:1px 0">📎 ${t("preview.extraTextures", { extra: extraCount, total: texCount })}</div>`;
  }
  return `
<div class="pv-card-title">📊 ${t("preview.modelOverview")}${badge}</div>
<div class="pv-card-section pv-section-blue">
  <div class="pv-card-section-label">🔗 ${t("preview.modelStructure")}</div>
  <div class="pv-card-row">
    <span class="pv-stat-label">${t("preview.skeletonLabel")}</span><span class="pv-card-val">${model.boneCount}</span> ${t("preview.unit")}<br>
    <span class="pv-stat-label">${t("preview.cubesLabel")}</span><span class="pv-card-val">${model.cubeCount}</span> ${t("preview.unit")}
  </div>
</div>
<div class="pv-card-section pv-section-green">
  <div class="pv-card-section-label">🖼️ ${t("preview.textureSize")}</div>
  <div class="pv-card-row">
     <span class="pv-card-val">${model.texWidth || "?"} × ${model.texHeight || "?"}</span> ${t("preview.px")}
  </div>
  ${texMapHtml}
</div>
<div class="pv-card-section pv-section-orange">
  <div class="pv-card-section-label">💾 ${t("preview.fileInfo")}</div>
  <div class="pv-card-row">${fmt}</div>
</div>`;
}
