// ===== CustomMorph 同类型候选列表（只扫 CustomMorph 目录的 VPD 文件）=====
// 直接用类型 ID 调 GetRepoRoot，后端返回 FilesRoot/mmd/CustomMorph，无需前端回溯拼接
import { getApp } from "../../backend/app.ts";

/** CustomMorph 目录下所有 VPD 姿势文件（含子目录）；失败返回 [] */
export async function resolveMorphSiblings(): Promise<string[]> {
  try {
    const App = await getApp();
    const app = App as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
    const morphRoot = (await app["GetRepoRoot"]("CustomMorph")) as string;
    if (!morphRoot) return [];
    const raw = (await app["ScanModelEntriesFiltered"](morphRoot, "CustomMorph", "", "自定义表情")) as Array<{ Path?: string }> | null;
    return (raw || [])
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
    const app = App as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
    const morphRoot = (await app["GetRepoRoot"]("CustomMorph")) as string;
    if (!morphRoot) return [];
    const raw = (await app["ScanModelEntriesFiltered"](morphRoot, "CustomMorph", "", "自定义表情")) as Array<{ Path?: string }> | null;
    return (raw || [])
      .map((e) => e.Path || "")
      .filter((p) => /\.(vmd|vpd)$/i.test(p));
  } catch {
    return [];
  }
}
