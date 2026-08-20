// ===== 车万女仆 3D 预览（Bedrock 通用模式）=====
// ADR-Bedrock 通用化：复用 YSM 适配器的 Bedrock 渲染管道，
// 以 mode="generic" 跳过 YSM 专属特性（动画扫描/语义骨骼/呼吸控制）。
// 女仆模型本质是标准 Bedrock Edition geometry，Go AnalyzeBedrockModel
// 已天然支持 .zip 解析（parseModelFromEntries 通用路径）。
import { mount3D, cleanupPreview, invalidatePreview } from "../../utils/3d/adapters/mount-preview-core.ts";
import { makeYsmAdapter } from "../../utils/3d/adapters/ysm-adapter.ts";
import { getApp } from "../../backend/app.ts";
import type { BedrockGeometry } from "./geometry.ts";
import { preloadModel } from "./model3d-loader.ts";
import { loadModelData } from "./loader.ts";
import { fillYsmModelPanel, fillYsmShotPanel, attachYsmBoneSelect } from "./ysm-controls.ts";
import { registerReRoute, withPreviewExtras } from "./preview-library.ts";
import { RESOURCE_TYPES } from "../../utils/resource/types.ts";
import { t } from "../../core/i18n/t.ts";
import { esc } from "../../utils/dom/html.ts";
import { setActive3DClose } from "./skeleton.ts";
import { registerAndroidBackHandler } from "../../utils/dom/android-bridge.ts";
import type { PreviewCtx } from "./utils.ts";

/** 数据读取注入 */
async function readFileBytes(path: string): Promise<string | null> {
  const App = await getApp();
  return (App as unknown as Record<string, (p: string) => Promise<string | null>>)["ReadFileBytes"](path);
}

/** 跨类型换角色路由 */
async function openMaidFullscreen(path: string): Promise<void> {
  await createMaid3D(path, 0, {
    loader: async (p) =>
      (await loadModelData(p, { decodeYsmViaWasm: () => Promise.resolve(null), appendDebug: () => {} }, { skipWasm: true })).model,
  });
}
registerReRoute(RESOURCE_TYPES.MAID, openMaidFullscreen);

export interface MaidOpenOptions {
  loader: (path: string) => Promise<BedrockGeometry | null>;
  onClose?: () => void;
  siblings?: string[];
}

/**
 * 打开车万女仆 3D 预览（Bedrock generic 模式）。
 * 与 YSM 共享 spec→Three.js 渲染管道，跳过动画/语义骨骼等 YSM 专属特性。
 */
export async function createMaid3D(
  path: string,
  texIdx = 0,
  opts: MaidOpenOptions,
): Promise<void> {
  const rebuild = (idx: number): void => {
    cleanupPreview();
    void createMaid3D(path, idx, opts);
  };
  cleanupPreview();
  await mount3D(
    makeYsmAdapter(path, {
      mode: "generic",
      texIdx,
      loader: opts.loader,
      preload: (model) => preloadModel(model as never),
      onTextureChange: rebuild,
      onClose: opts.onClose,
      readTextFile: readFileBytes,
      panels: {
        fillModelPanel: fillYsmModelPanel,
        fillShotPanel: fillYsmShotPanel,
        attachBoneSelect: attachYsmBoneSelect,
      },
    }),
    path,
    withPreviewExtras({ siblings: opts.siblings }),
  );
}

/** 关闭活跃女仆 3D 预览 */
export function cleanupMaid3D(): void {
  cleanupPreview();
}

/** 作废在途女仆 3D 加载 */
export function invalidateMaidPreview(): void {
  invalidatePreview();
}

/**
 * 车万女仆详情预览（简化版：基本信息卡 + FAB 进 3D）。
 * 不同于 YSM 的丰富元数据（作者/动画/配置菜单），女仆模型展示简洁明细。
 * FAB 接线复用 skeleton 的 3D overlay 管理（_active3DClose / android-back）。
 */
export async function showMaidPreview(
  ctx: PreviewCtx,
  path: string,
): Promise<void> {
  const basename = path.split(/[/\\]/).pop() || path;
  ctx.root.innerHTML = `<div class="content" id="preview-content">
  <h3>🧸 ${t("preview.modelInfo")}</h3>
  <div class="dp-placeholder">
    <div class="big-icon">🧸</div>
    <div class="dp-hint">${esc(basename)}</div>
    <div class="dp-hint">Bedrock Edition Model</div>
  </div>
</div>
<button class="preview-fab" id="btn-3d-preview" title="${t("preview.title3d")}" aria-label="${t("preview.title3d")}"><span class="preview-ic">&#x1F3A8;</span></button>`;

  await ctx.loadPreviewImage(path);

  let _loading3D = false;
  let _model3dGen = 0;
  const _toggle3D = async (): Promise<void> => {
    if (_loading3D) return;
    _loading3D = true;
    const gen = ++_model3dGen;
    let unsubAndroidBack: (() => void) | null = null;
    const close3D = (): void => {
      cleanupMaid3D();
      _model3dGen++;
      setActive3DClose(null);
      if (unsubAndroidBack) { unsubAndroidBack(); unsubAndroidBack = null; }
      const idx = ctx.unsubs?.indexOf(close3D);
      if (idx !== undefined && idx > -1) ctx.unsubs?.splice(idx, 1);
    };
    const onClose = (): void => {
      setActive3DClose(null);
      if (unsubAndroidBack) { unsubAndroidBack(); unsubAndroidBack = null; }
    };
    ctx.unsubs?.push(close3D);
    setActive3DClose(() => close3D());
    unsubAndroidBack = registerAndroidBackHandler(() => { close3D(); return true; });
    try {
      await createMaid3D(path, 0, {
        loader: async (p) => (await loadModelData(p, ctx, { skipWasm: true })).model,
        onClose,
      });
    } catch (e) {
      if (gen !== _model3dGen) return;
      console.error("[maid-3d] 加载失败:", e);
    }
    _loading3D = false;
  };

  const btn3d = ctx.root.getElementById("btn-3d-preview");
  if (btn3d) btn3d.onclick = (): void => { void _toggle3D(); };
}