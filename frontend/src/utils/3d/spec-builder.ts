// spec-builder.ts — Go 端 Build3DSpecFromGeometryJSON 纯 TS 移植（ADR-049 P2-2）。
//
// 契约与 Go binding 完全一致：入参 bedrock geometry JSON 串，返回 spec JSON 串；
// 空串/解析失败/无 bones → 返回 "{}"。内部 = parseBedrockGeometry + BuildMulti 单组件。
//
// 源文件（只读参考）：
// - internal/app/app_model.go Build3DSpecFromGeometryJSON（L154-172）
// - go/geometry/parse.go ParseBedrockGeometry
// - go/threejs/spec.go 全量算法
// - go/types/bedrock.go 结构定义

// P1 修复（ADR-040）：立方体几何/UV/旋转工具已拆至 cube-mesh.ts，此处 re-export 兼容
export { buildCubeMeshData, mergeCubes, parseUV, eulerToQuaternion, isIdentityQuat, hasBoneRotation } from "./cube-mesh.ts";
import { buildCubeMeshData, mergeCubes, parseUV, eulerToQuaternion, isIdentityQuat, hasBoneRotation } from "./cube-mesh.ts";

// ===== 常量（对齐 Go spec.go / parse.go）=====

/** 零厚度面修正值（避免 Three.js 渲染零面积面）— thicknessEpsilon */
const THICKNESS_EPSILON = 0.001;

/** 同名骨骼 cube 合并的浮点 epsilon — cubeEpsilon */
const CUBE_EPSILON = 0.001;

/** parseBedrockGeometry 接受的最大输入大小 — maxParseSize */
const MAX_PARSE_SIZE = 100 << 20; // 100MB

// ===== 内部数据结构（对齐 Go types/bedrock.go + threejs/spec.go）=====

/** vec3 — Go threejs/spec.go L55 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Cube2D — Go types/bedrock.go Cube2D */
export interface Cube2D {
  origin: [number, number, number];
  size: [number, number, number];
  pivot: [number, number, number];
  pivotSet: boolean; // pivot 是否显式声明（区分"缺席"与显式 [0,0,0]）
  uv: [number, number];
  faceUV: string; // 每面独立 UV（JSON 字符串）
  rotation: [number, number, number];
  texSlot: number; // 纹理槽（从 cube.texture 解析）
  inflate: number;
  mirror: boolean;
  cubeTexW: number; // 来源文件 texture_width，不序列化
  cubeTexH: number; // 来源文件 texture_height，不序列化
}

/** Bone2D — Go types/bedrock.go Bone2D */
interface Bone2D {
  name: string;
  parent: string;
  pivot: [number, number, number];
  rotation: [number, number, number];
  cubes: Cube2D[];
  groupId: string;
}

/** BedrockModel — Go types/bedrock.go BedrockModel */
interface BedrockModel {
  boneCount: number;
  cubeCount: number;
  texWidth: number;
  texHeight: number;
  sourceName: string;
  format: string;
  bones: Bone2D[];
}

/** Model3DSpec — Go threejs/spec.go Model3DSpec */
interface Model3DSpec {
  models: ModelGroup[];
}

/** ModelGroup — Go threejs/spec.go ModelGroup */
interface ModelGroup {
  id: string;
  name: string;
  defaultVisible: boolean;
  textureWidth: number;
  textureHeight: number;
  textureId: string | null;
  bones: BoneData[];
  meshGroups: MeshData[];
}

/** BoneData — Go threejs/spec.go BoneData */
interface BoneData {
  id: string;
  name: string;
  parentId: string | null;
  localPosition: [number, number, number];
  localRotation: [number, number, number, number]; // quaternion [x,y,z,w]
  _cubeCount: number;
}

/** MeshData — Go threejs/spec.go MeshData */
export interface MeshData {
  id: string;
  boneId: string;
  localPosition: [number, number, number];
  localRotation: [number, number, number, number]; // quaternion [x,y,z,w]
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
  texIdx: number;
}

