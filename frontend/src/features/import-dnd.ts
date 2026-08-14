// ===== 仓库页拖拽导入（组件级 — ADR-060）=====
// 从 document 级 registerDnD 收敛为 <app-tree> 容器内绑定，去掉全局遮罩。
// 收集器统一走 features/dnd-collector.ts，与导入页收集器一致。

import { bus } from "../bus.ts";
import { t } from "../core/i18n/t.ts";
import { RESOURCE_TYPES } from "../utils/resource/types.ts";
import { getApp } from "../backend/app.ts";
import { resolveWebMode } from "../backend/platform.ts";
import { importWebFiles, MAX_IMPORT_BYTES } from "../backend/browser-adapter.ts";
import { ALL_EXTS } from "../utils/resource/extensions.ts";
import { executeCollected } from "./import-executor.ts";
import { collectFiles, type CollectedFile } from "./dnd-collector.ts";

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
      const r = await importWebFiles(files, RESOURCE_TYPES.YSM);
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
      return;
    }

    // 桌面版：collectFiles 异步收集
    const items = Array.from(e.dataTransfer?.items || []);
    let collected: CollectedFile[] = [];
    if (items.length > 0) {
      collected = await collectFiles(items, false);
    }

    // WebView2 兜底：合并 dataTransfer.files，name+size+lastModified 去重
    const seen = new Set(collected.map((c) => c.file.name + ":" + c.file.size + ":" + c.file.lastModified));
    for (const f of Array.from(e.dataTransfer?.files || [])) {
      const key = f.name + ":" + f.size + ":" + f.lastModified;
      if (seen.has(key)) continue;
      seen.add(key);
      collected.push({
        file: f,
        relPath:
          (f as File & { webkitRelativePath?: string }).webkitRelativePath ||
          f.name,
      });
    }
    if (collected.length === 0) {
      collected = Array.from(e.dataTransfer?.files || []).map((f) => ({
        file: f,
        relPath: f.name,
      }));
    }
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
    const r = await executeCollected(collected);
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

  const hintEl = container.parentElement?.querySelector<HTMLElement>(".tree-drop-hint");

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
    void handleTreeDrop(e, isBusy, setBusy).catch((err) => {
      console.error("[tree-dnd] 拖放处理失败:", err);
      bus.emit("toast:show", {
        msg: `❌ ${t("import.processError")}`,
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
