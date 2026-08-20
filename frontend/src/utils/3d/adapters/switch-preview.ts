// ===== 3D 预览会话内模型切换（从 mount-preview-core.ts 抽出）=====
// 职责：复用外壳（renderer/rAF/controls/灯光）重建内容层（ADR-066 §5.6）
// 支持 keepInScene 同台追加模式。
//
// 拆分原则：switchTo 是 mount3D 内嵌闭包（_handle.switchTo 实现），
// 改为接受 SwitchContext 的纯函数，消除闭包耦合。
// 同时抽出重复的「重算包围盒 → 更新 lightCap target」逻辑为独立函数。

import * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { bus } from "../../../bus.ts";
import { esc } from "../../../utils/dom/html.ts";
import { friendlyError } from "../../../utils/dom/errors.ts";
import { t } from "../../../core/i18n/t.ts";
import type { LightCapability } from "../caps/light-capability.ts";
import type { ShadowCapability } from "../caps/shadow-capability.ts";
import type { EnvironmentCapability } from "../caps/environment-capability.ts";
import type { CameraControlBridge } from "./camera-controls.ts";
import type { PreviewBuildCtx, PreviewHandle, PreviewScene } from "./mount-preview-core.ts";
import type { PreviewMenuHandle } from "./preview-menu.ts";
import { sceneRegistry, MAX_MODELS } from "./scene-registry.ts";
import { fitCameraToRoots } from "../camera-setup.ts";

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** 会话内切换所需的外部上下文（原 mount3D 内嵌闭包变量） */
export interface SwitchContext {
  scene: THREE.Scene | undefined;
  /** 可变：build 后赋值为 scene.children 快照 */
  getSceneBaseline: () => Set<THREE.Object3D> | null;
  /** 审核修复 #2：切换后更新 baseline，防止灯光/阴影操作引用已释放的旧对象 */
  setSceneBaseline?: (s: Set<THREE.Object3D>) => void;
  /** 可变：build 后赋值 */
  getBuilt: () => PreviewScene | null;
  setBuilt: (s: PreviewScene | null) => void;
  allBuilt: PreviewScene[];
  loadingEl: HTMLElement;
  viewContainer: HTMLElement;
  overlay: HTMLElement;
  menuHandle: PreviewMenuHandle;
  adapter: { build(ctx: PreviewBuildCtx, path: string): Promise<PreviewScene> };
  camBridge: CameraControlBridge | undefined;
  selfMode: boolean;
  renderer: THREE.WebGLRenderer | undefined;
  controls: OrbitControls | undefined;
  orbitTarget: THREE.Vector3 | undefined;
  camera: THREE.PerspectiveCamera | undefined;
  lightCap: LightCapability | null;
  shadowCap: ShadowCapability | null;
  environmentCap: EnvironmentCapability | null;
  /** 可变：build 后赋值 */
  getCurrentPath: () => string;
  setCurrentPath: (p: string) => void;
  /** 当前资源类型（注册表 rtype 用；mount3D 注入 opts.rtype ?? adapter.id） */
  getCurrentRtype: () => string;
  /** 可变：build 后赋值 */
  getPerFrame: () => ((dt: number) => void) | null;
  setPerFrame: (f: ((dt: number) => void) | null) => void;
  /** 可变：_handle 构造后赋值 */
  getHandle: () => PreviewHandle | null;
  aborted: boolean;
  isDisposed: { v: boolean };
  /** 代际守卫：切换时丢弃过期挂载 */
  myGen: number;
  getGen: () => number;
}

// ---------------------------------------------------------------------------
// 核心：会话内切换
// ---------------------------------------------------------------------------

/**
 * 会话内切换模型（复用外壳重建内容层）。
 * @param ctx       切换上下文（mount3D 内嵌变量统一经此注入）
 * @param newPath   目标模型路径
 * @param options   { keepInScene }——true 时不移除旧模型，追加到同一场景
 */
