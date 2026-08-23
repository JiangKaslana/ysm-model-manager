// ===== app-sync-manager 渲染层（renderer） =====
// 职责：纯 DOM 渲染——类型标签 / 状态标签 / 列表 / 空态 / 加载态
// 不处理数据加载、不绑事件、不调用 Go 桥接。
// 依赖 DAG：index → renderer ← events（events 点击触发 render）

import { shortLabelOf } from "../../utils/resource/short-label.ts";
import { t } from "../../core/i18n/t.ts";
import { esc } from "../../utils/dom/html.ts";
import {
  containerHTML,
  statusTabHTML,
  emptyHTML,
  itemHTML,
  syncDirRowHTML,
} from "./tpl.ts";
import type { SyncItem } from "./tpl.ts";
import { applyFilter } from "./store.ts";
import type { SyncManagerSelf } from "./index.ts";

export type SyncRenderSelf = SyncManagerSelf;

// 类型统计计数（包含 diverged）
interface TypeCounts {
  synced: number;
  missing: number;
  disabled: number;
  optional: number;
  legacy: number;
  diverged: number;
  total: number;
}

/** 主渲染入口：设置骨架 → 类型标签 → 状态标签 → 列表 */
export async function render(self: SyncRenderSelf): Promise<void> {
  try {
    self.innerHTML = containerHTML();
  } catch (e) {
    console.error("[sync-manager] _render 设置 innerHTML 失败:", e);
    return;
  }

  const statusTabsEl = self.querySelector(".sm-status-tabs");
  const listEl = self.querySelector(".sm-list");
  if (!statusTabsEl || !listEl) {
    console.warn("[sync-manager] _render DOM 查询失败, 放弃渲染");
    return;
  }

  // — 类型统计 —
  const typeCounts: Record<string, TypeCounts> = {};
  for (const tc of self._typeConfig) {
    typeCounts[tc.id] = {
      synced: 0, missing: 0, disabled: 0, optional: 0, legacy: 0, diverged: 0, total: 0,
    };
  }
  for (const item of self._allItems) {
    const c = typeCounts[item.type];
    if (c) {
      // diverged 计入 missing tab（继承可操作属性）
      const tabStatus = item.status === "diverged" ? "missing" : item.status;
      (c as unknown as Record<string, number>)[tabStatus]++;
      c.total++;
    }
  }
  const globalCounts: TypeCounts = {
    synced: 0, missing: 0, disabled: 0, optional: 0, legacy: 0, diverged: 0, total: 0,
  };
  for (const item of self._allItems) {
    const tabStatus = item.status === "diverged" ? "missing" : item.status;
    (globalCounts as unknown as Record<string, number>)[tabStatus]++;
  }

  // — 状态筛选标签 —
  const curCounts: TypeCounts = self._selectedType
    ? (typeCounts[self._selectedType] || globalCounts)
    : globalCounts;
  const statusDefs: Array<[string, string, number]> = [
    ["all", "📊 " + t("syncManager.status.all"), self._selectedType ? curCounts.total || 0 : self._allItems.length],
    ["synced", "✅ " + t("syncManager.status.synced"), curCounts.synced || 0],
    ["missing", "⬇️ " + t("syncManager.status.missing"), curCounts.missing || 0],
    ["disabled", "⛔ " + t("syncManager.status.disabled"), curCounts.disabled || 0],
    ["optional", "📤 " + t("syncManager.status.optional"), curCounts.optional || 0],
    ["legacy", "🔗 " + t("syncManager.status.legacy"), curCounts.legacy || 0],
  ];
  // 当前类型只读指示（类型选择已全局化到 nav 下拉，此处仅展示上下文）
  const curCfg = self._typeConfig.find((c) => c.id === self._selectedType);
  const curLabel = (curCfg && (shortLabelOf(curCfg.id) || curCfg.name)) || self._selectedType || "";
  const curIcon = curCfg?.icon || "📦";
  statusTabsEl.innerHTML =
    '<span class="sm-cur-type" data-rtype="' +
    esc(self._selectedType || "") +
    '" style="display:inline-flex;align-items:center;gap:4px;padding:0 8px;' +
    "color:var(--accent);font-size:var(--fs-filter);white-space:nowrap;" +
    'border-right:1px solid var(--bd);margin-right:6px" title="' +
    t("syncManager.curTypeHint") +
    '">' +
    esc(curIcon) +
    " " +
    esc(curLabel) +
    "</span>" +
    statusDefs
      .map(([id, label, count]) =>
        statusTabHTML(id, label, count, self._statusFilter === id),
      )
      .join("");

  // — 列表 —
  applyFilter(self);
  await renderList(self, listEl).catch((e) => console.error("[sync-manager] renderList 失败:", e));
}

/** 渲染列表行（含空态）——按 isDir 分流 */
async function renderList(self: SyncRenderSelf, listEl: HTMLElement): Promise<void> {
  if (!listEl) return;
  if (self._filteredItems.length === 0) {
    const statusLabels: Record<string, string> = {
      all: "",
      synced: t("syncManager.status.synced"),
      missing: t("syncManager.status.missing"),
      disabled: t("syncManager.status.disabled"),
      optional: t("syncManager.status.optional"),
      legacy: t("syncManager.status.legacy"),
    };
    const hint =
      self._statusFilter !== "all"
        ? t("syncManager.emptyFiltered", { status: statusLabels[self._statusFilter] || "" })
        : t("syncManager.emptyType");
    listEl.innerHTML = emptyHTML(hint);
    return;
  }

  const dirOpen = self._dirOpen || {};
  const htmlParts: string[] = [];

  self._filteredItems.forEach((item, i) => {
    if (item.isDir) {
      // 文件夹行：可展开
      const isOpen = !!dirOpen[item.path];
      htmlParts.push(syncDirRowHTML(item.path, item, isOpen, i, item.path));

      // 展开时渲染 children（带真实状态的子文件）
      if (isOpen && item.children && item.children.length > 0) {
        const baseIndent = 32; // 2 * 16px
        item.children.forEach((child, ci) => {
          const childHtml = itemHTML(child, i + ci + 1);
          htmlParts.push('<div style="padding-left:' + baseIndent + 'px">' + childHtml + '</div>');
        });
      }
    } else {
      // 扁平文件行
      htmlParts.push(itemHTML(item, i));
    }
  });

  listEl.innerHTML = htmlParts.join("");
}