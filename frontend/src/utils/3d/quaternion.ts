// ===== quaternion.ts — 欧拉角→四元数旋转工具 =====
// 从 cube-mesh.ts 拆出（ADR-040 ≤400 行红线），仅含自包含的四元数工具函数。
// 对齐 Go threejs/spec.go eulerToQuaternion / isIdentityQuat / hasBoneRotation。
// cube-mesh.ts 与 spec-builder.ts re-export 保兼容，消费方零改动。

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