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

// ===== 常量（对齐 Go spec.go / parse.go）=====

/** 零厚度面修正值（避免 Three.js 渲染零面积面）— thicknessEpsilon */
const THICKNESS_EPSILON = 0.001;

/** 同名骨骼 cube 合并的浮点 epsilon — cubeEpsilon */
const CUBE_EPSILON = 0.001;

/** parseBedrockGeometry 接受的最大输入大小 — maxParseSize */
const MAX_PARSE_SIZE = 100 << 20; // 100MB

// ===== 内部数据结构（对齐 Go types/bedrock.go + threejs/spec.go）=====

/** vec3 — Go threejs/spec.go L55 */
interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Cube2D — Go types/bedrock.go Cube2D */
interface Cube2D {
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
interface MeshData {
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

// ===== buildCubeMeshData — Go threejs/spec.go buildCubeMeshData（L397-586）=====

/**
 * 立方体几何构建。
 * 对齐 Go threejs/spec.go buildCubeMeshData（L397-586）。
 */
function buildCubeMeshData(
  c: Cube2D,
  bonePivot: Vec3,
  texW: number,
  texH: number,
  boneID: string,
  cubeIdx: number,
): MeshData | null {
  // P2 修复：入口有限性检查
  const finCheckVals = [
    c.origin[0], c.origin[1], c.origin[2],
    c.size[0], c.size[1], c.size[2],
    c.pivot[0], c.pivot[1], c.pivot[2],
    c.inflate,
  ];
  for (const v of finCheckVals) {
    if (Number.isNaN(v) || !Number.isFinite(v)) {
      console.warn("[spec-builder] 跳过非法 cube（非有限数值）bone=" + boneID + " cube=" + cubeIdx + " val=" + v);
      return null;
    }
  }

  let ox = c.origin[0];
  let oy = c.origin[1];
  let oz = c.origin[2];
  let sx = c.size[0];
  let sy = c.size[1];
  let sz = c.size[2];

  // Blockbench inflate（像素单位）：origin 各轴 -i、size 各轴 +2i
  if (c.inflate !== 0) {
    ox -= c.inflate;
    oy -= c.inflate;
    oz -= c.inflate;
    sx += 2 * c.inflate;
    sy += 2 * c.inflate;
    sz += 2 * c.inflate;
  }
  // P1 修复：inflate 运算后复查有限性
  if (
    Number.isNaN(ox) || !Number.isFinite(ox) ||
    Number.isNaN(oy) || !Number.isFinite(oy) ||
    Number.isNaN(oz) || !Number.isFinite(oz) ||
    Number.isNaN(sx) || !Number.isFinite(sx) ||
    Number.isNaN(sy) || !Number.isFinite(sy) ||
    Number.isNaN(sz) || !Number.isFinite(sz)
  ) {
    console.warn("[spec-builder] 跳过非法 cube（inflate 运算溢出）bone=" + boneID + " cube=" + cubeIdx);
    return null;
  }
  // P3 修复：负 size 统一 clamp 到 ≥ thicknessEpsilon
  if (sx < THICKNESS_EPSILON) sx = THICKNESS_EPSILON;
  if (sy < THICKNESS_EPSILON) sy = THICKNESS_EPSILON;
  if (sz < THICKNESS_EPSILON) sz = THICKNESS_EPSILON;

  let cp: [number, number, number] = [c.pivot[0], c.pivot[1], c.pivot[2]];
  // cube 未显式 pivot → 用 cube 中心作为旋转中心
  if (!c.pivotSet) {
    cp = [ox + sx * 0.5, oy + sy * 0.5, oz + sz * 0.5];
  }
  // 优先用 cube 自身 tex 维度
  if (c.cubeTexW > 0) texW = c.cubeTexW;
  if (c.cubeTexH > 0) texH = c.cubeTexH;

  // 最小/最大顶点（不取反）
  const fx = ox, fy = oy, fz = oz;
  const tx = ox + sx, ty = fy + sy, tz = fz + sz;

  // P2 修复：派生运算复查
  if (
    Number.isNaN(tx) || !Number.isFinite(tx) ||
    Number.isNaN(ty) || !Number.isFinite(ty) ||
    Number.isNaN(tz) || !Number.isFinite(tz)
  ) {
    console.warn("[spec-builder] 跳过非法 cube（顶点派生溢出）bone=" + boneID + " cube=" + cubeIdx);
    return null;
  }

  const cx = (fx + tx) * 0.5;
  const cy = (fy + ty) * 0.5;
  const cz = (fz + tz) * 0.5;

  const hx2 = (tx - fx) * 0.5;
  const hy2 = (ty - fy) * 0.5;
  const hz2 = (tz - fz) * 0.5;

  // 顶点相对 cube pivot（旋转中心），mesh 位置 = bonePivot - cubePivot（X 翻转对齐 C#）
  let lx = cx - hx2 - cp[0];
  let ly = cy - hy2 - cp[1];
  let lz = cz - hz2 - cp[2];
  let hx = cx + hx2 - cp[0];
  let hy = cy + hy2 - cp[1];
  let hz = cz + hz2 - cp[2];

  // 避免零厚度面
  if (lx === hx) hx += THICKNESS_EPSILON;
  if (ly === hy) hy += THICKNESS_EPSILON;
  if (lz === hz) hz += THICKNESS_EPSILON;

  // 解析 UV：box UV 展开必须基于**未膨胀**的原始尺寸（c.Size）
  let faceUVs: [number, number, number, number, number, number, number, number][] = [
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0],
  ];
  const hasUV = parseUV(c, faceUVs, c.size[0], c.size[1], c.size[2], texW, texH);
  // Blockbench mirror：UV 水平翻转（u 方向交换）
  if (c.mirror) {
    for (let fi = 0; fi < 6; fi++) {
      const tmp0 = faceUVs[fi][0];
      faceUVs[fi][0] = faceUVs[fi][2];
      faceUVs[fi][2] = tmp0;
      const tmp4 = faceUVs[fi][4];
      faceUVs[fi][4] = faceUVs[fi][6];
      faceUVs[fi][6] = tmp4;
    }
  }

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // 6 个面: East, West, Up, Down, South, North
  // faceDefs 顶点/normal 精确数值照抄 Go spec.go L538-549
  const faceDefs: { v: number[]; n: number[]; f: number }[] = [
    { v: [hx, hy, hz, hx, hy, lz, hx, ly, hz, hx, ly, lz], n: [1, 0, 0], f: 0 },   // East
    { v: [lx, hy, lz, lx, hy, hz, lx, ly, lz, lx, ly, hz], n: [-1, 0, 0], f: 1 },  // West
    { v: [lx, hy, lz, hx, hy, lz, lx, hy, hz, hx, hy, hz], n: [0, 1, 0], f: 2 },   // Up
    { v: [lx, ly, hz, hx, ly, hz, lx, ly, lz, hx, ly, lz], n: [0, -1, 0], f: 3 },  // Down
    { v: [lx, hy, hz, hx, hy, hz, lx, ly, hz, hx, ly, hz], n: [0, 0, 1], f: 4 },   // South
    { v: [hx, hy, lz, lx, hy, lz, hx, ly, lz, lx, ly, lz], n: [0, 0, -1], f: 5 },   // North
  ];

