// ===== YSM 3D 内容适配器（ADR-066 P3-E：收敛 YSM 自驱渲染器到统一外壳）=====
// 采用 core 的 self 外壳模式：core 提供 overlay / topBar / body / viewContainer /
// loadingEl / closeBtn / ESC / resize / 代际守卫 / cleanup 编排；本适配器经
// renderModel3D 自驱 3D 内部（YSM 渲染器是自带 renderer/scene/controls/rAF 的
// 单例，不能像 vrm/litematic 那样共享 ctx + update(dt)）。
//
// ADR-066 §5.6 方案 A：YSM 专属 UI（多纹理选择 / 截图菜单 / 模型组选择 / 骨骼面板）
// 已拆至 ysm-controls.ts，相机控件（旋转/速度/重置）复用 core buildCameraControls；
// 本文件保持「内容构建 + 装配」单一职责。
import { renderModel3D } from "../../utils/3d/model3d.ts";
import type { Spec3D } from "../../utils/3d/model3d.ts";
import { preloadModel, type ModelLike } from "./model3d-loader.ts";
import { buildYsmTopBarControls, buildYsmPanel, type YsmModel } from "./ysm-controls.ts";
import type { PreviewScene, PreviewBuildCtx, PreviewAdapter } from "./mount-preview-core.ts";
import type { Model3DHandleX } from "./skeleton-render.ts";

/** 适配器可选项：纹理切换重建 / 关闭回调由外层（ysm-3d.ts）负责 */
export interface YsmAdapterOptions {
  /** 用户切换纹理时触发重建（旧 overlay 清理 + 按新 texIdx 重新挂载） */
  onTextureChange?: (texIdx: number) => void;
  /** core 关闭（ESC / 关闭按钮 / 切模型 cleanup）时回调：复位调用方状态 + 注销 android-back */
  onClose?: () => void;
}

/**
 * 构建 YSM 3D 内容场景并挂载到统一外壳（self 模式）。
 * 成功路径自行移除 core 提供的 loadingEl（对齐 vrm/litematic 既有口径）。
 */
export async function buildYsmScene(
  ctx: PreviewBuildCtx,
  model: YsmModel,
  texIdx: number,
  opts: YsmAdapterOptions,
): Promise<PreviewScene> {
  const { texArr, spec } = await preloadModel(model as ModelLike);
  const h = (await renderModel3D(
    ctx.viewContainer,
    texArr,
    spec as Spec3D,
    texIdx,
  )) as Model3DHandleX;

  // 成功路径：移除 core 提供的加载指示器（错误/空数据场景由 core 保留 loadingEl 并提示）
  ctx.loadingEl.remove();

  // 闭包共享：extraControls 创建、extraPanel 消费的 YSM 模型组选择器
  let modelSel: HTMLSelectElement | null = null;

  return {
    dispose(): void {
      // 对齐原 skeleton.ts close3D：清 timeTimer / keyHandler + 内容层 cleanup
      if (h._timeTimer) clearInterval(h._timeTimer);
      if (h._keyHandler) document.removeEventListener("keydown", h._keyHandler);
      h.cleanup();
    },

    extraControls(topBar: HTMLElement): void {
      const built = buildYsmTopBarControls(topBar, {
        model,
        texIdx,
        texArr,
        spec: spec as Spec3D,
        handle: h,
        onTextureChange: opts.onTextureChange,
      });
      modelSel = built.modelSel;
    },

    extraPanel(panel: HTMLElement): void {
      if (!modelSel) return;
      buildYsmPanel(panel, {
        model,
        texIdx,
        texArr,
        spec: spec as Spec3D,
        handle: h,
      }, modelSel);
    },
  };
}

/** 工厂：构造统一 PreviewAdapter（self 模式） */
export function makeYsmAdapter(
  model: YsmModel,
  texIdx: number,
  opts: YsmAdapterOptions = {},
): PreviewAdapter {
  return {
    id: "ysm",
    mode: "self",
    onClose: opts.onClose,
    build(ctx: PreviewBuildCtx): Promise<PreviewScene> {
      return buildYsmScene(ctx, model, texIdx, opts);
    },
  };
}
