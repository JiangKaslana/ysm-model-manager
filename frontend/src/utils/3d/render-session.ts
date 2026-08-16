// ===== RenderSession：3D 渲染会话对象化（ADR-052）=====
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { buildSceneMesh, disposeMaterial, compKey } from "./mesh.ts";
import { loadTdKeymap, loadTdCamSpeed, loadTdRotMode, type TdKeyAction, DEFAULT_TD_KEYMAP } from "./keymap.ts";
import { rebuildDebug } from "./debug-render.ts";
import { registerFreeCameraDrag } from "./camera-control.ts";
import { buildBoneHierarchy, registerBoneRaycast } from "./bone-raycast.ts";
import { disposeDebugGroup, disposeSceneMeshes, safeDisposeRenderer } from "./cleanup-helper.ts";
import { startRenderLoop } from "./render-loop.ts";
import { fitCameraToScene } from "./camera-setup.ts";
import { getBoneList } from "./bone-list.ts";
import { setBoneVisible as _setBoneVisible, toggleBone as _toggleBone, showModelGroup as _showModelGroup } from "./bone-visibility.ts";
import { setupRenderer } from "./renderer-setup.ts";
import { addMeshToBoneGroup } from "./mesh-builder.ts";
import type { Spec3D, SpecBone3D, SpecMeshGroup3D, SpecModelGroup3D, BoneSelectInfo } from "./model3d.ts";

// ── 魔法数值（与 model3d.ts 保持一致）──────────────────
const FREE_CAM_TARGET_DIST = 10;
const RESET_CAM_SPEED = 20;
const FS_RESIZE_DEBOUNCE_MS = 50;

/** RenderSession 内部状态（收敛自 model3d.ts 闭包变量） */
interface RenderSessionState {
  rafId: number | null;
  keys: Record<string, boolean>;
  debugMode: "normal" | "pivot" | "bone";
  lastTime: number;
  camSpeed: number;
  orbitMode: boolean;
  fsTimer: ReturnType<typeof setTimeout> | null;
  mouseDown: boolean;
  lastMouse: { x: number; y: number };
  hoveredBone: string | null;
  hoveredMesh: THREE.Object3D | null;
  debugGroup: THREE.Group | null;
  setHoveredBone: (v: string | null) => void;
  setHoveredMesh: (v: THREE.Object3D | null) => void;
  onBoneSelectCallback: ((info: BoneSelectInfo) => void) | null;
}

/** RenderSession 公开接口（兼容原 RenderModel3DHandle） */
export interface RenderSessionHandle {
  resetCamera: () => void;
  setSpeed: (v: number) => void;
  setRotationMode: (orbit: boolean) => void;
  setBoneVisible: (name: string, visible: boolean) => void;
  getBoneList: () => Array<{ id: string; name: string; parentId?: string }>;
  toggleBone: (name: string) => void;
  showModelGroup: (idx: number) => void;
  getModelGroupCount: () => number;
  onBoneSelect: ((info: BoneSelectInfo) => void) | null;
  setDebugMode: (mode: "normal" | "pivot" | "bone") => void;
  dispose: () => void;
  /** 兼容别名：指向 dispose */
  cleanup: () => void;
  /** 截取当前渲染画面（PNG base64，无 data: 前缀） */
  screenshot: () => string | null;
}

/**
 * RenderSession：封装单次 3D 渲染会话的完整生命周期。
 * 
 * 设计目标（ADR-052）：
 * 1. 场景对象（camera/renderer/controls/scene/container）收敛为实例字段
 * 2. 16 个回调方法化（本阶段暂保留闭包，下阶段迁移）
 * 3. dispose() 完整释放所有 Three.js 资源
 * 4. 多实例共存安全（无模块级状态覆盖）
 */
export class RenderSession {
  // ── 场景对象（实例字段，替代原模块级 _scene3d/_camera3d 等）─────
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  readonly container: HTMLElement;
  readonly rootGroup: THREE.Group;

  // ── 会话状态 ────────────────────────────────────────────────
  readonly state: RenderSessionState;
  
  // ── 配置/常量（不可变，构造时注入）─────────────────────────
  private readonly spec: Spec3D;
  private readonly texArr: (THREE.Texture | null)[];
  private readonly texIdx: number;
  private readonly boneGroupMap: Map<string, THREE.Group>;
  private readonly modelGroups: THREE.Group[];
  
  // ── 内部引用（用于 cleanup）─────────────────────────────────
  private _rafIdGuard: number | null = null;
  private readonly cleanups: Array<() => void> = [];
  private _disposed = false;

