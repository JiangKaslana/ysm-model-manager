// ===== 3D 模型类型定义 + 键位/相机偏好 re-export =====
// 原 470 行 renderModel3D 闭包逻辑已抽至 render-session.ts（ADR-052 对象化）；
// ADR-052 P2 收尾：render-session.ts 生产无调用方，归入死代码清理。
// 本文件保留：
//   - Spec 结构（Go 返回的 models 结构）—— 活跃类型枢纽
//   - 键位/相机偏好 re-export（keymap.ts 的对外统一出口）
//   - screenshotPreview 兼容层（ADR-052 P3 待实现，skeleton-render.ts 仍引用）

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

// P1 修复（ADR-040）：键位/相机偏好 re-export 兼容
export type { TdKeyAction } from "./keymap.ts";
export { DEFAULT_TD_KEYMAP, loadTdKeymap, loadTdCamSpeed, loadTdRotMode } from "./keymap.ts";

/** 截取当前 3D 预览画面（PNG base64，无 data: 前缀），无渲染器时返回 null */
// ADR-052 P3: 截图功能待实现（需显式传入 RenderSession 实例或提供全局截图方案）
// 注意：当前为历史兼容层占位，skeleton-render.ts saveScreenshot 仍引用此函数
export function screenshotPreview(): string | null {
  return null;
}