// ===== 3D 预览输入绑定（从 mount-preview-core.ts 抽出）=====
// 职责：WASD 键盘 / 拖拽自转 / resize 事件的绑定与 handler 创建。
// 拆分原则：输入绑定逻辑与外壳生命周期（overlay/ESC/adapter.build）无关，
// 抽出后 mount3D 主流程更清晰。animate 循环因与 camSpeed/perFrame 等共享
// 状态耦合深，暂不提取（见 TODO）。

import * as THREE from "three";
import type { PostprocessingManager } from "./postprocessing.ts";

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** 输入绑定所需的最小依赖集（原 mount3D 内嵌状态） */
export interface InputOptions {
  keys: Record<string, boolean>;
  getOrbitMode: () => boolean;
  mouseDown: { v: boolean };
  lastMouse: { x: number; y: number };
  euler: THREE.Euler;
  camera: THREE.PerspectiveCamera | undefined;
  renderer: THREE.WebGLRenderer | undefined;
  postProc: PostprocessingManager | null;
  viewContainer: HTMLElement;
  isDisposed: { v: boolean };
}

/** 输入事件 handler 集合（供 fullCleanup 解绑用） */
export interface InputHandlers {
  onKeyDown: (e: KeyboardEvent) => void;
  onKeyUp: (e: KeyboardEvent) => void;
  onDragPointerDown: (e: PointerEvent) => void;
  onDragPointerUp: (e: PointerEvent) => void;
  onDragPointerMove: (e: PointerEvent) => void;
  onResize: () => void;
}

// ---------------------------------------------------------------------------
// 输入绑定
// ---------------------------------------------------------------------------

/**
 * 创建并绑定所有 3D 预览输入事件：WASD 键盘 + 拖拽自转 + resize。
 * @returns 各 handler 引用（供 fullCleanup 解绑）
 */
export function bindInputHandlers(opts: InputOptions): InputHandlers {
  const rd = opts.renderer;
  if (!rd) {
    // 兜底：返回 no-op handler（cleanup 解绑时无害）
    const noop = (_e: KeyboardEvent | PointerEvent): void => {};
    return {
      onKeyDown: noop,
      onKeyUp: noop,
      onDragPointerDown: noop,
      onDragPointerUp: noop,
      onDragPointerMove: noop,
      onResize: () => {},
    };
  }

  // —— WASD 键盘 ——
  const onKeyDown = (e: KeyboardEvent): void => {
    opts.keys[e.key.toLowerCase()] = true;
    if (
      ["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(
        e.key.toLowerCase(),
      )
    ) {
      e.preventDefault();
    }
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    opts.keys[e.key.toLowerCase()] = false;
  };
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keyup", onKeyUp);

  // —— 拖拽自转（仅在非 orbit 模式下）——
  const onDragPointerDown = (e: PointerEvent): void => {
    if (!opts.getOrbitMode() && e.button === 0) {
      opts.mouseDown.v = true;
      opts.lastMouse.x = e.clientX;
      opts.lastMouse.y = e.clientY;
      rd.domElement.setPointerCapture(e.pointerId);
    }
  };
  const onDragPointerUp = (e: PointerEvent): void => {
    opts.mouseDown.v = false;
    if (rd.domElement.hasPointerCapture(e.pointerId)) rd.domElement.releasePointerCapture(e.pointerId);
  };
  const onDragPointerMove = (e: PointerEvent): void => {
    if (opts.getOrbitMode() || !opts.mouseDown.v) return;
    const dx = e.clientX - opts.lastMouse.x;
    const dy = e.clientY - opts.lastMouse.y;
    opts.lastMouse.x = e.clientX;
    opts.lastMouse.y = e.clientY;
    const cam = opts.camera;
    if (!cam) return;
    opts.euler.setFromQuaternion(cam.quaternion);
    opts.euler.y -= dx * 0.003;
    opts.euler.x -= dy * 0.003;
    opts.euler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, opts.euler.x));
    cam.quaternion.setFromEuler(opts.euler);
  };
  rd.domElement.addEventListener("pointerdown", onDragPointerDown);
  window.addEventListener("pointerup", onDragPointerUp);
  window.addEventListener("pointermove", onDragPointerMove);

  // —— Resize ——
  const onResize = (): void => {
    if (opts.isDisposed.v) return;
    const cam = opts.camera;
    if (!cam || !rd) return;
    cam.aspect = opts.viewContainer.clientWidth / Math.max(opts.viewContainer.clientHeight, 1);
    cam.updateProjectionMatrix();
    rd.setSize(opts.viewContainer.clientWidth, opts.viewContainer.clientHeight);
    opts.postProc?.setSize(opts.viewContainer.clientWidth, opts.viewContainer.clientHeight);
  };
  window.addEventListener("resize", onResize);

  return { onKeyDown, onKeyUp, onDragPointerDown, onDragPointerUp, onDragPointerMove, onResize };
}
