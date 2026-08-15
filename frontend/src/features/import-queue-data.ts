// ===== import-queue-data.ts —— 数据层：类型、状态、路由 =====
import { parseModelName } from "../utils/dom/display.ts";
import { bus } from "../bus.ts";
import { t } from "../core/i18n/t.ts";
import { friendlyError } from "../utils/dom/errors.ts";
import { getApp } from "../backend/app.ts";
import { isImportableFile, shouldEnterForm } from "./dnd-shared.ts";
import { buildRenameName } from "../utils/dom/dialogs/rename-format.ts";
import { directImport as execDirectImport, importFolder as execImportFolder, ImportHistory } from "./import-executor.ts";
import type { ImportFile as ImportedFile } from "./import-executor.ts";
import { collectFiles, type CollectedFile } from "./dnd-collector.ts";
import { currentRepoType } from "./repo-rtype.ts";

/** 带相对路径的 File（文件夹导入时标记 _relPath） */
export type ImportFile = ImportedFile;

/** 队列项数据类型 */
export type QueueItem = {
  file: ImportFile;
  base64: string;
  name: string;
  size: number;
  relPath: string;
};

/**
 * 仓库文件名归一化为「纯名」键（⚠️ 重名预警的 repoFiles Set 与查询共用契约）：
 * 先剥 `.ban` 再剥扩展名（顺序不可反）——`foo.ysm` 与 `foo.ysm.ban` 都归一化为 `foo`。
 * P2 修复：原实现先剥扩展名再剥 .ban，banned 条目归一化后仍带扩展名，与查询键不匹配 → 预警永不触发。
 */
export function normalizeRepoName(name: string): string {
  return name.replace(/\.ban$/i, "").replace(/\.\w+$/i, "");
}

/** 应用主机接口 */
export interface ImportQueueHost {
  _root: ShadowRoot;
  _esc: (s: string) => string;
}

/**
 * 导入表单 5 字段 id 注册表（收敛 4 处手写列表，索引 4.1）：
 * 事件绑定（events.ts）/ 表单填充（showForm）/ 预览读取（updatePreview）/ 提交读取
 * 统一走本常量 + readFormFields，新增字段只改一处。
 */
export const IMPORT_FORM_FIELD_IDS = [
  "dl-author",
  "dl-work",
  "dl-chara",
  "dl-variant",
  "dl-date",
] as const;

/** 读取导入表单 5 字段值（trim 后）——收敛 updatePreview / 提交读取两处逐字段手写 */
export function readFormFields(root: ShadowRoot): {
  author: string;
  work: string;
  chara: string;
  variant: string;
  date: string;
} {
  const val = (id: string): string =>
    (root.getElementById(id) as HTMLInputElement).value.trim();
  return {
    author: val("dl-author"),
    work: val("dl-work"),
    chara: val("dl-chara"),
    variant: val("dl-variant"),
    date: val("dl-date"),
  };
}

