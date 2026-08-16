// ===== 统一 3D 预览核心（ADR-066 P3：收缴 vrm/litematic 复制脚手架）=====
// 所有富格式 3D 预览（vrm / litematic / 后续 ysm）共用同一套外壳：
// overlay + 声明式根菜单(⚙️, PREVIEW_MENU_DEFS) + viewContainer + loadingEl +
// 适配器底部导航容器(topBar, Phase 2 经 previewMenuItems 收编) +
// scene/camera/renderer/OrbitControls/灯光 + WASD/拖拽自转 + resize +
// rAF 循环 + ESC + GPU 资源释放。内容差异由 PreviewAdapter 经 build() 注入，
// 每帧 update(dt) 驱动动态部分（如 VRM SpringBone）。
//
// 旧实现里 vrm-3d.ts 与 litematic-3d.ts 各自内联 ~250 行同构脚手架（"复制那套"），
// 本文件将其收敛为单一事实来源。适配器契约对齐 YSM 既有的 Model3DHandleX，
// 使三套渲染器最终可经注册表统一派发（P3-E）。

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { SkyCapability } from "../caps/sky-capability.ts";
import { GroundCapability } from "../caps/ground-capability.ts";
import { bus } from "../../../bus.ts";
import { friendlyError } from "../../../utils/dom/errors.ts";
import { t } from "../../../core/i18n/t.ts";
import { esc } from "../../../utils/dom/html.ts";
import { safeGet, safeSet } from "../../../utils/dom/storage.ts";
import { createIconButton } from "../../../utils/dom/fab.ts";
import { installUiComponentsStyles } from "../../../ui/ui-components-styles.ts";
import { createSlideMenu } from "../../../ui/ui-helpers.ts";
import { createHeaderToggle } from "../../../ui/ui-header-toggle.ts";
import { mountPreviewRootMenu } from "./preview-menu.ts";
import type { BoneSelectInfo } from "../model3d.ts";

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
  switchTo?(path: string): Promise<void>;
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
  /** 在通用 topBar 之后追加适配器专属控件（litematic 分层 / ysm 侧栏按钮等） */
  extraControls?(topBar: HTMLElement): void;
  /** 在核心侧栏（如有）挂载适配器专属面板内容（ysm 骨骼列表/详情等） */
  extraPanel?(panel: HTMLElement): void;
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
  switchTo?(path: string): Promise<void>;
}

// ---- 通用相机控制常量（对齐 vrm/litematic 既有口径）----
const DRAG_ROTATE_SENSITIVITY = 0.003; // 自身旋转模式拖拽灵敏度（rad/px）
const MIN_CAM_SPEED = 2;
const MAX_CAM_SPEED = 200;
const DEFAULT_CAM_SPEED = 20;
const TIP_AUTO_DISMISS_MS = 6000;

/** 相机控制桥：shared/self 双模式统一构建旋转/速度/重置控件的回调集合（方案 A：消灭 ysm-adapter 双份实现） */
export interface CameraControlBridge {
  /** 当前旋转模式（true=环绕） */
  getOrbit(): boolean;
  /** 设置旋转模式（含 shared 模式的 controls.enableRotate / orbitTarget 同步） */
  setOrbit(v: boolean): void;
  /** 当前相机速度 */
  getSpeed(): number;
  /** 设置相机速度 */
  setSpeed(n: number): void;
  /** 重置视角（shared 模式经 built.resetCamera，build 前调用安全——闭包延迟求值） */
  reset(): void;
}

