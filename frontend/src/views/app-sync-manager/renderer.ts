// ===== app-sync-manager 渲染层（renderer） =====
// 职责：纯 DOM 渲染——类型标签 / 状态标签 / 列表 / 空态 / 加载态
// 不处理数据加载、不绑事件、不调用 Go 桥接。
// 依赖 DAG：index → renderer ← events（events 点击触发 render）

import { RESOURCE_TYPES, GROUP_META, GROUP_OF, groupStorageRootOf } from "../../utils/resource/types.ts";
import { t } from "../../core/i18n/t.ts";
import { esc } from "../../utils/dom/html.ts";
import {
  containerHTML,
  statusTabHTML,
  emptyHTML,
  itemHTML,
} from "./tpl.ts";
import { applyFilter } from "./store.ts";
import type { SyncManagerSelf } from "./index.ts";

export type SyncRenderSelf = SyncManagerSelf;

// 类型统计计数
interface TypeCounts {
  synced: number;
  missing: number;
  disabled: number;
  optional: number;
  legacy: number;
  total: number;
}

/** 主渲染入口：设置骨架 → 类型标签 → 状态标签 → 列表 */
export function render(self: SyncRenderSelf): void {
  try {
    self.innerHTML = containerHTML();
  } catch (e) {
    console.error("[sync-manager] _render 设置 innerHTML 失败:", e);
    return;
  }

  const tabsEl = self.querySelector(".sm-tabs");
  const statusTabsEl = self.querySelector(".sm-status-tabs");
  const listEl = self.querySelector(".sm-list");
  if (!tabsEl || !statusTabsEl || !listEl) {
    console.warn("[sync-manager] _render DOM 查询失败, 放弃渲染");
    return;
  }

  // — 类型统计 —
  const typeCounts: Record<string, TypeCounts> = {};
  for (const t of self._typeConfig) {
    typeCounts[t.id] = {
      synced: 0, missing: 0, disabled: 0, optional: 0, legacy: 0, total: 0,
    };
  }
  for (const item of self._allItems) {
    const c = typeCounts[item.type];
    if (c) {
      (c as unknown as Record<string, number>)[item.status]++;
      c.total++;
    }
  }
  const globalCounts: TypeCounts = {
    synced: 0, missing: 0, disabled: 0, optional: 0, legacy: 0, total: 0,
  };
  for (const item of self._allItems) {
    (globalCounts as unknown as Record<string, number>)[item.status]++;
  }

  // — 类型标签（按 ADR-092 大分类分组派生：GROUP_META.order 排序 + GROUP_OF 归属）—
  const shortLabel: Record<string, string> = {
    [RESOURCE_TYPES.YSM]: "YSM",
    [RESOURCE_TYPES.MMD]: "MMD",
    [RESOURCE_TYPES.VRC]: "VRC",
    resourcepack: t("rtype.pack"),
    shaderpack: t("rtype.shader"),
    "create-blueprint": t("rtype.blueprint"),
    litematic: t("rtype.litematic"),
  };

  // 类型标签 HTML（R8 豁免：HTML 后缀安全生成器 + 内部 esc 转义动态数据）
  const typeTabHTML = (types: string[]): string => {
    let html = "";
    for (const id of types) {
      const cfg = self._typeConfig.find((c) => c.id === id);
      if (!cfg) continue;
      const c = typeCounts[id];
      const count = c ? c.total : 0;
      const active = self._selectedType === id;
      const label = shortLabel[id] || cfg.name;
      html +=
        '<button class="sm-tab' +
        (active ? " active" : "") +
        '" data-type="' +
        esc(id) +
        '" title="' +
        esc(groupStorageRootOf(id)) +
        '" style="padding:var(--pad-tab) 14px;border-radius:5px 5px 0 0;border:none;background:' +
        (active ? "var(--surf)" : "transparent") +
        ";color:" +
        (active ? "var(--accent)" : "var(--muted)") +
        ';cursor:pointer;font-family:inherit;font-size:var(--fs-tab);white-space:nowrap">' +
        esc(cfg.icon || "📦") +
        " " +
        esc(label || "") +
        (count > 0
          ? ' <span style="font-size:var(--fs-xs);opacity:0.7">(' + count + ")</span>"
          : "") +
        "</button>";
    }
    return html;
  };

  // 大分类分组渲染：组头（icon + 分组名 + 存放位置）+ 组内类型 tab，组间 │ 分隔。
  // 分组顺序由 GROUP_META.order 决定；无 group 的类型归入「其他」尾组（向后兼容）。
  const groupIds = Object.keys(GROUP_META).sort(
    (a, b) => (GROUP_META[a]?.order ?? 9) - (GROUP_META[b]?.order ?? 9),
  );
  const others: string[] = [];
  const groupTabs: string[] = [];
  for (const gid of groupIds) {
    const members = self._typeConfig.filter((c) => GROUP_OF[c.id] === gid).map((c) => c.id);
    if (members.length === 0) continue;
    const meta = GROUP_META[gid];
    const roots = members.map((id) => groupStorageRootOf(id)).join(" / ");
    groupTabs.push(
      '<span class="sm-group" style="display:inline-flex;align-items:center;gap:4px;padding:0 6px;' +
        'color:var(--muted);font-size:var(--fs-xs);white-space:nowrap" title="存放位置：' +
        esc(roots) +
        '">' +
        esc(meta?.icon || "📦") +
        " " +
        esc(meta?.name || gid) +
        "</span>" +
        typeTabHTML(members),
    );
  }
  for (const c of self._typeConfig) {
    if (!GROUP_OF[c.id] && !others.includes(c.id)) others.push(c.id);
  }
  if (others.length > 0) {
    groupTabs.push(
      '<span class="sm-group" style="display:inline-flex;align-items:center;gap:4px;padding:0 6px;' +
        'color:var(--muted);font-size:var(--fs-xs);white-space:nowrap">📦 其他</span>' +
        typeTabHTML(others),
    );
  }
  tabsEl.innerHTML = groupTabs.join('<span style="color:var(--bd);padding:0 2px">│</span>');

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
  statusTabsEl.innerHTML = statusDefs
    .map(([id, label, count]) =>
      statusTabHTML(id, label, count, self._statusFilter === id),
    )
    .join("");

  // — 列表 —
  applyFilter(self);
  renderList(self, listEl);
}

/** 渲染列表行（含空态） */
function renderList(self: SyncRenderSelf, listEl: HTMLElement): void {
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
  listEl.innerHTML = self._filteredItems.map((it, i) => itemHTML(it, i)).join("");
}
