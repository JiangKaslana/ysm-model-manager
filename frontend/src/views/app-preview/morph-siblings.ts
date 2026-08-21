// ===== CustomMorph 同类型候选列表（只扫 CustomMorph 目录的 VPD 文件）=====
// 与 mmd-siblings.ts / scene-siblings.ts 同款路径构造：
//   GetRepoRoot("EntityPlayer") → {FilesRoot}/mmd/EntityPlayer
//   ↑ 退一级到 group 根 → {FilesRoot}/mmd
//   + /CustomMorph → {FilesRoot}/mmd/CustomMorph
import { getApp } from "../../backend/app.ts";
import { RESOURCE_TYPES } from "../../utils/resource/types.ts";

const MORPH_SUBDIR = "CustomMorph";

/** CustomMorph 目录下所有 VPD 姿势文件（含子目录）；失败返回 [] */
export async function resolveMorphSiblings(): Promise<string[]> {
  try {
    const App = await getApp();
    const app = App as unknown as Record<string, (a: string) => Promise<unknown>>;
    const typeRoot = (await app["GetRepoRoot"](RESOURCE_TYPES.MMD)) as string;
    if (!typeRoot) return [];
    const groupRoot = typeRoot.replace(/[/\\]+$/, "").split(/[/\\]/).slice(0, -1).join("/");
    const morphRoot = groupRoot + "/" + MORPH_SUBDIR;
    const entries = (await app["ScanModelEntries"](morphRoot)) as Array<{ Path?: string }> | null;
    return (entries || [])
      .map((e) => e.Path || "")
      .filter((p) => /\.vpd$/i.test(p));
  } catch {
    return [];
  }
}

/** CustomMorph 目录下所有 VMD 动画文件（含子目录）；失败返回 [] */
export async function resolveMorphAnimSiblings(): Promise<string[]> {
  try {
    const App = await getApp();
    const app = App as unknown as Record<string, (a: string) => Promise<unknown>>;
    const typeRoot = (await app["GetRepoRoot"](RESOURCE_TYPES.MMD)) as string;
    if (!typeRoot) return [];
    const groupRoot = typeRoot.replace(/[/\\]+$/, "").split(/[/\\]/).slice(0, -1).join("/");
    const morphRoot = groupRoot + "/" + MORPH_SUBDIR;
    const entries = (await app["ScanModelEntries"](morphRoot)) as Array<{ Path?: string }> | null;
    return (entries || [])
      .map((e) => e.Path || "")
      .filter((p) => /\.(vmd|vpd)$/i.test(p));
  } catch {
    return [];
  }
}
