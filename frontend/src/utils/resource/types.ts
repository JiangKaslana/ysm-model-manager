// ===== 资源类型常量（类型化版 — ADR-014 P2）=====
// RESOURCE_TYPES / RESOURCE_TYPE_LABELS 保留手写：JSON 无「标签→ID」映射，且短标签
// （如 "模型"/"MMD"）≠ JSON 的 name 全名（"YSM 模型"/"MMD 角色模型"），短标签参与 Go 端
// ScanModelEntriesWithLabel 扫描匹配，语义由前端契约决定，不能从 JSON 派生。
// ALL_RESOURCE_TYPES 从根 resource_types.json 的 id 派生（vite 构建期内联，防增删漂移）。
import resourceTypesJson from "../../../../resource_types.json" with { type: "json" };

/** 资源类型 ID（键为类型标签，值为内部 ID） */
export const RESOURCE_TYPES: Record<string, string> = {
  YSM: "ysm",
  MMD: "mmd-skin",
  VRC: "vrchat-avatar",
  PACK: "resourcepack",
  SHADER: "shaderpack",
  BLUEPRINT: "blueprint",
  CREATE_BLUEPRINT: "create-blueprint",
  LITEMATIC: "litematic",
  MAID: "maid-model",
  MOD_MODEL: "mod-model", // ADR-105 软合并：模组模型合集壳（nav 展开 ysm/maid 子类型）
  VANILLA_ASSETS: "vanilla-assets", // ADR-105 软合并：原版资源合集壳（nav 展开 资源包/光影包）
};

/** 资源类型显示标签（内部 ID → 中文名） */
export const RESOURCE_TYPE_LABELS: Record<string, string> = {
  ysm: "YSM 模型",
  "mmd-skin": "MMD",
  "vrchat-avatar": "VRC",
  resourcepack: "资源包",
  shaderpack: "光影包",
  "create-blueprint": "蓝图/结构",
  "blueprint": "蓝图",
  litematic: "投影",
  "maid-model": "车万女仆",
  "mod-model": "模组模型", // ADR-105 软合并合集壳（nav 展开用）
  "vanilla-assets": "原版资源合集", // ADR-105 软合并合集壳（nav 展开用）
};

/** JSON 条目（缺 id 的脏数据过滤掉，防 undefined 混入类型列表） */
interface ResourceTypeIdEntry {
  id?: string;
  group?: string;
  subtypes?: Array<{
    name?: string;
    label?: string;
    icon?: string;
    userImportable?: boolean;
    default?: boolean;
  }>;
}

const registryEntries: ResourceTypeIdEntry[] =
  (resourceTypesJson as { resourceTypes?: ResourceTypeIdEntry[] }).resourceTypes ?? [];
if (registryEntries.length === 0) {
  // 结构漂移显式暴露，避免空数组被误当"无资源类型"静默吞掉（联动 app-sidebar 加载）
  console.error("[resource] resource_types.json 解析为空或结构异常，ALL_RESOURCE_TYPES 降级为空列表");
}

/** 全部资源类型 ID 列表（从 resource_types.json id 派生，单一事实来源） */
export const ALL_RESOURCE_TYPES: string[] = registryEntries
  .map((t) => t.id)
  .filter((id): id is string => typeof id === "string" && id.length > 0);

// ===== 资源分组派生（ADR-092：FilesRoot/{group}/{storageSubDir} 两层路由）=====
// 从各类型 group 字段派生，消除 resourceGroups 冗余源。
// 组 = 所有类型的 group 字段去重集合，新资源注册后自动入组。
// groupLabel/groupIcon 从注册表各类型的 groupLabel/groupIcon 字段读取（仅该组首个类型携带）。

/** 分组元数据（id → {name, icon, order}），从各类型 group 字段派生 */
export const GROUP_META: Record<string, { name: string; icon: string; order: number }> = {};
const groupSeen: string[] = [];
for (const t of registryEntries) {
  const gid = t.group || "";
  if (!gid || GROUP_META[gid]) continue;
  // 从注册表读取 groupLabel/groupIcon（仅该组首个类型携带）
  const raw = t as { groupLabel?: string; groupIcon?: string };
  GROUP_META[gid] = {
    name: raw.groupLabel || gid,
    icon: raw.groupIcon || "📦",
    order: groupSeen.length,
  };
  groupSeen.push(gid);
}

