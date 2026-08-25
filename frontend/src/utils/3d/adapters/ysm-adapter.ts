// ===== YSM 3D 内容适配器（ADR-066 §5.7 shared 化：path 驱动 + 统一外壳）=====
// 从 self 模式（自驱 renderer 绕开统一外壳）改为 shared 模式：内容层
// buildYsmObject 挂进核心 ctx.scene，renderer/camera/controls/rAF 由
// mount-preview-core 统一提供——与 vrm/litematic 完全同构。
//
// 数据层 path 驱动（用户反馈：model 闭包不能 path 切换）：build(ctx, path)
// 内经注入的 loader(path) 加载 model（预览面板语境的数据加载链，含缓存/
// WASM/Go 兜底，由 skeleton 层注入），switchTo(newPath) 对 YSM 生效。
//
// YSM 特色保留：骨骼射线拾取（绑核心 renderer.domElement）、声明式根菜单专属项
// （model/截图/骨骼 经 built.menuItems 由 mount 层统一 feed dock + 角色详情归口，ADR-076 v2 Phase 2、ADR-093）。
// 已知降级（后续补）：调试模式（F 键 normal/pivot/bone 可视化）暂不接入 shared。
// ⚠️ 已解除：F 键调试模式现已接入 shared 模式，经 rebuildDebug 复用旧 renderModel3D 的
// 相同逻辑（pivot 线 + 骨骼连接 + Sprite 标签），与旧单例路径行为一致。
import * as THREE from "three";
import { RESOURCE_TYPES } from "../../resource/types.ts";
import { buildYsmObject, type YsmObjectHandle } from "../ysm-object.ts";
import { fitCameraToScene } from "../camera-setup.ts";
import { buildBoneHierarchy, registerBoneRaycast } from "../bone-raycast.ts";
import { buildBoneTree, type BoneNode, type BoneTree } from "../bone-tools.ts";
import { rebuildDebug } from "../debug-render.ts";
import { disposeDebugGroup } from "../cleanup-helper.ts";
import { screenshotFromRenderer } from "../screenshot.ts";
import type { YsmContentHandle, YsmControlsContext } from "../../../views/app-preview/ysm-controls.ts";
import type { PreviewMenuNode } from "./preview-menu-node-types.ts";
import type { Spec3D, BoneSelectInfo, BoneMaps } from "../model3d.ts";
import { sceneRegistry } from "./scene-registry.ts";
import type { BedrockGeometry } from "../../../views/app-preview/geometry.ts";
import type { PreviewScene, PreviewBuildCtx, PreviewAdapter } from "./mount-preview-core.ts";
import { makeBonePanelRenderer } from "./vrm-bone-ui.ts"; // ADR-074 S2: 通用骨骼面板
import { buildPerceptionControls, type PerceptionState, type PerceptionCapability } from "./perception-controls.ts";
import { registerModelRoot, unregisterModelRoot } from "../frustum-cull.ts";
import { createYsmAnimPlayer, type YsmAnimPlayer } from "../ysm-animation-player.ts";
import { parseBedrockAnimationJSON, ysmAnimClipLabels, type AnimationClip } from "../../animation/animation.ts";
import { b64ToBytes } from "../base64.ts";
import type { MmdPlayBridge } from "../../../views/app-preview/mmd-controls.ts";
import { ysmSemanticBoneMap } from "../semantic-bones.ts";
import { createBreathController } from "../perception/breath.ts";
import { recordLoadTrace } from "../load-trace.ts";

