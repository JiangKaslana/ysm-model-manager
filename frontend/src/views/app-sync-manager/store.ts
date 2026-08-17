// ===== app-sync-manager 数据层（store） =====
// 职责：数据加载（类型配置 + 同步状态）与筛选
// 纯函数，接收组件实例 self，通过 self 读写状态；无 DOM / 无 bus 副作用。
// 依赖 DAG：index → store ← network（网络操作后调 loadData 刷新）

import { getApp } from "../../backend/app.ts";
import { bus } from "../../bus.ts";
import { RESOURCE_TYPES } from "../../utils/resource/types.ts";
import type { SyncItem } from "./tpl.ts";

const TOAST_MS_NORMAL = 3000;

// 组件实例接口（store 只关心数据态，不关心 DOM/事件）
interface SyncStoreSelf {
  _gen: number;
  _instance: string;
  _selectedType: string;
  _statusFilter: string;
  _allItems: SyncItem[];
  _filteredItems: SyncItem[];
  _typeConfig: Array<{ id: string; name?: string; icon?: string }>;
  _loading: boolean;
  isConnected?: boolean;
}

/**
 * 加载资源类型配置（LoadResourceTypes）
 * 过期代际/已卸载静默丢弃；加载失败 toast 提醒 + 空数组降级。
 */
export async function loadTypeConfig(self: SyncStoreSelf): Promise<void> {
  const gen = self._gen;
  try {
    const { LoadResourceTypes } = await getApp();
    const raw = await LoadResourceTypes();
    const parsed = JSON.parse(raw) as { resourceTypes?: Array<{ id: string; name?: string; icon?: string }> };
    if (gen !== self._gen) return;
    self._typeConfig = parsed.resourceTypes || [];
  } catch {
    if (gen !== self._gen || !self.isConnected) return;
    self._typeConfig = [];
    bus.emit("toast:show", {
      msg: "⚠️ 资源类型配置加载失败",
      duration: TOAST_MS_NORMAL,
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
    const json = await GetInstanceSyncStatus(self._instance);
    if (gen !== self._gen) return;
    self._allItems = (JSON.parse(json) as SyncItem[]) || [];
  } catch {
    if (gen !== self._gen) return;
    self._allItems = [];
    bus.emit("toast:show", {
      msg: "⚠️ 同步状态加载失败",
      duration: TOAST_MS_NORMAL,
      type: "warn",
    });
  }
}

/**
 * 应用类型 + 状态筛选，写入 self._filteredItems。
 */
export function applyFilter(self: SyncStoreSelf): void {
  let items = self._allItems;
  if (self._selectedType) {
    items = items.filter((i) => i.type === self._selectedType);
  }
  if (self._statusFilter !== "all") {
    items = items.filter((i) => i.status === self._statusFilter);
  }
  self._filteredItems = items;
}
