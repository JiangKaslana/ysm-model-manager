// ===== FBX 解析器（主线程）=====
// worker 端 FBXLoader.parse → fbxSceneToData 纯数据 → 主线程本模块
// buildFbxSceneFromData 重建 Three.js 场景（几何/材质/骨骼 + boneInverses/bindMatrix/动画）。
// createFbxParser 镜像 mmd-pmx-parser.ts：Worker 降级守卫 + 30s 超时 + transferable。

import * as THREE from "three";
import type { FbxParseRequest, FbxParseResponse } from "./fbx-parser.worker.ts";
import type {
  FbxSceneData,
  FbxMeshData,
  FbxGeometryData,
  FbxSkeletonData,
} from "./fbx-scene-to-data.ts";

/** FBX 解析器管理器（接口对齐 PmxParser） */
export interface FbxParser {
  /** 解析 FBX 文件（Worker 中解析，返回结构化数据） */
  parse(bytes: ArrayBuffer): Promise<FbxParseResponse>;
  /** 释放 Worker */
  dispose(): void;
}

/** 创建 FBX 解析器（Worker）。测试/受限环境无 Worker → always-fail 降级守卫，
 *  调用方（fbx-adapter）会 fallback 到主线程 FBXLoader 路径 */
export function createFbxParser(): FbxParser {
  if (typeof Worker === "undefined") {
    return {
      parse: () => Promise.resolve({ id: 0, ok: false, error: "Worker 不可用（测试/受限环境）" }),
      dispose: () => undefined,
    };
  }

  const worker = new Worker(
    new URL("./fbx-parser.worker.ts", import.meta.url),
    { type: "module" },
  );

  let nextId = 0;
  const pending = new Map<number, {
    resolve: (r: FbxParseResponse) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  worker.onmessage = (e: MessageEvent<FbxParseResponse>) => {
    const { id } = e.data;
    const entry = pending.get(id);
    if (entry) {
      clearTimeout(entry.timer);
      pending.delete(id);
      entry.resolve(e.data);
    }
  };

  worker.onerror = (ev: ErrorEvent) => {
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer);
      pending.delete(id);
      entry.resolve({ id, ok: false, error: `Worker 错误: ${ev.message}` });
    }
  };

  function parse(bytes: ArrayBuffer): Promise<FbxParseResponse> {
    return new Promise((resolve) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve({ id, ok: false, error: "FBX 解析超时（>30s）" });
      }, 30000);

      pending.set(id, { resolve, timer });

      const req: FbxParseRequest = { id, bytes };
      worker.postMessage(req, [bytes]);
    });
  }

  function dispose() {
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer);
      entry.resolve({ id, ok: false, error: "Worker 已终止" });
    }
    pending.clear();
    worker.terminate();
  }

  return { parse, dispose };
}

/** 场景重建配置 */
export interface FbxSceneBuilderConfig {
  /** 纹理文件名 → blob URL 映射（主线程加载外链纹理；缺省不挂纹理） */
  texUrlMap?: ReadonlyMap<string, string>;
}

function buildGeometry(geo: FbxGeometryData): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const setAttr = (
    name: string,
    arr: Float32Array | Uint16Array | Uint32Array | undefined,
    itemSize: number,
  ): void => {
    if (!arr) return;
    geometry.setAttribute(name, new THREE.BufferAttribute(arr, itemSize));
  };
  setAttr("position", geo.position, 3);
  setAttr("normal", geo.normal, 3);
  setAttr("uv", geo.uv, 2);
  setAttr("uv2", geo.uv2, 2);
  setAttr("color", geo.color, 3);
  setAttr("skinIndex", geo.skinIndex, 4);
  setAttr("skinWeight", geo.skinWeight, 4);
  if (geo.index) {
    geometry.setIndex(new THREE.BufferAttribute(geo.index, 1));
  }
  return geometry;
}

/** 按序列化材质类型还原（FBXLoader 默认 Phong；unknown 类型回退 Phong） */
function buildMaterial(mat: {
  type: string;
  name?: string;
  color: number[];
  specular?: number[];
  shininess?: number;
  emissive: number[];
  transparent?: boolean;
  opacity?: number;
  map?: string;
}): THREE.Material {
  let material: THREE.Material;
  const base = {
    name: mat.name,
    color: new THREE.Color(mat.color[0], mat.color[1], mat.color[2]),
    emissive: new THREE.Color(mat.emissive[0], mat.emissive[1], mat.emissive[2]),
    transparent: mat.transparent ?? false,
    opacity: mat.opacity ?? 1,
  };
  switch (mat.type) {
    case "MeshStandardMaterial":
      material = new THREE.MeshStandardMaterial(base);
      break;
    case "MeshLambertMaterial":
      material = new THREE.MeshLambertMaterial(base);
      break;
    case "MeshBasicMaterial":
      material = new THREE.MeshBasicMaterial(base);
      break;
    case "MeshPhongMaterial":
    default: {
      const phong = new THREE.MeshPhongMaterial(base);
      if (mat.specular !== undefined) {
        phong.specular = new THREE.Color(mat.specular[0], mat.specular[1], mat.specular[2]);
      }
      if (mat.shininess !== undefined) phong.shininess = mat.shininess;
      material = phong;
      break;
    }
  }
  // 纹理文件名暂存 userData；texUrlMap 命中时异步加载，避免阻塞场景重建
  if (mat.map) material.userData.textureName = mat.map;
  return material;
}

