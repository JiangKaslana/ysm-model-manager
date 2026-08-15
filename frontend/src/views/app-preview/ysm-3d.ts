// ===== YSM 3D 薄包装（ADR-066 P3-E + §5.7 path 驱动）：skeleton.ts 经此接入统一外壳 =====
// 把"打开 YSM 3D"收敛为对 mount-preview-core 的一次调用；多纹理切换重建、
// Android 返回键注册/注销、关闭时状态复位由本层 + skeleton 编排层配合完成。
//
// §5.7 shared 化：YSM 适配器改 path 驱动（build(ctx, path) 内经 loadModelData
// 加载 model），与 vrm/litematic 同构——core 的 switchTo(path) 对 ysm 生效，
// 3D 内模型切换无需重建整个会话。
import { mount3D, cleanupPreview, invalidatePreview } from "./mount-preview-core.ts";
import { makeYsmAdapter } from "./ysm-adapter.ts";
import type { BedrockGeometry } from "./geometry.ts";

export interface YsmOpenOptions {
  /** path → model 加载器（skeleton 层注入：loadModelData(p, ctx)，含缓存/WASM/Go 兜底） */
  loader: (path: string) => Promise<BedrockGeometry | null>;
  /** core 关闭（ESC / 关闭按钮 / 切模型 cleanup）时回调：复位调用方状态 + 注销 android-back */
  onClose?: () => void;
  /** 同类型可切换的候选路径列表（≥2 时 core topBar 渲染切换下拉，ADR-066 §5.6） */
  siblings?: string[];
}

/**
 * 打开 YSM 3D 预览（统一外壳 shared 模式，path 驱动）。
 * texIdx 支持多纹理切换重建：适配器经 onTextureChange 回调本层，cleanup 旧会话后按新 texIdx 重挂。
 */
export async function createYsm3D(
  path: string,
  texIdx = 0,
  opts: YsmOpenOptions,
): Promise<void> {
  const rebuild = (idx: number): void => {
    cleanupPreview();
    void createYsm3D(path, idx, opts);
  };
  cleanupPreview();
  await mount3D(
    makeYsmAdapter(path, {
      texIdx,
      loader: opts.loader,
      onTextureChange: rebuild,
      onClose: opts.onClose,
    }),
    path,
    { siblings: opts.siblings },
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
