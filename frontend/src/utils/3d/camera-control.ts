// ===== 3D 自由相机指针拖拽控制（从 model3d.ts 拆出，ADR-040 P1）=====
// 处理 free 模式下的 pointer drag 旋转（非 orbit 模式专用）。
// orbit 模式由 OrbitControls 原生处理，此处仅在 orbitMode=false 时生效。
import * as THREE from "three";

/** 拖拽旋转灵敏度（每像素弧度，索引 2.5 魔法数值收敛） */
const DRAG_SENSITIVITY = 0.003;
/** 俯仰角钳制范围（±π/2 防翻转，索引 2.5 魔法数值收敛） */
const PITCH_CLAMP = Math.PI / 2;

/**
 * 注册 free 模式 pointer drag 监听器。
 * @param renderer DOM renderer（提供 domElement）
 * @param camera 目标相机
 * @param controls OrbitControls 实例（用于同步 target）
 * @param orbitMode 引用（可变，切换模式时同步更新 controls.enableRotate）
 * @returns cleanup 函数
 */
export function registerFreeCameraDrag(
  renderer: { domElement: HTMLElement },
  camera: THREE.PerspectiveCamera,
  controls: { enableRotate: boolean; target: THREE.Vector3; update: () => void },
  orbitMode: { current: boolean },
): () => void {
  const _euler = new THREE.Euler(0, 0, 0, "YXZ");
  let mouseDown = false;
  let lastMouse = { x: 0, y: 0 };
  // 共享 _orbitTarget 由调用方（renderModel3D 闭包）持有，此处不需要

  const onDragPointerDown = (e: PointerEvent): void => {
    if (!orbitMode.current && e.button === 0) {
      mouseDown = true;
      lastMouse = { x: e.clientX, y: e.clientY };
      renderer.domElement.setPointerCapture(e.pointerId);
    }
  };
  const onDragPointerUp = (e: PointerEvent): void => {
    mouseDown = false;
    if (renderer.domElement.hasPointerCapture(e.pointerId)) {
      renderer.domElement.releasePointerCapture(e.pointerId);
    }
  };
  const onDragPointerMove = (e: PointerEvent): void => {
    if (orbitMode.current || !mouseDown) return;
    _euler.setFromQuaternion(camera.quaternion);
    _euler.y -= (e.clientX - lastMouse.x) * DRAG_SENSITIVITY;
    _euler.x -= (e.clientY - lastMouse.y) * DRAG_SENSITIVITY;
    _euler.x = Math.max(-PITCH_CLAMP, Math.min(PITCH_CLAMP, _euler.x));
    camera.quaternion.setFromEuler(_euler);
    lastMouse = { x: e.clientX, y: e.clientY };
  };

  renderer.domElement.addEventListener("pointerdown", onDragPointerDown);
  window.addEventListener("pointerup", onDragPointerUp);
  window.addEventListener("pointermove", onDragPointerMove);

  return () => {
    renderer.domElement.removeEventListener("pointerdown", onDragPointerDown);
    window.removeEventListener("pointerup", onDragPointerUp);
    window.removeEventListener("pointermove", onDragPointerMove);
  };
}
