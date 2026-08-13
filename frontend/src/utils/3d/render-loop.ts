// ===== 3D 主渲染循环（从 model3d.ts 拆出，ADR-040 P1 第3轮）=====
// 负责 WASD/方向键自由飞行 + 相机位置更新 + controls 同步。
// 原 renderModel3D 内联 loop 闭包，已迁移至此。
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { loadTdKeymap } from "./keymap.ts";

/** loop 所需的运行时上下文接口 */
export interface LoopContext {
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  controls: OrbitControls;
  state: {
    rafId: number | null;
    keys: Record<string, boolean>;
    camSpeed: number;
    orbitMode: boolean;
    lastTime: number;
  };
  _keymap: ReturnType<typeof loadTdKeymap>;
  _orbitTarget: THREE.Vector3;
  _euler: THREE.Euler;
  /** 每帧上报最新 RAF id（供调用方入口守卫跟随活跃 id，防快照过期——code_review P2） */
  onRafId?: (id: number) => void;
}

/**
 * 启动渲染循环并立即渲染一帧。
 * 调用方负责在 cleanup 中 cancelAnimationFrame(state.rafId)。
 * @returns cleanup 函数（仅移除 RAF，不含 RAF id 清零）
 */
export function startRenderLoop(ctx: LoopContext): () => void {
  const loop = (): void => {
    ctx.state.rafId = requestAnimationFrame(loop);
    ctx.onRafId?.(ctx.state.rafId); // 上报最新 id，调用方守卫跟随（防快照过期）
    const dt = Math.min((performance.now() - ctx.state.lastTime) / 1000, 0.1);
    ctx.state.lastTime = performance.now();
    const cd = new THREE.Vector3();
    ctx.camera.getWorldDirection(cd);
    const fwd = new THREE.Vector3(cd.x, 0, cd.z).normalize();
    const right = new THREE.Vector3()
      .crossVectors(fwd, new THREE.Vector3(0, 1, 0))
      .normalize();
    const mv = new THREE.Vector3();
    if (ctx.state.keys[ctx._keymap.forward] || ctx.state.keys["ArrowUp"]) mv.add(fwd);
    if (ctx.state.keys[ctx._keymap.back] || ctx.state.keys["ArrowDown"]) mv.sub(fwd);
    if (ctx.state.keys[ctx._keymap.left] || ctx.state.keys["ArrowLeft"]) mv.sub(right);
    if (ctx.state.keys[ctx._keymap.right] || ctx.state.keys["ArrowRight"]) mv.add(right);
    if (ctx.state.keys[ctx._keymap.up]) mv.y += 1;
    if (ctx.state.keys[ctx._keymap.down]) mv.y -= 1;
    if (mv.length() > 0) {
      mv.normalize().multiplyScalar(ctx.state.camSpeed * dt);
      ctx.camera.position.add(mv);
      if (ctx.state.orbitMode) ctx._orbitTarget.add(mv);
    }
    if (ctx.state.orbitMode) {
      ctx.controls.target.copy(ctx._orbitTarget);
      ctx.controls.update();
      ctx._orbitTarget.copy(ctx.controls.target);
    } else {
      ctx.controls.target.copy(ctx.camera.position).addScaledVector(cd, 10);
      ctx.controls.update();
    }
    ctx.renderer.render(ctx.scene, ctx.camera);
  };

  ctx.state.rafId = requestAnimationFrame(loop);
  ctx.onRafId?.(ctx.state.rafId);
  ctx.renderer.render(ctx.scene, ctx.camera);

  // 返回 cleanup 后，调用方在 handle.cleanup 中清零 rafId
  return () => {};
}