/** 资源类型 → 所属分组 id（无 group 字段返回空串 = 单级平铺） */
export const GROUP_OF: Record<string, string> = {};
for (const t of registryEntries) {
  if (t.id) GROUP_OF[t.id] = t.group || "";
}

/** 分组 id → 显示名 */
export function groupLabelOf(group: string): string {
  return GROUP_META[group]?.name || "";
}

/**
 * 大类(group) → 其下资源类型/子类型选项（ADR-092/094/105 双下拉导航第二级）。
 * 从 resource_types.json 派生：每个 group 下挂的资源类型即选项。
 * ADR-105 软合并通用化：rtype 若声明 subtypes（userImportable 过滤后非空），
 * 展开为子类型选项（如 create-blueprint → 蓝图/投影、mod-model → YSM/车万女仆）；
 * 被吸收的独立 rtype（name 出现在某父类型的 subtypes 中，如 litematic/ysm）不再单独平铺。
 * 子类型名匹配独立 rtype id → 选项 rtype 路由到独立 id、subdir=""（仓库侧 GetRepoRoot 精确）；
 * 否则（EntityPlayer/blueprint 等无独立 rtype）→ 保留父 id + subdir=子类型名。
 */
export interface GroupTypeOption {
  rtype: string;
  label: string;
  subdir: string;
}
export const GROUP_TYPE_OPTIONS: Record<string, GroupTypeOption[]> = (() => {
  // 被 subtypes 吸收的独立 rtype 集合（软合并：litematic 是 create-blueprint 的 subtype）
  const absorbed = new Set<string>();
  // 全部独立 rtype id 集合（子类型名命中 → 路由到独立 id）
  const independentIds = new Set<string>();
  for (const t of registryEntries) {
    if (t.id) independentIds.add(t.id.toLowerCase());
    for (const s of t.subtypes ?? []) {
      if (s.name) absorbed.add(s.name.toLowerCase());
    }
  }
  const result: Record<string, GroupTypeOption[]> = {};
  for (const t of registryEntries) {
    if (!t.id || !GROUP_OF[t.id]) continue;
    const g = GROUP_OF[t.id];
    // 被吸收的独立 rtype → 不再单独平铺（由父类型 subtypes 展开呈现）
    if (absorbed.has(t.id.toLowerCase())) continue;
    const userSubs = (t.subtypes ?? []).filter((s) => s.userImportable !== false);
    if (userSubs.length > 0) {
      // 展开子类型选项
      for (const s of userSubs) {
        const name = s.name || "";
        if (name && independentIds.has(name.toLowerCase())) {
          // 子类型名匹配独立 rtype（软合并：litematic/ysm/maid-model）→ 路由到独立 id
          (result[g] ||= []).push({ rtype: name, label: s.label || name, subdir: "" });
        } else {
          // 无独立 rtype（EntityPlayer/blueprint）→ 保留父 id + subdir=子类型名
          // default 槽（EntityPlayer 等）也传子目录名——"路径定意图"：EntityPlayer
          // 就是 mmd/EntityPlayer 目录，跟其他子目录一样对待（default 不特殊化）
          (result[g] ||= []).push({
            rtype: t.id,
            label: s.label || name || "",
            subdir: name,
          });
        }
      }
    } else {
      (result[g] ||= []).push({
        rtype: t.id,
        label: RESOURCE_TYPE_LABELS[t.id] || GROUP_META[g]?.name || t.id,
        subdir: "",
      });
    }
  }
  return result;
})();

/**
 * MMD 子类型目录选项（ADR-094 位置路由 + ADR-104/105 注册表派生）。
 * ⚠️ 大小写约定：subdir 字段恒驼峰原样（如 SceneModel/CustomAnim），消费方比较
 * 统一 toLowerCase()（renderer/app-nav 同款）。
 * 派生规则：从 resource_types.json 的 mmd-skin.subtypes[] 取 userImportable=true 项，
 * default 槽（EntityPlayer 等）也传子目录名——"路径定意图"路由统一，不特殊化；
 * icon 来自 subtype 自声明（ADR-105 零继承）。
 * DefaultAnim/DefaultMorph 系统内置目录 userImportable=false 天然不列出——
 * Go 端同步识别保留（SubtypeNames 全量），前端下拉仅用户可导入项。
 */
