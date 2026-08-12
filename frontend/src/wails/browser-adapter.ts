// ===== 浏览器后端适配器（ADR-049 Phase 1 骨架 + Phase 2 IndexedDB 模型库）=====
// Proxy 生成与 Wails AppBindings 同形状的后端：
// - 已实现 binding：Phase 2 起走真实数据（IndexedDB 模型库 + localStorage 配置）
// - 未实现 binding：fail-fast 抛 WebUnsupportedError（明确报错，杜绝 undefined
//   穿透静默失败——治理红线陷阱 #5）
// 虚拟根 /web：让前端路径语义（GetRepoRoot → ScanModelEntries → ReadFileBytes）
// 与桌面一致，业务调用零改动。
import { idbGet, idbSet, idbKeys, idbDel } from "./idb.ts";
import type { AppBindings } from "./types.ts";
import type { ModelEntry } from "../../bindings/ysm-model-manager/go/types/models.ts";
// 复用 dnd-shared 的导入白名单（.json 仅放行 ysm.json，其余须 ALL_EXTS 成员），
// 避免 browser-adapter 另起一套扩展名校验导致漂移
import resourceTypesJson from "../../../resource_types.json" with { type: "json" };
// 网页版头像提取复用前端 YSM 解包能力（替代 Go ExtractAvatarURI，ADR-049 缺口补齐）
import { decodeYsmFile } from "../wasm/ysm-parser.ts";

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
  const { imported, failed } = await importWebFiles(files, "ysm");
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
  pushWebLog(webImportLogs, WEB_IMPORT_LOG_CAP, {
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

// Phase 2 已实现的 binding（其余走 fail-fast Proxy）
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
  // 守卫可达；Build3DSpecFromGeometryJSON 暂以 "{}" 兜底（真实闭环见下方说明）
  GetModel3DSpec: () => Promise.resolve("{}"),
  Build3DSpecFromGeometryJSON: (_geo: string) => {
    // TODO(ADR-049 P2-2): 真实闭环需把 Go app_model.go 的「几何 JSON→spec」变换移植到
    // ysm-parser WASM；当前返回 "{}" 仅保证兜底守卫走通（spec 空→前端降级提示），
    // 网页版 3D 预览仍需该 WASM 绑定才能真正渲染。
    console.warn("[web] Build3DSpecFromGeometryJSON 暂未移植到 WASM（ADR-049 P2-2 遗留），返回空 spec");
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
