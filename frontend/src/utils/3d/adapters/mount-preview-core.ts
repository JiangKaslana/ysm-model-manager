// ===== 统一 3D 预览核心（ADR-066 P3：收缴 vrm/litematic 复制脚手架）=====
// 所有富格式 3D 预览（vrm / litematic / 后续 ysm）共用同一套外壳：
// overlay + 声明式根菜单(⚙️, CORE_MENU_ITEMS + 适配器注入项) + viewContainer + loadingEl +
// 适配器底部导航容器(topBar, 经 previewMenuItems 收编；仅剩 litematic 常驻分层控件例外) +
// scene/camera/renderer/OrbitControls/灯光 + WASD/拖拽自转 + resize +
// rAF 循环 + ESC + GPU 资源释放。内容差异由 PreviewAdapter 经 build() 注入，
// 每帧 update(dt) 驱动动态部分（如 VRM SpringBone）。
//
// 旧实现里 vrm-3d.ts 与 litematic-3d.ts 各自内联 ~250 行同构脚手架（"复制那套"），
// 本文件将其收敛为单一事实来源。适配器契约对齐 YSM 既有的 Model3DHandleX，
// 使三套渲染器最终可经注册表统一派发（P3-E）。
//
// ┌─ 快速跳转 ───────────────────────────────────────────────────────────────────┐
// │  §1  常量 + 状态变量      → L105   DRAG_ROTATE_SENSITIVITY / DEFAULT_CAM_SPEED │
// │  §2  公开 API             → L113   invalidatePreview / cleanupPreview         │
// │  §3  switchPreview        → L127   会话内切换模型（复用外壳）                   │
// │  §4  mount3D 入口         → L139   主挂载函数（722 行 → 见子节）               │
// │    └─ 基础设施创建        → L272   scene/camera/renderer/OrbitControls         │
// │    └─ UI 装配             → L180   overlay/topBar/侧栏/loading               │
// │    └─ 输入绑定            → L308   WASD 键盘 + 拖拽自转                       │
// │    └─ rAF 渲染管线        → L365   animate loop + postprocess composer        │
// │    └─ 生命周期管理        → L452   cooperate/switchTo/代际守卫               │
// │    └─ 通知 + 释放         → L580   toast + safeDisposeMat + fullCleanup       │
// │  §5  私有工具             → L749   safeDisposeMat                            │
// └──────────────────────────────────────────────────────────────────────────────┘

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { SkyCapability } from "../caps/sky-capability.ts";
import { GroundCapability } from "../caps/ground-capability.ts";
import { LightCapability } from "../caps/light-capability.ts";
import { PostprocessingManager } from "./postprocessing.ts";
import { runFullCleanup, type CleanupContext } from "./cleanup-3d.ts";
import { switchToSession, syncLightTargetFromContent } from "./switch-preview.ts";
import type { SwitchContext } from "./switch-preview.ts";
import { sceneRegistry } from "./scene-registry.ts";
import { fitCameraToRoots } from "../camera-setup.ts";
import { assembleBoneSelectInfo, getMeshBoneId } from "../bone-raycast.ts";
import { bindInputHandlers } from "./input-and-animation.ts";
import type { InputOptions } from "./input-and-animation.ts";
import { mountSidePanel } from "./side-panel.ts";
import { type SemanticBoneMap } from "../semantic-bones.ts";
import { bus } from "../../../bus.ts";
import { friendlyError } from "../../../utils/dom/errors.ts";
import { t } from "../../../core/i18n/t.ts";
import { esc } from "../../../utils/dom/html.ts";
import { safeGet, safeSet } from "../../../utils/dom/storage.ts";
import { createIconButton } from "../../../utils/dom/fab.ts";
import { installUiComponentsStyles } from "../../../ui/ui-components-styles.ts";
import { createSlideMenu } from "../../../ui/ui-helpers.ts";
import { createHeaderToggle } from "../../../ui/ui-header-toggle.ts";
import { mountPreviewRootMenu, type PreviewMenuHandle } from "./preview-menu.ts";
import type { PreviewMenuItemDef } from "./preview-menu-defs.ts";
import { type CameraControlBridge } from "./camera-controls.ts";
import type { BoneSelectInfo, BoneMaps } from "../model3d.ts";

