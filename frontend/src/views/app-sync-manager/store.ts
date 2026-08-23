// ===== app-sync-manager 数据层（store） =====
// 职责：数据加载（类型配置 + 同步状态）与筛选
// 纯函数，接收组件实例 self，通过 self 读写状态；无 DOM / 无 bus 副作用。
// 依赖 DAG：index → store ← network（网络操作后调 loadData 刷新）

import { getApp } from "../../backend/app.ts";
import { bus } from "../../bus.ts";
import { RESOURCE_TYPES } from "../../utils/resource/types.ts";
import { TOAST_MS } from "../../utils/dom/toast-ms.ts";
import type { SyncManagerSelf } from "./index.ts";
import type { SyncItem } from "./tpl.ts";

export type SyncStoreSelf = SyncManagerSelf;

/**
 * 加载资源类型配置（LoadResourceTypes）
 * 过期代际/已卸载静默丢弃；加载失败 toast 提醒 + 空数组降级。
 */
export async function loadTypeConfig(self: SyncStoreSelf): Promise<void> {
  const gen = self._gen;
  try {
    const { LoadResourceTypes } = await getApp();
    const raw = await LoadResourceTypes();
    const parsed = JSON.parse(raw) as { resourceTypes?: Array<{ id: string; name?: string; icon?: string; dirLevelSync?: boolean }> };
    if (gen !== self._gen) return;
    self._typeConfig = parsed.resourceTypes || [];
  } catch {
    if (gen !== self._gen || !self.isConnected) return;
    self._typeConfig = [];
    bus.emit("toast:show", {
      msg: "⚠️ 资源类型配置加载失败",
      duration: TOAST_MS.normal,
      type: "warn",
    });
  }
}

/**
 * 加载实例同步状态（GetInstanceSyncStatus）
 * 过期代际丢弃；加载失败 toast 提醒 + 空数组。
 */
export async function loadData(self: SyncStoreSelf): Promise<void> {
  const gen = self._gen;
  try {
    const { GetInstanceSyncStatus } = await getApp();
    const json = await GetInstanceSyncStatus(self._instance, self._subtype || "");
    if (gen !== self._gen) return;
    self._allItems = (JSON.parse(json) as SyncItem[]) || [];
  } catch {
    if (gen !== self._gen) return;
    self._allItems = [];
    bus.emit("toast:show", {
      msg: "⚠️ 同步状态加载失败",
      duration: TOAST_MS.normal,
      type: "warn",
    });
  }
}

/**
 * 应用类型 + 状态筛选，写入 self._filteredItems。
 * 子目录过滤已由后端路径限定处理（GetInstanceSyncStatus 走 subtype 参数），
 * 前端不再需要 MMD 子目录过滤——回归事实源（resource_types.json subtype.instanceDir）。
 */
export function applyFilter(self: SyncStoreSelf): void {
  let items = self._allItems;
  if (self._selectedType) {
    items = items.filter((i) => i.type === self._selectedType);
  }
  if (self._statusFilter !== "all") {
    const filter = self._statusFilter;
    items = items.filter((i) => {
      // diverged 状态在 missing tab 下显示（继承可操作属性）
      if (filter === "missing" && i.status === "diverged") return true;
      return i.status === filter;
    });
  }
  self._filteredItems = items;
}