/** 适配器可选项：loader 注入（预览面板语境数据加载链）/ 纹理重建 / 关闭回调 */
export interface YsmAdapterOptions {
  /** path → model 加载器（由 skeleton 层注入：loadModelData(p, ctx)，含缓存/WASM/Go 兜底） */
  loader: (path: string) => Promise<BedrockGeometry | null>;
  /** preloadModel 注入（视图壳层数据转换：model → { texArr, spec, componentTexMap }，含 WASM/Go 兜底） */
  preload: (model: unknown) => Promise<{ texArr: (THREE.Texture | null)[]; spec: unknown; componentTexMap: Map<string, (THREE.Texture | null)[]> }>;
  /** 用户切换纹理时触发重建（旧 overlay 清理 + 按新 texIdx 重新挂载） */
  onTextureChange?: (texIdx: number) => void;
  /** core 关闭（ESC / 关闭按钮 / 切模型 cleanup）时回调：复位调用方状态 + 注销 android-back */
  onClose?: () => void;
  /** 当前纹理下标（多纹理模型重建时传入） */
  texIdx?: number;
  /**
   * 面板填充回调（视图层注入，解除 utils→views 运行时分层违规 R1，ADR 分层契约）。
   * 缺失时菜单 render / 骨骼拾取联动退化为 no-op（测试与无面板场景安全）。
   */
  panels?: {
    fillModelPanel: (list: HTMLElement, ctx: YsmControlsContext) => void;
    fillShotPanel: (list: HTMLElement, ctx: YsmControlsContext) => void;
    attachBoneSelect: (content: YsmContentHandle, cb: (id: string) => void) => void;
  };
  /** 同目录文件枚举（.animation.json 扫描用；对齐 VRM listAllFilePaths 注入模式） */
  listAllFilePaths?: (dir: string) => Promise<string[] | null>;
  /** base64 文本读取（读 .animation.json 字节用；对齐 VRM readFn 注入模式） */
  readTextFile?: (path: string) => Promise<string | null>;
  /** 播放面板填充回调（视图层注入；复用 fillMmdPlayPanel，解除 utils→views 分层违规 R1） */
  fillPlayPanel?: (list: HTMLElement, bridge: MmdPlayBridge) => void;
  /**
   * 渲染模式（ADR-Bedrock 通用化）：
   * - "ysm"（默认）：启用 YSM 专属特性（动画扫描、语义骨骼、呼吸控制）
   * - "generic"：纯 Bedrock 渲染，跳过 YSM 专属特性（用于车万女仆等通用 Bedrock 模型）
   */
  mode?: "ysm" | "generic";
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

  const tStart = performance.now();
  // 数据层：path → model（skeleton 注入的预览面板加载链）
  const tLoadStart = performance.now();
  const model = await opts.loader(path);
  const tLoadEnd = performance.now();
  if (!model) throw new Error("模型数据加载失败: " + path);

  const texIdx = opts.texIdx ?? 0;
  const tPreloadStart = performance.now();
  const { texArr, spec, componentTexMap } = await opts.preload(model);
  const tPreloadEnd = performance.now();

  // 内容层：spec → 场景图（§5.7 shared 化，renderModel3D 同款 buildYsmObject）
  const tBuildStart = performance.now();
  const obj: YsmObjectHandle = buildYsmObject(spec as Spec3D, texArr, componentTexMap, texIdx);
  const tBuildEnd = performance.now();
  ctx.scene.add(obj.rootGroup);
  registerModelRoot(obj.rootGroup);

  // 相机取景 + 记录初始位置（resetCamera 恢复）
  fitCameraToScene(obj.rootGroup, ctx.camera, ctx.controls);
  const initCamPos = ctx.camera.position.clone();
  const initCamTarget = ctx.controls.target.clone();

  // 骨骼射线拾取（YSM 特色）：绑定核心 renderer.domElement
  const rayState = makeRayState();
  const { nameMap, parentMap, childrenMap } = buildBoneHierarchy(spec as Spec3D);
  // ADR-093 T5：多模型会话中后续模型不注册自身监听，交统一拾取器接管（防重复 + 菜单错位）
  const multiMode = sceneRegistry.count() >= 1;
  const rayCleanup = multiMode
    ? () => {}
    : registerBoneRaycast(
        ctx.renderer,
        ctx.camera,
        ctx.scene,
        obj.boneGroupMap,
        nameMap,
        parentMap,
        childrenMap,
        rayState as never,
      );
  const boneMaps: BoneMaps = { boneGroupMap: obj.boneGroupMap, nameMap, parentMap, childrenMap };

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

  // 骨骼拾取联动（YSM 特色）：未开根菜单时先打开 model 面板，详情框更新 + 滚动高亮
  // 填充函数由视图层经 opts.panels 注入（解除 utils→views 分层违规 R1）
  opts.panels?.attachBoneSelect?.(content, (id: string) => ctx.menu.openPanel(id));

