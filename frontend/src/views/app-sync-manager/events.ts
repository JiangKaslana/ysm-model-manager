// ===== app-sync-manager 事件层（events） =====
// 职责：DOM 事件绑定（类型标签 / 状态标签 / 单行按钮）
// 纯事件注册，不含业务逻辑；通过回调触发渲染 / 网络 / 同步。
// 依赖 DAG：index → events → network（单行按钮触发 push/pull）
// events ←→ network 无循环：events 通过回调调用 network

import type { SyncManagerSelf } from "./index.ts";

export type EventSelf = SyncManagerSelf;

interface EventCallbacks {
  doRender: () => void;
  doSyncRM: () => void;
  doPerformOp: (op: "push" | "pull", path: string) => Promise<void>;
}

/** 绑定所有 DOM 事件（状态筛选 / 单行操作按钮） */
export function bindEvents(self: EventSelf, cb: EventCallbacks): void {
  // 状态标签切换
  self.querySelectorAll(".sm-status-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      self._statusFilter = (btn as HTMLElement).dataset.status || "all";
      cb.doRender();
    });
  });

  // 单行按钮（push / pull）
  self.querySelectorAll(".sm-item-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const row = (e.currentTarget as HTMLElement).closest("[data-path]");
      if (!row) return;
      const path = (row as HTMLElement).dataset.path || "";
      const action = (btn as HTMLElement).dataset.action;
      if (action === "push") cb.doPerformOp("push", path);
      else if (action === "pull") cb.doPerformOp("pull", path);
    });
  });
}
