// ===== import-queue-events.ts —— 事件绑定层 =====
import { resolveWebMode } from "../backend/platform.ts";
import { bus } from "../bus.ts";
import { t } from "../core/i18n/t.ts";
import { ALL_EXTS } from "../utils/resource/extensions.ts";
import { isImportableFile } from "./dnd-shared.ts";
import { ImportHistory, importWebFilesWithToast } from "./import-executor.ts";
import type { ImportFile, QueueItem, PreparedFormData, HeaderData } from "./import-queue-data.ts";
import { IMPORT_FORM_FIELD_IDS, readFormFields } from "./import-queue-data.ts";
import { getApp } from "../backend/app.ts";
import { isFileExistsError, friendlyError } from "../utils/dom/errors.ts";
import { RESOURCE_TYPES } from "../utils/resource/types.ts";
import { buildRenameName } from "../utils/dom/dialogs/rename-format.ts";
import { showRenameDialog } from "../utils/dom/dialogs/rename.ts";

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

// ===================================================================
// renderFormData — 表单 DOM 渲染（从 import-queue-data.ts 的 showForm 迁出）
// 填充字段 → toggleForm → 保存预览临时文件 → 设置头部读取定时器
// ===================================================================
export function renderFormData(
  root: ShadowRoot,
  esc: (s: string) => string,
  formData: PreparedFormData,
  base64: string,
  toggleForm: (visible: boolean) => void,
  updatePreview: () => void,
  loadHeaderData: () => Promise<HeaderData | null>,
  renderHeaderData: (header: HeaderData, updatePreview: () => void) => void,
  cleanups: Array<() => void>,
): void {
  // 填充表单字段
  for (const id of IMPORT_FORM_FIELD_IDS) {
    (root.getElementById(id) as HTMLInputElement).value = formData.fieldValues[id];
  }
  updatePreview();
  toggleForm(true);

  // 存临时文件供右侧预览面板读取
  (async () => {
    try {
      const { SavePreviewTempFile } = await getApp();
      const tmpPath = await SavePreviewTempFile(base64);
      if (tmpPath) {
        bus.emit("model:select", { path: tmpPath });
      }
    } catch (e) {
      console.warn("[import-queue] 预览临时文件保存失败:", e);
      bus.emit("toast:show", {
        msg: "❌ " + t("import.previewTempFailed", { err: friendlyError(e) }),
        duration: 3000,
        type: "warn",
      });
    }
  })();

  // "读取作者"已勾选时，自动为新文件读取 YSM 头部
  const headerTimer = setTimeout(async () => {
    if ((root.getElementById("dl-from-header") as HTMLInputElement | null)?.checked) {
      try {
        const header = await loadHeaderData();
        if (header) renderHeaderData(header, updatePreview);
      } catch (err) {
        console.warn("[import-queue] 自动读取头部失败:", err);
      }
    }
  }, 0);
  cleanups.push(() => clearTimeout(headerTimer));
}

// ===================================================================
// renderHeaderData — 头部 DOM 渲染（从 import-queue-data.ts 的 loadHeaderFromBase64 迁出）
// 填充作者字段（高亮）+ 填充 tips 区域
// ===================================================================
export function renderHeaderData(
  root: ShadowRoot,
  esc: (s: string) => string,
  header: HeaderData,
  updatePreview: () => void,
): void {
  if (header.authorName) {
    const authorEl = root.getElementById("dl-author") as HTMLInputElement;
    if (!authorEl.value.trim()) {
      authorEl.value = header.authorName;
      authorEl.style.background = "color-mix(in srgb,var(--accent) 10%,var(--surf))";
      authorEl.style.borderColor = "color-mix(in srgb,var(--accent) 30%,var(--bd))";
    }
  }
  if (header.tips) {
    const tipsEl = root.getElementById("dl-tips") as HTMLElement | null;
    if (tipsEl) {
      tipsEl.innerHTML =
        '<div style="font-weight:600;font-size:9px;color:var(--accent);margin-bottom:2px">📝 ' +
        "头部信息" +
        "</div><div>" +
        esc(header.tips) +
        "</div>";
      tipsEl.style.display = "block";
    }
  }
  updatePreview();
}

/** 表单输入事件绑定 */
export function bindFormEvents(
  root: ShadowRoot,
  esc: (s: string) => string,
  updatePreview: () => void,
  loadHeaderData: () => Promise<HeaderData | null>,
  cleanups: Array<() => void>,
): void {
  IMPORT_FORM_FIELD_IDS.forEach(
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
        const header = await loadHeaderData();
        if (header) {
          renderHeaderData(root, esc, header, updatePreview);
        }
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
        await importWebFilesWithToast(Array.from(files));
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
        await importWebFilesWithToast(Array.from(files), () => {
          fileInput.value = "";
        });
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
        await importWebFilesWithToast(Array.from(files));
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
        // 显式化：friendlyError 消费 AppError 结构化错误（ADR-082 续）
        msg: "❌ " + t("import.folderImportFailed") + ": " + friendlyError(e),
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
  // 导入成功共用收尾（索引 4.1 收敛正常/覆盖两分支 30 行近似重复）：
  // 刷新文件列表 → 记导入历史 → 出队 → 重绘列表 → 清编辑态 → 推队列
  const commitImportSuccess = async (
    editing: { file: ImportFile | null; relPath: string },
    finalName: string,
  ): Promise<void> => {
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
  };

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
        // 统一走 readFormFields 读取（索引 4.1 收敛逐字段手写）
        const { author: a, work: w, chara: c, variant: v, date: manualDate } = readFormFields(root);
        const autoOn = (root.getElementById("dl-date-auto") as HTMLInputElement).checked;
        const d =
          manualDate ||
          (autoOn
            ? new Date().getFullYear() +
              "-" +
              String(new Date().getMonth() + 1).padStart(2, "0")
            : "");
        const ext = editing.name?.split(".").pop() || RESOURCE_TYPES.YSM;

        let newName: string;
        if (c) {
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
          await commitImportSuccess(editing, finalName);
        } catch (e) {
          // 统一文件已存在判定（索引 4.2）：结构化 Code 优先，字符串兜底覆盖漂移文案
          if (isFileExistsError(e)) {
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
                await commitImportSuccess(editing, finalName);
                return;
              } catch (e2) {
                bus.emit("toast:show", {
                  msg: `❌ ${t("import.overwriteFailed")}: ` + friendlyError(e2),
                  duration: 4000,
                  type: "error",
                });
                return;
              }
            }
          }
          bus.emit("toast:show", {
            // 显式化：friendlyError 消费 AppError 结构化错误（ADR-082 续），
            // 未归类 Code 透传 Go Reason/Suggestion 并剥离内部路径
            msg: `❌ ${t("import.failed")}: ` + friendlyError(e),
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
