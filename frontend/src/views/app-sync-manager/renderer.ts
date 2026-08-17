// ===== app-sync-manager 渲染层（renderer） =====
// 职责：纯 DOM 渲染——类型标签 / 状态标签 / 列表 / 空态 / 加载态
// 不处理数据加载、不绑事件、不调用 Go 桥接。
// 依赖 DAG：index → renderer ← events（events 点击触发 render）

import { RESOURCE_TYPES } from "../../utils/resource/types.ts";
import { t } from "../../core/i18n/t.ts";
import {
  containerHTML,
  statusTabHTML,
  emptyHTML,
  itemHTML,
} from "./tpl.ts";
import { applyFilter } from "./store.ts";
import type { SyncItem } from "./tpl.ts";

// 渲染上下文（数据态 + DOM 操作）
interface SyncRenderSelf {
  _selectedType: string;
  _statusFilter: string;
  _allItems: SyncItem[];
  _filteredItems: SyncItem[];
  _typeConfig: Array<{ id: string; name?: string; icon?: string }>;
  innerHTML: string;
  querySelector(sel: string): HTMLElement | null;
  querySelectorAll(sel: string): NodeList;
  _gen?: number;
  _instance?: string;
  _loading?: boolean;
}

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

  // — 类型标签（分组：模型类 | 资源类）—
  const modelTypes = [RESOURCE_TYPES.YSM, RESOURCE_TYPES.MMD, RESOURCE_TYPES.VRC];
  const resourceTypes = [
    RESOURCE_TYPES.PACK, RESOURCE_TYPES.SHADER,
    RESOURCE_TYPES.BLUEPRINT, RESOURCE_TYPES.LITEMATIC,
  ];
  const shortLabel: Record<string, string> = {
    [RESOURCE_TYPES.YSM]: "YSM",
    [RESOURCE_TYPES.MMD]: "MMD",
    [RESOURCE_TYPES.VRC]: "VRC",
    resourcepack: t("rtype.pack"),
    shaderpack: t("rtype.shader"),
    "create-blueprint": t("rtype.blueprint"),
    litematic: t("rtype.litematic"),
  };

  const renderGroup = (types: string[], sep: boolean): string => {
    let html = "";
    for (const id of types) {
      const t = self._typeConfig.find((c) => c.id === id);
      if (!t) continue;
      const c = typeCounts[id];
      const count = c ? c.total : 0;
      const active = self._selectedType === id;
      html +=
        '<button class="sm-tab' +
        (active ? " active" : "") +
        '" data-type="' +
        id +
        '" style="padding:var(--pad-tab) 14px;border-radius:5px 5px 0 0;border:none;background:' +
        (active ? "var(--surf)" : "transparent") +
        ";color:" +
        (active ? "var(--accent)" : "var(--muted)") +
        ';cursor:pointer;font-family:inherit;font-size:var(--fs-tab);white-space:nowrap">' +
        (t.icon || "📦") +
        " " +
        (shortLabel[id] || t.name) +
        (count > 0
          ? ' <span style="font-size:var(--fs-xs);opacity:0.7">(' + count +')</span>'
          : "") +
        "</button>";
    }
    if (sep) html += '<span style="color:var(--bd);padding:0 2px">│</span>';
    return html;
  };
  tabsEl.innerHTML = renderGroup(modelTypes, true) + renderGroup(resourceTypes, false);

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
  applyFilter(self as any);
  renderList(self, listEl);
}

/** 渲染列表行（含空态） */
export function renderList(self: SyncRenderSelf, listEl: HTMLElement): void {
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
