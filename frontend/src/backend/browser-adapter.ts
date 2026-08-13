// ===== 浏览器后端适配器（ADR-049 Phase 1 骨架 + Phase 2 IndexedDB 模型库）=====
// Proxy 生成与 Wails AppBindings 同形状的后端：
// - 已实现 binding：Phase 2 起走真实数据（IndexedDB 模型库 + localStorage 配置）
// - 未实现 binding：fail-fast 抛 WebUnsupportedError（明确报错，杜绝 undefined
//   穿透静默失败——治理红线陷阱 #5）
// 虚拟根 /web：让前端路径语义（GetRepoRoot → ScanModelEntries → ReadFileBytes）
// 与桌面一致，业务调用零改动。
import { idbGet, idbSet, idbKeys, idbDel } from "./idb.ts";
import type { AppBindings } from "./types.ts";
import type { ModelEntry, WorkshopCreator, WorkshopSite, AuthorInfo } from "../../bindings/ysm-model-manager/go/types/models.ts";
// 复用 dnd-shared 的导入白名单（.json 仅放行 ysm.json，其余须 ALL_EXTS 成员），
// 避免 browser-adapter 另起一套扩展名校验导致漂移
import resourceTypesJson from "../../../resource_types.json" with { type: "json" };
// 社区/工坊默认数据源（bundled JSON，build 期内联；与 resource_types.json 同源范式）
import creatorsJson from "../../../creators.json" with { type: "json" };
import workshopGithubJson from "../../../workshop-github.json" with { type: "json" };
import workshopSitesJson from "../../../workshop_sites.json" with { type: "json" };
// 网页版头像提取复用前端 YSM 解包能力（替代 Go ExtractAvatarURI，ADR-049 缺口补齐）
import { decodeYsmFile } from "../wasm/ysm-parser.ts";
// rtype 魔法字符串统一走 RESOURCE_TYPES 常量（治理红线 R7）
import { RESOURCE_TYPES } from "../utils/resource/types.ts";

/** 网页版专属错误：binding 浏览器端未实现（Phase 3 能力门控隐藏对应 UI） */
export class WebUnsupportedError extends Error {
  constructor(binding: string) {
    super(`[web] binding ${binding} 浏览器端未实现（ADR-049 Phase 3：能力门控隐藏对应 UI）`);
    this.name = "WebUnsupportedError";
  }
}

/** 网页版虚拟仓库根（路径语义与桌面一致：/web/<type>/<name>/<rel>） */
export const WEB_ROOT = "/web";

/** 导入大小上限 100MB（对齐 import-dnd.ts MAX_FILE_SIZE，桌面 oversize 过滤同口径） */
export const MAX_IMPORT_BYTES = 100 * 1024 * 1024;

// --- key 规约（对齐 MikuMikuAR ADR-177：dir:*: / file:*: 前缀）---
const dirKey = (type: string, name: string): string => `dir:${type}/${name}:`;
const fileKey = (type: string, name: string, rel: string): string =>
  `file:${type}/${name}/${rel}`;