function applyTexture(
  material: THREE.Material,
  texUrlMap: ReadonlyMap<string, string> | undefined,
): void {
  const name = material.userData.textureName as string | undefined;
  if (!name || !texUrlMap) return;
  // FBX 文件内大小写可能与磁盘不一致 → 双查（原样 + lowercase）
  const blobUrl = texUrlMap.get(name) ?? texUrlMap.get(name.toLowerCase());
  if (!blobUrl) return;
  const texLoader = new THREE.TextureLoader();
  texLoader.load(blobUrl, (texture) => {
    texture.colorSpace = THREE.SRGBColorSpace;
    (material as THREE.MeshPhongMaterial).map = texture;
    material.needsUpdate = true;
  });
}

function buildSkeleton(skel: FbxSkeletonData): { bones: THREE.Bone[]; skeleton: THREE.Skeleton } {
  const bones = skel.bones.map((b) => {
    const bone = new THREE.Bone();
    bone.name = b.name;
    bone.position.fromArray(b.position);
    bone.quaternion.fromArray(b.quaternion);
    return bone;
  });
  skel.bones.forEach((b, i) => {
    const parentIdx = b.parent;
    if (parentIdx >= 0 && parentIdx < bones.length) bones[parentIdx].add(bones[i]);
  });
  const boneInverses: THREE.Matrix4[] = [];
  const count = skel.boneInverses.length / 16;
  for (let i = 0; i < count; i++) {
    boneInverses.push(new THREE.Matrix4().fromArray(skel.boneInverses as unknown as number[], i * 16));
  }
  return { bones, skeleton: new THREE.Skeleton(bones, boneInverses) };
}

function buildMesh(
  meshData: FbxMeshData,
  texUrlMap: ReadonlyMap<string, string> | undefined,
): THREE.Mesh | THREE.SkinnedMesh {
  const geometry = buildGeometry(meshData.geometry);
  const materials = meshData.materials.map((m) => buildMaterial(m));
  materials.forEach((m) => applyTexture(m, texUrlMap));
  const material: THREE.Material | THREE.Material[] = materials.length === 1 ? materials[0] : materials;

  let mesh: THREE.Mesh | THREE.SkinnedMesh;
  if (meshData.hasSkeleton && meshData.skeleton) {
    const { bones, skeleton } = buildSkeleton(meshData.skeleton);
    const skinned = new THREE.SkinnedMesh(geometry, material);
    // 显式传 bindMatrix（FBXLoader.bindSkeleton 同口径：TransformLink 逆矩阵序列化而来），
    // 避免 Skeleton.calculateInverses 用 identity 重算
    skinned.bind(skeleton, new THREE.Matrix4().fromArray(meshData.skeleton.bindMatrix as unknown as number[]));
    // 根骨骼挂到 mesh（镜像 attachRootBones：FBX 可多根，漏挂 → matrixWorld 不更新 → 蒙皮错位）
    let rootAdded = false;
    for (const bone of bones) {
      if (bone.parent === null) {
        skinned.add(bone);
        rootAdded = true;
      }
    }
    if (!rootAdded && bones.length > 0) skinned.add(bones[0]);
    mesh = skinned;
  } else {
    mesh = new THREE.Mesh(geometry, material);
  }

  mesh.name = meshData.name;
  mesh.position.fromArray(meshData.transform.position);
  mesh.quaternion.fromArray(meshData.transform.quaternion);
  mesh.scale.fromArray(meshData.transform.scale);
  return mesh;
}

/** 轨道类路由：FBXLoader 命名锚点见 vendor/FBXLoader（modelName.quaternion / .position / .scale / .morphTargetInfluences[N]） */
function buildTrack(name: string, times: Float32Array, values: Float32Array): THREE.KeyframeTrack {
  if (name.endsWith(".quaternion")) return new THREE.QuaternionKeyframeTrack(name, times, values);
  if (name.includes(".morphTargetInfluences")) return new THREE.NumberKeyframeTrack(name, times, values);
  if (values.length / Math.max(1, times.length) === 1) return new THREE.NumberKeyframeTrack(name, times, values);
  return new THREE.VectorKeyframeTrack(name, times, values);
}

/** 从 worker 产出的纯数据重建 Three.js 场景（FBX worker 路径的主线程构建器） */
export function buildFbxSceneFromData(data: FbxSceneData, config: FbxSceneBuilderConfig = {}): THREE.Group {
  const texUrlMap = config.texUrlMap;
  const group = new THREE.Group();
  for (const meshData of data.meshes) {
    group.add(buildMesh(meshData, texUrlMap));
  }
  const clips = data.animations.map(
    (clip) =>
      new THREE.AnimationClip(
        clip.name,
        clip.duration,
        clip.tracks.map((track) => buildTrack(track.name, track.times, track.values)),
      ),
  );
  (group as THREE.Group & { animations: THREE.AnimationClip[] }).animations = clips;
  return group;
}