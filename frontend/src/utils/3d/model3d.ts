// ===== 3D 模型渲染器（类型化版 — ADR-014 P2 大件收尾，ADR-040 P1 增量拆分，ADR-052 对象化）=====
import * as THREE from "three";
import { RenderSession, type RenderSessionHandle } from "./render-session.ts"; // ADR-052：RenderSession 对象化
import { buildSceneMesh, disposeMaterial, compKey } from "./mesh.ts"; // 网格构建/材质释放（兼容层）
import { loadTdKeymap, loadTdCamSpeed, loadTdRotMode, type TdKeyAction, DEFAULT_TD_KEYMAP } from "./keymap.ts"; // 键位/相机偏好（已拆）
import { rebuildDebug } from "./debug-render.ts"; // debug 叠加层（已拆）
import { registerFreeCameraDrag } from "./camera-control.ts"; // free 相机 pointer drag（已拆）
import { buildBoneHierarchy, registerBoneRaycast } from "./bone-raycast.ts"; // 骨骼拾取（已拆）
import { disposeDebugGroup, disposeSceneMeshes, safeDisposeRenderer } from "./cleanup-helper.ts"; // 资源清理（已拆）
import { startRenderLoop } from "./render-loop.ts"; // 主渲染循环（已拆）
import { fitCameraToScene } from "./camera-setup.ts"; // 相机初始化（已拆）
import { getBoneList } from "./bone-list.ts"; // 骨骼列表（已拆）
import { setBoneVisible as _setBoneVisible, toggleBone as _toggleBone, showModelGroup as _showModelGroup } from "./bone-visibility.ts"; // 骨骼可见性（已拆）
import { resetRendererState, detachRendererCanvas } from "./session-state.ts"; // 会话状态重置（已拆）
import { setupRenderer } from "./renderer-setup.ts"; // renderer 场景初始化（已拆）
import { addMeshToBoneGroup } from "./mesh-builder.ts"; // 单个网格构建（已拆）
// ── Spec 结构（Go 返回的 models 结构）────────────────

export interface SpecBone3D {
  id: string;
  name: string;
  parentId?: string;
  localPosition: number[];
  localRotation: number[];
}

export interface SpecMeshGroup3D {
  id?: string;
  boneId: string;
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
  texIdx?: number;
  localPosition?: number[];
  localRotation?: number[];
}

export interface SpecModelGroup3D {
  id?: string;
  name?: string;
  defaultVisible?: boolean;
  bones?: SpecBone3D[];
  meshGroups?: SpecMeshGroup3D[];
}

export interface Spec3D {
  models?: SpecModelGroup3D[];
}

/** 骨骼选中信息（window._3dOnBoneSelect 回调参数） */
export interface BoneSelectInfo {
  name: string;
  path: string;
  parent: string | null;
  children: string[];
  meshCount: number;
  localPos: number[];
  worldPos: number[];
  localRot: number[] | null;
  cubeRot: number[] | null;
  cubePos: number[] | null;
}

// ── 魔法数值提取为常量（治理红线 R2：可维护性）──────────
/** free 模式下 controls.target 跟随相机前方距离（ysmview 口径） */
const FREE_CAM_TARGET_DIST = 10;
/** resetCamera 时相机速度重置值 */
const RESET_CAM_SPEED = 20;
/** fullscreenchange 防抖延迟（ms） */
const FS_RESIZE_DEBOUNCE_MS = 50;

/** renderModel3D 返回的渲染句柄（兼容层，实际由 RenderSession 提供）*/
export type RenderModel3DHandle = RenderSessionHandle;

// P1 修复（ADR-040）：键位/相机偏好已拆至 keymap.ts，此处 re-export 兼容
export type { TdKeyAction } from "./keymap.ts";
export { DEFAULT_TD_KEYMAP, loadTdKeymap, loadTdCamSpeed, loadTdRotMode } from "./keymap.ts";

// ADR-052：RenderSession 对象化 —— renderModel3D 现为薄壳，实际逻辑在 render-session.ts
/** 渲染 3D 模型到容器，返回控制句柄 */
export async function renderModel3D(
  container: HTMLElement,
  texArr: (THREE.Texture | null)[],
  spec: Spec3D,
  texIdx = 0,
): Promise<RenderModel3DHandle> {
  const session = new RenderSession(container, texArr, spec, texIdx);
  return session;
}

/** 截取当前 3D 预览画面（PNG base64，无 data: 前缀），无渲染器时返回 null */
// TODO(ADR-052 P2): 截图功能需适配 RenderSession 多实例（目前返回 null 占位）
export function screenshotPreview(): string | null {
  return null;
}

/** 带 map 纹理的材质接口（MeshStandardMaterial/MeshPhongMaterial 等共有） */
// （已迁至 ./mesh.ts，disposeMaterial 随迁）

/** 释放材质及其 map 纹理。 */
// （已迁至 ./mesh.ts，model3d.ts 经 import 复用）
