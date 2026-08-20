// ===== app-sync-manager 渲染层（renderer） =====
// 职责：纯 DOM 渲染——类型标签 / 状态标签 / 列表 / 空态 / 加载态
// 不处理数据加载、不绑事件、不调用 Go 桥接。
// 依赖 DAG：index → renderer ← events（events 点击触发 render）

import { RESOURCE_TYPES, RESOURCE_TYPE_LABELS, MMD_SUBTYPES } from "../../utils/resource/types.ts";
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
  // ADR-095 后续：MMD 按用途子目录分组展示（角色/场景/动画…分开，不再平铺一锅）。
  // 子目录来自 Go 侧 ResourceSyncItem.SubDir（BuildSyncItems 按注册表 subtypes 判定填充，
  // ADR-104）；根下条目 SubDir="" 归 EntityPlayer 默认槽组。
  // 组序/标签均来自注册表派生的 MMD_SUBTYPES（userImportable 过滤 6 项）。
  if (self._selectedType === RESOURCE_TYPES.MMD) {
    listEl.innerHTML = renderMMDGroups(self._filteredItems);
    return;
  }
  // dirLevelSync 类型（ysm / create-blueprint / maid-model / vrchat-avatar…）：
  // 按路径天然层级展示（文件夹=SyncItem 本身，展开后扫仓库子条目显示内部文件）。
  // 无仓库根时兜底走平铺（repoRoot 加载失败不阻断列表）。
  if (isDirLevelSync(self)) {
    if (!self._repoRoots[self._selectedType]) {
      listEl.innerHTML = self._filteredItems.map((it, i) => itemHTML(it, i)).join("");
    } else {
      listEl.innerHTML = await renderSyncTree(self, self._filteredItems);
    }
    return;
  }
  // fileLevel 类型（resourcepack / shaderpack…）：保持平铺
  listEl.innerHTML = self._filteredItems.map((it, i) => itemHTML(it, i)).join("");
}

// ===== dirLevelSync 层级展示（ysm / create-blueprint / maid-model / vrchat-avatar…）=====
// 文件夹 = SyncItem 本身；展开后 ScanModelEntriesWithLabel 扫仓库子目录，显示内部文件。
// 层级由路径天然分段（与 app-tree buildTree 同构），不再按 rtype 逐个特判。

interface SyncTreeNode {
  sync?: SyncItem;      // 有值 = 文件夹行（带状态 + 操作按钮）
  file?: SyncItem;      // 有值 = 文件行（复用 itemHTML）
  files?: Array<{ name: string; path: string; size: number }>;
  [key: string]: SyncTreeNode | SyncItem | Array<{ name: string; path: string; size: number }> | undefined;
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

/** 从仓库根扫描某个路径下的子条目（dir-level 展开用）；失败静默返回 [] */
async function scanSubEntries(repoRoot: string, rtype: string, relPath: string): Promise<Array<{ name: string; path: string; size: number }>> {
  try {
    const { ScanModelEntriesWithLabel } = await getApp();
    const dir = repoRoot.replace(/\\/g, "/") + "/" + relPath.replace(/^[/\\]+/, "").replace(/\\/g, "/");
    const raw = (await ScanModelEntriesWithLabel(dir, RESOURCE_TYPE_LABELS[rtype] || rtype)) as Array<{
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

/** 将 SyncItems 拼成嵌套树（文件夹 = dirLevel 项本身；文件 = Scan 子条目） */
function buildSyncTree(
  items: SyncItem[],
  scanned: Record<string, Array<{ name: string; path: string; size: number }>>,
): SyncTreeNode {
  const root: SyncTreeNode = {};
  const pathOf = (it: SyncItem): string =>
    (it.path || "").replace(/\\/g, "/").replace(/^[/\\]+/, "");
  for (const it of items) {
    const p = pathOf(it);
    if (!p) continue;
    const parts = p.split("/").filter(Boolean);
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      if (!node[seg] || (node[seg] as SyncTreeNode).file) {
        node[seg] = {};
      }
      node = (node[seg] as SyncTreeNode);
    }
    const last = parts[parts.length - 1];
    if (!last) continue;
    const files = scanned[p];
    node[last] = {
      sync: it,
      files: files?.map((f) => ({
        name: f.name,
        path: p + "/" + f.name,
        size: f.size,
      })) || [],
    };
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
      if (dirOpen[key]) {
        if (v.files && v.files.length) {
          for (const f of v.files) {
            // 子文件继承父 SyncItem 的状态（用于 itemHTML 渲染），补 fileName/fileSize
            rows.push({
              type: "file",
              key: key + "/" + f.name,
              sync: v.sync,
              fileName: f.name,
              fileSize: f.size,
              indent: (depth + 1) * 16 + 10,
            });
          }
        }
      }
    } else if (v.file) {
      rows.push({ type: "file", key, sync: v.file, indent: depth * 16 + 10 });
    } else {
      rows.push(...flattenSyncTree(v, dirOpen, depth + 1, key));
    }
  }
  return rows;
}

/** 渲染 dirLevelSync 层级列表（文件夹行带状态/按钮；展开后扫描显示内部文件） */
async function renderSyncTree(self: SyncRenderSelf, items: SyncItem[]): Promise<string> {
  if (!items.length) return "";
  const repoRoot = self._repoRoots[self._selectedType] || "";
  const rtype = self._selectedType || "";
  const dirOpen = self._dirOpen || {};
  const scanned: Record<string, Array<{ name: string; path: string; size: number }>> = {};
  await Promise.all(
    items.map(async (it) => {
      const p = (it.path || "").replace(/\\/g, "/");
      if (!p) return;
      if (dirOpen[p] && it.status === "synced" && repoRoot) {
        scanned[p] = await scanSubEntries(repoRoot, rtype, p);
      }
    }),
  );
  const tree = buildSyncTree(items, scanned);
  const rows = flattenSyncTree(tree, dirOpen, 0, "");
  let html = "";
  rows.forEach((r, i) => {
    if (r.type === "dir" && r.sync) {
      const shouldOpen = dirOpen[r.key] === true;
      html += syncDirRowHTML(r.key, r.sync, shouldOpen, i);
    } else if (r.type === "file" && r.sync) {
      // 子文件行：用父 SyncItem 的状态渲染，但 name 用 fileName、size 用 fileSize
      const subFile: SyncItem = {
        path: r.key,
        name: r.fileName || r.sync.name,
        status: "synced",      // 子文件本身不参与同步判定，统一 synced 外观
        type: r.sync.type,
        icon: "📄",
        size: r.fileSize || r.sync.size,
      };
      const fileRow = itemHTML(subFile, i);
      html += fileRow.replace('class="sm-item" data-path=', 'class="sm-item sm-file" data-path=');
    }
  });
  return html;
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
