// ===== app-sync-manager 渲染层（renderer） =====
// 职责：纯 DOM 渲染——类型标签 / 状态标签 / 列表 / 空态 / 加载态
// 不处理数据加载、不绑事件、不调用 Go 桥接。
// 依赖 DAG：index → renderer ← events（events 点击触发 render）

import { RESOURCE_TYPES, RESOURCE_TYPE_LABELS } from "../../utils/resource/types.ts";
import { shortLabelOf } from "../../utils/resource/short-label.ts";
import { t } from "../../core/i18n/t.ts";
import { esc } from "../../utils/dom/html.ts";
import { getApp } from "../../backend/app.ts";
import {
  containerHTML,
  statusTabHTML,
  emptyHTML,
  itemHTML,
  syncDirRowHTML,
  syncFileRowHTML,
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
  await renderList(self, listEl).catch((e) => console.error("[sync-manager] renderList 失败:", e));
}

/** 渲染列表行（含空态） */
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
  // dirLevelSync 类型（ysm / EntityPlayer / blueprint / maid-model / vrm…）：
  // 按路径天然层级展示（subdir 非空时提为顶层文件夹；文件夹=SyncItem 本身，
  // 展开后扫仓库子条目显示内部文件）。无仓库根时兜底走平铺。
  if (isDirLevelSync(self)) {
    if (!self._filesRoots[self._selectedType]) {
      listEl.innerHTML = self._filteredItems.map((it, i) => itemHTML(it, i)).join("");
    } else {
      listEl.innerHTML = await renderSyncTree(self, self._filteredItems);
    }
    return;
  }
  // fileLevel 类型（resourcepack / shaderpack…）：保持平铺
  listEl.innerHTML = self._filteredItems.map((it, i) => itemHTML(it, i)).join("");
}

// ===== dirLevelSync 层级展示（ysm / blueprint / maid-model / vrm…）=====
// 文件夹 = SyncItem 本身；展开后 ScanModelEntriesWithLabel 扫仓库子目录，显示内部文件。
// 层级由路径天然分段（与 app-tree buildTree 同构），不再按 rtype 逐个特判。

interface SyncTreeNode {
  sync?: SyncItem;      // 有值 = 模型/文件夹行（带状态 + 操作按钮）
  files?: Array<{ name: string; path: string; size: number; status?: string; icon?: string }>;
  /** subdir 分组文件夹（MMD 的 EntityPlayer/SceneModel 等）：无同步状态，纯分组导航 */
  _group?: boolean;
  [key: string]: SyncTreeNode | SyncItem | Array<{ name: string; path: string; size: number; status?: string; icon?: string }> | boolean | undefined;
}
interface SyncTreeRow {
  type: "dir" | "file";
  key: string;
  sync?: SyncItem;
  indent: number;
  /** 子文件元数据（name/size），从父 SyncItem 派生状态用于 itemHTML 渲染 */
  fileName?: string;
  fileSize?: number;
}

/** 当前类型是否 dirLevelSync（从 _typeConfig 中读取 dirLevelSync 字段） */
function isDirLevelSync(self: SyncRenderSelf): boolean {
  const cfg = self._typeConfig.find((c) => c.id === self._selectedType);
  return cfg?.dirLevelSync === true;
}

/** 统一的展开判断：子项只需提供自身绝对路径 + subdir，函数独立判断是否展开。
 * 单一事实源——所有 dirOpen 检查走此函数，避免散落的 || groupKey 重复逻辑。 */
function shouldExpand(syncPath: string, subdir: string | undefined, dirOpen: Record<string, boolean>): boolean {
  if (dirOpen[syncPath]) return true;
  const groupKey = subdir?.trim();
  if (groupKey && dirOpen[groupKey]) return true;
  return false;
}

