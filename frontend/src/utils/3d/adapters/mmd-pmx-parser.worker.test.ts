// ===== PMX 骨骼解析字节序测试（对齐 @moeru/three-mmd _ParseBones 权威实现）=====
// 背景：Worker 版骨骼解析曾整体错位——顺序（缺 englishName/transformOrder）、
// flag 位含义（0x01/0x02/0x10 误判为 positionOffset/rotationOffset/IK）、
// IK 结构（childCount uint8 + angle，实为 iteration int32 + rotationConstraint +
// links[]）全对不上 PMX 2.0 规范。本测试构造真实骨骼字节，锁死权威字节序。
// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { PmxReader, parseBones, parsePMX } from "./mmd-pmx-parser.worker.ts";

// ===== 字节构造工具（PMX 2.0 规范）=====

/** 动态字节写入器 */
class ByteWriter {
  private chunks: number[] = [];
  push(...bytes: number[]): void { this.chunks.push(...bytes); }
  int32(v: number): void {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setInt32(0, v, true);
    this.push(...b);
  }
  uint16(v: number): void {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, v, true);
    this.push(...b);
  }
  float32(v: number): void {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setFloat32(0, v, true);
    this.push(...b);
  }
  /** text：int32 长度 + UTF-8 字节（PMX 字符串编码） */
  text(s: string): void {
    const bytes = new TextEncoder().encode(s);
    this.int32(bytes.length);
    this.push(...bytes);
  }
  /** boneIndex（boneIndexSize=1 时 1 字节有符号） */
  boneIndex(v: number): void {
    this.push(v & 0xff);
  }
  toArrayBuffer(): ArrayBuffer {
    return new Uint8Array(this.chunks).buffer;
  }
}

/** 构造一条骨骼的完整字节（权威顺序） */
function boneBytes(opts: {
  name: string;
  englishName?: string;
  position: [number, number, number];
  parent: number;
  transformOrder?: number;
  flag: number;
  tailIsIndex?: boolean;
  tailIndex?: number;
  tailVec?: [number, number, number];
  append?: { parentIndex: number; ratio: number };
  axisLimit?: [number, number, number];
  localVector?: { x: [number, number, number]; z: [number, number, number] };
  externalParent?: number;
  ik?: {
    target: number;
    iteration: number;
    rotationConstraint: number;
    links: Array<{ boneIndex: number; limitation?: [number, number, number] }>;
  };
}): Uint8Array {
  const w = new ByteWriter();
  w.text(opts.name);
  w.text(opts.englishName ?? opts.name);
  w.float32(opts.position[0]); w.float32(opts.position[1]); w.float32(opts.position[2]);
  w.boneIndex(opts.parent);
  w.int32(opts.transformOrder ?? 0);
  w.uint16(opts.flag);
  // tailPosition：flag 0x0001 → boneIndex；否则 vec3（总是存在）
  if (opts.tailIsIndex) {
    w.boneIndex(opts.tailIndex ?? 0);
  } else {
    const v = opts.tailVec ?? [0, 0, 0];
    w.float32(v[0]); w.float32(v[1]); w.float32(v[2]);
  }
  // append transform：0x0100 HasAppendRotate | 0x0200 HasAppendMove
  if ((opts.flag & 0x0300) !== 0 && opts.append) {
    w.boneIndex(opts.append.parentIndex);
    w.float32(opts.append.ratio);
  }
  // axis limit：0x0400
  if ((opts.flag & 0x0400) !== 0 && opts.axisLimit) {
    w.float32(opts.axisLimit[0]); w.float32(opts.axisLimit[1]); w.float32(opts.axisLimit[2]);
  }
  // local vector：0x0800
  if ((opts.flag & 0x0800) !== 0 && opts.localVector) {
    w.float32(opts.localVector.x[0]); w.float32(opts.localVector.x[1]); w.float32(opts.localVector.x[2]);
    w.float32(opts.localVector.z[0]); w.float32(opts.localVector.z[1]); w.float32(opts.localVector.z[2]);
  }
  // external parent transform：0x2000
  if ((opts.flag & 0x2000) !== 0 && opts.externalParent !== undefined) {
    w.int32(opts.externalParent);
  }
  // IK：0x0020 → target + iteration(int32) + rotationConstraint(float32) + linksCount(int32) + links[]
  if ((opts.flag & 0x0020) !== 0 && opts.ik) {
    w.boneIndex(opts.ik.target);
    w.int32(opts.ik.iteration);
    w.float32(opts.ik.rotationConstraint);
    w.int32(opts.ik.links.length);
    for (const link of opts.ik.links) {
      w.boneIndex(link.boneIndex);
      if (link.limitation) {
        w.push(1); // limitation 存在标志
        w.float32(link.limitation[0]); w.float32(link.limitation[1]); w.float32(link.limitation[2]);
        // minimumAngle（3）+ maximumAngle（3）——权威实现读 6 个 float
        w.float32(0); w.float32(0); w.float32(0);
      } else {
        w.push(0);
      }
    }
  }
  return new Uint8Array(w.toArrayBuffer());
}