  // ── 构造：初始化渲染器 + 场景 + 注册监听器 ──────────────────
  constructor(
    container: HTMLElement,
    texArr: (THREE.Texture | null)[],
    spec: Spec3D,
    texIdx = 0,
  ) {
    this.container = container;
    this.spec = spec;
    this.texArr = texArr;
    this.texIdx = texIdx;

    // 初始化 renderer + 场景 + 灯光
    const setupResult = setupRenderer(container);
    this.scene = setupResult.scene;
    this.camera = setupResult.camera;
    this.renderer = setupResult.renderer;
    this.controls = setupResult.controls;

    // 构建网格
    const meshResult = buildSceneMesh(spec);
    this.boneGroupMap = meshResult.boneGroupMap;
    this.rootGroup = meshResult.rootGroup;
    this.modelGroups = meshResult.modelGroups;
    this.scene.add(this.rootGroup);

    // 初始化所有模型组可见性
    this.modelGroups.forEach((g) => { g.visible = true; });

    // 合并同 boneId+texIdx 的 mesh（与原逻辑一致）
    this.mergeMeshGroups(spec.models || []);

    // 相机定位（ysmview 口径）
    const { initCamPos, initCamTarget } = fitCameraToScene(this.scene, this.camera, this.controls);
    this._initCamPos = initCamPos;
    this._initCamTarget = initCamTarget;

    // 初始化状态对象
    this.state = this.createState();

    // 注册 DOM 监听器
    this.registerListeners();

    // 启动渲染循环
    this.startRenderLoop();

    // 注册骨骼射线拾取
    this.registerBoneRaycast();
  }

  // ── 私有辅助方法 ──────────────────────────────────────────────
  private _initCamPos: THREE.Vector3;
  private _initCamTarget: THREE.Vector3;

  private createState(): RenderSessionState {
    const state: RenderSessionState = {
      rafId: null,
      keys: {},
      debugMode: "normal",
      lastTime: performance.now(),
      camSpeed: loadTdCamSpeed(),
      orbitMode: loadTdRotMode(),
      fsTimer: null,
      mouseDown: false,
      lastMouse: { x: 0, y: 0 },
      hoveredBone: null,
      hoveredMesh: null,
      debugGroup: null,
      setHoveredBone: (v) => { state.hoveredBone = v; },
      setHoveredMesh: (v) => { state.hoveredMesh = v; },
      onBoneSelectCallback: null,
    };
    return state;
  }

  private mergeMeshGroups(models: SpecModelGroup3D[]): void {
    for (const [mi, mg] of models.entries()) {
      if (!mg.meshGroups?.length) continue;
      const grouped = new Map<string, SpecMeshGroup3D[]>();
      for (const md of mg.meshGroups) {
        const key = md.boneId + ":" + (md.texIdx ?? 0);
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(md);
      }
      const merged: SpecMeshGroup3D[] = [];
      for (const [, g] of grouped) {
        if (g.length === 1) {
          merged.push(g[0]);
          continue;
        }
        let positions: number[] = [];
        let normals: number[] = [];
        let uvs: number[] = [];
        let idx: number[] = [];
        let idxOff = 0;
        const standalone: SpecMeshGroup3D[] = [];
        for (const md of g) {
          const isId =
            md.localRotation?.[3] === 1 &&
            md.localRotation?.[0] === 0 &&
            md.localRotation?.[1] === 0 &&
            md.localRotation?.[2] === 0;
          if (!isId) {
            standalone.push(md);
            continue;
          }
          const dx = md.localPosition?.[0] || 0;
          const dy = md.localPosition?.[1] || 0;
          const dz = md.localPosition?.[2] || 0;
          for (let i = 0; i < (md.positions?.length || 0); i += 3) {
            positions.push((md.positions[i] || 0) + dx);
            positions.push((md.positions[i + 1] || 0) + dy);
            positions.push((md.positions[i + 2] || 0) + dz);
          }
          if (md.normals) normals.push(...md.normals);
          if (md.uvs) uvs.push(...md.uvs);
          for (let i = 0; i < (md.indices?.length || 0); i++)
            idx.push((md.indices[i] || 0) + idxOff);
          idxOff += (md.positions?.length || 0) / 3;
        }
        if (positions.length)
          merged.push({
            id: g[0].boneId + "_merged",
            boneId: g[0].boneId,
            texIdx: g[0].texIdx,
            localPosition: [0, 0, 0],
            localRotation: [0, 0, 0, 1],
            positions,
            normals,
            uvs,
            indices: idx,
          });
        merged.push(...standalone);
      }
      mg.meshGroups = merged;
      for (const md of mg.meshGroups) {
        const bg = this.boneGroupMap.get(compKey(mi, md.boneId));
        if (!bg) continue;
        if (md.texIdx === undefined) {
          console.warn("[RenderSession] mesh 缺 texIdx（spec 契约破坏），回退 0", this.spec.models?.length);
        }
        addMeshToBoneGroup(bg, md, this.texArr, this.texIdx, (this.spec.models?.length ?? 1) > 1);
      }
    }
  }

