// ===== 场景 MMD 同类型候选列表（只扫 SceneModel 目录，与角色模型完全隔离）=====
// 路径构造复用 app-tree/loader.ts 的 ADR-094 位置路由模式：
//   GetRepoRoot("mmd-skin") → {FilesRoot}/mmd/EntityPlayer
//   ↑ 退一级到 group 根 → {FilesRoot}/mmd
//   + /SceneModel → {FilesRoot}/mmd/SceneModel
// 与 mmd-siblings.ts 的区别：
// - mmd-siblings 直接扫 GetRepoRoot 返回的 EntityPlayer（角色模型）
// - scene-siblings 复用同款路径构造退到 group 根 + SceneModel 子目录
import { getApp } from "../../backend/app.ts";
import { RESOURCE_TYPES } from "../../utils/resource/types.ts";

const SCENE_SUBDIR = "SceneModel";

/** 场景模型候选（只扫 SceneModel 子目录）；失败返回 [] */
export async function resolveSceneSiblings(): Promise<string[]> {
  try {
    const App = await getApp();
    const app = App as unknown as Record<string, (a: string) => Promise<unknown>>;
    const typeRoot = (await app["GetRepoRoot"](RESOURCE_TYPES.MMD)) as string;
    if (!typeRoot) return [];
    // ADR-094 位置路由：从类型根退一级到 group 根，再拼子目录（与 loader.ts §76-79 同款）
    const groupRoot = typeRoot.replace(/[/\\]+$/, "").split(/[/\\]/).slice(0, -1).join("/");
    const sceneRoot = groupRoot + "/" + SCENE_SUBDIR;
    const entries = (await app["ScanModelEntries"](sceneRoot)) as Array<{ Path?: string }> | null;
    return (entries || [])
      .map((e) => e.Path || "")
      .filter((p) => /\.(pmx|pmd)$/i.test(p));
  } catch {
    return [];
  }
}
