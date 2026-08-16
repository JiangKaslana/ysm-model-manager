// ===== 3D 模型类型定义 + 键位/相机偏好 re-export =====
// ADR-052 P2 收尾：render-session.ts 470 行生产无调用方，已删除；
// renderModel3D / RenderSession 类型别名 / THREE import 均随 render-session 一并移除。
// 本文件保留：
//   - Spec 结构（Go 返回的 models 结构）—— 活跃类型枢纽
//   - 键位/相机偏好 re-export（keymap.ts 的对外统一出口）

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

// ADR-052 P3 落地：截图功能通用化至 screenshot.ts 纯函数 + 适配器 screenshot() 能力；
// 本文件不再持有截图相关符号。