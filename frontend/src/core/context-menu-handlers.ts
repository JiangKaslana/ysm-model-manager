// ===== context-menu-handlers.ts — 右键菜单 handler 表（从 context-menus.ts 拆出，ADR-040 P1）=====
import { bus, type ToastPayload } from "../bus.ts";
import { friendlyError } from "../utils/dom/errors.ts";
import { RESOURCE_TYPES } from "../utils/resource/types.ts";
import { getApp } from "../backend/app.ts";
import { modalPrompt, modalConfirm, modalSelect } from "../utils/dom/dialogs/modal.ts";
import { showRenameDialog } from "../utils/dom/dialogs/rename.ts";
import { modalTagEditor } from "../utils/dom/dialogs/tag-editor.ts";

type ToastType = NonNullable<ToastPayload["type"]>;

/** 通知树组件和统计面板刷新 */
export function refreshUI(): void {
  bus.emit("tree:reload");
  bus.emit("stats:refresh");
}

/** 显示 toast 通知 */
export function toast(msg: string, duration = 3000, type: ToastType = "success"): void {
  bus.emit("toast:show", { msg, duration, type });
}

/** 路径安全过滤：禁止逃逸段（. / ..）与绝对路径 */
export function isUnsafeFolderName(folder: string): boolean {
  const trimmed = folder.trim();
  if (!trimmed) return true;
  if (/^[/\\]/.test(trimmed) || /^[A-Za-z]:/.test(trimmed)) return true;
  return trimmed.split(/[/\\]/).some((seg) => seg === "." || seg === "..");
}

/**
 * 解析「移动/复制到文件夹」的目标路径（batch.move / batch.copy / file.move / file.copy 共用）。
 * 用户取消或校验失败时返回 null（已 toast 告知）。
 */
export async function resolveDstDir(opts: {
  title: string;
  icon: string;
  okText: string;
  emptyMsg: string;
}): Promise<{ folder: string; dstDir: string } | null> {
  const folder = await modalPrompt({
    title: opts.title,
    icon: opts.icon,
    placeholder: "输入目标文件夹名，如 [作者名]",
    okText: opts.okText,
  });
  if (!folder) return null;
  if (isUnsafeFolderName(folder)) {
    bus.emit("toast:show", {
      msg: "❌ 文件夹名包含非法字符",
      duration: 3000,
      type: "error",
    });
    return null;
  }
  const { GetRepoRoot } = await getApp();
  const filesRoot = await GetRepoRoot(RESOURCE_TYPES.YSM);
  if (!filesRoot) {
    bus.emit("toast:show", {
      msg: opts.emptyMsg,
      duration: 3000,
      type: "error",
    });
    return null;
  }
  return { folder, dstDir: filesRoot + "/" + folder.replace(/\\/g, "/") };
}

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

