// ===== 当前仓库资源类型订阅（索引 4.3 收敛）=====
// 收敛 oldest-models / recycle-bin（+ views/init-pages 第三处）各自手写的
// `safeGet("repo_rtype") || RESOURCE_TYPES.YSM` + `bus.on("repo:rtype-changed")`
// 同模式：初值取 localStorage（持久化权威源，由 app-nav 写入）；运行期以事件
// 载荷为准，类型变化（与当前不同）时更新并触发 onChange（事件是唯一运行期变更入口，
// 二者一致时不重复加载）。

import { bus } from "../bus.ts";
import { safeGet } from "../utils/dom/storage.ts";
import { RESOURCE_TYPES } from "../utils/resource/types.ts";

/**
 * 订阅当前仓库资源类型。
 * @param onChange 类型变化回调（组件重载入口，如 render / loadRecycleBin）
 * @returns { get, cleanup } — get() 读当前类型（初值 + 事件更新后的最新值）；
 *   cleanup() 移除订阅（组件销毁时调用，防迟到响应/泄漏）
 */
export function useCurrentResourceType(onChange: () => void): {
  get: () => string;
  cleanup: () => void;
} {
  let currentType = safeGet("repo_rtype") || RESOURCE_TYPES.YSM;
  const unsub = bus.on("repo:rtype-changed", (rt) => {
    if (rt && rt !== currentType) {
      currentType = rt;
      onChange();
    }
  });
  return {
    get: () => currentType,
    cleanup: () => {
      if (unsub) unsub();
    },
  };
}
