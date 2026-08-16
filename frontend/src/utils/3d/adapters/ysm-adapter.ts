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
import { buildYsmObject, type YsmObjectHandle } from "../ysm-object.ts";
import { fitCameraToScene } from "../camera-setup.ts";
import { buildBoneHierarchy, registerBoneRaycast } from "../bone-raycast.ts";
import { buildBoneTree, type BoneNode } from "../bone-tools.ts";
import type { YsmContentHandle, YsmModel, YsmControlsContext } from "../../../views/app-preview/ysm-controls.ts";
import type { Spec3D, BoneSelectInfo } from "../model3d.ts";
import type { BedrockGeometry } from "../../../views/app-preview/geometry.ts";
import type { PreviewScene, PreviewBuildCtx, PreviewAdapter } from "./mount-preview-core.ts";
import { makeBonePanelRenderer } from "./vrm-bone-ui.ts"; // ADR-074 S2: 通用骨骼面板

/** 适配器可选项：loader 注入（预览面板语境数据加载链）/ 纹理重建 / 关闭回调 */
export interface YsmAdapterOptions {
  /** path → model 加载器（由 skeleton 层注入：loadModelData(p, ctx)，含缓存/WASM/Go 兜底） */
  loader: (path: string) => Promise<BedrockGeometry | null>;
  /** preloadModel 注入（视图壳层数据转换：model → { texArr, spec }，含 WASM/Go 兜底） */
  preload: (model: unknown) => Promise<{ texArr: (THREE.Texture | null)[]; spec: unknown }>;
  /** buildYsmBottomNav 注入（视图壳层 UI 控件：底部导航 + 分类弹窗） */
  navBuilder: (overlay: HTMLElement, ctx: YsmControlsContext) => void;
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
  const { texArr, spec } = await opts.preload(model);

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

  // ADR-077: 骨骼面板接入（通用版 makeBonePanelRenderer）
  // 从 spec.bones 构建 BoneNode[] → buildBoneTree → 喂入通用面板渲染器
  let bonePanelCleanup: (() => void) | null = null;
  const specBones = (spec as Spec3D).models?.flatMap((m) => m.bones ?? []) ?? [];
  const boneNodes: BoneNode[] = specBones.map((b) => ({
    id: b.id,
    name: b.name,
    parentId: b.parentId ?? null,
    object: undefined, // YSM骨骼无直接 Object3D 引用，面板仅用于列表/详情
  }));
  const boneTree = buildBoneTree(boneNodes);

  // 成功路径：移除核心 loadingEl（错误/空数据由核心保留并提示）
  ctx.loadingEl.remove();

  return {
    dispose(): void {
      rayCleanup();
      bonePanelCleanup?.();
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
    // ADR-077: 骨骼面板通过 extraControls 接入（topBar 按钮 → extraPanel 容器）
    extraControls: (topBar: HTMLElement): void => {
      const btn = document.createElement("button");
      btn.textContent = "🦴 骨骼";
      btn.style.cssText =
        "font-size:11px;padding:2px 6px;border-radius:4px;border:1px solid rgba(255,255,255,0.2);background:rgba(0,0,0,0.3);color:rgba(255,255,255,0.8);cursor:pointer;font-family:inherit";
      btn.onclick = (): void => {
        const panel = topBar.parentElement?.parentElement?.querySelector<HTMLElement>("#ysm-3d-panel");
        if (!panel) return;
        if (bonePanelCleanup) {
          bonePanelCleanup();
          bonePanelCleanup = null;
          panel.style.display = "none";
          return;
        }
        panel.style.display = "";
        panel.innerHTML = "";
        bonePanelCleanup = makeBonePanelRenderer(boneTree)(panel, {
          viewContainer: ctx.viewContainer!,
          camera: ctx.camera!,
          scene: ctx.scene!,
        });
      };
      topBar.appendChild(btn);
    },
  };
}

/** 工厂：构造统一 PreviewAdapter（shared 模式） */
export function makeYsmAdapter(path: string, opts: YsmAdapterOptions): PreviewAdapter {
  return {
    id: "ysm",
    // shared 模式（§5.7）：核心提供 renderer/scene/camera/controls/rAF，适配器只注入内容
    onClose: opts.onClose,
    // 审核修复：必须用 build 传入的 path（switchTo(newPath) 重建内容层的换模型入口），
    // 闭包 path 仅是首次挂载的初始值——否则 switchTo 对 YSM 加载同一旧模型（假切换）。
    build(ctx: PreviewBuildCtx, buildPath: string): Promise<PreviewScene> {
      return buildYsmScene(ctx, buildPath, opts);
    },
  };
}
