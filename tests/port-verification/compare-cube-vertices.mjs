#!/usr/bin/env node
/**
 * cube 顶点对拍：Blockbench 活规范 vs 咱们 buildCubeMeshData
 *
 * 对比维度：cube 8 顶点 **相对 cube pivot（旋转中心）的局部坐标**
 * 两边都不涉及骨骼链，最简对比。
 *
 * 用法: node tests/port-verification/compare-cube-vertices.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..', '..');
const FOX = join(ROOT, 'upstream', '[YSM模型]官方开源wine_fox_json');

// ===== 工具：欧拉→旋转矩阵（ZYX intrinsic = Rz×Ry×Rx）=====
function eulerToMatrix(rxDeg, ryDeg, rzDeg) {
  const rx = rxDeg * Math.PI / 180;
  const ry = ryDeg * Math.PI / 180;
  const rz = rzDeg * Math.PI / 180;
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  // M = Rz × Ry × Rx
  return [
    cz*cy,           cz*sy*sx - sz*cx, cz*sy*cx + sz*sx,
    sz*cy,           sz*sy*sx + cz*cx, sz*sy*cx - cz*sx,
    -sy,             cy*sx,            cy*cx,
  ];
}
function matVec(m, v) {
  return [m[0]*v[0]+m[1]*v[1]+m[2]*v[2], m[3]*v[0]+m[4]*v[1]+m[5]*v[2], m[6]*v[0]+m[7]*v[1]+m[8]*v[2]];
}

// 8 顶点组合（lx/hx × ly/hy × lz/hz）
function cube8Vertices(lx, ly, lz, hx, hy, hz) {
  return [
    [lx, ly, lz], [hx, ly, lz], [lx, hy, lz], [hx, hy, lz],
    [lx, ly, hz], [hx, ly, hz], [lx, hy, hz], [hx, hy, hz],
  ];
}

function fmt3(v) { return v.map(x => x.toFixed(3).padStart(8)).join(' '); }

// ===== Blockbench 链路：parseCube + updateGeometry =====
// 算 cube 8 顶点相对 cube pivot 的局部坐标
function blockbenchCubeLocalVerts(s) {
  // parseCube (bedrock.js:648-717)
  // L654: cube.origin = s.pivot
  let bbCubeOrigin = [...s.pivot]; // 旋转中心
  // L656-657: rotation X/Y 翻号
  let bbRot = [...(s.rotation || [0,0,0])];
  bbRot[0] *= -1; bbRot[1] *= -1; // bbRot[2] 不变
  // L659: origin[0] *= -1
  bbCubeOrigin[0] *= -1;

  // L661-667: from = s.origin, from[0] 镜像, to = from + size
  let bbFrom = [...s.origin];
  bbFrom[0] = -(bbFrom[0] + s.size[0]); // L662
  let bbTo = [
    s.size[0] + bbFrom[0],
    s.size[1] + bbFrom[1],
    s.size[2] + bbFrom[2],
  ];

  // inflate (L706-708)
  const inflate = s.inflate ?? 0;
  if (inflate !== 0) {
    // Blockbench inflate: from 各轴 -i, to 各轴 +i, 但实际 adjustFromAndTo 用 center ± (halfSize+i)
    // 简化：from -= i, to += i（等价于 center ± (halfSize+i) 当 from/to 关于 center 对称时）
    // 更准确：adjustFromAndToForInflateAndStretch 重新从 center + halfSize 算
    const halfSize = [(bbTo[0]-bbFrom[0])/2, (bbTo[1]-bbFrom[1])/2, (bbTo[2]-bbFrom[2])/2];
    const center = [bbFrom[0]+halfSize[0], bbFrom[1]+halfSize[1], bbFrom[2]+halfSize[2]];
    bbFrom = [center[0]-(halfSize[0]+inflate), center[1]-(halfSize[1]+inflate), center[2]-(halfSize[2]+inflate)];
    bbTo   = [center[0]+(halfSize[0]+inflate), center[1]+(halfSize[1]+inflate), center[2]+(halfSize[2]+inflate)];
  }

  // updateGeometry (cube.js:1177-1216)
  // L1184-1192: from[i] -= element.origin[i], to[i] -= element.origin[i]
  let from = [...bbFrom], to = [...bbTo];
  for (let i = 0; i < 3; i++) {
    from[i] -= bbCubeOrigin[i];
    to[i]   -= bbCubeOrigin[i];
    if (from[i] === to[i]) to[i] += 0.001;
  }

  // setShape(from, to) → 8 顶点（相对 cube.origin = 旋转中心）
  const lx = from[0], ly = from[1], lz = from[2];
  const hx = to[0],   hy = to[1],   hz = to[2];
  const verts = cube8Vertices(lx, ly, lz, hx, hy, hz);

  return { verts, bbCubeOrigin, bbRot, from, to };
}

// ===== 咱们链路：buildCubeMeshData =====
// 算 cube 8 顶点相对 cube pivot 的局部坐标
function ourCubeLocalVerts(s) {
  let ox = s.origin[0], oy = s.origin[1], oz = s.origin[2];
  let sx = s.size[0],   sy = s.size[1],   sz = s.size[2];

  // cube origin X 镜像 (cube-mesh.ts L88)
  ox = -(ox + sx);

  // inflate (L91-98)
  const inflate = s.inflate ?? 0;
  if (inflate !== 0) {
    ox -= inflate; oy -= inflate; oz -= inflate;
    sx += 2*inflate; sy += 2*inflate; sz += 2*inflate;
  }

  // cube pivot (L109-113) — JSON 无 pivotSet 字段，从 pivot 是否存在推断
  const pivotSet = s.pivot !== undefined;
  let cp = [...(s.pivot || [0,0,0])];
  // Blockbench parseCube L659: cube 旋转中心 X 翻号（origin[0] *= -1）
  cp[0] = -cp[0];
  if (!pivotSet) {
    cp = [ox + sx*0.5, oy + sy*0.5, oz + sz*0.5];
  }

  // fx/fy/fz, tx/ty/tz (L118-120)
  const fx = ox, fy = oy, fz = oz;
  const tx = ox + sx, ty = fy + sy, tz = fz + sz;
  const cx = (fx+tx)*0.5, cy = (fy+ty)*0.5, cz = (fz+tz)*0.5;
  const hx2 = (tx-fx)*0.5, hy2 = (ty-fy)*0.5, hz2 = (tz-fz)*0.5;

  // 顶点相对 cube pivot (L137-142)
  let lx = cx - hx2 - cp[0];
  let ly = cy - hy2 - cp[1];
  let lz = cz - hz2 - cp[2];
  let hx = cx + hx2 - cp[0];
  let hy = cy + hy2 - cp[1];
  let hz = cz + hz2 - cp[2];

  // 零厚度修正 (L145-147)
  if (lx === hx) hx += 0.001;
  if (ly === hy) hy += 0.001;
  if (lz === hz) hz += 0.001;

  const verts = cube8Vertices(lx, ly, lz, hx, hy, hz);
  return { verts, cp };
}

// ===== 主对拍 =====
function loadMain(modelDir) {
  return JSON.parse(readFileSync(join(FOX, modelDir, 'models', 'main.json'), 'utf-8'));
}
function findBone(bones, name) { return bones.find(b => b.name === name) || null; }

function compareOne(label, modelDir, boneName, cubeIdx) {
  const model = loadMain(modelDir);
  const bones = model['minecraft:geometry'][0].bones;
  const bone = findBone(bones, boneName);
  if (!bone) { console.log(`[${label}] 骨骼 ${boneName} 不存在`); return; }
  const cube = bone.cubes[cubeIdx];
  if (!cube) { console.log(`[${label}] cube#${cubeIdx} 不存在`); return; }

  console.log(`\n===== ${label}: ${modelDir}/${boneName} cube#${cubeIdx} =====`);
  console.log(`cube: origin=${JSON.stringify(cube.origin)} size=${JSON.stringify(cube.size)}`);
  console.log(`      pivot=${JSON.stringify(cube.pivot || '无')} rotation=${JSON.stringify(cube.rotation || [0,0,0])}`);
  console.log(`      inflate=${cube.inflate ?? 0} pivotSet=${cube.pivot !== undefined}`);
  console.log(`bone: pivot=${JSON.stringify(bone.pivot)} parent=${bone.parent || '无'}`);

  const bb = blockbenchCubeLocalVerts(cube);
  const ours = ourCubeLocalVerts(cube);

  console.log(`\nBlockbench bbCubeOrigin: ${fmt3(bb.bbCubeOrigin)}`);
  console.log(`Blockbench bbRot (X/Y翻号后): ${fmt3(bb.bbRot)}`);
  console.log(`Blockbench from/to (相对cubeOrigin): from=${fmt3(bb.from)} to=${fmt3(bb.to)}`);
  console.log(`咱们 cp: ${fmt3(ours.cp)}`);

  console.log(`\n--- 8 顶点（相对 cube pivot）---`);
  console.log(`     Blockbench           咱们                diff`);
  let maxDiff = 0;
  for (let i = 0; i < 8; i++) {
    const bv = bb.verts[i], ov = ours.verts[i];
    const d = [bv[0]-ov[0], bv[1]-ov[1], bv[2]-ov[2]];
    const dm = Math.max(...d.map(Math.abs));
    maxDiff = Math.max(maxDiff, dm);
    console.log(`  v${i}: ${fmt3(bv)}   ${fmt3(ov)}   ${fmt3(d)}`);
  }
  console.log(`\n最大差异: ${maxDiff.toFixed(4)}`);
  if (maxDiff < 0.01) console.log('✅ 顶点一致');
  else console.log('❌ 顶点不一致');
}

// ===== 执行 =====
console.log('cube 顶点对拍：Blockbench vs 咱们');
console.log('对比维度：cube 8 顶点相对 cube pivot 的局部坐标');
console.log('日期: 2026-08-22\n');

// 21_saint Skirt — 三轴非零 cube
{
  const model = loadMain('21_saint');
  const bones = model['minecraft:geometry'][0].bones;
  const skirt = findBone(bones, 'Skirt');
  if (skirt) {
    // 找第一个有 rotation 的 cube
    let idx = 0;
    for (let i = 0; i < skirt.cubes.length; i++) {
      if (skirt.cubes[i].rotation && skirt.cubes[i].rotation.some(v => Math.abs(v) > 0.1)) {
        idx = i; break;
      }
    }
    compareOne('Skirt tri-axis', '21_saint', 'Skirt', idx);
  }
}

// 01_taisho_maid UpBody cube#0 — 无旋转基准
compareOne('UpBody 无旋转', '01_taisho_maid', 'UpBody', 0);

// 01_taisho_maid Tail2 cube#0 — 三轴非零
{
  const model = loadMain('01_taisho_maid');
  const bones = model['minecraft:geometry'][0].bones;
  const tail2 = findBone(bones, 'Tail2');
  if (tail2 && tail2.cubes[0]) {
    compareOne('Tail2 三轴', '01_taisho_maid', 'Tail2', 0);
  }
}