  // ADR-077: 骨骼面板接入（通用版 makeBonePanelRenderer）
  // 从 spec.bones 构建 BoneNode[] → buildBoneTree → 喂入通用面板渲染器
  const bonePanelRef: YsmBonePanelRef = { current: null };
  const specBones = (spec as Spec3D).models?.flatMap((m) => m.bones ?? []) ?? [];
  const boneNodes: BoneNode[] = specBones.map((b) => ({
    id: b.id,
    name: b.name,
    parentId: b.parentId ?? null,
    // ysm 有 boneGroupMap（boneId → Group），必须传 object——
    // 否则骨骼面板显隐（toggleBoneVisible）/坐标（getBonePosition）/拾取联动
    // （pickBone objectToId）全部 no-op，面板退化成纯列表。
    object: obj.boneGroupMap.get(b.id),
  }));
  const boneTree = buildBoneTree(boneNodes);

  // 成功路径：移除核心 loadingEl（错误/空数据由核心保留并提示）
  ctx.loadingEl.remove();

  // ---- YSM 骨骼动画（ADR-100 L1+L2+L3）：内嵌 clips 优先，磁盘扫描兜底 ----
  // ADR-Bedrock 通用化：generic 模式跳过动画/语义骨骼/呼吸（女仆等通用 Bedrock 模型）
  const isGenericMode = opts.mode === "generic";
  let animPlayer: YsmAnimPlayer | null = null;
  let animBridge: MmdPlayBridge | null = null;
  let semanticBones: import("../semantic-bones.ts").SemanticBoneMap | null = null;
  let breath: ReturnType<typeof createBreathController> | null = null;
  if (!isGenericMode) {
    try {
      const specBones = (spec as Spec3D).models?.flatMap((m) => m.bones ?? []) ?? [];
      // 语义骨骼映射（L2）
      semanticBones = ysmSemanticBoneMap(specBones);
      // 呼吸控制器（L2，动画播放时暂停）
      breath = createBreathController();

      const allClips: Array<{ label: string; clip: AnimationClip }> = [];
      const embedded = model._animClips ?? [];
      if (embedded.length > 0) {
        // 内嵌动画优先：WASM/Go 解码已解析的 clips——单文件 .ysm 的主来源
        // （旧口径只扫磁盘，单文件模型磁盘没有 .animation.json → 动作面板空列表）
        embedded.forEach((clip, i) => {
          allClips.push({ label: clip.name || `Clip ${i + 1}`, clip });
        });
      } else if (opts.listAllFilePaths && opts.readTextFile) {
        // 磁盘兜底：无内嵌动画时扫同目录 .animation.json
        const dirPath = path.replace(/[^/\\]*$/, "").replace(/[/\\]$/, "");
        const files = (await opts.listAllFilePaths(dirPath)) || [];
        const animFiles = files.filter((f) => f.toLowerCase().endsWith(".animation.json"));
        for (const animFile of animFiles) {
          try {
            const b64 = await opts.readTextFile(animFile);
            if (!b64) continue;
            // UTF-8 正确解码（旧 atob 直转会让中文 clip 名乱码）
            const text = new TextDecoder("utf-8").decode(b64ToBytes(b64));
            const { clips } = parseBedrockAnimationJSON(text);
            if (clips.length > 0) {
              // L3 全 clip 列表：同一 .animation.json 内多 clip 全部收录
              // （旧口径只取 clips[0]，多动作定义被静默丢弃——ADR-100 已知遗留）
              const fileBase = animFile.split(/[/\\]/).pop()!.replace(/\.animation\.json$/i, "");
              const fileLabels = ysmAnimClipLabels(fileBase, clips);
              for (let ci = 0; ci < clips.length; ci++) {
                allClips.push({ label: fileLabels[ci], clip: clips[ci] });
              }
            }
          } catch { /* 单个文件解析失败跳过 */ }
        }
      }
      if (allClips.length > 0) {
        // 构建 boneByName：spec.bones[].name → 骨骼 Group（boneGroupMap 值为 Group 层级节点）
        const boneByName = new Map<string, THREE.Object3D>();
        for (const sb of specBones) {
          const group = obj.boneGroupMap.get(sb.id);
          if (group) boneByName.set(sb.name, group);
        }
        const hierarchy: import("../../animation/animation.ts").BoneHierarchyNode[] =
          specBones.map((b) => ({ name: b.name, parent: b.parentId ?? undefined }));
        const labels = allClips.map((c) => c.label);
        const clips = allClips.map((c) => c.clip);
        animPlayer = createYsmAnimPlayer(boneByName, clips, hierarchy, labels);
        animBridge = {
          clips: allClips.map((c) => ({ label: c.label })),
          isPlaying: () => animPlayer?.isPlaying() ?? false,
          toggle: () => animPlayer?.toggle(),
          currentIndex: () => animPlayer?.currentIndex() ?? 0,
          select: (i: number) => animPlayer?.selectClip(i),
          animDir: null,
        };
      }
    } catch {
      /* 动画扫描失败 → 静默降级，不影响模型渲染 */
    }
  }

