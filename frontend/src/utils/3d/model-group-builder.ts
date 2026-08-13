// ===== model-group-builder.ts — buildModelGroup（从 spec-builder.ts 拆出，ADR-040 P1）=====
// 单组件 spec 构建核心（Build 与 BuildMulti 共用）。
// 对齐 Go threejs/spec.go buildModelGroup（L103-390）。

import type { BedrockModel, ModelGroup, BoneData, MeshData, Vec3, Cube2D } from "./spec-builder.ts";
import { buildCubeMeshData, mergeCubes, eulerToQuaternion, isIdentityQuat, hasBoneRotation } from "./cube-mesh.ts";

/** buildModelGroup 内部：骨骼首次出现信息 */
interface BoneFirst {
  pivot: Vec3;
  hasParent: boolean;
  hasRot: boolean;
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
    const overwrite = (!fi.hasParent && newHasParent) ||
      (fi.hasParent && newHasParent && !fi.hasRot && newHasRot);
    if (overwrite) {
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
    let localPos: [number, number, number];
    if (b.parent !== "") {
      const pp = pivots.get(b.parent);
      if (pp) {
        localPos = [pp.x - bp.x, bp.y - pp.y, bp.z - pp.z];
      } else {
        localPos = [-bp.x, bp.y, bp.z];
      }
    } else {
      localPos = [-bp.x, bp.y, bp.z];
    }

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

      const overwrite = (!existingHasParent && newHasParent) ||
        (existingHasParent && newHasParent && !existingHasRot && newHasRot);
      if (overwrite) {
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
          if (b.parent !== "") {
            const pp = pivots.get(b.parent);
            if (pp && bp) {
              localPos = [pp.x - bp.x, bp.y - pp.y, bp.z - pp.z];
            } else if (bp) {
              localPos = [-bp.x, bp.y, bp.z];
            } else {
              localPos = [0, 0, 0];
            }
          } else if (bp) {
            localPos = [-bp.x, bp.y, bp.z];
          } else {
            localPos = [0, 0, 0];
          }
          break;
        }
      }
      if (!found) {
        if (!bp) {
          console.warn("[spec-builder] 骨骼 " + name + " 无 pivot（纯 parent 引用）");
        }
        // 挂到 root，用世界坐标
        if (bp) {
          localPos = [-bp.x, bp.y, bp.z];
        } else {
          localPos = [0, 0, 0];
        }
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

  // 后处理：修复断裂的父子链
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
      for (const b of model.bones) {
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
    if (ancestor !== "") {
      const ancPivot = pivots.get(ancestor)!;
      bones[i].parentId = ancestor;
      if (bp) {
        bones[i].localPosition = [ancPivot.x - bp.x, bp.y - ancPivot.y, bp.z - ancPivot.z];
      }
    } else {
      bones[i].parentId = null;
      if (bp) {
        bones[i].localPosition = [-bp.x, bp.y, bp.z];
      }
    }
  }

  // 后处理：将 RightArm/LeftArm 挂到 Arm 下面
  for (let i = 0; i < bones.length; i++) {
    if (bones[i].name === "RightArm" && bones[i].parentId === null) {
      for (let j = 0; j < bones.length; j++) {
        if (bones[j].name === "Arm" && bones[j].parentId !== null) {
          const raPivot = pivots.get("RightArm")!;
          const armPivot = pivots.get("Arm")!;
          bones[i].parentId = bones[j].name;
          bones[i].localPosition = [armPivot.x - raPivot.x, raPivot.y - armPivot.y, raPivot.z - armPivot.z];
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
          bones[i].localPosition = [armPivot.x - laPivot.x, laPivot.y - armPivot.y, laPivot.z - armPivot.z];
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
  return {
    id: compID,
    name: compName,
    defaultVisible: true,
    textureWidth: texW,
    textureHeight: texH,
    textureId: texID,
    bones,
    meshGroups: meshes,
  };
}
