// ===== PMX 骨骼解析字节序测试（对齐 @moeru/three-mmd _ParseBones 权威实现）=====
// 背景：Worker 版骨骼解析曾整体错位——顺序（缺 englishName/transformOrder）、
// flag 位含义（0x01/0x02/0x10 误判为 positionOffset/rotationOffset/IK）、
// IK 结构（childCount uint8 + angle，实为 iteration int32 + rotationConstraint +
// links[]）全对不上 PMX 2.0 规范。本测试构造真实骨骼字节，锁死权威字节序。
// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { PmxReader, parseBones } from "./mmd-pmx-parser.worker.ts";

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
