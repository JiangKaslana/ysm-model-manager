// ===== import-queue-events.ts —— 事件绑定层 =====
import { resolveWebMode } from "../backend/platform.ts";
import { importWebFiles } from "../backend/browser-adapter.ts";
import { bus } from "../bus.ts";
import { t } from "../core/i18n/t.ts";
import { RESOURCE_TYPES } from "../utils/resource/types.ts";
import { ALL_EXTS } from "../utils/resource/extensions.ts";
import { isImportableFile } from "./dnd-shared.ts";
import { ImportHistory } from "./import-executor.ts";
import type { ImportFile, QueueItem } from "./import-queue-data.ts";

/** 事件绑定工具：收集 cleanup 函数 */
function on<K extends keyof HTMLElementEventMap>(
  el: HTMLElement,
  type: K,
  handler: (ev: HTMLElementEventMap[K]) => void,
  cleanups: Array<() => void>,
): void {
  el.addEventListener(type, handler as EventListener);
  cleanups.push(() => el.removeEventListener(type, handler as EventListener));
}

/** 表单输入事件绑定 */
export function bindFormEvents(
  root: ShadowRoot,
  updatePreview: () => void,
  loadHeaderFromBase64: () => Promise<void>,
  cleanups: Array<() => void>,
): void {
  ["dl-author", "dl-work", "dl-chara", "dl-variant", "dl-date"].forEach(
    (id) => {
      const el = root.getElementById(id);
      if (el) on(el, "input", updatePreview, cleanups);
    },
  );
  const dateAutoEl = root.getElementById("dl-date-auto");
  if (dateAutoEl) on(dateAutoEl, "change", updatePreview, cleanups);

  const fromHeaderChk = root.getElementById(
    "dl-from-header",
  ) as HTMLInputElement | null;
  if (fromHeaderChk) {
    on(fromHeaderChk, "change", async () => {
      if (fromHeaderChk.checked) {
        await loadHeaderFromBase64();
      } else {
        const tipsEl = root.getElementById("dl-tips") as HTMLElement | null;
        if (tipsEl) tipsEl.style.display = "none";
      }
    }, cleanups);
  }
}

/** 拖拽事件绑定 */
export function bindDragEvents(
  dropZone: HTMLElement,
  fileInput: HTMLInputElement,
  folderInput: HTMLInputElement,
  readAndRouteFile: (file: ImportFile, onDone?: () => void) => void,
  processDropItems: (items: DataTransferItemList) => void,
  updateQueueCount: () => void,
  cleanups: Array<() => void>,
): void {
  const extsStr = ALL_EXTS.join(" ");

  // 拖拽事件 — 区域内独立处理，阻止冒泡到全局 handler
  on(dropZone, "dragover", (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.style.borderColor = "var(--accent)";
  }, cleanups);

  on(dropZone, "dragleave", (e: DragEvent) => {
    e.stopPropagation();
    dropZone.style.borderColor = "";
  }, cleanups);

  on(dropZone, "drop", (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.style.borderColor = "";
    // 网页版（ADR-049 Phase 3）：无本地文件系统 → 拖入文件直接写入 IndexedDB 模型库
    if (resolveWebMode()) {
      const files = e.dataTransfer?.files;
      if (!files?.length) {
        bus.emit("toast:show", {
          msg: "⚠️ 网页版暂不支持文件夹导入，请拖入 .ysm 等模型文件",
          duration: 4000,
          type: "warn",
        });
        return;
      }
      void (async () => {
        try {
          const r = await importWebFiles(Array.from(files), RESOURCE_TYPES.YSM);
          bus.emit("toast:show", {
            msg:
              r.failed > 0
                ? `✅ ${r.imported} 个导入成功，${r.failed} 个失败`
                : `✅ ${r.imported} 个模型已导入浏览器模型库`,
            duration: 4000,
            type: r.failed > 0 ? "warn" : "success",
          });
          bus.emit("tree:reload");
          bus.emit("stats:refresh");
        } catch (e) {
          bus.emit("toast:show", {
            msg: "❌ " + t("import.processError") + ": " + String(e),
            duration: 4000,
            type: "error",
          });
        }
      })();
      return;
    }
    const items = e.dataTransfer?.items;
    if (items?.length) {
      processDropItems(items);
    } else {
      const files = e.dataTransfer?.files;
      if (!files?.length) return;
      let ok = 0;
      let skip = 0;
      Array.from(files).forEach((file) => {
        if (!isImportableFile(file.name)) {
          skip++;
          return;
        }
        ok++;
        readAndRouteFile(file);
      });
      if (ok === 0 && skip > 0) {
        bus.emit("toast:show", {
          msg: "⚠️ " + t("import.unsupportedFormat") + " " + extsStr,
          duration: 4000,
          type: "warn",
        });
      }
      updateQueueCount();
    }
  }, cleanups);

  // 点击：普通点击选文件，Ctrl+点击选文件夹
  let clickLocked = false;
  on(dropZone, "click", (e: MouseEvent) => {
    if (clickLocked) return;
    clickLocked = true;
    setTimeout(() => {
      clickLocked = false;
    }, 500);
    if (e.ctrlKey || e.metaKey) {
      folderInput.click();
    } else {
      fileInput.click();
    }
  }, cleanups);
}

