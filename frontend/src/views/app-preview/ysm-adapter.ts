// ===== YSM 3D 内容适配器（ADR-066 §5.7 shared 化：path 驱动 + 统一外壳）=====
// 从 self 模式（自驱 renderer 绕开统一外壳）改为 shared 模式：内容层
// buildYsmObject 挂进核心 ctx.scene，renderer/camera/controls/rAF 由
// mount-preview-core 统一提供——与 vrm/litematic 完全同构。
//
// 数据层 path 驱动（用户反馈：model 闭包不能 path 切换）：build(ctx, path)
// 内经注入的 loader(path) 加载 model（预览面板语境的数据加载链，含缓存/
// WASM/Go 兜底，由 skeleton 层注入），switchTo(newPath) 对 YSM 生效。
//
// YSM 特色保留：骨骼射线拾取（绑核心 renderer.domElement）、底部导航分类弹窗
// （buildYsmBottomNav，相机控件复用核心 cameraControls）。
// 已知降级（后续补）：调试模式（F 键 normal/pivot/bone 可视化）暂不接入 shared。
import * as THREE from "three";
import { preloadModel, type ModelLike } from "./model3d-loader.ts";
import { buildYsmObject, type YsmObjectHandle } from "../../utils/3d/ysm-object.ts";
import { fitCameraToScene } from "../../utils/3d/camera-setup.ts";
import { buildBoneHierarchy, registerBoneRaycast } from "../../utils/3d/bone-raycast.ts";
import { buildYsmBottomNav, type YsmContentHandle, type YsmModel } from "./ysm-controls.ts";
import type { Spec3D, BoneSelectInfo } from "../../utils/3d/model3d.ts";
import type { BedrockGeometry } from "./geometry.ts";
import type { PreviewScene, PreviewBuildCtx, PreviewAdapter } from "./mount-preview-core.ts";

/** 适配器可选项：loader 注入（预览面板语境数据加载链）/ 纹理重建 / 关闭回调 */
export interface YsmAdapterOptions {
  /** path → model 加载器（由 skeleton 层注入：loadModelData(p, ctx)，含缓存/WASM/Go 兜底） */
  loader: (path: string) => Promise<BedrockGeometry | null>;
  /** 用户切换纹理时触发重建（旧 overlay 清理 + 按新 texIdx 重新挂载） */
  onTextureChange?: (texIdx: number) => void;
  /** core 关闭（ESC / 关闭按钮 / 切模型 cleanup）时回调：复位调用方状态 + 注销 android-back */
  onClose?: () => void;
  /** 当前纹理下标（多纹理模型重建时传入） */
  texIdx?: number;
}

/** 骨骼拾取状态（bone-raycast 需要的最小 state） */
function makeRayState(): {
  hoveredBone: string | null;
  hoveredMesh: unknown;
  setHoveredBone: (v: string | null) => void;
  setHoveredMesh: (v: unknown) => void;
  onBoneSelectCallback: ((info: BoneSelectInfo) => void) | null;
} {
  const s = {
    hoveredBone: null as string | null,
    hoveredMesh: null as unknown,
    setHoveredBone: (v: string | null) => {
      s.hoveredBone = v;
    },
    setHoveredMesh: (v: unknown) => {
      s.hoveredMesh = v;
    },
    onBoneSelectCallback: null as ((info: BoneSelectInfo) => void) | null,
  };
  return s;
}

/**
 * 构建 YSM 3D 内容并挂载到统一外壳（shared 模式）。
 * path 驱动：loader(path) → model → preloadModel → buildYsmObject 挂 ctx.scene。
 */
export async function buildYsmScene(
  ctx: PreviewBuildCtx,
  path: string,
  opts: YsmAdapterOptions,
): Promise<PreviewScene> {
  if (!ctx.scene || !ctx.camera || !ctx.controls || !ctx.renderer) {
    throw new Error("YSM shared 模式需要核心提供 scene/camera/controls/renderer");
  }

  // 数据层：path → model（skeleton 注入的预览面板加载链）
  const model = await opts.loader(path);
  if (!model) throw new Error("模型数据加载失败: " + path);

  const texIdx = opts.texIdx ?? 0;
  const { texArr, spec } = await preloadModel(model as ModelLike);

  // 内容层：spec → 场景图（§5.7 shared 化，renderModel3D 同款 buildYsmObject）
  const obj: YsmObjectHandle = buildYsmObject(spec as Spec3D, texArr, texIdx);
  ctx.scene.add(obj.rootGroup);

  // 相机取景 + 记录初始位置（resetCamera 恢复）
  fitCameraToScene(ctx.scene, ctx.camera, ctx.controls);
  const initCamPos = ctx.camera.position.clone();
  const initCamTarget = ctx.controls.target.clone();

  // 骨骼射线拾取（YSM 特色）：绑定核心 renderer.domElement
  const rayState = makeRayState();
  const { nameMap, parentMap, childrenMap } = buildBoneHierarchy(spec as Spec3D);
  const rayCleanup = registerBoneRaycast(
    ctx.renderer,
    ctx.camera,
    ctx.scene,
    obj.boneGroupMap,
    nameMap,
    parentMap,
    childrenMap,
    rayState as never,
  );

  // 内容句柄（fill3DPanel / 底部导航消费；相机操作走核心 cameraControls）
  const content: YsmContentHandle = {
    showModelGroup: (i: number) => obj.showModelGroup(i),
    getModelGroupCount: () => obj.getModelGroupCount(),
    setBoneVisible: (name: string, visible: boolean) => obj.setBoneVisible(name, visible),
    toggleBone: (name: string) => obj.toggleBone(name),
    getBoneList: () => obj.getBoneList(),
    onBoneSelect: null,
    _boneDetailEl: null,
  };
  rayState.onBoneSelectCallback = (info: BoneSelectInfo) => {
    content.onBoneSelect?.(info);
  };

  // 底部悬浮导航 + 分类弹窗（§5.7 范式）
  buildYsmBottomNav(ctx.overlay, {
    model: model as YsmModel,
    texIdx,
    texArr,
    spec: spec as Spec3D,
    handle: content,
    cameraControls: ctx.cameraControls,
    onTextureChange: opts.onTextureChange,
  });

  // 成功路径：移除核心 loadingEl（错误/空数据由核心保留并提示）
  ctx.loadingEl.remove();

  return {
    dispose(): void {
      rayCleanup();
      obj.removeFromScene(ctx.scene as THREE.Scene);
    },
    resetCamera(): void {
      ctx.camera!.position.copy(initCamPos);
      ctx.controls!.target.copy(initCamTarget);
      ctx.controls!.update();
    },
    setRotationMode: (orbit: boolean) => ctx.cameraControls?.setOrbit(orbit),
    setSpeed: (n: number) => ctx.cameraControls?.setSpeed(n),
    showModelGroup: (i: number) => obj.showModelGroup(i),
    // onBoneSelect 由 ysm-controls 内部接线（content.onBoneSelect），不暴露给 core
  };
}

/** 工厂：构造统一 PreviewAdapter（shared 模式） */
export function makeYsmAdapter(path: string, opts: YsmAdapterOptions): PreviewAdapter {
  return {
    id: "ysm",
    // shared 模式（§5.7）：核心提供 renderer/scene/camera/controls/rAF，适配器只注入内容
    onClose: opts.onClose,
    build(ctx: PreviewBuildCtx): Promise<PreviewScene> {
      return buildYsmScene(ctx, path, opts);
    },
  };
}