  // ---- 声明式根菜单专属项（ADR-076 v2 Phase 2）：model / 截图 / 骨骼 ----
  // 适配器只声明结构与 render，core 拥有外壳；e2e 经 data-testid="preview-<id>" 遍历。
  // 菜单表提取为可导出 ysmMenuItems()：测试遍历同一份真实数组断言结构（对齐 MikuMikuAR）。
  const controlsCtx: YsmControlsContext = {
    model,
    texIdx: opts.texIdx ?? 0,
    texArr,
    spec: spec as Spec3D,
    handle: content,
    cameraControls: ctx.cameraControls,
    onTextureChange: opts.onTextureChange,
    // ADR-052 P3：截图走共享 renderer（通用化手段，替代死代码 screenshotPreview）
    screenshot: () =>
      Promise.resolve(screenshotFromRenderer(ctx.renderer!, ctx.scene, ctx.camera)),
  };
  // 感知层状态：YSM 只有呼吸模块
  const perceptionState: PerceptionState = { breath: true, gaze: false, blink: false, lipSync: false, autoDance: false };
  const perceptionCaps: PerceptionCapability[] = [
    { id: "breath", labelKey: "preview.perceptionBreath", fallback: "呼吸" },
  ];

  const menuItems = ysmMenuItems({
    controlsCtx,
    panels: opts.panels,
    bonePanel: {
      tree: boneTree,
      viewContainer: ctx.viewContainer,
      camera: ctx.camera,
      scene: ctx.scene,
      cleanupRef: bonePanelRef,
    },
    play: animBridge ?? undefined,
    fillPlayPanel: opts.fillPlayPanel,
    perception: { state: perceptionState, caps: perceptionCaps },
  });
  // dock 🧍 平铺 + 角色详情归口统一走 built.menuItems（mount 层统一 feed/注册，对齐 litematic 范本），
  // 不再在此直调 ctx.menu.setAdapterItems，避免双 feed 导致 dock 重复三连。

