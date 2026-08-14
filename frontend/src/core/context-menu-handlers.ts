// ===== context-menu-handlers.ts — instance/batch handler 表（ADR-040 P1 第2轮拆分）=====
// file/dir handler 已拆至 context-menu-file-handlers.ts / context-menu-dir-handlers.ts
import { bus } from "../bus.ts";
import { friendlyError } from "../utils/dom/errors.ts";
import { RESOURCE_TYPES } from "../utils/resource/types.ts";
import { getApp } from "../backend/app.ts";
import { modalConfirm, modalSelect } from "../utils/dom/dialogs/modal.ts";
import { showRenameDialog } from "../utils/dom/dialogs/rename.ts";
import { modalTagEditor } from "../utils/dom/dialogs/tag-editor.ts";
// P1 修复（ADR-040）：file/dir handler 已拆出，此处合并
import { FILE_HANDLERS } from "./context-menu-file-handlers.ts";
import { DIR_HANDLERS } from "./context-menu-dir-handlers.ts";
// 共享原语（toast/refreshUI/isUnsafeFolderName/resolveDstDir）下沉至
// context-menu-shared.ts，破除 handlers ↔ {file,dir}-handlers 循环依赖
export { refreshUI, toast, isUnsafeFolderName, resolveDstDir } from "./context-menu-shared.ts";
import { refreshUI, toast, isUnsafeFolderName, resolveDstDir } from "./context-menu-shared.ts";

/**
 * batch.move / batch.copy 共用模板。
 */
let _batchBusy = false;

export async function runBatchFileOp(
  ctx: MenuCtx,
  op: {
    verb: string;
    binding: "MoveModelFile" | "CopyModelFile";
    dialog: { title: string; icon: string; okText: string; emptyMsg: string };
    partialFailMsg: string;
    allFailMsg: string;
  },
): Promise<void> {
  if (_batchBusy) {
    toast("⏳ 操作进行中，请稍候", 1500, "info");
    return;
  }
  _batchBusy = true;
  try {
    const resolved = await resolveDstDir(op.dialog);
    if (!resolved) return;
    const { folder, dstDir } = resolved;
    const app = await getApp();
    const fn = app[op.binding];
    toast(`📦 正在${op.verb} ${ctx.paths.length} 个文件到 ${folder}...`, 3000);
    let ok = 0;
    let fail = 0;
    for (const p of ctx.paths) {
      try {
        await fn(p, dstDir);
        ok++;
      } catch (e) {
        fail++;
        console.error(`${op.verb}失败:`, p, e);
      }
    }
    if (ok > 0) {
      toast(
        fail > 0
          ? `✅ ${ok} 个已${op.verb} / ❌ ${fail} 失败${op.partialFailMsg ? `（${op.partialFailMsg}）` : ""}`
          : `✅ ${ok} 个文件已${op.verb}到 ${folder}`,
        4000,
      );
    } else {
      toast(`❌ ${op.allFailMsg}`, 4000, "error");
    }
    refreshUI();
  } catch (e) {
    toast(`❌ ${friendlyError(e)}`, 4000, "error");
  } finally {
    _batchBusy = false;
  }
}

export type MenuCtx = import("../bus.ts").CtxShowPayload & { paths: string[] };

/** 行为 handler 表（instance + batch + merge file/dir） */
export const HANDLERS: Record<string, (ctx: MenuCtx) => void> = {
  noop: () => {},
  ...FILE_HANDLERS,
  ...DIR_HANDLERS,

  // ── instance ──
  "instance.open-folder": (ctx) => {
    if (!ctx.path) {
      toast("❌ 整合包目录未找到", 3000, "error");
      return;
    }
    getApp()
      .then((App) => App.OpenInstanceFolder(ctx.path || "", ctx.rtype || ""))
      .catch(() => toast("❌ 打开文件夹失败", 3000, "error"));
  },
  "instance.export-list": (ctx) =>
    bus.emit("instance:export-list", {
      name: ctx.instanceName || "",
      rtype: ctx.rtype,
    }),
  "instance.clear": (ctx) =>
    bus.emit("instance:clear", {
      name: ctx.instanceName || "",
      rtype: ctx.rtype || undefined,
    }),

  // ── batch ──
  "batch.rename": (ctx) => bus.emit("batch:rename", { paths: ctx.paths }),
  "batch.move": (ctx) =>
    runBatchFileOp(ctx, {
      verb: "移动",
      binding: "MoveModelFile",
      dialog: { title: "移动到文件夹", icon: "📂", okText: "移动", emptyMsg: "❌ 请先配置存储路径" },
      partialFailMsg: "",
      allFailMsg: "移动失败",
    }),
  "batch.copy": (ctx) =>
    runBatchFileOp(ctx, {
      verb: "复制",
      binding: "CopyModelFile",
      dialog: { title: "复制到文件夹", icon: "📋", okText: "复制", emptyMsg: "❌ 请先配置仓库目录" },
      partialFailMsg: "可能目标已存在",
      allFailMsg: "复制失败（可能目标已存在）",
    }),
  "batch.recycle": async (ctx) => {
    if (_batchBusy) {
      toast("⏳ 操作进行中，请稍候", 1500, "info");
      return;
    }
    _batchBusy = true;
    try {
      const ok2 = await modalConfirm({
        title: "批量移入回收站",
        icon: "♻️",
        message: `确定将选中的 ${ctx.count || 0} 个文件移入回收站？`,
        okText: "♻️ 移入",
        danger: true,
      });
      if (!ok2) return;
      const { MoveToRecycle } = await getApp();
      let fail = 0;
      let lastErr: unknown = null;
      for (const p of ctx.paths) {
        try {
          await MoveToRecycle(p);
        } catch (e) {
          fail++;
          lastErr = e;
        }
      }
      if (fail > 0) {
        toast(`❌ ${fail} 个文件移入回收站失败：${friendlyError(lastErr, "移动失败")}`, 5000, "error");
      }
      refreshUI();
    } catch (e) {
      toast(`❌ ${friendlyError(e)}`, 5000, "error");
    } finally {
      _batchBusy = false;
    }
  },
  "batch.copy-paths": async (ctx) => {
    try {
      await navigator.clipboard.writeText(ctx.paths.join("\n"));
      toast(`✅ 已复制 ${ctx.paths.length} 个路径`, 2000);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = ctx.paths.join("\n");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      let copied = false;
      try {
        copied = document.execCommand("copy");
      } catch {
        copied = false;
      }
      document.body.removeChild(ta);
      toast(
        copied
          ? `✅ 已复制 ${ctx.paths.length} 个路径`
          : `❌ 复制失败，请手动复制`,
        copied ? 2000 : 3000,
        copied ? undefined : "error",
      );
    }
  },
  "batch.export-list": (ctx) => {
    const names = ctx.paths
      .map((p) => p.split(/[/\\]/).pop())
      .filter(Boolean)
      .join("\n");
    const blob = new Blob([names], {
      type: "text/plain;charset=utf-8",
    });
    const a = document.createElement("a");
    a.download = `model-list-${new Date().toISOString().slice(0, 10)}.txt`;
    a.href = URL.createObjectURL(blob);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
    toast(`✅ 已导出 ${ctx.paths.length} 个文件名`, 2000);
  },
};