/** 适配器构建时可用的通用外壳句柄（内容层据此注入场景/灯光/定相机） */
export interface PreviewBuildCtx {
  /** shared 模式下由核心创建并传入；self 模式（适配器自驱 renderer，如 ysm 单例）为 undefined */
  scene?: THREE.Scene;
  camera?: THREE.PerspectiveCamera;
  controls?: OrbitControls;
  viewContainer: HTMLElement;
  loadingEl: HTMLElement;
  overlay: HTMLElement;
  /** shared 模式下核心创建的 renderer（适配器射线拾取 / 截图 / 内容挂载用；self 模式 undefined） */
  renderer?: THREE.WebGLRenderer;
  /** shared 模式下核心的相机控制桥（旋转/速度/重置，操作核心内部状态；self 模式 undefined） */
  cameraControls?: CameraControlBridge;
  /** 当前会话内切换到另一模型（复用外壳重建内容层，ADR-066 §5.6）；延迟闭包——build 时 _handle 未赋值，点击时已就绪 */
  switchTo?(path: string, options?: { keepInScene?: boolean }): Promise<void>;
  /** 声明式根菜单注册通道（ADR-076 v2 Phase 2）：适配器 build 内经 setAdapterItems 注入专属菜单项、openPanel 打开面板（骨骼拾取联动） */
  menu: PreviewMenuHandle;
}

/** 适配器返回的内容场景契约（对齐 Model3DHandleX，方法全部可选，便于纯静态渲染） */
export interface PreviewScene {
  /** 每帧驱动（VRM SpringBone / 动画等）；无则仅静态渲染 */
  update?(dt: number): void;
  /** 释放内容层 GPU 资源（几何/材质/纹理/helper） */
  dispose(): void;
  resetCamera?(): void;
  setRotationMode?(orbit: boolean): void;
  setSpeed?(n: number): void;
  showModelGroup?(i: number): void;
  onBoneSelect?(info: BoneSelectInfo): void;
  /** 在通用 topBar 之后追加适配器专属控件（仅 litematic 分层控制器——唯一常驻控件例外） */
  extraControls?(topBar: HTMLElement): void;
  /** 在核心侧栏（如有）挂载适配器专属面板内容（ysm 骨骼列表/详情等） */
  extraPanel?(panel: HTMLElement): void;
  /** 语义骨骼映射（语义骨骼层消费方读取；无 = 该格式不接入语义层，消费方降级） */
  semanticBones?: SemanticBoneMap;
  /** 应用 VPD 姿势（MMD 专属；无 = 该格式不支持） */
  applyPose?(index: number): void;
  /** 截取当前 3D 渲染画面；PNG base64，无 data: 前缀—— ADR-052 P3 通用化 */
  screenshot?(): Promise<string | null>;
  /** 同台追加模式：true 表示不替换 scene，改为将模型 add 到已有场景（多模型同框） */
  keepInScene?: boolean;
  /** 骨骼映射（dispatch 拾取归属用，ADR-093 T5；未接入格式不返回） */
  boneMaps?: BoneMaps | null;
  /** 该模型声明式根菜单专属项（selectModel 换菜单用，ADR-093 T5；未接入为 null） */
  menuItems?: PreviewMenuItemDef[] | null;
  /** 多模型下由统一拾取器调用：点中该模型骨骼时打开其面板（ADR-093 T5） */
  onBonePick?: (boneId: string) => void;
}

export interface PreviewAdapter {
  id: string;
  /** "shared"（默认）：核心创建 renderer/scene/controls 并驱循环；"self"：适配器自驱（如 ysm 单例），核心仅提供外壳 */
  mode?: "shared" | "self";
  build(ctx: PreviewBuildCtx, path: string): Promise<PreviewScene>;
  /** core 关闭（ESC / 关闭按钮 / 切模型 cleanup）时回调：供适配器复位调用方状态、注销平台返回键等 */
  onClose?(): void;
}

/** 统一预览句柄（D 步 ysm 接入时经此暴露内容层方法） */
export interface PreviewHandle {
  cleanup(): void;
  resetCamera?(): void;
  setRotationMode?(orbit: boolean): void;
  setSpeed?(n: number): void;
  showModelGroup?(i: number): void;
  onBoneSelect?(info: BoneSelectInfo): void;
  /** 当前会话内切换到另一模型：复用外壳（renderer/rAF/controls/灯光）重建内容层（ADR-066 §5.6） */
  switchTo?(path: string, options?: { keepInScene?: boolean }): Promise<void>;
  /** 截取当前 3D 渲染画面（PNG base64，无 data: 前缀）—— ADR-052 P3 通用化 */
  screenshot?(): Promise<string | null>;
}