  // ---- F 键调试模式（旧 renderModel3D 功能，shared 模式接入）----
  // 三态循环：normal（无调试）→ pivot（pivot 线 + 标签）→ bone（骨骼连接线）→ normal
  // rebuildDebug 复用旧 renderModel3D 的相同逻辑（pivot 线 + 骨骼连接 + Sprite 标签）。
  // 状态持有：debugMode 记录当前模式，debugGroup 持有当前调试叠加层（供下次重建前 dispose）。
  const debugState = {
    debugMode: "normal" as "normal" | "pivot" | "bone",
    debugGroup: null as THREE.Group | null,
  };
  // F 键切换 debug 模式（绑定 renderer.domElement，与旧单例 renderModel3D 行为一致）
  const onFKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== "f" && e.key !== "F") return;
    // 忽略 Shift/Ctrl/Alt 修饰（仅裸 F）
    if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    e.stopPropagation();
    const modes: Array<"normal" | "pivot" | "bone"> = ["normal", "pivot", "bone"];
    const currentIdx = modes.indexOf(debugState.debugMode);
    const nextMode = modes[(currentIdx + 1) % modes.length];
    debugState.debugMode = nextMode;
    rebuildDebug(
      ctx.scene as THREE.Scene,
      obj.rootGroup,
      obj.boneGroupMap,
      spec as Spec3D,
      debugState,
    );
  };
  ctx.renderer!.domElement.addEventListener("keydown", onFKeyDown);

  // 加载剖析：perf 面板甘特图消费（读取+解析+纹理由 preloadModel 上报；本层补 build 段）
  try {
    const specTyped = spec as Spec3D;
    const allBones = specTyped.models?.flatMap(m => m.bones ?? []) ?? [];
    const texCount = texArr.filter(Boolean).length;
    recordLoadTrace({
      ts: Date.now(),
      format: "ysm",
      path,
      stages: [
        { name: "读取", ms: Math.round(tLoadStart - tStart), status: "ok" },
        { name: "解析", ms: Math.round(tLoadEnd - tLoadStart), status: "ok" },
        { name: "纹理加载", ms: Math.round(tPreloadEnd - tPreloadStart), status: "ok" },
        { name: "build", ms: Math.round(tBuildEnd - tBuildStart), status: "ok" },
      ],
      assets: {
        files: 1,
        textures: texCount,
        bones: allBones.length,
        cubes: (model as { cubeCount?: number }).cubeCount ?? 0,
        materials: specTyped.models?.length ?? 0,
        animations: 0,
      },
      ok: true,
    });
  } catch { /* perf trace 失败不影响渲染 */ }

  return {
    dispose(): void {
      rayCleanup();
      bonePanelRef.current?.();
      unregisterModelRoot(obj.rootGroup);
      obj.removeFromScene(ctx.scene as THREE.Scene);
      // F 键调试模式清理：移除事件监听 + 释放调试叠加层
      ctx.renderer!.domElement.removeEventListener("keydown", onFKeyDown);
      if (debugState.debugGroup) {
        disposeDebugGroup(debugState.debugGroup);
        debugState.debugGroup = null;
      }
      animPlayer?.dispose();
      breath?.dispose();
    },
    resetCamera(): void {
      ctx.camera!.position.copy(initCamPos);
      ctx.controls!.target.copy(initCamTarget);
      ctx.controls!.update();
    },
    setRotationMode: (orbit: boolean) => ctx.cameraControls?.setOrbit(orbit),
    setSpeed: (n: number) => ctx.cameraControls?.setSpeed(n),
    showModelGroup: (i: number) => obj.showModelGroup(i),
    // ADR-052 P3：截图走共享 renderer（通用化手段，替代死代码 screenshotPreview）
    screenshot: () =>
      Promise.resolve(screenshotFromRenderer(ctx.renderer!, ctx.scene, ctx.camera)),
    // onBoneSelect 由 attachYsmBoneSelect 接线（content.onBoneSelect），不暴露给 core
    // ADR-093 T5：回填骨骼映射 + 菜单项，供注册表 dispatch（多模型拾取归属 + 换菜单）
    boneMaps,
    menuItems,
    onBonePick: (id: string) => ctx.menu.openPanel(id),
    // ADR-100：动画驱动（perFrame 钩子，core rAF 每帧调用）+ L2 感知层
    update: (dt: number): void => {
      animPlayer?.apply(dt);
      // 动画播放时暂停感知层（与 VRM VRMA 口径一致）
      if (semanticBones && !animPlayer?.isAnimActive() && perceptionState.breath) {
        breath?.apply(dt, semanticBones);
      }
    },
  };
}

/** 工厂：构造统一 PreviewAdapter（shared 模式） */
export function makeYsmAdapter(path: string, opts: YsmAdapterOptions): PreviewAdapter {
  return {
    id: RESOURCE_TYPES.YSM,
    // shared 模式（§5.7）：核心提供 renderer/scene/camera/controls/rAF，适配器只注入内容
    onClose: opts.onClose,
    // 必须用 build 传入的 path（switchTo(newPath) 重建内容层的换模型入口），
    // 闭包 path 仅是首次挂载的初始值——否则 switchTo 对 YSM 加载同一旧模型（假切换）。
    build(ctx: PreviewBuildCtx, buildPath: string): Promise<PreviewScene> {
      return buildYsmScene(ctx, buildPath, opts);
    },
  };
}

/** 骨骼面板清理引用（菜单项 render 与 adapter dispose 共享，防重入泄漏） */
interface YsmBonePanelRef {
  current: (() => void) | null;
}

