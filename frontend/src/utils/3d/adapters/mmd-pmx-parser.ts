// ===== PMX 解析器（主线程 Builder）=====
// 与 mmd-pmx-parser.worker.ts 配合：Worker 解析 PMX 二进制 → 产出结构化数据
// → 主线程本模块将结构化数据构建为 Three.js 对象（BufferGeometry / Material / Bone）。
// P2 切片：重负载同步构建拆成 rAF 帧片段，避免长帧卡顿。

import * as THREE from "three";
import type {
  PmxParseRequest,
  PmxParseResponse,
  PmxVertexData,
  PmxFaceData,
  PmxMaterialData,
  PmxBoneData,
} from "./mmd-pmx-parser.worker.ts";

// ===== rAF 切片工具 =====
// 每帧处理预算（毫秒），留给浏览器 60fps 渲染的时间
const FRAME_BUDGET_MS = 12;

/** 让出主线程一帧（requestAnimationFrame），用于重负载切片 */
function yieldToFrame(): Promise<void> {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

/** 同步时间片检查：超出预算则让出一帧，重置计时 */
async function checkBudget(startTime: number): Promise<void> {
  if (performance.now() - startTime > FRAME_BUDGET_MS) {
    await yieldToFrame();
  }
}

/** Builder 配置 */
export interface PmxBuilderConfig {
  /** 纹理路径 → blob URL 映射（复用 MMDLoader 的 URLModifier 逻辑） */
  texUrlMap: Map<string, string>;
  /** maxBoneInfluence: 每顶点最大影响骨骼数 */
  maxBoneInfluence?: number;
}

/** Builder 产出 */
export interface PmxBuildResult {
  mesh: THREE.SkinnedMesh;
  geometry: THREE.BufferGeometry;
  materials: THREE.MeshStandardMaterial[];
  bones: THREE.Bone[];
  skeleton: THREE.Skeleton;
}

/** PMX 解析器管理器 */
export interface PmxParser {
  /** 解析 PMX 文件（Worker 中解析，返回结构化数据） */
  parse(bytes: ArrayBuffer): Promise<PmxParseResponse>;
  /** 释放 Worker */
  dispose(): void;
}

/** 创建 PMX 解析器（Worker） */
export function createPmxParser(): PmxParser {
  // 降级守卫：测试/受限环境无 Worker（vitest node）——返回 always-fail parser，
  // 调用方（mmd-adapter）会 fallback 到 MMDLoader 主路径（对齐 web-stats 降级契约）
  if (typeof Worker === "undefined") {
    return {
      parse: () => Promise.resolve({ id: 0, ok: false, error: "Worker 不可用（测试/受限环境）" }),
      dispose: () => undefined,
    };
  }

  const worker = new Worker(
    new URL("./mmd-pmx-parser.worker.ts", import.meta.url),
    { type: "module" },
  );

  let nextId = 0;
  const pending = new Map<number, {
    resolve: (r: PmxParseResponse) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  worker.onmessage = (e: MessageEvent<PmxParseResponse>) => {
    const { id } = e.data;
    const entry = pending.get(id);
    if (entry) {
      clearTimeout(entry.timer);
      pending.delete(id);
      entry.resolve(e.data);
    }
  };

  function parse(bytes: ArrayBuffer): Promise<PmxParseResponse> {
    return new Promise((resolve) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve({ id, ok: false, error: "PMX 解析超时（>30s）" });
      }, 30000);

      pending.set(id, { resolve, timer });

      const req: PmxParseRequest = { id, bytes };
      worker.postMessage(req, [bytes]);
    });
  }

  function dispose() {
    worker.terminate();
    pending.clear();
  }

  return { parse, dispose };
}

/**
 * 从 Worker 解析结果构建 Three.js 场景对象。
 * 只构建核心几何 + 材质 + 骨骼，MMD 特有功能（toon/sdf/physics）仍由 MMDLoader 处理。
 */