// ===== §1 常量 + 状态变量 =====
// 相机控制常量（buildCameraControls 已拆至 camera-controls.ts，本文件保留自身仍使用的部分：
// DRAG_ROTATE_SENSITIVITY 拖拽旋转 / DEFAULT_CAM_SPEED 初始速度 / TIP_AUTO_DISMISS_MS 提示自动消失）
const DRAG_ROTATE_SENSITIVITY = 0.003; // 自身旋转模式拖拽灵敏度（rad/px）
const DEFAULT_CAM_SPEED = 20;
const TIP_AUTO_DISMISS_MS = 6000;

let _handle: PreviewHandle | null = null;
let _gen = 0;

/** 任意新预览派发时调用，作废在途加载（对齐 invalidateVrmPreview / invalidateLitematicPreview） */
  // ===== §2 公开 API =====
  export function invalidatePreview(): void {
  _gen++;
}

/** 清理活跃 3D 预览（WebGL renderer + rAF 循环）：组件销毁/再次创建前调用，防 GPU 资源残留 */
export function cleanupPreview(): void {
  _gen++; // 作废在途加载
  if (_handle) {
    _handle.cleanup();
    _handle = null;
  }
}

/** 当前会话内切换到另一模型（复用外壳重建内容层，ADR-066 §5.6）；无活跃会话时 no-op */
export async function switchPreview(path: string, options?: { keepInScene?: boolean }): Promise<void> {
  await _handle?.switchTo?.(path, options);
}

/** 是否存在活跃 3D 预览会话（多模型同台追加的前置判定，ADR-093 T4） */
export function hasActivePreview(): boolean {
  return _handle !== null;
}

/** mount3D 附加选项（ADR-066 §5.6 3D 内模型切换） */
export interface Mount3DOptions {
  /** 同类型可切换的候选路径列表（≥2 时 topBar 渲染切换下拉；缺省不渲染，向后兼容） */
  siblings?: string[];
  /** 同台追加模式：true 时不移除旧模型，新模型追加到同一场景（多模型同框） */
  cooperate?: boolean;
  /** 跨类型跳转（切换模型选中不同类型：关当前 + 开目标；app 层 openModel3DFullscreen 注入）。
   *  第二参透传 siblings（当前会话候选），避免切换后新会话「当前目录」tab 为空 */
  switchExternal?: (path: string, siblings?: string[]) => Promise<void>;
  /** 当前会话资源类型（如 ysm/mmd-skin/vrchat-avatar/resourcepack）；类型 tab 点击时判断同类型走 switchTo */
  rtype?: string;
  /** 按资源类型懒加载候选模型路径（切换模型的类型 tab 点击时；缺省无 tab） */
  getModelsByType?: (rtype: string) => Promise<string[]>;
  /** 类型 tab 列表（有 3D opener 的类型；经 withPreviewExtras 注入，缺省仅「当前目录」tab） */
  getTypeTabs?: () => string[];
}

