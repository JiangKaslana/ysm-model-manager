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
