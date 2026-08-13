// ===== 网页版文件系统职责（ADR-040 拆分：browser-adapter.ts 职责切分产物）=====
// 文件系统类操作：IndexedDB 虚拟根 /web 的扫描/读写/导入/删除/重命名/子目录映射，
// 以及 FSA 授权本地仓库导入。被 web-store（标签聚合扫描）与 web-community
// （作者扫描/仓库索引）复用；browser-adapter.ts 从本文件 import 组装 webImpls。
// 共享原语（WebUnsupportedError / WEB_ROOT / MAX_IMPORT_BYTES / arrayBufferToBase64）
// 见 web-common.ts。
import { idbGet, idbSet, idbKeys, idbDel } from "./idb.ts";
import type { ModelEntry } from "../../bindings/ysm-model-manager/go/types/models.ts";
// 复用 dnd-shared 的导入白名单（.json 仅放行 ysm.json，其余须 ALL_EXTS 成员），
// 避免 browser-adapter 另起一套扩展名校验导致漂移
import resourceTypesJson from "../../../resource_types.json" with { type: "json" };
// rtype 魔法字符串统一走 RESOURCE_TYPES 常量（治理红线 R7）
import { RESOURCE_TYPES } from "../utils/resource/types.ts";
import { WebUnsupportedError, WEB_ROOT, MAX_IMPORT_BYTES, arrayBufferToBase64 } from "./web-common.ts";

// --- key 规约（对齐 MikuMikuAR ADR-177：dir:*: / file:*: 前缀）---
const dirKey = (type: string, name: string): string => `dir:${type}/${name}:`;
const fileKey = (type: string, name: string, rel: string): string =>
  `file:${type}/${name}/${rel}`;

/** 从 /web/<type>/... 提取类型段（ScanModelEntries 参数语义） */
export function typeFromWebDir(dir: string): string {
  return dir.replace(/^\/web\//, "").split("/")[0] || RESOURCE_TYPES.YSM;
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
export async function readWebFile(path: string): Promise<string | null> {
  const m = path.match(/^\/web\/([^/]+)\/([^/]+)\/(.+)$/);
  if (!m) return null;
  const [, type, name, rel] = m;
  const f = await idbGet<{ data: ArrayBuffer }>("files", fileKey(type, name, rel));
  if (!f) return null;
  return arrayBufferToBase64(f.data);
}

/** /web/<type>/<name>/<rel> → 三段解析 */
export function parseWebModelPath(p: string): { type: string; name: string; rel: string } | null {
  const m = p.match(/^\/web\/([^/]+)\/([^/]+)\/(.+)$/);
  if (!m) return null;
  return { type: m[1], name: m[2], rel: m[3] };
}
/** /web/<type>/<name> → 类型+模型名（目录形态） */
export function parseWebModelDir(p: string): { type: string; name: string } | null {
  const m = p.match(/^\/web\/([^/]+)\/([^/]+)\/?$/);
  if (!m) return null;
  return { type: m[1], name: m[2] };
}

/** 扫描全部资源类型的模型（供标签聚合 / 子目录映射等全库操作） */
export async function scanAllWebModels(): Promise<Array<{ type: string; name: string; path: string }>> {
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

// --- 搜索（关键词匹配；数值范围条件浏览器端无几何分析，降级忽略）---
export async function searchWebModels(
  filesRoot: string,
  keyword: string,
): Promise<Array<{ name: string; path: string; boneCount: number; cubeCount: number; texWidth: number; texHeight: number; hasError: boolean }>> {
  const type = typeFromWebDir(filesRoot);
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
export async function deleteWebModel(type: string, name: string): Promise<void> {
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
export async function renameWebDir(oldPath: string, newName: string): Promise<void> {
  const di = parseWebModelDir(oldPath);
  if (!di) throw new Error(`重命名失败：无效路径: ${oldPath}`);
  const { type, name } = di;
  assertValidRenameName(newName, "目录");
  const finalName = newName.trim();
  const oldDirKey = dirKey(type, name);
  const newDirKey = dirKey(type, finalName);
  // 目标已存在（含重命名为同名）：对齐桌面「目标已存在」拒绝，防静默覆盖合并两模型数据
  if ((await idbGet("files", newDirKey)) !== undefined) {
    throw new Error(`重命名失败：目标已存在: ${WEB_ROOT}/${type}/${finalName}`);
  }
  // 旧模型必须存在（对齐桌面 os.Rename 源不存在报错，拒绝静默 no-op）
  const exists = await idbGet("files", oldDirKey);
  if (!exists) throw new Error(`重命名失败：模型不存在: ${oldPath}`);
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
export async function renameWebFile(oldPath: string, newName: string): Promise<void> {
  const pm = parseWebModelPath(oldPath);
  if (!pm) throw new Error(`重命名失败：无效路径: ${oldPath}`);
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
  // 旧文件必须存在（对齐桌面 RenameFile 源不存在报错，拒绝静默 no-op）
  const exists = await idbGet("files", oldKey);
  if (!exists) throw new Error(`重命名失败：模型不存在: ${oldPath}`);
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
export async function getWebSubDirMap(): Promise<Record<string, string>> {
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
      // 主文件前置校验：存在主文件但全部超限 → 整组失败且不写任何文件
      // （防孤儿辅助文件残留 + 防重导入时部分覆盖既有模型 → 新旧混合状态）
      const mainUsable = group.some(
        (f) => mainFileRank(f.name) >= MAIN_FILE_RANK_JSON && f.size <= MAX_IMPORT_BYTES,
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
