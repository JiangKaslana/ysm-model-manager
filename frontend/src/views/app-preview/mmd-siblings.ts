// ===== MMD 同类型候选列表（视图壳层数据准备：GetRepoRoot → ScanModelEntriesFiltered）=====
// Go 按注册表白名单过滤（ADR-044③ 对称范式）。
// 从 mmd-3d.ts 归位到 views 层（ADR-072 根治：resolveMmdSiblings 是视图壳数据能力，
// 依赖 getApp 读仓库根，不该被 utils/3d/adapters 的 mmd-controls 反向 import——那会
// 与 mmd-3d → mmd-adapter → mmd-controls 形成循环依赖环）。
import { getApp } from "../../backend/app.ts";
import { RESOURCE_TYPES, RESOURCE_TYPE_LABELS } from "../../utils/resource/types.ts";

/** 同类型 MMD 模型候选（GetRepoRoot 类型根 → ScanModelEntriesFiltered 主文件 Path 列表）；失败返回 []（下拉不渲染） */
export async function resolveMmdSiblings(): Promise<string[]> {
  try {
    const App = await getApp();
    const app = App as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
    const root = (await app["GetRepoRoot"](RESOURCE_TYPES.MMD)) as string;
    if (!root) return [];
    const label = RESOURCE_TYPE_LABELS[RESOURCE_TYPES.MMD] || RESOURCE_TYPES.MMD;
    const entries = (await app["ScanModelEntriesFiltered"](root, RESOURCE_TYPES.MMD, "", label)) as Array<{ Path?: string }> | null;
    return (entries || []).map((e) => e.Path || "");
  } catch {
    return [];
  }
}
