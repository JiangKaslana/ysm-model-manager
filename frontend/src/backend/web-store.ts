// ===== 网页版本地存储/状态职责（ADR-040 拆分：browser-adapter.ts 职责切分产物）=====
// 配置（localStorage）、导入日志环、运行时日志环、标签、启用开关（ban）。
// 文件系统类操作见 web-fs.ts；社区数据持久化见 web-community.ts。
// browser-adapter.ts 从本文件 import 组装 webImpls。
import { idbGet, idbSet, idbDel } from "./idb.ts";
import { scanAllWebModels } from "./web-fs.ts";

// --- 配置（localStorage，缺省返回 {} 让主应用可启动）---
const CFG_KEY = "ysm:config";

export function loadWebConfig(): Record<string, unknown> {
  try {
    return JSON.parse(localStorage.getItem(CFG_KEY) ?? "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function saveWebConfig(cfg: Record<string, unknown>): void {
  try {
    localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
  } catch {
    // 隐私模式等：静默降级（配置不持久化，会话内仍生效）
  }
}

// --- 网页版内存日志环（替代 Go 侧 ImportLog / runtimeLogs）---
// 桌面由 Go 进程内环形缓冲 + 落盘；网页版无 Go 进程，用同形内存环兜底。
// 容量对齐 Go（maxLogEntries=500 / runtimeLogs.DefaultRuntimeCap=300），避免诊断页
// 因 GetImportLogs/GetRuntimeLogs 未实现而 fail-fast 红错（ADR-049 能力门控缺口）。
// 注：error-diary.ts 网页版刻意早退不调 AddOpLog（日记不落盘），故 web 环默认空——
// 诊断页显示「空日志」而非报错，行为等价于桌面无操作记录场景。
const WEB_IMPORT_LOG_CAP = 500;
const WEB_RUNTIME_LOG_CAP = 300;
const webImportLogs: Array<Record<string, unknown>> = [];
const webRuntimeLogs: Array<Record<string, unknown>> = [];

function pushWebLog(ring: Array<Record<string, unknown>>, cap: number, entry: Record<string, unknown>): void {
  ring.push(entry);
  if (ring.length > cap) ring.splice(0, ring.length - cap); // 仅保留最近 cap 条（环形截断）
}

export async function getWebImportLogs(): Promise<unknown> {
  return webImportLogs.slice(); // 返回副本，防外部篡改内部环
}
export async function getWebRuntimeLogs(): Promise<unknown> {
  return webRuntimeLogs.slice();
}
export async function addWebImportLog(
  modelName: string, sourcePath: string, targetDir: string, fileSize: number, status: string, errMsg: string,
): Promise<void> {
  pushWebLog(webImportLogs, WEB_IMPORT_LOG_CAP, {
    ModelName: modelName, SourcePath: sourcePath, TargetDir: targetDir,
    FileSize: fileSize, Status: status, ErrorMsg: errMsg, Timestamp: Date.now(), Operation: "import",
  });
}
export async function addWebOpLog(
  op: string, modelName: string, sourcePath: string, targetDir: string, fileSize: number, status: string, errMsg: string,
): Promise<void> {
  // 操作日志归入运行时环（webRuntimeLogs），与导入日志环（webImportLogs）分离，
  // 否则 GetRuntimeLogs 恒空、ClearRuntimeLogs 形同虚设（原实现误写入导入环）
  pushWebLog(webRuntimeLogs, WEB_RUNTIME_LOG_CAP, {
    Message: `${op} ${modelName}${errMsg ? " " + errMsg : ""}`.trim(),
    Timestamp: Date.now(),
  });
}

/** 清空导入日志环（webImpls.ClearImportLogs 调用；状态封装在 web-store 内部） */
export function clearWebImportLogs(): void {
  webImportLogs.length = 0;
}
/** 清空运行时日志环（webImpls.ClearRuntimeLogs 调用；状态封装在 web-store 内部） */
export function clearWebRuntimeLogs(): void {
  webRuntimeLogs.length = 0;
}

// --- 标签（config store: tags:<path> = string[]）---
const tagKeyOf = (path: string): string => `tags:${path}`;
export async function getWebTags(path: string): Promise<string[]> {
  const v = await idbGet<string[]>("config", tagKeyOf(path));
  return Array.isArray(v) ? v : [];
}
export async function setWebTags(path: string, tags: string[] | null): Promise<void> {
  // null → 清除标签（对齐桌面 SetModelTags(path, null) 删除语义），而非残留空数组 key
  if (tags === null) {
    await idbDel("config", tagKeyOf(path));
    return;
  }
  // 对齐 go/tags/tags.go SetTags：trimTag（去空白/控制符）+ 去重 + sort.Strings；
  // 空数组等同删除（len(tags)==0 → delete），避免残留空 key
  const seen = new Set<string>();
  const norm: string[] = [];
  for (const t of tags) {
    const trimmed = (t ?? "").trim();
    if (trimmed === "" || seen.has(trimmed)) continue;
    seen.add(trimmed);
    norm.push(trimmed);
  }
  norm.sort();
  if (norm.length === 0) {
    await idbDel("config", tagKeyOf(path));
    return;
  }
  await idbSet("config", tagKeyOf(path), norm);
}
export async function listByTagWeb(tag: string): Promise<string[]> {
  const models = await scanAllWebModels();
  const out: string[] = [];
  // 对齐 go/tags/tags.go ListByTag：tag = trimTag(tag) 后再匹配
  const trimmed = (tag ?? "").trim();
  for (const m of models) {
    const tags = await getWebTags(m.path);
    if (tags.includes(trimmed)) out.push(m.path);
  }
  return out.sort(); // 对齐桌面 tags.Store.ListByTag 的 sort.Strings（稳定输出）
}
export async function allTagsWeb(): Promise<string[]> {
  const models = await scanAllWebModels();
  const counts = new Map<string, number>();
  for (const m of models) {
    for (const t of await getWebTags(m.path)) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  // 对齐桌面 tags.Store.AllTags 契约：按使用次数降序，同次数按名称升序（标签面板热门在前）
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"))
    .map(([t]) => t);
}

// --- 启用开关（config store: ban:<path> = boolean）---
const banKeyOf = (path: string): string => `ban:${path}`;
export async function isWebBanned(path: string): Promise<boolean> {
  return (await idbGet<boolean>("config", banKeyOf(path))) === true;
}
export async function toggleWebEnable(path: string): Promise<boolean> {
  const nextBanned = !(await isWebBanned(path));
  await idbSet("config", banKeyOf(path), nextBanned);
  return !nextBanned; // 返回新的「已启用」状态（对齐桌面 ToggleModelEnable 语义）
}