/** ysmMenuItems 组装依赖：适配器 build 内组装；测试可构造假依赖遍历真实菜单表 */
export interface YsmMenuItemsOpts {
  controlsCtx: YsmControlsContext;
  /** 骨骼面板依赖（render 闭包 + 清理引用） */
  bonePanel: {
    /** 已构建骨骼树（buildBoneTree 产物） */
    tree: BoneTree;
    viewContainer: HTMLElement | null;
    /** 兼容真实 ctx 可选字段（undefined）与测试假依赖（null） */
    camera: THREE.PerspectiveCamera | null | undefined;
    scene: THREE.Object3D | null | undefined;
    cleanupRef: YsmBonePanelRef;
  };
  /** 面板填充回调（视图层注入；缺失则 render 退化为 no-op，解除 utils→views 分层违规 R1） */
  panels?: {
    fillModelPanel: (list: HTMLElement, ctx: YsmControlsContext) => void;
    fillShotPanel: (list: HTMLElement, ctx: YsmControlsContext) => void;
  };
  /** YSM 动画桥（ADR-100）；null/缺省（无 .animation.json）→ 不注入 play 项 */
  play?: MmdPlayBridge | null | undefined;
  /** 播放面板填充回调（视图层注入；复用 fillMmdPlayPanel，解除 utils→views 分层违规 R1） */
  fillPlayPanel?: (list: HTMLElement, bridge: MmdPlayBridge) => void;
  /** 感知层状态（adapter build 创建，面板 UI 双向绑定） */
  perception?: {
    state: PerceptionState;
    caps: PerceptionCapability[];
  };
}

/**
 * YSM 声明式根菜单专属项（ADR-076 v2 Phase 2）：model / 截图 / 骨骼。
 * 提取为可导出表：适配器与测试共用同一份真实数组——测试遍历本表断言结构与
 * dock 渲染（对齐 MikuMikuAR 声明式菜单测试范式），加菜单项只改这里。
 * model/截图/骨骼 归 🧍 模型组；play 归 💃 动作组（有 clip 才显示）。
 */
export function ysmMenuItems(o: YsmMenuItemsOpts): PreviewMenuNode[] {
  const items: PreviewMenuNode[] = [
    {
      id: "model",
      icon: "🧍",
      labelKey: "preview.modelInfo",
      fallback: "模型",
      kind: "panel",
      dockGroup: "model",
      legacyTestId: "ysm-model-entry",
      renderCustom:(list) => o.panels?.fillModelPanel?.(list, o.controlsCtx),
    },
    {
      id: "shot",
      icon: "📷",
      labelKey: "preview.screenshot",
      fallback: "截图",
      kind: "panel",
      dockGroup: "model",
      legacyTestId: "ysm-shot-entry",
      renderCustom:(list) => o.panels?.fillShotPanel?.(list, o.controlsCtx),
    },
    {
      id: "bones",
      icon: "🦴",
      labelKey: "preview.bones",
      fallback: "骨骼",
      kind: "panel",
      dockGroup: "model",
      legacyTestId: "ysm-bones-entry",
      renderCustom:(list) => {
        // 通用骨骼面板（ADR-077）：渲染进根菜单面板；重入时先清理旧 renderer
        if (o.bonePanel.cleanupRef.current) {
          o.bonePanel.cleanupRef.current();
          o.bonePanel.cleanupRef.current = null;
        }
        o.bonePanel.cleanupRef.current = makeBonePanelRenderer(o.bonePanel.tree)(list, {
          viewContainer: o.bonePanel.viewContainer!,
          camera: o.bonePanel.camera!,
          scene: o.bonePanel.scene!,
        });
      },
    },
  ];
  if (o.play) {
    items.push({
      id: "ysm-play",
      icon: "▶️",
      labelKey: "preview.mmdPlay",
      fallback: "播放",
      kind: "panel",
      legacyTestId: "ysm-play-entry",
      dockGroup: "motion",
      renderCustom:(list) => {
        o.fillPlayPanel?.(list, o.play!);
      },
    });
  }
  if (o.perception) {
    items.push({
      id: "perception",
      icon: "👁️",
      labelKey: "preview.perception",
      fallback: "感知",
      kind: "panel",
      dockGroup: "motion",
      renderCustom:(list) => buildPerceptionControls(list, o.perception!.state, o.perception!.caps),
    });
  }
  return items;
}
