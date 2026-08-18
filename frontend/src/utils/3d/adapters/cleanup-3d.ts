// ===== 3D 预览清理函数（从 mount-preview-core.ts 抽出）=====
// 涵盖全量 GPU 资源释放 + 事件监听解绑 + 外壳拆除
//
// 拆分原则（ADR-066 P3）：
// - fullCleanup：mount3D 内嵌闭包，改写成接受 CleanupContext 的纯函数
// - safeDisposeMat：材质+纹理安全释放，无外部依赖

import * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { PreviewMenuHandle } from "./preview-menu.ts";
import type { SkyCapability } from "../caps/sky-capability.ts";
import type { GroundCapability } from "../caps/ground-capability.ts";
import type { LightCapability } from "../caps/light-capability.ts";
import type { FogCapability } from "../caps/fog-capability.ts";
import { ShadowCapability } from "../caps/shadow-capability.ts";
import { ReflectorCapability } from "../caps/reflector-capability.ts";
import { EnvironmentCapability } from "../caps/environment-capability.ts";
import type { PostprocessingManager, PostprocessingLike } from "./postprocessing.ts";
import type { PostprocessingCapability } from "../caps/postprocessing-capability.ts";
import { sceneRegistry } from "./scene-registry.ts";
import { sceneCapabilityRegistry } from "../caps/scene-capability-registry.ts";
import { textureCache } from "../texture-cache.ts";
import { clearModelRoots } from "../frustum-cull.ts";

// ── CleanupContext ────────────────────────────────────────────────────────
// 所有可从 mount3D 作用域松绑的外部引用，统一经此接口注入。
// 可变 let 变量通过 setter 回调传递，允许纯函数内赋值。

export interface CleanupContext {
  menuHandle: PreviewMenuHandle;
  isDisposed: { v: boolean };
  animId: number;
  onKeyDown: (e: KeyboardEvent) => void;
  onKeyUp: (e: KeyboardEvent) => void;
  /** 当前 ESC 处理函数（可变：switchTo 后重新赋值，getter 保证读到最新值） */
  getEscH: () => (e: KeyboardEvent) => void;
  onDragPointerDown: (e: PointerEvent) => void;
  onDragPointerUp: (e: PointerEvent) => void;
  onDragPointerMove: (e: PointerEvent) => void;
  onResize: () => void;
  onUnifiedPick: ((e: MouseEvent) => void) | null;
  allBuilt: { dispose(): void }[];
  nullBuilt: () => void;
  skyCap: SkyCapability | null;
  groundCap: GroundCapability | null;
  lightCap: LightCapability | null;
  fogCap: FogCapability | null;
  shadowCap: ShadowCapability | null;
  reflectorCap: ReflectorCapability | null;
  environmentCap: EnvironmentCapability | null;
  postProc: PostprocessingLike | null;
  nullPostProc: () => void;
  postProcCap: PostprocessingCapability | null;
  renderer: THREE.WebGLRenderer | undefined;
  scene: THREE.Scene | undefined;
  controls: OrbitControls | undefined;
  overlay: HTMLElement;
  nullHandle: () => void;
  adapter: { onClose?: () => void };
  /** tip 自动消失定时器 ID（可变，0 表示无） */
  getTipTimeoutId: () => ReturnType<typeof setTimeout> | 0;
}

// ── fullCleanup ────────────────────────────────────────────────────────────
// 全量释放：事件监听解绑 + caps dispose + 内容层 dispose + 外壳拆除
// 替代原 mount3D 内嵌闭包（L561-622）

