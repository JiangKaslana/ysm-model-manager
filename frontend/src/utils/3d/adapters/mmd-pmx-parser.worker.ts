// ===== PMX 二进制解析 Worker =====
// 纯 JS 解析 PMX 格式（无 DOM/WebGL 依赖），产出结构化数据回主线程，
// 把 ~5-8s 的 PMX 解析从主线程（CrRendererMain）搬到 Worker，
// 与纹理解码 Worker 并行，主线程只负责 Three.js 场景构建。
//
// PMX 格式规范：https://github.com/v-cfd/mmd/blob/master/mmd/file_format/pmx.md
// 结构：Header → Vertices → Faces → Textures → Materials → Bones → RigidBodies → Joints → Morphs → DisplayFrames

/** 主线程 → Worker 请求 */
export interface PmxParseRequest {
  id: number;
  bytes: ArrayBuffer; // PMX 文件二进制（transferable）
}

/** 顶点数据（交织存储，GPU 友好） */
export interface PmxVertexData {
  count: number;
  positions: Float32Array;   // xyz * count
  normals: Float32Array;     // xyz * count
  uvs: Float32Array;         // uv * count
  boneIndices: Uint8Array | Uint16Array | Uint32Array; // bone indices[4] * count（宽度随 boneIndexSize：1/2/4 字节）
  boneWeights: Float32Array;  // weights[4] * count
}

/** 面数据 */
export interface PmxFaceData {
  count: number;
  indices: Uint32Array; // triangle indices * count
}

/** 材质数据 */
export interface PmxMaterialData {
  name: string;
  diffuse: [number, number, number, number]; // RGBA
  specular: [number, number, number];
  shininess: number;
  ambient: [number, number, number];
  textureIndex: number; // -1 = none
  toonIndex: number;
  flags: number;
  edgeColor: [number, number, number, number];
  edgeSize: number;
  sphereIndex: number;
  sphereMode: number;
  sharedToon: number;
}

/** 骨骼数据（字段对齐 @moeru/three-mmd PmxObject.Bone） */
export interface PmxBoneData {
  name: string;
  englishName: string;
  parentBoneIndex: number; // -1 = root
  position: [number, number, number];
  rotation: [number, number, number, number]; // quaternion
  flag: number; // PMX Bone.Flag 原始位（诊断/后续使用）
  hasIK: boolean;
  ikTarget?: number;
  ikIteration?: number;
  ikRotationConstraint?: number;
  ikLinks?: Array<{ boneIndex: number; hasLimitation: boolean }>;
}

/** Morph 数据 */
export interface PmxMorphData {
  name: string;
  type: number; // 0=group, 1=vertex, 2=bone, 3=uv, 4+=additional
  elements: Array<{ index: number; offset: [number, number, number] }>;
}

/** Worker → 主线程响应 */
export interface PmxParseResponse {
  id: number;
  ok: boolean;
  header?: {
    version: string;
    encoding: "utf-8" | "utf-16";
    additionalDataFlags: number;
  };
  vertices?: PmxVertexData;
  faces?: PmxFaceData;
  textures?: string[];
  materials?: PmxMaterialData[];
  bones?: PmxBoneData[];
  rigidBodies?: PmxRigidBodyData[];
  joints?: PmxJointData[];
  morphs?: PmxMorphData[];
  displayFrames?: PmxDisplayFrameData[];
  error?: string;
}

export interface PmxRigidBodyData {
  name: string;
  boneIndex: number; // -1 = no bone
  group: number;
  collisionGroup: number;
  shapeType: number; // 0=sphere, 1=box, 2=capsule
  shapeSize: [number, number, number];
  position: [number, number, number];
  rotation: [number, number, number];
  mass: number;
  linearDamping: number;
  angularDamping: number;
  friction: number;
  restitution: number;
  mode: number; // 0=follow, 1=dynamic, 2=pseudo
}

export interface PmxJointData {
  name: string;
  rigidBodyIndexA: number;
  rigidBodyIndexB: number;
  type: number;
  position: [number, number, number];
  rotation: [number, number, number];
  positionMin?: [number, number, number];
  positionMax?: [number, number, number];
  rotationMin?: [number, number, number];
  rotationMax?: [number, number, number];
  springPosition?: [number, number, number];
  springRotation?: [number, number, number];
}

export interface PmxDisplayFrameData {
  name: string;
  type: number; // 0=root, 1=bone, 2=morph
  elements: Array<{ index: number; value: number }>;
}