/** 扫描某绝对目录的子条目（dir-level 展开用，SyncItem.path 即仓库/整合包绝对路径）；失败静默返回 [] */
async function scanSubEntries(absDir: string, rtype: string): Promise<Array<{ name: string; path: string; size: number }>> {
  try {
    const { ScanModelEntriesWithLabel } = await getApp();
    const raw = (await ScanModelEntriesWithLabel(absDir, RESOURCE_TYPE_LABELS[rtype] || rtype)) as Array<{
      Name?: string; Path?: string; Size?: number;
    }>;
    return (raw || []).filter((e) => e.Name || e.Path).map((e) => {
      const p = (e.Path || "").replace(/\\/g, "/");
      const name = e.Name || p.split("/").pop() || "";
      return { name, path: p, size: e.Size || 0 };
    });
  } catch {
    return [];
  }
}

/** 将 SyncItems 拼成嵌套树（文件夹 = subdir 分组 + 模型文件夹行；文件 = Scan 子条目或 children 子项）
 * 展示 key 由 SyncItem.subdir（后端按各自侧根算好的子类分组）+ SyncItem.name（叶子名）
 * 组成，不再用绝对路径逐段解析——避免 subdir 提层时路径重复拼接（CustomAnim/CustomAnim/CustomAnim）。
 * 展开状态与操作（data-path）一律用 SyncItem.path（绝对路径），push/pull 直接消费。
 * 
 * 当子条目有 status 时（来自后端 children），会创建带有真实状态的 SyncItem，
 * 在 flattenSyncTree 中使用 file 字段存储，渲染时显示真实状态和按钮。
 */
function buildSyncTree(
  items: SyncItem[],
  scanned: Record<string, Array<{ name: string; path: string; size: number; status?: string; icon?: string }>>,
): SyncTreeNode {
  const root: SyncTreeNode = {};
  const pathOf = (it: SyncItem): string =>
    (it.path || "").replace(/\\/g, "/").replace(/^[/\\]+/, "");
  for (const it of items) {
    const p = pathOf(it);
    if (!p) continue;
    // subdir 非空时提为顶层分组文件夹（MMD 的用途子目录），叶子用后端名
    const topLevel = (it.subdir && it.subdir.trim()) ? it.subdir.trim() : null;
    const leafName = it.name || p.split("/").filter(Boolean).pop() || "";
    let node: SyncTreeNode = root;
    if (topLevel) {
      if (!root[topLevel]) {
        root[topLevel] = { _group: true } as SyncTreeNode;
      }
      node = root[topLevel] as SyncTreeNode;
    }
    
    // 处理子条目：如果有 status，创建带状态的 SyncItem
    const rawFiles = scanned[p] || [];
    const files: Array<{ name: string; path: string; size: number; status?: string; icon?: string }> = [];
    for (const f of rawFiles) {
      files.push({
        name: f.name,
        path: p + "/" + f.name,
        size: f.size,
        status: f.status,
        icon: f.icon,
      });
    }
    
    const nodeData: SyncTreeNode = { sync: it, files };
    node[leafName] = nodeData;
  }
  return root;
}

