// ===== 网页版文件系统职责（ADR-040 拆分：browser-adapter.ts 职责切分产物）=====
// 文件系统类操作：IndexedDB 虚拟根 /web 的扫描/读写/导入/删除/重命名/子目录映射，
// 以及 FSA 授权本地仓库导入。被 web-store（标签聚合扫描）与 web-community
// （作者扫描/仓库索引）复用；browser-adapter.ts 从本文件 import 组装 webImpls。
// 共享原语（WebUnsupportedError / WEB_ROOT / MAX_IMPORT_BYTES / arrayBufferToBase64）
// 见 web-common.ts。
//
// ┌─ 快速跳转 ───────────────────────────────────────────────────────────────────┐
// │  §1  key 规约            → L47    dirKey / fileKey                            │
// │  §2  主文件优先级         → L57    MAIN_FILE_RANK_* / mainFileRank             │
// │  §3  FSA 授权持久化      → L90    restore/reauthorize/rescan FSA handle        │
// │  §4  模型库扫描           → L230   scanWebModels / scanAllWebModels            │
// │  §5  文件读取            → L280   readWebFile                                   │
// │  §6  NBT/体素 meta 读取   → L293   readVoxelJson / readNbtMetaJson             │
// │  §7  pack/shaderpack 读取 → L352   readPackMetaJson / readShaderpackLangJson   │
// │  §8  路径解析            → L396   parseWebModelPath / parseWebModelDir        │
// │  §9  列表                → L424   listWebModelDirFiles                        │
// │  §10 搜索                → L457  searchWebModels                               │
// │  §11 重命名              → L553  assertValidRenameName / renameWebDir/File    │
// │  §12 删除               → L569  deleteWebModel                                 │
// │  §13 移动/复制          → L673  rekeyWebModelGroup / moveOrCopyWebModel       │
// │  §14 子目录映射          → L795  getWebSubDirMap / collectAllWebEntries        │
// │  §15 导入分组            → L816  importWebFiles / expandZipFiles / stem helpers│
// │  §16 binding 装配        → L1102 webFsBindings（Top 6 注册表驱动）            │
// └──────────────────────────────────────────────────────────────────────────────┘
import { idbGet, idbSet, idbKeys, idbDel } from "./idb.ts";
import { t } from "../core/i18n/t.ts";
import type { ModelEntry } from "../../bindings/ysm-model-manager/go/types/models.ts";
// 复用 dnd-shared 的导入白名单（.json 仅放行 ysm.json，其余须 ALL_EXTS 成员），
// 避免 browser-adapter 另起一套扩展名校验导致漂移
import resourceTypesJson from "../../../resource_types.json" with { type: "json" };
// rtype 魔法字符串统一走 RESOURCE_TYPES 常量（治理红线 R7）
import { RESOURCE_TYPES } from "../utils/resource/types.ts";
// ADR-066 识别层对齐：RESOURCE_EXTS（resource_types.json 派生）驱动主文件判定，
// 让网页版模型库显示全类型（.nbt/.schematic/.litematic/.pmx/.pmd/.vrca/.vrm），
// 不再 YSM 单类型硬编码（原 mainFileRank 只认 .ysm/.zip/ysm.json）
import { RESOURCE_EXTS } from "../utils/resource/extensions.ts";
import { WebUnsupportedError, WEB_ROOT, MAX_IMPORT_BYTES, arrayBufferToBase64, base64ToBytes, parseWebPath, parseWebDirPath, webDirType, isWebPath } from "./web-common.ts";
// R2 导入增强：ZIP 解压（extractZip 解出文件 + gbkDecodeEntry 还原中文名）；
// detectZipType 供 DetectResourceType 歧义容器内容指纹（ADR-066 web 识别层）
import { extractZip, gbkDecodeEntry, detectZipType } from "./extract.ts";
import { resolveTypeSafe } from "../utils/resource/types.ts";
// ADR-070 M1：蓝图/投影 meta 读取（NBT 解析 + 三个视图提取，TS 平移 go/litematic/parser.go）
import { parseNbtRoot, litematicMetaView, nbtStructureView, schematicSummaryView } from "./nbt-parse.ts";
// ADR-070 M2：蓝图/投影 voxel 读取（TS 平移 go/litematic/voxel.go；parseNbtRootExact 提供
// LongArray 精确 64 位——BlockStates 打包位解码必需，number 归一会丢低 10 位）
import { parseNbtRootExact } from "./nbt-parse.ts";
import { litematicVoxelView, nbtVoxelView, schematicVoxelView, type VoxelData } from "./voxel-parse.ts";
// 资源包/光影包详情 meta 读取（TS 平移 go/packs/mcmeta.go 的解析层；binding 装配见下方
// webFsBindings 的 ReadPackMeta/ReadShaderpackLang 条目——读 IDB → 解 zip → 本文件纯解析）
import { findZipEntry, parsePackMetaJson, parseShaderpackLang, packPngToThumbnail } from "./pack-meta.ts";
// YSM 头部/摘要 binding web 实现（TS 平移 go/ysm/header.go + summary.go；纯解析在
// ysm-header.ts，本文件只做 IDB 读取装配。消费方：import-queue-data.ts:278 作者/tips
// 预填、rename.ts:92 重命名 tips、detail.ts:58-62 详情 stats/license、loader.ts:140 作者兜底）
import {
  parseYsmHeaderFromBytes,
  extractYsmSummaryFromBytes,
  emptyYsmHeader,
  emptyYsmSummary,
} from "./ysm-header.ts";
// ADR-071 #6：SearchModels 数值条件的统计来源 —— Web Worker 批量统计
// （Worker 内独立加载 WASM + open IndexedDB，主线程零解析负载；不可用/失败降级）
import { batchStatsWebModels, type WebModelStats } from "./web-stats.ts";

// ===== §1 key 规约（dir:*: / file:*: 前缀，ADR-177 对齐）=====
// --- key 规约（对齐 MikuMikuAR ADR-177：dir:*: / file:*: 前缀）---
const dirKey = (type: string, name: string): string => `dir:${type}/${name}:`;
const fileKey = (type: string, name: string, rel: string): string =>
  `file:${type}/${name}/${rel}`;

/** 从 /web/<type>/... 提取类型段（ScanModelEntries 参数语义） */
export function typeFromWebDir(dir: string): string {
  return webDirType(dir) || RESOURCE_TYPES.YSM;
}

// ===== §2 主文件优先级（注册表驱动，ADR-066）=====
// --- 主文件优先级（scanWebModels / importWebFiles 共用）---
// ADR-066 识别层对齐 Go scanner：主文件判定注册表驱动——每类型注册表扩展名都是
// 该类型主文件；.json 仅 ysm.json（IsYsmEntryJSON 口径）；.ysm/.zip 为 YSM 主文件
// （多文件模型竞争时优先）。原实现只认 .ysm/.zip/ysm.json，蓝图/投影/MMD/VRC
// 的 .nbt/.schematic/.litematic/.pmx/.pmd/.vrca/.vrm 全被归为辅助文件不显示。
const MAIN_FILE_RANK_YSM = 3;
const MAIN_FILE_RANK_JSON = 2;
const MAIN_FILE_RANK_TYPE = 1; // 其他类型主文件（注册表扩展名，.json 除外）
const MAIN_FILE_RANK_NONE = 0;

/** 注册表主文件扩展名集合（全类型，.json 除外——仅 ysm.json 是主文件） */
const TYPE_MAIN_EXTS: Set<string> = (() => {
  const s = new Set<string>();
  for (const exts of Object.values(RESOURCE_EXTS)) {
    for (const e of exts) {
      if (e !== ".json") s.add(e.toLowerCase());
    }
  }
  return s;
})();

/** 主文件优先级打分（注册表驱动：YSM .ysm/.zip > ysm.json > 其他类型主文件 > 辅助文件）。
 * 不剥 .ban/.disabled——禁用模型在导入层即被拒（与 Go 导入层拒绝 .ban 一致）。 */