/** 把多条骨骼拼成一个 ArrayBuffer，返回 reader（pos 已定位到骨骼数据起点） */
function makeBoneReader(bones: Uint8Array[]): PmxReader {
  const total = bones.reduce((n, b) => n + b.length, 0);
  const buf = new Uint8Array(total);
  let off = 0;
  for (const b of bones) { buf.set(b, off); off += b.length; }
  const reader = new PmxReader(buf.buffer);
  reader.boneIndexSize = 1;
  return reader;
}

// ===== 测试用例 =====

describe("parseBones — 权威字节序（@moeru/three-mmd _ParseBones 对齐）", () => {
  it("基础骨骼：读 name/englishName/position/parent/transformOrder/flag", () => {
    const bones = [
      boneBytes({
        name: "センター",
        englishName: "center",
        position: [1, 2, 3],
        parent: -1,
        transformOrder: 0,
        flag: 0,
      }),
    ];
    const reader = makeBoneReader(bones);
    const out = parseBones(reader, 1);
    expect(out.length).toBe(1);
    const b = out[0];
    expect(b.name).toBe("センター");
    expect(b.position).toEqual([1, 2, 3]);
    expect(b.parentBoneIndex).toBe(-1);
    expect(b.hasIK).toBe(false);
  });

  it("两条骨骼连续：光标不错位（第二条读对 = 第一条字节序对）", () => {
    const bones = [
      boneBytes({ name: "root", position: [0, 0, 0], parent: -1, flag: 0 }),
      boneBytes({ name: "hip", position: [10, 20, 30], parent: 0, flag: 0 }),
    ];
    const reader = makeBoneReader(bones);
    const out = parseBones(reader, 2);
    expect(out.length).toBe(2);
    expect(out[1].name).toBe("hip");
    expect(out[1].position).toEqual([10, 20, 30]);
    expect(out[1].parentBoneIndex).toBe(0);
  });

  it("tailIsIndex（flag 0x0001）与 tail vec3 混排：光标不错位", () => {
    const bones = [
      boneBytes({ name: "a", position: [0, 0, 0], parent: -1, flag: 0x0001, tailIsIndex: true, tailIndex: 1 }),
      boneBytes({ name: "b", position: [1, 1, 1], parent: 0, flag: 0, tailVec: [5, 6, 7] }),
      boneBytes({ name: "c", position: [2, 2, 2], parent: 1, flag: 0x0001, tailIsIndex: true, tailIndex: 0 }),
    ];
    const reader = makeBoneReader(bones);
    const out = parseBones(reader, 3);
    expect(out.map((b) => b.name)).toEqual(["a", "b", "c"]);
    expect(out[2].position).toEqual([2, 2, 2]);
  });

  it("IK 骨骼：读 target/iteration/rotationConstraint/links（含 limitation）", () => {
    const bones = [
      boneBytes({
        name: "ik_leg",
        position: [0, 0, 0],
        parent: 0,
        flag: 0x0020,
        ik: {
          target: 3,
          iteration: 4,
          rotationConstraint: 0.5,
          links: [
            { boneIndex: 1 },
            { boneIndex: 2, limitation: [0.1, 0.2, 0.3] },
          ],
        },
      }),
    ];
    const reader = makeBoneReader(bones);
    const out = parseBones(reader, 1);
    expect(out[0].hasIK).toBe(true);
    expect(out[0].ikTarget).toBe(3);
    expect(out[0].ikIteration).toBe(4);
    expect(out[0].ikRotationConstraint).toBeCloseTo(0.5);
    expect(out[0].ikLinks).toBeDefined();
    expect(out[0].ikLinks!.length).toBe(2);
    expect(out[0].ikLinks![1].boneIndex).toBe(2);
  });

  it("IK 骨骼后跟普通骨骼：IK 可选段长度正确，光标不错位", () => {
    const bones = [
      boneBytes({
        name: "ik_a",
        position: [0, 0, 0],
        parent: -1,
        flag: 0x0020,
        ik: { target: 1, iteration: 2, rotationConstraint: 0.1, links: [{ boneIndex: 0 }] },
      }),
      boneBytes({ name: "plain", position: [9, 9, 9], parent: 0, flag: 0 }),
    ];
    const reader = makeBoneReader(bones);
    const out = parseBones(reader, 2);
    expect(out[0].hasIK).toBe(true);
    expect(out[1].name).toBe("plain");
    expect(out[1].position).toEqual([9, 9, 9]);
  });

  it("append(0x0300)/axisLimit(0x0400)/localVector(0x0800)/externalParent(0x2000) 可选段：光标不错位", () => {
    const bones = [
      boneBytes({
        name: "complex",
        position: [0, 0, 0],
        parent: -1,
        flag: 0x0300 | 0x0400 | 0x0800 | 0x2000,
        append: { parentIndex: 0, ratio: 0.5 },
        axisLimit: [1, 2, 3],
        localVector: { x: [0, 1, 0], z: [0, 0, 1] },
        externalParent: 7,
      }),
      boneBytes({ name: "after", position: [4, 5, 6], parent: 0, flag: 0 }),
    ];
    const reader = makeBoneReader(bones);
    const out = parseBones(reader, 2);
    expect(out[0].name).toBe("complex");
    expect(out[1].name).toBe("after");
    expect(out[1].position).toEqual([4, 5, 6]);
  });

  it("非 IK flag 位（0x0002 可旋转等）不误判为 IK", () => {
    const bones = [
      boneBytes({ name: "rot", position: [0, 0, 0], parent: -1, flag: 0x0002 | 0x0004 | 0x0008 }),
    ];
    const reader = makeBoneReader(bones);
    const out = parseBones(reader, 1);
    expect(out[0].hasIK).toBe(false);
    expect(out[0].name).toBe("rot");
  });
});