/** 拍平 SyncTree → 行数组（depth 控缩进；_dirOpen 控展开） */
function flattenSyncTree(node: SyncTreeNode, dirOpen: Record<string, boolean>, depth: number, prefix: string): SyncTreeRow[] {
  const rows: SyncTreeRow[] = [];
  const keys = Object.keys(node);
  for (const k of keys) {
    const v = node[k] as SyncTreeNode;
    if (!v) continue;
    const key = prefix ? prefix + "/" + k : k;
    if (v.sync) {
      rows.push({ type: "dir", key, sync: v.sync, indent: depth * 16 + 10 });
      // 展开判断委托给 shouldExpand——子项独立提供自身路径信息
      if (shouldExpand(v.sync.path || "", v.sync.subdir, dirOpen)) {
        if (v.files && v.files.length) {
          for (const f of v.files) {
            // 为每个子文件创建独立的 SyncItem
            // 如果有 status（来自后端 children），使用真实状态
            const childSync: SyncItem = {
              path: f.path,
              name: f.name,
              status: f.status || "",
              type: v.sync.type,
              icon: f.icon || "",
              size: f.size,
            };
            rows.push({
              type: "file",
              key: key + "/" + f.name,
              sync: childSync,
              fileName: f.name,
              fileSize: f.size,
              indent: (depth + 1) * 16 + 10,
            });
          }
        }
      }
    } else if (v._group) {
      // subdir 分组文件夹行：无同步状态、无操作按钮，纯分组导航；展开后显示内部模型
      const pseudo: SyncItem = { path: key, name: key, status: "", type: "", icon: "📁", size: 0 };
      rows.push({ type: "dir", key, sync: pseudo, indent: depth * 16 + 10 });
      if (dirOpen[key]) {
        rows.push(...flattenSyncTree(v, dirOpen, depth + 1, key));
      }
    } else {
      rows.push(...flattenSyncTree(v, dirOpen, depth + 1, key));
    }
  }
  return rows;
}

/** 渲染 dirLevelSync 层级列表（文件夹行带状态/按钮；展开后显示内部文件） */
async function renderSyncTree(self: SyncRenderSelf, items: SyncItem[]): Promise<string> {
  if (!items.length) return "";
  const rtype = self._selectedType || "";
  const dirOpen = self._dirOpen || {};
  const scanned: Record<string, Array<{ name: string; path: string; size: number }>> = {};
  await Promise.all(
    items.map(async (it) => {
      const raw = it.path || "";
      const p = raw.replace(/\\/g, "/");
      if (!p) return;
      // 展开判断委托给 shouldExpand——子项独立提供自身路径信息
      if (shouldExpand(raw, it.subdir, dirOpen)) {
        // 如果有 children（后端内容级 diff），使用 children 数据
        if (it.children && it.children.length > 0) {
          scanned[p] = it.children.map((child) => ({
            name: child.name,
            path: child.path,
            size: child.size,
            status: child.status,
            icon: child.icon,
          }));
        } else {
          // 否则扫描子条目（兼容旧数据）
          scanned[p] = await scanSubEntries(raw, rtype);
        }
      }
    }),
  );
  const tree = buildSyncTree(items, scanned);
  const rows = flattenSyncTree(tree, dirOpen, 0, "");
  let html = "";
  rows.forEach((r, i) => {
    if (r.type === "dir" && r.sync) {
      const shouldOpen = shouldExpand(r.sync.path || "", r.sync.subdir, dirOpen);
      // data-path 用后端绝对路径（SyncItem.path），push/pull 直接消费
      html += syncDirRowHTML(r.key, r.sync, shouldOpen, i, r.sync.path);
    } else if (r.type === "file" && r.sync) {
      // 子文件行：判断是否有真实状态（来自 children，非空且非 synced）
      const status = r.sync.status || "";
      const hasRealStatus = status !== "" && status !== "synced";
      const indent = r.indent || 0;
      
      if (hasRealStatus) {
        // 有真实状态：使用 itemHTML 渲染，显示状态图标和操作按钮
        const childItem: SyncItem = {
          path: r.sync.path || r.key,
          name: r.fileName || r.sync.name,
          status: r.sync.status,
          type: r.sync.type,
          icon: r.sync.icon,
          size: r.fileSize || r.sync.size,
        };
        // 用缩进样式包裹 itemHTML
        const itemHtml = itemHTML(childItem, i);
        html += '<div style="padding-left:' + (indent * 16 + 24) + 'px">' + itemHtml + '</div>';
      } else {
        // 无真实状态：用 syncFileRowHTML 中性渲染（向后兼容）
        html += syncFileRowHTML({
          name: r.fileName || r.sync.name,
          path: r.key,
          size: r.fileSize || r.sync.size,
        }, indent / 16);
      }
    }
  });
  return html;
}