export const MMD_SUBTYPES: Array<{ label: string; subdir: string; icon: string }> = (() => {
  const mmd = (resourceTypesJson as {
    resourceTypes?: Array<{
      id?: string;
      subtypes?: Array<{
        name?: string;
        label?: string;
        icon?: string;
        userImportable?: boolean;
        default?: boolean;
      }>;
    }>;
  }).resourceTypes?.find((t) => t.id === RESOURCE_TYPES.MMD);
  return (mmd?.subtypes ?? [])
    .filter((s) => s.userImportable !== false)
    .map((s) => ({
      label: s.label || s.name || "",
      subdir: s.name || "",
      icon: s.icon || "🎭",
    }));
})();

/**
 * 资源类型在 FilesRoot 下的分组存储根目录（ADR-092 两层路由）。
 * 有 group：`{group}/{storageSubDir}`；无 group：`storageSubDir`（向后兼容）。
 * 返回相对 FilesRoot 的子路径，调用方自行拼接。
 */
export function groupStorageRootOf(typeId: string): string {
  const group = GROUP_OF[typeId];
  const rt = (resourceTypesJson as {
    resourceTypes?: Array<{ id?: string; storageSubDir?: string; subDirGrouping?: boolean }>;
  }).resourceTypes?.find((t) => t.id === typeId);
  // subDirGrouping 类型（mmd-skin）的仓库侧在 group 根下平铺子目录，
  // 不再通过 storageSubDir 多包一层（EntityPlayer 等 subtype 各自独立）。
  if (rt?.subDirGrouping && group) {
    return group;
  }
  const sub = rt?.storageSubDir || typeId;
  return group ? `${group}/${sub}` : sub;
}

// ===== 资源能力派生（ADR-066：解墙 — 预览/解码层统一查表）=====
// 此前 loader.ts / index.ts / litematic-meta.ts 散落扩展名正则与 Go RPC 字符串分支，
// 现全部从 resource_types.json 派生：新增格式只改 JSON，不散改前端代码。

/** 提取路径扩展名（小写、含点；无扩展名返回空串） */
export function extOf(path: string): string {
  const base = path.split(/[/\\]/).pop() || "";
  const i = base.lastIndexOf(".");
  return i >= 0 ? base.slice(i).toLowerCase() : "";
}

/** 单一资源类型的能力视图（派生自 resource_types.json + 短标签映射） */
interface ResourceCap {
  id: string;
  name: string;    // JSON 全名（如 "YSM 模型"）
  label: string;   // 短标签（如 "模型"，参与 Go 扫描匹配）
  icon: string;
  extensions: string[]; // 小写、含点，如 [".ysm",".zip",".json"]
  preview: string; // "3d" | "thumbnail" | "none" ...
}

interface RawResourceType {
  id?: string;
  name?: string;
  icon?: string;
  extensions?: string[];
  preview?: string;
  detector?: string;
  zipEntries?: { name?: string; match?: string }[];
}

const rawTypes: RawResourceType[] =
  (resourceTypesJson as { resourceTypes?: RawResourceType[] }).resourceTypes ?? [];

/** 全部资源类型能力，从 resource_types.json 派生（单一事实来源）。内部派生层，外部用安全入口 resolveTypeSafe / matchTypeByExt */
const RESOURCE_CAPS: Record<string, ResourceCap> = {};
for (const t of rawTypes) {
  if (!t.id) continue;
  RESOURCE_CAPS[t.id] = {
    id: t.id,
    name: t.name || t.id,
    label: RESOURCE_TYPE_LABELS[t.id] || t.name || t.id,
    icon: t.icon || "📦",
    extensions: (t.extensions || []).map((e) => e.toLowerCase()),
    preview: t.preview || "none",
  };
}

/** 路径是否属于指定类型（按注册表 extensions 判定，不处理歧义扩展名） */
export function matchTypeByExt(path: string, typeId: string): boolean {
  const cap = RESOURCE_CAPS[typeId];
  if (!cap) return false;
  return cap.extensions.includes(extOf(path));
}

/**
 * 按扩展名反解资源类型。歧义扩展名（如 .zip 同时归属 ysm/resourcepack/shaderpack）
 * 返回 null，调用方应回退到内容检测（Go DetectResourceType）。
 * 内部实现：外部统一走 resolveTypeSafe（带歧义守卫）。
 */