/** 在 topBar 追加通用相机控件（旋转模式 / 速度滑条 / 重置视角），shared/self 双模式复用 */
export function buildCameraControls(topBar: HTMLElement, bridge: CameraControlBridge): void {
  const rotLabel = document.createElement("span");
  rotLabel.style.cssText = "font-size:11px;color:rgba(255,255,255,0.5)";
  rotLabel.textContent = t("preview.cameraRotation") + ":";
  topBar.appendChild(rotLabel);

  const rotSel = document.createElement("select");
  rotSel.className = "setting-select"; // 🥉 ui/ 库下拉样式（§19）
  rotSel.style.marginRight = "8px";
  rotSel.dataset.testid = "mmd-rot-mode"; // §19.1
  [
    { v: true, t: "环绕" },
    { v: false, t: "自身" },
  ].forEach((m) => {
    const opt = document.createElement("option");
    opt.value = String(m.v);
    opt.textContent = m.t;
    rotSel.appendChild(opt);
  });
  rotSel.value = String(bridge.getOrbit());
  rotSel.onchange = (): void => {
    const v = rotSel.value === "true";
    bridge.setOrbit(v);
    safeSet("td-rot-mode", v ? "orbit" : "free");
  };
  topBar.appendChild(rotSel);

  const spdLabel = document.createElement("span");
  spdLabel.style.cssText = "font-size:11px;color:rgba(255,255,255,0.5)";
  spdLabel.textContent = t("preview.cameraSpeed") + ":";
  topBar.appendChild(spdLabel);

  const spdSlider = document.createElement("input");
  spdSlider.type = "range";
  spdSlider.min = String(MIN_CAM_SPEED);
  spdSlider.max = String(MAX_CAM_SPEED);
  spdSlider.value = String(bridge.getSpeed());
  spdSlider.style.cssText = "width:80px;margin:0 4px;cursor:pointer;accent-color:var(--accent,#7c83ff)";
  topBar.appendChild(spdSlider);

  const spdVal = document.createElement("span");
  spdVal.style.cssText = "font-size:11px;color:rgba(255,255,255,0.6);min-width:20px";
  spdVal.textContent = String(bridge.getSpeed());
  topBar.appendChild(spdVal);

  spdSlider.oninput = (): void => {
    spdVal.textContent = spdSlider.value;
    bridge.setSpeed(Number(spdSlider.value));
    safeSet("td-cam-speed", spdSlider.value);
  };

  const resetBtn = createIconButton({
    icon: "⟲",
    label: t("preview.resetView"),
    title: "重置相机视角到初始位置",
  });
  resetBtn.onclick = (): void => bridge.reset();
  topBar.appendChild(resetBtn);
}

let _handle: PreviewHandle | null = null;
let _gen = 0;

/** 任意新预览派发时调用，作废在途加载（对齐 invalidateVrmPreview / invalidateLitematicPreview） */
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
export async function switchPreview(path: string): Promise<void> {
  await _handle?.switchTo?.(path);
}

/** mount3D 附加选项（ADR-066 §5.6 3D 内模型切换） */
export interface Mount3DOptions {
  /** 同类型可切换的候选路径列表（≥2 时 topBar 渲染切换下拉；缺省不渲染，向后兼容） */
  siblings?: string[];
}