/** 文件输入框事件绑定 */
export function bindInputEvents(
  fileInput: HTMLInputElement,
  folderInput: HTMLInputElement,
  readAndRouteFile: (file: ImportFile, onDone?: () => void) => void,
  routeCollected: (collected: Array<{ file: ImportFile; relPath: string }>) => Promise<void>,
  updateQueueCount: () => void,
  cleanups: Array<() => void>,
): void {
  const extsStr = ALL_EXTS.join(" ");

  on(fileInput, "change", () => {
    const files = fileInput.files;
    if (!files || !files.length) return;
    // 网页版：文件选择器（点击 dropZone 触发）→ importWebFiles 直写 IndexedDB
    if (resolveWebMode()) {
      void (async () => {
        try {
          const r = await importWebFiles(Array.from(files), RESOURCE_TYPES.YSM);
          bus.emit("toast:show", {
            msg:
              r.failed > 0
                ? `✅ ${r.imported} 个导入成功，${r.failed} 个失败`
                : `✅ ${r.imported} 个模型已导入浏览器模型库`,
            duration: 4000,
            type: r.failed > 0 ? "warn" : "success",
          });
          bus.emit("tree:reload");
          bus.emit("stats:refresh");
        } catch (e) {
          bus.emit("toast:show", {
            msg: "❌ " + t("import.processError") + ": " + String(e),
            duration: 4000,
            type: "error",
          });
        } finally {
          fileInput.value = "";
        }
      })();
      return;
    }
    let ok = 0;
    let skip = 0;
    Array.from(files).forEach((file) => {
      if (!isImportableFile(file.name)) {
        skip++;
        return;
      }
      ok++;
      readAndRouteFile(file);
    });
    updateQueueCount();
    if (ok === 0 && skip > 0) {
      bus.emit("toast:show", {
        msg: "⚠️ " + t("import.unsupportedFormat") + " " + extsStr,
        duration: 4000,
        type: "warn",
      });
    }
    fileInput.value = "";
  }, cleanups);

  on(folderInput, "change", () => {
    const files = folderInput.files;
    if (!files || !files.length) return;
    // 网页版（ADR-049 Phase 3）：无本地文件系统 → 文件夹选择直接写入 IDB 模型库
    if (resolveWebMode()) {
      void (async () => {
        try {
          const r = await importWebFiles(Array.from(files), RESOURCE_TYPES.YSM);
          bus.emit("toast:show", {
            msg:
              r.failed > 0
                ? `✅ ${r.imported} 个导入成功，${r.failed} 个失败`
                : `✅ ${r.imported} 个模型已导入浏览器模型库`,
            duration: 4000,
            type: r.failed > 0 ? "warn" : "success",
          });
          bus.emit("tree:reload");
        } catch (err) {
          bus.emit("toast:show", {
            msg: "❌ 网页版导入失败: " + String(err),
            duration: 4000,
            type: "error",
          });
        }
      })();
      folderInput.value = "";
      return;
    }
    // webkitdirectory 的 File 带 webkitRelativePath（保留层级），构造 relPath 后走统一路由
    const byRel = Array.from(files).map((file) => ({
      file: file as ImportFile,
      relPath: (file as File & { webkitRelativePath?: string })
        .webkitRelativePath || file.name,
    }));
    routeCollected(byRel).then(() => {
      updateQueueCount();
      if (files.length > 0) {
        bus.emit("toast:show", {
          msg: `📁 ${t("import.addedToQueue", { n: files.length })}`,
          duration: 2000,
          type: "success",
        });
      }
    }).catch((e) => {
      bus.emit("toast:show", {
        msg: "❌ " + t("import.folderImportFailed") + ": " + String(e),
        duration: 4000,
        type: "error",
      });
    });
    folderInput.value = "";
  }, cleanups);
}

