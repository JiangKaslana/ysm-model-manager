// ===== 统一 3D 预览核心（ADR-066 P3：收缴 vrm/litematic 复制脚手架）=====
// 所有富格式 3D 预览（vrm / litematic / 后续 ysm）共用同一套外壳：
// overlay + topBar(关闭/旋转模式/速度) + viewContainer + loadingEl +
// scene/camera/renderer/OrbitControls/灯光 + WASD/拖拽自转 + resize +
// rAF 循环 + ESC + GPU 资源释放。内容差异由 PreviewAdapter 经 build() 注入，
// 每帧 update(dt) 驱动动态部分（如 VRM SpringBone）。
//
// 旧实现里 vrm-3d.ts 与 litematic-3d.ts 各自内联 ~250 行同构脚手架（"复制那套"），
// 本文件将其收敛为单一事实来源。适配器契约对齐 YSM 既有的 Model3DHandleX，
// 使三套渲染器最终可经注册表统一派发（P3-E）。

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { bus } from "../../bus.ts";
import { friendlyError } from "../../utils/dom/errors.ts";
import { t } from "../../core/i18n/t.ts";
import { esc } from "../../utils/dom/html.ts";
import type { BoneSelectInfo } from "../../utils/3d/model3d.ts";

/** 适配器构建时可用的通用外壳句柄（内容层据此注入场景/灯光/定相机） */
export interface PreviewBuildCtx {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  viewContainer: HTMLElement;
  loadingEl: HTMLElement;
  overlay: HTMLElement;
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
}

export interface PreviewAdapter {
  id: string;
  build(ctx: PreviewBuildCtx, path: string): Promise<PreviewScene>;
}

/** 统一预览句柄（D 步 ysm 接入时经此暴露内容层方法） */
export interface PreviewHandle {
  cleanup(): void;
  resetCamera?(): void;
  setRotationMode?(orbit: boolean): void;
  setSpeed?(n: number): void;
  showModelGroup?(i: number): void;
  onBoneSelect?(info: BoneSelectInfo): void;
}

// ---- 通用相机控制常量（对齐 vrm/litematic 既有口径）----
const DRAG_ROTATE_SENSITIVITY = 0.003; // 自身旋转模式拖拽灵敏度（rad/px）
const MIN_CAM_SPEED = 2;
const MAX_CAM_SPEED = 200;
const DEFAULT_CAM_SPEED = 20;
const TIP_AUTO_DISMISS_MS = 6000;

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