export function runFullCleanup(ctx: CleanupContext): void {
  ctx.menuHandle.dispose();
  // ADR-093 T2：重置场景注册表（随会话生命周期；释放由下方 allBuilt dispose 负责）
  sceneRegistry.reset();
  if (ctx.isDisposed.v) return;
  ctx.isDisposed.v = true;
  cancelAnimationFrame(ctx.animId);
  // tip 自动消失定时器（审核 #3）：防止 cleanup 后回调执行
  const tipId = ctx.getTipTimeoutId();
  if (tipId) clearTimeout(tipId);
  document.removeEventListener("keydown", ctx.onKeyDown);
  document.removeEventListener("keyup", ctx.onKeyUp);
  // 当前 ESC 处理函数（审核 #2）：switchTo 后 escH 被重新赋值，通过 getter 读取最新值
  document.removeEventListener("keydown", ctx.getEscH());
  // renderer.domElement 上的拖拽监听（审核 #1）：之前遗漏，cleanup 链中完全缺失
  ctx.renderer?.domElement?.removeEventListener("pointerdown", ctx.onDragPointerDown);
  window.removeEventListener("pointerup", ctx.onDragPointerUp);
  window.removeEventListener("pointermove", ctx.onDragPointerMove);
  window.removeEventListener("resize", ctx.onResize);
  // R1-P2-1：click 拾取处理器显式解绑（之前仅靠 GC，多会话切换时残留）
  if (ctx.onUnifiedPick && ctx.renderer?.domElement) {
    ctx.renderer.domElement.removeEventListener("click", ctx.onUnifiedPick);
  }
  // 内容层先释放自身资源，核心再回收外壳
  // cooperate 模式下需逐一 dispose 所有已追加模型（adapter 专属 GPU 资源）
  for (const b of ctx.allBuilt) {
    try { b.dispose(); } catch (_) { /* 防御性：个别适配器 dispose 抛错不阻塞全量释放 */ }
  }
  ctx.allBuilt.length = 0;
  ctx.nullBuilt();
  // 程序化天空（ADR-073 L1）：还原 tone mapping 并释放 PMREM/几何/材质
  // 统一注册表：保存状态后由 registry 统一 dispose
  try { sceneCapabilityRegistry.saveAll(); } catch (_) { /* 防御性 */ }
  try { sceneCapabilityRegistry.dispose(); } catch (_) { /* 防御性释放 */ }
  // P0 纹理缓存池：session 结束释放所有缓存纹理
  try { textureCache.disposeAll(); } catch (_) { /* 防御性释放 */ }
  // 视锥裁剪：清空模型根节点注册
  try { clearModelRoots(); } catch (_) { /* 防御性释放 */ }
  // 兼容旧 cleanupCtx 引用（cleanupCtx 内仍有 skyCap/groundCap/lightCap）
  try { ctx.skyCap?.dispose(); } catch (_) { /* 防御性释放 */ }
  try { ctx.groundCap?.dispose(); } catch (_) { /* 防御性释放 */ }
  try { ctx.lightCap?.dispose(); } catch (_) { /* 防御性释放 */ }
  try { ctx.fogCap?.dispose(); } catch (_) { /* 防御性释放 */ }
  try { ctx.shadowCap?.dispose(); } catch (_) { /* 防御性释放 */ }
  try { ctx.reflectorCap?.dispose(); } catch (_) { /* 防御性释放 */ }
  try { ctx.environmentCap?.dispose(); } catch (_) { /* 防御性释放 */ }
  // 后处理体积光管线（ADR-081 L2）：释放 EffectComposer + bloom
  try {
    ctx.postProcCap?.dispose();
    ctx.postProc?.dispose();
    ctx.nullPostProc();
  } catch (_) { /* 防御性释放 */ }
  // 防御性遍历：释放内容层可能遗漏的几何/材质/纹理
  if (ctx.renderer) {
    const sc = ctx.scene as THREE.Scene | undefined;
    if (sc && typeof (sc as unknown as { traverse?: unknown }).traverse === "function") {
      sc.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) {
          try { mesh.geometry.dispose(); } catch (_) { /* 防御性释放 */ }
        }
        const mat = (mesh as unknown as { material?: THREE.Material | THREE.Material[] }).material;
        if (mat) {
          if (Array.isArray(mat)) mat.forEach((m) => safeDisposeMat(m));
          else safeDisposeMat(mat);
        }
      });
    }
    ctx.renderer.dispose();
    ctx.controls?.dispose();
  }
  if (ctx.overlay.parentNode) ctx.overlay.parentNode.removeChild(ctx.overlay);
  ctx.nullHandle();
  ctx.adapter.onClose?.();
}

// ── safeDisposeMat ─────────────────────────────────────────────────────────
// 安全释放材质及其关联纹理（全量 map 字段），错误不抛
// 与 mesh.ts disposeMaterial 保持一致的纹理字段覆盖范围

const SAFE_DISPOSE_TEX_KEYS = [
  "map", "emissiveMap", "normalMap", "roughnessMap",
  "metalnessMap", "aoMap", "lightMap", "alphaMap", "envMap",
] as const;

function safeDisposeMat(m: THREE.Material): void {
  for (const key of SAFE_DISPOSE_TEX_KEYS) {
    const tex = (m as unknown as Record<string, unknown | THREE.Texture | null>)[key];
    if (tex && typeof (tex as THREE.Texture).dispose === "function") {
      try { (tex as THREE.Texture).dispose(); } catch (_) { /* 防御性释放 */ }
    }
  }
  try { m.dispose(); } catch (_) { /* 防御性释放 */ }
}