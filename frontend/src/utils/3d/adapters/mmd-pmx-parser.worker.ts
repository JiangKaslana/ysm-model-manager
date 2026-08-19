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

/** 骨骼数据 */
export interface PmxBoneData {
  name: string;
  parent: number; // -1 = root
  position: [number, number, number];
  rotation: [number, number, number, number]; // quaternion
  hasPositionOffset: boolean;
  hasRotationOffset: boolean;
  positionOffset?: [number, number, number];
  rotationOffset?: [number, number, number, number];
  hasIK: boolean;
  ikTarget?: number;
  ikChildren?: Array<{ boneIndex: number; angle: number }>;
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
class PmxReader {
  private view: DataView;
  private u8: Uint8Array;
  pos = 0;
  public encoding: "utf-8" | "utf-16" = "utf-8";
  public additionalFlags = 0;
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

  // 计算索引大小：根据 count 确定最小字节数
  static indexSizeFor(count: number): number {
    if (count <= 127) return 1;
    if (count <= 32767) return 2;
    return 4;
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

// ===== PMX 解析 =====
function parsePMX(buffer: ArrayBuffer): PmxParseResponse {
  const reader = new PmxReader(buffer);

  // --- Header ---
  const magic = new TextDecoder("ascii").decode(new Uint8Array(buffer, 0, 4));
  if (magic !== "PMX ") {
    return { id: 0, ok: false, error: `无效 PMX 文件：magic="${magic}"` };
  }

  const version = `${reader.readFloat32().toFixed(2)}`;
  const encodingByte = reader.readUint8();
  reader.encoding = encodingByte === 0 ? "utf-8" : "utf-16";
  reader.additionalFlags = reader.readUint8();
  const headerEnd = reader.position;

  // --- 结构预扫描：记录所有 block 位置和 count ---
  reader.pos = headerEnd;
  const struct = scanStructure(reader);

  // 从预扫描结果提取 count
  const vertexCount = struct.vertex.count;
  const faceCount = struct.face.count;
  const texCount = struct.texture.count;
  const matCount = struct.material.count;
  const boneCount = struct.bone.count;
  const rbCount = struct.rigidBody.count;
  const jointCount = struct.joint.count;
  const morphCount = struct.morph.count;
  const dfCount = struct.displayFrame.count;

  // 根据预扫描结果确定全局索引大小
  reader.boneIndexSize = PmxReader.indexSizeFor(boneCount);
  reader.textureIndexSize = PmxReader.indexSizeFor(texCount);
  reader.materialIndexSize = PmxReader.indexSizeFor(matCount);
  reader.rigidBodyIndexSize = PmxReader.indexSizeFor(rbCount);
  reader.jointIndexSize = PmxReader.indexSizeFor(jointCount);
  reader.morphIndexSize = PmxReader.indexSizeFor(morphCount);
  reader.displayFrameIndexSize = PmxReader.indexSizeFor(Math.max(boneCount, morphCount));

  // 解析顶点布局 flag
  const hasUV = (reader.additionalFlags & 0x01) !== 0;
  const hasExtraUV = (reader.additionalFlags & 0x02) !== 0;
  const boneWeightType = (reader.additionalFlags >> 3) & 0x03;
  const hasExtendedDeform = (reader.additionalFlags & 0x80) !== 0;

  // === Vertices ===
  // PMX 规范：position(12) + normal(12) + [UV(8)] + [ExtraUV(8)] + deform + [extended(4)]
  // ⚠️ deform 的骨骼索引大小随全局 boneCount（reader.boneIndexSize：1/2/4 字节），
  // vertexSize 必须同步动态计算，否则 boneCount>127 时顶点数据错位、蒙皮错乱
  const boneIndexSize = reader.boneIndexSize;
  /** 对齐到 4 字节（PMX deform 的 padding 规则） */
  const align4 = (n: number): number => Math.ceil(n / 4) * 4;
  let vertexSize = 12 + 12;
  if (hasUV) vertexSize += 8;
  if (hasExtraUV) vertexSize += 8;
  // PMX 规范 deform 大小（随 boneIndexSize）：
  //   BDEF1 = align4(indexSize + 4)   （1 索引 + padding + 1 权重）
  //   BDEF2 = align4(2×indexSize) + 4 （2 索引 + padding + 1 权重）
  //   BDEF4 = 4×indexSize + 16        （4 索引 + 4 权重）
  if (boneWeightType === 2) {
    vertexSize += align4(boneIndexSize + 4);
  } else if (boneWeightType === 1) {
    vertexSize += align4(2 * boneIndexSize) + 4;
  } else {
    vertexSize += 4 * boneIndexSize + 16;
  }
  if (hasExtendedDeform) vertexSize += 4;

  const vertexData = (() => {
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const uvs = hasUV ? new Float32Array(vertexCount * 2) : new Float32Array(0);
    // 骨骼索引数组宽度随 boneIndexSize（>255 骨骼时 2/4 字节，Uint8 会截断）
    const boneIndices = boneIndexSize === 2
      ? new Uint16Array(vertexCount * 4)
      : boneIndexSize === 4
        ? new Uint32Array(vertexCount * 4)
        : new Uint8Array(vertexCount * 4);
    const boneWeights = new Float32Array(vertexCount * 4);

    const vertexDataStart = struct.vertex.pos + 8; // skip blockSize(4) + count(4)

    /** 按 boneIndexSize 读骨骼索引（小端） */
    const readBoneIdx = (view: DataView, off: number): number => {
      switch (boneIndexSize) {
        case 2: return view.getUint16(off, true);
        case 4: return view.getUint32(off, true);
        default: return view.getUint8(off);
      }
    };

    for (let i = 0; i < vertexCount; i++) {
      const vOffset = vertexDataStart + i * vertexSize;
      const u8view = new Uint8Array(buffer, vOffset, vertexSize);
      const view = new DataView(buffer, vOffset, vertexSize);

      // Position (12 bytes)
      positions[i * 3] = view.getFloat32(0, true);
      positions[i * 3 + 1] = view.getFloat32(4, true);
      positions[i * 3 + 2] = view.getFloat32(8, true);

      // Normal (12 bytes)
      normals[i * 3] = view.getFloat32(12, true);
      normals[i * 3 + 1] = view.getFloat32(16, true);
      normals[i * 3 + 2] = view.getFloat32(20, true);

      let cursor = 24;

      // UV (8 bytes)
      if (hasUV) {
        uvs[i * 2] = view.getFloat32(cursor, true);
        uvs[i * 2 + 1] = view.getFloat32(cursor + 4, true);
        cursor += 8;
      }
      if (hasExtraUV) cursor += 8;

      // Bone weights and indices (严格 PMX 规范，索引大小随 boneIndexSize)
      if (boneWeightType === 2) {
        // BDEF1: index(indexSize) + padding(align4- indexSize) + weight(4) = align4(indexSize)+4
        const bi = readBoneIdx(view, cursor);
        boneIndices[i * 4] = bi;
        boneIndices[i * 4 + 1] = bi;
        boneIndices[i * 4 + 2] = bi;
        boneIndices[i * 4 + 3] = bi;
        const w = view.getFloat32(cursor + align4(boneIndexSize), true);
        boneWeights[i * 4] = w;
        boneWeights[i * 4 + 1] = 0;
        boneWeights[i * 4 + 2] = 0;
        boneWeights[i * 4 + 3] = 0;
        cursor += align4(boneIndexSize) + 4;
      } else if (boneWeightType === 1) {
        // BDEF2: 2×index(indexSize) + padding + weight(4) = align4(2×indexSize)+4
        const bi0 = readBoneIdx(view, cursor);
        const bi1 = readBoneIdx(view, cursor + boneIndexSize);
        boneIndices[i * 4] = bi0;
        boneIndices[i * 4 + 1] = bi1;
        boneIndices[i * 4 + 2] = 0;
        boneIndices[i * 4 + 3] = 0;
        const w = view.getFloat32(cursor + align4(2 * boneIndexSize), true);
        boneWeights[i * 4] = w;
        boneWeights[i * 4 + 1] = 1 - w;
        boneWeights[i * 4 + 2] = 0;
        boneWeights[i * 4 + 3] = 0;
        cursor += align4(2 * boneIndexSize) + 4;
      } else {
        // BDEF4: 4×index(indexSize) + 4×weight(4) = 4×indexSize+16
        boneIndices[i * 4] = readBoneIdx(view, cursor);
        boneIndices[i * 4 + 1] = readBoneIdx(view, cursor + boneIndexSize);
        boneIndices[i * 4 + 2] = readBoneIdx(view, cursor + 2 * boneIndexSize);
        boneIndices[i * 4 + 3] = readBoneIdx(view, cursor + 3 * boneIndexSize);
        boneWeights[i * 4] = view.getFloat32(cursor + 4 * boneIndexSize, true);
        boneWeights[i * 4 + 1] = view.getFloat32(cursor + 4 * boneIndexSize + 4, true);
        boneWeights[i * 4 + 2] = view.getFloat32(cursor + 4 * boneIndexSize + 8, true);
        boneWeights[i * 4 + 3] = view.getFloat32(cursor + 4 * boneIndexSize + 12, true);
        cursor += 4 * boneIndexSize + 16;
      }

      if (hasExtendedDeform) cursor += 4;
    }

    return { count: vertexCount, positions, normals, uvs, boneIndices, boneWeights };
  })();

  // === Faces ===
  const faceIndexSize = PmxReader.indexSizeFor(vertexCount);
  const faceData = (() => {
    if (faceCount === 0) {
      return { count: 0, indices: new Uint32Array(0) } as PmxFaceData;
    }
    const faceDataStart = struct.face.pos + 8; // skip blockSize(4) + count(4)
    const indices = new Uint32Array(faceCount * 3);
    const totalBytes = faceCount * 3 * faceIndexSize;
    const faceView = new DataView(buffer, faceDataStart, totalBytes);
    const faceU8 = new Uint8Array(buffer, faceDataStart, totalBytes);

    for (let i = 0; i < faceCount * 3; i++) {
      const off = i * faceIndexSize;
      switch (faceIndexSize) {
        case 1: indices[i] = faceU8[off]; break;
        case 2: indices[i] = faceView.getUint16(off, true); break;
        case 4: indices[i] = faceView.getUint32(off, true); break;
        default: indices[i] = 0;
      }
    }
    return { count: faceCount, indices } as PmxFaceData;
  })();

  // === Textures ===
  reader.pos = struct.texture.pos + 8;
  const textures: string[] = [];
  for (let i = 0; i < texCount; i++) {
    textures.push(reader.readString());
  }

  // === Materials ===
  reader.pos = struct.material.pos + 8;
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
  reader.pos = struct.bone.pos + 8;
  const bones: PmxBoneData[] = [];
  for (let i = 0; i < boneCount; i++) {
    const name = reader.readString();
    const parent = reader.readBoneIndex();
    const position: [number, number, number] = [
      reader.readFloat32(), reader.readFloat32(), reader.readFloat32(),
    ];
    const rotation: [number, number, number, number] = [0, 0, 0, 1];
    const flags = reader.readUint16();

    const hasPositionOffset = (flags & 0x01) !== 0;
    const hasRotationOffset = (flags & 0x02) !== 0;
    const hasIK = (flags & 0x10) !== 0;

    const bone: PmxBoneData = {
      name, parent, position, rotation,
      hasPositionOffset, hasRotationOffset, hasIK,
    };

    if (hasPositionOffset) {
      bone.positionOffset = [reader.readFloat32(), reader.readFloat32(), reader.readFloat32()];
    }
    if (hasRotationOffset) {
      bone.rotationOffset = [reader.readFloat32(), reader.readFloat32(), reader.readFloat32(), reader.readFloat32()];
    }
    if (hasIK) {
      bone.ikTarget = reader.readBoneIndex();
      const ikChildCount = reader.readUint8();
      bone.ikChildren = [];
      for (let j = 0; j < ikChildCount; j++) {
        bone.ikChildren.push({
          boneIndex: reader.readBoneIndex(),
          angle: reader.readFloat32(),
        });
      }
    }

    bones.push(bone);
  }

  // === Rigid Bodies ===
  reader.pos = struct.rigidBody.pos + 8;
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
  reader.pos = struct.joint.pos + 8;
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

  // === Morphs ===
  reader.pos = struct.morph.pos + 8;
  const morphs: PmxMorphData[] = [];
  for (let i = 0; i < morphCount; i++) {
    const name = reader.readString();
    const type = reader.readUint8();
    const elementCount = reader.readInt32();
    const elements: PmxMorphData["elements"] = [];
    for (let j = 0; j < elementCount; j++) {
      const index = reader.readMorphIndex();
      let offset: [number, number, number] = [0, 0, 0];
      if (type === 1) {
        offset = [reader.readFloat32(), reader.readFloat32(), reader.readFloat32()];
      } else if (type === 2) {
        offset = [reader.readFloat32(), reader.readFloat32(), reader.readFloat32()];
        reader.pos += 4;
      } else if (type === 3) {
        offset = [reader.readFloat32(), reader.readFloat32(), 0];
      } else {
        offset = [reader.readFloat32(), reader.readFloat32(), reader.readFloat32()];
        if (type === 0) {
          const subCount = reader.readInt32();
          reader.pos += subCount * 4;
        }
      }
      elements.push({ index, offset });
    }
    morphs.push({ name, type, elements });
  }

  // === Display Frames ===
  reader.pos = struct.displayFrame.pos + 8;
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
