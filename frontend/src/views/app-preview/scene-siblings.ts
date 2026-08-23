// ===== 场景 MMD 同类型候选列表（只扫 SceneModel 目录）=====
// 直接用类型 ID 调 GetRepoRoot，后端返回 FilesRoot/mmd/SceneModel，无需前端回溯拼接
// Go ScanModelEntriesFiltered 按 SceneModel 注册表白名单过滤（ADR-044③ 对称范式），
// 前端不做扩展名二次判定。
import { getApp } from "../../backend/app.ts";

/** 场景模型候选（只扫 SceneModel 子目录）；失败返回 [] */
export async function resolveSceneSiblings(): Promise<string[]> {
  try {
    const App = await getApp();
    const app = App as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
    const sceneRoot = (await app["GetRepoRoot"]("SceneModel")) as string;
    if (!sceneRoot) return [];
    const raw = (await app["ScanModelEntriesFiltered"](sceneRoot, "SceneModel", "", "场景模型")) as Array<{ Path?: string }> | null;
    return (raw || []).map((e) => e.Path || "");
  } catch {
    return [];
  }
}
