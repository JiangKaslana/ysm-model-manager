// ===== downloadsHTML 模板（从 tpl.ts 拆出，ADR-040 P2 chunk 实效修复）=====
// 动态导入目标：init-pages.ts 按需加载，使 Vite 真正按功能拆分 chunk。
import { ALL_EXTS } from "../../utils/resource/extensions.ts";
import { t } from "../../core/i18n/t.ts";

export function downloadsHTML(): string {
  return `<div style="flex:1;display:flex;flex-direction:column;overflow:hidden">
<div id="dl-form" style="margin:4px 12px;display:none;flex-direction:column;gap:4px">
  <div style="font-size:11px;color:var(--muted);display:flex;align-items:center;gap:4px;flex-wrap:wrap">
    <span>${t("import.renameGuide")}</span>
    <label style="display:flex;align-items:center;gap:2px;font-size:10px;color:var(--muted);cursor:pointer;white-space:nowrap">
      <input type="checkbox" id="dl-from-header"> ${t("downloads.readAuthor")}
    </label>
    <label style="display:flex;align-items:center;gap:2px;font-size:10px;color:var(--muted);cursor:pointer;white-space:nowrap">
      <input type="checkbox" id="dl-date-auto" checked> ${t("downloads.today")}
    </label>
  </div>
  <div style="display:flex;gap:4px">
    <input id="dl-author" placeholder="${t("import.author")}" style="width:90px;padding:4px 5px;border-radius:4px;border:1px solid var(--bd);background:var(--surf);color:var(--txt);font-size:11px">
    <input id="dl-work" placeholder="${t("import.brand")}" style="width:90px;padding:4px 5px;border-radius:4px;border:1px solid var(--bd);background:var(--surf);color:var(--txt);font-size:11px">
    <input id="dl-chara" placeholder="${t("import.character")}" style="width:80px;padding:4px 5px;border-radius:4px;border:1px solid var(--bd);background:var(--surf);color:var(--txt);font-size:11px">
    <input id="dl-variant" placeholder="${t("import.variant")}" style="width:60px;padding:4px 5px;border-radius:4px;border:1px solid var(--bd);background:var(--surf);color:var(--txt);font-size:11px">
    <input id="dl-date" placeholder="${t("import.date")}" style="width:64px;padding:4px 5px;border-radius:4px;border:1px solid var(--bd);background:var(--surf);color:var(--txt);font-size:11px">
  </div>
  <div id="dl-tips" style="display:none;font-size:10px;color:var(--muted);padding:4px 8px;margin:2px 0;border-radius:4px;border-left:3px solid var(--accent);background:var(--surf);line-height:1.5;max-height:60px;overflow-y:auto"></div>
  <div style="display:flex;align-items:center;gap:8px;padding:4px 6px;border-radius:4px;background:var(--surf);overflow:hidden">
    <span style="color:var(--muted);font-size:9px;white-space:nowrap">${t("import.preview")}</span>
    <span id="dl-preview" style="font-weight:600;font-size:12px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">-</span>
    <span id="dl-conflict" style="display:none;font-size:9px;color:#f9a826;white-space:nowrap">⚠️</span>
    <button class="btn-base accent sm" id="dl-import" style="white-space:nowrap">📥 ${t("import.importBtn")}</button>
    <span style="font-size:9px;color:var(--muted);white-space:nowrap">${t("import.queue")} <span id="dl-queue-count">0</span></span>
    <button class="btn-base sm" id="dl-cancel" style="white-space:nowrap">✕</button>
  </div>
</div>
<div style="margin:0 12px 4px;border-top:1px solid var(--bd);padding-top:4px">
  <div style="display:flex;align-items:center;gap:6px;font-weight:600;color:var(--txt);padding:2px 0">
    <span style="font-size:var(--fs-md)">📋 ${t("import.imported")}</span>
    <span id="dl-count" style="font-size:10px;color:var(--muted);font-weight:400">${t("downloads.fileCount", { n: 0 })}</span>
    <button class="btn-base sm" id="dl-clear-list" style="margin-left:auto">🗑️ ${t("common.clear")}</button>
  </div>
  <div id="dl-imported-list" style="display:flex;flex-direction:column;gap:2px;max-height:200px;overflow-y:auto"></div>
</div>
<div id="dl-drop" style="flex:1;margin:4px 12px;border:2px dashed var(--bd);border-radius:10px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:4px;transition:all .2s;cursor:pointer;min-height:80px">
  <div style="font-size:28px;opacity:.35">📥</div>
  <div style="font-size:11px;color:var(--muted)">${t("downloads.dropHint", { exts: ALL_EXTS.join(" ") })}</div>
  <div style="display:flex;gap:8px;align-items:center">
    <span style="font-size:9px;color:var(--muted)">📁 ${t("downloads.folderHint")}</span>
  </div>
  <div style="font-size:10px;color:#bd93f9;margin-top:2px">💡 ${t("downloads.mmdHint")}</div>
  <input type="file" id="dl-file-input" accept="${ALL_EXTS.join(",")}" style="display:none">
  <input type="file" id="dl-folder-input" webkitdirectory style="display:none">
</div>
</div>
</div>`;
}
