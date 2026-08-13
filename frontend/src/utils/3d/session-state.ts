// ===== 3D 会话状态重置（从 model3d.ts 拆出，ADR-040 P1 第4轮）=====
// 复用 cleanup 和异常路径中的模块级引用复位逻辑。
import * as THREE from "three";
import { safeDisposeRenderer, disposeSceneMeshes } from "./cleanup-helper.ts";

/** 模块级渲染器状态引用 */
export interface RendererState {
  _renderer3d: THREE.WebGLRenderer | null;
  _scene3d: THREE.Scene | null;
  _camera3d: THREE.PerspectiveCamera | null;
  _rootGroup3d: THREE.Group | null;
}

/**
 * 复位所有模块级渲染器引用为 null。
 * 在 entry guard 复用 cleanup 后，或异常路径 cleanup 后调用。
 */
export function resetRendererState(state: RendererState): void {
  state._renderer3d = null;
  state._scene3d = null;
  state._camera3d = null;
  state._rootGroup3d = null;
}

/**
 * 从 DOM 中移除 renderer 的 canvas 元素（安全，已 detached 时不操作）。
 */
export function detachRendererCanvas(renderer: THREE.WebGLRenderer): void {
  if (renderer.domElement.parentNode) {
    renderer.domElement.parentNode.removeChild(renderer.domElement);
  }
}
