// ===== Litematic 体素 3D 预览（ADR-066 P3：脚手架收缴进 mount-preview-core.ts）=====
// 内容层抽到 litematic-adapter.ts。本文件仅作兼容薄包装，保留
// createLitematic3D / cleanupVoxel3D / invalidateLitematicPreview 公开符号，
// litematic-meta.ts 与既有测试无需改动。voxelFn 经适配器工厂传入，决定走哪条 Go RPC。

import { mount3D, cleanupPreview, invalidatePreview, switchPreview, type PreviewAdapter, type Mount3DOptions } from "./mount-preview-core.ts";
import { buildLitematicScene } from "./litematic-adapter.ts";
import { getApp } from "../../../backend/app.ts";

/** voxelCall 注入（视图壳层保留 getApp；适配器 0 backend import，ADR-072 边界判据） */
function makeVoxelCall(voxelFn: string): (path: string) => Promise<string> {
  return async (path: string): Promise<string> => {
    const App = await getApp();
    const fn = (App as unknown as Record<string, (p: string) => Promise<string>>)[voxelFn || "GetLitematicVoxelData"];
    return fn(path);
  };
}

function makeLitematicAdapter(voxelFn: string): PreviewAdapter {
  return { id: "litematic", build: (ctx, path) => buildLitematicScene(ctx, path, makeVoxelCall(voxelFn)) };
}

/** 打开 Litematic/蓝图 体素 3D 预览（voxelFn 由注册表 VOXEL_RPC_BY_EXT 解析）；siblings 提供同类型候选 */
export async function createLitematic3D(path: string, voxelFn: string, opts?: Mount3DOptions): Promise<void> {
  await mount3D(makeLitematicAdapter(voxelFn), path, opts);
}

/** 当前 Litematic 会话内切换模型（复用外壳重建内容层，不重建 renderer；ADR-066 §5.6） */
export async function switchLitematicPreview(path: string): Promise<void> {
  await switchPreview(path);
}

/** 清理体素 3D（WebGL renderer + rAF 循环）：组件销毁/再次创建前调用，防 GPU 资源残留 */
export function cleanupVoxel3D(): void {
  cleanupPreview();
}

/** 任意新预览派发时调用，作废在途体素加载 */
export function invalidateLitematicPreview(): void {
  invalidatePreview();
}
