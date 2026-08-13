// ===== recycleHTML 模板（从 tpl.ts 拆出，ADR-040 P2 chunk 实效修复）=====
// 动态导入目标：init-pages.ts 按需加载，使 Vite 真正按功能拆分 chunk。
import { t } from "../../core/i18n/t.ts";

export function recycleHTML(): string {
  return `<div class="recy-page" style="flex:1;display:flex;flex-direction:column;overflow:hidden;padding:12px">
<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
<span id="recy-count" style="font-size:11px;color:#6c7086">${t("common.loading")}</span>
<button class="btn-base sm" id="recy-refresh" style="margin-left:auto">🔄 ${t("common.refresh")}</button>
<button class="btn-base danger sm" id="recy-empty">♻️ ${t("recycle.empty")}</button>
</div>
<div id="recy-list" style="flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:4px"></div>
</div>`;
}
