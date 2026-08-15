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
  BLUEPRINT: "create-blueprint",
  LITEMATIC: "litematic",
};

/** 资源类型显示标签（内部 ID → 中文名） */
export const RESOURCE_TYPE_LABELS: Record<string, string> = {
  ysm: "模型",
  "mmd-skin": "MMD",
  "vrchat-avatar": "VRC",
  resourcepack: "资源包",
  shaderpack: "光影包",
  "create-blueprint": "蓝图",
  litematic: "投影",
};

/** JSON 条目（缺 id 的脏数据过滤掉，防 undefined 混入类型列表） */
interface ResourceTypeIdEntry {
  id?: string;
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