function mainFileRank(rel: string): number {
  const low = rel.toLowerCase();
  const dot = low.lastIndexOf(".");
  const ext = dot > 0 ? low.slice(dot) : "";
  if (ext === ".json") return low === "ysm.json" ? MAIN_FILE_RANK_JSON : MAIN_FILE_RANK_NONE;
  if (ext === ".ysm" || ext === ".zip") return MAIN_FILE_RANK_YSM;
  if (TYPE_MAIN_EXTS.has(ext)) return MAIN_FILE_RANK_TYPE;
  return MAIN_FILE_RANK_NONE;
}

// ===== §3 FSA 授权持久化（网页版本地仓库目录授权）=====
// --- FSA 授权本地仓库（网页版文件来源桥接，替代 Go 本地文件系统扫描）---
// 对齐 MikuMikuAR browser-adapter 的 [doc:adr-177] 方案：网页版无本地文件系统，
// 用 File System Access API 让用户手动授权本地目录，递归扫 .ysm 写入 IndexedDB，
// 作为模型库「文件来源」（ADR-049 能力门控缺口补齐）。
// 复用已有 importWebFiles（File → IDB 落库），不重复造 IDB 写入逻辑。
interface _FsaDirHandle {
  name: string;
  values(): AsyncIterableIterator<FileSystemHandle>;
}

// ===== FSA 根目录句柄持久化（R2 数据互通，参照 MikuMikuAR ADR-180/183）=====
// 网页版重启后浏览器不会自动保留 FSA 授权，但 FileSystemDirectoryHandle 可
// 结构化克隆存入 IndexedDB（原生支持）——下次启动 queryPermission 恢复授权，
// 免用户重新选目录。设计要点：
//   - restoreFsaRootHandle：仅 queryPermission 恢复，绝不 requestPermission
//     （后者须用户手势，启动期无手势会被浏览器拦截）
//   - getFsaAuthState：权限三态判定（unsupported/none/granted/revoked），供 UI 引导
//   - reauthorizeFsaRoot：须在用户手势内调用（confirm 点击），主动 requestPermission
const FSA_ROOT_KEY = "fsaRootHandle";

/** FSA 授权状态（供 UI 启动引导，不触发权限弹窗） */
export type FsaAuthState = "unsupported" | "none" | "granted" | "revoked";

/** 持久化根目录句柄（用户手势内调用，showDirectoryPicker 后落库） */
async function saveFsaRootHandle(h: unknown): Promise<void> {
  try {
    await idbSet("config", FSA_ROOT_KEY, h);
  } catch {
    // 句柄结构化克隆失败（罕见）→ 仅本次调用用局部 handle，后续会话需重新授权
  }
}

/** 从 IndexedDB 恢复持久化句柄（仅 queryPermission，启动自愈；失败/null → 降级手动重选） */
async function restoreFsaRootHandle(): Promise<unknown> {
  const h = await idbGet<unknown>("config", FSA_ROOT_KEY);
  if (!h) return null;
  const permHandle = h as FileSystemDirectoryHandle & {
    queryPermission?: (o: { mode: "readwrite" }) => Promise<PermissionState>;
  };
  if (typeof permHandle.queryPermission === "function") {
    try {
      if ((await permHandle.queryPermission({ mode: "readwrite" })) === "granted") {
        return h;
      }
    } catch {
      /* 句柄失效（权限撤销/隐私模式）→ 降级手动重选 */
    }
  }
  // 不支持 queryPermission 的旧实现：保守不自动恢复，避免静默失败
  return null;
}

/** 查询根目录授权状态（不触发权限弹窗） */
export async function getFsaAuthState(): Promise<FsaAuthState> {
  if (typeof (window as { showDirectoryPicker?: unknown }).showDirectoryPicker !== "function") {
    return "unsupported";
  }
  const h = await idbGet<unknown>("config", FSA_ROOT_KEY);
  if (!h) return "none";
  const permHandle = h as FileSystemDirectoryHandle & {
    queryPermission?: (o: { mode: "readwrite" }) => Promise<PermissionState>;
  };
  if (typeof permHandle.queryPermission === "function") {
    try {
      return (await permHandle.queryPermission({ mode: "readwrite" })) === "granted"
        ? "granted"
        : "revoked";
    } catch {
      return "revoked";
    }
  }
  return "revoked"; // 老实现不支持 queryPermission，保守视为需重选
}

/** 对持久化句柄重新请求授权（不重选目录）。须用户手势内调用，成功写入内存句柄返回 true */
export async function reauthorizeFsaRoot(): Promise<boolean> {
  const h = await idbGet<unknown>("config", FSA_ROOT_KEY);
  if (!h) return false;
  const permHandle = h as FileSystemDirectoryHandle & {
    requestPermission?: (o: { mode: "readwrite" }) => Promise<PermissionState>;
  };
  if (typeof permHandle.requestPermission !== "function") return false;
  try {
    if ((await permHandle.requestPermission({ mode: "readwrite" })) === "granted") {
      return true;
    }
  } catch {
    /* 用户拒绝 / 句柄失效 */
  }
  return false;
}

/** 启动自愈：恢复持久化句柄并重扫入库（R2 数据互通，参照 MikuMikuAR ScanModelDir） */
export async function rescanFsaRoot(): Promise<{ ok: boolean; imported: number; failed: number; dir: string }> {
  const h = await restoreFsaRootHandle();
  if (!h) return { ok: false, imported: 0, failed: 0, dir: "" };
  return scanFsaHandle(h);
}

/** 扫描 FSA 目录句柄 → importWebFiles 落库（selectLocalRepo / rescanFsaRoot 共用） */
async function scanFsaHandle(handle: unknown): Promise<{ ok: boolean; imported: number; failed: number; dir: string }> {
  const files: File[] = [];
  await _collectModelFiles(handle as _FsaDirHandle, files);
  const { imported, failed } = await importWebFiles(files, RESOURCE_TYPES.YSM);
  return { ok: true, imported, failed, dir: (handle as _FsaDirHandle).name };
}

