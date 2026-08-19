// ===== MMD 3D 预览（ADR-066 P2：富格式前端直引 @moeru/three-mmd）=====
// 内容层在 mmd-adapter.ts；本文件仅作兼容薄包装，保留 createMmd3D / cleanupMmd3D /
// invalidateMmdPreview 公开符号，index.ts 分发对齐 vrm-3d.ts 模式。

import { mount3D, cleanupPreview, invalidatePreview, type PreviewAdapter, type Mount3DOptions } from "../../utils/3d/adapters/mount-preview-core.ts";
import { buildMmdScene, type MmdDataPort, type MmdPanelHooks } from "../../utils/3d/adapters/mmd-adapter.ts";
import { getApp } from "../../backend/app.ts";
import { fillMmdModelPanel, fillMmdPlayPanel, fillMmdShotPanel, buildMaterialControls } from "./mmd-controls.ts";
import { registerReRoute, withPreviewExtras, openModel3DFullscreen } from "./preview-library.ts";
import { RESOURCE_TYPES } from "../../utils/resource/types.ts";

// 注册跨类型换角色路由（资源库面板/导航 FAB 选中 MMD 时派发到此）
registerReRoute(RESOURCE_TYPES.MMD, (path) => createMmd3D(path));

/** 数据端口注入（视图壳层保留 getApp；适配器 0 backend import，ADR-072 边界判据） */
async function makeMmdPort(): Promise<MmdDataPort> {
  const App = await getApp();
  return {
    readFileBytes: (p) =>
      (App as unknown as Record<string, (x: string) => Promise<string | null>>)["ReadFileBytes"](p),
    readFileBytesBatch: async (paths) => {
      try {
        const batchFn = (App as unknown as Record<string, (x: string[]) => Promise<Record<string, string | null>>>)["ReadFileBytesBatch"];
        if (typeof batchFn !== "function") return {};
        return await batchFn(paths);
      } catch {
        return {};
      }
    },
    // KTX2 缓存管线依赖 hash：一次 RPC 拿回数据+hash，缺失则 blobUrlToHash 恒空 → 编码/替换全短路
    readFileBytesBatchWithMeta: async (paths) => {
      try {
        const batchFn = (App as unknown as Record<string, (x: string[]) => Promise<Record<string, { data: string | null; hash: string } | null>>>)["ReadFileBytesBatchWithMeta"];
        if (typeof batchFn !== "function") return {};
        return await batchFn(paths);
      } catch {
        return {};
      }
    },
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
    getCachedTexture: async (p) => {
      try {
        const appAny = App as unknown as Record<string, (x: string) => Promise<unknown>>;
        const getFn = appAny["GetCachedTexture"];
        if (typeof getFn !== "function") return null;
        const result = await getFn(p) as { format: string; data: string; hash: string } | null;
        if (!result) return null;
        return { format: result.format, data: result.data, hash: result.hash };
      } catch {
        return null;
      }
    },
  };
}

const mmdPanelHooks: MmdPanelHooks = {
  fillModelPanel: fillMmdModelPanel,
  fillPlayPanel: fillMmdPlayPanel,
  fillShotPanel: fillMmdShotPanel,
  buildMaterialControls,
};

const mmdAdapter: PreviewAdapter = {
  id: "mmd",
  build: async (ctx, path) => buildMmdScene(ctx, path, await makeMmdPort(), mmdPanelHooks),
};

/** 打开 MMD 3D 预览（.pmx/.pmd 直引 @moeru/three-mmd）；siblings 提供同类型候选以渲染 topBar 切换下拉（ADR-066 §5.6） */
export async function createMmd3D(path: string, opts?: Mount3DOptions): Promise<void> {
  await mount3D(mmdAdapter, path, withPreviewExtras(opts ?? {}));
}

/** 清理 MMD 3D（WebGL renderer + rAF 循环）：组件销毁/再次创建前调用，防 GPU 资源残留 */
export function cleanupMmd3D(): void {
  cleanupPreview();
}

/** 同台追加 MMD 模型：经统一路由主门收口（cooperate → keepInScene 追加，ADR-093 T4） */
export async function appendMmdPreview(path: string): Promise<void> {
  await openModel3DFullscreen(path, { cooperate: true });
}

/** 任意新预览派发时调用，作废在途 MMD 加载 */
export function invalidateMmdPreview(): void {
  invalidatePreview();
}
