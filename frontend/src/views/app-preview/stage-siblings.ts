// ===== StageAnim 舞台包资源扫描（只扫 StageAnim 目录的 VMD + 音频文件）=====
// 与 scene-siblings.ts 同款 ADR-094 路径构造。
// StageAnim 目录结构：
//   StageAnim/<舞台包>/
//     ├── *.vmd      角色动画 / 相机轨道
//     ├── *.mp3      背景音乐
//     ├── *.ogg      （可选）
//     ├── *.wav      （可选）
//     └── stage_config.json
import { getApp } from "../../backend/app.ts";
import { RESOURCE_TYPES } from "../../utils/resource/types.ts";

const STAGE_SUBDIR = "StageAnim";

/** 扫描 StageAnim 目录下所有资源文件（VMD + 音频）；失败返回 [] */
export async function resolveStageSiblings(): Promise<Array<{
  path: string;
  kind: "vmd" | "audio" | "config" | "other";
}>> {
  try {
    const App = await getApp();
    const app = App as unknown as Record<string, (a: string) => Promise<unknown>>;
    const typeRoot = (await app["GetRepoRoot"](RESOURCE_TYPES.MMD)) as string;
    if (!typeRoot) return [];
    const groupRoot = typeRoot.replace(/[/\\]+$/, "").split(/[/\\]/).slice(0, -1).join("/");
    const stageRoot = groupRoot + "/" + STAGE_SUBDIR;
    const entries = (await app["ScanModelEntries"](stageRoot)) as Array<{ Path?: string }> | null;
    const results: Array<{ path: string; kind: "vmd" | "audio" | "config" | "other" }> = [];
    for (const e of entries || []) {
      const p = e.Path || "";
      if (!p) continue;
      const ext = (p.split(/[/\\]/).pop() || "").toLowerCase();
      if (ext.endsWith(".vmd")) results.push({ path: p, kind: "vmd" });
      else if (/\.(mp3|ogg|wav)$/i.test(p)) results.push({ path: p, kind: "audio" });
      else if (ext === "stage_config.json") results.push({ path: p, kind: "config" });
    }
    return results;
  } catch {
    return [];
  }
}

/** 仅获取 StageAnim 下所有 VMD 文件路径列表 */
export async function resolveStageVmdList(): Promise<string[]> {
  const all = await resolveStageSiblings();
  return all.filter((r) => r.kind === "vmd").map((r) => r.path);
}

/** 仅获取 StageAnim 下所有音频文件路径列表 */
export async function resolveStageAudioList(): Promise<string[]> {
  const all = await resolveStageSiblings();
  return all.filter((r) => r.kind === "audio").map((r) => r.path);
}