  private registerListeners(): void {
    // resize
    const onResize = (): void => {
      const w = this.container.clientWidth;
      const h = this.container.clientHeight;
      if (w > 0 && h > 0) {
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
      }
    };
    window.addEventListener("resize", onResize);
    this.cleanups.push(() => window.removeEventListener("resize", onResize));

    // fullscreen change
    const onFSChange = (): void => {
      if (this.state.fsTimer != null) clearTimeout(this.state.fsTimer);
      this.state.fsTimer = setTimeout(onResize, FS_RESIZE_DEBOUNCE_MS);
    };
    document.addEventListener("fullscreenchange", onFSChange);
    this.cleanups.push(() => document.removeEventListener("fullscreenchange", onFSChange));
    document.addEventListener("webkitfullscreenchange", onFSChange);
    this.cleanups.push(() => document.removeEventListener("webkitfullscreenchange", onFSChange));

    // keyboard
    const keymap = loadTdKeymap();
    const isShift = (code: string): boolean => code === "ShiftLeft" || code === "ShiftRight";
    const movementCodes = new Set<string>([
      keymap.forward, keymap.back, keymap.left, keymap.right, keymap.up, keymap.down,
      "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
    ]);
    const isEditable = (el: EventTarget | null): boolean => {
      const node = el as HTMLElement | null;
      return !!node && (node.tagName === "INPUT" || node.tagName === "TEXTAREA" || node.isContentEditable);
    };

    const onKeyDown = (e: KeyboardEvent): void => {
      if (isEditable(e.target)) return;
      this.state.keys[e.code] = true;
      if (movementCodes.has(e.code) && !isShift(e.code)) e.preventDefault();
      if (e.key.toLowerCase() === "f") {
        const modes: Array<"normal" | "pivot" | "bone"> = ["normal", "pivot", "bone"];
        const next = (modes.indexOf(this.state.debugMode) + 1) % modes.length;
        this.state.debugMode = modes[next];
        rebuildDebug(this.scene, this.rootGroup, this.boneGroupMap, this.spec, this.state);
      }
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      this.state.keys[e.code] = false;
    };
    document.addEventListener("keydown", onKeyDown);
    this.cleanups.push(() => document.removeEventListener("keydown", onKeyDown));
    document.addEventListener("keyup", onKeyUp);
    this.cleanups.push(() => document.removeEventListener("keyup", onKeyUp));

    // free camera drag
    const freeDragCleanup = registerFreeCameraDrag(
      this.renderer, this.camera, this.controls,
      { get current() { return this.state.orbitMode; } },
    );
    this.cleanups.push(freeDragCleanup);
    this.controls.enableRotate = this.state.orbitMode;
  }

  private startRenderLoop(): void {
    const keymap = loadTdKeymap();
    const orbitTarget = this.controls.target.clone();
    const euler = new THREE.Euler(0, 0, 0, "YXZ");

    startRenderLoop({
      camera: this.camera,
      renderer: this.renderer,
      scene: this.scene,
      controls: this.controls,
      state: this.state,
      _keymap: keymap,
      _orbitTarget: orbitTarget,
      _euler: euler,
      onRafId: (id) => { this._rafIdGuard = id; },
    });
  }

  private registerBoneRaycast(): void {
    const { nameMap, parentMap, childrenMap } = buildBoneHierarchy(this.spec);
    const cleanup = registerBoneRaycast(
      this.renderer, this.camera, this.scene, this.boneGroupMap,
      nameMap, parentMap, childrenMap,
      this.state,
    );
    this.cleanups.push(cleanup);
  }

  private applyFreeCamTarget(): void {
    const d = new THREE.Vector3();
    this.camera.getWorldDirection(d);
    this.controls.target.copy(this.camera.position).addScaledVector(d, FREE_CAM_TARGET_DIST);
  }

