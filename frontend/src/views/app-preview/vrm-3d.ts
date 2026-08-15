// ===== VRM 3D 预览（ADR-066 P1：富格式前端直引 three-vrm）=====
// 模式对齐 litematic-3d.ts（独立 overlay + renderer + OrbitControls + rAF 循环 +
// cleanup），复用既有约定，不重复重渲染基建。VRM 经 @pixiv/three-vrm 插件接入
// 官方 GLTFLoader（v3 架构：plugin 而非独立 loader），每帧 vrm.update(delta) 驱动
// SpringBone/表情/LookAt。文件字节经 Go 绑定 ReadFileBytes（base64）取回前端解析。

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import { getApp } from "../../backend/app.ts";
import { bus } from "../../bus.ts";
import { friendlyError } from "../../utils/dom/errors.ts";
import { t } from "../../core/i18n/t.ts";
import { esc } from "../../utils/dom/html.ts";

interface Vrm3DHandle {
  cleanup: () => void;
}

// 模块级代际计数（对齐 litematic-3d 的 voxel3d 守卫）：快速切换模型时，
// 迟到的旧加载不得写进新 overlay / 旧 renderer 死屏残留。
let _vrm3d: Vrm3DHandle | null = null;
let _vrmGen = 0;

/** 任意新预览派发时调用，作废在途 VRM 加载（对齐 invalidateLitematicPreview） */
export function invalidateVrmPreview(): void {
  _vrmGen++;
}

/** 清理 VRM 3D（WebGL renderer + rAF 循环）：组件销毁/再次创建前调用，防 GPU 资源残留 */
export function cleanupVrm3D(): void {
  _vrmGen++; // 作废在途加载
  if (_vrm3d) {
    _vrm3d.cleanup();
    _vrm3d = null;
  }
}

/** base64 → Uint8Array（ReadFileBytes 返回 Go []byte 的 base64 序列化） */
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

const DRAG_ROTATE_SENSITIVITY = 0.003; // 自身旋转模式拖拽灵敏度（rad/px，对齐 litematic）
const MIN_CAM_SPEED = 2;
const MAX_CAM_SPEED = 200;
const DEFAULT_CAM_SPEED = 20;

