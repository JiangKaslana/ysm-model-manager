// ===== VRM 3D 预览（ADR-066 P1：富格式前端直引 three-vrm）=====
// ADR-066 P3：脚手架已收缴进 mount-preview-core.ts，内容层抽到 vrm-adapter.ts。
// 本文件仅作兼容薄包装，保留 createVrm3D / cleanupVrm3D / invalidateVrmPreview
// 公开符号，index.ts 与既有测试无需改动。

import { mount3D, cleanupPreview, invalidatePreview, switchPreview, type PreviewAdapter, type Mount3DOptions } from "../../utils/3d/adapters/mount-preview-core.ts";
import { buildVrmScene, type VrmPanelHooks } from "../../utils/3d/adapters/vrm-adapter.ts";
import { getApp } from "../../backend/app.ts";
import { makeVrmPanelRenderer } from "./vrm-controls.ts";
import { fillMmdPlayPanel } from "./mmd-controls.ts";

/** 数据读取注入（视图壳层保留 getApp；适配器 0 backend import，ADR-072 边界判据） */
async function readFileBytes(path: string): Promise<string | null> {
  const App = await getApp();
  return (App as unknown as Record<string, (p: string) => Promise<string | null>>)["ReadFileBytes"](path);
}

/** 同目录文件枚举（VRMA 动作扫描用；对齐 MMD 同款 ListAllFilePaths 注入） */
async function listAllFilePaths(dir: string): Promise<string[] | null> {
  const App = await getApp();
  return (App as unknown as Record<string, (d: string) => Promise<string[] | null>>)["ListAllFilePaths"](dir);
}

const vrmPanelHooks: VrmPanelHooks = {
  makePanelRenderer: makeVrmPanelRenderer,
  // 播放面板复用 MMD 填充函数（views→views 合法；解除 utils→views 分层违规 R1）
  fillPlayPanel: fillMmdPlayPanel,
};

const vrmAdapter: PreviewAdapter = {
  id: "vrm",
  build: (ctx, path) => buildVrmScene(ctx, path, readFileBytes, vrmPanelHooks, listAllFilePaths),
};

/** 打开 VRM 3D 预览（.vrm 直引 three-vrm）；siblings 提供同类型候选以渲染 topBar 切换下拉 */
export async function createVrm3D(path: string, opts?: Mount3DOptions): Promise<void> {
  await mount3D(vrmAdapter, path, opts);
}

/** 当前 VRM 会话内切换模型（复用外壳重建内容层，不重建 renderer；ADR-066 §5.6） */
export async function switchVrmPreview(path: string): Promise<void> {
  await switchPreview(path);
}

/** 同台追加 VRM 模型：不清理旧场景，将新模型 add 到已有场景（多模型同框） */
export async function appendVrmPreview(path: string): Promise<void> {
  await switchPreview(path, { keepInScene: true });
}

/** 清理 VRM 3D（WebGL renderer + rAF 循环）：组件销毁/再次创建前调用，防 GPU 资源残留 */
export function cleanupVrm3D(): void {
  cleanupPreview();
}

/** 任意新预览派发时调用，作废在途 VRM 加载 */
export function invalidateVrmPreview(): void {
  invalidatePreview();
}
