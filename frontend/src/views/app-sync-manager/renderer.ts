// ===== app-sync-manager 渲染层（renderer） =====
// 职责：纯 DOM 渲染——类型标签 / 状态标签 / 列表 / 空态 / 加载态
// 不处理数据加载、不绑事件、不调用 Go 桥接。
// 依赖 DAG：index → renderer ← events（events 点击触发 render）

import { RESOURCE_TYPES, MMD_SUBTYPES } from "../../utils/resource/types.ts";
import { shortLabelOf } from "../../utils/resource/short-label.ts";
import { t } from "../../core/i18n/t.ts";
import { esc } from "../../utils/dom/html.ts";
import {
  containerHTML,
  statusTabHTML,
  emptyHTML,
  itemHTML,
} from "./tpl.ts";
import type { SyncItem } from "./tpl.ts";
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

  const statusTabsEl = self.querySelector(".sm-status-tabs");
  const listEl = self.querySelector(".sm-list");
  if (!statusTabsEl || !listEl) {
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

  // 类型短标签（当前类型指示用；选择已全局化，此处不再渲染可切 tab）。
  // 共用 shortLabelOf（utils/resource/short-label.ts，与 app-nav logo 同源，消除重复映射）

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
  // 当前类型只读指示（类型选择已全局化到 nav 下拉，此处仅展示上下文，不再承担切换）
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
  // ADR-095 后续：MMD 按用途子目录分组展示（角色/场景/动画…分开，不再平铺一锅）。
  // 子目录来自 Go 侧 ResourceSyncItem.SubDir（BuildSyncItems 按注册表 subtypes 判定填充，
  // ADR-104）；根下条目 SubDir="" 归 EntityPlayer 默认槽组。
  // 组序/标签均来自注册表派生的 MMD_SUBTYPES（userImportable 过滤 6 项）。
  if (self._selectedType === RESOURCE_TYPES.MMD) {
    listEl.innerHTML = renderMMDGroups(self._filteredItems);
    return;
  }
  listEl.innerHTML = self._filteredItems.map((it, i) => itemHTML(it, i)).join("");
}

/** MMD 子目录组名 → 显示标签（MMD_SUBTYPES 优先，系统内置 DefaultAnim/DefaultMorph 显示原名） */
function mmdGroupLabel(subdir: string): string {
  if (!subdir) return MMD_SUBTYPES[0]?.label || "EntityPlayer";
  const hit = MMD_SUBTYPES.find((s) => s.subdir.toLowerCase() === subdir.toLowerCase());
  return hit ? hit.label : subdir;
}

/** MMD 分组渲染：组头 + 组内条目；组序按 MMD_SUBTYPES（根、场景、动画…），未知归尾 */
function renderMMDGroups(items: SyncItem[]): string {
  const groups = new Map<string, SyncItem[]>();
  for (const it of items) {
    const key = (it.subdir || "").toLowerCase();
    const arr = groups.get(key) || [];
    arr.push(it);
    groups.set(key, arr);
  }
  // 组排序：MMD_SUBTYPES 定义的 subdir 顺序（含根 ""），未知组追加尾部
  const order = new Map<string, number>();
  MMD_SUBTYPES.forEach((s, i) => order.set(s.subdir.toLowerCase(), i));
  const keys = Array.from(groups.keys()).sort(
    (a, b) =>
      (order.has(a) ? order.get(a)! : 99) - (order.has(b) ? order.get(b)! : 99),
  );
  let html = "";
  for (const key of keys) {
    const list = groups.get(key)!;
    const label = mmdGroupLabel(key);
    html +=
      '<div class="sm-group-head" style="display:flex;align-items:center;gap:4px;' +
      "padding:3px 10px;color:var(--muted);font-size:var(--fs-xs);" +
      'border-bottom:1px solid var(--bd);background:var(--hover)">' +
      esc(label) +
      ' <span style="opacity:0.7">(' +
      list.length +
      ")</span></div>";
    html += list.map((it, i) => itemHTML(it, i)).join("");
  }
  return html;
}
