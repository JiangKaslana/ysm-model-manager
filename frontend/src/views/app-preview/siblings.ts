// ===== 同类型候选列表通用底座（视图壳数据准备：GetRepoRoot → ScanModelEntries）=====
// 各格式（mmd / fbx / scene / ...）共享同一链路，仅 rtype + 扩展名过滤不同。
// 归位 views 层（ADR-072 根治：依赖 getApp 读仓库根，属视图壳数据能力，
// 不该被 utils/3d/adapters 反向 import —— 那会与 adapter → controls 形成循环依赖环）。
import { getApp } from "../../backend/app.ts";

/**
 * 解析某资源类型的同目录候选主文件路径列表。
 * @param rtype  资源类型 id（RESOURCE_TYPES.*），传给 Go `GetRepoRoot`
 * @param extRe  主文件扩展名过滤正则（如 /\.fbx$/i）
 * @returns 候选绝对路径列表；根为空 / 扫描失败 → []（调用方下拉不渲染，不阻断）
 */
export async function resolveSiblingsByType(rtype: string, extRe: RegExp): Promise<string[]> {
  try {
    const App = await getApp();
    const app = App as unknown as Record<string, (a: string) => Promise<unknown>>;
    const root = (await app["GetRepoRoot"](rtype)) as string;
    if (!root) return [];
    const entries = (await app["ScanModelEntries"](root)) as Array<{ Path?: string }> | null;
    return (entries || [])
      .map((e) => e.Path || "")
      .filter((p) => extRe.test(p));
  } catch {
    return [];
  }
}