/** 从 /web/<type>/... 提取类型段（ScanModelEntries 参数语义） */
function typeFromWebDir(dir: string): string {
  return dir.replace(/^\/web\//, "").split("/")[0] || "ysm";
}

// --- 主文件优先级（scanWebModels / importWebFiles 共用）---
// 桌面 scanner 主文件为 .ysm 扩展名（IsYsmEntryJSON 白名单仅 ysm.json）。
// 网页版多文件模型（zip 解包后）可能含 a.json 动作文件 / tex_*.png 纹理 /
// ysm.json 清单，须明确优先级：.ysm > ysm.json > 其他非 json > json/压缩包。
const MAIN_FILE_RANK_YSM = 3;
const MAIN_FILE_RANK_JSON = 2;
const MAIN_FILE_RANK_OTHER = 1;
const MAIN_FILE_RANK_NONE = 0;

/** 主文件优先级打分（用于选取模型主文件，rank 高者胜） */
function mainFileRank(rel: string): number {
  if (/\.ysm$/i.test(rel)) return MAIN_FILE_RANK_YSM;
  if (rel.toLowerCase() === "ysm.json") return MAIN_FILE_RANK_JSON;
  if (/\.(json|zip|7z)$/i.test(rel)) return MAIN_FILE_RANK_NONE;
  return MAIN_FILE_RANK_OTHER;
}

/** ArrayBuffer → base64（分块，大文件避免栈溢出） */
export function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// --- 配置（localStorage，缺省返回 {} 让主应用可启动）---
const CFG_KEY = "ysm:config";

function loadWebConfig(): Record<string, unknown> {
  try {
    return JSON.parse(localStorage.getItem(CFG_KEY) ?? "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

function saveWebConfig(cfg: Record<string, unknown>): void {
  try {
    localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
  } catch {
    // 隐私模式等：静默降级（配置不持久化，会话内仍生效）
  }
}

// --- FSA 授权本地仓库（网页版文件来源桥接，替代 Go 本地文件系统扫描）---
// 对齐 MikuMikuAR browser-adapter 的 [doc:adr-177] 方案：网页版无本地文件系统，
// 用 File System Access API 让用户手动授权本地目录，递归扫 .ysm 写入 IndexedDB，
// 作为模型库「文件来源」（ADR-049 能力门控缺口补齐）。
// 复用已有 importWebFiles（File → IDB 落库），不重复造 IDB 写入逻辑。
interface _FsaDirHandle {
  name: string;
  values(): AsyncIterableIterator<FileSystemHandle>;
}

/** 递归遍历目录句柄，收集所有 .ysm 文件的 File 句柄 */
async function _collectYsmFiles(
  dir: _FsaDirHandle,
  out: File[],
): Promise<void> {
  for await (const entry of dir.values()) {
    if (entry.kind === "directory") {
      await _collectYsmFiles(entry as unknown as _FsaDirHandle, out);
    } else if (entry.kind === "file") {
      const f = entry as FileSystemFileHandle;
      if (/\.ysm$/i.test(f.name)) {
        const file = await f.getFile();
        out.push(file);
      }
    }
  }
}

/**
 * 网页版授权本地仓库目录：showDirectoryPicker → 递归扫 .ysm → importWebFiles 落 IDB。
 * 必须在用户手势中调用（FSA 要求）。无 FSA 能力时抛明确错误。
 * 返回 { ok, imported, failed, dir }，dir 为授权目录名（供 UI 展示状态）。
 */
export async function selectLocalRepo(): Promise<{ ok: boolean; imported: number; failed: number; dir: string }> {
  if (typeof (window as { showDirectoryPicker?: unknown }).showDirectoryPicker !== "function") {
    throw new WebUnsupportedError("SelectLocalRepo: 当前环境不支持 File System Access API");
  }
  const handle = (await (window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker()) as _FsaDirHandle;
  const files: File[] = [];
  await _collectYsmFiles(handle, files);
  const { imported, failed } = await importWebFiles(files, RESOURCE_TYPES.YSM);
  return { ok: true, imported, failed, dir: handle.name };
}

// --- 模型库扫描（IDB dir: 前缀 → ModelEntry 列表）---
async function scanWebModels(dir: string): Promise<ModelEntry[]> {
  const type = typeFromWebDir(dir);
  const keys = await idbKeys("files", `dir:${type}/`);
  const entries: ModelEntry[] = [];
  for (const k of keys) {
    const meta = await idbGet<{ name: string; addedAt: number }>("files", k);
    const name = meta?.name ?? k.slice(`dir:${type}/`.length, -1);
    // 汇总该模型全部文件大小；Path/Name 指向主文件（含扩展名，与桌面
    // scanner.go:136 Name=filepath.Base(p) 含扩展名、Ext=原扩展名一致——
    // 否则 loader.ts 的 name.endsWith(ext) 过滤会恒失败使列表为空）。
    // 主文件优先选 .ysm/.json，避免多文件模型（zip 解包后）误选首文件（如 a_tex.png）
    // 导致解码失败；孤儿 dir key（文件被删）无主文件则跳过，避免 Path 以 / 结尾。
    const fileKeys = await idbKeys("files", `file:${type}/${name}/`);
    let size = 0;
    let mainRel = "";
    let mainRank = 0;
    for (const fk of fileKeys) {
      const f = await idbGet<{ size: number }>("files", fk);
      size += f?.size ?? 0;
      const rel = fk.slice(`file:${type}/${name}/`.length);
      const rank = mainFileRank(rel);
      if (rank > mainRank) {
        mainRank = rank;
        mainRel = rel;
      }
    }
    // 仅 .ysm / ysm.json 可作主文件（对齐桌面 IsYsmEntryJSON 白名单）；其余（如 a.json 动作文件）
    // 不得当主文件，避免多文件模型误选导致预览解码失败
    if (mainRank < MAIN_FILE_RANK_JSON) continue;
    // Ext 与桌面一致：小写化 + 无点号保护（lastIndexOf=-1 时 slice(-1) 会取 "E" 之类的字符）
    const dot = mainRel.lastIndexOf(".");
    const ext = dot > 0 ? mainRel.slice(dot).toLowerCase() : "";
    entries.push({
      Name: mainRel,
      Size: size,
      Path: `${dir}/${name}/${mainRel}`,
      Ext: ext,
      Hash: "",
      ModTime: meta?.addedAt ?? Date.now(),
      HasTags: false,
    });
  }
  // 与桌面扫描一致：按名称排序，稳定输出
  entries.sort((a, b) => a.Name.localeCompare(b.Name, "zh-CN"));
  return entries;
}

/** 读文件（/web/<type>/<name>/<rel> → IDB → base64；wasm.ts 解码链零改动复用） */
async function readWebFile(path: string): Promise<string | null> {
  const m = path.match(/^\/web\/([^/]+)\/([^/]+)\/(.+)$/);
  if (!m) return null;
  const [, type, name, rel] = m;
  const f = await idbGet<{ data: ArrayBuffer }>("files", fileKey(type, name, rel));
  if (!f) return null;
  return arrayBufferToBase64(f.data);
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

async function getWebImportLogs(): Promise<unknown> {
  return webImportLogs.slice(); // 返回副本，防外部篡改内部环
}
async function getWebRuntimeLogs(): Promise<unknown> {
  return webRuntimeLogs.slice();
}
async function addWebImportLog(
  modelName: string, sourcePath: string, targetDir: string, fileSize: number, status: string, errMsg: string,
): Promise<void> {
  pushWebLog(webImportLogs, WEB_IMPORT_LOG_CAP, {
    ModelName: modelName, SourcePath: sourcePath, TargetDir: targetDir,
    FileSize: fileSize, Status: status, ErrMsg: errMsg, Time: new Date().toISOString(),
  });
}
async function addWebOpLog(
  op: string, modelName: string, sourcePath: string, targetDir: string, fileSize: number, status: string, errMsg: string,
): Promise<void> {
  // 操作日志归入运行时环（webRuntimeLogs），与导入日志环（webImportLogs）分离，
  // 否则 GetRuntimeLogs 恒空、ClearRuntimeLogs 形同虚设（原实现误写入导入环）
  pushWebLog(webRuntimeLogs, WEB_RUNTIME_LOG_CAP, {
    Op: op, ModelName: modelName, SourcePath: sourcePath, TargetDir: targetDir,
    FileSize: fileSize, Status: status, ErrMsg: errMsg, Time: new Date().toISOString(),
  });
}

// --- 网页版创作者头像批量提取（替代 Go BatchExtractCreatorAvatars）---
// 复用已桥的 ScanModelEntries + ReadFileBytes + 前端 ysm-parser 解包，从 IndexedDB 模型库
// 真实提取头像（ADR-049 能力门控缺口补齐）。单模型失败不中断、返回可能为空 map。
async function batchExtractCreatorAvatars(): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  try {
    const entries = await scanWebModels(`${WEB_ROOT}/ysm`);
    for (const e of entries) {
      // 作者名取自 [作者]模型 命名（对齐 Go app_avatar.go:38 解析口径）
      const base = e.Name.replace(/\.(ysm|zip|7z|json|ban)$/i, "");
      if (!base.startsWith("[")) continue;
      const idx = base.indexOf("]");
      if (idx <= 0) continue;
      const author = base.slice(1, idx).trim();
      if (!author || result[author]) continue;

      const b64 = await readWebFile(e.Path);
      if (!b64) continue;
      let bytes: Uint8Array;
      try {
        bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      } catch {
        continue;
      }
      try {
        const files = await decodeYsmFile(bytes);
        // 优先找 avatar/ 目录下首张图（对齐 Go ExtractAvatarURI 降级分支）
        for (const f of files) {
          const low = f.path.toLowerCase();
          if (!(low.endsWith(".png") || low.endsWith(".jpg") || low.endsWith(".jpeg"))) continue;
          if (!low.startsWith("avatar/") && !low.includes("/avatar/")) continue;
          const mime = low.endsWith(".png") ? "image/png" : "image/jpeg";
          result[author] = `data:${mime};base64,${arrayBufferToBase64(
            f.data.buffer.slice(f.data.byteOffset, f.data.byteOffset + f.data.byteLength) as ArrayBuffer,
          )}`;
          break;
        }
      } catch {
        // 单模型解码失败：跳过，不中断批量（降级为无头像）
      }
    }
  } catch {
    // 模型库不可用：返回空 map（前端 index.ts 已处理空结果，无红错）
  }
  return result;
}

// ===== ADR-049 桥接增强 Batch 1：纯前端可复现绑定（IndexedDB / localStorage / 静态派生）=====
// 这些 binding 桌面走 Go 文件系统/扫描，网页版用 IDB 虚拟根 + 前端计算等价复现，
// 业务调用零改动。数值型条件（骨骼/立方体/纹理）在浏览器端无几何分析能力，
// 由 SearchModels 降级为仅关键词匹配（如实标注，非静默错误）。

/** /web/<type>/<name>/<rel> → 三段解析 */
function parseWebModelPath(p: string): { type: string; name: string; rel: string } | null {
  const m = p.match(/^\/web\/([^/]+)\/([^/]+)\/(.+)$/);
  if (!m) return null;
  return { type: m[1], name: m[2], rel: m[3] };
}
/** /web/<type>/<name> → 类型+模型名（目录形态） */
function parseWebModelDir(p: string): { type: string; name: string } | null {
  const m = p.match(/^\/web\/([^/]+)\/([^/]+)\/?$/);
  if (!m) return null;
  return { type: m[1], name: m[2] };
}

/** 扫描全部资源类型的模型（供标签聚合 / 子目录映射等全库操作） */
async function scanAllWebModels(): Promise<Array<{ type: string; name: string; path: string }>> {
  const rts = (resourceTypesJson as { resourceTypes?: Array<{ id: string }> }).resourceTypes ?? [];
  const out: Array<{ type: string; name: string; path: string }> = [];
  for (const r of rts) {
    const entries = await scanWebModels(`${WEB_ROOT}/${r.id}`);
    for (const e of entries) {
      const pm = parseWebModelPath(e.Path);
      out.push({ type: pm?.type ?? r.id, name: pm?.name ?? e.Name, path: e.Path });
    }
  }
  return out;
}

// --- 标签（config store: tags:<path> = string[]）---
const tagKeyOf = (path: string): string => `tags:${path}`;
async function getWebTags(path: string): Promise<string[]> {
  const v = await idbGet<string[]>("config", tagKeyOf(path));
  return Array.isArray(v) ? v : [];
}
async function setWebTags(path: string, tags: string[] | null): Promise<void> {
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
async function listByTagWeb(tag: string): Promise<string[]> {
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
async function allTagsWeb(): Promise<string[]> {
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
async function isWebBanned(path: string): Promise<boolean> {
  return (await idbGet<boolean>("config", banKeyOf(path))) === true;
}
async function toggleWebEnable(path: string): Promise<boolean> {
  const nextBanned = !(await isWebBanned(path));
  await idbSet("config", banKeyOf(path), nextBanned);
  return !nextBanned; // 返回新的「已启用」状态（对齐桌面 ToggleModelEnable 语义）
}

// --- 搜索（关键词匹配；数值范围条件浏览器端无几何分析，降级忽略）---
async function searchWebModels(
  repoRoot: string,
  keyword: string,
): Promise<Array<{ name: string; path: string; boneCount: number; cubeCount: number; texWidth: number; texHeight: number; hasError: boolean }>> {
  const type = typeFromWebDir(repoRoot);
  const entries = await scanWebModels(`${WEB_ROOT}/${type}`);
  // 对齐桌面 app_scan.go SearchModels：kw = strings.ToLower(strings.TrimSpace(keyword))
  const kw = (keyword || "").trim().toLowerCase();
  return entries
    // 对齐桌面 app_scan.go SearchModels：匹配 name OR path（搜索目录名/作者路径段可命中）
    .filter((e) => !kw || e.Name.toLowerCase().includes(kw) || e.Path.toLowerCase().includes(kw))
    .map((e) => ({ name: e.Name, path: e.Path, boneCount: 0, cubeCount: 0, texWidth: 0, texHeight: 0, hasError: false }));
}

// --- 重命名校验（对齐桌面 fileops.RenameDir/RenameFile：非法字符/空名/穿越拒绝）---
// 缺校验的后果：newName 含 / 或为空会制造坏 key（dir:ysm/a/b:），scanWebModels 仍能扫到，
// 但 parseWebModelDir 三段解析失败 → 该模型变成幽灵（无法删除/再次重命名），且重命名到
// 已存在模型名会静默覆盖 dir key 合并数据（桌面 os.Rename 对目标已存在报错，web 必须对齐）
const INVALID_NAME_CHARS = /[\\/:*?"<>|]/;

/** 校验重命名目标名（对齐桌面 fileops.go 非法字符 + 空名 + 路径段校验，非法则抛错） */
function assertValidRenameName(newName: string, kind: "目录" | "文件"): void {
  const n = (newName || "").trim();
  if (!n) throw new Error(`重命名失败：${kind}名称为空`);
  if (INVALID_NAME_CHARS.test(n)) throw new Error(`重命名失败：${kind}名称包含非法字符`);
  if (n === "." || n === "..") throw new Error(`重命名失败：${kind}名称包含非法路径段`);
}

// --- 删除模型组（dir + 所有 file + 元数据标记）---
async function deleteWebModel(type: string, name: string): Promise<void> {
  await idbDel("files", dirKey(type, name));
  const fks = await idbKeys("files", `file:${type}/${name}/`);
  for (const k of fks) await idbDel("files", k);
  // 清理 ban/tags 标记（best-effort）
  for (const prefix of ["ban:", "tags:"]) {
    const keys = await idbKeys("config", `${prefix}/web/${type}/${name}/`);
    for (const k of keys) await idbDel("config", k);
  }
}

// --- 重命名模型目录（dir + file + 标记整组 rekey）---
async function renameWebDir(oldPath: string, newName: string): Promise<void> {
  const di = parseWebModelDir(oldPath);
  if (!di) return;
  const { type, name } = di;
  assertValidRenameName(newName, "目录");
  const finalName = newName.trim();
  const oldDirKey = dirKey(type, name);
  const newDirKey = dirKey(type, finalName);
  // 目标已存在（含重命名为同名）：对齐桌面「目标已存在」拒绝，防静默覆盖合并两模型数据
  if ((await idbGet("files", newDirKey)) !== undefined) {
    throw new Error(`重命名失败：目标已存在: ${WEB_ROOT}/${type}/${finalName}`);
  }
  const dv = await idbGet("files", oldDirKey);
  if (dv !== undefined) {
    // 同步更新 dir 条目的 name 字段：scanWebModels 用 meta.name 推导文件查找前缀，
    // 若沿用旧名会在重命名后的 file:<type>/<newName>/ 下扫不到模型（列表变空）
    await idbSet("files", newDirKey, { ...(dv as Record<string, unknown>), name: finalName });
    await idbDel("files", oldDirKey);
  }
  const fks = await idbKeys("files", `file:${type}/${name}/`);
  for (const k of fks) {
    const rel = k.slice(`file:${type}/${name}/`.length);
    const val = await idbGet("files", k);
    if (val !== undefined) {
      await idbSet("files", fileKey(type, finalName, rel), val);
      await idbDel("files", k);
    }
  }
  // 标记 rekey（best-effort）：ban:/web/<type>/<name>/<rel> → 新名
  for (const prefix of ["ban:", "tags:"]) {
    const scanPrefix = `${prefix}/web/${type}/${name}/`;
    const keys = await idbKeys("config", scanPrefix);
    for (const k of keys) {
      const suffix = k.slice(scanPrefix.length); // 含原 rel（含前导斜杠），拼接新路径即正确
      const val = await idbGet("config", k);
      if (val !== undefined) {
        await idbSet("config", `${prefix}/web/${type}/${finalName}/${suffix}`, val);
        await idbDel("config", k);
      }
    }
  }
}

// --- 重命名单个文件（模型组内某文件 rekey，保留 .ban 后缀语义由调用方负责）---
async function renameWebFile(oldPath: string, newName: string): Promise<void> {
  const pm = parseWebModelPath(oldPath);
  if (!pm) return;
  const { type, name, rel } = pm;
  assertValidRenameName(newName, "文件");
  const finalName = newName.trim();
  // ysm.json 是模型目录清单（游戏按目录名识别模型）：禁止单文件改名，
  // 否则 scanWebModels 主文件 rank 从 2 掉到 0 → 模型从列表中消失（对齐桌面 fileops.RenameFile ADR-038 D3）
  if (rel.toLowerCase() === "ysm.json") {
    throw new Error("ysm.json 是模型目录清单，请重命名所在文件夹（整组操作）");
  }
  const oldKey = fileKey(type, name, rel);
  const newKey = fileKey(type, name, finalName);
  // 同名（含 trim 归一后）：无事可做，直接返回——不得走下方 idbSet+idbDel（同 key 自删 = 数据丢失回归）
  if (newKey === oldKey) return;
  // 目标已存在：对齐桌面「目标已存在」拒绝，防静默覆盖目标文件内容
  if ((await idbGet("files", newKey)) !== undefined) {
    throw new Error(`重命名失败：目标已存在: ${WEB_ROOT}/${type}/${name}/${finalName}`);
  }
  const val = await idbGet("files", oldKey);
  if (val !== undefined) {
    await idbSet("files", newKey, val);
    await idbDel("files", oldKey);
  }
  // 移动按全路径 key 的 ban/tags 标记
  const newPath = oldPath.replace(/\/[^/]+$/, `/${finalName}`);
  for (const prefix of ["ban:", "tags:"]) {
    const oldMk = `${prefix}${oldPath}`;
    const newMk = `${prefix}${newPath}`;
    const mv = await idbGet("config", oldMk);
    if (mv !== undefined) {
      await idbSet("config", newMk, mv);
      await idbDel("config", oldMk);
    }
  }
}

// --- 子目录映射（resource_types.json → {id: scanDir}）---
async function getWebSubDirMap(): Promise<Record<string, string>> {
  // 对齐 go/types/extensions.go SubDirAll：返回 rt.ScanDir（整合包实例版本目录扫描子目录），
  // 非 storageSubDir（仓库存储子目录）——B1 契约测试暴露的字段错用
  const rts = (resourceTypesJson as { resourceTypes?: Array<{ id: string; scanDir?: string }> }).resourceTypes ?? [];
  const map: Record<string, string> = {};
  for (const r of rts) map[r.id] = r.scanDir ?? "";
  return map;
}

// Phase 2 已实现的 binding（其余走 fail-fast Proxy）
// --- 社区/工坊数据（ADR-049 桥接增强 Batch 2）---
// 网页版无 Go 侧磁盘配置文件：bundled JSON 作默认，localStorage 作用户覆盖层
// （覆盖优先于默认，对齐桌面 Save→Load 语义）。GitHub 仓库列表为只读 bundled。
const WEB_CREATORS_KEY = "web:workshop-creators";
const WEB_SITES_KEY = "web:workshop-sites";
const WEB_GITHUB_KEY = "web:github-repos";

function cloneJson<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function loadWebCreators(): WorkshopCreator[] {
  const ov = typeof localStorage !== "undefined" ? localStorage.getItem(WEB_CREATORS_KEY) : null;
  if (ov !== null) {
    try {
      return JSON.parse(ov) as WorkshopCreator[];
    } catch {
      // 覆盖数据损坏则回退默认 bundled，避免整个社区加载崩溃
    }
  }
  return cloneJson(creatorsJson as unknown as WorkshopCreator[]);
}

function saveWebCreators(list: WorkshopCreator[] | null): void {
  // null → 清除覆盖层，下次 Load 回退默认（对齐桌面 Save(null) 重置语义）
  if (list === null) {
    localStorage.removeItem(WEB_CREATORS_KEY);
    return;
  }
  localStorage.setItem(WEB_CREATORS_KEY, JSON.stringify(list));
}

function loadWebSites(): WorkshopSite[] {
  const ov = typeof localStorage !== "undefined" ? localStorage.getItem(WEB_SITES_KEY) : null;
  if (ov !== null) {
    try {
      return JSON.parse(ov) as WorkshopSite[];
    } catch {
      // 覆盖数据损坏则回退默认 bundled
    }
  }
  return cloneJson(workshopSitesJson as unknown as WorkshopSite[]);
}

function saveWebSites(sites: WorkshopSite[] | null): void {
  if (sites === null) {
    localStorage.removeItem(WEB_SITES_KEY);
    return;
  }
  localStorage.setItem(WEB_SITES_KEY, JSON.stringify(sites));
}

// B2 契约修复：网页版 GitHub 仓库列表补覆盖层（对齐 Go workshop-github.json 用户覆盖语义）。
// 此前为纯 bundled 只读，与 Go「用户配置优先」契约不一致（contract-b2 测试暴露）。
function loadWebGitHubRepos(): WorkshopCreator[] {
  const ov = typeof localStorage !== "undefined" ? localStorage.getItem(WEB_GITHUB_KEY) : null;
  if (ov !== null) {
    try {
      return JSON.parse(ov) as WorkshopCreator[];
    } catch {
      // 覆盖数据损坏则回退默认 bundled
    }
  }
  return cloneJson(workshopGithubJson as unknown as WorkshopCreator[]);
}

function saveWebGitHubRepos(list: WorkshopCreator[] | null): void {
  if (list === null) {
    localStorage.removeItem(WEB_GITHUB_KEY);
    return;
  }
  localStorage.setItem(WEB_GITHUB_KEY, JSON.stringify(list));
}

// --- 作者扫描 / 仓库索引（ADR-049 桥接增强 Batch 3）---
// 纯前端可复现：基于 IDB 模型库（scanWebModels）推导，与桌面 scanner.go 同口径
// （[作者] 前缀提取、计数降序、类型合并）。网页版无磁盘，GenerateRepoIndex 返回
// index.json 内容字符串（调用方在 web 模式触发下载，对齐桌面写盘语义）。
/** 从文件名提取 [作者] 前缀（去除 .ban 后缀）；非括号名返回 null */
function extractBracketAuthor(name: string): string | null {
  let n = name;
  if (n.toLowerCase().endsWith(".ban")) n = n.slice(0, -4);
  if (!n.startsWith("[")) return null;
  const idx = n.indexOf("]");
  if (idx <= 0) return null;
  const author = n.slice(1, idx);
  return author || null;
}

/** 聚合所有资源类型的 IDB 模型条目（网页版「本地仓库」= 虚拟根 /web） */
async function collectAllWebEntries(): Promise<ModelEntry[]> {
  const rts = (resourceTypesJson as { resourceTypes?: Array<{ id: string }> }).resourceTypes ?? [];
  const all: ModelEntry[] = [];
  for (const r of rts) {
    const entries = await scanWebModels(`${WEB_ROOT}/${r.id}`);
    all.push(...entries);
  }
  return all;
}

/** ListModelAuthors 网页版：从模型名 [作者] 前缀统计（计数降序），对齐 scanner.go:265 */
async function listWebAuthors(): Promise<AuthorInfo[]> {
  const entries = await collectAllWebEntries();
  const m = new Map<string, { count: number; sample: string }>();
  for (const e of entries) {
    const a = extractBracketAuthor(e.Name);
    if (!a) continue;
    const cur = m.get(a);
    if (cur) cur.count++;
    else m.set(a, { count: 1, sample: e.Path });
  }
  const result: AuthorInfo[] = [...m.entries()].map(([name, v]) => ({
    Name: name,
    Count: v.count,
    SampleFile: v.sample,
  }));
  result.sort((x, y) => y.Count - x.Count);
  return result;
}

/** ScanLocalAuthors 网页版：按 [作者] 提取并合并类型标签，对齐 scanner.go:297 */
async function scanWebLocalAuthors(): Promise<WorkshopCreator[]> {
  const entries = await collectAllWebEntries();
  const seen = new Set<string>();
  const result: WorkshopCreator[] = [];
  for (const e of entries) {
    const a = extractBracketAuthor(e.Name);
    if (!a) continue;
    const rtype = typeFromWebDir(e.Path);
    const key = `${a}@${rtype}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const existing = result.find((c) => c.name === a);
    if (existing) {
      if (!existing.type?.includes(rtype)) {
        existing.type = existing.type ? `${existing.type};${rtype}` : rtype;
      }
    } else {
      result.push({ name: a, desc: "来自本地仓库", type: rtype });
    }
  }
  return result;
}

/** GenerateRepoIndex 网页版：扫描虚拟根生成 index.json 内容（路径相对 repoPath，正斜杠） */
async function generateWebRepoIndex(repoPath: string): Promise<string> {
  const entries = repoPath && repoPath.startsWith(WEB_ROOT)
    ? await scanWebModels(repoPath)
    : await collectAllWebEntries();
  const list = entries.map((e) => {
    let rel = e.Path;
    if (repoPath && e.Path.startsWith(repoPath)) {
      rel = e.Path.slice(repoPath.length).replace(/^[/\\]/, "");
    } else if (e.Path.startsWith(WEB_ROOT)) {
      rel = e.Path.slice(WEB_ROOT.length).replace(/^[/\\]/, "");
    }
    // 对齐 go/scanner/scanner.go indexEntry json tag：小写 name/path/size + hash,omitempty
    const entry: { name: string; path: string; size: number; hash?: string } = {
      name: e.Name,
      path: rel.replace(/\\/g, "/"),
      size: e.Size,
    };
    if (e.Hash) entry.hash = e.Hash;
    return entry;
  });
  return JSON.stringify(list, null, 2);
}

const webImpls: Record<string, (...args: never[]) => Promise<unknown>> = {
  ScanModelEntries: (dir: string) => scanWebModels(dir),
  // 真实列表入口（loader/import-queue/resource-manager 等 6 处均调 WithLabel 版本）
  ScanModelEntriesWithLabel: (dir: string, _label: string) => scanWebModels(dir),
  ReadFileBytes: (path: string) => readWebFile(path),
  // rtype 含 / 时替换为 _，避免 /web/a/b 破坏 readWebFile 三段解析
  GetRepoRoot: (rtype: string) => Promise.resolve(`${WEB_ROOT}/${rtype.replace(/\//g, "_")}`),
  GetDefaultRepoRoot: () => Promise.resolve(WEB_ROOT),
  // 注册表驱动视图（recycle-bin/oldest-models/community/app-resource-manager）依赖
  // LoadResourceTypes；resource_types.json 已由 vite 构建期内联（extensions.ts 同源），
  // 直接返回同形状 JSON 字符串，消除 registry.ts 静默降级为空
  LoadResourceTypes: () => Promise.resolve(JSON.stringify(resourceTypesJson)),
  // P2 修复（审核）：网页版无 Go 侧 version.Version，补版本 binding 让导航/设置页
  // 不再触发 fail-fast（原缺失导致 app-nav catch 兜底硬编码 "v1.0.0"、设置页版本
  // 卡「加载中」）；返回 "web" 语义版本，与桌面版本号区分
  GetAppVersion: () => Promise.resolve("web"),
  CurrentVersion: () => Promise.resolve("web"),
  // 网页版无 Go 侧 Node 解码通道：GetModel3DSpec 恒空让 model3d-loader 的 WASM 兜底
  // 守卫可达。P2-2 已闭环（2026-08-12）：网页版渲染走 model3d-loader web 分支的
  // buildSpecFromGeometryJSON（spec-builder.ts 纯 TS 移植，Go app_model.go 同契约），
  // 本 binding 桩仅供 Android 兜底通道形状占位（网页版不会调用到它）。
  GetModel3DSpec: () => Promise.resolve("{}"),
  Build3DSpecFromGeometryJSON: (_geo: string) => {
    // 占位：网页版不调此 binding（TS 移植替代，见 spec-builder.ts）；仅保持 Proxy
    // binding 形状完整，Android 路径仍走 Go 真实现
    return Promise.resolve("{}");
  },
  LoadAppConfig: () => Promise.resolve(loadWebConfig()),
  SaveAppConfig: (filesRoot: string, rpRoot: string, mcRoot: string, linkMode: string, theme: string) => {
    // 字段名对齐 AppConfig（消费方读 resourcepackRoot，非 rpRoot）；spread 旧配置避免
    // 整体覆盖丢失 ysmRoot/shaderpackRoot 等；空串保留旧值（对齐桌面 orDefault 语义）
    const prev = loadWebConfig();
    saveWebConfig({
      ...prev,
      filesRoot: filesRoot || prev.filesRoot,
      resourcepackRoot: rpRoot || prev.resourcepackRoot,
      mcRoot: mcRoot || prev.mcRoot,
      linkMode: linkMode || prev.linkMode,
      theme: theme || prev.theme,
    });
    return Promise.resolve();
  },
  // 网页版内存日志环（替代 Go ImportLog / runtimeLogs，消除诊断页 fail-fast 红错）
  GetImportLogs: () => getWebImportLogs(),
  GetRuntimeLogs: () => getWebRuntimeLogs(),
  AddImportLog: (modelName: string, sourcePath: string, targetDir: string, fileSize: number, status: string, errMsg: string) =>
    addWebImportLog(modelName, sourcePath, targetDir, fileSize, status, errMsg),
  AddOpLog: (op: string, modelName: string, sourcePath: string, targetDir: string, fileSize: number, status: string, errMsg: string) =>
    addWebOpLog(op, modelName, sourcePath, targetDir, fileSize, status, errMsg),
  // 网页版创作者头像批量提取（复用 ScanModelEntries + ReadFileBytes + ysm-parser）
  BatchExtractCreatorAvatars: () => batchExtractCreatorAvatars(),
  // 网页版 FSA 授权本地仓库目录（替代 Go 本地文件系统扫描，作为模型库文件来源）
  SelectLocalRepo: () => selectLocalRepo(),
  // ===== ADR-049 桥接增强 Batch 1：纯前端可复现绑定 =====
  // 搜索：关键词匹配（数值范围条件浏览器端无几何分析，降级忽略，如实标注）
  SearchModels: (repoRoot: string, keyword: string, ..._rest: number[]) => searchWebModels(repoRoot, keyword),
  // 启用开关：ban 标记翻转，返回新「已启用」态（对齐桌面 ToggleModelEnable 语义）
  IsFileBanned: (path: string) => isWebBanned(path),
  ToggleModelEnable: (path: string) => toggleWebEnable(path),
  // 标签：config store tags:<path>
  GetModelTags: (path: string) => getWebTags(path),
  SetModelTags: (path: string, tags: string[] | null) => setWebTags(path, tags),
  ListByTag: (tag: string) => listByTagWeb(tag),
  AllTags: () => allTagsWeb(),
  // 删除模型组（dir + file + 标记）
  DeleteModelDir: (path: string) => {
    const pm = parseWebModelPath(path);
    return pm ? deleteWebModel(pm.type, pm.name) : Promise.resolve();
  },
  RemoveDir: (dir: string) => {
    const di = parseWebModelDir(dir);
    return di ? deleteWebModel(di.type, di.name) : Promise.resolve();
  },
  // 重命名：模型目录整组 rekey / 组内单文件 rekey
  RenameDir: (oldPath: string, newName: string) => renameWebDir(oldPath, newName),
  RenameFile: (oldPath: string, newName: string) => renameWebFile(oldPath, newName),
  // 日志环清空
  ClearImportLogs: () => {
    webImportLogs.length = 0;
    return Promise.resolve();
  },
  ClearRuntimeLogs: () => {
    webRuntimeLogs.length = 0;
    return Promise.resolve();
  },
  // 子目录映射（resource_types.json 派生）
  GetSubDirMap: () => getWebSubDirMap(),
  // ===== ADR-049 桥接增强 Batch 3：作者扫描 / 仓库索引（基于 IDB 模型库）=====
  ListModelAuthors: () => Promise.resolve(listWebAuthors()),
  ScanLocalAuthors: () => Promise.resolve(scanWebLocalAuthors()),
  GenerateRepoIndex: (repoPath: string) => Promise.resolve(generateWebRepoIndex(repoPath)),
  // ===== ADR-049 桥接增强 Batch 2：社区/工坊只读 + 本地覆盖写入 =====
  // bundled 默认 + localStorage 覆盖（对齐桌面 Save→Load 语义）；GitHub 仓库列表只读
  LoadWorkshopCreators: () => Promise.resolve(loadWebCreators()),
  SaveWorkshopCreators: (list: WorkshopCreator[] | null) => {
    saveWebCreators(list);
    return Promise.resolve();
  },
  LoadGitHubRepos: () => Promise.resolve(loadWebGitHubRepos()),
  SaveGitHubRepos: (list: WorkshopCreator[] | null) => {
    saveWebGitHubRepos(list);
    return Promise.resolve();
  },
  DefaultWorkshopSites: () => Promise.resolve(loadWebSites()),
  SaveWorkshopSites: (sites: WorkshopSite[] | null) => {
    saveWebSites(sites);
    return Promise.resolve();
  },
};

/**
 * 网页版导入：File API/拖拽 → IndexedDB（ADR-049 Phase 2 数据层）。
 * UI 入口（拖拽区/导入按钮）由 Phase 3 能力门控接入；本函数独立可测。
 * 返回 {imported, failed} 供调用方提示。
 *
 * 过滤与分组（对齐桌面 dnd-shared 白名单 + import-dnd 100MB 上限）：
 * - 多文件模型按 stem 分组：文件夹拖入扁平化后，同 stem（webkitRelativePath 首段
 *   或去扩展名 basename）的辅助文件（avatar.png / main.json / tex_*.png）并入该模型，
 *   仅主文件建 dir 条目 → 消灭「每文件独立成模型」的碎片化
 * - 组内须存在主文件（.ysm / ysm.json），否则整组失败（散落 .txt/.png/任意 json
 *   无主文件 → 明确 failed 提示，而非假成功入库）
 * - .zip/.7z 组内无 .ysm/ysm.json 主文件 → 整组失败（网页版无解包通道，明确降级，
 *   绝不假成功入库）
 * - 超出 100MB 跳过（对齐 import-dnd oversize 过滤）
 */
export async function importWebFiles(
  files: File[],
  type: string,
): Promise<{ imported: number; failed: number }> {
  let imported = 0;
  let failed = 0;
  // 单模型分组：stem → 组内文件（先归组再统一落库，保证 dir/file 原子性）
  const groups = new Map<string, File[]>();
  for (const f of files) {
    try {
      const stem = stemOf(f);
      if (!stem) {
        failed++;
        continue;
      }
      const arr = groups.get(stem);
      if (arr) arr.push(f);
      else groups.set(stem, [f]);
    } catch {
      failed++;
    }
  }
  for (const [stem, group] of groups) {
    // P2 修复（子代理审计）：组级回滚——原实现中途 idbSet 失败时整组计 failed，
    // 但已写入的文件条目无 dirKey 引用 → 孤儿数据残留（scanWebModels 扫不到、
    // 占空间且永不清理）。写入前记录已写 key，失败时逐条删除（best-effort 回滚）
    // P3 修复（code review）：回滚只删「本次新建」的 key——重导入同一 stem（更新
    // 覆盖）时 fileKey/dirKey 确定性命中先前成功导入的条目，若中途失败无差别回滚
    // 会删掉旧模型的主文件 → 模型从浏览器库中整个消失（数据可见性回归）。
    // 写入前记录 preExisted，回滚跳过既有 key，保留先前成功导入的数据。
    const writtenKeys: Array<{ key: string; preExisted: boolean }> = [];
    try {
      // 组内须存在主文件（.ysm / ysm.json），否则整组失败，每个文件各计一次 failed
      // （散落 .txt/.png/任意 .json / 未解包的 .zip/.7z 无主文件 → failed，防杂物独立成模型）
      let hasMain = false;
      for (const f of group) {
        if (mainFileRank(f.name) >= MAIN_FILE_RANK_JSON) {
          hasMain = true;
          break;
        }
      }
      if (!hasMain) {
        failed += group.length;
        continue;
      }
      let wrote = false;
      let fileFails = 0;
      for (const f of group) {
        // 大小上限 100MB（对齐 import-dnd 桌面 oversize 过滤）；辅助文件超限跳过不影响组成功
        if (f.size > MAX_IMPORT_BYTES) {
          fileFails++;
          continue;
        }
        const data = await f.arrayBuffer();
        const k = fileKey(type, stem, f.name);
        const preExisted = (await idbGet("files", k)) !== undefined;
        await idbSet("files", k, {
          data,
          size: data.byteLength,
          mime: f.type || "application/octet-stream",
        });
        writtenKeys.push({ key: k, preExisted });
        wrote = true;
      }
      if (!wrote) {
        // 全部文件超限/写失败 → 整组失败（按文件数计，避免与 fileFails 重复）
        failed += group.length;
        continue;
      }
      const dk = dirKey(type, stem);
      const dkPreExisted = (await idbGet("files", dk)) !== undefined;
      await idbSet("files", dk, { name: stem, addedAt: Date.now() });
      writtenKeys.push({ key: dk, preExisted: dkPreExisted });
      imported++;
      failed += fileFails;
    } catch {
      // P2 修复：回滚已写条目，防孤儿数据（dir/file 依赖关系破坏）；
      // P3 修复（code review）：跳过 preExisted 的 key（重导入失败不删旧数据）
      for (const { key, preExisted } of writtenKeys) {
        if (preExisted) continue;
        try {
          await idbDel("files", key);
        } catch {
          // best-effort：回滚失败静默（已处于失败路径，删除失败不改变结果）
        }
      }
      failed += group.length;
    }
  }
  return { imported, failed };
}

/** 单个 File 的模型 stem：webkitRelativePath 首段（文件夹拖入）或去扩展名 basename */
function stemOf(f: File): string {
  const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath;
  if (rel) {
    const top = rel.split("/")[0];
    if (top) return top;
  }
  return f.name.replace(/\.\w+$/, "");
}

// fail-fast 函数缓存：保证同一 binding 返回稳定引用（便于 Phase 3 能力探测 /
// spyOn / 记忆化）——避免每次 get 新建函数导致 adapter.Foo !== adapter.Foo
const failFastCache = new Map<string, (...args: never[]) => Promise<never>>();
function makeFailFast(name: string): (...args: never[]) => Promise<never> {
  let f = failFastCache.get(name);
  if (!f) {
    f = async () => {
      throw new WebUnsupportedError(name);
    };
    failFastCache.set(name, f);
  }
  return f;
}

/** 浏览器后端（Proxy 动态形状，未实现 binding 一律 fail-fast） */
export const browserAdapter = new Proxy({} as Record<string, unknown>, {
  get(_target, prop) {
    // thenable 探测陷阱：await/`Promise.resolve(adapter)` 会访问 .then——
    // 若返回 async 函数则被误判为 thenable，await 调它抛错导致挂起。
    // 返回 undefined 让 adapter 不是 thenable。
    if (prop === "then") return undefined;
    // symbol（如 Symbol.toStringTag）不拦截，返回 undefined 走默认行为
    if (typeof prop === "symbol") return undefined;
    const name = String(prop);
    // Object 原型成员（toString/constructor/valueOf/hasOwnProperty 等）不得路由到
    // fail-fast：`String(adapter)` / adapter.toString() 会拿到 rejected Promise，
    // 交由 target 原型链的正常实现（Reflect.get 沿原型找函数）
    if (PROTOTYPE_MEMBERS.has(name)) return Reflect.get(_target, prop);
    if (name in webImpls) return webImpls[name];
    return makeFailFast(name);
  },
  // Phase 3 能力门控探测：`'Foo' in browserAdapter` 应反映是否真实现
  has(_target, prop) {
    return String(prop) in webImpls;
  },
}) as unknown as AppBindings;

/** Object 原型自有成员白名单（Proxy get 不拦截，交由默认原型行为） */
const PROTOTYPE_MEMBERS = new Set([
  "toString",
  "toLocaleString",
  "valueOf",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "constructor",
]);
