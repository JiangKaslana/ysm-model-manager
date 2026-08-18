// ===== 3D 主渲染循环（从 model3d.ts 拆出，ADR-040 P1 第3轮）=====
// 负责 WASD/方向键自由飞行 + 相机位置更新 + controls 同步。
// 原 renderModel3D 内联 loop 闭包，已迁移至此。
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { loadTdKeymap } from "./keymap.ts";

/** 缓存上向量，避免每帧 new Vector3（审核 P3） */
const UpVec = new THREE.Vector3(0, 1, 0);

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
  /** 每帧复用 Vector3，避免 per-frame GC 压力（审核 P3） */
  _cd: THREE.Vector3;
  _fwd: THREE.Vector3;
  _right: THREE.Vector3;
  _mv: THREE.Vector3;
  /** 每帧上报最新 RAF id（供调用方入口守卫跟随活跃 id，防快照过期——code_review P2） */
  onRafId?: (id: number) => void;
  /** 每帧渲染后上报 renderer.info（draw call / 三角数等，供诊断面板消费） */
  onFrame?: (info: { calls: number; triangles: number; geometries: number; textures: number }) => void;
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
    ctx.camera.getWorldDirection(ctx._cd);
    ctx._fwd.set(ctx._cd.x, 0, ctx._cd.z).normalize();
    ctx._right.crossVectors(ctx._fwd, UpVec).normalize();
    ctx._mv.set(0, 0, 0);
    if (ctx.state.keys[ctx._keymap.forward] || ctx.state.keys["ArrowUp"]) ctx._mv.add(ctx._fwd);
    if (ctx.state.keys[ctx._keymap.back] || ctx.state.keys["ArrowDown"]) ctx._mv.sub(ctx._fwd);
    if (ctx.state.keys[ctx._keymap.left] || ctx.state.keys["ArrowLeft"]) ctx._mv.sub(ctx._right);
    if (ctx.state.keys[ctx._keymap.right] || ctx.state.keys["ArrowRight"]) ctx._mv.add(ctx._right);
    if (ctx.state.keys[ctx._keymap.up]) ctx._mv.y += 1;
    if (ctx.state.keys[ctx._keymap.down]) ctx._mv.y -= 1;
    if (ctx._mv.length() > 0) {
      ctx._mv.normalize().multiplyScalar(ctx.state.camSpeed * dt);
      ctx.camera.position.add(ctx._mv);
      if (ctx.state.orbitMode) ctx._orbitTarget.add(ctx._mv);
    }
    if (ctx.state.orbitMode) {
      ctx.controls.target.copy(ctx._orbitTarget);
      ctx.controls.update();
      ctx._orbitTarget.copy(ctx.controls.target);
    } else {
      ctx.controls.target.copy(ctx.camera.position).addScaledVector(ctx._cd, 10);
      ctx.controls.update();
    }
    ctx.renderer.render(ctx.scene, ctx.camera);
    // ADR-096 诊断：每帧上报 renderer.info 供诊断面板消费
    if (ctx.onFrame) {
      const info = ctx.renderer.info.render;
      ctx.onFrame({
        calls: info.calls,
        triangles: info.triangles,
        geometries: ctx.renderer.info.memory.geometries,
        textures: ctx.renderer.info.memory.textures,
      });
    }
  };

  ctx.state.rafId = requestAnimationFrame(loop);
  ctx.onRafId?.(ctx.state.rafId);
  ctx.renderer.render(ctx.scene, ctx.camera);

  // 返回 cleanup 后，调用方在 handle.cleanup 中清零 rafId
  return () => {};
}