export function buildPmxScene(
  parsed: PmxParseResponse,
  config: PmxBuilderConfig,
): PmxBuildResult | null {
  if (!parsed.ok || !parsed.vertices || !parsed.faces) return null;

  const { vertices, faces, materials: pmxMaterials, bones: pmxBones } = parsed;
  const maxBoneInfluence = config.maxBoneInfluence ?? 4;

  // --- 1. 创建 BufferGeometry ---
  const geometry = new THREE.BufferGeometry();

  // 位置
  geometry.setAttribute("position", new THREE.BufferAttribute(vertices.positions, 3));
  // 法线
  geometry.setAttribute("normal", new THREE.BufferAttribute(vertices.normals, 3));
  // UV
  if (vertices.uvs.length > 0) {
    geometry.setAttribute("uv", new THREE.BufferAttribute(vertices.uvs, 2));
  }

  // 骨骼索引
  if (vertices.boneIndices.length > 0) {
    const boneIndexAttr = new THREE.BufferAttribute(vertices.boneIndices, 4);
    boneIndexAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("skinIndex", boneIndexAttr);
  }

  // 骨骼权重
  if (vertices.boneWeights.length > 0) {
    const weightAttr = new THREE.BufferAttribute(vertices.boneWeights, 4);
    weightAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("skinWeight", weightAttr);
  }

  // 索引
  geometry.setIndex(new THREE.BufferAttribute(faces.indices, 1));

  // --- 2. 创建材质 ---
  const materialCount = pmxMaterials?.length ?? 1;
  const materials: THREE.MeshStandardMaterial[] = [];
  for (let i = 0; i < materialCount; i++) {
    const pmxMat = pmxMaterials?.[i];
    const mat = new THREE.MeshStandardMaterial({
      name: pmxMat?.name ?? `material_${i}`,
      color: pmxMat
        ? new THREE.Color(pmxMat.diffuse[0], pmxMat.diffuse[1], pmxMat.diffuse[2])
        : new THREE.Color(1, 1, 1),
      transparent: pmxMat ? pmxMat.diffuse[3] < 1 : false,
      opacity: pmxMat ? pmxMat.diffuse[3] : 1,
      side: pmxMat ? (pmxMat.flags & 0x01 ? THREE.DoubleSide : THREE.FrontSide) : THREE.FrontSide,
      metalness: 0,
      roughness: 1,
    });

    // 纹理
    if (pmxMat && pmxMat.textureIndex >= 0 && parsed.textures) {
      const texPath = parsed.textures[pmxMat.textureIndex];
      if (texPath) {
        // 用 blob URL 加载纹理（复用 MMDLoader 的 TextureLoader）
        const blobUrl = config.texUrlMap.get(texPath) ?? config.texUrlMap.get(texPath.split("/").pop() ?? "");
        if (blobUrl) {
          const texLoader = new THREE.TextureLoader();
          texLoader.load(blobUrl, (texture) => {
            texture.colorSpace = THREE.SRGBColorSpace;
            mat.map = texture;
            mat.needsUpdate = true;
          });
        }
      }
    }

    materials.push(mat);
  }

  // --- 3. 创建骨骼 ---
  const bones: THREE.Bone[] = [];
  if (pmxBones && pmxBones.length > 0) {
    for (let i = 0; i < pmxBones.length; i++) {
      const pmxBone = pmxBones[i];
      const bone = new THREE.Bone();
      bone.name = pmxBone.name;
      bone.position.set(pmxBone.position[0], pmxBone.position[1], pmxBone.position[2]);

      if (pmxBone.hasPositionOffset && pmxBone.positionOffset) {
        bone.position.x += pmxBone.positionOffset[0];
        bone.position.y += pmxBone.positionOffset[1];
        bone.position.z += pmxBone.positionOffset[2];
      }

      if (pmxBone.hasRotationOffset && pmxBone.rotationOffset) {
        const q = pmxBone.rotationOffset;
        bone.quaternion.set(q[0], q[1], q[2], q[3]);
      }

      bones.push(bone);
    }

    // 构建父子关系
    for (let i = 0; i < pmxBones.length; i++) {
      const parent = pmxBones[i].parent;
      if (parent >= 0 && parent < bones.length) {
        bones[parent].add(bones[i]);
      }
    }
  }

  // --- 4. 创建 Skeleton ---
  const skeleton = new THREE.Skeleton(bones);

  // --- 5. 创建 SkinnedMesh ---
  const mesh = new THREE.SkinnedMesh(geometry, materials.length === 1 ? materials[0] : materials);
  mesh.add(bones[0] ?? new THREE.Bone());
  mesh.bind(skeleton);

  return { mesh, geometry, materials, bones, skeleton };
}

/**
 * 异步切片版 buildPmxScene：将重负载同步构建拆成 rAF 帧片段。
 * 每步完成后让出主线程，保证 60fps 流畅。
 * P2 核心收益：避免大模型（10w+ 顶点 / 100+ 骨骼）的单帧长卡顿。
 */
