// ===== app-sync-manager 共享状态（state） =====
// 职责：跨模块共享的持久化状态（上次选中类型）。
// 从 index.ts 下沉：打破 index → events → index 循环依赖
// （events 与 index 均从本模块导入，DAG 变为 index → events → state / index → state）
import { safeGet } from "../../utils/dom/storage.ts";
import { RESOURCE_TYPES } from "../../utils/resource/types.ts";

// P3 修复（子代理审计）：模块顶层裸调 localStorage——改 safeGet
export const LAST_TYPE_KEY = "ysm_syncLastType";
export let _lastSelectedType = safeGet(LAST_TYPE_KEY) || RESOURCE_TYPES.YSM;
export function setLastSelectedType(type: string): void {
  _lastSelectedType = type;
}