export async function switchToSession(
  ctx: SwitchContext,
  newPath: string,
  options?: { keepInScene?: boolean },
): Promise<void> {
  if (ctx.aborted || ctx.isDisposed.v || ctx.myGen !== ctx.getGen()) return;
  // P3-2：空路径守卫——空路径会触发 adapter.build(ctx, "") 加载未定义内容
  if (!newPath || !newPath.trim()) return;
  const keep = options?.keepInScene === true;

  // ADR-093 T6：同台追加超量拦截（GPU/内存上限）
  if (keep && sceneRegistry.count() >= MAX_MODELS) {
    bus.emit("toast:show", {
      msg: `同场景模型已达上限（${MAX_MODELS}），无法继续追加`,
      duration: 4000,
      type: "warn",
    });
    return;
  }

  // 1) 清理旧内容层：菜单会通过 ctx.menu.setAdapterItems 在 build 时自动重建，无需手动清理

  // 2) 非同台模式：移除旧内容层添加到共享 scene 的对象（快照 delta，防场景累积）
  if (!keep && ctx.scene && ctx.getSceneBaseline()) {
    const stale = ctx.scene.children.filter((c) => !ctx.getSceneBaseline()!.has(c));
    for (const c of stale) ctx.scene.remove(c);
  }

  // 3) 释放旧内容层 GPU 资源（非同台模式才 dispose；同台模式下旧模型仍需保持）
  if (!keep) {
    try { ctx.getBuilt()?.dispose(); } catch (e) { console.error("[preview] 旧内容层 dispose 失败:", e); }
  }

  // 4) 重建内容层（新 path）
  // ADR-093 T2：build 前后 scene.children 差量捕获本次新增根节点（适配器无关）
  const beforeBuild = ctx.scene ? new Set(ctx.scene.children) : null;
  let next: PreviewScene;
  try {
    next = await ctx.adapter.build(
      {
        scene: ctx.scene,
        camera: ctx.camera,
        controls: ctx.controls,
        renderer: ctx.renderer,
        cameraControls: ctx.selfMode ? undefined : ctx.camBridge,
        viewContainer: ctx.viewContainer,
        loadingEl: ctx.loadingEl,
        overlay: ctx.overlay,
        menu: ctx.menuHandle,
        switchTo: undefined,
      },
      newPath,
    );
  } catch (e) {
    console.error("[preview 3D] 切换失败:", e);
    if (!ctx.loadingEl.parentNode) ctx.viewContainer.appendChild(ctx.loadingEl);
    ctx.loadingEl.innerHTML =
      `<div style="font-size:32px">⚠️</div><div>${t("preview.loadFailed")}: ${esc(e instanceof Error ? e.message : String(e))}</div>`;
    bus.emit("toast:show", {
      msg: "❌ " + friendlyError(e, t("preview.loadFailed")),
      duration: 5000,
      type: "error",
    });
    return;
  }

  if (ctx.aborted || ctx.isDisposed.v || ctx.myGen !== ctx.getGen()) {
    try { next.dispose(); } catch (_) {}
    return;
  }

  ctx.setBuilt(next);
  // P3-1：非同台模式旧 built 已在上方 dispose，allBuilt 只保留当前活跃项——
  // 否则每次切换累积已释放的 PreviewScene 引用，长时间频繁切换内存泄漏。
  // 大审核 #1 修正：清空前必须先 dispose allBuilt 中的其余条目（keep=true 追加的
  // 多模型 m1/m2 在步骤 2 被移出 scene 但从未 dispose）——否则其 GPU 资源孤儿泄漏，
  // 且 sceneRegistry 残留计数虚高（误触 MAX_MODELS 拦截）。
  if (!keep) {
    const active = ctx.getBuilt();
    for (const b of ctx.allBuilt) {
      if (b !== active) {
        try { b.dispose(); } catch (_) { /* 防御性：个别适配器 dispose 抛错不阻塞 */ }
      }
    }
    ctx.allBuilt.length = 0;
  }
  ctx.allBuilt.push(next);
  ctx.setCurrentPath(newPath);

  // ADR-093 T2 修正：非 keep 切换须 unregister 旧活跃模型，
  // 否则注册表残留旧 entry → count 虚高（误触 MAX_MODELS 拦截）+ visibleRoots
  // 含已移除的 detached root（取景幽灵）。单模型切换为最常见路径；
  // keep 多模型后做非 keep 切换的残留由下次 mount 的 reset 兜底。
  if (!keep) {
    const prevId = sceneRegistry.getActiveId();
    if (prevId) sceneRegistry.unregister(prevId);
  }

  // ADR-093 T2：注册进场景注册表（keep 追加 / 普通切换均登记，单一事实来源）
  if (beforeBuild) {
    const added = ctx.scene ? ctx.scene.children.filter((c) => !beforeBuild.has(c)) : [];
    sceneRegistry.register({
      path: newPath,
      rtype: ctx.getCurrentRtype?.() ?? "",
      roots: added,
      built: next,
      boneMaps: next.boneMaps ?? null,
      menuItems: next.menuItems ?? null,
      onBonePick: next.onBonePick ?? null,
    });
  } else {
    sceneRegistry.register({ path: newPath, rtype: "", roots: [], built: next });
  }

  // 5) 同步相机状态到新内容层取景 + 重挂适配器控件/侧栏
  if (ctx.renderer && ctx.orbitTarget && ctx.controls && ctx.camera) {
    ctx.orbitTarget.copy(ctx.controls.target);
  }
  ctx.setPerFrame(next.update ?? null);
  syncLightTargetFromContent(ctx.scene, ctx.getSceneBaseline(), ctx.lightCap);
  // 切换模型后 shadow mesh casts 同步（本次 beforeBuild 差量 = 新模型根节点）
  if (ctx.shadowCap && beforeBuild) {
    const added = ctx.scene ? ctx.scene.children.filter((c) => !beforeBuild.has(c)) : [];
    ctx.shadowCap.applyMeshCasts(added);
  }
  // 切换模型后 envMapIntensity 同步
  if (ctx.environmentCap && beforeBuild) {
    const added = ctx.scene ? ctx.scene.children.filter((c) => !beforeBuild.has(c)) : [];
    ctx.environmentCap.syncMeshIntensity(added);
  }
  // ADR-093 T3：同台追加后按可见注册模型根节点重算并集取景（多模型同框正确框全场景）
  if (keep && ctx.scene && ctx.camera && ctx.controls) {
    const roots = sceneRegistry.visibleRoots();
    if (roots.length) fitCameraToRoots(roots, ctx.camera, ctx.controls);
  }

  // 审核修复 #2：切换后更新 sceneBaseline，但须排除本次构建的内容层增量——
  // 若把完整 scene（含刚构建的模型）作为基线，下次切换的 stale 差量
  // （children - baseline）会把旧模型视为基线、永不移除 → 幽灵网格累积（P1）
  if (ctx.setSceneBaseline && ctx.scene) {
    const added = beforeBuild ? ctx.scene.children.filter((c) => !beforeBuild.has(c)) : [];
    const addedSet = new Set(added);
    ctx.setSceneBaseline(new Set(ctx.scene.children.filter((c) => !addedSet.has(c))));
  }

  const handle = ctx.getHandle();
  if (handle) handle.screenshot = next.screenshot;
  // 注意：适配器控件（分层切片等）通过 ctx.menu.setAdapterItems 在 build 时注入根菜单，
  // 无需额外 extraControls/extraPanel 调用（ADR-076 v2 Phase 3 收编）。
}

// ---------------------------------------------------------------------------
// 复用工具：重算内容层包围盒 → 更新 lightCap target
// （原 mount3D 主流程 + switchTo 两处重复，此处统一）
// ---------------------------------------------------------------------------

/**
 * 重算内容层包围盒，更新灯光 target（ADR-081 L1 + ADR-084 L2）。
 * @param scene         当前场景
 * @param sceneBaseline 首次 build 前的 scene 子节点快照（用于区分内容层增量）
 * @param lightCap      灯光能力（null 时跳过）
 */
export function syncLightTargetFromContent(
  scene: THREE.Scene | undefined,
  sceneBaseline: Set<THREE.Object3D> | null,
  lightCap: LightCapability | null,
): void {
  if (!lightCap || !scene || !sceneBaseline) return;
  const box = new THREE.Box3();
  let contentFound = false;
  for (const child of scene.children) {
    if (sceneBaseline.has(child)) continue;
    box.expandByObject(child);
    contentFound = true;
  }
  if (!contentFound) return;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  lightCap.setTarget(center);
  lightCap.setTargetHeight(Math.max(maxDim * 0.8, 6));
}