export async function buildPmxSceneSliced(
  parsed: PmxParseResponse,
  config: PmxBuilderConfig,
): Promise<PmxBuildResult | null> {
  if (!parsed.ok || !parsed.vertices || !parsed.faces) return null;

  const { vertices, faces, materials: pmxMaterials, bones: pmxBones } = parsed;
  const maxBoneInfluence = config.maxBoneInfluence ?? 4;
  const frameStart = performance.now();

  // --- Step 1: BufferGeometry ---
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(vertices.positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(vertices.normals, 3));
  if (vertices.uvs.length > 0) {
    geometry.setAttribute("uv", new THREE.BufferAttribute(vertices.uvs, 2));
  }
  if (vertices.boneIndices.length > 0) {
    const boneIndexAttr = new THREE.BufferAttribute(vertices.boneIndices, 4);
    boneIndexAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("skinIndex", boneIndexAttr);
  }
  if (vertices.boneWeights.length > 0) {
    const weightAttr = new THREE.BufferAttribute(vertices.boneWeights, 4);
    weightAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("skinWeight", weightAttr);
  }
  geometry.setIndex(new THREE.BufferAttribute(faces.indices, 1));
  await checkBudget(frameStart);

  // --- Step 2: Materials（切片） ---
  const materialCount = pmxMaterials?.length ?? 1;
  const materials: THREE.MeshStandardMaterial[] = [];
  const materialSlice = Math.max(1, Math.ceil(materialCount / 4)); // 4 帧分完
  for (let i = 0; i < materialCount; i++) {
    if (i > 0 && i % materialSlice === 0) await yieldToFrame();
    const pmxMat = pmxMaterials?.[i];
    const mat = new THREE.MeshStandardMaterial({
      name: pmxMat?.name ?? `material_${i}`,
      color: pmxMat
        ? new THREE.Color(pmxMat.diffuse[0], pmxMat.diffuse[1], pmxMat.diffuse[2])
        : new THREE.Color(1, 1, 1),
      transparent: pmxMat ? pmxMat.diffuse[3] < 1 : false,
      opacity: pmxMat ? pmxMat.diffuse[3] : 1,
      side: pmxMat ? (pmxMat.flags & 0x01 ? THREE.DoubleSide : THREE.FrontSide) : THREE.FrontSide,
      metalness: 0,
      roughness: 1,
    });

    if (pmxMat && pmxMat.textureIndex >= 0 && parsed.textures) {
      const texPath = parsed.textures[pmxMat.textureIndex];
      if (texPath) {
        const blobUrl = config.texUrlMap.get(texPath) ?? config.texUrlMap.get(texPath.split("/").pop() ?? "");
        if (blobUrl) {
          const texLoader = new THREE.TextureLoader();
          texLoader.load(blobUrl, (texture) => {
            texture.colorSpace = THREE.SRGBColorSpace;
            mat.map = texture;
            mat.needsUpdate = true;
          });
        }
      }
    }
    materials.push(mat);
  }
  await checkBudget(frameStart);

  // --- Step 3: Bones 切片 ---
  const bones: THREE.Bone[] = [];
  if (pmxBones && pmxBones.length > 0) {
    const boneSlice = Math.max(1, Math.ceil(pmxBones.length / 4));
    for (let i = 0; i < pmxBones.length; i++) {
      if (i > 0 && i % boneSlice === 0) await yieldToFrame();
      const pmxBone = pmxBones[i];
      const bone = new THREE.Bone();
      bone.name = pmxBone.name;
      bone.position.set(pmxBone.position[0], pmxBone.position[1], pmxBone.position[2]);
      if (pmxBone.hasPositionOffset && pmxBone.positionOffset) {
        bone.position.x += pmxBone.positionOffset[0];
        bone.position.y += pmxBone.positionOffset[1];
        bone.position.z += pmxBone.positionOffset[2];
      }
      if (pmxBone.hasRotationOffset && pmxBone.rotationOffset) {
        const q = pmxBone.rotationOffset;
        bone.quaternion.set(q[0], q[1], q[2], q[3]);
      }
      bones.push(bone);
    }

    // 父子关系（切片）
    const relSlice = Math.max(1, Math.ceil(pmxBones.length / 4));
    for (let i = 0; i < pmxBones.length; i++) {
      if (i > 0 && i % relSlice === 0) await yieldToFrame();
      const parent = pmxBones[i].parent;
      if (parent >= 0 && parent < bones.length) {
        bones[parent].add(bones[i]);
      }
    }
  }
  await checkBudget(frameStart);

  // --- Step 4: Skeleton + SkinnedMesh ---
  const skeleton = new THREE.Skeleton(bones);
  const mesh = new THREE.SkinnedMesh(geometry, materials.length === 1 ? materials[0] : materials);
  mesh.add(bones[0] ?? new THREE.Bone());
  mesh.bind(skeleton);

  return { mesh, geometry, materials, bones, skeleton };
}