/** 递归遍历目录句柄，收集所有 .ysm 文件的 File 句柄 */
async function _collectModelFiles(
  dir: _FsaDirHandle,
  out: File[],
): Promise<void> {
  for await (const entry of dir.values()) {
    if (entry.kind === "directory") {
      await _collectModelFiles(entry as unknown as _FsaDirHandle, out);
    } else if (entry.kind === "file") {
      const f = entry as FileSystemFileHandle;
      if (mainFileRank(f.name) > MAIN_FILE_RANK_NONE) {
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
    throw new WebUnsupportedError(t("webFs.fsaUnsupported"));
  }
  const handle = (await (window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker());
  // R2 持久化：句柄结构化克隆落库，下次启动无手势 queryPermission 自愈免重选
  await saveFsaRootHandle(handle);
  return scanFsaHandle(handle);
}

// ===== §4 模型库扫描 =====
// --- 模型库扫描（IDB dir: 前缀 → ModelEntry 列表）---
export async function scanWebModels(dir: string): Promise<ModelEntry[]> {
  const type = typeFromWebDir(dir);
  const keys = await idbKeys("files", `dir:${type}/`);
  const entries: ModelEntry[] = [];
  for (const k of keys) {
    const meta = await idbGet<{ name: string; addedAt: number }>("files", k);
    const name = meta?.name ?? k.slice(`dir:${type}/`.length, -1);
    // 汇总该模型全部文件大小；Path/Name 指向主文件（含扩展名，与桌面
    // scanner.go:136 Name=filepath.Base(p) 含扩展名、Ext=原扩展名一致——
    // 否则 loader.ts 的 name.endsWith(ext) 过滤会恒失败使列表为空）。
    // 主文件优先选 .ysm/.zip/.json，避免多文件模型误选首文件（如 a_tex.png）
    // 导致解码失败；孤儿 dir key（文件被删）无主文件则跳过，避免 Path 以 / 结尾。
    const fileKeys = await idbKeys("files", `file:${type}/${name}/`);
    let size = 0;
    let mainRel = "";
    let mainRank = 0;
    for (const fk of fileKeys) {
      const f = await idbGet<{ size: number }>("files", fk);
      size += f?.size ?? 0;
      const rel = fk.slice(`file:${type}/${name}/`.length);
      // 嵌套 rel（含 /，如 tex/face.png）不参与主文件竞争：主文件必须在模型组根层
      // （对齐桌面目录模型：组根放 ysm.json/main.json，子目录为纹理/附属资源）
      const rank = rel.includes("/") ? MAIN_FILE_RANK_NONE : mainFileRank(rel);
      if (rank > mainRank) {
        mainRank = rank;
        mainRel = rel;
      }
    }
    // 仅 .ysm / ysm.json 可作主文件（对齐桌面 IsYsmEntryJSON 白名单）；其余（如 a.json 动作文件）
    // 不得当主文件，避免多文件模型误选导致预览解码失败
    if (mainRank < MAIN_FILE_RANK_TYPE) continue;
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

// ===== §5 文件读取（readWebFile）=====
/** 读文件（/web/<type>/<rest> → IDB → base64；wasm.ts 解码链零改动复用）
 *  模型组 name 与组内 rel 在 file key 中无缝拼接（file:<type>/<name>/<rel>），
 *  多段 name（目录树，如 /web/ysm/分类1/狐狸/狐狸.ysm）无需拆分边界：
 *  直接以 <type> 后全部路径段作 key（对齐 MikuMikuAR dir key 匹配模式）。 */
export async function readWebFile(path: string): Promise<string | null> {
  const pm = parseWebPath(path);
  if (!pm) return null;
  const f = await idbGet<{ data: ArrayBuffer }>("files", `file:${pm.type}/${pm.rest}`);
  if (!f) return null;
  return arrayBufferToBase64(f.data);
}

/**
 * ADR-070 M2：蓝图/投影 voxel binding 公共读取骨架（TS 平移 go/litematic/voxel.go 的
 * openGzRoot + BuildVoxelData/BuildNbtVoxelData/BuildSchematicVoxelData + internal/app
 * marshalVoxelData）。读 IDB → base64 → 字节 → parseNbtRootExact → voxelView → JSON 字符串。
 * 任何一步失败（文件缺失 / 畸形 NBT / 视图判定无效）→ "{}"（对齐 Go binding 契约：
 * marshalVoxelData error → "{}"）。
 * 体素渲染上限对齐 internal/app/resource_bindings.go voxelMaxBlocks 默认 200000
 * （网页版无 AppConfig，直接用默认值）。
 */
const VOXEL_MAX_BLOCKS = 200000;

async function readVoxelJson(
  path: string,
  view: (root: Record<string, unknown>, maxBlocks: number) => VoxelData | null,
): Promise<string> {
  try {
    const b64 = await readWebFile(path);
    if (!b64) return voxelErrorJson("文件读取失败或不存在");
    const bytes = base64ToBytes(b64);
    if (!bytes) return voxelErrorJson("文件解码失败");
    const root = parseNbtRootExact(bytes);
    const data = view(root, VOXEL_MAX_BLOCKS);
    if (!data) return voxelErrorJson("无法解析为有效的体素结构（格式不支持或字段缺失）");
    return JSON.stringify(data);
  } catch (err) {
    // 对齐 Go marshalVoxelData 的 {error} 契约：失败带具体原因，
    // 前端可区分「解析失败」与「空数据」，不再吞成 "{}"
    return voxelErrorJson(err instanceof Error ? err.message : String(err));
  }
}

/** 体素失败契约 JSON：{"error": string}（对齐 Go internal/app voxelErrorJSON） */
function voxelErrorJson(msg: string): string {
  try {
    return JSON.stringify({ error: msg });
  } catch {
    return '{"error":"json stringify failed"}';
  }
}

// ===== §6 NBT/体素 meta 读取（ADR-070 M1/M2）=====
/**
 * ADR-070 M1：蓝图/投影 meta binding 公共读取骨架（TS 平移 go/litematic/parser.go 的
 * openGzRoot + 视图提取）。读 IDB → base64 → 字节 → parseNbtRoot → 视图提取 → JSON 字符串。
 * 任何一步失败（文件缺失 / 非 gzip / 畸形 NBT / 视图判定无效）→ "{}"（对齐 Go binding
 * 契约：ParseMeta error / ParseSchematicSummary|ParseNbtStructure nil → "{}"）。
 */
async function readNbtMetaJson(
  path: string,
  extract: (root: Record<string, unknown>) => Record<string, unknown> | null,
): Promise<string> {
  try {
    const b64 = await readWebFile(path);
    if (!b64) return "{}";
    const bytes = base64ToBytes(b64);
    if (!bytes) return "{}";
    const root = parseNbtRoot(bytes);
    const view = extract(root);
    if (!view) return "{}";
    return JSON.stringify(view);
  } catch {
    return "{}";
  }
}

// ===== §7 pack/shaderpack meta 读取 =====
/**
 * 资源包详情 binding 公共骨架（TS 平移 go/packs/mcmeta.go ReadPackMeta + internal/app
 * resource_bindings.go:34 的 result 装配）。读 IDB → base64 → 字节 → extractZip →
 * 找 pack.mcmeta（1MB 限额）→ JSON 解析 → 找 pack.png（10MB 限额）→ base64 缩略图。
 * 任何一步失败（文件缺失 / 非 zip / 无 mcmeta / 超限 / 解析失败）→ "{}"（对齐 Go
 * binding 契约：ReadPackMeta error → "{}"）。
 */
async function readPackMetaJson(path: string): Promise<string> {
  try {
    const b64 = await readWebFile(path);
    if (!b64) return "{}";
    const bytes = base64ToBytes(b64);
    if (!bytes) return "{}";
    const { entries } = extractZip(bytes);
    const mcmeta = findZipEntry(entries, "pack.mcmeta");
    if (!mcmeta) return "{}";
    const meta = parsePackMetaJson(mcmeta);
    if (!meta) return "{}";
    // pack.png → base64 缩略图（10MB 限额，超限置空——对齐 go zip 分支 LimitReader+1 截断探测）
    meta.thumbnail = packPngToThumbnail(findZipEntry(entries, "pack.png"));
    return JSON.stringify(meta);
  } catch {
    return "{}";
  }
}

/**
 * 光影包详情 binding（TS 平移 go/packs/mcmeta.go ReadShaderpackLang）。读 IDB → base64 →
 * 字节 → extractZip → 找 lang/en_US.lang（大小写不敏感，1MB 限额）→ key=value 解析 →
 * {name, entries}。任何一步失败 → {"name":"","entries":{}}（对齐 Go binding 契约）。
 */
async function readShaderpackLangJson(path: string): Promise<string> {
  try {
    const b64 = await readWebFile(path);
    if (!b64) return '{"name":"","entries":{}}';
    const bytes = base64ToBytes(b64);
    if (!bytes) return '{"name":"","entries":{}}';
    const { entries } = extractZip(bytes);
    const lang = findZipEntry(entries, "lang/en_us.lang");
    if (!lang) return '{"name":"","entries":{}}';
    return parseShaderpackLang(lang);
  } catch {
    return '{"name":"","entries":{}}';
  }
}

// ===== §8 路径解析（parseWebModelPath / parseWebModelDir）=====
/**
 * /web/<type>/<name>/<rel> → 三段解析（多段 name 支持）。
 * name 与 rel 均可含 /，边界无法靠正则无歧义拆分——枚举 dir:<type>/ 前缀
 * 反向匹配「最长 dir name 前缀」（MikuMikuAR ListDirRecursive 两轮匹配模式）。
 * rel 允许为空串（目录形态路径，如删除整组）。非 /web/ 前缀直接 null。
 */
async function parseWebModelPath(p: string): Promise<{ type: string; name: string; rel: string } | null> {
  const pm = parseWebPath(p);
  if (!pm) return null;
  const { type, rest } = pm;
  const prefix = `dir:${type}/`;
  const dirKeys = await idbKeys("files", prefix);
  let best = "";
  for (const dk of dirKeys) {
    const name = dk.slice(prefix.length, -1); // 去尾 ':'
    if (name && (rest === name || rest.startsWith(`${name}/`)) && name.length > best.length) {
      best = name;
    }
  }
  if (!best) return null;
  return { type, name: best, rel: rest.slice(best.length + 1) };
}
/** /web/<type>/<name> → 类型+模型名（目录形态；name 可含多段路径） */
function parseWebModelDir(p: string): { type: string; name: string } | null {
  return parseWebDirPath(p);
}

/**
 * 递归列出指定 /web 目录下全部文件完整路径（对齐桌面 ListAllFilePaths：
 * 递归完整路径、不限制扩展名）。支持多段 name（目录树）与组内子目录（rel 含 /）。
 * 目录形态路径（/web/<type>/<name> 或 /web/<type>/<name>/<subdir>）经
 * parseWebModelPath 反解出 {type, name, rel}，再枚举 file:<type>/<name>/ 前缀，
 * 过滤 rel.startsWith(目录rel + "/") 归入该子树。非 /web 路径返回 []。
 */
async function listWebModelDirFiles(p: string): Promise<string[]> {
  const pm = await parseWebModelPath(p);
  if (!pm) return [];
  const { type, name, rel } = pm;
  const prefix = `file:${type}/${name}/`;
  const keys = await idbKeys("files", prefix);
  const out: string[] = [];
  // 目录 rel 为空 = 整个模型组；否则只取 rel 子树（rel 或其子目录）
  const dirPrefix = rel ? `${rel}/` : "";
  for (const k of keys) {
    const fileRel = k.slice(prefix.length);
    if (!dirPrefix || fileRel === rel || fileRel.startsWith(dirPrefix)) {
      out.push(`${WEB_ROOT}/${type}/${name}/${fileRel}`);
    }
  }
  return out;
}

// ===== §9 列表（递归列出 /web 目录全部文件路径）=====
/** 扫描全部资源类型的模型（供标签聚合 / 子目录映射等全库操作） */
export async function scanAllWebModels(): Promise<Array<{ type: string; name: string; path: string }>> {
  const rts = (resourceTypesJson as { resourceTypes?: Array<{ id: string }> }).resourceTypes ?? [];
  const out: Array<{ type: string; name: string; path: string }> = [];
  for (const r of rts) {
    const entries = await scanWebModels(`${WEB_ROOT}/${r.id}`);
    for (const e of entries) {
      const pm = await parseWebModelPath(e.Path);
      out.push({ type: pm?.type ?? r.id, name: pm?.name ?? e.Name, path: e.Path });
    }
  }
  return out;
}

// ===== §10 搜索（关键词 + 数值范围，Worker 批量统计）=====
// --- 搜索（关键词匹配 + 数值范围条件，数值统计走 Web Worker 批量分析）---
// 对齐桌面 internal/app/app_scan.go SearchModels：kw 匹配 name OR path；
// 数值参数 [minBones,maxBones,minCubes,maxCubes,minTex,maxTex]，>0 才参与过滤：
//   minBones>0 && BoneCount<minBones → 排除（骨骼 ≥ N）
//   maxBones>0 && BoneCount>maxBones → 排除
//   minCubes>0 && CubeCount<minCubes → 排除（立方体 ≥ N）
//   maxCubes>0 && CubeCount>maxCubes → 排除
//   minTex>0 && (TexWidth<minTex || TexHeight<minTex) → 排除（纹理宽/高 ≥ N）
//   maxTex>0 && (TexWidth>maxTex || TexHeight>maxTex) → 排除
// 统计来源：Worker 批量统计（大库后台跑不卡 UI）；Worker 不可用/失败 → 降级返回
// 关键词匹配（数值 0 + hasError:false，toolbar-search 经 consumeWebSearchDegraded 提示）。
// 返回形状对齐 go types.SearchResult {name,path,boneCount,cubeCount,texWidth,texHeight,hasError}。
interface WebSearchResult {
  name: string;
  path: string;
  boneCount: number;
  cubeCount: number;
  texWidth: number;
  texHeight: number;
  hasError: boolean;
}

export async function searchWebModels(
  filesRoot: string,
  keyword: string,
  minBones = 0,
  maxBones = 0,
  minCubes = 0,
  maxCubes = 0,
  minTex = 0,
  maxTex = 0,
): Promise<WebSearchResult[]> {
  const type = typeFromWebDir(filesRoot);
  const entries = await scanWebModels(`${WEB_ROOT}/${type}`);
  // 对齐桌面 app_scan.go SearchModels：kw = strings.ToLower(strings.TrimSpace(keyword))
  const kw = (keyword || "").trim().toLowerCase();
  // 对齐桌面 app_scan.go SearchModels：匹配 name OR path（搜索目录名/作者路径段可命中）
  const matched = entries.filter(
    (e) => !kw || e.Name.toLowerCase().includes(kw) || e.Path.toLowerCase().includes(kw),
  );
  const hasNumeric =
    minBones > 0 || maxBones > 0 || minCubes > 0 || maxCubes > 0 || minTex > 0 || maxTex > 0;
  // 无数值条件 → 快路径：关键词匹配即可（保持既有行为，不做批量解码）
  if (!hasNumeric) {
    return matched.map((e) => ({
      name: e.Name,
      path: e.Path,
      boneCount: 0,
      cubeCount: 0,
      texWidth: 0,
      texHeight: 0,
      hasError: false,
    }));
  }
  // Worker 批量统计；不可用/失败 → 降级为关键词匹配（数值 0），toast 由消费方提示
  let stats: WebModelStats[] | null = null;
  try {
    stats = await batchStatsWebModels(matched.map((e) => e.Path));
  } catch {
    stats = null;
  }
  if (!stats) {
    return matched.map((e) => ({
      name: e.Name,
      path: e.Path,
      boneCount: 0,
      cubeCount: 0,
      texWidth: 0,
      texHeight: 0,
      hasError: false,
    }));
  }
  const out: WebSearchResult[] = [];
  matched.forEach((e, i) => {
    const s = stats[i];
    // 对齐 Go：统计失败（BoneCount==0 等价 hasError）在数值条件下直接排除
    if (!s || s.hasError) return;
    if (minBones > 0 && s.boneCount < minBones) return;
    if (maxBones > 0 && s.boneCount > maxBones) return;
    if (minCubes > 0 && s.cubeCount < minCubes) return;
    if (maxCubes > 0 && s.cubeCount > maxCubes) return;
    if (minTex > 0 && (s.texWidth < minTex || s.texHeight < minTex)) return;
    if (maxTex > 0 && (s.texWidth > maxTex || s.texHeight > maxTex)) return;
    out.push({
      name: e.Name,
      path: e.Path,
      boneCount: s.boneCount,
      cubeCount: s.cubeCount,
      texWidth: s.texWidth,
      texHeight: s.texHeight,
      hasError: false,
    });
  });
  return out;
}

// ===== §11 重命名校验 =====
// --- 重命名校验（对齐桌面 fileops.RenameDir/RenameFile：非法字符/空名/穿越拒绝）---
// 缺校验的后果：newName 含 / 或为空会制造坏 key（dir:ysm/a/b:），scanWebModels 仍能扫到，
// 但 parseWebModelDir 三段解析失败 → 该模型变成幽灵（无法删除/再次重命名），且重命名到
// 已存在模型名会静默覆盖 dir key 合并数据（桌面 os.Rename 对目标已存在报错，web 必须对齐）
const INVALID_NAME_CHARS = /[\\/:*?"<>|]/;

/** 校验重命名目标名（对齐桌面 fileops.go 非法字符 + 空名 + 路径段校验，非法则抛错） */
function assertValidRenameName(newName: string, kind: "目录" | "文件"): void {
  const kindLabel = kind === "目录" ? t("webFs.kindDir") : t("webFs.kindFile");
  const n = (newName || "").trim();
  if (!n) throw new Error(t("webFs.renameEmptyName", { kind: kindLabel }));
  if (INVALID_NAME_CHARS.test(n)) throw new Error(t("webFs.renameInvalidChars", { kind: kindLabel }));
  if (n === "." || n === "..") throw new Error(t("webFs.renameInvalidPathSegment", { kind: kindLabel }));
}

// ===== §12 删除模型组 =====
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
  if (!di) throw new Error(t("webFs.renameInvalidPath", { path: oldPath }));
  const { type, name } = di;
  assertValidRenameName(newName, "目录");
  const finalName = newName.trim();
  // P-A 多段 name：重命名只替换末段，保留父路径（分类1/狐狸 → 分类1/大猫）
  const parent = name.includes("/") ? name.slice(0, name.lastIndexOf("/") + 1) : "";
  const newNameFull = parent + finalName;
  const oldDirKey = dirKey(type, name);
  const newDirKey = dirKey(type, newNameFull);
  // 目标已存在（含重命名为同名）：对齐桌面「目标已存在」拒绝，防静默覆盖合并两模型数据
  if ((await idbGet("files", newDirKey)) !== undefined) {
    throw new Error(t("webFs.renameTargetExists", { path: `${WEB_ROOT}/${type}/${newNameFull}` }));
  }
  // 旧模型必须存在（对齐桌面 os.Rename 源不存在报错，拒绝静默 no-op）
  const exists = await idbGet("files", oldDirKey);
  if (!exists) throw new Error(t("webFs.renameModelMissing", { path: oldPath }));
  const dv = await idbGet("files", oldDirKey);
  if (dv !== undefined) {
    // 同步更新 dir 条目的 name 字段：scanWebModels 用 meta.name 推导文件查找前缀，
    // 若沿用旧名会在重命名后的 file:<type>/<newName>/ 下扫不到模型（列表变空）
    await idbSet("files", newDirKey, { ...(dv as Record<string, unknown>), name: newNameFull });
    await idbDel("files", oldDirKey);
  }
  const fks = await idbKeys("files", `file:${type}/${name}/`);
  for (const k of fks) {
    const rel = k.slice(`file:${type}/${name}/`.length);
    const val = await idbGet("files", k);
    if (val !== undefined) {
      await idbSet("files", fileKey(type, newNameFull, rel), val);
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
        await idbSet("config", `${prefix}/web/${type}/${newNameFull}/${suffix}`, val);
        await idbDel("config", k);
      }
    }
  }
}

// --- 重命名单个文件（模型组内某文件 rekey，保留 .ban 后缀语义由调用方负责）---
async function renameWebFile(oldPath: string, newName: string): Promise<void> {
  const pm = await parseWebModelPath(oldPath);
  if (!pm) throw new Error(t("webFs.renameInvalidPath", { path: oldPath }));
  const { type, name, rel } = pm;
  assertValidRenameName(newName, "文件");
  const finalName = newName.trim();
  // ysm.json 是模型目录清单（游戏按目录名识别模型）：禁止单文件改名，
  // 否则 scanWebModels 主文件 rank 从 2 掉到 0 → 模型从列表中消失（对齐桌面 fileops.RenameFile ADR-038 D3）
  if (rel.toLowerCase() === "ysm.json") {
    throw new Error(t("webFs.renameYsmJsonForbidden"));
  }
  const oldKey = fileKey(type, name, rel);
  // P-A 组内 rel 可含子目录：重命名只替换 rel 末段文件名，保留目录前缀（tex/face.png → tex/eye.png）
  const relDir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/") + 1) : "";
  const newKey = fileKey(type, name, `${relDir}${finalName}`);
  // 同名（含 trim 归一后）：无事可做，直接返回——不得走下方 idbSet+idbDel（同 key 自删 = 数据丢失回归）
  if (newKey === oldKey) return;
  // 目标已存在：对齐桌面「目标已存在」拒绝，防静默覆盖目标文件内容
  if ((await idbGet("files", newKey)) !== undefined) {
    throw new Error(t("webFs.renameTargetExists", { path: `${WEB_ROOT}/${type}/${name}/${finalName}` }));
  }
  // 旧文件必须存在（对齐桌面 RenameFile 源不存在报错，拒绝静默 no-op）
  const exists = await idbGet("files", oldKey);
  if (!exists) throw new Error(t("webFs.renameModelMissing", { path: oldPath }));
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

// --- 模型移动/复制（组级 rekey；对齐桌面 fileops.MoveModelFile/CopyModelFile，go/fileops/fileops.go:138/220）---
// 桌面语义：MoveModelFile(src, dstDir) 把 src（文件/目录）移入 dstDir 并保留原名
// （dst = Join(dstDir, Base(src))）；CopyModelFile 同语义但保留源。
// web 适配：模型库以「模型组」为最小单位（dir:<type>/<name>: + file:<type>/<name>/<rel>，
// 无桌面「游离文件」概念）——src 为组内任意文件路径或组目录路径时，均整组移动/复制
// （dir + 全部 file + ban/tags 标记，rekey 对齐 renameWebDir 既有处理）。
// dstDir = /web/<type>/<目标文件夹>（resolveDstDir 由 GetRepoRoot + 用户输入拼接），
// 目标模型名 = <目标文件夹>/<src 组名末段>（对齐 Go 的 dst=Join(dstDir, Base(src))，
// 多段组名只保留末段，父路径随移动丢弃，如 分类1/狐狸 → 作者A/狐狸）。
// 校验（对齐 Go 错误语义）：src/dstDir 非空、dstDir 须为合法 /web/<type>/<目标> 目录、
// 源须存在（Go os.Stat 源报错）、目标不得位于源内（自嵌套，Go「目标目录不能位于源目录内」）、
// 目标已存在拒绝（Go「目标已存在」防静默覆盖）。

/**
 * 目标目录 + 源组名 → 新模型组名（对齐 Go dst=Join(dstDir, Base(src))：
 * 目标文件夹 + src 组名末段）。
 */
function webMoveTargetName(dstName: string, srcName: string): string {
  const srcBase = srcName.includes("/") ? srcName.slice(srcName.lastIndexOf("/") + 1) : srcName;
  return `${dstName}/${srcBase}`;
}

/**
 * 模型组整组 rekey：旧组名 → 新组名（dir + 全部 file + ban/tags 标记）。
 * move=true 移动（删旧 key）；move=false 复制（保留旧 key = 读旧写新）。
 * 审核 A #1（事务性）：两阶段——先写全部新 key（不删旧），全成功后才删旧 key；
 * 中途失败只回滚本次新建（best-effort），旧 key 完好 → 无 dir/file 分裂残留。
 */
async function rekeyWebModelGroup(type: string, oldName: string, newName: string, move: boolean): Promise<void> {
  const writtenNew: string[] = [];
  const rollbackNew = async (): Promise<void> => {
    for (const k of writtenNew.reverse()) {
      try {
        await idbDel("files", k);
      } catch {
        /* best-effort */
      }
    }
  };
  try {
    // 阶段一：写新 key（dir + file + 标记），全成功才进阶段二
    const dv = await idbGet("files", dirKey(type, oldName));
    if (dv !== undefined) {
      await idbSet("files", dirKey(type, newName), { ...(dv as Record<string, unknown>), name: newName });
      writtenNew.push(dirKey(type, newName));
    }
    const oldPrefix = `file:${type}/${oldName}/`;
    const fks = await idbKeys("files", oldPrefix);
    for (const k of fks) {
      const rel = k.slice(oldPrefix.length);
      const val = await idbGet("files", k);
      if (val !== undefined) {
        const nk = fileKey(type, newName, rel);
        await idbSet("files", nk, val);
        writtenNew.push(nk);
      }
    }
    for (const prefix of ["ban:", "tags:"]) {
      const scanPrefix = `${prefix}/web/${type}/${oldName}/`;
      const keys = await idbKeys("config", scanPrefix);
      for (const k of keys) {
        const suffix = k.slice(scanPrefix.length);
        const val = await idbGet("config", k);
        if (val !== undefined) {
          const nk = `${prefix}/web/${type}/${newName}/${suffix}`;
          await idbSet("config", nk, val);
          writtenNew.push(nk);
        }
      }
    }
    // 阶段二：全部新 key 写入成功 → 删旧 key（move 时）
    if (move) {
      await idbDel("files", dirKey(type, oldName));
      for (const k of fks) await idbDel("files", k);
      for (const prefix of ["ban:", "tags:"]) {
        const scanPrefix = `${prefix}/web/${type}/${oldName}/`;
        const keys = await idbKeys("config", scanPrefix);
        for (const k of keys) await idbDel("config", k);
      }
    }
  } catch (e) {
    await rollbackNew();
    throw e;
  }
}

// ===== §13 移动/复制（组级 rekey）=====
/**
 * MoveModelFile / CopyModelFile 共用：解析 + 校验 + 组级 rekey。
 * move=true 移动（删源）；move=false 复制（保留源）。失败 reject（对齐 Go error → binding reject）。
 */
async function moveOrCopyWebModel(src: string, dstDir: string, move: boolean): Promise<void> {
  // 非 /web/ 路径 → 无效源路径（对齐 Go「源文件必须在仓库内」）；
  // 合法 /web/ 路径但模型组不存在（parseWebModelPath 反向匹配不到 dir key）→ 模型不存在
  if (!isWebPath(src)) throw new Error(t("webFs.moveInvalidSrc", { path: src }));
  const pm = await parseWebModelPath(src);
  if (!pm) throw new Error(t("webFs.moveModelMissing", { path: src }));
  const { type, name } = pm;
  // dstDir 须为 /web/<type>/<目标> 目录形态（目标名非空由 parseWebDirPath 保证）
  const di = parseWebDirPath(dstDir);
  if (!di) throw new Error(t("webFs.moveInvalidDstDir", { path: dstDir }));
  const dstName = di.name.trim();
  if (!dstName) throw new Error(t("webFs.moveInvalidDstDir", { path: dstDir }));
  // 审核 A #2：目标文件夹名 + 源组名末段分别做非法字符/空名校验（拼接后的 newName
  // 是多段路径含 "/" 合法，assertValidRenameName 禁 "/" 只适用于单段重命名）
  assertValidRenameName(dstName, "目录");
  // 目标模型名 = 目标文件夹/<src 组名末段>（对齐 Go dst=Join(dstDir, Base(src))）
  const newName = webMoveTargetName(dstName, name);
  const srcBase = newName.slice(newName.lastIndexOf("/") + 1);
  assertValidRenameName(srcBase, "目录");
  // 防覆盖：目标组已存在 → 拒绝（对齐 Go「目标已存在」；含目标 == 源自身移动——
  // Go 对 dst===src 命中 stat(dst) 存在报「目标已存在」，web 侧 dir key 即源自身）
  if ((await idbGet("files", dirKey(type, newName))) !== undefined) {
    throw new Error(t("webFs.moveTargetExists", { path: `${WEB_ROOT}/${type}/${newName}` }));
  }
  // 自嵌套检查（须在写库前执行）：目标位于源内 → 拒绝
  // （对齐 Go「目标目录不能位于源目录内」；防在 src 内留下嵌套组）
  if (newName === name || newName.startsWith(`${name}/`)) {
    throw new Error(t("webFs.moveNested", { path: dstDir }));
  }
  await rekeyWebModelGroup(type, name, newName, move);
}

// ===== §14 子目录映射 =====
async function getWebSubDirMap(): Promise<Record<string, string>> {
  // 对齐 go/types/extensions.go SubDirAll：返回 rt.ScanDir（整合包实例版本目录扫描子目录），
  // 非 storageSubDir（仓库存储子目录）——B1 契约测试暴露的字段错用
  const rts = (resourceTypesJson as { resourceTypes?: Array<{ id: string; scanDir?: string }> }).resourceTypes ?? [];
  const map: Record<string, string> = {};
  for (const r of rts) map[r.id] = r.scanDir ?? "";
  return map;
}

/** 聚合所有资源类型的 IDB 模型条目（网页版「本地仓库」= 虚拟根 /web） */
export async function collectAllWebEntries(): Promise<ModelEntry[]> {
  const rts = (resourceTypesJson as { resourceTypes?: Array<{ id: string }> }).resourceTypes ?? [];
  const all: ModelEntry[] = [];
  for (const r of rts) {
    const entries = await scanWebModels(`${WEB_ROOT}/${r.id}`);
    all.push(...entries);
  }
  return all;
}

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
 * - .zip 视为模型主文件（与 .ysm 同属 ZIP 容器，WASM 解码器直接处理），不拒绝
 * - 超出 100MB 跳过（对齐 import-dnd oversize 过滤）
 */

/**
 * 检测 ZIP entries 是否共享公共顶层目录。
 * 例：["狐狸/ysm.json", "狐狸/models/main.json"] → "狐狸"
 *     ["ysm.json", "models/main.json"] → null（扁平，无公共顶层）
 */
function findCommonTopDir(metas: Array<{ fflateKey: string }>): string | null {
  const firstDir = metas[0]?.fflateKey.split("/")[0];
  if (!firstDir) return null;
  for (const m of metas) {
    const d = m.fflateKey.split("/")[0];
    if (d !== firstDir) return null;
  }
  return firstDir;
}

/**
 * R2 导入增强：把输入里的 .zip 文件解压展平成目录文件，返回新的 File[]。
 * - .zip → extractZip 解出 entries（带相对路径），转成带 webkitRelativePath 的 File[]，
 *   复用文件夹拖入的「同 stem 分组 + 主文件目录收敛」语义，rel 保留子目录层级
 * - 非 .zip / .ysm → 原样透传（.ysm 保持整体，WASM 解码器直接处理）
 * - 解压失败（非标准 zip / 超限）→ 保留原 zip 单个文件（走「zip 当主文件」兜底），不阻断
 * - ADR-066 审计缺口 #3：解压后**无主文件**（如资源包 zip 解出 pack.mcmeta + data/，
 *   均非主文件扩展名）→ 保留原 zip 整体当主文件（救回 resourcepack/shaderpack 导入，
 *   原实现整组 failed imported=0）
 */
async function expandZipFiles(files: File[]): Promise<File[]> {
  const out: File[] = [];
  for (const f of files) {
    if (!/\.zip$/i.test(f.name) || f.size > MAX_IMPORT_BYTES) {
      out.push(f);
      continue;
    }
    try {
      const data = new Uint8Array(await f.arrayBuffer());
      const { entries, metas } = extractZip(data);
      if (!metas.length) {
        out.push(f);
        continue;
      }
      // 检测 zip 内是否有公共顶层目录（如 "狐狸/ysm.json" → 公共前缀 "狐狸/"）
      // 扁平 zip（"ysm.json" + "models/main.json"）无公共前缀 → 用 zipStem 防碎片化
      const topLevelDir = findCommonTopDir(metas);
      const prefix = topLevelDir ? "" : f.name.replace(/\.zip$/i, "");
      const expanded: File[] = [];
      for (const m of metas) {
        const raw = entries[m.fflateKey];
        if (!raw) continue;
        const { realName } = gbkDecodeEntry(m);
        if (!realName || realName.endsWith("/")) continue;
        // webkitRelativePath：有公共前缀则保留原样；扁平 zip 用 zipStem 作公共前缀
        // slice() 两用：① TS 泛型 Uint8Array<ArrayBufferLike>→Uint8Array<ArrayBuffer> 过 BlobPart 类型关；
        // ② 隔离 entries[m.fflateKey] 底层 buffer，防 File 与 entries 共享后被改写（内容竞态）
        const wf = new File([raw.slice()], realName.split("/").pop() || realName, {
          type: "application/octet-stream",
        });
        Object.defineProperty(wf, "webkitRelativePath", { value: prefix ? `${prefix}/${realName}` : realName });
        expanded.push(wf);
      }
      // 解压空/无有效文件，或解压后无主文件（资源包/光影包 zip）→ 保留原 zip 整体当主文件
      if (expanded.length === 0 || !expanded.some((wf) => mainFileRank(wf.name) >= MAIN_FILE_RANK_TYPE)) {
        out.push(f);
      } else {
        out.push(...expanded);
      }
      // GBK 中文名降级提示：gpf 未设时 fflateKey 为 Latin-1 乱码，
      // 前端无 GBK 码表无法解码真名——仅 dev 日志，用户端用 modelPath 不影响预览
      if (metas.length > 0 && metas.some((m) => !m.gpfUtf8)) {
        console.warn("[web] ZIP 含非 UTF-8 文件名（可能为 GBK），解压后文件名以 fflateKey 原值入库（中文可能乱码）");
      }
    } catch {
      out.push(f); // 解压失败 → 降级为整体入库，不阻断
    }
  }
  return out;
}

// ===== §15 导入分组（expandZipFiles + 粗/细分组 + stem helpers）=====
export async function importWebFiles(
  files: File[],
  type: string,
): Promise<{ imported: number; failed: number }> {
  // M1（web-edition.md）：网页版暂不支持 .7z 解压——明确过滤并提示（不入库，
  // 替代"看起来能用、点开报错"；7z-wasm 列为远期评估）
  const sevenZCount = files.filter((f) => f.name.toLowerCase().endsWith(".7z")).length;
  if (sevenZCount > 0) {
    console.warn(`[web-fs] ${sevenZCount} 个 .7z 文件已跳过（网页版暂不支持 .7z 解压）`);
    files = files.filter((f) => !f.name.toLowerCase().endsWith(".7z"));
  }
  let imported = 0;
  let failed = 0;
  // R2 导入增强：先把 .zip 解压展平成目录文件（.ysm 保持整体，WASM 解码器处理）。
  // extractZip 解出的 entries 带相对路径（含子目录），转成带 webkitRelativePath 的 File[]，
  // 与文件夹拖入语义一致——解压失败（非标准 zip）则保留原 zip 单个文件，不阻断。
  const expanded = await expandZipFiles(files);
  // 单模型分组（两阶段，P-A 目录树）：
  // 阶段1 粗分组按 webkitRelativePath 首段（或去扩展名 basename），隔离跨目录干扰；
  // 阶段2 组内按「主文件所在目录」收敛为最终组名（模型目录 = 含主文件的目录，可多段），
  // 子目录辅助文件（如 tex/face.png）归属到包含它的主文件目录，rel 保留子目录层级。
  const rough = new Map<string, File[]>();
  for (const f of expanded) {
    try {
      const key = roughStemOf(f);
      if (!key) {
        failed++;
        continue;
      }
      const arr = rough.get(key);
      if (arr) arr.push(f);
      else rough.set(key, [f]);
    } catch {
      failed++;
    }
  }
  const groups = new Map<string, File[]>();
  for (const [, rg] of rough) {
    // 主文件目录集合（rank>=JSON 且未超限，超限主文件不参与定组）
    const mainDirs = new Set<string>();
    for (const f of rg) {
      if (mainFileRank(f.name) >= MAIN_FILE_RANK_TYPE && f.size <= MAX_IMPORT_BYTES) {
        const d = fsaDirOf(f);
        if (d) mainDirs.add(d);
      }
    }
    if (mainDirs.size === 0) {
      // 无目录主文件（纯 basename 拖入 / 顶层文件）：退化单文件分组，组名 = 去扩展名 basename
      for (const f of rg) {
        const stem = basenameStem(f);
        const arr = groups.get(stem);
        if (arr) arr.push(f);
        else groups.set(stem, [f]);
      }
      continue;
    }
    for (const f of rg) {
      // 归属：文件所在目录包含于某主文件目录 → 归该组（最长者胜）；否则回退首段粗组名
      const d = assignMainDir(f, mainDirs);
      const stem = d ?? roughStemOf(f);
      const arr = groups.get(stem);
      if (arr) arr.push(f);
      else groups.set(stem, [f]);
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
      // 组内须存在主文件（.ysm / .zip / ysm.json），否则整组失败
      // （散落 .txt/.png/任意 .json 无主文件 → failed，防杂物独立成模型）
      let hasMain = false;
      for (const f of group) {
        if (mainFileRank(f.name) >= MAIN_FILE_RANK_TYPE) {
          hasMain = true;
          break;
        }
      }
      if (!hasMain) {
        failed += group.length;
        continue;
      }
      // 主文件前置校验：存在主文件但全部超限 → 整组失败且不写任何文件
      // （防孤儿辅助文件残留 + 防重导入时部分覆盖既有模型 → 新旧混合状态）
      const mainUsable = group.some(
        (f) => mainFileRank(f.name) >= MAIN_FILE_RANK_TYPE && f.size <= MAX_IMPORT_BYTES,
      );
      if (!mainUsable) {
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
        // rel 保留子目录层级（webkitRelativePath 相对模型目录的路径），
        // 嵌套导入不再拍平为 basename——P-A 文件层级读取的基础（对齐 MikuMikuAR dir:<stem>:<rel>）
        const k = fileKey(type, stem, relOf(f, stem));
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

/**
 * 粗分组键（阶段1）：webkitRelativePath 首段（文件夹拖入）或去扩展名 basename（单文件拖入）。
 */
function roughStemOf(f: File): string {
  const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath;
  if (rel) {
    const top = rel.split("/")[0];
    if (top) return top;
  }
  return basenameStem(f);
}

/** 去扩展名 basename（纯 basename 分组 / 单文件拖入场景的组名） */
function basenameStem(f: File): string {
  return f.name.replace(/\.\w+$/, "");
}

/** 文件所在目录（webkitRelativePath 去文件名，可多段）；无相对路径或顶层文件 → null */
function fsaDirOf(f: File): string | null {
  const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath;
  if (!rel) return null;
  const dir = rel.split("/").slice(0, -1).join("/");
  return dir || null;
}

/** 归属判定（阶段2）：文件所在目录包含于某主文件目录 → 归该组（最长者胜）；否则 null */
function assignMainDir(f: File, mainDirs: Set<string>): string | null {
  const d = fsaDirOf(f);
  if (!d) return null;
  let best: string | null = null;
  for (const m of mainDirs) {
    if (d === m || d.startsWith(`${m}/`)) {
      if (!best || m.length > best.length) best = m;
    }
  }
  return best;
}

/** 组内文件相对模型目录的路径：webkitRelativePath 去掉 stem 前缀（保留子目录层级）；无相对路径时用 basename */
function relOf(f: File, stem: string): string {
  const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath;
  if (rel && rel.startsWith(`${stem}/`)) return rel.slice(stem.length + 1);
  return f.name;
}

// ===== §16 binding 装配（browser-adapter.ts 消费入口）=====
// ===== 文件系统类 binding 片段（Top 6 注册表驱动：browser-adapter.ts 只做 {...} 装配）=====
// 收敛自 browser-adapter.ts webImpls 的文件系统类条目（扫描/读写/搜索/删除/重命名/
// 子目录/清缓存/FSA 授权）；SelectLocalRepo/GetFsaAuthState 为网页版专属扩展
// （Go AppBindings 无此函数，Phase 3 能力探测不会误报）。
export const webFsBindings = {
  ScanModelEntries: (dir: string) => scanWebModels(dir),
  // 真实列表入口（loader/import-queue/resource-manager 等 6 处均调 WithLabel 版本）
  ScanModelEntriesWithLabel: (dir: string, _label: string) => scanWebModels(dir),
  ReadFileBytes: (path: string) => readWebFile(path),
  // CheckFileExists：IDB 虚拟库路径是否存在（file: 或 dir: key，对齐 Go os.Stat 语义）
  CheckFileExists: async (path: string) => {
    const pm = parseWebPath(path);
    if (!pm) return false;
    const f = await idbGet("files", `file:${pm.type}/${pm.rest}`);
    if (f) return true;
    const prefix = `dir:${pm.type}/`;
    const dirKeys = await idbKeys("files", prefix);
    const rest = pm.rest;
    return dirKeys.some((k) => {
      const name = k.slice(prefix.length, -1);
      return !!name && (rest === name || rest.startsWith(name + "/"));
    });
  },
  // DetectZipType：base64 → 字节 → 内容指纹（extract.ts detectZipType，对齐 Go 语义）
  DetectZipType: (base64Data: string) => {
    if (!base64Data) return Promise.resolve("");
    try {
      const bin = atob(base64Data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return Promise.resolve(detectZipType(bytes) || "");
    } catch {
      return Promise.resolve("");
    }
  },
  // ADR-070 M1：蓝图/投影详情面板恢复（原 fail-fast 报「读取失败」）。
  // TS 平移 go/litematic/parser.go 三函数（ParseMeta/ParseSchematicSummary/ParseNbtStructure），
  // 只读 meta（不做 voxel，M2）；失败返回 "{}" 对齐 Go binding 契约
  ReadLitematicMeta: (path: string) => readNbtMetaJson(path, litematicMetaView),
  ReadNbtStructure: (path: string) => readNbtMetaJson(path, nbtStructureView),
  ReadSchematic: (path: string) => readNbtMetaJson(path, schematicSummaryView),
  // ADR-070 M2：蓝图/投影 voxel 3D 数据（litematic-adapter.ts:34 经 VOXEL_RPC_BY_EXT
  // 分发调用；TS 平移 go/litematic/voxel.go 三构建函数 + internal/app marshalVoxelData，
  // 失败返回 "{}" 对齐 Go binding 契约）
  GetNbtVoxelData: (path: string) => readVoxelJson(path, nbtVoxelView),
  GetSchematicVoxelData: (path: string) => readVoxelJson(path, schematicVoxelView),
  GetLitematicVoxelData: (path: string) => readVoxelJson(path, litematicVoxelView),
  // DetectResourceType：扩展名判定（resolveTypeSafe，歧义 .zip/.7z 返回 null）→
  // 歧义容器读内容指纹（detectZipType）。ADR-066 web 识别层对齐 Go：
  // 一处补上后非 YSM 类型（pack/shader/蓝图/投影/MMD/VRC）的预览路由不再误入
  // YSM 路径（原 fail-fast 导致 rtype="" 全落 YSM 解析报"无法解析"）
  DetectResourceType: async (path: string) => {
    const byExt = resolveTypeSafe(path);
    if (byExt) return byExt;
    const b64 = await readWebFile(path);
    if (!b64) return "";
    const bytes = base64ToBytes(b64);
    if (!bytes) return "";
    return detectZipType(bytes);
  },
  // YSM 头部/摘要 web 实现（原 fail-fast → import-queue 作者预填/重命名 tips 静默降级、
  // 详情缺 stats/license）。失败不 reject：头部返回全空 YSMHeader、摘要返回最小空
  // YsmSummary（对齐 Go internal/app/app_model.go:41-65 单返回值吞错契约，消费方容错）。
  // ExtractYSMHeaderFromBase64：base64 → 字节 → parseYsmHeaderFromBytes（YSGP 尽力检测）
  ExtractYSMHeaderFromBase64: (base64Data: string) => {
    const bytes = base64ToBytes(base64Data);
    if (!bytes) return Promise.resolve(emptyYsmHeader());
    return Promise.resolve(parseYsmHeaderFromBytes(bytes));
  },
  // ExtractYSMHeader：readWebFile → base64 → 复用 FromBase64 同一解析
  ExtractYSMHeader: async (path: string) => {
    const b64 = await readWebFile(path);
    if (!b64) return emptyYsmHeader();
    const bytes = base64ToBytes(b64);
    if (!bytes) return emptyYsmHeader();
    return parseYsmHeaderFromBytes(bytes);
  },
  // ExtractYsmSummary：readWebFile → 字节 → YSGP 检测 → zip（PK 头）找 ysm.json 解析
  // → 非 zip 文本头部基本摘要；失败 → 最小空 YsmSummary
  ExtractYsmSummary: async (path: string) => {
    const source = path.split(/[/\\]/).pop() || "";
    const b64 = await readWebFile(path);
    if (!b64) return emptyYsmSummary(source);
    const bytes = base64ToBytes(b64);
    if (!bytes) return emptyYsmSummary(source);
    try {
      return extractYsmSummaryFromBytes(bytes, source);
    } catch {
      // ysm.json 畸形/非对象等 → 最小空摘要（对齐 Go app 层 ExtractYsmSummary 失败分支）
      return emptyYsmSummary(source);
    }
  },
  // 资源包/光影包详情恢复（原 fail-fast 报「binding 未实现」红错，app-preview/detail.ts:138/201
  // 直调）。TS 平移 go/packs/mcmeta.go ReadPackMeta/ReadShaderpackLang，只读 meta；
  // 失败返回 "{}"/{"name":"","entries":{}} 对齐 Go binding 契约（resource_bindings.go:34/59）
  ReadPackMeta: (path: string) => readPackMetaJson(path),
  ReadShaderpackLang: (path: string) => readShaderpackLangJson(path),
  // rtype 含 / 时替换为 _，避免 /web/a/b 破坏 readWebFile 三段解析
  GetRepoRoot: (rtype: string) => Promise.resolve(`${WEB_ROOT}/${rtype.replace(/\//g, "_")}`),
  GetDefaultRepoRoot: () => Promise.resolve(WEB_ROOT),
  // 搜索：关键词 + 数值范围条件（min/max 骨骼/立方体/纹理，>0 才过滤；统计走
  // Web Worker 批量分析，Worker 不可用降级为仅关键词匹配并在 UI 提示）
  SearchModels: (filesRoot: string, keyword: string, ...rest: number[]) =>
    searchWebModels(
      filesRoot,
      keyword,
      rest[0] ?? 0,
      rest[1] ?? 0,
      rest[2] ?? 0,
      rest[3] ?? 0,
      rest[4] ?? 0,
      rest[5] ?? 0,
    ),
  // 删除模型组（dir + file + 标记）
  DeleteModelDir: async (path: string) => {
    // 格式校验区分「非法路径」（reject）与「合法但组已删」（幂等通过，对齐桌面重复删除不报错）：
    // dir 反向匹配依赖 dir key 存在性，组删除后解析为 null——此时不得误报无效路径
    if (!isWebPath(path)) {
      return Promise.reject(new Error(t("webFs.deleteInvalidPath", { path })));
    }
    const pm = await parseWebModelPath(path);
    if (pm) await deleteWebModel(pm.type, pm.name);
  },
  RemoveDir: (dir: string) => {
    const di = parseWebModelDir(dir);
    if (!di) return Promise.reject(new Error(t("webFs.deleteInvalidPath", { path: dir })));
    return deleteWebModel(di.type, di.name);
  },
  // 重命名：模型目录整组 rekey / 组内单文件 rekey
  RenameDir: (oldPath: string, newName: string) => renameWebDir(oldPath, newName),
  RenameFile: (oldPath: string, newName: string) => renameWebFile(oldPath, newName),
  // 模型移动/复制（组级 rekey；对齐桌面 fileops.MoveModelFile/CopyModelFile 语义，
  // 差异：web 无「游离文件」，src 为组内文件/组目录时均整组移动/复制）
  MoveModelFile: (src: string, dstDir: string) => moveOrCopyWebModel(src, dstDir, true),
  CopyModelFile: (src: string, dstDir: string) => moveOrCopyWebModel(src, dstDir, false),
  // 子目录映射（resource_types.json 派生）
  GetSubDirMap: () => getWebSubDirMap(),
  // R1 文件层级读取：递归列出 /web 目录下全部文件完整路径（对齐桌面 ListAllFilePaths，
  // 递归完整路径、不限制扩展名；bus-handlers 删除目录移入回收站联动依赖）
  ListAllFilePaths: (dir: string) => listWebModelDirFiles(dir),
  // 网页版无扫描缓存（scanWebModels 直读 IDB）：清缓存为 no-op。
  // 缺此实现会让 app-tree 切换 root 时（index.ts:170）fail-fast 抛错跳过 _load，树卡死。
  ClearScanCache: () => Promise.resolve(),
  InvalidateScanCache: () => Promise.resolve(),
  // SelectLocalRepo 为网页版专属扩展（Go AppBindings 无此函数，Phase 3 能力探测不会误报）；
  // 用 FSA 授权本地仓库目录，替代 Go 本地文件系统扫描作为模型库文件来源
  SelectLocalRepo: () => selectLocalRepo(),
  // R2 FSA 授权状态查询（供 settings UI 启动引导；不触发权限弹窗）
  GetFsaAuthState: () => getFsaAuthState(),
} satisfies Record<string, (...args: never[]) => Promise<unknown>>;
