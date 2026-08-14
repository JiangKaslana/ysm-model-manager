// ===== import-queue-render.ts —— 渲染逻辑（纯函数化）=====
import { RESOURCE_TYPES } from "../utils/resource/types.ts";
import { renderFormattedText } from "../utils/format/mc-format.ts";
import { getApp } from "../backend/app.ts";
import { showRenameDialog } from "../utils/dom/dialogs/rename.ts";
import { friendlyError } from "../utils/dom/errors.ts";
import { bus } from "../bus.ts";
import { t } from "../core/i18n/t.ts";
import { ImportHistory } from "./import-executor.ts";
import type { ImportFile, QueueItem } from "./import-queue-data.ts";

/**
 * 渲染已导入列表（含队列）
 * 纯函数：根据传入数据生成 HTML 并更新 DOM
 */
export function renderImportedList(
  root: ShadowRoot,
  importedList: HTMLElement,
  esc: (s: string) => string,
  currentFile: ImportFile | null,
  fileQueue: QueueItem[],
  repoFiles: Set<string> | null,
): void {
  let html = "";
  ImportHistory.records.forEach((item) => {
    html +=
      '<div style="display:flex;align-items:center;gap:4px;padding:2px 4px;border-radius:3px;font-size:10px;border:1px solid var(--bd)">' +
      '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--txt)">' +
      renderFormattedText(item.name) +
      "</span>" +
      '<span style="font-size:9px;color:var(--muted);flex-shrink:0">' +
      (item.time || "") +
      "</span>" +
      (item.isYsm !== false
        ? '<button class="dl-reimport" data-name="' +
          esc(item.name) +
          '" style="padding:1px 5px;border-radius:3px;border:1px solid var(--bd);background:transparent;color:var(--accent);cursor:pointer;font-size:9px">✂️</button>'
        : "") +
      "</div>";
  });
  fileQueue.forEach((fq, qi) => {
    const isEditing = currentFile === fq.file;
    html +=
      '<div class="dl-q-item" data-idx="' +
      qi +
      '" style="display:flex;align-items:center;gap:4px;padding:2px 4px;border-radius:3px;font-size:10px;border:1px ' +
      (isEditing ? "solid" : "dashed") +
      " var(--bd);background:" +
      (isEditing ? "var(--hover)" : "var(--surf)") +
      ';cursor:pointer">' +
      '<span style="color:var(--muted);font-size:9px">' +
      (isEditing
        ? "✏️"
        : repoFiles?.has(fq.name.replace(/\.\w+$/, ""))
          ? "⚠️"
          : "⏳") +
      "</span>" +
      '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--txt)">' +
      renderFormattedText(fq.name) +
      "</span>" +
      '<button class="dl-remove-q" data-idx="' +
      qi +
      '" style="padding:1px 6px;border-radius:3px;border:1px solid color-mix(in srgb, var(--status-error) 27%, transparent);background:transparent;color:var(--status-error);cursor:pointer;font-size:9px;flex-shrink:0">' +
      "🗑" +
      "</button>" +
      "</div>";
  });
  if (!html)
    html =
      '<div style="font-size:var(--fs-sm);color:var(--muted);padding:4px">' +
      t("importQueue.noFiles") +
      "</div>";
  importedList.innerHTML = html;
}

/**
 * 渲染后绑定队列相关事件
 * 返回 cleanup 函数集合
 */
export function bindQueueEvents(
  importedList: HTMLElement,
  fileQueue: QueueItem[],
  currentFileRef: { current: ImportFile | null },
  currentBase64Ref: { current: string | null },
  advanceQueue: () => void,
  renderImportedListFn: () => void,
  isImportingRef: { current: boolean },
  toggleForm: (visible: boolean) => void,
): Array<() => void> {
  const cleanups: Array<() => void> = [];

  // 已导入的重命名按钮
  importedList.querySelectorAll(".dl-reimport").forEach((btn) => {
    const handler = async () => {
      if (isImportingRef.current) return;
      isImportingRef.current = true;
      try {
        const name = (btn as HTMLElement).dataset.name || "";
        const { RenameFile, GetRepoRoot } = await getApp();
        const filesRoot = await GetRepoRoot(RESOURCE_TYPES.YSM);
        const fullPath = filesRoot + "/" + name;
        const newName = await showRenameDialog(fullPath, name);
        if (!newName) return;
        try {
          await RenameFile(fullPath, newName);
          ImportHistory.rename(name, newName);
          renderImportedListFn();
          bus.emit("stats:refresh");
          bus.emit("tree:reload");
        } catch (e) {
          bus.emit("toast:show", {
            msg: "❌ " + friendlyError(e),
            duration: 3000,
            type: "error",
          });
        }
      } catch (e) {
        bus.emit("toast:show", {
          msg: "❌ " + friendlyError(e),
          duration: 4000,
          type: "error",
        });
      } finally {
        isImportingRef.current = false;
      }
    };
    btn.addEventListener("click", handler);
    cleanups.push(() => btn.removeEventListener("click", handler));
  });

  // 队列行点击 → 设置为当前编辑项
  importedList.querySelectorAll(".dl-q-item").forEach((rowEl) => {
    const row = rowEl as HTMLElement;
    const handler = (e: MouseEvent) => {
      if (isImportingRef.current) return;
      if ((e.target as Element).closest(".dl-remove-q")) return;
      const qi = parseInt(row.dataset.idx || "", 10);
      const fq = fileQueue[qi];
      if (!fq) return;
      currentFileRef.current = fq.file;
      currentBase64Ref.current = fq.base64;
      advanceQueue();
      renderImportedListFn();
    };
    row.addEventListener("click", handler);
    cleanups.push(() => row.removeEventListener("click", handler));
  });

  // 队列移除
  importedList.querySelectorAll(".dl-remove-q").forEach((btnEl) => {
    const btn = btnEl as HTMLElement;
    const handler = (e: MouseEvent) => {
      e.stopPropagation();
      const qi = parseInt(btn.dataset.idx || "", 10);
      fileQueue.splice(qi, 1);
      if (fileQueue.length === 0) {
        currentFileRef.current = null;
        currentBase64Ref.current = null;
        // 修复：队列清空后恢复拖拽区（拆分时 toggleForm 联动丢失——
        // 用户清空队列后停留在表单视图，drop 区永不恢复）
        toggleForm(false);
      } else if (
        currentFileRef.current &&
        fileQueue.every((fq) => fq.file !== currentFileRef.current)
      ) {
        // 陷阱 #13 修复（幽灵状态）：当前编辑项被移除且队列非空 → 走 advanceQueue
        // （内部 showForm 统一刷新 currentFile*/currentFileName/currentRelPath 与表单字段）。
        // 原实现只刷 currentFile/currentBase64，currentFileName/currentRelPath 残留被删文件
        // 的旧值——再点导入会用错文件名/子路径提交新文件
        advanceQueue();
      }
      renderImportedListFn();
    };
    btn.addEventListener("click", handler);
    cleanups.push(() => btn.removeEventListener("click", handler));
  });

  return cleanups;
}

/**
 * 更新队列计数显示
 */
export function updateQueueCount(
  dlQueueCount: HTMLElement | null,
  dlCount: HTMLElement | null,
  fileQueue: QueueItem[],
): void {
  if (dlQueueCount) dlQueueCount.textContent = String(fileQueue.length);
  if (dlCount)
    dlCount.textContent =
      ImportHistory.records.length +
      " 个已导入" +
      (fileQueue.length ? " · " + fileQueue.length + " 个待处理" : "");
}
