// ===== 3D 入口详情（ADR-072 D3：detail.ts 按资源域拆分）=====
// showVrmMeta / showMmdPreview 是「3D 入口卡」（meta 信息 + FAB 进 3D），与 2D 详情
// （showModelDetail/showResourcePack/showShaderpack）分离；共享代际 _detailGen 从
// detail.ts 导出复用，保证跨文件快速切换时在途请求互相作废。

import { getApp } from "../../backend/app.ts";
import { renderFormattedText } from "../../utils/format/mc-format.ts";
import { esc } from "../../utils/dom/html.ts";
import { readVrmMeta } from "../../utils/3d/adapters/vrm-adapter.ts";
import { createVrm3D } from "../../utils/3d/adapters/vrm-3d.ts";
import { createMmd3D, resolveMmdSiblings } from "../../utils/3d/adapters/mmd-3d.ts";
import { nextDetailGen, getDetailGen } from "./detail.ts";
import { t } from "../../core/i18n/t.ts";
import type { PreviewCtx } from "./utils.ts";

/** 显示 VRM meta 卡（名称/作者/许可/版本/缩略图 + FAB 进 3D，对齐 YSM 模式） */
export async function showVrmMeta(
  ctx: PreviewCtx,
  path: string,
  opts?: { icon?: string; label?: string },
): Promise<void> {
  const gen = nextDetailGen();
  const icon = (opts && opts.icon) || "🥽";
  const label = (opts && opts.label) || t("preview.vrcAvatar");
  const basename = path.split(/[/\\]/).pop() || "";
  ctx.root.innerHTML = `<div class="content" id="preview-content">
  <h3>${icon} ${label}</h3>
  <div class="dp-placeholder"><div class="big-icon">⏳</div><div class="dp-hint">${t("preview.parsing")}...</div></div>
</div>`;
  try {
    // readFn 由视图壳注入（适配器 0 backend import，ADR-072 边界判据）
    const App = await getApp();
    const readFn = (App as unknown as Record<string, (p: string) => Promise<string | null>>)["ReadFileBytes"];
    const meta = await readVrmMeta(path, readFn);
    if (gen !== getDetailGen()) return; // 过期守卫：await 期间用户已切走
    if (!meta || (!meta.name && !meta.authors?.length)) {
      // 无 meta（非标准 VRM 或解析失败）→ 仅名称 + FAB
      ctx.root.innerHTML = `<div class="content" id="preview-content">
  <h3>${icon} ${label}</h3>
  <div style="padding:12px;display:flex;flex-direction:column;gap:8px;font-size:var(--fs-sm)">
    <div><strong>${renderFormattedText(basename)}</strong></div>
    <button class="ysm-fab" id="btn-vrm-3d" title="${t("preview.title3d")}" aria-label="${t("preview.title3d")}"><span class="ysm-ic">🎨</span></button>
  </div>
</div>`;
    } else {
      const authors = meta.authors.filter(Boolean).join("、");
      const thumb = meta.thumbnail
        ? `<img src="${esc(meta.thumbnail)}" alt="thumbnail" style="width:128px;height:128px;object-fit:contain;border-radius:6px;border:1px solid var(--bd);align-self:center;image-rendering:pixelated">`
        : "";
      ctx.root.innerHTML = `<div class="content" id="preview-content">
  <h3>${icon} ${label}</h3>
  <div style="padding:12px;display:flex;flex-direction:column;gap:8px;font-size:var(--fs-sm)">
    ${thumb}
    <div><strong>${renderFormattedText(meta.name || basename)}</strong></div>
    ${authors ? `<div style="color:var(--muted)">👤 ${esc(authors)}</div>` : ""}
    ${meta.version ? `<div style="color:var(--muted);font-size:var(--fs-xs)">版本: ${esc(meta.version)}</div>` : ""}
    ${meta.contact ? `<div style="color:var(--muted);font-size:var(--fs-xs)">📮 ${esc(meta.contact)}</div>` : ""}
    ${meta.license ? `<div style="color:var(--muted);font-size:var(--fs-xs)">📜 ${esc(meta.license)}</div>` : ""}
    <button class="ysm-fab" id="btn-vrm-3d" title="${t("preview.title3d")}" aria-label="${t("preview.title3d")}"><span class="ysm-ic">🎨</span></button>
  </div>
</div>`;
    }
    const fab = ctx.root.querySelector<HTMLElement>("#btn-vrm-3d");
    if (fab) {
      fab.onclick = (): void => {
        void createVrm3D(path);
      };
    }
  } catch (e) {
    if (gen !== getDetailGen()) return;
    ctx.root.innerHTML = `<div class="content" id="preview-content">
  <h3>${icon} ${label}</h3>
  <div class="dp-placeholder"><div class="big-icon">⚠️</div><div class="dp-hint">${t("preview.readFailed")}: ${esc(e instanceof Error ? e.message : String(e))}</div></div>
</div>`;
  }
}

/** 显示 MMD 预览卡（文件名 + FAB 进 3D；PMX/PMD 无标准 meta 读取，保持简单形态） */
export async function showMmdPreview(
  ctx: PreviewCtx,
  path: string,
  opts?: { icon?: string; label?: string },
): Promise<void> {
  nextDetailGen(); // 无 await 也要作废在途的慢请求回写
  const icon = (opts && opts.icon) || "🎭";
  const label = (opts && opts.label) || t("preview.mmdSkin");
  const basename = path.split(/[/\\]/).pop() || "";
  ctx.root.innerHTML = `<div class="content" id="preview-content">
  <h3>${icon} ${label}</h3>
  <div style="padding:12px;display:flex;flex-direction:column;gap:8px;font-size:var(--fs-sm)">
    <div><strong>${renderFormattedText(basename || "")}</strong></div>
    <button class="ysm-fab" id="btn-mmd-3d" title="${t("preview.title3d")}" aria-label="${t("preview.title3d")}"><span class="ysm-ic">🎨</span></button>
  </div>
</div>`;
  const fab = ctx.root.querySelector<HTMLElement>("#btn-mmd-3d");
  if (fab) {
    fab.onclick = (): void => {
      // 3D 内换模型（ADR-066 §5.6）：先取同类型候选列表，随 siblings 传入渲染 topBar 切换下拉
      void (async () => {
        const siblings = await resolveMmdSiblings();
        await createMmd3D(path, { siblings });
      })();
    };
  }
}