// ===== parsePMX 头部流程测试（对齐 three-mmd/babylon-mmd 权威：无 blockSize 前缀，顺序 [count][data]）=====
// 背景：手写 parsePMX 旧实现只读 magic/version/encoding/additionalFlags 就跳进数据块，
// 跳过了 globalsCount + 6×indexSize + 4 模型字符串 → 头部错位 → 真实 PMX 必解析失败
// → 全部回退 MMDLoader（「Worker 优化」从未生效）。本测试构造真实头部字节，锁死：
// ① 索引大小从头部声明读（非 count 反推）② 块定位正确（无 blockSize 前缀）③ 顶点/骨骼数据可解。
// @vitest-environment happy-dom
describe("parsePMX — 头部与块流程（权威无 blockSize 结构）", () => {
  /** 构造完整 PMX 字节：头部 + 各数据块（无 blockSize 前缀，顺序 [count][data...]） */
  function buildPmx(opts: {
    vertexIndexSize?: number;
    boneIndexSize?: number;
    vertices?: Array<{ pos: [number, number, number]; normal?: [number, number, number]; uv?: [number, number] }>;
    bones?: Uint8Array; // 已序列化骨骼区（可选，缺省不写 bone 块数据）
    faceCount?: number;
    morphs?: Uint8Array; // 已序列化变形区（可选，缺省不写 morph 块数据）
    morphCount?: number; // morph 块 count（默认 1，与 bones 对齐；多 morph 时传实际数量）
    materials?: Uint8Array; // 已序列化材质区
    materialCount?: number; // 材质块 count（默认 1）
    rigidBodies?: Uint8Array; // 已序列化刚体区
    rigidBodyCount?: number; // 刚体块 count（默认 1）
    joints?: Uint8Array; // 已序列化关节区
    jointCount?: number; // 关节块 count（默认 1）
  }): ArrayBuffer {
    const w = new ByteWriter();
    // --- 头部（权威字节序）---
    w.push(0x50, 0x4d, 0x58, 0x20); // "PMX "
    w.float32(2.0);                 // version
    w.push(8);                      // globalsCount
    w.push(1);                      // encoding = UTF-8（权威：1=UTF-8，0=UTF-16LE）
    w.push(0);                      // additionalVec4Count
    w.push(opts.vertexIndexSize ?? 1); // vertexIndexSize
    w.push(1);                      // textureIndexSize
    w.push(1);                      // materialIndexSize
    w.push(opts.boneIndexSize ?? 1);  // boneIndexSize
    w.push(1);                      // morphIndexSize
    w.push(1);                      // rigidBodyIndexSize
    w.text("");                     // modelName
    w.text("");                     // englishModelName
    w.text("");                     // comment
    w.text("");                     // englishComment

    // --- 顶点块：count + 数据（无 blockSize）---
    const verts = opts.vertices ?? [];
    w.int32(verts.length);
    for (const v of verts) {
      const n = v.normal ?? [0, 0, 1];
      const uv = v.uv ?? [0, 0];
      w.float32(v.pos[0]); w.float32(v.pos[1]); w.float32(v.pos[2]);
      w.float32(n[0]); w.float32(n[1]); w.float32(n[2]);
      w.float32(uv[0]); w.float32(uv[1]);
      w.push(0); // weightType = BDEF1（权威：1 boneIndex，无 weight 字段）
      w.push(0); // boneIndex（indexSize=1）
      w.float32(0); // edgeScale
    }

    // --- 面块：count=0 ---
    w.int32(opts.faceCount ?? 0);
    // --- 纹理块：count=0 ---
    w.int32(0);
    // --- 材质块：count + 数据 ---
    if (opts.materials) {
      w.int32(opts.materialCount ?? 1);
      w.push(...opts.materials);
    } else {
      w.int32(0);
    }
    // --- 骨骼块：count + 数据 ---
    if (opts.bones) {
      w.int32(1);
      w.push(...opts.bones);
    } else {
      w.int32(0);
    }
    // --- 变形块（morph）：count + 数据 ---
    if (opts.morphs) {
      w.int32(opts.morphCount ?? 1);
      w.push(...opts.morphs);
    } else {
      w.int32(0);
    }
    // --- 显示帧块（displayFrame）：count=0 ---
    w.int32(0);
    // --- 刚体块（rigidBody）：count + 数据 ---
    if (opts.rigidBodies) {
      w.int32(opts.rigidBodyCount ?? 1);
      w.push(...opts.rigidBodies);
    } else {
      w.int32(0);
    }
    // --- 关节块（joint）：count + 数据 ---
    if (opts.joints) {
      w.int32(opts.jointCount ?? 1);
      w.push(...opts.joints);
    } else {
      w.int32(0);
    }
    return w.toArrayBuffer();
  }

  /** 序列化一条材质（权威字段顺序，englishName 非空以覆盖光标错位场景） */
  function materialBytes(): Uint8Array {
    const w = new ByteWriter();
    w.text("mat0"); w.text("Mat0_EN"); // name + englishName（旧实现漏读 englishName）
    w.float32(1); w.float32(1); w.float32(1); w.float32(1); // diffuse
    w.float32(0.5); w.float32(0.5); w.float32(0.5);          // specular
    w.float32(10);                                           // shininess
    w.float32(0.2); w.float32(0.2); w.float32(0.2);          // ambient
    w.push(0);                                               // flag
    w.float32(0); w.float32(0); w.float32(0); w.float32(0);  // edgeColor
    w.float32(0);                                            // edgeSize
    w.push(0); // textureIndex = -1 (1 字节有符号)
    w.push(0); // sphereTextureIndex = -1
    w.push(0); // sphereMode
    w.push(0); // isSharedToon = false
    w.push(0); // toonTextureIndex（非 shared → textureIndex 大小）
    w.text(""); // comment
    w.int32(0); // indexCount
    return new Uint8Array(w.toArrayBuffer());
  }

  /** 序列化一条刚体（权威字段顺序：englishName + collisionMask 2 字节） */
  function rigidBodyBytes(): Uint8Array {
    const w = new ByteWriter();
    w.text("rb0"); w.text("Rb0_EN"); // name + englishName（旧实现漏读）
    w.push(0);  // boneIndex = 0
    w.push(1);  // collisionGroup
    w.push(0xff); w.push(0xff); // collisionMask（2 字节 uint16，旧实现按 1 字节读错位）
    w.push(0);  // shapeType = sphere
    w.float32(1); w.float32(1); w.float32(1); // shapeSize
    w.float32(0); w.float32(0); w.float32(0); // position
    w.float32(0); w.float32(0); w.float32(0); // rotation
    w.float32(1); // mass
    w.float32(0); // linearDamping
    w.float32(0); // angularDamping
    w.float32(0.5); // friction
    w.float32(0); // restitution
    w.push(0); // mode
    return new Uint8Array(w.toArrayBuffer());
  }

  /** 序列化一条关节（权威字段顺序：englishName + type 前移 + 无条件读全部约束） */
  function jointBytes(): Uint8Array {
    const w = new ByteWriter();
    w.text("jt0"); w.text("Jt0_EN"); // name + englishName（旧实现漏读）
    w.push(0); // type = Spring6dof
    w.push(0); w.push(1); // rigidBodyIndexA / B
    w.float32(0); w.float32(0); w.float32(0); // position
    w.float32(0); w.float32(0); w.float32(0); // rotation
    w.float32(-1); w.float32(-1); w.float32(-1); // positionMin
    w.float32(1); w.float32(1); w.float32(1); // positionMax
    w.float32(-1); w.float32(-1); w.float32(-1); // rotationMin
    w.float32(1); w.float32(1); w.float32(1); // rotationMax
    w.float32(0); w.float32(0); w.float32(0); // springPosition
    w.float32(0); w.float32(0); w.float32(0); // springRotation
    return new Uint8Array(w.toArrayBuffer());
  }

  it("头部正确：globalsCount=8 + 4 字符串读过后，顶点块 count 定位正确（无 blockSize 前缀）", () => {
    const buf = buildPmx({ vertices: [{ pos: [1, 2, 3] }] });
    const out = parsePMX(buf);
    expect(out.ok).toBe(true);
    expect(out.vertices?.count).toBe(1);
    expect(out.vertices?.positions[0]).toBeCloseTo(1);
    expect(out.vertices?.positions[1]).toBeCloseTo(2);
    expect(out.vertices?.positions[2]).toBeCloseTo(3);
  });

  it("索引大小从头部声明读（vertexIndexSize=4 时顶点块仍正确定位，骨骼块 count 正确）", () => {
    // 声明 vertexIndexSize=4（即使只有 1 个顶点），验证头部读取不是 count 反推
    const buf = buildPmx({ vertexIndexSize: 4, vertices: [{ pos: [0, 0, 0] }] });
    const out = parsePMX(buf);
    expect(out.ok).toBe(true);
    expect(out.vertices?.count).toBe(1);
  });

  it("骨骼块紧跟顶点/材质块：count 定位正确（无 blockSize 前缀顺序解析）", () => {
    // 用 boneBytes 造一根骨骼（权威字节序），紧跟 0 顶点/0 材质后
    const bone = boneBytes({ name: "root", position: [0, 0, 0], parent: -1, flag: 0 });
    const buf = buildPmx({ bones: bone });
    const out = parsePMX(buf);
    expect(out.ok).toBe(true);
    expect(out.bones?.length).toBe(1);
    expect(out.bones![0].name).toBe("root");
    expect(out.bones![0].parentBoneIndex).toBe(-1);
  });

  it("多顶点 + 多块：顺序解析光标不错位（顶点与骨骼数据都正确）", () => {
    const bone = boneBytes({ name: "hip", position: [10, 20, 30], parent: 0, flag: 0 });
    const buf = buildPmx({
      vertices: [
        { pos: [1, 1, 1] },
        { pos: [2, 2, 2] },
      ],
      bones: bone,
    });
    const out = parsePMX(buf);
    expect(out.ok).toBe(true);
    expect(out.vertices?.count).toBe(2);
    expect(out.vertices?.positions[3]).toBeCloseTo(2); // 第 2 个顶点 x
    expect(out.bones?.length).toBe(1);
    expect(out.bones![0].position).toEqual([10, 20, 30]);
  });

  it("morph type 0/2/3 字节布局对齐权威：光标不错位（morph 后骨骼仍正确）", () => {
    // 权威 morph 布局（babylon-mmd pmxReader）：
    //   头部 name + englishName + category(int8) + type(int8) + elementCount(int32)
    //   type 0 GroupMorph: morphIndex + ratio(float32)
    //   type 1 VertexMorph: vertexIndex + position(3×float32)
    //   type 2 BoneMorph: boneIndex + position(3) + rotation(4×float32)
    //   type 3 UvMorph: vertexIndex + offsets(4×float32)
    const w = new ByteWriter();
    w.text("m0"); w.text(""); w.push(0); w.push(0); w.int32(3); // name/english/category/type=0 GroupMorph, 3 元素
    for (let i = 0; i < 3; i++) { w.boneIndex(0); w.float32(0.5); }
    w.text("m1"); w.text(""); w.push(0); w.push(2); w.int32(1); // type=2 BoneMorph, 1 元素
    w.boneIndex(0); w.float32(1); w.float32(2); w.float32(3); w.float32(0); w.float32(0); w.float32(0); w.float32(1);
    w.text("m2"); w.text(""); w.push(0); w.push(3); w.int32(1); // type=3 UvMorph, 1 元素
    w.boneIndex(0); w.float32(0.1); w.float32(0.2); w.float32(0.3); w.float32(0.4);
    const morphs = new Uint8Array(w.toArrayBuffer());
    const bone = boneBytes({ name: "after", position: [7, 8, 9], parent: 0, flag: 0 });
    const buf = buildPmx({ bones: bone, morphs, morphCount: 3 });
    const out = parsePMX(buf);
    expect(out.ok).toBe(true);
    expect(out.morphs?.length).toBe(3);
    expect(out.morphs![0].name).toBe("m0");
    expect(out.morphs![0].type).toBe(0);
    expect(out.morphs![1].type).toBe(2);
    expect(out.morphs![2].type).toBe(3);
    // morph 后骨骼光标不错位
    expect(out.bones?.length).toBe(1);
    expect(out.bones![0].name).toBe("after");
    expect(out.bones![0].position).toEqual([7, 8, 9]);
  });

  it("材质非零块（englishName 非空）：光标不错位（材质后骨骼仍正确）", () => {
    const bone = boneBytes({ name: "matBone", position: [3, 4, 5], parent: 0, flag: 0 });
    const buf = buildPmx({ materials: materialBytes(), bones: bone });
    const out = parsePMX(buf);
    expect(out.ok).toBe(true);
    expect(out.materials?.length).toBe(1);
    expect(out.materials![0].name).toBe("mat0");
    // 材质后骨骼光标不错位（若漏读 englishName 会偏移）
    expect(out.bones?.length).toBe(1);
    expect(out.bones![0].name).toBe("matBone");
    expect(out.bones![0].position).toEqual([3, 4, 5]);
  });

  it("刚体非零块（englishName + collisionMask 2 字节）：光标不错位（刚体后关节仍正确）", () => {
    const buf = buildPmx({
      rigidBodies: rigidBodyBytes(),
      joints: jointBytes(),
    });
    const out = parsePMX(buf);
    expect(out.ok).toBe(true);
    expect(out.rigidBodies?.length).toBe(1);
    expect(out.rigidBodies![0].name).toBe("rb0");
    expect(out.rigidBodies![0].collisionGroup).toBe(0xffff); // 2 字节 mask 读全
    // 刚体后关节光标不错位（若漏 englishName/collisionMask 错位会越界或垃圾）
    expect(out.joints?.length).toBe(1);
    expect(out.joints![0].name).toBe("jt0");
    expect(out.joints![0].rigidBodyIndexA).toBe(0);
    expect(out.joints![0].rigidBodyIndexB).toBe(1);
  });

  it("编码字节 1=UTF-8：非 ASCII 名字正确解码（权威映射 0=UTF-16LE/1=UTF-8）", () => {
    // buildPmx 已写 encoding=1（UTF-8），用非 ASCII 名字验证解码路径
    const bone = boneBytes({ name: "センター", position: [0, 0, 0], parent: -1, flag: 0 });
    const buf = buildPmx({ bones: bone });
    const out = parsePMX(buf);
    expect(out.ok).toBe(true);
    expect(out.bones?.[0].name).toBe("センター");
  });
});
