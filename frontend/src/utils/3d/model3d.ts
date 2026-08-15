// ===== 3D 模型渲染器（类型化版 — ADR-014 P2 大件收尾，ADR-040 P1 增量拆分）=====
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { disposeMaterial } from "./mesh.ts"; // 材质释放
import { loadTdKeymap, loadTdCamSpeed, loadTdRotMode, type TdKeyAction, DEFAULT_TD_KEYMAP } from "./keymap.ts"; // 键位/相机偏好（已拆）
import { rebuildDebug } from "./debug-render.ts"; // debug 叠加层（已拆）
import { registerFreeCameraDrag } from "./camera-control.ts"; // free 相机 pointer drag（已拆）
import { buildBoneHierarchy, registerBoneRaycast } from "./bone-raycast.ts"; // 骨骼拾取（已拆）
import { disposeDebugGroup, disposeSceneMeshes, safeDisposeRenderer } from "./cleanup-helper.ts"; // 资源清理（已拆）
import { startRenderLoop } from "./render-loop.ts"; // 主渲染循环（已拆）
import { fitCameraToScene } from "./camera-setup.ts"; // 相机初始化（已拆）
import { resetRendererState, detachRendererCanvas } from "./session-state.ts"; // 会话状态重置（已拆）
import { setupRenderer } from "./renderer-setup.ts"; // renderer 场景初始化（已拆）
import { buildYsmObject } from "./ysm-object.ts"; // YSM 内容场景图构建（§5.7 shared 化，renderModel3D 复用）
// ── Spec 结构（Go 返回的 models 结构）────────────────

export interface SpecBone3D {
  id: string;
  name: string;
  parentId?: string;
  localPosition: number[];
  localRotation: number[];
}

export interface SpecMeshGroup3D {
  id?: string;
  boneId: string;
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
  texIdx?: number;
  localPosition?: number[];
  localRotation?: number[];
}

export interface SpecModelGroup3D {
  id?: string;
  name?: string;
  defaultVisible?: boolean;
  bones?: SpecBone3D[];
  meshGroups?: SpecMeshGroup3D[];
}

export interface Spec3D {
  models?: SpecModelGroup3D[];
}

/** 骨骼选中信息（window._3dOnBoneSelect 回调参数） */
export interface BoneSelectInfo {
  name: string;
  path: string;
  parent: string | null;
  children: string[];
  meshCount: number;
  localPos: number[];
  worldPos: number[];
  localRot: number[] | null;
  cubeRot: number[] | null;
  cubePos: number[] | null;
}

// ── 魔法数值提取为常量（治理红线 R2：可维护性）──────────
/** free 模式下 controls.target 跟随相机前方距离（ysmview 口径） */
const FREE_CAM_TARGET_DIST = 10;
/** resetCamera 时相机速度重置值 */
const RESET_CAM_SPEED = 20;
/** fullscreenchange 防抖延迟（ms） */
const FS_RESIZE_DEBOUNCE_MS = 50;

/** renderModel3D 返回的渲染句柄 */
export interface RenderModel3DHandle {
  resetCamera: () => void;
  setSpeed: (v: number) => void;
  setRotationMode: (orbit: boolean) => void;
  setBoneVisible: (name: string, visible: boolean) => void;
  getBoneList: () => Array<{ id: string; name: string; parentId?: string | null }>;
  toggleBone: (name: string) => void;
  showModelGroup: (idx: number) => void;
  getModelGroupCount: () => number;
  onBoneSelect: ((info: BoneSelectInfo) => void) | null;
  setDebugMode: (mode: "normal" | "pivot" | "bone") => void;
  cleanup: () => void;
}

// P1 修复（ADR-040）：键位/相机偏好已拆至 keymap.ts，此处 re-export 兼容
export type { TdKeyAction } from "./keymap.ts";
export { DEFAULT_TD_KEYMAP, loadTdKeymap, loadTdCamSpeed, loadTdRotMode } from "./keymap.ts";

// 模块级 3D 渲染状态（治理红线 R1：零全局调试变量）
let _scene3d: THREE.Scene | null = null;
let _camera3d: THREE.PerspectiveCamera | null = null;
let _renderer3d: THREE.WebGLRenderer | null = null;
let _rootGroup3d: THREE.Group | null = null;
/** 当前活跃的 RAF ID（入口复用守卫 + cleanup 共享） */
let _rafIdGuard: number | null = null;
/**
 * 会话级解绑器收集（P2 修复，审核反推）：入口复用守卫在函数开头同步执行，
 * 拿不到本次/上次会话的闭包监听器引用——必须由各会话自己注册解绑器，
 * 守卫统一执行，否则旧会话的 document/window 监听器（keydown preventDefault 等）永久泄漏。
 */
