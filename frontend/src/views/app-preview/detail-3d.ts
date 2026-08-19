// ===== 3D 入口详情（ADR-072 D3：detail.ts 按资源域拆分）=====
// showVrmMeta / showMmdPreview 是「3D 入口卡」（meta 信息 + FAB 进 3D），与 2D 详情
// （showModelDetail/showResourcePack/showShaderpack）分离；共享代际 _detailGen 从
// detail.ts 导出复用，保证跨文件快速切换时在途请求互相作废。

import { getApp } from "../../backend/app.ts";
import { renderFormattedText } from "../../utils/format/mc-format.ts";
import { esc } from "../../utils/dom/html.ts";
import { readVrmMeta } from "../../utils/3d/adapters/vrm-adapter.ts";
import { createVrm3D } from "./vrm-3d.ts";
import { createMmd3D } from "./mmd-3d.ts";
import { createScene3D } from "./scene-3d.ts";
import { resolveMmdSiblings } from "./mmd-siblings.ts";
import { resolveSceneSiblings } from "./scene-siblings.ts";
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
    <button class="preview-fab" id="btn-vrm-3d" title="${t("preview.title3d")}" aria-label="${t("preview.title3d")}"><span class="preview-ic">🎨</span></button>
  </div>
</div>`;
    } else {
      const authors = meta.authors.filter(Boolean).join("、");
      const thumb = meta.thumbnail
        ? `<img src="${esc(meta.thumbnail)}" alt="thumbnail" style="width:128px;height:128px;object-fit:contain;border-radius:6px;border:1px solid var(--bd);align-self:center;image-rendering:pixelated">`
        : "";
      // VRM0 授权约束徽章
      const r = meta.restrictions;
      const badge = (label: string, ok: boolean | undefined, icon: string): string => {
        const v = ok === undefined ? "—" : ok ? "✅" : "❌";
        return `<span style="display:inline-flex;align-items:center;gap:2px;padding:1px 6px;border-radius:4px;background:rgba(255,255,255,0.06);font-size:11px;margin-right:4px"><span>${icon}</span>${label}:${v}</span>`;
      };
      const refBadge = r?.reference
        ? `<div style="color:var(--muted);font-size:var(--fs-xs);margin-top:4px">📎 参考: ${esc(r.reference)}</div>`
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
    ${refBadge}
    ${r ? `<div style="display:flex;flex-wrap:wrap;align-items:center;margin-top:2px">${badge("商用", r.commercial, "💰")}${badge("用户", r.allowedUser === "everyone", "👥")}${badge("性", r.sexual, "🔞")}${badge("暴力", r.violent, "⚔️")}</div>` : ""}
    <button class="preview-fab" id="btn-vrm-3d" title="${t("preview.title3d")}" aria-label="${t("preview.title3d")}"><span class="preview-ic">🎨</span></button>
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
    <button class="preview-fab" id="btn-mmd-3d" title="${t("preview.title3d")}" aria-label="${t("preview.title3d")}"><span class="preview-ic">🎨</span></button>
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

/** 显示场景 MMD 预览卡（独立入口，与角色模型完全隔离） */
export async function showScenePreview(
  ctx: PreviewCtx,
  path: string,
): Promise<void> {
  nextDetailGen();
  const basename = path.split(/[/\\]/).pop() || "";
  ctx.root.innerHTML = `<div class="content" id="preview-content">
  <h3>🏗️ ${t("preview.sceneModel") || "场景"}</h3>
  <div style="padding:12px;display:flex;flex-direction:column;gap:8px;font-size:var(--fs-sm)">
    <div><strong>${renderFormattedText(basename || "")}</strong></div>
    <div style="font-size:11px;color:var(--muted);display:flex;gap:4px;align-items:center">
      <span style="background:rgba(124,131,255,0.2);color:#7c83ff;padding:1px 6px;border-radius:4px;font-weight:500">SceneModel</span>
      <span>场景模型</span>
    </div>
    <button class="preview-fab" id="btn-scene-3d" title="${t("preview.title3d")}" aria-label="${t("preview.title3d")}" style="background:linear-gradient(135deg,#7c83ff 0%,#4a55d6 100%)"><span class="preview-ic">🏗️</span></button>
  </div>
</div>`;
  const fab = ctx.root.querySelector<HTMLElement>("#btn-scene-3d");
  if (fab) {
    fab.onclick = (): void => {
      void (async () => {
        const siblings = await resolveSceneSiblings();
        await createScene3D(path, { siblings });
      })();
    };
  }
}