// ===== 入口：Build3DSpecFromGeometryJSON =====

/**
 * 从 bedrock geometry JSON 构建 3D spec（纯 TS，无 Go 依赖）。
 * 契约与 Go binding 完全一致：入参 geometry JSON 串，返回 spec JSON 串；
 * 空串/解析失败/无 bones → "{}"。
 */
export function buildSpecFromGeometryJSON(geometryJSON: string): string {
  if (!geometryJSON) {
    return "{}";
  }
  const model = parseBedrockGeometry(geometryJSON);
  if (!model || model.bones.length === 0) {
    return "{}";
  }
  const spec = buildMulti([model], null);
  if (!spec || spec === "{}") {
    return "{}";
  }
  return spec;
}

// ===== parseBedrockGeometry — Go geometry/parse.go =====

/**
 * 解析标准 Bedrock geometry JSON（minecraft:geometry 格式）。
 * 对齐 Go geometry/parse.go ParseBedrockGeometry。
 */
function parseBedrockGeometry(data: string): BedrockModel | null {
  if (data.length > MAX_PARSE_SIZE) {
    console.warn("[spec-builder] ParseBedrockGeometry 输入过大: " + data.length + " bytes");
    return null;
  }
  let raw: RawGeometryJSON;
  try {
    raw = JSON.parse(data) as RawGeometryJSON;
  } catch {
    return null;
  }
  if (!raw || !raw["minecraft:geometry"] || raw["minecraft:geometry"].length === 0) {
    return null;
  }
  const g = raw["minecraft:geometry"][0];
  const desc = g.description;
  // P2 修复：texture_width/height 钳到 [0, 65536]（越界置 0）
  let texW = clampToInt(desc.texture_width);
  let texH = clampToInt(desc.texture_height);
  if (texW < 0 || texW > 65536) texW = 0;
  if (texH < 0 || texH > 65536) texH = 0;

  const model: BedrockModel = {
    boneCount: 0,
    cubeCount: 0,
    texWidth: texW,
    texHeight: texH,
    sourceName: "",
    format: raw.format_version || "",
    bones: [],
  };

  let cubeTotal = 0;
  for (const b of g.bones) {
    // P2-6 修复：畸形输入防护——骨骼缺失/无 cubes 数组时返回 null（契约外输入不抛 TypeError）
    if (!b || !Array.isArray(b.cubes)) return null;
    const cubes: Cube2D[] = [];
    for (const c of b.cubes) {
      // P2-6 修复：cube 缺 origin/size 数组时返回 null（契约外输入不抛 TypeError）
      if (!Array.isArray(c.origin) || !Array.isArray(c.size)) return null;
      let uv: [number, number] = [0, 0];
      let faceUV = "";
      let rot: [number, number, number] = [0, 0, 0];
      if (c.uv !== undefined && c.uv !== null) {
        // raw 判断：'{' 开头 → FaceUV 字符串，否则 [2]float64
        if (typeof c.uv === "string") {
          if (c.uv.length > 0 && c.uv[0] === "{") {
            faceUV = c.uv;
          }
          // 空字符串或非 '{' 开头：uv 保持 [0,0]
        } else if (Array.isArray(c.uv)) {
          // [2]float64
          uv = [c.uv[0] ?? 0, c.uv[1] ?? 0];
        }
      }
      if (c.rotation !== undefined && c.rotation !== null) {
        if (Array.isArray(c.rotation)) {
          rot = [c.rotation[0] ?? 0, c.rotation[1] ?? 0, c.rotation[2] ?? 0];
        }
      }
      cubes.push({
        origin: [c.origin[0], c.origin[1], c.origin[2]],
        size: [c.size[0], c.size[1], c.size[2]],
        pivot: pivotOf(c.pivot),
        pivotSet: c.pivot !== undefined && c.pivot !== null,
        uv,
        faceUV,
        rotation: rot,
        texSlot: c.texture ?? 0, // 对齐 Go `Texture int` 缺省 0（未声明 texture 不丢 texIdx 键）
        inflate: c.inflate ?? 0,
        mirror: c.mirror ?? false,
        cubeTexW: 0,
        cubeTexH: 0,
      });
    }
    let boneRot: [number, number, number] = [0, 0, 0];
    if (b.rotation !== undefined && b.rotation !== null) {
      if (Array.isArray(b.rotation)) {
        boneRot = [b.rotation[0] ?? 0, b.rotation[1] ?? 0, b.rotation[2] ?? 0];
      }
    }
    model.bones.push({
      name: b.name,
      parent: b.parent || "",
      pivot: b.pivot || [0, 0, 0],
      rotation: boneRot,
      cubes,
      groupId: "",
    });
    cubeTotal += cubes.length;
  }
  model.boneCount = g.bones.length;
  model.cubeCount = cubeTotal;
  return model;
}