export async function createVrm3D(path: string): Promise<void> {
  cleanupVrm3D(); // 复用：再次创建先清旧的
  const myGen = ++_vrmGen;

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
  loadingEl.innerHTML =
    '<div style="font-size:32px">🥽</div><div>' + t("preview.loadingModel") + '</div><div style="width:200px;height:3px;background:rgba(255,255,255,0.1);border-radius:2px;overflow:hidden"><div style="height:100%;width:30%;background:var(--accent,#7c83ff);border-radius:2px;animation:ysm-prog 1.5s ease-in-out infinite"></div></div>';
  viewContainer.appendChild(loadingEl);

  let aborted = false;
  let cleanupFn: (() => void) | null = null;

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
    _vrm3d = null;
  }
  closeBtn.onclick = () => {
    if (cleanupFn) cleanupFn();
    else closeOverlay();
  };
  document.addEventListener("keydown", escH);

  try {
    const App = await getApp();
    if (aborted || myGen !== _vrmGen) return;
    const readFn = (App as unknown as Record<string, (p: string) => Promise<string | null>>)["ReadFileBytes"];
    const b64 = await readFn(path);
    if (aborted || myGen !== _vrmGen) return;
    if (!b64) throw new Error("ReadFileBytes 返回空");

    const bytes = b64ToBytes(b64);
    // GLTFLoader.parse 要求 ArrayBuffer
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

    const loader = new GLTFLoader();
    // v3 架构：往官方 GLTFLoader 注册 VRM 插件（不接管资源管线）
    loader.register((parser) => new VRMLoaderPlugin(parser));

    const gltf = await new Promise<GLTF>((resolve, reject) => {
      loader.parse(buffer, "", resolve, reject);
    });
    if (aborted || myGen !== _vrmGen) return;
    const vrm = (gltf.userData as { vrm?: VRM }).vrm!;
    if (!vrm) throw new Error("VRM 实例解析失败（非标准 .vrm？）");

    // VRM0.0 模型背对镜头，转正；VRM1.0 为 no-op 但调用安全
    VRMUtils.rotateVRM0(vrm);
    loadingEl.remove();

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#1a1b2e");
    scene.add(vrm.scene);

    // 包围盒定相机（VRM 原点在脚底、Y-up、面朝 +Z）
    const box = new THREE.Box3().setFromObject(vrm.scene);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;

    const camera = new THREE.PerspectiveCamera(
      50,
      viewContainer.clientWidth / Math.max(viewContainer.clientHeight, 1),
      0.05,
      maxDim * 50,
    );
    camera.position.set(center.x, center.y + size.y * 0.1, center.z + maxDim * 1.6);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(viewContainer.clientWidth, viewContainer.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.domElement.style.touchAction = "none"; // ADR-047：触屏拖拽旋转需禁手势默认
    viewContainer.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(center);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.minDistance = maxDim * 0.1;
    controls.maxDistance = maxDim * 12;
    controls.update();

    // MToon 材质对光有响应，补环境 + 主光 + 半球光
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const dl = new THREE.DirectionalLight(0xffffff, 1.0);
    dl.position.set(1, 2, 1);
    scene.add(dl);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444466, 0.4));

    // 操作提示条（自动消失）
    const tip = document.createElement("div");
    tip.style.cssText = "padding:6px 12px;background:rgba(124,131,255,0.2);color:#fff;font-size:12px;text-align:center;flex-shrink:0;font-weight:500";
    tip.textContent = "🎮 WASD 移动 | 空格/Shift 上下 | 🖱 拖拽旋转 | 🔍 滚轮缩放 | ESC 关闭";
    overlay.insertBefore(tip, overlay.children[1]);
    setTimeout(() => {
      if (tip.parentNode) tip.remove();
    }, 6000);

    const isDisposed = { v: false };
    const keys: Record<string, boolean> = {};
    let camSpeed = DEFAULT_CAM_SPEED;
    let orbitMode = true;
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

    let lastTime = performance.now();
    let animId = 0;
    function animate(): void {
      if (isDisposed.v) return;
      animId = requestAnimationFrame(animate);
      const now = performance.now();
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      // VRM 动态部分（SpringBone/表情/LookAt/MToon UV）靠 vrm.update 驱动
      vrm.update(dt);

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

      renderer.render(scene, camera);
    }
    animate();

    function fullCleanup(): void {
      if (isDisposed.v) return;
      isDisposed.v = true;
      cancelAnimationFrame(animId);
      vrm.update(0);
      // 释放 VRM 几何/材质/纹理（含 MToon），避免 GPU 缓冲泄漏
      VRMUtils.deepDispose(vrm.scene);
      renderer.dispose();
      controls.dispose();
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("keydown", escH);
      window.removeEventListener("pointerup", onDragPointerUp);
      window.removeEventListener("pointermove", onDragPointerMove);
      window.removeEventListener("resize", onResize);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      _vrm3d = null;
    }

    function escHandler(e: KeyboardEvent): void {
      if (e.key === "Escape") fullCleanup();
    }
    document.removeEventListener("keydown", escH);
    document.addEventListener("keydown", escHandler);
    closeBtn.onclick = fullCleanup;
    cleanupFn = fullCleanup;
    _vrm3d = { cleanup: fullCleanup };
  } catch (e) {
    document.removeEventListener("keydown", escH);
    console.error("[vrm 3D] 加载失败:", e);
    loadingEl.innerHTML = `<div style="font-size:32px">⚠️</div><div>${t("preview.loadFailed")}: ${esc(e instanceof Error ? e.message : String(e))}</div>`;
    bus.emit("toast:show", { msg: "❌ " + friendlyError(e, t("preview.vrmLoadFailed")), duration: 5000, type: "error" });
  }
}
