// ===== FBX 3D 预览（ADR-112：独立 FBX 预览地基）====
// 内容层在 fbx-adapter.ts；本文件仅作兼容薄包装，导出 createFbx3D。
// 清理/作废不设独立派发：mount-preview-core 的共享 cleanupPreview/invalidatePreview
// 由 index.ts 经 vrm/mmd 等 cleanup 派发全量覆盖 _handles，FBX 复用同一单例即可。

import { mount3D, type PreviewAdapter, type Mount3DOptions } from "../../utils/3d/adapters/mount-preview-core.ts";
import { buildFbxScene, type FbxDataPort } from "../../utils/3d/adapters/fbx-adapter.ts";
import { getApp } from "../../backend/app.ts";
import { withPreviewExtras, registerReRoute } from "./preview-library.ts";
import { RESOURCE_TYPES } from "../../utils/resource/types.ts";

// 注册跨类型换角色路由（资源库面板/导航 FAB 选中 FBX 时派发到此）
registerReRoute(RESOURCE_TYPES.FBX, (path) => createFbx3D(path));

/** 数据读取注入（视图壳层保留 getApp；适配器 0 backend import，ADR-072 边界判据） */
async function readFileBytes(path: string): Promise<string | null> {
  const App = await getApp();
  return (App as unknown as Record<string, (p: string) => Promise<string | null>>)["ReadFileBytes"](path);
}

/** 环形日志面板诊断（ADR-112：复用 MMD 同款 AddOpLog 注入，失败静默不阻断） */
async function addOpLog(op: string, msg: string, status: "ok" | "fail" | "warn", err?: string): Promise<void> {
  try {
    const App = await getApp();
    const fn = (App as unknown as Record<string, (a: string, b: string, c: string, d: string, e: number, f: string, g: string) => Promise<unknown>>)["AddOpLog"];
    if (typeof fn !== "function") return;
    await fn("fbx-preview", op, msg, "", 0, status, err || "");
  } catch {
    /* 诊断不阻断 */
  }
}

const fbxPort: FbxDataPort = { readFileBytes, addOpLog };

const fbxAdapter: PreviewAdapter = {
  id: "fbx",
  build: (ctx, path) => buildFbxScene(ctx, path, fbxPort),
};

/** 打开 FBX 3D 预览（独立资产：模型 + 内嵌动画）；siblings 透传同类型候选（ADR-066 §5.6） */
export async function createFbx3D(path: string, opts?: Mount3DOptions): Promise<void> {
  await mount3D(fbxAdapter, path, withPreviewExtras(opts ?? {}));
}