  for (const fd of faceDefs) {
    const bi = positions.length / 3;
    for (let k = 0; k < fd.v.length; k++) positions.push(fd.v[k]);
    for (let r = 0; r < 4; r++) {
      normals.push(fd.n[0], fd.n[1], fd.n[2]);
    }
    if (hasUV) {
      const uv = faceUVs[fd.f];
      uvs.push(uv[0], uv[1], uv[2], uv[3], uv[4], uv[5], uv[6], uv[7]);
    } else {
      for (let r = 0; r < 8; r++) uvs.push(0);
    }
    indices.push(bi, bi + 2, bi + 1, bi + 2, bi + 3, bi + 1);
  }

  // Mesh local position = bonePivot - cubePivot（X 翻转对齐 C# ConvertBones；顶点已相对 cubePivot）
  const meshID = boneID + "_" + cubeIdx;
  const localPos: [number, number, number] = [bonePivot.x - cp[0], cp[1] - bonePivot.y, cp[2] - bonePivot.z];

  // Cube rotation → quaternion (CreateBlockbenchQuaternion)
  const localRot = eulerToQuaternion(-c.rotation[0], -c.rotation[1], c.rotation[2]);

  return {
    id: meshID,
    boneId: boneID,
    localPosition: localPos,
    localRotation: localRot,
    positions,
    normals,
    uvs,
    indices,
    texIdx: c.texSlot,
  };
}

// ===== mergeCubes — Go threejs/spec.go mergeCubes（L593-614）=====

/**
 * 合并两组 cube：新 cube 中与旧 cube 空间重叠的替换之，不重叠的追加。
 * 对齐 Go threejs/spec.go mergeCubes（L593-614）。
 */
function mergeCubes(oldCubes: Cube2D[], newCubes: Cube2D[]): Cube2D[] {
  const result: Cube2D[] = oldCubes.slice();
  const matched: boolean[] = new Array(oldCubes.length).fill(false);

  for (const nc of newCubes) {
    let found = -1;
    for (let i = 0; i < oldCubes.length; i++) {
      if (!matched[i] && cubesOverlap(oldCubes[i], nc)) {
        found = i;
        break;
      }
    }
    if (found >= 0) {
      result[found] = nc;
      matched[found] = true;
    } else {
      result.push(nc);
    }
  }
  return result;
}

// ===== cubesOverlap — Go threejs/spec.go cubesOverlap（L617-621）=====

/**
 * 判断两个 cube 是否在空间上重叠（origin + size + rotation 均相等）。
 * 对齐 Go threejs/spec.go cubesOverlap（L617-621）。
 */
function cubesOverlap(a: Cube2D, b: Cube2D): boolean {
  return floatEqual(a.origin, b.origin, CUBE_EPSILON) &&
    floatEqual(a.size, b.size, CUBE_EPSILON) &&
    floatEqual(a.rotation, b.rotation, CUBE_EPSILON);
}

// ===== floatEqual — Go threejs/spec.go floatEqual（L623-634）=====

/**
 * 三轴浮点近似相等（eps 容差）。
 * 对齐 Go threejs/spec.go floatEqual（L623-634）。
 */
function floatEqual(a: [number, number, number], b: [number, number, number], eps: number): boolean {
  for (let i = 0; i < 3; i++) {
    let v = a[i] - b[i];
    if (v < 0) v = -v;
    if (v > eps) return false;
  }
  return true;
}

// ===== parseUV — Go threejs/spec.go parseUV（L639-656）=====

/**
 * 解析 UV：faceUV 优先、失败回退 expandBoxUV、c.UV 回退。
 * 对齐 Go threejs/spec.go parseUV（L639-656）。
 */
function parseUV(
  c: Cube2D,
  faces: [number, number, number, number, number, number, number, number][],
  sx: number,
  sy: number,
  sz: number,
  texW: number,
  texH: number,
): boolean {
  if (c.faceUV !== "") {
    if (parseFaceUV(c.faceUV, faces, texW, texH)) {
      return true;
    }
    // P3 修复：parseFaceUV 失败，若 c.UV 存在则回退 expandBoxUV
    if (c.uv.length >= 2) {
      return expandBoxUV(c.uv, sx, sy, sz, texW, texH, faces);
    }
    return false;
  }
  if (c.uv.length >= 2) {
    return expandBoxUV(c.uv, sx, sy, sz, texW, texH, faces);
  }
  return false;
}

// ===== expandBoxUV — Go threejs/spec.go expandBoxUV（L659-703）=====

/**
 * box UV 展开。对齐 Go threejs/spec.go expandBoxUV（L659-703）。
 * face order: east(0), west(1), up(2), down(3), south(4), north(5)
 */
function expandBoxUV(
  uv: [number, number],
  sx: number,
  sy: number,
  sz: number,
  texW: number,
  texH: number,
  faces: [number, number, number, number, number, number, number, number][],
): boolean {
  // P3 修复：texW/texH ≤ 0 守卫
  if (texW <= 0 || texH <= 0) return false;
  const u = uv[0];
  const v = uv[1];
  const x = sx, y = sy, z = sz;

  const uvData: { fu: number; fv: number; fw: number; fh: number; f: number }[] = [
    { fu: u, fv: v + z, fw: z, fh: y, f: 0 },             // East
    { fu: u + z + x, fv: v + z, fw: z, fh: y, f: 1 },     // West
    { fu: u + z + x, fv: v + z, fw: -x, fh: -z, f: 2 },   // Up
    { fu: u + z + x + x, fv: v, fw: -x, fh: z, f: 3 },    // Down
    { fu: u + z + z + x, fv: v + z, fw: x, fh: y, f: 4 }, // South
    { fu: u + z, fv: v + z, fw: x, fh: y, f: 5 },         // North
  ];

  for (const d of uvData) {
    const u0 = d.fu / texW;
    const v0 = d.fv / texH;
    const u1 = (d.fu + d.fw) / texW;
    const v1 = (d.fv + d.fh) / texH;
    faces[d.f] = [u0, v0, u1, v0, u0, v1, u1, v1];
  }
  return true;
}

// ===== parseFaceUV — Go threejs/spec.go parseFaceUV（L706-746）=====

/**
 * 每面独立 UV。对齐 Go threejs/spec.go parseFaceUV（L706-746）。
 * face order in JSON: east, west, up, down, south, north
 */
function parseFaceUV(
  faceUVStr: string,
  faces: [number, number, number, number, number, number, number, number][],
  texW: number,
  texH: number,
): boolean {
  let faceData: Record<string, { uv: number[]; uv_size?: number[] }>;
  try {
    faceData = JSON.parse(faceUVStr) as Record<string, { uv: number[]; uv_size?: number[] }>;
  } catch {
    console.warn("[spec-builder] parseFaceUV 失败: JSON 解析错误");
    return false;
  }

  const faceNames = ["east", "west", "up", "down", "south", "north"];
  for (let fi = 0; fi < faceNames.length; fi++) {
    const fd = faceData[faceNames[fi]];
    if (!fd || !fd.uv || fd.uv.length < 2) continue;
    const fu = fd.uv[0];
    const fv = fd.uv[1];
    let fw = 0, fh = 0;
    if (fd.uv_size && fd.uv_size.length >= 2) {
      fw = fd.uv_size[0];
      fh = fd.uv_size[1];
    }
    // P3 修复：与 expandBoxUV 的守卫对齐——texW/texH ≤ 0 时除零
    if (texW <= 0 || texH <= 0) return false;

    const u0 = fu / texW;
    const v0 = fv / texH;
    const u1 = (fu + fw) / texW;
    const v1 = (fv + fh) / texH;
    faces[fi] = [u0, v0, u1, v0, u0, v1, u1, v1];
  }
  return true;
}

// ===== eulerToQuaternion — Go threejs/spec.go eulerToQuaternion（L756-812）=====

/**
 * 欧拉角（度）→ 四元数，旋转顺序: Rx * Ry * Rz (Three.js 默认)。
 * 口径：调用方传入的是已取反角度（X/Y 取反、Z 不取反）。
 * 对齐 Go threejs/spec.go eulerToQuaternion（L756-812）。
 */
function eulerToQuaternion(rxDeg: number, ryDeg: number, rzDeg: number): [number, number, number, number] {
  const rx = rxDeg * Math.PI / 180.0;
  const ry = ryDeg * Math.PI / 180.0;
  const rz = rzDeg * Math.PI / 180.0;

  const cosX = Math.cos(rx);
  const sinX = Math.sin(rx);
  const cosY = Math.cos(ry);
  const sinY = Math.sin(ry);
  const cosZ = Math.cos(rz);
  const sinZ = Math.sin(rz);

  // 3x3 rotation matrix: M = Rx * Ry * Rz
  const m00 = cosY * cosZ;
  const m01 = -cosY * sinZ;
  const m02 = sinY;
  const m10 = cosX * sinZ + sinX * sinY * cosZ;
  const m11 = cosX * cosZ - sinX * sinY * sinZ;
  const m12 = -sinX * cosY;
  const m20 = sinX * sinZ - cosX * sinY * cosZ;
  const m21 = sinX * cosZ + cosX * sinY * sinZ;
  const m22 = cosX * cosY;

  // 旋转矩阵 → 四元数
  const trace = m00 + m11 + m22;
  let qw: number, qx: number, qy: number, qz: number;

  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1.0);
    qw = 0.25 / s;
    qx = (m21 - m12) * s;
    qy = (m02 - m20) * s;
    qz = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2.0 * Math.sqrt(1.0 + m00 - m11 - m22);
    qw = (m21 - m12) / s;
    qx = 0.25 * s;
    qy = (m01 + m10) / s;
    qz = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2.0 * Math.sqrt(1.0 + m11 - m00 - m22);
    qw = (m02 - m20) / s;
    qx = (m01 + m10) / s;
    qy = 0.25 * s;
    qz = (m12 + m21) / s;
  } else {
    const s = 2.0 * Math.sqrt(1.0 + m22 - m00 - m11);
    qw = (m10 - m01) / s;
    qx = (m02 + m20) / s;
    qy = (m12 + m21) / s;
    qz = 0.25 * s;
  }

  return [qx, qy, qz, qw];
}

// ===== isIdentityQuat — Go threejs/spec.go isIdentityQuat（L819-822）=====

/**
 * 判定四元数是否≈单位四元数（浮点 epsilon）。
 * 对齐 Go threejs/spec.go isIdentityQuat（L819-822）。
 */
function isIdentityQuat(q: [number, number, number, number]): boolean {
  const eps = 1e-9;
  return Math.abs(q[0]) < eps && Math.abs(q[1]) < eps && Math.abs(q[2]) < eps && Math.abs(q[3] - 1) < eps;
}

// ===== hasBoneRotation — Go threejs/spec.go hasBoneRotation（L828-830）=====

/**
 * 判定骨骼旋转是否实际生效（四元数 ≠ 单位四元数，epsilon 口径）。
 * 对齐 Go threejs/spec.go hasBoneRotation（L828-830）。
 */
function hasBoneRotation(rot: [number, number, number]): boolean {
  return !isIdentityQuat(eulerToQuaternion(-rot[0], -rot[1], rot[2]));
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