/** 初始化导入队列的数据层：返回状态对象和清理函数 */
export function initDataLayer(host: ImportQueueHost): {
  state: {
    currentFile: ImportFile | null;
    currentBase64: string | null;
    currentFileName: string | null;
    currentRelPath: string;
    fileQueue: QueueItem[];
    repoFiles: Set<string> | null;
    isImporting: boolean;
    disposed: boolean;
    conflictTimer: ReturnType<typeof setTimeout> | null;
    pendingHeaderTimers: Array<ReturnType<typeof setTimeout>>;
    conflictCheckGen: number;
  };
  actions: {
    readAndRouteFile: (file: ImportFile, onDone?: () => void) => void;
    advanceQueue: () => void;
    toggleForm: (visible: boolean) => void;
    showForm: (file: ImportFile, base64: string) => void;
    updatePreview: () => void;
    loadHeaderFromBase64: () => Promise<void>;
    enqueueFile: (file: ImportFile, base64: string) => void;
    renderImportedList: () => void;
    importModelFolder: (dirRel: string, files: Array<{ file: ImportFile; relPath: string }>) => Promise<void>;
    routeCollected: (collected: Array<{ file: ImportFile; relPath: string }>) => Promise<void>;
    processDropItems: (items: DataTransferItemList) => void;
    directImport: (file: ImportFile) => Promise<void>;
    loadRepoFiles: () => Promise<void>;
  };
  cleanup: () => void;
} {
  const root = host._root;
  const esc = (s: string): string => host._esc(s);

  // 状态
  const state = {
    currentFile: null as ImportFile | null,
    currentBase64: null as string | null,
    currentFileName: null as string | null,
    currentRelPath: "" as string,
    fileQueue: [] as QueueItem[],
    repoFiles: null as Set<string> | null,
    isImporting: false,
    disposed: false,
    conflictTimer: null as ReturnType<typeof setTimeout> | null,
    pendingHeaderTimers: [] as Array<ReturnType<typeof setTimeout>>,
    conflictCheckGen: 0,
  };

  // readAndRouteFile：读文件并分流（表单/直导）
  const readAndRouteFile = (file: ImportFile, onDone?: () => void): void => {
    if (shouldEnterForm(file.name)) {
      const reader = new FileReader();
      reader.onload = async () => {
        if (state.disposed) return;
        try {
          const base64 = String(reader.result).split(",")[1] || "";
          enqueueFile(file, base64);
        } catch (e) {
          bus.emit("toast:show", {
            msg: "❌ " + friendlyError(e),
            duration: 5000,
            type: "error",
          });
        } finally {
          onDone?.();
        }
      };
      reader.onerror = (): void => {
        bus.emit("toast:show", {
          msg: "❌ " + "读取文件失败",
          duration: 5000,
          type: "error",
        });
        onDone?.();
      };
      reader.readAsDataURL(file);
    } else {
      (async () => {
        if (state.disposed) return;
        try {
          await directImport(file);
        } catch (e) {
          bus.emit("toast:show", {
            msg: "❌ " + friendlyError(e),
            duration: 5000,
            type: "error",
          });
        } finally {
          onDone?.();
        }
      })();
    }
  };

  // 队列推进
  const advanceQueue = (): void => {
    if (state.fileQueue.length > 0) {
      showForm(state.fileQueue[0].file, state.fileQueue[0].base64);
    } else {
      toggleForm(false);
    }
  };

  // 切换拖拽区 ↔ 表单
  const toggleForm = (visible: boolean): void => {
    const form = root.getElementById("dl-form") as HTMLElement | null;
    if (visible) {
      (root.getElementById("dl-drop") as HTMLElement).style.display = "none";
      if (form) form.style.display = "flex";
    } else {
      (root.getElementById("dl-drop") as HTMLElement).style.display = "flex";
      if (form) form.style.display = "none";
    }
  };

  const showForm = (file: ImportFile, base64: string): void => {
    state.currentFile = file;
    state.currentBase64 = base64;
    state.currentFileName = file.name;
    state.currentRelPath = file._relPath || "";

    const parsed = parseModelName(file.name);

    // 表单填充按字段注册表收敛（索引 4.1）：author/work/chara/date 来自文件名解析，variant 恒空
    const fieldValues: Record<string, string> = {
      "dl-author": parsed.author || "",
      "dl-work": parsed.work || "",
      "dl-chara": parsed.chara || "",
      "dl-variant": "",
      "dl-date": parsed.date || "",
    };
    for (const id of IMPORT_FORM_FIELD_IDS) {
      (root.getElementById(id) as HTMLInputElement).value = fieldValues[id];
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
      }
    })();

    // "读取作者"已勾选时，自动为新文件读取 YSM 头部
    const headerTimer: ReturnType<typeof setTimeout> = setTimeout(async () => {
      try {
        if ((root.getElementById("dl-from-header") as HTMLInputElement | null)?.checked) {
          await loadHeaderFromBase64();
        }
      } catch (err) {
        console.warn("[import-queue] 自动读取头部失败:", err);
      }
    }, 0);
    state.pendingHeaderTimers.push(headerTimer);
  };

  const checkConflictDebounced = (name: string): void => {
    if (state.conflictTimer) clearTimeout(state.conflictTimer);
    state.conflictTimer = setTimeout(async () => {
      const gen = ++state.conflictCheckGen;
      try {
        const { CheckFileExists, GetRepoRoot } = await getApp();
        // ADR-064 锚定：冲突检查随当前仓库类型（原锁 YSM，其他类型导入误报/漏报重名）
        const filesRoot = await GetRepoRoot(currentRepoType());
        const fullPath = (filesRoot || "") + "/" + name;
        const exists = await CheckFileExists(fullPath);
        if (gen !== state.conflictCheckGen) return;
        const el = root.getElementById("dl-conflict") as HTMLElement | null;
        if (el) el.style.display = exists ? "" : "none";
      } catch (e) {
        console.warn("[import-queue] 冲突检查失败:", e);
      }
    }, 400);
  };

  const updatePreview = (): void => {
    // 统一走 readFormFields 读取（索引 4.1 收敛逐字段手写）
    const { author: a, work: w, chara: c, variant: v, date: manualDate } = readFormFields(root);
    const autoOn = (root.getElementById("dl-date-auto") as HTMLInputElement).checked;
    const autoDate =
      new Date().getFullYear() +
      "-" +
      String(new Date().getMonth() + 1).padStart(2, "0");
    const d = manualDate || (autoOn ? autoDate : "");
    const ext = state.currentFileName?.split(".").pop() || "ysm";
    // 拼装逻辑与重命名对话框同源
    const preview = buildRenameName({ author: a, work: w, chara: c, variant: v, date: d }, ext);
    (root.getElementById("dl-preview") as HTMLElement).textContent = preview;
    checkConflictDebounced(preview);
  };

  const loadHeaderFromBase64 = async (): Promise<void> => {
    if (!state.currentBase64) return;
    try {
      const { ExtractYSMHeaderFromBase64 } = await getApp();
      const header = await ExtractYSMHeaderFromBase64(state.currentBase64);
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
    } catch (e) {
      console.warn("[import-queue] 读取头部失败:", e);
    }
  };

  const enqueueFile = (file: ImportFile, base64: string): void => {
    const relPath = file._relPath || "";
    const nameKey = file.name.toLowerCase();
    const dup =
      state.fileQueue.some((fq) => fq.name.toLowerCase() === nameKey && (fq.relPath || "") === relPath) ||
      ImportHistory.records.some(
        (i) => i.name.toLowerCase() === nameKey && (i.relPath || "") === relPath,
      );
    if (dup) return;
    state.fileQueue.push({
      file,
      base64,
      name: file.name,
      size: file.size,
      relPath: file._relPath || "",
    });
    if (!state.currentFile) {
      showForm(file, base64);
    }
    // 渲染列表——通过 actions 回调（主文件注入，延迟绑定）
    // 修复：拆分时渲染调用遗漏（注释在、调用没了）——入队后不渲染，队列 UI 恒空
    actions.renderImportedList?.();
    // 加载仓库文件列表
    if (!state.repoFiles) loadRepoFiles();
  };

  const importModelFolder = async (
    dirRel: string,
    files: Array<{ file: ImportFile; relPath: string }>,
  ): Promise<void> => {
    await execImportFolder(dirRel, files);
  };

  const routeCollected = async (
    collected: Array<{ file: ImportFile; relPath: string }>,
  ): Promise<void> => {
    const { groupCollected } = await import("./dnd-shared.ts");
    const { folders, singles } = groupCollected(collected);
    for (const g of folders) {
      await importModelFolder(g.dir, g.files as Array<{ file: ImportFile; relPath: string }>);
    }
    for (const c of singles) {
      (c.file as ImportFile)._relPath = c.relPath;
      await directImport(c.file);
    }
  };

  const processDropItems = (items: DataTransferItemList): void => {
    const entries: FileSystemEntry[] = [];
    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry?.();
      if (entry) entries.push(entry);
    }
    if (!entries.length) {
      let ok = 0;
      let skip = 0;
      for (let i = 0; i < items.length; i++) {
        const file = items[i].getAsFile?.();
        if (!file || !isImportableFile(file.name)) {
          skip++;
          continue;
        }
        ok++;
        readAndRouteFile(file as ImportFile);
      }
      // updateQueueCount 由外部调用
      if (ok > 0) {
        bus.emit("toast:show", {
          msg: t("import.addedToQueue", { n: ok }),
          duration: 2000,
          type: "success",
        });
      }
      return;
    }
    Promise.all(entries.map((entry) => collectFiles([entry], true, "")))
      .then(async (groups) => {
        const all: CollectedFile[] = groups.flat() as CollectedFile[];
        await routeCollected(all);
        // updateQueueCount 由外部调用
        if (state.fileQueue.length > 0) {
          bus.emit("toast:show", {
            msg: t("import.addedToQueue", { n: state.fileQueue.length }),
            duration: 2000,
            type: "success",
          });
        }
      })
      .catch((err) => {
        console.warn("[import-queue] 读取拖入项失败:", err);
        bus.emit("toast:show", {
          msg: "❌ 读取拖入项失败",
          duration: 3000,
          type: "error",
        });
      });
  };

  const directImport = async (file: ImportFile): Promise<void> => {
    await execDirectImport(file);
  };

  const loadRepoFiles = async (): Promise<void> => {
    try {
      const { ScanModelEntriesWithLabel, GetRepoRoot } = await getApp();
      const { RESOURCE_TYPE_LABELS } = await import("../utils/resource/types.ts");
      // ADR-064 锚定：仓库文件加载随当前仓库类型（原锁 YSM，其他类型重名预警失效）
      const rtype = currentRepoType();
      const filesRoot = await GetRepoRoot(rtype);
      if (filesRoot) {
        const entries = (await ScanModelEntriesWithLabel(filesRoot, RESOURCE_TYPE_LABELS[rtype])) || [];
        state.repoFiles = new Set(entries.map((e) => normalizeRepoName(e.Name)));
      }
    } catch {
      state.repoFiles = new Set();
    }
    // 陷阱 #13 修复：repoFiles 变化后必须触发重渲染，否则队列「⚠️ 重名预警」永不出
    // 现（状态变了但 UI 不刷新的幽灵路径）
    actions.renderImportedList?.();
  };

  const cleanup = (): void => {
    state.disposed = true;
    if (state.conflictTimer) clearTimeout(state.conflictTimer);
    state.pendingHeaderTimers.forEach((t) => clearTimeout(t));
  };

  const actions = {
    readAndRouteFile,
    advanceQueue,
    toggleForm,
    showForm,
    updatePreview,
    loadHeaderFromBase64,
    enqueueFile,
    renderImportedList: () => {}, // 由主文件注入（薄壳 initImportQueue 覆盖）
    importModelFolder,
    routeCollected,
    processDropItems,
    directImport,
    loadRepoFiles,
  };

  return {
    state,
    actions,
    cleanup,
  };
}