function resolveTypeByExt(path: string): string | null {
  const ext = extOf(path);
  if (!ext) return null;
  const hits = Object.values(RESOURCE_CAPS).filter((c) => c.extensions.includes(ext));
  return hits.length === 1 ? hits[0].id : null;
}

/** 压缩容器扩展名：走 Go 解包提取，不由前端 WASM 直接预览 */
const CONTAINER_EXTS = new Set([".zip", ".7z"]);

/**
 * 资源类型图标（从 resource_types.json 的 icon 字段派生——扩展点残留清单 #3：
 * 原 icon.ts 手写 RTYPE_ICONS 与 JSON 漂移，新增类型须手改；现 JSON 加 icon 即自动生效）。
 */
export function typeIconOf(id: string): string {
  return RESOURCE_CAPS[id]?.icon || "📦";
}

/** ysm 单文件（.ysm/.json）走前端 WASM 预览；.zip/.7z 容器由 Go FindPreviewImage 兜底 */
export function isYsmWasmPreview(path: string): boolean {
  const ext = extOf(path);
  return matchTypeByExt(path, RESOURCE_TYPES.YSM) && !CONTAINER_EXTS.has(ext);
}

/** 体素类（蓝图/投影）Go 体素数据 RPC 名称，按扩展名单点映射（ADR-066 解墙） */
export const VOXEL_RPC_BY_EXT: Record<string, string> = {
  ".nbt": "GetNbtVoxelData",
  ".schematic": "GetSchematicVoxelData",
  ".litematic": "GetLitematicVoxelData",
};

/**
 * 歧义扩展名集合：同扩展名归属 ≥2 类型，禁止用 matchTypeByExt / resolveTypeByExt 直接定类型。
 * 根因（ADR-067）：所有资源都能被 .zip / .7z 包裹，扩展名不可信，必须回退内容检测。
 * 从 RESOURCE_CAPS 派生，新增类型自动纳入，无需手维护。
 */
export const AMBIGUOUS_EXTS: Set<string> = (() => {
  const count: Record<string, number> = {};
  for (const cap of Object.values(RESOURCE_CAPS)) {
    for (const e of cap.extensions) count[e] = (count[e] || 0) + 1;
  }
  return new Set(Object.keys(count).filter((e) => count[e] > 1));
})();

/**
 * 安全解析类型（ADR-067）：单归属扩展名直接命中；歧义扩展名（.zip/.7z 等可包裹任意资源）
 * 返回 null，调用方必须回退到 Go DetectResourceType 内容检测。
 * 新分发器（P1 VRM / P2 MMD 适配器）统一使用此函数，避免重蹈硬编码扩展名派发的覆辙。
 */
export function resolveTypeSafe(path: string): string | null {
  const ext = extOf(path);
  if (!ext) return null;
  return AMBIGUOUS_EXTS.has(ext) ? null : resolveTypeByExt(path);
}

/** ZIP 条目任意层级段后缀（ADR-082 S1 前端同构）：a/b/c → [a/b/c, b/c, c] */
function segmentSuffixes(name: string): string[] {
  const segs = name.toLowerCase().split("/");
  const out: string[] = [];
  for (let i = 0; i < segs.length; i++) out.push(segs.slice(i).join("/"));
  return out;
}

/**
 * 按注册表 zipEntries 指纹匹配 ZIP 条目名，返回命中的资源类型 ID（ADR-082 S4：
 * 前端指纹注册表化，与 Go types.MatchZipEntry 同构——任意层级段后缀语义，
 * 新增类型只改 JSON）。命中规则来自 resource_types.json 的 zipEntries
 * （exact/prefix/suffix 三种模式），未命中返回 null。
 */
export function matchZipEntryTS(name: string): string | null {
  for (const t of rawTypes) {
    if (!t.id || !t.zipEntries || t.zipEntries.length === 0) continue;
    for (const m of t.zipEntries) {
      const mlow = (m.name || "").toLowerCase();
      if (!mlow) continue;
      for (const seg of segmentSuffixes(name)) {
        if (m.match === "prefix" && seg.startsWith(mlow)) return t.id;
        if (m.match === "suffix" && seg.endsWith(mlow)) return t.id;
        if (m.match !== "prefix" && m.match !== "suffix" && seg === mlow) return t.id;
      }
    }
  }
  return null;
}