export async function mount3D(adapter: PreviewAdapter, path: string, opts: Mount3DOptions = {}): Promise<void> {
  const cooperate = opts.cooperate === true;
  if (!cooperate) cleanupPreview(); // 复用：再次创建先清旧的（同台模式不清理，保留旧模型）
  // 🥉 ui/ 库样式（light-DOM 场景）：overlay 是 document.body 下的普通 DOM 非 shadow，
  // 注入一次即可让 topBar 控件用上 mode-btn/setting-select 透明样式（幂等，§19）
  installUiComponentsStyles();
  const myGen = ++_gen;
  const selfMode = adapter.mode === "self";
  /** 当前模型路径（审核 #4：切换成功后「当前」项须指向新模型，原 path 移回候选）。
   *  siblings 不再 mount 时一次性过滤——getSiblings 基于 currentPath 动态过滤，
   *  切换模型即「变更 filter 路径」，全程轻量不重扫。 */
  let currentPath = path;

  // ---- shared 模式相机状态（提前声明：buildCameraControls 的 bridge 闭包需在此后引用）----
  // self 模式由适配器（如 ysm 的 renderModel3D 单例）自行驱动这些，核心只提供外壳，
  // 避免与适配器自带 renderer/循环冲突（双重渲染 / 双重键盘劫持）。
  let scene: THREE.Scene | undefined;
  let camera: THREE.PerspectiveCamera | undefined;
  let renderer: THREE.WebGLRenderer | undefined;
  let controls: OrbitControls | undefined;
  const isDisposed = { v: false };
  const keys: Record<string, boolean> = {};
  let camSpeed = DEFAULT_CAM_SPEED;
  let orbitMode = true;
  const euler = new THREE.Euler(0, 0, 0, "YXZ");
  let mouseDown = false;
  let lastMouse = { x: 0, y: 0 };
  let orbitTarget: THREE.Vector3 | undefined;
  // ===== §3 UI 装配（overlay/topBar/侧栏/loading/菜单）=====
  // 程序化天空能力（ADR-073 L1）：shared 模式注入统一核心，四种模型零改动继承
  let skyCap: SkyCapability | null = null;
  let groundCap: GroundCapability | null = null;
  let lightCap: LightCapability | null = null;
  // 后处理体积光管线（ADR-081 L2）：PostprocessingManager 管理 EffectComposer + bloom，仅在 volumetric engine=postprocess 时激活
  let postProc: PostprocessingManager | null = null;
  let animId = 0;
  let perFrame: ((dt: number) => void) | null = null;
  let onKeyDown: (e: KeyboardEvent) => void = () => {};
  let onKeyUp: (e: KeyboardEvent) => void = () => {};
  let onDragPointerDown: (e: PointerEvent) => void = () => {};
  let onDragPointerUp: (e: PointerEvent) => void = () => {};
  let onDragPointerMove: (e: PointerEvent) => void = () => {};
  let onResize: () => void = () => {};
  // R1-P2-1：提升为 let，使 cleanupCtx（块外构建）可访问 click 处理器
  let onUnifiedPick: ((e: MouseEvent) => void) | null = null;

  const overlay = document.createElement("div");
  overlay.id = "ysm-overlay-3d"; // 对齐旧 skeleton overlay 定位（测试/样式钩子）
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:var(--z-fullscreen);background:#1a1b2e;display:flex;flex-direction:column";
  document.body.appendChild(overlay);

  // 顶栏已移除（ADR-076 v2，用户 2026-08-16 决策）：预览控件（关闭/切换/环境/相机）全部收进
  // 声明式根菜单（⚙️ 按钮 → mountPreviewRootMenu），彻底告别顶栏滑块垃圾。

  // 相机控制桥（shared 模式）：core 的相机控件与 PreviewBuildCtx.cameraControls
  // 共用同一 bridge（操作核心内部 orbitMode/camSpeed/controls），适配器（如 ysm 底部
  // 导航）经 cameraControls 复用同一套相机状态。相机控件本身已收进声明式根菜单的 camera 项。
  const camBridge: CameraControlBridge = {
    getOrbit: () => orbitMode,
    setOrbit: (v: boolean) => {
      orbitMode = v;
      if (controls) controls.enableRotate = v;
      if (v) {
        if (orbitTarget && controls) orbitTarget.copy(controls.target);
      } else {
        if (camera) euler.setFromQuaternion(camera.quaternion);
      }
      mouseDown = false;
    },
    getSpeed: () => camSpeed,
    setSpeed: (n: number) => { camSpeed = n; },
    // built 在 try 块内声明，此处经模块级 _handle（PreviewHandle 含 resetCamera? 契约）延迟调用
    reset: () => { _handle?.resetCamera?.(); },
  };

  // 主体：body(flex row) 内放 viewContainer；self 模式适配器经 extraPanel 往 body 追加侧栏
  const body = document.createElement("div");
  body.style.cssText = "flex:1;display:flex;flex-direction:row;position:relative;overflow:hidden";
  const viewContainer = document.createElement("div");
  viewContainer.style.cssText = "flex:1;position:relative;overflow:hidden";
  body.appendChild(viewContainer);
  overlay.appendChild(body);

  // 适配器专属控件容器（仅 litematic 遗留 extraControls 常驻分层控制器继续使用：
  // litematic 分层（axis/layer）为高频常驻切片调节器，语义上非「打开即关」的模态面板，
  // 故保留顶栏常驻（其余 ysm/mmd/vrm 已按 ADR-076 v2 Phase 2 全量收编进 ⚙️ 根菜单）。
  const topBar = document.createElement("div");
  topBar.className = "ysm-3d-adapter-nav";
  topBar.style.cssText =
    "position:absolute;left:0;right:0;bottom:0;display:flex;align-items:center;gap:8px;" +
    "padding:8px 12px;z-index:11;background:rgba(20,21,38,0.85);" +
    "border-top:1px solid rgba(255,255,255,0.12);flex-wrap:wrap";
  overlay.appendChild(topBar);

  // 声明式根菜单（⚙️）：core 在 overlay 内自建（预览全屏盖住 app 外壳，主程序 nav.settings 够不着），
  // 全部控件以 CORE_MENU_ITEMS + 适配器注入项表驱动渲染（preview-menu-defs.ts），
  // 测试遍历真实菜单数组断言（preview-menu-items.test.ts），选择器稳定可遍历（ADR-076 v2）。
  const menuHandle = mountPreviewRootMenu(overlay, {
    selfMode,
    getSkyCap: () => skyCap,
    getGroundCap: () => groundCap,
    getLightCap: () => lightCap,
    getCamBridge: () => camBridge,
    getSiblings: () => (opts.siblings ?? []).filter((p) => p !== currentPath),
    getCurrentPath: () => currentPath,
    getCurrentRtype: () => opts.rtype ?? "",
    getModelsByType: opts.getModelsByType ? (t: string) => opts.getModelsByType!(t) : undefined,
    getTypeTabs: opts.getTypeTabs ? () => opts.getTypeTabs!() : undefined,
    getViewContainer: () => viewContainer,
    close: () => {
      if (cleanupFn) cleanupFn();
      else closeOverlay();
    },
    switchTo: (p: string, options?: { keepInScene?: boolean }) => {
      void _handle?.switchTo?.(p, options);
    },
    switchExternal: opts.switchExternal ? (p: string, s?: string[]): void => { void opts.switchExternal!(p, s); } : undefined,
  });
  // ADR-093 T5：注册表菜单 sink（selectModel 时按活跃模型换菜单项）
  sceneRegistry.setMenuSink({ setAdapterItems: (items) => menuHandle.setAdapterItems(items) });

  const loadingEl = document.createElement("div");
  loadingEl.style.cssText =
    "position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:rgba(255,255,255,0.6);font-size:14px;gap:12px;z-index:10;background:rgba(26,27,46,0.9)";
  viewContainer.appendChild(loadingEl);

  // ===== §4 基础设施创建（scene/camera/renderer/OrbitControls/灯光/resize）=====
  let aborted = false;
  // 可变 ESC 处理函数：switchTo 后重新赋值（审核 #2：防止旧 handler 被替换后新 handler 永不卸载）
  let escH = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      if (cleanupFn) cleanupFn();
      else closeOverlay();
    }
  };
  function closeOverlay(): void {
    aborted = true;
    document.removeEventListener("keydown", escH);
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    _handle = null;
    adapter.onClose?.();
  }
  document.addEventListener("keydown", escH);

  if (!selfMode) {
    scene = new THREE.Scene();
    scene.background = new THREE.Color("#1a1b2e");
    camera = new THREE.PerspectiveCamera(
      50,
      viewContainer.clientWidth / Math.max(viewContainer.clientHeight, 1),
      0.05,
      5000,
    );
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(viewContainer.clientWidth, viewContainer.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.domElement.style.touchAction = "none"; // ADR-047：触屏拖拽旋转需禁手势默认
    viewContainer.appendChild(renderer.domElement);
    // 程序化天空（ADR-073 L1）：注入统一核心，YSM/VRM/MMD/Litematic 经同一 scene 零改动继承
    skyCap = new SkyCapability({ scene, renderer });
    skyCap.setPreset(adapter.id); // #3 按模型类别套用散射/曝光预设
    skyCap.apply();
    // 地面（ADR-073 同款 caps/ 能力）：统一核心注入，各类型零改动继承
    groundCap = new GroundCapability({ scene });
    groundCap.apply();
    lightCap = new LightCapability({ scene, renderer });
    lightCap.setPreset(adapter.id);
    lightCap.apply();
    // 后处理体积光管线（ADR-081 L2）：PostprocessingManager 管理 EffectComposer + bloom
    postProc = new PostprocessingManager(renderer, scene, camera);
    // ADR-085 S3：caps 创建后触发 refreshDock()，修复 litematic/pack 的 environment 项时序缺失
    // （菜单先于 caps 挂载，挂载时 requiresEnvironment 被过滤；此处重渲染补回）
    menuHandle.refreshDock();
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.minDistance = 0.1;
    controls.maxDistance = 5000;
    controls.update();
    orbitTarget = (controls as OrbitControls).target.clone();
    controls.enableRotate = true;

    // ===== §4a 输入绑定（WASD 键盘 + 拖拽自转 + resize）=====
    const inputOpts: InputOptions = {
      keys,
      getOrbitMode: () => orbitMode,
      mouseDown: { v: mouseDown },
      lastMouse: { x: lastMouse.x, y: lastMouse.y },
      euler,
      camera,
      renderer,
      postProc,
      viewContainer,
      isDisposed,
    };
    const handlers = bindInputHandlers(inputOpts);
    onKeyDown = handlers.onKeyDown;

    // ADR-093 T5：统一多模型拾取器（仅 count>=2 激活，单模型完全沿用逐模型 registerBoneRaycast，零回归）
    const raycaster = new THREE.Raycaster();
    const pickPointer = new THREE.Vector2();
    onUnifiedPick = (e: MouseEvent): void => {
      if (sceneRegistry.count() < 2) return;
      if (!renderer || !camera || !scene) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pickPointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pickPointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pickPointer, camera);
      const hits = raycaster.intersectObjects(scene.children, true);
      for (const hit of hits) {
        // THREE Raycaster 不检查 visible，手动跳过隐藏链
        let node: THREE.Object3D | null = hit.object;
        let hidden = false;
        while (node) {
          if (!node.visible) { hidden = true; break; }
          node = node.parent;
        }
        if (hidden) continue;
        const entry = sceneRegistry.pickModelByObject(hit.object);
        if (!entry) continue;
        // 切活跃模型 + 换菜单（菜单会话级共享、后建覆盖前建，故需按归属换项）
        sceneRegistry.setActive(entry.id);
        if (entry.boneMaps) {
          const boneId = getMeshBoneId(hit.object, entry.boneMaps.nameMap);
          if (boneId) {
            const info = assembleBoneSelectInfo(
              boneId,
              entry.boneMaps.boneGroupMap,
              entry.boneMaps.nameMap,
              entry.boneMaps.parentMap,
              entry.boneMaps.childrenMap,
              hit.object,
            );
            entry.built.onBoneSelect?.(info);
            entry.onBonePick?.(boneId);
          }
        }
        break;
      }
    };
    renderer.domElement.addEventListener("click", onUnifiedPick);
    onKeyUp = handlers.onKeyUp;
    onDragPointerDown = handlers.onDragPointerDown;
    onDragPointerUp = handlers.onDragPointerUp;
    onDragPointerMove = handlers.onDragPointerMove;
    onResize = handlers.onResize;

    let lastTime = performance.now();
    // rAF 每帧复用 Vector3 实例，避免 5 次 GC 分配（R1-P1-1）
    const _camDir = new THREE.Vector3();
    const _forward = new THREE.Vector3();
    const _up = new THREE.Vector3(0, 1, 0);
    const _right = new THREE.Vector3();
    const _move = new THREE.Vector3();
    // ===== §4b rAF 渲染管线（animate loop + postprocess composer）=====
  function animate(): void {
      if (isDisposed.v) return;
      animId = requestAnimationFrame(animate);
      const now = performance.now();
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;
      const cam = camera as THREE.PerspectiveCamera;
      const sc = scene as THREE.Scene;
      const rd = renderer as THREE.WebGLRenderer;
      const ctr = controls as OrbitControls;
      const ot = orbitTarget as THREE.Vector3;
      cam.getWorldDirection(_camDir);
      _forward.set(_camDir.x, 0, _camDir.z).normalize();
      _right.crossVectors(_forward, _up).normalize();
      _move.set(0, 0, 0);
      if (keys["w"] || keys["arrowup"]) _move.add(_forward);
      if (keys["s"] || keys["arrowdown"]) _move.sub(_forward);
      if (keys["a"] || keys["arrowleft"]) _move.sub(_right);
      if (keys["d"] || keys["arrowright"]) _move.add(_right);
      if (keys[" "]) _move.y += 1;
      if (keys["shift"]) _move.y -= 1;
      if (_move.length() > 0) {
        _move.normalize().multiplyScalar(camSpeed * dt);
        cam.position.add(_move);
        if (orbitMode) ot.add(_move);
      }
      if (orbitMode) {
        ctr.target.copy(ot);
        ctr.update();
        ot.copy(ctr.target);
      } else {
        ctr.target.copy(cam.position).addScaledVector(_camDir, 10);
        ctr.update();
      }
      if (perFrame) perFrame(dt);
      // ADR-081 L2：后处理体积光管线——委托 PostprocessingManager
      const rendered = postProc ? postProc.render(dt, lightCap) : false;
      if (!rendered) rd.render(sc, cam);
    }
    animate();
  }

  // 操作提示条（自动消失，两种模式通用）
  const tip = document.createElement("div");
  tip.style.cssText = "padding:6px 12px;background:rgba(124,131,255,0.2);color:#fff;font-size:12px;text-align:center;flex-shrink:0;font-weight:500";
  tip.textContent = "🎮 WASD 移动 | 空格/Shift 上下 | 🖱 拖拽旋转 | 🔍 滚轮缩放 | ESC 关闭";
  overlay.insertBefore(tip, body);
  // 审核 #3：保存 timeoutId 供 cleanup 时 clearTimeout
  let tipTimeoutId = setTimeout(() => {
    if (tip.parentNode) tip.remove();
  }, TIP_AUTO_DISMISS_MS);

  let cleanupFn: (() => void) | null = null;
  let panelCleanup: (() => void) | null = null;
  // switchTo 支持（ADR-066 §5.6）：提升 built 到 try 外，复用外壳重建内容层
  let built: PreviewScene | null = null;
  /** topBar 中适配器专属控件的起始 childElementCount（切换时移除其后追加的节点） */
  let adapterControlsStart = 0;
  /** extraPanel 容器引用（切换时清空重填） */
  let panelEl: HTMLElement | null = null;
  /** 首次 build 前 scene 子节点快照（shared 模式）：switchTo 时移除旧内容层添加的增量，防场景累积（审核 #1） */
  let sceneBaseline: Set<THREE.Object3D> | null = null;
  /** cooperate 模式下已追加的内容句柄列表（fullCleanup 时逐一 dispose） */
  const allBuilt: PreviewScene[] = [];

  const cleanupCtx: CleanupContext = {
    menuHandle,
    isDisposed,
    animId,
    onKeyDown,
    onKeyUp,
    getEscH: () => escH,
    onDragPointerDown,
    onDragPointerUp,
    onDragPointerMove,
    onResize,
    onUnifiedPick,
    getPanelCleanup: () => panelCleanup,
    allBuilt,
    nullBuilt: () => { built = null; },
    skyCap,
    groundCap,
    lightCap,
    postProc,
    nullPostProc: () => { postProc = null; },
    renderer,
    scene,
    controls,
    overlay,
    nullHandle: () => { _handle = null; },
    adapter,
    getTipTimeoutId: () => tipTimeoutId,
  };

  const switchCtx: SwitchContext = {
    scene,
    getSceneBaseline: () => sceneBaseline,
    getBuilt: () => built,
    setBuilt: (s) => { built = s; },
    allBuilt,
    topBar,
    getAdapterControlsStart: () => adapterControlsStart,
    setAdapterControlsStart: (n) => { adapterControlsStart = n; },
    getPanelEl: () => panelEl,
    loadingEl,
    viewContainer,
    overlay,
    menuHandle,
    adapter: { build: adapter.build.bind(adapter) },
    camBridge,
    selfMode,
    renderer,
    controls,
    orbitTarget,
    camera,
    lightCap,
    getCurrentPath: () => currentPath,
    setCurrentPath: (p) => { currentPath = p; },
    getCurrentRtype: () => opts.rtype ?? adapter.id,
    getPerFrame: () => perFrame,
    setPerFrame: (f) => { perFrame = f; },
    getHandle: () => _handle,
    aborted,
    isDisposed,
    myGen,
    getGen: () => _gen,
  };

  try {
    // 代际守卫：await 期间用户已点其他文件 / 被 invalidate，丢弃本次挂载
    if (myGen !== _gen) return;

    if (scene) sceneBaseline = new Set(scene.children);
    adapterControlsStart = topBar.childElementCount;
    built = await adapter.build(
      {
        scene,
        camera,
        controls,
        renderer,
        cameraControls: selfMode ? undefined : camBridge,
        viewContainer,
        loadingEl,
        overlay,
        menu: menuHandle,
        // 延迟闭包：build 时 _handle 尚未赋值，菜单点击（build 之后）时已就绪；
        // 无活跃会话时 no-op（与 switchPreview 同口径）
        switchTo: (p: string, options?: { keepInScene?: boolean }): Promise<void> => _handle?.switchTo?.(p, options) ?? Promise.resolve(),
      },
      path,
    );
    if (aborted || myGen !== _gen) {
      // 加载期间被 ESC / invalidate 打断：完整拆除（含 rAF 循环与 WebGL renderer），
      // 避免外壳资源泄漏；内容层 GPU 资源经 fullCleanup 一并释放。
      fullCleanup();
      return;
    }
    // 注意：loadingEl 的移除交由适配器在成功路径自行处理（旧 vrm/litematic 即在
    // build 内 loadingEl.remove()）；空数据/错误等场景适配器会把提示写在 loadingEl
    // 并保留它，核心不在此强制移除。

    // 同步通用相机状态到适配器已设定的取景（包围盒/尺寸定相机）——仅 shared 模式
    if (renderer) {
      orbitTarget!.copy((controls as OrbitControls).target);
      euler.setFromQuaternion((camera as THREE.PerspectiveCamera).quaternion);
    }
    // ADR-081 L1：内容层包围盒 -> 聚光灯/体积光锥瞄准对象上方
    syncLightTargetFromContent(scene, sceneBaseline, lightCap);
    perFrame = built.update ?? null;
  // ===== §4c 生命周期管理（cooperate/switchTo/代际守卫）=====
  // 记录初始模型到追加列表（cooperate 模式下 fullCleanup 需逐一 dispose）
    if (built) allBuilt.push(built);
    // ADR-093 T2：首模型注册进场景注册表（roots 经 scene.children 差量捕获）
    if (built) {
      const added = scene && sceneBaseline
        ? scene.children.filter((c) => !sceneBaseline!.has(c))
        : [];
      sceneRegistry.register({
        path,
        rtype: opts.rtype ?? adapter.id,
        roots: added,
        built,
        boneMaps: built.boneMaps ?? null,
        menuItems: built.menuItems ?? null,
        onBonePick: built.onBonePick ?? null,
      });
    }

    // 适配器专属控件挂入通用 topBar 之后
    built.extraControls?.(topBar);

    // 适配器侧栏（ysm 骨骼列表/详情等）：核心提供 panel + 折叠/拖拽柄，内容由适配器填充
    const sidePanel = mountSidePanel(body, topBar, built);
    if (sidePanel) {
      panelEl = sidePanel.panelEl;
      panelCleanup = sidePanel.panelCleanup;
    }

    function fullCleanup(): void { runFullCleanup(cleanupCtx); }

    // 审核 #2：复用 escH 可变引用，switchTo 后旧 handler 被替换，新 handler 在 cleanup 时通过 getter 正确卸载
    // R1-P1-2：先保存旧引用再替换，否则 removeEventListener 移除的是新函数（从未注册过），旧函数仍残留
    const oldEscH = escH;
    escH = (e: KeyboardEvent): void => {
      if (e.key === "Escape") fullCleanup();
    };
    document.removeEventListener("keydown", oldEscH);
    document.addEventListener("keydown", escH);
    cleanupFn = fullCleanup;
    _handle = {
      cleanup: fullCleanup,
      resetCamera: built.resetCamera,
      setRotationMode: built.setRotationMode,
      setSpeed: built.setSpeed,
      showModelGroup: built.showModelGroup,
      onBoneSelect: built.onBoneSelect,
      screenshot: built.screenshot,
      // 当前会话内切换模型：复用外壳（renderer/rAF/controls/灯光）重建内容层（ADR-066 §5.6）
      // 支持 keepInScene 模式：true 时不移除旧模型，新模型追加到同一场景（多模型同台）
      switchTo: (newPath, options) => switchToSession(switchCtx, newPath, options),
    };
  } catch (e) {
    document.removeEventListener("keydown", escH);
    // P2 守卫（对齐旧 skeleton close3D 语义）：加载期间被 ESC/切模型/invalidate
    // 打断后迟到的失败不得再弹错——否则关闭后 1~2s 突然冒「加载失败」toast，
    // 掩盖用户主动关闭的意图（旧实现 skeleton.ts 的 gen 守卫，迁移到核心统一承担）。
    if (aborted || myGen !== _gen) return;
    console.error("[preview 3D] 加载失败:", e);
    loadingEl.innerHTML = `<div style="font-size:32px">⚠️</div><div>${t("preview.loadFailed")}: ${esc(e instanceof Error ? e.message : String(e))}</div>`;
    bus.emit("toast:show", {
      msg: "❌ " + friendlyError(e, t("preview.loadFailed")),
      duration: 5000,
      type: "error",
    });
  }
}

// ===== §5 私有工具函数 → cleanup-3d.ts =====
