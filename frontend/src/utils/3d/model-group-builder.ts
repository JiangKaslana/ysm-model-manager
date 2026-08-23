// ===== model-group-builder.ts — buildModelGroup（从 spec-builder.ts 拆出，ADR-040 P1）=====
// 单组件 spec 构建核心（Build 与 BuildMulti 共用）。
// 对齐 Go threejs/spec.go buildModelGroup（L103-390）。

import type { BedrockModel, ModelGroup, BoneData, MeshData, Vec3, Cube2D } from "./spec-builder.ts";
import { buildCubeMeshData, mergeCubes, eulerToQuaternion, isIdentityQuat, hasBoneRotation, computeBoneLocalPos } from "./cube-mesh.ts";

/** buildModelGroup 内部：骨骼首次出现信息 */
interface BoneFirst {
  pivot: Vec3;
  hasParent: boolean;
  hasRot: boolean;
}

/**
 * 同名骨骼 overwrite 决策（bug-chronicle #14）：
 * 已有骨骼无父 → 新有父则覆盖；均有父且已有无旋 → 新有旋则覆盖。
 * 收敛 first 预收集与 bones 合并两处逐字同构的公式（原 50-51 与 92-93 行）。
 */
const shouldOverwrite = (
  existingHasParent: boolean,
  existingHasRot: boolean,
  newHasParent: boolean,
  newHasRot: boolean,
): boolean =>
  (!existingHasParent && newHasParent) ||
  (existingHasParent && newHasParent && !existingHasRot && newHasRot);

/**
 * 修复断裂的父子链：沿父链向上找第一个有 pivot 且在 bones 列表中的祖先，
 * 若链断则挂到 root。从 buildModelGroup 内联段抽独立函数以降低圈复杂度。
 */
function fixOrphanBoneChain(
  bones: BoneData[],
  modelBones: BedrockModel["bones"],
  pivots: Map<string, Vec3>,
): void {
  const boneNameSet = new Set<string>();
  for (const b of bones) boneNameSet.add(b.name);
  for (let i = 0; i < bones.length; i++) {
    if (bones[i].parentId === null) continue;
    // 沿父链向上找第一个有 pivot 且在 bones 列表中的祖先
    let ancestor = bones[i].parentId!;
    const visited = new Set<string>([bones[i].name]);
    while (true) {
      const ancHasPivot = pivots.has(ancestor);
      if (boneNameSet.has(ancestor) && ancHasPivot) break;
      // 找 ancestor 的 parent
      let found = false;
      for (const b of modelBones) {
        if (b.name === ancestor && b.parent !== "" && !visited.has(b.parent)) {
          ancestor = b.parent;
          visited.add(ancestor);
          found = true;
          break;
        }
      }
      if (!found) {
        ancestor = ""; // 链断了，挂到 root
        break;
      }
    }

    const bp = pivots.get(bones[i].name);
    const ancPivot = ancestor !== "" ? pivots.get(ancestor) ?? null : null;
    if (ancestor !== "") {
      bones[i].parentId = ancestor;
      bones[i].localPosition = ancPivot && bp ? computeBoneLocalPos(bp, ancPivot) : (bp ? computeBoneLocalPos(bp, null) : [0, 0, 0]);
    } else {
      bones[i].parentId = null;
      bones[i].localPosition = bp ? computeBoneLocalPos(bp, null) : [0, 0, 0];
    }
  }
}

/**
 * 单组件 spec 构建核心。
 * 对齐 Go threejs/spec.go buildModelGroup（L103-390）。
 */