/** 行为 handler 表 */
export const HANDLERS: Record<string, (ctx: MenuCtx) => void> = {
  noop: () => {},

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

  // ── file ──
  "file.rename": async (ctx) => {
    try {
      const fileName = (ctx.path || "").split(/[/\\]/).pop() || "";
      if (fileName.toLowerCase() === "ysm.json") {
        toast(
          "ysm.json 是模型目录清单，请右键所在文件夹「重命名」（整组操作）",
          4000,
          "warn",
        );
        return;
      }
      const newName = await showRenameDialog(ctx.path || "", fileName);
      if (!newName) return;
      const { RenameFile } = await getApp();
      await RenameFile(ctx.path || "", newName);
      refreshUI();
    } catch (e) {
      toast("❌ " + friendlyError(e, "重命名失败"), 4000, "error");
    }
  },
  "file.move": async (ctx) => {
    try {
      const resolved = await resolveDstDir({
        title: "移动到文件夹",
        icon: "📂",
        okText: "移动",
        emptyMsg: "❌ 请先配置存储路径",
      });
      if (!resolved) return;
      const { folder, dstDir } = resolved;
      const { MoveModelFile } = await getApp();
      await MoveModelFile(ctx.path || "", dstDir);
      toast(`✅ 已移动到 ${folder}`, 3000);
      refreshUI();
    } catch (e) {
      toast("❌ " + friendlyError(e, "移动失败"), 4000, "error");
    }
  },
  "file.copy": async (ctx) => {
    try {
      const resolved = await resolveDstDir({
        title: "复制到文件夹",
        icon: "📋",
        okText: "复制",
        emptyMsg: "❌ 请先配置仓库目录",
      });
      if (!resolved) return;
      const { folder, dstDir } = resolved;
      const { CopyModelFile } = await getApp();
      await CopyModelFile(ctx.path || "", dstDir);
      refreshUI();
      toast(`✅ 已复制到 ${folder}`, 3000);
    } catch (e) {
      toast("❌ " + friendlyError(e, "复制失败"), 4000, "error");
    }
  },
  "file.push-to-pack": async (ctx) => {
    try {
      const { LoadAppConfig, ListVersionInstances, InstallModelTo } = await getApp();
      const cfg = await LoadAppConfig();
      const mcRoot = cfg.mcRoot || "";
      if (!mcRoot) {
        toast("请先配置游戏目录", 2000, "warn");
        return;
      }
      const instances = (await ListVersionInstances(mcRoot)) ?? [];
      if (!instances.length) {
        toast("未找到任何整合包", 2000, "warn");
        return;
      }
      const names = instances.map((i) => i.Name);
      const chosen = await modalSelect({
        title: "推送到整合包",
        icon: "📦",
        items: names,
        okText: "📦 推送",
      });
      if (!chosen) return;
      const match = instances.find((i) => i.Name === chosen);
      if (!match) return;
      try {
        await InstallModelTo(ctx.path || "", match.CustomDir);
        toast(`✅ 已推送到 ${chosen}`, 2000);
      } catch (e) {
        toast("❌ " + friendlyError(e, "推送失败"), 3000, "error");
      }
    } catch (e) {
      toast("❌ " + friendlyError(e, "推送失败"), 3000, "error");
    }
  },
  "file.edit-tags": async (ctx) => {
    try {
      const result = await modalTagEditor(ctx.path || "");
      if (result) toast(`🏷️ 已保存 ${result.length} 个标签`, 2000);
    } catch (e) {
      toast("❌ " + friendlyError(e, "标签编辑失败"), 3000, "error");
    }
  },
  "file.recycle": async (ctx) => {
    try {
      const ok2 = await modalConfirm({
        title: "移入回收站",
        icon: "♻️",
        message: `确定将 ${(ctx.path || "").split("/").pop()} 移入回收站？`,
        okText: "♻️ 移入",
        danger: true,
      });
      if (!ok2) return;
      const { MoveToRecycle } = await getApp();
      try {
        await MoveToRecycle(ctx.path || "");
        refreshUI();
      } catch (e) {
        toast("❌ " + friendlyError(e, "移入回收站失败"), 3000, "error");
      }
    } catch (e) {
      toast("❌ " + friendlyError(e, "移入回收站失败"), 3000, "error");
    }
  },
  "file.reveal": async (ctx) => {
    try {
      const { RevealInExplorer } = await getApp();
      await RevealInExplorer(ctx.path || "");
    } catch (e) {
      toast("❌ " + friendlyError(e, "打开失败"), 3000, "error");
    }
  },
  "file.copy-path": async (ctx) => {
    try {
      await navigator.clipboard.writeText(ctx.path || "");
      toast("✅ 路径已复制到剪贴板", 2000);
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = ctx.path || "";
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        if (!ok) {
          toast("❌ 复制失败，请手动复制路径", 3000, "error");
          return;
        }
        toast("✅ 路径已复制到剪贴板", 2000);
      } catch (fallbackErr) {
        toast("❌ " + friendlyError(fallbackErr, "复制失败"), 3000, "error");
      }
    }
  },

  // ── dir ──
  "dir.rename": (ctx) => bus.emit("dir:rename", { dir: ctx.dir || "" }),
  "dir.batch-rename": (ctx) =>
    bus.emit("dir:batch-rename", { dir: ctx.dir || "" }),
  "dir.move": async (ctx) => {
    try {
      const resolved = await resolveDstDir({
        title: "移动文件夹到",
        icon: "📂",
        okText: "移动",
        emptyMsg: "❌ 请先配置存储路径",
      });
      if (!resolved) return;
      const { folder, dstDir } = resolved;
      const { MoveModelFile } = await getApp();
      await MoveModelFile(ctx.dir || "", dstDir);
      toast(`✅ 已移动文件夹到 ${folder}`, 3000);
      refreshUI();
    } catch (e) {
      toast("❌ " + friendlyError(e, "移动失败"), 4000, "error");
    }
  },
  "dir.copy": async (ctx) => {
    try {
      const resolved = await resolveDstDir({
        title: "复制文件夹到",
        icon: "📋",
        okText: "复制",
        emptyMsg: "❌ 请先配置仓库目录",
      });
      if (!resolved) return;
      const { folder, dstDir } = resolved;
      const { CopyModelFile } = await getApp();
      await CopyModelFile(ctx.dir || "", dstDir);
      refreshUI();
      toast(`✅ 已复制文件夹到 ${folder}`, 3000);
    } catch (e) {
      toast("❌ " + friendlyError(e, "复制失败"), 4000, "error");
    }
  },
  "dir.mkdir": (ctx) => bus.emit("dir:mkdir", { dir: ctx.dir || "" }),
  "dir.recycle": (ctx) => bus.emit("dir:recycle", { dir: ctx.dir || "" }),
};