export async function mount3D(adapter: PreviewAdapter, path: string, opts: Mount3DOptions = {}): Promise<void> {
  cleanupPreview(); // 复用：再次创建先清旧的
  // 🥉 ui/ 库样式（light-DOM 场景）：overlay 是 document.body 下的普通 DOM 非 shadow，
  // 注入一次即可让 topBar 控件用上 mode-btn/setting-select 透明样式（幂等，§19）
  installUiComponentsStyles();
  const myGen = ++_gen;
  const selfMode = adapter.mode === "self";
  const siblings = opts.siblings?.filter((p) => p !== path) ?? [];
  /** 3D 内切换后的当前模型路径（审核 #4：切换成功后「当前」项须指向新模型，原 path 移回候选） */
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
  // 程序化天空能力（ADR-073 L1）：shared 模式注入统一核心，四种模型零改动继承
  let skyCap: SkyCapability | null = null;
  let groundCap: GroundCapability | null = null;
  let animId = 0;
  let perFrame: ((dt: number) => void) | null = null;
  let onKeyDown: (e: KeyboardEvent) => void = () => {};
  let onKeyUp: (e: KeyboardEvent) => void = () => {};
  let onDragPointerUp: (e: PointerEvent) => void = () => {};
  let onDragPointerMove: (e: PointerEvent) => void = () => {};
  let onResize: () => void = () => {};

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

  // 适配器专属控件容器（Phase 1 暂留，Phase 2 经 previewMenuItems 契约收编）：
  // 用户 2026-08-16 决策「适配器底部导航暂留」——核心控件（关闭/切换/环境/相机）已迁入 ⚙️ 根菜单，
  // 此处仅作底部容器承接适配器经 extraControls(topBar) 注入的专属控件（ysm 侧栏按钮 / mmd 控件等）。
  const topBar = document.createElement("div");
  topBar.className = "ysm-3d-adapter-nav";
  topBar.style.cssText =
    "position:absolute;left:0;right:0;bottom:0;display:flex;align-items:center;gap:8px;" +
    "padding:8px 12px;z-index:11;background:rgba(20,21,38,0.85);" +
    "border-top:1px solid rgba(255,255,255,0.12);flex-wrap:wrap";
  overlay.appendChild(topBar);

  // 声明式根菜单（⚙️）：core 在 overlay 内自建（预览全屏盖住 app 外壳，主程序 nav.settings 够不着），
  // 全部控件以 PREVIEW_MENU_DEFS 表驱动渲染，e2e 选择器稳定可遍历（ADR-076 v2）。
  const unsubMenu = mountPreviewRootMenu(overlay, {
    selfMode,
    getSkyCap: () => skyCap,
    getGroundCap: () => groundCap,
    getCamBridge: () => camBridge,
    getSiblings: () => siblings,
    getCurrentPath: () => currentPath,
    close: () => {
      if (cleanupFn) cleanupFn();
      else closeOverlay();
    },
    switchTo: (p: string) => {
      void _handle?.switchTo?.(p);
    },
  });

  const loadingEl = document.createElement("div");
  loadingEl.style.cssText =
    "position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:rgba(255,255,255,0.6);font-size:14px;gap:12px;z-index:10;background:rgba(26,27,46,0.9)";
  viewContainer.appendChild(loadingEl);

  let aborted = false;
  function escH(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      if (cleanupFn) cleanupFn();
      else closeOverlay();
    }
  }
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
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.minDistance = 0.1;
    controls.maxDistance = 5000;
    controls.update();
    orbitTarget = (controls as OrbitControls).target.clone();
    controls.enableRotate = true;

    onKeyDown = (e: KeyboardEvent): void => {
      keys[e.key.toLowerCase()] = true;
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(e.key.toLowerCase())) {
        e.preventDefault();
      }
    };
    onKeyUp = (e: KeyboardEvent): void => { keys[e.key.toLowerCase()] = false; };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);

    const onDragPointerDown = (e: PointerEvent): void => {
      if (!orbitMode && e.button === 0) {
        mouseDown = true;
        lastMouse.x = e.clientX;
        lastMouse.y = e.clientY;
        (renderer as THREE.WebGLRenderer).domElement.setPointerCapture(e.pointerId);
      }
    };
    onDragPointerUp = (e: PointerEvent): void => {
      mouseDown = false;
      const rd = renderer as THREE.WebGLRenderer;
      if (rd.domElement.hasPointerCapture(e.pointerId)) rd.domElement.releasePointerCapture(e.pointerId);
    };
    onDragPointerMove = (e: PointerEvent): void => {
      if (orbitMode || !mouseDown) return;
      const dx = e.clientX - lastMouse.x;
      const dy = e.clientY - lastMouse.y;
      lastMouse.x = e.clientX;
      lastMouse.y = e.clientY;
      const cam = camera as THREE.PerspectiveCamera;
      euler.setFromQuaternion(cam.quaternion);
      euler.y -= dx * DRAG_ROTATE_SENSITIVITY;
      euler.x -= dy * DRAG_ROTATE_SENSITIVITY;
      euler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, euler.x));
      cam.quaternion.setFromEuler(euler);
    };
    (renderer as THREE.WebGLRenderer).domElement.addEventListener("pointerdown", onDragPointerDown);
    window.addEventListener("pointerup", onDragPointerUp);
    window.addEventListener("pointermove", onDragPointerMove);

    onResize = (): void => {
      if (isDisposed.v) return;
      const cam = camera as THREE.PerspectiveCamera;
      const rd = renderer as THREE.WebGLRenderer;
      cam.aspect = viewContainer.clientWidth / Math.max(viewContainer.clientHeight, 1);
      cam.updateProjectionMatrix();
      rd.setSize(viewContainer.clientWidth, viewContainer.clientHeight);
    };
    window.addEventListener("resize", onResize);

    let lastTime = performance.now();
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
      const camDir = new THREE.Vector3();
      cam.getWorldDirection(camDir);
      const forward = new THREE.Vector3(camDir.x, 0, camDir.z).normalize();
      const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
      const move = new THREE.Vector3();
      if (keys["w"] || keys["arrowup"]) move.add(forward);
      if (keys["s"] || keys["arrowdown"]) move.sub(forward);
      if (keys["a"] || keys["arrowleft"]) move.sub(right);
      if (keys["d"] || keys["arrowright"]) move.add(right);
      if (keys[" "]) move.y += 1;
      if (keys["shift"]) move.y -= 1;
      if (move.length() > 0) {
        move.normalize().multiplyScalar(camSpeed * dt);
        cam.position.add(move);
        if (orbitMode) ot.add(move);
      }
      if (orbitMode) {
        ctr.target.copy(ot);
        ctr.update();
        ot.copy(ctr.target);
      } else {
        ctr.target.copy(cam.position).addScaledVector(camDir, 10);
        ctr.update();
      }
      if (perFrame) perFrame(dt);
      rd.render(sc, cam);
    }
    animate();
  }

  // 操作提示条（自动消失，两种模式通用）
  const tip = document.createElement("div");
  tip.style.cssText = "padding:6px 12px;background:rgba(124,131,255,0.2);color:#fff;font-size:12px;text-align:center;flex-shrink:0;font-weight:500";
  tip.textContent = "🎮 WASD 移动 | 空格/Shift 上下 | 🖱 拖拽旋转 | 🔍 滚轮缩放 | ESC 关闭";
  overlay.insertBefore(tip, body);
  setTimeout(() => {
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
        // 延迟闭包：build 时 _handle 尚未赋值，菜单点击（build 之后）时已就绪；
        // 无活跃会话时 no-op（与 switchPreview 同口径）
        switchTo: (p: string): Promise<void> => _handle?.switchTo?.(p) ?? Promise.resolve(),
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
    perFrame = built.update ?? null;

    // 适配器专属控件挂入通用 topBar 之后
    built.extraControls?.(topBar);

    // 适配器侧栏（ysm 骨骼列表/详情等）：核心提供 panel + 折叠/拖拽柄，内容由适配器填充
    if (built.extraPanel) {
      const panel = document.createElement("div");
      panelEl = panel;
      panel.id = "ysm-3d-panel"; // 对齐旧 skeleton panel：fill3DPanel 内部选择器依赖此 id（全选/全不选）
      panel.style.cssText =
        "width:260px;flex-shrink:0;overflow:auto;background:rgba(0,0,0,0.25);color:#fff;font-size:12px;display:flex;flex-direction:column;border-left:1px solid rgba(255,255,255,0.1)";
      const resizeHandle = document.createElement("div");
      resizeHandle.style.cssText =
        "width:4px;flex-shrink:0;cursor:col-resize;background:rgba(255,255,255,0.2);touch-action:none";
      body.appendChild(resizeHandle);
      body.appendChild(panel);

      const panelToggle = document.createElement("button");
      panelToggle.textContent = "▾";
      panelToggle.style.cssText =
        "font-size:11px;padding:2px 6px;border-radius:4px;border:1px solid rgba(255,255,255,0.2);background:rgba(0,0,0,0.3);color:rgba(255,255,255,0.8);cursor:pointer;margin-left:4px";
      topBar.appendChild(panelToggle);
      let panelVisible = true;
      panelToggle.onclick = (): void => {
        panelVisible = !panelVisible;
        panel.style.display = panelVisible ? "flex" : "none";
        resizeHandle.style.display = panelVisible ? "" : "none";
        panelToggle.textContent = panelVisible ? "▾" : "▸";
      };
      let resizing = false;
      const onRM = (e: PointerEvent): void => {
        if (!resizing) return;
        panel.style.width = Math.max(160, Math.min(500, body.getBoundingClientRect().right - e.clientX)) + "px";
      };
      const onRU = (e: PointerEvent): void => {
        resizing = false;
        if (resizeHandle.hasPointerCapture(e.pointerId)) resizeHandle.releasePointerCapture(e.pointerId);
      };
      resizeHandle.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        resizing = true;
        e.preventDefault();
        resizeHandle.setPointerCapture(e.pointerId);
      });
      document.addEventListener("pointermove", onRM);
      document.addEventListener("pointerup", onRU);
      panelCleanup = (): void => {
        document.removeEventListener("pointermove", onRM);
        document.removeEventListener("pointerup", onRU);
      };
      built.extraPanel(panel);
    }

    function fullCleanup(): void {
      unsubMenu?.();
      if (isDisposed.v) return;
      isDisposed.v = true;
      cancelAnimationFrame(animId);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("keydown", escH);
      window.removeEventListener("pointerup", onDragPointerUp);
      window.removeEventListener("pointermove", onDragPointerMove);
      window.removeEventListener("resize", onResize);
      panelCleanup?.();
      // 内容层先释放自身资源，核心再回收外壳
      try {
        built?.dispose();
      } catch (_) {}
      // 程序化天空（ADR-073 L1）：还原 tone mapping 并释放 PMREM/几何/材质
      try {
        skyCap?.dispose();
      } catch (_) {}
      // 地面能力：移除网格并释放几何/材质
      try {
        groundCap?.dispose();
      } catch (_) {}
      // 防御性遍历：释放内容层可能遗漏的几何/材质/纹理
      // （stub 环境 Scene 未必实现 traverse，typeof 守卫避免误崩）
      if (renderer) {
        const sc = scene as THREE.Scene;
        if (typeof (sc as unknown as { traverse?: unknown }).traverse === "function") {
          sc.traverse((obj) => {
            const mesh = obj as THREE.Mesh;
            if (mesh.geometry) {
              try {
                mesh.geometry.dispose();
              } catch (_) {}
            }
            const mat = (mesh as unknown as { material?: THREE.Material | THREE.Material[] }).material;
            if (mat) {
              if (Array.isArray(mat)) mat.forEach((m) => safeDisposeMat(m));
              else safeDisposeMat(mat);
            }
          });
        }
        renderer.dispose();
        (controls as OrbitControls).dispose();
      }
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      _handle = null;
      adapter.onClose?.();
    }

    function escHandler(e: KeyboardEvent): void {
      if (e.key === "Escape") fullCleanup();
    }
    document.removeEventListener("keydown", escH);
    document.addEventListener("keydown", escHandler);
    cleanupFn = fullCleanup;
    _handle = {
      cleanup: fullCleanup,
      resetCamera: built.resetCamera,
      setRotationMode: built.setRotationMode,
      setSpeed: built.setSpeed,
      showModelGroup: built.showModelGroup,
      onBoneSelect: built.onBoneSelect,
      // 当前会话内切换模型：复用外壳（renderer/rAF/controls/灯光）重建内容层（ADR-066 §5.6）
      switchTo: async (newPath: string): Promise<void> => {
        if (aborted || isDisposed.v || myGen !== _gen) return;
        // 1) 移除旧适配器专属控件（topBar 中 adapterControlsStart 之后追加的节点）
        while (topBar.childElementCount > adapterControlsStart) {
          topBar.lastChild?.remove();
        }
        // 1b) 移除旧内容层添加到共享 scene 的对象（快照 delta，防场景累积——审核 #1）
        // 适配器 dispose 只释放 GPU（deepDispose/dispose），不 detach；不移除会导致
        // 每次切换旧模型/灯光/Grid 残留叠加（灯光过亮/鬼影/已释放几何仍被遍历）。
        const baseline = sceneBaseline; // 局部快照：闭包内 let 窄化失效
        if (scene && baseline) {
          const stale = scene.children.filter((c) => !baseline.has(c));
          for (const c of stale) scene.remove(c);
        }
        // 2) 释放旧内容层 GPU 资源
        try {
          built?.dispose();
        } catch (_) {}
        // 3) 重建内容层（新 path）
        let next: PreviewScene;
        try {
          next = await adapter.build(
            { scene, camera, controls, renderer, cameraControls: selfMode ? undefined : camBridge, viewContainer, loadingEl, overlay },
            newPath,
          );
        } catch (e) {
          // 切换失败（坏 PMX/VRM/读取错误）：旧内容已 dispose 无法回滚，恢复 loadingEl 错误提示 + toast
          // （对齐 mount3D 入口 catch——不留下无提示空壳 + unhandled rejection，审核 #2）
          console.error("[preview 3D] 切换失败:", e);
          if (!loadingEl.parentNode) viewContainer.appendChild(loadingEl); // 成功路径已 remove，失败需重新挂回
          loadingEl.innerHTML = `<div style="font-size:32px">⚠️</div><div>${t("preview.loadFailed")}: ${esc(e instanceof Error ? e.message : String(e))}</div>`;
          bus.emit("toast:show", {
            msg: "❌ " + friendlyError(e, t("preview.loadFailed")),
            duration: 5000,
            type: "error",
          });
          return;
        }
        if (aborted || isDisposed.v || myGen !== _gen) {
          try {
            next.dispose();
          } catch (_) {}
          return;
        }
        built = next;
        currentPath = newPath; // 同步「当前」项（ADR-066 §5.6 3D 内切换）：根菜单切换面板高亮随之移动
        // 4) 同步相机状态到新内容层取景 + 重挂适配器控件/侧栏
        if (renderer) {
          orbitTarget!.copy((controls as OrbitControls).target);
          euler.setFromQuaternion((camera as THREE.PerspectiveCamera).quaternion);
        }
        perFrame = next.update ?? null;
        next.extraControls?.(topBar);
        if (next.extraPanel && panelEl) {
          panelEl.innerHTML = "";
          next.extraPanel(panelEl);
        }
      },
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

function safeDisposeMat(m: THREE.Material): void {
  const withTex = m as unknown as { map?: THREE.Texture; emissiveMap?: THREE.Texture };
  for (const tex of [withTex.map, withTex.emissiveMap]) {
    if (tex) {
      try {
        tex.dispose();
      } catch (_) {}
    }
  }
  try {
    m.dispose();
  } catch (_) {}
}
