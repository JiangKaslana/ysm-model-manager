// ===== 全局导入执行器（2026-08-05：静默导入改造）=====
// 拖拽导入不再依赖导入 tab 挂载（initImportQueue 懒加载），由本模块全局执行：
// - directImport：单文件直导（.ysm/.zip 保留原名，后端自动路由）
// - importFolder：文件夹整组导入（含 ysm.json 或普通文件夹，组内至少 1 个支持文件）
// - 内存历史（导入 tab 渲染数据源）+ inFlight 去重 + toast/stats/tree 广播
// 与 go/importer + go/fileops.WriteModelFolder 后端对齐。
import { bus } from "../bus.ts";
import { t } from "../core/i18n/t.ts";
import { getApp } from "../backend/app.ts";
import { groupCollected, isImportableFile } from "./dnd-shared.ts";
import { isYsmName } from "../utils/icon/icon.ts";

/** 带相对路径的 File（文件夹导入时标记 _relPath） */
export type ImportFile = File & { _relPath?: string };

/** 已导入历史条目（导入 tab「已导入」列表数据源） */
export interface ImportRecord {
  name: string;
  time: string;
  isYsm?: boolean;
  relPath?: string; // ADR-039 P3：去重需比对相对路径，防同名不同目录文件误丢
}

/** 收集条目（文件 + 相对路径） */
export interface CollectedEntry {
  file: File;
  relPath: string;
}

let _records: ImportRecord[] = [];
/** per-file 在途集合：仅阻止同一文件并发/重复提交，不同文件可并行 */
const _inFlight = new Set<string>();

export const ImportHistory = {
  get records(): ImportRecord[] {
    return _records;
  },

  push(rec: ImportRecord): void {
    _records.unshift(rec);
    bus.emit("import:history-changed", { records: _records });
  },

  /** 重命名历史条目（导入 tab ✂️ 重命名后同步） */
  rename(oldName: string, newName: string): void {
    const rec = _records.find((r) => r.name === oldName);
    if (rec) {
      rec.name = newName;
      bus.emit("import:history-changed", { records: _records });
    }
  },

  clear(): void {
    _records = [];
    bus.emit("import:history-changed", { records: [] });
  },
};

const toast = (msg: string, type: "success" | "error" | "warn" | "info", duration = 3000): void => {
  bus.emit("toast:show", { msg, duration, type });
};

/** 刷新仓库展示（统计 + 树） */
const refreshRepo = (): void => {
  bus.emit("stats:refresh");
  bus.emit("tree:reload");
};

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    // P3 修复（子代理审计）：无超时兜底——FileReader 既不走 onload 也不走 onerror 时
    // Promise 永久 pending → directImport/importFolder 卡死、_inFlight 永不释放
    // （该文件/文件夹后续提交被永久静默拦截）；10s 超时 reject + abort（与
    // import-dnd entry.file 的 5s 超时范式对齐，取更大值覆盖大文件读取）
    const timer = setTimeout(() => {
      reader.abort();
      reject(new Error("读取文件超时: " + file.name));
    }, 10000);
    reader.onload = () => {
      clearTimeout(timer);
      resolve(String(reader.result).split(",")[1] || "");
    };
    reader.onerror = () => {
      clearTimeout(timer);
      reject(new Error("读取文件失败: " + file.name));
    };
    reader.readAsDataURL(file);
  });