export async function mount3D(adapter: PreviewAdapter, path: string): Promise<void> {
  cleanupPreview(); // 复用：再次创建先清旧的
  const myGen = ++_gen;

  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:var(--z-fullscreen);background:#1a1b2e;display:flex;flex-direction:column";
  document.body.appendChild(overlay);

  const topBar = document.createElement("div");
  topBar.style.cssText =
    "display:flex;align-items:center;gap:8px;padding:6px 12px;background:rgba(0,0,0,0.3);flex-shrink:0;position:relative;z-index:10;color:#fff;font-size:13px;pointer-events:auto";

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "✕ " + t("preview.close3d");
  closeBtn.style.cssText =
    "font-size:11px;padding:2px 6px;border-radius:4px;border:1px solid rgba(255,255,255,0.2);background:rgba(0,0,0,0.3);color:rgba(255,255,255,0.8);cursor:pointer;font-family:inherit";
  topBar.appendChild(closeBtn);

  const spacer = document.createElement("div");
  spacer.style.cssText = "flex:1";
  topBar.appendChild(spacer);

  const rotLabel = document.createElement("span");
  rotLabel.style.cssText = "font-size:11px;color:rgba(255,255,255,0.5)";
  rotLabel.textContent = t("preview.cameraRotation") + ":";
  topBar.appendChild(rotLabel);

  const rotSel = document.createElement("select");
  rotSel.style.cssText = "font-size:11px;padding:2px 4px;border-radius:4px;border:1px solid rgba(255,255,255,0.2);background:rgba(0,0,0,0.3);color:rgba(255,255,255,0.8);cursor:pointer;font-family:inherit;margin-right:8px";
  [
    { v: true, t: "环绕" },
    { v: false, t: "自身" },
  ].forEach((m) => {
    const opt = document.createElement("option");
    opt.value = String(m.v);
    opt.textContent = m.t;
    rotSel.appendChild(opt);
  });
  topBar.appendChild(rotSel);

  const spdLabel = document.createElement("span");
  spdLabel.style.cssText = "font-size:11px;color:rgba(255,255,255,0.5)";
  spdLabel.textContent = t("preview.cameraSpeed") + ":";
  topBar.appendChild(spdLabel);

  const spdSlider = document.createElement("input");
  spdSlider.type = "range";
  spdSlider.min = String(MIN_CAM_SPEED);
  spdSlider.max = String(MAX_CAM_SPEED);
  spdSlider.value = String(DEFAULT_CAM_SPEED);
  spdSlider.style.cssText = "width:80px;margin:0 4px;cursor:pointer;accent-color:var(--accent,#7c83ff)";
  topBar.appendChild(spdSlider);

  const spdVal = document.createElement("span");
  spdVal.style.cssText = "font-size:11px;color:rgba(255,255,255,0.6);min-width:20px";
  spdVal.textContent = "20";
  topBar.appendChild(spdVal);

  overlay.appendChild(topBar);

  const viewContainer = document.createElement("div");
  viewContainer.style.cssText = "flex:1;position:relative";
  overlay.appendChild(viewContainer);

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
  }
  closeBtn.onclick = () => {
    if (cleanupFn) cleanupFn();
    else closeOverlay();
  };
  document.addEventListener("keydown", escH);

  // 通用外壳：场景 / 相机 / renderer / 控制器（灯光由适配器按内容补）
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#1a1b2e");

  const camera = new THREE.PerspectiveCamera(
    50,
    viewContainer.clientWidth / Math.max(viewContainer.clientHeight, 1),
    0.05,
    5000,
  );

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(viewContainer.clientWidth, viewContainer.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.domElement.style.touchAction = "none"; // ADR-047：触屏拖拽旋转需禁手势默认
  viewContainer.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.minDistance = 0.1;
  controls.maxDistance = 5000;
  controls.update();

  // 通用相机状态（WASD / 环绕 vs 自身旋转 / 速度）
  const isDisposed = { v: false };
  const keys: Record<string, boolean> = {};
  let camSpeed = DEFAULT_CAM_SPEED;
  let orbitMode = true;
  // 对齐旧 vrm/litematic：用 controls.target 克隆体承载环绕焦点（避免依赖 THREE.Vector3 构造）
  const orbitTarget = controls.target.clone();
  const euler = new THREE.Euler(0, 0, 0, "YXZ");
  let mouseDown = false;
  let lastMouse = { x: 0, y: 0 };

  function onKeyDown(e: KeyboardEvent): void {
    keys[e.key.toLowerCase()] = true;
    if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(e.key.toLowerCase())) {
      e.preventDefault();
    }
  }
  function onKeyUp(e: KeyboardEvent): void {
    keys[e.key.toLowerCase()] = false;
  }
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keyup", onKeyUp);

  function onDragPointerDown(e: PointerEvent): void {
    if (!orbitMode && e.button === 0) {
      mouseDown = true;
      lastMouse.x = e.clientX;
      lastMouse.y = e.clientY;
      renderer.domElement.setPointerCapture(e.pointerId);
    }
  }
  function onDragPointerUp(e: PointerEvent): void {
    mouseDown = false;
    if (renderer.domElement.hasPointerCapture(e.pointerId)) {
      renderer.domElement.releasePointerCapture(e.pointerId);
    }
  }
  function onDragPointerMove(e: PointerEvent): void {
    if (orbitMode || !mouseDown) return;
    const dx = e.clientX - lastMouse.x;
    const dy = e.clientY - lastMouse.y;
    lastMouse.x = e.clientX;
    lastMouse.y = e.clientY;
    euler.setFromQuaternion(camera.quaternion);
    euler.y -= dx * DRAG_ROTATE_SENSITIVITY;
    euler.x -= dy * DRAG_ROTATE_SENSITIVITY;
    euler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, euler.x));
    camera.quaternion.setFromEuler(euler);
  }
  renderer.domElement.addEventListener("pointerdown", onDragPointerDown);
  window.addEventListener("pointerup", onDragPointerUp);
  window.addEventListener("pointermove", onDragPointerMove);

  controls.enableRotate = true;

  rotSel.onchange = (): void => {
    orbitMode = rotSel.value === "true";
    controls.enableRotate = orbitMode;
    if (orbitMode) {
      controls.target.copy(orbitTarget);
    } else {
      euler.setFromQuaternion(camera.quaternion);
    }
    mouseDown = false;
  };
  spdSlider.oninput = (): void => {
    camSpeed = Number(spdSlider.value);
    spdVal.textContent = spdSlider.value;
  };

  function onResize(): void {
    if (isDisposed.v) return;
    camera.aspect = viewContainer.clientWidth / Math.max(viewContainer.clientHeight, 1);
    camera.updateProjectionMatrix();
    renderer.setSize(viewContainer.clientWidth, viewContainer.clientHeight);
  }
  window.addEventListener("resize", onResize);

  // 操作提示条（自动消失）
  const tip = document.createElement("div");
  tip.style.cssText = "padding:6px 12px;background:rgba(124,131,255,0.2);color:#fff;font-size:12px;text-align:center;flex-shrink:0;font-weight:500";
  tip.textContent = "🎮 WASD 移动 | 空格/Shift 上下 | 🖱 拖拽旋转 | 🔍 滚轮缩放 | ESC 关闭";
  overlay.insertBefore(tip, overlay.children[1]);
  setTimeout(() => {
    if (tip.parentNode) tip.remove();
  }, TIP_AUTO_DISMISS_MS);

  let lastTime = performance.now();
  let animId = 0;
  let perFrame: ((dt: number) => void) | null = null;
  function animate(): void {
    if (isDisposed.v) return;
    animId = requestAnimationFrame(animate);
    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
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
      camera.position.add(move);
      if (orbitMode) orbitTarget.add(move);
    }

    if (orbitMode) {
      controls.target.copy(orbitTarget);
      controls.update();
      orbitTarget.copy(controls.target);
    } else {
      controls.target.copy(camera.position).addScaledVector(camDir, 10);
      controls.update();
    }

    if (perFrame) perFrame(dt);
    renderer.render(scene, camera);
  }
  animate();

  let cleanupFn: (() => void) | null = null;

  try {
    // 代际守卫：await 期间用户已点其他文件 / 被 invalidate，丢弃本次挂载
    if (myGen !== _gen) return;

    const built = await adapter.build(
      { scene, camera, controls, viewContainer, loadingEl, overlay },
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

    // 同步通用相机状态到适配器已设定的取景（包围盒/尺寸定相机）
    orbitTarget.copy(controls.target);
    euler.setFromQuaternion(camera.quaternion);
    perFrame = built.update ?? null;

    // 适配器专属控件挂入通用 topBar 之后
    built.extraControls?.(topBar);

    function fullCleanup(): void {
      if (isDisposed.v) return;
      isDisposed.v = true;
      cancelAnimationFrame(animId);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("keydown", escH);
      window.removeEventListener("pointerup", onDragPointerUp);
      window.removeEventListener("pointermove", onDragPointerMove);
      window.removeEventListener("resize", onResize);
      // 内容层先释放自身资源，核心再回收外壳
      try {
        built.dispose();
      } catch (_) {}
      // 防御性遍历：释放内容层可能遗漏的几何/材质/纹理
      // （stub 环境 Scene 未必实现 traverse，typeof 守卫避免误崩）
      if (typeof (scene as unknown as { traverse?: unknown }).traverse === "function") {
        scene.traverse((obj) => {
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
      controls.dispose();
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      _handle = null;
    }

    function escHandler(e: KeyboardEvent): void {
      if (e.key === "Escape") fullCleanup();
    }
    document.removeEventListener("keydown", escH);
    document.addEventListener("keydown", escHandler);
    closeBtn.onclick = fullCleanup;
    cleanupFn = fullCleanup;
    _handle = {
      cleanup: fullCleanup,
      resetCamera: built.resetCamera,
      setRotationMode: built.setRotationMode,
      setSpeed: built.setSpeed,
      showModelGroup: built.showModelGroup,
      onBoneSelect: built.onBoneSelect,
    };
  } catch (e) {
    document.removeEventListener("keydown", escH);
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
