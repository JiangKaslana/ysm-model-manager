// ===== cube-mesh.ts — 立方体几何构建 + UV解析 + 旋转工具 =====
// 从 spec-builder.ts 拆出（ADR-040 P1），仅含自包含的立方体处理函数。
// 对齐 Go threejs/spec.go buildCubeMeshData / parseUV / eulerToQuaternion 等。

import type { Cube2D, MeshData, Vec3 } from "./spec-builder.ts";

/** 零厚度面修正值（避免 Three.js 渲染零面积面） */
const THICKNESS_EPSILON = 0.001;

/** 同名骨骼 cube 合并的浮点 epsilon */
const CUBE_EPSILON = 0.001;

// ===== 公开导出 =====

/**
 * 从 Bedrock cube 数据构建 THREE.Mesh 几何数据。
 * 对齐 Go threejs/spec.go buildCubeMeshData（L397-586）。
 */
export function buildCubeMeshData(
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
  const faceUVs: [number, number, number, number, number, number, number, number][] = [
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

/**
 * 合并两组 cube：新 cube 中与旧 cube 空间重叠的替换之，不重叠的追加。
 * 对齐 Go threejs/spec.go mergeCubes（L593-614）。
 */
export function mergeCubes(oldCubes: Cube2D[], newCubes: Cube2D[]): Cube2D[] {
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

// ===== parseUV — Go threejs/spec.go parseUV（L639-656）=====

/**
 * 解析 UV：faceUV 优先、失败回退 expandBoxUV、c.UV 回退。
 * 对齐 Go threejs/spec.go parseUV（L639-656）。
 */
export function parseUV(
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

// ===== eulerToQuaternion — Go threejs/spec.go eulerToQuaternion（L756-812）=====

/**
 * 欧拉角（度）→ 四元数，旋转顺序: Rx * Ry * Rz (Three.js 默认)。
 * 口径：调用方传入的是已取反角度（X/Y 取反、Z 不取反）。
 * 对齐 Go threejs/spec.go eulerToQuaternion（L756-812）。
 */
export function eulerToQuaternion(rxDeg: number, ryDeg: number, rzDeg: number): [number, number, number, number] {
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
export function isIdentityQuat(q: [number, number, number, number]): boolean {
  const eps = 1e-9;
  return Math.abs(q[0]) < eps && Math.abs(q[1]) < eps && Math.abs(q[2]) < eps && Math.abs(q[3] - 1) < eps;
}

// ===== hasBoneRotation — Go threejs/spec.go hasBoneRotation（L828-830）=====

/**
 * 判定骨骼旋转是否实际生效（四元数 ≠ 单位四元数，epsilon 口径）。
 * 对齐 Go threejs/spec.go hasBoneRotation（L828-830）。
 */
export function hasBoneRotation(rot: [number, number, number]): boolean {
  return !isIdentityQuat(eulerToQuaternion(-rot[0], -rot[1], rot[2]));
}

// ===== 内部辅助函数 =====

function cubesOverlap(a: Cube2D, b: Cube2D): boolean {
  return floatEqual(a.origin, b.origin, CUBE_EPSILON) &&
    floatEqual(a.size, b.size, CUBE_EPSILON) &&
    floatEqual(a.rotation, b.rotation, CUBE_EPSILON);
}

function floatEqual(a: [number, number, number], b: [number, number, number], eps: number): boolean {
  for (let i = 0; i < 3; i++) {
    let v = a[i] - b[i];
    if (v < 0) v = -v;
    if (v > eps) return false;
  }
  return true;
}

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
