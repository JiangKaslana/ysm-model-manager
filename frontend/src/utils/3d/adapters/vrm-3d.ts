// ===== VRM 3D 预览（ADR-066 P1：富格式前端直引 three-vrm）=====
// ADR-066 P3：脚手架已收缴进 mount-preview-core.ts，内容层抽到 vrm-adapter.ts。
// 本文件仅作兼容薄包装，保留 createVrm3D / cleanupVrm3D / invalidateVrmPreview
// 公开符号，index.ts 与既有测试无需改动。

import { mount3D, cleanupPreview, invalidatePreview, switchPreview, type PreviewAdapter, type Mount3DOptions } from "./mount-preview-core.ts";
import { buildVrmScene } from "./vrm-adapter.ts";

const vrmAdapter: PreviewAdapter = { id: "vrm", build: buildVrmScene };

/** 打开 VRM 3D 预览（.vrm 直引 three-vrm）；siblings 提供同类型候选以渲染 topBar 切换下拉 */
export async function createVrm3D(path: string, opts?: Mount3DOptions): Promise<void> {
  await mount3D(vrmAdapter, path, opts);
}

/** 当前 VRM 会话内切换模型（复用外壳重建内容层，不重建 renderer；ADR-066 §5.6） */
export async function switchVrmPreview(path: string): Promise<void> {
  await switchPreview(path);
}

/** 清理 VRM 3D（WebGL renderer + rAF 循环）：组件销毁/再次创建前调用，防 GPU 资源残留 */
export function cleanupVrm3D(): void {
  cleanupPreview();
}

/** 任意新预览派发时调用，作废在途 VRM 加载 */
export function invalidateVrmPreview(): void {
  invalidatePreview();
}
