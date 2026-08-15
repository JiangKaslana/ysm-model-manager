// ===== YSM 3D 薄包装（ADR-066 P3-E：skeleton.ts 经此接入统一外壳）=====
// 把"打开 YSM 3D"收敛为对 mount-preview-core 的一次调用；多纹理切换重建、
// Android 返回键注册/注销、关闭时状态复位由本层 + skeleton 编排层配合完成。
// 旧实现 skeleton.ts._toggle3D 直接 build3DOverlay + renderModel3D 并手工接线，
// 现统一经本包装，避免复制脚手架、与 vrm/litematic 走同一套外壳。
//
// 注意：与 vrm/litematic 不同，YSM 适配器是 model 闭包驱动（makeYsmAdapter(model)，
// build(ctx) 忽略 path）——core 的 switchTo(path) 对 ysm 无换模型语义（会重建同一
// model）。3D 内模型切换对 ysm 需走 model 维度（重建 createYsm3D(newModel)），
// 属 ADR-066 §5.6 任务 #4「ysm 待接线」，本层不暴露 path 版 switch。
import { mount3D, cleanupPreview, invalidatePreview } from "./mount-preview-core.ts";
import { makeYsmAdapter } from "./ysm-adapter.ts";
import type { BedrockGeometry } from "./geometry.ts";

/** YSM 模型对象（对齐 ysm-adapter 字段需求） */
export type YsmModel = BedrockGeometry & {
  textures?: string[] | null;
  _modelPath?: string;
  textureNames?: string[];
  boneCount?: number;
  bones?: unknown[];
};

export interface YsmOpenOptions {
  /** core 关闭（ESC / 关闭按钮 / 切模型 cleanup）时回调：复位调用方状态 + 注销 android-back */
  onClose?: () => void;
}

/**
 * 打开 YSM 3D 预览（统一外壳 self 模式）。
 * texIdx 支持多纹理切换重建：适配器经 onTextureChange 回调本层，cleanup 旧会话后按新 texIdx 重挂。
 */
export async function createYsm3D(
  model: YsmModel,
  texIdx = 0,
  opts: YsmOpenOptions = {},
): Promise<void> {
  const rebuild = (idx: number): void => {
    cleanupPreview();
    void createYsm3D(model, idx, opts);
  };
  cleanupPreview();
  await mount3D(
    makeYsmAdapter(model, texIdx, {
      onTextureChange: rebuild,
      onClose: opts.onClose,
    }),
    model._modelPath || "",
  );
}

/** 关闭活跃 YSM 3D 预览（WebGL renderer + rAF + overlay 全清） */
export function cleanupYsm3D(): void {
  cleanupPreview();
}

/** 作废在途 YSM 3D 加载（切模型前调用，防旧会话迟到渲染覆盖新模型） */
export function invalidateYsmPreview(): void {
  invalidatePreview();
}