/** pivotOf — 解引用 cube 的 pivot；JSON 缺席（undefined）→ 零值 [0,0,0] */
function pivotOf(p: [number, number, number] | undefined): [number, number, number] {
  if (!p) return [0, 0, 0];
  return [p[0], p[1], p[2]];
}

/** clampToInt — 把任意 JSON number 安全截断为 int（NaN/Inf→0） */
function clampToInt(v: number | undefined): number {
  if (v === undefined || v === null) return 0;
  if (Number.isNaN(v) || !Number.isFinite(v)) return 0;
  return Math.trunc(v);
}

// ===== buildMulti — Go threejs/spec.go BuildMulti =====

/**
 * 多组件 spec：每个组件独立构建为 spec.models 元素。
 * 对齐 Go threejs/spec.go BuildMulti（L74-99）。
 */
function buildMulti(models: BedrockModel[], texIdxBase: number[] | null): string {
  if (!models || models.length === 0) {
    return "{}";
  }
  const groups: ModelGroup[] = [];
  for (let i = 0; i < models.length; i++) {
    const m = models[i];
    if (!m.bones || m.bones.length === 0) {
      continue;
    }
    let base = i;
    if (texIdxBase && i < texIdxBase.length) {
      base = texIdxBase[i];
    }
    const mg = buildModelGroup(m, "comp_" + i, base);
    groups.push(mg);
  }
  if (groups.length === 0) {
    return "{}";
  }
  const spec: Model3DSpec = { models: groups };
  return JSON.stringify(spec);
}

// ===== buildModelGroup — Go threejs/spec.go buildModelGroup（L103-390）=====

/**
 * 单组件 spec 构建核心（Build 与 BuildMulti 共用）。
 * 对齐 Go threejs/spec.go buildModelGroup（L103-390）。
 */
function buildModelGroup(model: BedrockModel, compID: string, texIdxBase: number): ModelGroup {
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
  interface BoneFirst {
    pivot: Vec3;
    hasParent: boolean;
    hasRot: boolean;
  }
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
  // 注意：Go 源此处用 len(model.Textures) > 0 || model.Texture != ""
  // 但 BedrockModel 接口未定义 Textures/Texture 字段（parse.go 不产出）
  // 实际 Go binding 路径 model.Texture 由上游 AnalyzeBedrockModel 注入，
  // parseBedrockGeometry 产出时 Texture="" → texID 保持 nil
  // 保留条件以对齐 Go 源逻辑结构
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

// ===== Raw geometry JSON 类型（parseBedrockGeometry 用）=====

interface RawGeometryJSON {
  format_version?: string;
  "minecraft:geometry"?: {
    description: {
      identifier?: string;
      texture_width?: number;
      texture_height?: number;
    };
    bones: {
      name: string;
      parent?: string;
      pivot?: [number, number, number];
      rotation?: [number, number, number] | null;
      cubes: {
        origin: [number, number, number];
        size: [number, number, number];
        pivot?: [number, number, number];
        uv?: [number, number] | string | null;
        rotation?: [number, number, number] | null;
        texture: number;
        inflate?: number;
        mirror?: boolean;
      }[];
    }[];
  }[];
}
