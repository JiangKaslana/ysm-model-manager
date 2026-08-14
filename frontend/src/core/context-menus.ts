// ===== 右键菜单映射（类型化版 — ADR-014 P3 core 收官；ADR-021 B 层声明式化）=====
// 将 ctx:show 事件转换为新版组件使用的 menu:show 事件
// 菜单结构来自 menu-defs.ts（唯一事实来源），此处只保留 orchestrator。
import { bus, type CtxShowPayload, type MenuItem } from "../bus.ts";
import { isViewerMode } from "../utils/dom/android-bridge.ts";
import { getMenuDef } from "./menu-defs";
// P1 修复（ADR-040）：handler 表已拆至 context-menu-handlers.ts；此处仅消费 HANDLERS，
// 不再 re-export 其余共享符号（无外部消费者，消除死代码）
import { HANDLERS } from "./context-menu-handlers.ts";
type MenuCtx = import("./context-menu-handlers.ts").MenuCtx;

// 查看器模式（Android/网页版 ADR-049）下仍可用的纯前端右键菜单动作：
// 其余 action 均调 Wails binding（重命名/移动/复制/回收站/打开位置/推送整合包/
// 新建子目录/标签编辑等），查看器模式无本地文件系统写能力，一律隐藏。
const VIEWER_OK_ACTIONS = new Set([
  "noop",
  "batch.copy-paths",
  "batch.export-list",
  "file.copy-path",
]);

function buildMenuItems(ctx: CtxShowPayload): MenuItem[] {
  const def = getMenuDef(ctx.type);
  if (!def) return [];
  const paths = ctx.paths || [];
  const norm: MenuCtx = { ...ctx, paths };
  const isViewer = isViewerMode();
  // 查看器模式（Android/网页版）：过滤掉调 Wails binding 的桌面专属菜单项，
  // 仅保留纯前端可用动作（VIEWER_OK_ACTIONS）。连续 divider 会在渲染时折叠，无需此处去重。
  const items = def.items.filter((item) => {
    if (item.divider) return true;
    if (!item.action) return true;
    return !isViewer || VIEWER_OK_ACTIONS.has(item.action);
  });
  return items.map((item) => {
    if (item.divider) return { divider: true };
    const label = typeof item.label === "function" ? item.label(norm) : item.label;
    const action = item.action;
    const handler = action ? HANDLERS[action] : undefined;
    if (action && !handler) {
      // menu-defs.ts 的 action 与 HANDLERS 表键失配（测试应断言零警告）
      console.warn(`[context-menus] 未注册 action: ${action}（见 menu-defs.ts）`);
    }
    const out: MenuItem = {
      action,
      label,
      onClick: handler ? () => handler(norm) : undefined,
    };
    if (item.icon) out.icon = item.icon;
    if (item.danger) out.danger = true;
    return out;
  });
}

/** 注册右键菜单映射（ctx:show → menu:show）；由 registerGlobalHandlers 统一调用，unsub 收集进 unsubs 清理 */
export function registerContextMenus(unsubs: Array<() => void>): void {
  unsubs.push(
    bus.on("ctx:show", (payload) => {
      bus.emit("menu:show", {
        x: payload.x,
        y: payload.y,
        items: buildMenuItems(payload),
      });
    }),
  );
}