let _sessionCleanups: Array<() => void> = [];

// ── 渲染器状态 / 会话 ─────────────────────────────

/** 渲染 3D 模型到容器，返回控制句柄 */
export async function renderModel3D(
  container: HTMLElement,
  texArr: (THREE.Texture | null)[],
  spec: Spec3D,
  texIdx = 0,
): Promise<RenderModel3DHandle> {
  // P1 修复：入口复用守卫——若上一场景未 cleanup，先主动清理旧 RAF/renderer，避免僵尸循环
  if (_renderer3d) {
    if (_rafIdGuard != null) cancelAnimationFrame(_rafIdGuard);
    // P2 修复（审核反推）：旧会话的 document/window 监听器也必须解绑——
    // 否则 keydown 会对 WASD/方向键永久 preventDefault（死会话劫持键盘），
    // 且旧场景 BufferGeometry/Material 未 dispose 造成 GPU 缓冲泄漏。
    _sessionCleanups.forEach((fn) => fn());
    _sessionCleanups = [];
    if (_scene3d) {
      disposeSceneMeshes(_scene3d);
    }
    safeDisposeRenderer(_renderer3d!);
    detachRendererCanvas(_renderer3d!);
    resetRendererState({ _renderer3d, _scene3d, _camera3d, _rootGroup3d });
  }

  // 初始化 renderer + 场景 + 灯光 + 辅助线（已拆至 renderer-setup.ts）
  // P2-4 修复：后半段包 try/catch——异常路径统一执行会话清理并 rethrow
  try {
  const { scene, camera, renderer, controls } = setupRenderer(container);
  _scene3d = scene;
  _camera3d = camera;
  _renderer3d = renderer;

  const obj = buildYsmObject(spec, texArr, texIdx);
  const { boneGroupMap, rootGroup, modelGroups } = obj;
  _rootGroup3d = rootGroup;
  scene.add(rootGroup);

  // ysmview 风格相机定位：从 mesh 包围盒计算（已拆至 camera-setup.ts）
  const { initCamPos: _initCamPos, initCamTarget: _initCamTarget } = fitCameraToScene(scene, camera, controls);

  // RenderSession 状态对象（对象化第一阶段：8 个可变交互状态 + 第二阶段 3 个悬停/调试状态收敛，行为不变）
  const state = {
    rafId: null as number | null,
    keys: {} as Record<string, boolean>,
    debugMode: "normal" as "normal" | "pivot" | "bone",
    lastTime: performance.now(),
    camSpeed: loadTdCamSpeed(),
    orbitMode: loadTdRotMode(),
    fsTimer: null as ReturnType<typeof setTimeout> | null, // P2-3 修复：fullscreenchange 防抖 timer，纳入会话清理
    mouseDown: false,
    lastMouse: { x: 0, y: 0 },
    hoveredBone: null as string | null,
    hoveredMesh: null as THREE.Object3D | null,
    debugGroup: null as THREE.Group | null,
    setHoveredBone: (v: string | null) => { state.hoveredBone = v; },
    setHoveredMesh: (v: THREE.Object3D | null) => { state.hoveredMesh = v; },
    onBoneSelectCallback: null as ((info: BoneSelectInfo) => void) | null,
  };
  const _onResize = (): void => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w > 0 && h > 0) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
  };
  window.addEventListener("resize", _onResize);
  _sessionCleanups.push(() => window.removeEventListener("resize", _onResize));
  const _onFSChange = (): void => {
    // P2-3 修复：timer 纳入会话清理（防全屏切换后旧会话 setTimeout 残留触发已释放渲染器）
    if (state.fsTimer != null) clearTimeout(state.fsTimer);
    state.fsTimer = setTimeout(_onResize, FS_RESIZE_DEBOUNCE_MS);
  };
  document.addEventListener("fullscreenchange", _onFSChange);
  _sessionCleanups.push(() => document.removeEventListener("fullscreenchange", _onFSChange));
  document.addEventListener("webkitfullscreenchange", _onFSChange);
  _sessionCleanups.push(() => document.removeEventListener("webkitfullscreenchange", _onFSChange));
  // 用户自定义键位（物理键 code，跨键盘布局一致）；方向键保留为通用兜底
  const _keymap = loadTdKeymap();
  const _isShift = (code: string): boolean => code === "ShiftLeft" || code === "ShiftRight";
  const _movementCodes = new Set<string>([
    _keymap.forward, _keymap.back, _keymap.left, _keymap.right, _keymap.up, _keymap.down,
    "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  ]);
  const _isEditable = (el: EventTarget | null): boolean => {
    const node = el as HTMLElement | null;
    return !!node && (node.tagName === "INPUT" || node.tagName === "TEXTAREA" || node.isContentEditable);
  };
  const _onKeyDown = (e: KeyboardEvent): void => {
    if (_isEditable(e.target)) return; // 弹窗输入框打字时不吞键
    state.keys[e.code] = true;
    // 吞掉移动键默认行为（空格滚动/方向键滚动）；Shift 作为修饰键不阻止默认
    if (_movementCodes.has(e.code) && !_isShift(e.code)) e.preventDefault();
    if (e.key.toLowerCase() === "f") {
      const modes: Array<"normal" | "pivot" | "bone"> = ["normal", "pivot", "bone"];
      const next = (modes.indexOf(state.debugMode) + 1) % modes.length;
      state.debugMode = modes[next];
      rebuildDebug(scene, rootGroup, boneGroupMap, spec, state);
    }
  };
  const _onKeyUp = (e: KeyboardEvent): void => {
    state.keys[e.code] = false;
  };
  document.addEventListener("keydown", _onKeyDown);
  _sessionCleanups.push(() => document.removeEventListener("keydown", _onKeyDown));
  document.addEventListener("keyup", _onKeyUp);
  _sessionCleanups.push(() => document.removeEventListener("keyup", _onKeyUp));
  const _orbitTarget = controls.target.clone();
  const _euler = new THREE.Euler(0, 0, 0, "YXZ");
  // Pointer Events（ADR-047）：拖拽旋转统一 pointer 事件，触屏可拖；
  // 桌面零回归（pointer 事件兼容 mouse，ADR-047 决策）——已拆至 camera-control.ts
  const _freeDragCleanup = registerFreeCameraDrag(
    renderer, camera, controls,
    { get current() { return state.orbitMode; } },
  );
  _sessionCleanups.push(_freeDragCleanup);
  // P2-1 修复：free 模式禁用 controls 旋转，避免与自定义 pointer 拖拽双重旋转（仅 orbit 生效）
  controls.enableRotate = state.orbitMode;
  // ===== 渲染循环（已拆至 render-loop.ts）=====
  startRenderLoop({
    camera, renderer, scene, controls, state, _keymap, _orbitTarget, _euler,
    // P0 修复：守卫须跟随每帧活跃 RAF id——只快照一次会过期（code_review P2），
    // 入口复用守卫 cancelAnimationFrame 会变成空转，僵尸 RAF 无法清理。
    onRafId: (id) => { _rafIdGuard = id; },
  });

  // ===== 骨骼射线拾取（已拆至 bone-raycast.ts）=====
  const { nameMap: _boneNameMap, parentMap: _boneParentMap, childrenMap: _boneChildrenMap } = buildBoneHierarchy(spec);
  const _boneRaycastCleanup = registerBoneRaycast(
    renderer, camera, scene, boneGroupMap,
    _boneNameMap, _boneParentMap, _boneChildrenMap,
    state,
  );
  _sessionCleanups.push(_boneRaycastCleanup);

  // ===== 可视化模式切换 =====（rebuildDebug 已拆至 debug-render.ts）

  // 辅助：free 模式下更新 controls.target 跟随相机前方 10 单位
  const _applyFreeCamTarget = (): void => {
    const d = new THREE.Vector3();
    camera.getWorldDirection(d);
    controls.target.copy(camera.position).addScaledVector(d, FREE_CAM_TARGET_DIST);
  };

  const handle: RenderModel3DHandle = {
    resetCamera: () => {
      camera.position.copy(_initCamPos);
      controls.target.copy(_initCamTarget);
      _orbitTarget.copy(_initCamTarget);
      if (state.orbitMode) controls.enableRotate = true;
      else {
        controls.enableRotate = false;
        _applyFreeCamTarget();
      }
      camera.quaternion.set(0, 0, 0, 1);
      _euler.set(0, 0, 0);
      state.camSpeed = RESET_CAM_SPEED;
      state.mouseDown = false;
      Object.keys(state.keys).forEach((k) => (state.keys[k] = false));
      controls.update();
    },
    setSpeed: (v: number) => {
      state.camSpeed = v;
    },
    setRotationMode: (orbit: boolean) => {
      state.orbitMode = orbit;
      if (orbit) {
        controls.enableRotate = true;
        if (_orbitTarget) controls.target.copy(_orbitTarget);
        state.mouseDown = false;
      } else {
        _euler.setFromQuaternion(camera.quaternion);
        controls.enableRotate = false;
        _applyFreeCamTarget();
        controls.update();
        state.mouseDown = false;
      }
    },
    setBoneVisible: (name, visible) => obj.setBoneVisible(name, visible),
    getBoneList: () => obj.getBoneList(),
    toggleBone: (name) => obj.toggleBone(name),
    showModelGroup: (idx) => obj.showModelGroup(idx),
    getModelGroupCount: () => obj.getModelGroupCount(),
    onBoneSelect: null as ((info: BoneSelectInfo) => void) | null, // 外部设置的回调: (boneInfo) => void
    setDebugMode: (mode: "normal" | "pivot" | "bone") => {
      state.debugMode = mode;
      rebuildDebug(scene, rootGroup, boneGroupMap, spec, state);
    },
    cleanup: () => {
      if (state.rafId != null) cancelAnimationFrame(state.rafId);
      _rafIdGuard = null;
      // P2-3 修复：fullscreenchange 防抖 timer 一并清除，防清理后 setTimeout 回调残留
      if (state.fsTimer != null) clearTimeout(state.fsTimer);
      state.fsTimer = null;
      // 显式解绑在下方逐条执行；会话数组清空避免下次入口守卫重复执行（幂等无害）
      _sessionCleanups = [];
      document.removeEventListener("keydown", _onKeyDown);
      document.removeEventListener("keyup", _onKeyUp);
      // free camera drag cleanup 由 _freeDragCleanup 统一处理（camera-control.ts）
      // bone raycast cleanup 由 _boneRaycastCleanup 统一处理（bone-raycast.ts）
      controls.dispose();
      window.removeEventListener("resize", _onResize);
      document.removeEventListener("fullscreenchange", _onFSChange);
      document.removeEventListener("webkitfullscreenchange", _onFSChange);
      // 先移除 debug 组，再逐层 dispose 所有场景资源（含纹理），最后 dispose renderer
      if (state.debugGroup) {
        disposeDebugGroup(state.debugGroup);
        scene.remove(state.debugGroup);
        state.debugGroup = null;
      }
      disposeSceneMeshes(scene);
      safeDisposeRenderer(renderer);
      resetRendererState({ _renderer3d, _scene3d, _camera3d, _rootGroup3d });
      container.innerHTML = "";
    },
  };
  // 外部设置 handle.onBoneSelect 时同步到 state.onBoneSelectCallback
  let _currentOnBoneSelect: ((info: BoneSelectInfo) => void) | null = null;
  Object.defineProperty(handle, "onBoneSelect", {
    set(v: ((info: BoneSelectInfo) => void) | null) {
      _currentOnBoneSelect = v;
      state.onBoneSelectCallback = v;
    },
    get() { return _currentOnBoneSelect; },
  });
  return handle;
  } catch (e) {
    _sessionCleanups.forEach((fn) => fn());
    _sessionCleanups = [];
    try { safeDisposeRenderer(_renderer3d!); } catch { /* ignore */ }
    resetRendererState({ _renderer3d, _scene3d, _camera3d, _rootGroup3d });
    throw e;
  }
}

/** 截取当前 3D 预览画面（PNG base64，无 data: 前缀），无渲染器时返回 null */
export function screenshotPreview(): string | null {
  if (!_renderer3d || !_scene3d || !_camera3d) {
    console.warn("[screenshot] 无 3D 渲染器");
    return null;
  }
  _renderer3d.render(_scene3d, _camera3d);
  return _renderer3d.domElement.toDataURL("image/png").split(",")[1];
}

/** 带 map 纹理的材质接口（MeshStandardMaterial/MeshPhongMaterial 等共有） */
// （已迁至 ./mesh.ts，disposeMaterial 随迁）

/** 释放材质及其 map 纹理。 */
// （已迁至 ./mesh.ts，model3d.ts 经 import 复用）