  // ── 公开接口（兼容原 RenderModel3DHandle）─────────────────────
  resetCamera(): void {
    this.camera.position.copy(this._initCamPos);
    this.controls.target.copy(this._initCamTarget);
    if (this.state.orbitMode) {
      this.controls.enableRotate = true;
    } else {
      this.controls.enableRotate = false;
      this.applyFreeCamTarget();
    }
    this.camera.quaternion.set(0, 0, 0, 1);
    this.state.camSpeed = RESET_CAM_SPEED;
    this.state.mouseDown = false;
    Object.keys(this.state.keys).forEach((k) => (this.state.keys[k] = false));
    this.controls.update();
  }

  setSpeed(v: number): void {
    this.state.camSpeed = v;
  }

  setRotationMode(orbit: boolean): void {
    this.state.orbitMode = orbit;
    if (orbit) {
      this.controls.enableRotate = true;
      this.state.mouseDown = false;
    } else {
      this.controls.enableRotate = false;
      this.applyFreeCamTarget();
      this.controls.update();
      this.state.mouseDown = false;
    }
  }

  setBoneVisible(name: string, visible: boolean): void {
    _setBoneVisible(this.boneGroupMap, name, visible);
  }

  getBoneList(): Array<{ id: string; name: string; parentId?: string }> {
    return getBoneList(this.spec);
  }

  toggleBone(name: string): void {
    _toggleBone(this.boneGroupMap, name);
  }

  showModelGroup(idx: number): void {
    _showModelGroup(this.modelGroups as any, idx);
  }

  getModelGroupCount(): number {
    return this.spec.models?.length || 0;
  }

  setDebugMode(mode: "normal" | "pivot" | "bone"): void {
    this.state.debugMode = mode;
    rebuildDebug(this.scene, this.rootGroup, this.boneGroupMap, this.spec, this.state);
  }

  // onBoneSelect getter/setter（兼容原 Object.defineProperty 语义）
  private _onBoneSelect: ((info: BoneSelectInfo) => void) | null = null;
  get onBoneSelect(): ((info: BoneSelectInfo) => void) | null {
    return this._onBoneSelect;
  }
  set onBoneSelect(v: ((info: BoneSelectInfo) => void) | null) {
    this._onBoneSelect = v;
    this.state.onBoneSelectCallback = v;
  }

  // ── 生命周期：dispose（替代原 cleanup）────────────────────────
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;

    // 停止渲染循环
    if (this._rafIdGuard != null) cancelAnimationFrame(this._rafIdGuard);

    // 清除防抖 timer
    if (this.state.fsTimer != null) clearTimeout(this.state.fsTimer);

    // 执行所有解绑器
    this.cleanups.forEach((fn) => fn());
    this.cleanups.splice(0, this.cleanups.length);

    // 释放 Three.js 资源
    if (this.state.debugGroup) {
      disposeDebugGroup(this.state.debugGroup);
      this.scene.remove(this.state.debugGroup);
      this.state.debugGroup = null;
    }
    disposeSceneMeshes(this.scene);
    safeDisposeRenderer(this.renderer);
    this.controls.dispose();

    // 清空容器
    this.container.innerHTML = "";
  }

  // 兼容原 handle.cleanup 命名（别名）
  cleanup(): void {
    this.dispose();
  }

  /** 截取当前渲染画面（PNG base64，无 data: 前缀） */
  screenshot(): string | null {
    if (this._disposed) return null;
    try {
      this.renderer.render(this.scene, this.camera);
      const dataUrl = this.renderer.domElement.toDataURL("image/png");
      return dataUrl.split(",")[1] ?? null;
    } catch {
      return null;
    }
  }
}

// 类型别名：保持与原 RenderModel3DHandle 兼容
export type RenderModel3DHandle = RenderSessionHandle;

// ── 工厂函数：保持与原 renderModel3D 签名兼容 ───────────────────
export async function renderModel3D(
  container: HTMLElement,
  texArr: (THREE.Texture | null)[],
  spec: Spec3D,
  texIdx = 0,
): Promise<RenderSessionHandle> {
  const session = new RenderSession(container, texArr, spec, texIdx);
  return session;
}

// ── Re-export 类型保持兼容 ─────────────────────────────────────
export type { Spec3D, SpecBone3D, SpecMeshGroup3D, SpecModelGroup3D, BoneSelectInfo } from "./model3d.ts";
export { DEFAULT_TD_KEYMAP, loadTdKeymap, loadTdCamSpeed, loadTdRotMode, type TdKeyAction } from "./keymap.ts";