/** 单文件直接导入（保留原文件名，后端自动路由类型 + 冲突覆盖确认） */
export const directImport = async (file: File): Promise<void> => {
  // ysm.json 单文件 = 光杆清单（geometry/纹理全丢），引导拖整个文件夹
  if (file.name.toLowerCase() === "ysm.json") {
    toast(
      t("import.ysmJsonHint"),
      "warn",
      4000,
    );
    return;
  }
  // 键含 size+lastModified，防同名不同源文件误判在途
  const key = file.name + ":" + file.size + ":" + file.lastModified;
  if (_inFlight.has(key)) {
    // P2 修复（子代理审计）：busy 命中静默 return 违反 ADR-044①「busy 命中必回
    // 反馈」——用户重复提交同一文件时零反馈（无 toast/无 skipped）；与 sync.ts
    // 「busy 命中回 done+skipped」范式对齐，此处发 toast
    toast(t("import.busyImporting"), "warn", 2000);
    return;
  }
  _inFlight.add(key);
  try {
    const base64 = await fileToBase64(file);
    const { ImportModelFile } = await getApp();
    await ImportModelFile(file.name, base64);
    ImportHistory.push({
      name: file.name,
      time: new Date().toLocaleTimeString(),
      // P2 修复（审核发现）：isYsm 硬编码 false 导致 .ysm 单文件静默导入后
      // 已导入列表无「✂️ 重命名」按钮（表单路径 isYsm:true 有按钮，行为不一致）
      isYsm: isYsmName(file.name),
    });
    refreshRepo();
    toast(t("import.success") + ": " + file.name, "success", 2000);
  } catch (e) {
    toast("❌ " + t("import.failed") + ": " + String(e), "error", 4000);
  } finally {
    _inFlight.delete(key);
  }
};

/** 文件夹整组导入（含 ysm.json 模型目录或普通文件夹；组内至少 1 个支持文件由调用方保证） */
export const importFolder = async (
  dir: string,
  files: CollectedEntry[],
): Promise<void> => {
  // 并发守护：与 directImport 的 _inFlight 对称，阻止同一文件夹重复提交
  if (_inFlight.has(dir)) {
    // P2 修复（子代理审计）：同上——busy 命中静默 return 零反馈，改 toast
    toast(t("import.busyImporting"), "warn", 2000);
    return;
  }
  _inFlight.add(dir);
  const parts = dir.split("/");
  const folderName = parts[parts.length - 1] || "模型";
  const subpath = parts.slice(0, -1).join("/");
  try {
    const items: Array<{ RelPath: string; Base64: string }> = [];
    for (const c of files) {
      const rel = c.relPath.startsWith(dir + "/")
        ? c.relPath.slice(dir.length + 1)
        : c.relPath;
      // P3 修复：per-file 读取失败跳过该文件，不拖垮整组——
      // 原实现 fileToBase64 reject 会冒泡到外层 catch，文件夹里 1 个坏文件 → 整组导入失败
      let b64 = "";
      try {
        b64 = await fileToBase64(c.file);
      } catch (e) {
        console.warn("[import] 跳过读取失败文件:", rel, e);
        continue;
      }
      if (!b64) continue;
      items.push({ RelPath: rel, Base64: b64 });
    }
    if (!items.length) {
      toast("❌ " + t("import.emptyFolder"), "error", 4000);
      return;
    }
    const { ImportModelFolder } = await getApp();
    await ImportModelFolder(folderName, subpath, items);
    ImportHistory.push({
      name: folderName + "（文件夹）",
      time: new Date().toLocaleTimeString(),
      // P2 修复（审核）：isYsm 硬编码 false → 含 ysm.json 的文件夹标 true，
      // 与表单路径（isYsm:true）一致，否则已导入列表无「✂️ 重命名」按钮
      isYsm: items.some((it) => it.RelPath.toLowerCase().endsWith("ysm.json")),
    });
    refreshRepo();
    toast(t("import.success") + ": " + folderName, "success", 2500);
  } catch (e) {
    const msg = String(e);
    if (msg.includes("FILE_EXISTS") || msg.includes("目标已存在")) {
      toast(`❌ ${folderName} ${t("import.alreadyExists")}`, "error", 4000);
    } else {
      toast("❌ " + t("import.failed") + ": " + msg, "error", 4000);
    }
  } finally {
    _inFlight.delete(dir);
  }
};

/**
 * 执行一组拖拽收集的条目（静默导入入口）：
 * 文件夹 → 整组（组内至少 1 个支持文件）；散落单文件 → 直导。
 * 与导入页 routeCollected 语义一致；全局调用不依赖导入 tab 挂载。
 */
export const executeCollected = async (
  collected: CollectedEntry[],
): Promise<{ folders: number; singles: number }> => {
  const { folders, singles } = groupCollected(collected);
  for (const g of folders) {
    await importFolder(g.dir, g.files);
  }
  for (const c of singles) {
    await directImport(c.file);
  }
  return { folders: folders.length, singles: singles.length };
};

/** 是否可作为独立文件导入（供外部过滤，dnd-shared 透传） */
export { isImportableFile };