/** 按钮事件绑定 */
export function bindButtonEvents(
  root: ShadowRoot,
  importBtn: HTMLElement | null,
  cancelBtn: HTMLElement | null,
  clearListBtn: HTMLElement | null,
  currentFileRef: { current: ImportFile | null },
  currentBase64Ref: { current: string | null },
  currentFileNameRef: { current: string | null },
  currentRelPathRef: { current: string },
  fileQueue: QueueItem[],
  isImportingRef: { current: boolean },
  renderImportedList: () => void,
  advanceQueue: () => void,
  toggleForm: (visible: boolean) => void,
  loadRepoFiles: () => Promise<void>,
  cleanups: Array<() => void>,
): void {
  if (importBtn) {
    const handler = async () => {
      if (isImportingRef.current) return;
      isImportingRef.current = true;
      const editing = {
        file: currentFileRef.current,
        base64: currentBase64Ref.current,
        name: currentFileNameRef.current,
        relPath: currentRelPathRef.current,
      };
      try {
        const a = (root.getElementById("dl-author") as HTMLInputElement).value.trim();
        const w = (root.getElementById("dl-work") as HTMLInputElement).value.trim();
        const c = (root.getElementById("dl-chara") as HTMLInputElement).value.trim();
        const v = (root.getElementById("dl-variant") as HTMLInputElement).value.trim();
        const manualDate = (root.getElementById("dl-date") as HTMLInputElement).value.trim();
        const autoOn = (root.getElementById("dl-date-auto") as HTMLInputElement).checked;
        const d =
          manualDate ||
          (autoOn
            ? new Date().getFullYear() +
              "-" +
              String(new Date().getMonth() + 1).padStart(2, "0")
            : "");
        const ext = editing.name?.split(".").pop() || "ysm";

        let newName: string;
        if (c) {
          const { buildRenameName } = await import("../utils/dom/dialogs/rename-format.ts");
          newName = buildRenameName(
            { author: a, work: w, chara: c, variant: v, date: d },
            ext,
          );
        } else {
          newName = editing.name || "untitled." + ext;
        }

        let finalName = "";
        try {
          const { getApp } = await import("../backend/app.ts");
          const app = await getApp();
          const { LoadAppConfig, ImportModelFileTo } = app;
          const cfg = await LoadAppConfig();
          if (!cfg.filesRoot) {
            bus.emit("toast:show", {
              msg: t("import.configureStorage"),
              duration: 4000,
              type: "warn",
            });
            return;
          }
          const subpath = editing.relPath
            ? editing.relPath.substring(0, editing.relPath.lastIndexOf("/"))
            : "";
          const { showRenameDialog } = await import("../utils/dom/dialogs/rename.ts");
          const renameTo = await showRenameDialog(null, newName);
          if (!renameTo) {
            bus.emit("toast:show", {
              msg: t("import.cancelled"),
              duration: 2000,
              type: "info",
            });
            return;
          }
          finalName = renameTo;

          await ImportModelFileTo(finalName, subpath, editing.base64 || "");
          bus.emit("stats:refresh");
          bus.emit("tree:reload");

          bus.emit("toast:show", {
            msg: `✅ ${t("import.imported")}: ` + finalName,
            duration: 3000,
            type: "success",
          });
          await loadRepoFiles();

          ImportHistory.push({
            name: finalName,
            time: new Date().toLocaleTimeString(),
            isYsm: true,
            relPath: editing.relPath,
          });
          const importedIdx = fileQueue.findIndex((fq) => fq.file === editing.file);
          if (importedIdx >= 0) fileQueue.splice(importedIdx, 1);
          renderImportedList();

          currentFileRef.current = null;
          currentBase64Ref.current = null;
          currentFileNameRef.current = null;
          currentRelPathRef.current = "";
          advanceQueue();
        } catch (e) {
          const errMsg = String(e);
          if (errMsg.includes("FILE_EXISTS") || errMsg.includes("文件已存在")) {
            const { modalConfirm } = await import("../utils/dom/dialogs/modal.ts");
            const confirmed = await modalConfirm({
              title: "文件已存在",
              icon: "📦",
              message: `"${finalName}" 已存在，是否覆盖？`,
              okText: "覆盖",
              danger: true,
            }).catch(() => false);
            if (confirmed) {
              try {
                const { getApp } = await import("../backend/app.ts");
                const app = await getApp();
                const { ImportModelFileOverwriteTo } = app;
                const subpath2 = editing.relPath
                  ? editing.relPath.substring(0, editing.relPath.lastIndexOf("/"))
                  : "";
                await ImportModelFileOverwriteTo(finalName, subpath2, editing.base64 || "");
                bus.emit("stats:refresh");
                bus.emit("tree:reload");
                bus.emit("toast:show", {
                  msg: `✅ ${t("import.overwritten")}: ` + finalName,
                  duration: 2000,
                  type: "success",
                });
                await loadRepoFiles();
                const { ImportHistory } = await import("./import-executor.ts");
                ImportHistory.push({
                  name: finalName,
                  time: new Date().toLocaleTimeString(),
                  isYsm: true,
                  relPath: editing.relPath,
                });
                const importedIdx = fileQueue.findIndex(
                  (fq) => fq.file === editing.file,
                );
                if (importedIdx >= 0) fileQueue.splice(importedIdx, 1);
                renderImportedList();
                currentFileRef.current = null;
                currentBase64Ref.current = null;
                currentFileNameRef.current = null;
                currentRelPathRef.current = "";
                advanceQueue();
                return;
              } catch (e2) {
                const { friendlyError } = await import("../utils/dom/errors.ts");
                bus.emit("toast:show", {
                  msg: `❌ ${t("import.overwriteFailed")}: ` + String(e2),
                  duration: 4000,
                  type: "error",
                });
                return;
              }
            }
          }
          const { friendlyError } = await import("../utils/dom/errors.ts");
          bus.emit("toast:show", {
            msg: `❌ ${t("import.failed")}: ` + errMsg,
            duration: 5000,
            type: "error",
          });
        }
      } finally {
        isImportingRef.current = false;
      }
    };
    on(importBtn, "click", handler, cleanups);
  }

  if (cancelBtn) {
    const handler = () => {
      if (isImportingRef.current) return;
      currentFileRef.current = null;
      currentBase64Ref.current = null;
      currentFileNameRef.current = null;
      toggleForm(false);
      renderImportedList();
    };
    on(cancelBtn, "click", handler, cleanups);
  }

  if (clearListBtn) {
    const handler = () => {
      ImportHistory.clear();
      renderImportedList();
    };
    on(clearListBtn, "click", handler, cleanups);
  }
}
