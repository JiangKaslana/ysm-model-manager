// ===== 仓库页拖拽导入（组件级 — ADR-060）=====
// 从 document 级 registerDnD 收敛为 <app-tree> 容器内绑定，去掉全局遮罩。
// 收集器统一走 features/dnd-collector.ts，与导入页收集器一致。

import { bus } from "../bus.ts";
import { t } from "../core/i18n/t.ts";
import { getApp } from "../backend/app.ts";
import { resolveWebMode } from "../backend/platform.ts";
import { MAX_IMPORT_BYTES } from "../backend/browser-adapter.ts";
import { ALL_EXTS } from "../utils/resource/extensions.ts";
import { friendlyError } from "../utils/dom/errors.ts";
import { executeCollected, importWebFilesWithToast } from "./import-executor.ts";
import { collectFiles, type CollectedFile } from "./dnd-collector.ts";
import { dbg } from "../utils/debug/debug.ts";

const DROP_EXTS_STR = ALL_EXTS.join(" ");

const isEditable = (el: EventTarget | null): boolean => {
  const node = el as HTMLElement | null;
  return Boolean(
    node &&
      (node.tagName === "INPUT" ||
        node.tagName === "TEXTAREA" ||
        node.isContentEditable),
  );
};

/**
 * 处理 drop 事件：收集文件 → 过滤 → 执行导入。
 * busy 状态由调用方（bindTreeDnD 闭包）传入，避免模块级状态跨实例污染。
 */
export async function handleTreeDrop(
  e: DragEvent,
  isBusy: () => boolean,
  setBusy: (v: boolean) => void,
): Promise<void> {
  e.preventDefault();
  if (isEditable(e.target)) return;

  if (isBusy()) {
    bus.emit("toast:show", {
      msg: "⏳ " + t("import.busyImporting"),
      duration: 2000,
      type: "info",
    });
    return;
  }
  setBusy(true);
  try {
    // 网页版：无本地文件系统 → 拖入文件直接写入 IndexedDB 模型库
    if (resolveWebMode()) {
      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length === 0) {
        bus.emit("toast:show", {
          msg: "⚠️ 网页版暂不支持文件夹导入，请拖入 .ysm 等模型文件",
          duration: 4000,
          type: "warn",
        });
        return;
      }
      await importWebFilesWithToast(files);
      return;
    }

    // 桌面版：优先用 dataTransfer.files（WebView2 可靠）；
    // webkitGetAsEntry 在 WebView2 中对文件条目可能返回 null，仅作为目录收集的补充。
    // 策略：先用 files 收集所有散文件，再尝试 items → webkitGetAsEntry 补充目录条目。
    const baseFiles: CollectedFile[] = Array.from(e.dataTransfer?.files || []).map((f) => ({
      file: f,
      relPath: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
    }));

    const items = Array.from(e.dataTransfer?.items || []);
    let collected: CollectedFile[];
    if (items.length > 0) {
      const viaItems = await collectFiles(items, false);
      // 合并：items 路径来的补充到 baseFiles，去重
      const seen = new Set(baseFiles.map((c) => c.file.name + ":" + c.file.size + ":" + c.file.lastModified));
      for (const c of viaItems) {
        const key = c.file.name + ":" + c.file.size + ":" + c.file.lastModified;
        if (!seen.has(key)) {
          seen.add(key);
          baseFiles.push(c);
        }
      }
      collected = baseFiles;
    } else {
      collected = baseFiles;
    }
    dbg("dnd", "collected", { total: collected.length, names: collected.map((c) => c.file.name) });
    if (collected.length === 0) {
      bus.emit("toast:show", {
        msg: "📂 " + t("import.noSupportedFiles") + "（" + DROP_EXTS_STR + "）",
        duration: 3000,
        type: "info",
      });
      return;
    }

    // oversize 逐文件过滤
    const oversized = collected.filter((c) => c.file.size > MAX_IMPORT_BYTES);
    if (oversized.length > 0) {
      bus.emit("toast:show", {
        msg: `⚠️ ${oversized.length} 个文件超过 ${Math.round(MAX_IMPORT_BYTES / 1024 / 1024)}MB 上限已跳过（${oversized[0].file.name}${oversized.length > 1 ? " 等" : ""}）`,
        duration: 5000,
        type: "warn",
      });
      collected = collected.filter((c) => c.file.size <= MAX_IMPORT_BYTES);
      if (collected.length === 0) return;
    }

    const total = collected.length;
    dbg("dnd", "before execute", { total, oversized: oversized.length });
    const r = await executeCollected(collected);
    dbg("dnd", "execute result", r);
    if (r.folders === 0 && r.singles === 0 && total > 0) {
      bus.emit("toast:show", {
        msg: "📂 " + t("import.noSupportedFiles") + "（" + DROP_EXTS_STR + "）",
        duration: 3000,
        type: "info",
      });
    }
  } finally {
    setBusy(false);
  }
}

/**
 * 在目标容器上注册仓库页 DnD 事件。
 * 由 <app-tree> connectedCallback 调用，返回 cleanup 函数。
 * busy 状态随闭包隔离，每个 <app-tree> 实例独立守卫。
 */
export function bindTreeDnD(container: HTMLElement): () => void {
  let _dropBusy = false;
  const isBusy = () => _dropBusy;
  const setBusy = (v: boolean) => { _dropBusy = v; };

  // hint 与 #tree 同为 <app-tree> shadow root 的直接子节点：parentElement 对
  // shadow root 子节点返回 null（ShadowRoot 非 Element），必须从 getRootNode()
  // 查找，否则 hint 永远不显示（ADR-060 组件化回归）。
  const hintEl = (container.getRootNode() as ParentNode).querySelector<HTMLElement>(".tree-drop-hint");

  const onDragOver = (e: DragEvent): void => {
    if (isEditable(e.target)) return;
    if (!e.dataTransfer?.types?.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    if (hintEl && !_dropBusy) hintEl.style.display = "flex";
  };

  const onDragLeave = (e: DragEvent): void => {
    // 仅在真正离开容器时隐藏（不是移到子元素）
    if (!(e.currentTarget === e.relatedTarget || (e.relatedTarget as HTMLElement | null)?.closest?.(container.tagName === "APP-TREE" ? "app-tree" : ".list"))) return;
    if (hintEl) hintEl.style.display = "none";
  };

  const onDrop = (e: DragEvent): void => {
    if (hintEl) hintEl.style.display = "none";
    dbg("dnd", "drop", {
      files: e.dataTransfer?.files?.length ?? 0,
      items: e.dataTransfer?.items?.length ?? 0,
      types: e.dataTransfer?.types ? [...e.dataTransfer.types] : [],
    });
    void handleTreeDrop(e, isBusy, setBusy).catch((err) => {
      console.error("[tree-dnd] 拖放处理失败:", err);
      bus.emit("toast:show", {
        // 显式化：friendlyError 展示 Go 结构化错误（ADR-082 续），
        // 未归类 Code 透传 Reason/Suggestion 并剥离内部路径
        msg: `❌ ${t("import.processError")}: ` + friendlyError(err),
        duration: 4000,
        type: "error",
      });
    });
  };

  container.addEventListener("dragover", onDragOver);
  container.addEventListener("dragleave", onDragLeave);
  container.addEventListener("drop", onDrop);
  return () => {
    container.removeEventListener("dragover", onDragOver);
    container.removeEventListener("dragleave", onDragLeave);
    container.removeEventListener("drop", onDrop);
  };
}
