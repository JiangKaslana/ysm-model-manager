// ===== MMD 3D 预览（ADR-066 P2：富格式前端直引 @moeru/three-mmd）=====
// 内容层在 mmd-adapter.ts；本文件仅作兼容薄包装，保留 createMmd3D / cleanupMmd3D /
// invalidateMmdPreview 公开符号，index.ts 分发对齐 vrm-3d.ts 模式。

import { mount3D, cleanupPreview, invalidatePreview, type PreviewAdapter, type Mount3DOptions } from "./mount-preview-core.ts";
import { buildMmdScene, type MmdDataPort } from "./mmd-adapter.ts";
import { getApp } from "../../../backend/app.ts";
import { RESOURCE_TYPES } from "../../../utils/resource/types.ts";

/** 数据端口注入（视图壳层保留 getApp；适配器 0 backend import，ADR-072 边界判据） */
async function makeMmdPort(): Promise<MmdDataPort> {
  const App = await getApp();
  return {
    readFileBytes: (p) =>
      (App as unknown as Record<string, (x: string) => Promise<string | null>>)["ReadFileBytes"](p),
    listAllFilePaths: (d) =>
      (App as unknown as Record<string, (x: string) => Promise<string[] | null>>)["ListAllFilePaths"](d),
    addOpLog: async (op, msg, status, err) => {
      try {
        const addFn = (App as unknown as Record<string, (a: string, b: string, c: string, d: string, e: number, f: string, g: string) => Promise<unknown>>)["AddOpLog"];
        if (typeof addFn !== "function") return;
        await addFn("mmd-preview", op, msg, "", 0, status, err || "");
      } catch {
        /* 诊断不阻断 */
      }
    },
  };
}

const mmdAdapter: PreviewAdapter = {
  id: "mmd",
  build: async (ctx, path) => buildMmdScene(ctx, path, await makeMmdPort()),
};

/** 打开 MMD 3D 预览（.pmx/.pmd 直引 @moeru/three-mmd）；siblings 提供同类型候选以渲染 topBar 切换下拉（ADR-066 §5.6） */
export async function createMmd3D(path: string, opts?: Mount3DOptions): Promise<void> {
  await mount3D(mmdAdapter, path, opts);
}

/** 同类型 MMD 模型候选（GetRepoRoot 类型根 → ScanModelEntries 主文件 Path 列表）；失败返回 []（下拉不渲染） */
export async function resolveMmdSiblings(): Promise<string[]> {
  try {
    const App = await getApp();
    const app = App as unknown as Record<string, (a: string) => Promise<unknown>>;
    const root = (await app["GetRepoRoot"](RESOURCE_TYPES.MMD)) as string;
    if (!root) return [];
    const entries = (await app["ScanModelEntries"](root)) as Array<{ Path?: string }> | null;
    return (entries || [])
      .map((e) => e.Path || "")
      .filter((p) => /\.(pmx|pmd)$/i.test(p));
  } catch {
    return [];
  }
}

/** 清理 MMD 3D（WebGL renderer + rAF 循环）：组件销毁/再次创建前调用，防 GPU 资源残留 */
export function cleanupMmd3D(): void {
  cleanupPreview();
}

/** 任意新预览派发时调用，作废在途 MMD 加载 */
export function invalidateMmdPreview(): void {
  invalidatePreview();
}