export function buildModelGroup(model: BedrockModel, compID: string, texIdxBase: number): ModelGroup {
  if (!model.bones || model.bones.length === 0) {
    return {
      id: compID,
      name: compID,
      defaultVisible: true,
      textureWidth: 0,
      textureHeight: 0,
      textureId: null,
      bones: [],
      meshGroups: [],
    };
  }
  let texW = model.texWidth;
  if (texW === 0) texW = 64;
  let texH = model.texHeight;
  if (texH === 0) texH = 64;

  // 同名骨骼 overwrite 决策预收集（bug-chronicle #14）
  const first = new Map<string, BoneFirst>();
  const pivots = new Map<string, Vec3>();
  for (const b of model.bones) {
    const np: Vec3 = { x: b.pivot[0], y: b.pivot[1], z: b.pivot[2] };
    const fi = first.get(b.name);
    if (!fi) {
      first.set(b.name, { pivot: np, hasParent: b.parent !== "", hasRot: hasBoneRotation(b.rotation) });
      pivots.set(b.name, np);
      continue;
    }
    const newHasParent = b.parent !== "";
    const newHasRot = hasBoneRotation(b.rotation);
    if (shouldOverwrite(fi.hasParent, fi.hasRot, newHasParent, newHasRot)) {
      pivots.set(b.name, np);
      first.set(b.name, { pivot: np, hasParent: newHasParent, hasRot: newHasRot });
    }
  }

  const bones: BoneData[] = [];
  const boneIdx = new Map<string, number>(); // name → index in bones[]
  const boneCubes = new Map<string, Cube2D[]>(); // name → accumulated cubes

  for (const b of model.bones) {
    const bp = pivots.get(b.name)!;

    // 骨骼 local position = (bone.pivot - parent.pivot)，X 翻转对齐 C# ConvertBones（-pivot.x）
    // ADR-052 P3: 收敛为 computeBoneLocalPos 工具函数
    const parentPivot = b.parent !== "" ? pivots.get(b.parent) ?? null : null;
    const localPos = computeBoneLocalPos(bp, parentPivot);

    let localRot: [number, number, number, number] = [0, 0, 0, 1];
    if (hasBoneRotation(b.rotation)) {
      localRot = eulerToQuaternion(-b.rotation[0], -b.rotation[1], b.rotation[2]);
    }
    const parentID: string | null = b.parent !== "" ? b.parent : null;

    // 同名骨骼：保留第一次出现的层级信息，cube 用 mergeCubes 合并
    const idx = boneIdx.get(b.name);
    if (idx !== undefined) {
      const existingHasParent = bones[idx].parentId !== null;
      const newHasParent = b.parent !== "";
      const existingHasRot = !isIdentityQuat(bones[idx].localRotation);
      const newHasRot = !isIdentityQuat(localRot);

      if (shouldOverwrite(existingHasParent, existingHasRot, newHasParent, newHasRot)) {
        bones[idx].parentId = parentID;
        bones[idx].localPosition = localPos;
        bones[idx].localRotation = localRot;
        boneCubes.set(b.name, b.cubes.slice());
      } else {
        boneCubes.set(b.name, mergeCubes(boneCubes.get(b.name) || [], b.cubes));
      }
    } else {
      boneIdx.set(b.name, bones.length);
      bones.push({
        id: b.name,
        name: b.name,
        parentId: parentID,
        localPosition: localPos,
        localRotation: localRot,
        _cubeCount: 0,
      });
      boneCubes.set(b.name, b.cubes.slice());
    }
  }

  // 第二遍：将合并后的 cube 转为 mesh 数据
  const meshes: MeshData[] = [];
  const boneDone = new Set<string>();
  for (const b of model.bones) {
    if (!boneIdx.has(b.name)) continue; // 同名骨骼已合并到第一次出现的条目中
    if (boneDone.has(b.name)) continue;
    boneDone.add(b.name);

    let bonePivot = pivots.get(b.name);
    if (!bonePivot) {
      bonePivot = { x: b.pivot[0], y: b.pivot[1], z: b.pivot[2] };
    }
    // 前端统计：该骨骼合并后的立方体数
    const idx = boneIdx.get(b.name);
    if (idx !== undefined) {
      bones[idx]._cubeCount = (boneCubes.get(b.name) || []).length;
    }
    const cubs = boneCubes.get(b.name) || [];
    for (let ci = 0; ci < cubs.length; ci++) {
      const meshData = buildCubeMeshData(cubs[ci], bonePivot, texW, texH, b.name, ci);
      if (meshData) meshes.push(meshData);
    }
  }

  // 确保所有骨骼都在 bones 列表中（包括无 cube 的中间骨骼）
  const allBoneNames = new Set<string>();
  for (const b of model.bones) {
    allBoneNames.add(b.name);
    if (b.parent !== "") allBoneNames.add(b.parent);
  }
  for (const name of allBoneNames) {
    if (!boneIdx.has(name)) {
      const bp = pivots.get(name);
      let parentName = "";
      let localPos: [number, number, number] = [0, 0, 0];
      let found = false;
      for (const b of model.bones) {
        if (b.name === name) {
          found = true;
          parentName = b.parent;
          // ADR-052 P3: 收敛为 computeBoneLocalPos 工具函数
          const parentPivot2 = b.parent !== "" ? pivots.get(b.parent) ?? null : null;
          localPos = parentPivot2 && bp ? computeBoneLocalPos(bp, parentPivot2) : (bp ? computeBoneLocalPos(bp, null) : [0, 0, 0]);
          break;
        }
      }
      if (!found) {
        if (!bp) {
          console.warn("[spec-builder] 骨骼 " + name + " 无 pivot（纯 parent 引用）");
        }
        // 挂到 root，用世界坐标（ADR-052 P3: 收敛为 computeBoneLocalPos）
        localPos = bp ? computeBoneLocalPos(bp, null) : [0, 0, 0];
        parentName = "";
      }
      const parentID: string | null = parentName !== "" ? parentName : null;
      boneIdx.set(name, bones.length);
      bones.push({
        id: name,
        name: name,
        parentId: parentID,
        localPosition: localPos,
        localRotation: [0, 0, 0, 1],
        _cubeCount: 0,
      });
    }
  }

  // 后处理：修复断裂的父子链（抽为独立函数 fixOrphanBoneChain）
  fixOrphanBoneChain(bones, model.bones, pivots);

  // 后处理：将 RightArm/LeftArm 挂到 Arm 下面
  for (let i = 0; i < bones.length; i++) {
    if (bones[i].name === "RightArm" && bones[i].parentId === null) {
      for (let j = 0; j < bones.length; j++) {
        if (bones[j].name === "Arm" && bones[j].parentId !== null) {
          const raPivot = pivots.get("RightArm")!;
          const armPivot = pivots.get("Arm")!;
          bones[i].parentId = bones[j].name;
          bones[i].localPosition = computeBoneLocalPos(raPivot, armPivot);
          break;
        }
      }
    }
    if (bones[i].name === "LeftArm" && bones[i].parentId === null) {
      for (let j = 0; j < bones.length; j++) {
        if (bones[j].name === "Arm" && bones[j].parentId !== null) {
          const laPivot = pivots.get("LeftArm")!;
          const armPivot = pivots.get("Arm")!;
          bones[i].parentId = bones[j].name;
          bones[i].localPosition = computeBoneLocalPos(laPivot, armPivot);
          break;
        }
      }
    }
  }

  // Texture ID
  let texID: string | null = null;
  const hasTextures = false; // parseBedrockGeometry 不产出 Textures/Texture
  if (hasTextures) {
    texID = "tex_" + texIdxBase;
  }

  // Name 用组件源模型文件名（main/arm/arrow，UI 组件选择器显示），空则回退 compID
  const compName = model.sourceName || compID;
  // 组件可见性分类：仅 main（角色主体）默认可见；
  // arm/载具/投射物等辅助组件默认隐藏，由动画控制器按游戏状态点亮。
  // 多组件模型（如 wine_fox 的 player+foxcar）若全部点亮，
  // 载具 bounding box 会撑大整体剔除范围 → 视锥边界抖动 → 角色闪烁。
  return {
    id: compID,
    name: compName,
    defaultVisible: isDefaultVisibleComponent(compName),
    textureWidth: texW,
    textureHeight: texH,
    textureId: texID,
    bones,
    meshGroups: meshes,
  };
}

/** 组件默认可见性判定：仅 main（角色主体）默认可见；其余辅助组件默认隐藏 */
function isDefaultVisibleComponent(compName: string): boolean {
  let base = compName.toLowerCase();
  base = base.replace(/\.geo$/, "");
  return base === "main";
}
