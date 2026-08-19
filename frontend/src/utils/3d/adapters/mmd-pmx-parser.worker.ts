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
  boneIndices: Uint8Array;   // bone indices[4] * count (packed: 4 * uint8)
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

// ===== PMX 解析 =====
function parsePMX(buffer: ArrayBuffer): PmxParseResponse {
  const reader = new PmxReader(buffer);

  // --- Header ---
  const magic = new TextDecoder("ascii").decode(new Uint8Array(buffer, 0, 4));
  if (magic !== "PMX " && magic !== "PMX\x20") {
    return { id: 0, ok: false, error: `无效 PMX 文件：magic="${magic}"` };
  }

  const version = `${reader.readFloat32().toFixed(2)}`;
  const encodingByte = reader.readUint8();
  reader.encoding = encodingByte === 0 ? "utf-8" : "utf-16";
  reader.additionalFlags = reader.readUint8();

  // 根据计数动态设置索引大小
  // 先跳过 header 剩余部分，逐个块解析时再计算

  // --- Vertices ---
  const vertexBlockSize = reader.readBlockSize();
  const vertexCount = reader.readInt32();

  // 计算顶点数据布局
  const hasUV = (reader.additionalFlags & 0x01) !== 0;
  const hasExtraUV = (reader.additionalFlags & 0x02) !== 0;
  const boneWeightType = (reader.additionalFlags >> 3) & 0x03; // 0=BDEF1, 1=BDEF2, 2=BDEF4
  const hasExtendedDeform = (reader.additionalFlags & 0x80) !== 0;

  // 计算每个顶点的大小
  let vertexSize = 12 + 12; // position(3) + normal(3) = 24 bytes
  if (hasUV) vertexSize += 8; // uv(2) = 8 bytes
  if (hasExtraUV) vertexSize += 8; // extra uv
  // 骨骼索引
  if (boneWeightType === 2) {
    vertexSize += 4; // BDEF1: 1 bone index
    reader.boneIndexSize = 1;
  } else if (boneWeightType === 1) {
    vertexSize += 8 + 4; // BDEF2: 2 indices + 2 weights
    reader.boneIndexSize = 1;
  } else {
    vertexSize += 16 + 16; // BDEF4: 4 indices + 4 weights
    reader.boneIndexSize = 1;
  }
  if (hasExtendedDeform) vertexSize += 4;

  // 动态确定骨骼索引大小
  // 需要先知道骨骼数量，但骨骼数据在后面。
  // PMX 文件通常在 header 里就确定了索引大小，我们先假设 1 字节，后续修正
  // 为简单起见，我们在解析完骨骼后再处理

  // 重新读取顶点数据（简化版：用 float32 读取，跳过复杂逻辑）
  // 实际解析需要精确计算每个顶点的布局
  // 这里做一个简化的解析

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = hasUV ? new Float32Array(vertexCount * 2) : new Float32Array(0);
  const boneIndices = new Uint8Array(vertexCount * 4);
  const boneWeights = new Float32Array(vertexCount * 4);

  let offset = reader.position;
  for (let i = 0; i < vertexCount; i++) {
    const vOffset = offset + i * vertexSize;
    const view = new DataView(buffer, vOffset, vertexSize);

    // Position
    positions[i * 3] = view.getFloat32(0, true);
    positions[i * 3 + 1] = view.getFloat32(4, true);
    positions[i * 3 + 2] = view.getFloat32(8, true);

    // Normal
    normals[i * 3] = view.getFloat32(12, true);
    normals[i * 3 + 1] = view.getFloat32(16, true);
    normals[i * 3 + 2] = view.getFloat32(20, true);

    let cursor = 24;

    // UV
    if (hasUV) {
      uvs[i * 2] = view.getFloat32(cursor, true);
      uvs[i * 2 + 1] = view.getFloat32(cursor + 4, true);
      cursor += 8;
    }
    if (hasExtraUV) cursor += 8;

    // Bone weights
    if (boneWeightType === 2) {
      // BDEF1
      const bi = view.getUint8(cursor);
      boneIndices[i * 4] = bi;
      boneIndices[i * 4 + 1] = bi;
      boneIndices[i * 4 + 2] = bi;
      boneIndices[i * 4 + 3] = bi;
      boneWeights[i * 4] = 1;
      boneWeights[i * 4 + 1] = 0;
      boneWeights[i * 4 + 2] = 0;
      boneWeights[i * 4 + 3] = 0;
      cursor += 4;
    } else if (boneWeightType === 1) {
      // BDEF2
      const bi0 = view.getUint8(cursor);
      const bi1 = view.getUint8(cursor + 1);
      const w0 = view.getFloat32(cursor + 2, true);
      boneIndices[i * 4] = bi0;
      boneIndices[i * 4 + 1] = bi1;
      boneIndices[i * 4 + 2] = 0;
      boneIndices[i * 4 + 3] = 0;
      boneWeights[i * 4] = w0;
      boneWeights[i * 4 + 1] = 1 - w0;
      boneWeights[i * 4 + 2] = 0;
      boneWeights[i * 4 + 3] = 0;
      cursor += 8;
    } else {
      // BDEF4
      boneIndices[i * 4] = view.getUint8(cursor);
      boneIndices[i * 4 + 1] = view.getUint8(cursor + 1);
      boneIndices[i * 4 + 2] = view.getUint8(cursor + 2);
      boneIndices[i * 4 + 3] = view.getUint8(cursor + 3);
      boneWeights[i * 4] = view.getFloat32(cursor + 4, true);
      boneWeights[i * 4 + 1] = view.getFloat32(cursor + 8, true);
      boneWeights[i * 4 + 2] = view.getFloat32(cursor + 12, true);
      boneWeights[i * 4 + 3] = view.getFloat32(cursor + 16, true);
      cursor += 20;
    }

    if (hasExtendedDeform) cursor += 4;
  }
  reader.pos = offset + vertexBlockSize + 4; // 4 = block size field itself

  const vertexData: PmxVertexData = {
    count: vertexCount,
    positions,
    normals,
    uvs,
    boneIndices,
    boneWeights,
  };

  // --- Faces ---
  const faceBlockSize = reader.readBlockSize();
  const faceCount = reader.readInt32();
  const indexSize = PmxReader.indexSizeFor(vertexCount);
  reader.pos += 4; // skip faceCount (already read)

  // 重新计算 faces
  const faceStart = reader.position;
  const indices = new Uint32Array(faceCount * 3);
  for (let i = 0; i < faceCount * 3; i++) {
    switch (indexSize) {
      case 1: indices[i] = reader.readUint8(); break;
      case 2: indices[i] = reader.readUint16(); break;
      case 4: indices[i] = reader.readUint32(); break;
      default: indices[i] = 0;
    }
  }
  reader.pos = faceStart + faceBlockSize + 4;

  const faceData: PmxFaceData = { count: faceCount, indices };

  // --- Textures ---
  const texBlockSize = reader.readBlockSize();
  const texCount = reader.readInt32();
  reader.pos += 4;
  const textures: string[] = [];
  for (let i = 0; i < texCount; i++) {
    textures.push(reader.readString());
  }
  reader.pos = texBlockSize > 0 ? reader.position : reader.pos;
  // 确保位置正确
  const texEnd = faceStart + faceBlockSize + 4 + 4 + texBlockSize + 4;
  reader.pos = texEnd > reader.pos ? texEnd : reader.pos;

  // --- Materials ---
  const matBlockSize = reader.readBlockSize();
  const matCount = reader.readInt32();
  reader.pos += 4;
  reader.materialIndexSize = PmxReader.indexSizeFor(matCount);

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

  // --- Bones ---
  const boneBlockSize = reader.readBlockSize();
  const boneCount = reader.readInt32();
  reader.pos += 4;
  reader.boneIndexSize = PmxReader.indexSizeFor(boneCount);

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

  // --- Rigid Bodies ---
  const rbBlockSize = reader.readBlockSize();
  const rbCount = reader.readInt32();
  reader.pos += 4;
  reader.rigidBodyIndexSize = PmxReader.indexSizeFor(rbCount);

  const rigidBodies: PmxRigidBodyData[] = [];
  for (let i = 0; i < rbCount; i++) {
    const name = reader.readString();
    const boneIndex = reader.readRigidBodyIndex();
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

  // --- Joints ---
  const jointBlockSize = reader.readBlockSize();
  const jointCount = reader.readInt32();
  reader.pos += 4;
  reader.jointIndexSize = PmxReader.indexSizeFor(jointCount);

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

  // --- Morphs ---
  const morphBlockSize = reader.readBlockSize();
  const morphCount = reader.readInt32();
  reader.pos += 4;
  reader.morphIndexSize = PmxReader.indexSizeFor(morphCount);

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
        // vertex morph: position offset
        offset = [reader.readFloat32(), reader.readFloat32(), reader.readFloat32()];
      } else if (type === 2) {
        // bone morph: rotation quaternion
        offset = [reader.readFloat32(), reader.readFloat32(), reader.readFloat32()];
        reader.pos += 4; // w component
      } else if (type === 3) {
        // UV morph: UV offset
        offset = [reader.readFloat32(), reader.readFloat32(), 0];
      } else {
        // group / additional: skip remaining data
        offset = [reader.readFloat32(), reader.readFloat32(), reader.readFloat32()];
        if (type === 0) {
          // group: count + indices
          const subCount = reader.readInt32();
          reader.pos += subCount * 4;
        }
      }
      elements.push({ index, offset });
    }
    morphs.push({ name, type, elements });
  }

  // --- Display Frames ---
  const dfBlockSize = reader.readBlockSize();
  const dfCount = reader.readInt32();
  reader.pos += 4;
  reader.displayFrameIndexSize = PmxReader.indexSizeFor(dfCount);

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