// ===== 二进制读取器 =====
export class PmxReader {
  private view: DataView;
  private u8: Uint8Array;
  pos = 0;
  public encoding: "utf-8" | "utf-16" = "utf-8";
  public additionalFlags = 0;
  public vertexIndexSize = 1;
  public boneIndexSize = 1;
  public textureIndexSize = 1;
  public materialIndexSize = 1;
  public rigidBodyIndexSize = 1;
  public jointIndexSize = 1;
  public morphIndexSize = 1;
  public displayFrameIndexSize = 1;

  constructor(buffer: ArrayBuffer) {
    this.view = new DataView(buffer);
    this.u8 = new Uint8Array(buffer);
  }

  get position() { return this.pos; }

  // --- 基础类型读取 ---
  readUint8(): number {
    const v = this.view.getUint8(this.pos);
    this.pos += 1;
    return v;
  }

  readInt8(): number {
    const v = this.view.getInt8(this.pos);
    this.pos += 1;
    return v;
  }

  readUint16(): number {
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  readInt16(): number {
    const v = this.view.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }

  readUint32(): number {
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  readInt32(): number {
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }

  readFloat32(): number {
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }

  // --- 字符串读取（UTF-8 / UTF-16）---
  readString(): string {
    const length = this.readInt32();
    if (length <= 0) return "";
    if (this.encoding === "utf-8") {
      const bytes = this.u8.subarray(this.pos, this.pos + length);
      this.pos += length;
      return new TextDecoder("utf-8").decode(bytes);
    } else {
      const bytes = new Uint8Array(this.u8.subarray(this.pos, this.pos + length));
      this.pos += length;
      const shortView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      let result = "";
      for (let i = 0; i < length; i += 2) {
        result += String.fromCharCode(shortView.getUint16(i, true));
      }
      return result.replace(/\0+$/, "");
    }
  }

  // --- 可变大小索引 ---
  readVertexIndex(): number {
    switch (this.vertexIndexSize) {
      case 1: return this.readInt8();
      case 2: return this.readInt16();
      case 4: return this.readInt32();
      default: return -1;
    }
  }

  readBoneIndex(): number {
    switch (this.boneIndexSize) {
      case 1: return this.readInt8();
      case 2: return this.readInt16();
      case 4: return this.readInt32();
      default: return 0;
    }
  }

  readTextureIndex(): number {
    switch (this.textureIndexSize) {
      case 1: return this.readInt8();
      case 2: return this.readInt16();
      case 4: return this.readInt32();
      default: return -1;
    }
  }

  readMaterialIndex(): number {
    switch (this.materialIndexSize) {
      case 1: return this.readInt8();
      case 2: return this.readInt16();
      case 4: return this.readInt32();
      default: return 0;
    }
  }

  readRigidBodyIndex(): number {
    switch (this.rigidBodyIndexSize) {
      case 1: return this.readInt8();
      case 2: return this.readInt16();
      case 4: return this.readInt32();
      default: return -1;
    }
  }

  readJointIndex(): number {
    switch (this.jointIndexSize) {
      case 1: return this.readInt8();
      case 2: return this.readInt16();
      case 4: return this.readInt32();
      default: return -1;
    }
  }

  readMorphIndex(): number {
    switch (this.morphIndexSize) {
      case 1: return this.readInt8();
      case 2: return this.readInt16();
      case 4: return this.readInt32();
      default: return 0;
    }
  }

  // --- 数据块读取 ---
  skipBlock() {
    const size = this.readInt32();
    this.pos += size;
  }

  readBlockSize(): number {
    return this.readInt32();
  }
}

/** PMX 结构预扫描：记录各 block 的位置、大小、count，用于确定索引大小和解析顺序 */
interface PmxBlock {
  pos: number;
  size: number;
  count: number;
}

interface PmxStructure {
  vertex: PmxBlock;
  face: PmxBlock;
  texture: PmxBlock;
  material: PmxBlock;
  bone: PmxBlock;
  rigidBody: PmxBlock;
  joint: PmxBlock;
  morph: PmxBlock;
  displayFrame: PmxBlock;
}

function scanStructure(reader: PmxReader): PmxStructure {
  const s: PmxStructure = {
    vertex: { pos: 0, size: 0, count: 0 },
    face: { pos: 0, size: 0, count: 0 },
    texture: { pos: 0, size: 0, count: 0 },
    material: { pos: 0, size: 0, count: 0 },
    bone: { pos: 0, size: 0, count: 0 },
    rigidBody: { pos: 0, size: 0, count: 0 },
    joint: { pos: 0, size: 0, count: 0 },
    morph: { pos: 0, size: 0, count: 0 },
    displayFrame: { pos: 0, size: 0, count: 0 },
  };

  const blocks: Array<keyof PmxStructure> = [
    "vertex", "face", "texture", "material", "bone",
    "rigidBody", "joint", "morph", "displayFrame",
  ];

  for (const key of blocks) {
    const pos = reader.position;
    const size = reader.readInt32();
    const count = size >= 4 ? reader.readInt32() : 0;
    s[key] = { pos, size: size > 0 ? size : 0, count };
    reader.pos = pos + 4 + (size > 0 ? size : 0);
  }

  return s;
}

// ===== 骨骼解析（纯函数，权威字节序对齐 @moeru/three-mmd _ParseBones）=====
// PMX 2.0 Bone 结构（权威顺序，见 @moeru/three-mmd dist/index.js _ParseBones）：
//   name(text) → englishName(text) → position(vec3) → parentBoneIndex(index)
//   → transformOrder(int32) → flag(uint16)
//   → tailPosition：flag 0x0001 时 boneIndex，否则 vec3（总是存在）
//   → appendTransform：flag 0x0100|0x0200 时 parentIndex(index) + ratio(float32)
//   → axisLimit：flag 0x0400 时 vec3
//   → localVector：flag 0x0800 时 x(vec3) + z(vec3)
//   → externalParentTransform：flag 0x2000 时 int32
//   → IK：flag 0x0020 时 target(index) + iteration(int32) + rotationConstraint(float32)
//     + linksCount(int32) + links[{ boneIndex(index), limitation?[min vec3, max vec3] }]
// ⚠️ 旧实现错在：缺 englishName/transformOrder（顺序错位）、flag 位含义错
// （0x01/0x02/0x10 误判 positionOffset/rotationOffset/IK，实为 tailIndex/rotatable/controllable）、
// IK 结构错（childCount uint8 + angle，实为 iteration int32 + rotationConstraint + links）。
export function parseBones(reader: PmxReader, boneCount: number): PmxBoneData[] {
  const bones: PmxBoneData[] = [];
  for (let i = 0; i < boneCount; i++) {
    const name = reader.readString();
    const englishName = reader.readString();
    const position: [number, number, number] = [
      reader.readFloat32(), reader.readFloat32(), reader.readFloat32(),
    ];
    const parentBoneIndex = reader.readBoneIndex();
    reader.readInt32(); // transformOrder（变形层级，本解析不消费）
    const flag = reader.readUint16();
    const rotation: [number, number, number, number] = [0, 0, 0, 1];

    // tailPosition（总是存在）
    if ((flag & 0x0001) !== 0) {
      reader.readBoneIndex(); // UseBoneIndexAsTailPosition
    } else {
      reader.readFloat32(); reader.readFloat32(); reader.readFloat32();
    }

    // appendTransform（0x0100 HasAppendRotate | 0x0200 HasAppendMove）
    if ((flag & 0x0300) !== 0) {
      reader.readBoneIndex(); // parentIndex
      reader.readFloat32();   // ratio
    }
    // axisLimit（0x0400 HasAxisLimit）
    if ((flag & 0x0400) !== 0) {
      reader.readFloat32(); reader.readFloat32(); reader.readFloat32();
    }
    // localVector（0x0800 HasLocalVector）
    if ((flag & 0x0800) !== 0) {
      for (let k = 0; k < 6; k++) reader.readFloat32(); // x vec3 + z vec3
    }
    // externalParentTransform（0x2000 IsExternalParentTransformed）
    if ((flag & 0x2000) !== 0) {
      reader.readInt32();
    }

    const bone: PmxBoneData = {
      name, englishName, parentBoneIndex, position, rotation, flag,
      hasIK: false,
    };

    // IK（0x0020 IsIkEnabled）
    if ((flag & 0x0020) !== 0) {
      bone.hasIK = true;
      bone.ikTarget = reader.readBoneIndex();
      bone.ikIteration = reader.readInt32();
      bone.ikRotationConstraint = reader.readFloat32();
      const linksCount = reader.readInt32();
      bone.ikLinks = [];
      for (let j = 0; j < linksCount; j++) {
        const linkBoneIndex = reader.readBoneIndex();
        const hasLimitation = reader.readUint8() === 1;
        if (hasLimitation) {
          for (let k = 0; k < 6; k++) reader.readFloat32(); // min vec3 + max vec3
        }
        bone.ikLinks.push({ boneIndex: linkBoneIndex, hasLimitation });
      }
    }

    bones.push(bone);
  }
  return bones;
}

// ===== PMX 解析 =====
export function parsePMX(buffer: ArrayBuffer): PmxParseResponse {
  const reader = new PmxReader(buffer);

  // --- Header（权威字节序，对齐 @moeru/three-mmd _ParseHeader / babylon-mmd pmxReader）---
  // 顺序：magic(4) → version(4) → globalsCount(1) → encoding(1) → additionalVec4Count(1)
  // → 6×indexSize(1 each) → [globalsCount>8 时补读] → 4 模型字符串(text)
  // ⚠️ 旧实现只读 magic/version/encoding/additionalFlags 就跳进数据块，跳过了
  // globalsCount + 6×indexSize + 4 模型字符串 → 头部错位 → 真实 PMX 必解析失败
  // → 全部回退 MMDLoader（「Worker 优化」从未生效，审计 P0）
  const magic = new TextDecoder("ascii").decode(new Uint8Array(buffer, 0, 4));
  if (magic !== "PMX ") {
    return { id: 0, ok: false, error: `无效 PMX 文件：magic="${magic}"` };
  }
  reader.pos = 4; // magic 已用 buffer 直读校验，reader 须跳过这 4 字节再顺序读

  const version = `${reader.readFloat32().toFixed(2)}`;
  const globalsCount = reader.readUint8();
  if (globalsCount < 8) {
    return { id: 0, ok: false, error: `无效 globalsCount: ${globalsCount}` };
  }
  const encodingByte = reader.readUint8();
  reader.encoding = encodingByte === 0 ? "utf-8" : "utf-16";
  // additionalVec4Count：额外 UV 组数（0-4 直接值，非位标志——旧实现当位标志用是错的）
  reader.additionalFlags = reader.readUint8();
  // 索引大小从头部声明取（PMX 2.0 每类 1 字节），非 count 反推（旧 indexSizeFor 有符号阈值也是错的）
  reader.vertexIndexSize = reader.readUint8();
  reader.textureIndexSize = reader.readUint8();
  reader.materialIndexSize = reader.readUint8();
  reader.boneIndexSize = reader.readUint8();
  reader.morphIndexSize = reader.readUint8();
  reader.rigidBodyIndexSize = reader.readUint8();
  for (let i = 8; i < globalsCount; ++i) reader.readUint8(); // 高位版本扩展 globals
  // 4 个模型信息字符串（跳过，本解析不消费）
  reader.readString(); // modelName
  reader.readString(); // englishModelName
  reader.readString(); // comment
  reader.readString(); // englishComment

  // === 顶点布局（PMX 2.0：第一组 UV 恒在；additionalVec4Count 为额外 4-float 组数）===
  const additionalVec4Count = reader.additionalFlags;
  // 每顶点字节布局（weightType 每顶点独立，从顶点数据读，非头部 flag 推断）：
  // position(12) + normal(12) + uv(8) + additionalVec4×16 + weightType(1) + deform + edgeScale(4)
  const baseVertexHead = 12 + 12 + 8 + additionalVec4Count * 16;
  // deform 大小随 boneIndexSize（BDEF1/BDEF2/BDEF4 三种）
  const align4 = (n: number): number => Math.ceil(n / 4) * 4;
  const boneIndexSize = reader.boneIndexSize;

  // === Vertices（无 blockSize 前缀：count 后直接数据，顺序解析）===
  const vertexCount = reader.readInt32();
  const vertexData = (() => {
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const boneIndices = boneIndexSize === 2
      ? new Uint16Array(vertexCount * 4)
      : boneIndexSize === 4
        ? new Uint32Array(vertexCount * 4)
        : new Uint8Array(vertexCount * 4);
    const boneWeights = new Float32Array(vertexCount * 4);

    for (let i = 0; i < vertexCount; i++) {
      // position(12) + normal(12) + uv(8)
      positions[i * 3] = reader.readFloat32();
      positions[i * 3 + 1] = reader.readFloat32();
      positions[i * 3 + 2] = reader.readFloat32();
      normals[i * 3] = reader.readFloat32();
      normals[i * 3 + 1] = reader.readFloat32();
      normals[i * 3 + 2] = reader.readFloat32();
      uvs[i * 2] = reader.readFloat32();
      uvs[i * 2 + 1] = reader.readFloat32();
      // additionalVec4（额外 UV 组数 × 4 float）
      for (let j = 0; j < additionalVec4Count; j++) {
        reader.readFloat32(); reader.readFloat32(); reader.readFloat32(); reader.readFloat32();
      }
      // weightType：每顶点独立（0=BDEF1, 1=BDEF2, 2=BDEF4, 3=SDEF, 4=QDEF）
      // ⚠️ 旧实现从头部 flag 推断全局 weightType——权威是每顶点独立 1 字节（对齐 babylon-mmd pmxReader.ts:241）
      const weightType = reader.readUint8();
      const o = i * 4;
      if (weightType === 0) {
        // BDEF1：1 索引复制到 4 槽，权重 [1,0,0,0]
        const bi = reader.readBoneIndex();
        boneIndices[o] = bi; boneIndices[o + 1] = bi; boneIndices[o + 2] = bi; boneIndices[o + 3] = bi;
        boneWeights[o] = 1; boneWeights[o + 1] = 0; boneWeights[o + 2] = 0; boneWeights[o + 3] = 0;
      } else if (weightType === 1) {
        // BDEF2：2 索引 + 1 权重
        const bi0 = reader.readBoneIndex();
        const bi1 = reader.readBoneIndex();
        const w = reader.readFloat32();
        boneIndices[o] = bi0; boneIndices[o + 1] = bi1; boneIndices[o + 2] = 0; boneIndices[o + 3] = 0;
        boneWeights[o] = w; boneWeights[o + 1] = 1 - w; boneWeights[o + 2] = 0; boneWeights[o + 3] = 0;
      } else if (weightType === 2) {
        // BDEF4：4 索引 + 4 权重
        for (let k = 0; k < 4; k++) boneIndices[o + k] = reader.readBoneIndex();
        for (let k = 0; k < 4; k++) boneWeights[o + k] = reader.readFloat32();
      } else if (weightType === 3) {
        // SDEF：2 索引 + 权重 + c(3) + r0(3) + r1(3)（c/r0/r1 本解析不消费，跳过）
        const bi0 = reader.readBoneIndex();
        const bi1 = reader.readBoneIndex();
        const w = reader.readFloat32();
        for (let k = 0; k < 9; k++) reader.readFloat32(); // c + r0 + r1
        boneIndices[o] = bi0; boneIndices[o + 1] = bi1; boneIndices[o + 2] = 0; boneIndices[o + 3] = 0;
        boneWeights[o] = w; boneWeights[o + 1] = 1 - w; boneWeights[o + 2] = 0; boneWeights[o + 3] = 0;
      } else {
        // QDEF（4）：同 BDEF4
        for (let k = 0; k < 4; k++) boneIndices[o + k] = reader.readBoneIndex();
        for (let k = 0; k < 4; k++) boneWeights[o + k] = reader.readFloat32();
      }
      reader.readFloat32(); // edgeScale
    }

    return { count: vertexCount, positions, normals, uvs, boneIndices, boneWeights };
  })();

  // === Faces（无 blockSize 前缀：count 后直接数据，顺序解析）===
  const faceCount = reader.readInt32();
  const faceData = (() => {
    if (faceCount === 0) {
      return { count: 0, indices: new Uint32Array(0) } as PmxFaceData;
    }
    const indices = new Uint32Array(faceCount * 3);
    const indexSize = reader.vertexIndexSize; // 面索引用 vertexIndexSize（头部声明）
    for (let i = 0; i < faceCount * 3; i++) {
      switch (indexSize) {
        case 1: indices[i] = reader.readUint8(); break;
        case 2: indices[i] = reader.readUint16(); break;
        case 4: indices[i] = reader.readUint32(); break;
        default: reader.readUint8(); indices[i] = 0;
      }
    }
    return { count: faceCount, indices } as PmxFaceData;
  })();

  // === Textures ===
  const texCount = reader.readInt32();
  const textures: string[] = [];
  for (let i = 0; i < texCount; i++) {
    textures.push(reader.readString());
  }

  // === Materials ===
  const matCount = reader.readInt32();
  const materials: PmxMaterialData[] = [];
  for (let i = 0; i < matCount; i++) {
    const name = reader.readString();
    const diffuse: [number, number, number, number] = [
      reader.readFloat32(), reader.readFloat32(), reader.readFloat32(), reader.readFloat32(),
    ];
    const specular: [number, number, number] = [
      reader.readFloat32(), reader.readFloat32(), reader.readFloat32(),
    ];
    const shininess = reader.readFloat32();
    const ambient: [number, number, number] = [
      reader.readFloat32(), reader.readFloat32(), reader.readFloat32(),
    ];
    const textureIndex = reader.readTextureIndex();
    const toonIndex = reader.readTextureIndex();
    const flags = reader.readUint8();
    const edgeColor: [number, number, number, number] = [
      reader.readFloat32(), reader.readFloat32(), reader.readFloat32(), reader.readFloat32(),
    ];
    const edgeSize = reader.readFloat32();
    const sphereIndex = reader.readTextureIndex();
    const sphereMode = reader.readUint8();
    const sharedToon = reader.readUint8();
    materials.push({
      name, diffuse, specular, shininess, ambient,
      textureIndex, toonIndex, flags, edgeColor, edgeSize,
      sphereIndex, sphereMode, sharedToon,
    });
  }

  // === Bones ===
  const boneCount = reader.readInt32();
  const bones = parseBones(reader, boneCount);

  // === Morphs（无 blockSize 前缀：count 后直接数据，顺序解析）===
  // 权威头部：name(text) + englishName(text) + category(int8) + type(int8) + elementCount(int32)
  // ⚠️ 旧实现只读 name + type(uint8) + elementCount——漏 englishName/category 且 type 用 uint8 读错
  const morphCount = reader.readInt32();
  const morphs: PmxMorphData[] = [];
  for (let i = 0; i < morphCount; i++) {
    const name = reader.readString();
    reader.readString(); // englishName（本解析不消费）
    reader.readInt8();   // category（本解析不消费）
    const type = reader.readInt8();
    const elementCount = reader.readInt32();
    const elements: PmxMorphData["elements"] = [];
    for (let j = 0; j < elementCount; j++) {
      let index = 0;
      let offset: [number, number, number] = [0, 0, 0];
      if (type === 0) {
        // GroupMorph：morphIndex + ratio(float32)
        index = reader.readMorphIndex();
        reader.readFloat32();
      } else if (type === 1) {
        // VertexMorph：vertexIndex + position(3×float32)
        index = reader.readVertexIndex();
        offset = [reader.readFloat32(), reader.readFloat32(), reader.readFloat32()];
      } else if (type === 2) {
        // BoneMorph：boneIndex + position(3×float32) + rotation(4×float32)
        index = reader.readBoneIndex();
        offset = [reader.readFloat32(), reader.readFloat32(), reader.readFloat32()];
        reader.pos += 16; // rotation 4×float32
      } else if (type >= 3 && type <= 7) {
        // UvMorph + AdditionalUvMorph1-4：vertexIndex + offsets(4×float32)
        index = reader.readVertexIndex();
        reader.pos += 16; // 4×float32
      } else if (type === 8) {
        // MaterialMorph：materialIndex + type(uint8) + diffuse(4)+specular(3)+shininess(1)
        //   + ambient(3) + edgeColor(4) + edgeSize(1) + textureColor(4)
        //   + sphereTextureColor(4) + toonTextureColor(4)
        index = reader.readMaterialIndex();
        reader.pos += 1 + 16 + 12 + 4 + 12 + 16 + 4 + 16 + 16 + 16;
      } else if (type === 9) {
        // FlipMorph：morphIndex + ratio(float32)
        index = reader.readMorphIndex();
        reader.readFloat32();
      } else if (type === 10) {
        // ImpulseMorph：rigidBodyIndex + isLocal(uint8) + velocity(3×float32) + torque(3×float32)
        index = reader.readRigidBodyIndex();
        reader.pos += 1 + 12 + 12;
      } else {
        throw new Error(`未知 morph type: ${type}`);
      }
      elements.push({ index, offset });
    }
    morphs.push({ name, type, elements });
  }

  // === Display Frames ===
  const dfCount = reader.readInt32();
  const displayFrames: PmxDisplayFrameData[] = [];
  for (let i = 0; i < dfCount; i++) {
    const name = reader.readString();
    const type = reader.readUint8();
    const elementCount = reader.readInt32();
    const elements: PmxDisplayFrameData["elements"] = [];
    for (let j = 0; j < elementCount; j++) {
      const index = type === 1 ? reader.readBoneIndex() : reader.readMorphIndex();
      const value = reader.readFloat32();
      elements.push({ index, value });
    }
    displayFrames.push({ name, type, elements });
  }

  // === Rigid Bodies ===
  const rbCount = reader.readInt32();
  const rigidBodies: PmxRigidBodyData[] = [];
  for (let i = 0; i < rbCount; i++) {
    const name = reader.readString();
    const boneIndex = reader.readBoneIndex();
    const group = reader.readUint8();
    const collisionGroup = reader.readUint8();
    const shapeType = reader.readUint8();
    const shapeSize: [number, number, number] = [
      reader.readFloat32(), reader.readFloat32(), reader.readFloat32(),
    ];
    const position: [number, number, number] = [
      reader.readFloat32(), reader.readFloat32(), reader.readFloat32(),
    ];
    const rotation: [number, number, number] = [
      reader.readFloat32(), reader.readFloat32(), reader.readFloat32(),
    ];
    const mass = reader.readFloat32();
    const linearDamping = reader.readFloat32();
    const angularDamping = reader.readFloat32();
    const friction = reader.readFloat32();
    const restitution = reader.readFloat32();
    const mode = reader.readUint8();
    rigidBodies.push({
      name, boneIndex, group, collisionGroup, shapeType, shapeSize,
      position, rotation, mass, linearDamping, angularDamping,
      friction, restitution, mode,
    });
  }

  // === Joints ===
  const jointCount = reader.readInt32();
  const joints: PmxJointData[] = [];
  for (let i = 0; i < jointCount; i++) {
    const name = reader.readString();
    const rbA = reader.readJointIndex();
    const rbB = reader.readJointIndex();
    const type = reader.readUint8();
    const position: [number, number, number] = [
      reader.readFloat32(), reader.readFloat32(), reader.readFloat32(),
    ];
    const rotation: [number, number, number] = [
      reader.readFloat32(), reader.readFloat32(), reader.readFloat32(),
    ];
    const joint: PmxJointData = { name, rigidBodyIndexA: rbA, rigidBodyIndexB: rbB, type, position, rotation };

    if ((type & 0x01) !== 0) {
      joint.positionMin = [reader.readFloat32(), reader.readFloat32(), reader.readFloat32()];
      joint.positionMax = [reader.readFloat32(), reader.readFloat32(), reader.readFloat32()];
    }
    if ((type & 0x02) !== 0) {
      joint.rotationMin = [reader.readFloat32(), reader.readFloat32(), reader.readFloat32()];
      joint.rotationMax = [reader.readFloat32(), reader.readFloat32(), reader.readFloat32()];
    }
    if ((type & 0x04) !== 0) {
      joint.springPosition = [reader.readFloat32(), reader.readFloat32(), reader.readFloat32()];
    }
    if ((type & 0x08) !== 0) {
      joint.springRotation = [reader.readFloat32(), reader.readFloat32(), reader.readFloat32()];
    }
    joints.push(joint);
  }

  return {
    id: 0,
    ok: true,
    header: {
      version,
      encoding: reader.encoding,
      additionalDataFlags: reader.additionalFlags,
    },
    vertices: vertexData,
    faces: faceData,
    textures,
    materials,
    bones,
    rigidBodies,
    joints,
    morphs,
    displayFrames,
  };
}

// ===== Worker 消息处理 =====
self.onmessage = async (e: MessageEvent<PmxParseRequest>) => {
  const { id, bytes } = e.data;
  try {
    const result = parsePMX(bytes);
    result.id = id;
    // 传输 ArrayBuffer 的 transferable 数据
    const transferables: Transferable[] = [];
    if (result.vertices) {
      transferables.push(
        result.vertices.positions.buffer,
        result.vertices.normals.buffer,
        result.vertices.uvs.buffer,
        result.vertices.boneIndices.buffer,
        result.vertices.boneWeights.buffer,
      );
    }
    if (result.faces) {
      transferables.push(result.faces.indices.buffer);
    }
    (self as unknown as Worker).postMessage(result, transferables);
  } catch (err) {
    const resp: PmxParseResponse = {
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    (self as unknown as Worker).postMessage(resp);
  }
};

export {};
