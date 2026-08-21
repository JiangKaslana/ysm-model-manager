// ===== FBX worker 场景序列化（ADR-112）=====
// FBXLoader.parse()（vendor/fbx/FBXLoader.ts 官方源码副本）直接产出 THREE.Group，
// worker 内无法跨线程回传 THREE 对象：fbxSceneToData 把 Group 抽成纯数据
// （几何数组 / 材质参数 / 骨骼 + boneInverses / 动画轨道 / 纹理文件名），
// 主线程凭 FbxSceneData 重建场景。纹理文件名由 worker 端 manager handler
// 经 captureTextureName 登记（镜像 mmd-pmx-parser.worker.ts 的纯数据契约）。

import * as THREE from "three";

export interface FbxGeometryData {
  position: Float32Array;
  normal?: Float32Array;
  uv?: Float32Array;
  uv2?: Float32Array;
  color?: Float32Array;
  skinIndex?: Uint16Array;
  skinWeight?: Float32Array;
  index?: Uint32Array;
}

export interface FbxMaterialData {
  type: string;
  name?: string;
  color: number[];
  specular?: number[];
  shininess?: number;
  emissive: number[];
  transparent?: boolean;
  opacity?: number;
  map?: string;
  normalMap?: string;
  specularMap?: string;
  alphaMap?: string;
  emissiveMap?: string;
}

export interface FbxSkeletonData {
  bones: Array<{
    name: string;
    position: number[];
    quaternion: number[];
    parent: number;
  }>;
  boneInverses: Float32Array;
  bindMatrix: Float32Array;
}

export interface FbxMeshData {
  name: string;
  transform: {
    position: number[];
    quaternion: number[];
    scale: number[];
  };
  geometry: FbxGeometryData;
  materials: FbxMaterialData[];
  hasSkeleton: boolean;
  skeleton?: FbxSkeletonData;
}

export interface FbxClipData {
  name: string;
  duration: number;
  tracks: Array<{
    name: string;
    times: Float32Array;
    values: Float32Array;
  }>;
}

export interface FbxSceneData {
  meshes: FbxMeshData[];
  animations: FbxClipData[];
}

const textureFileNames = new WeakMap<THREE.Texture, string>();

export function captureTextureName(tex: THREE.Texture, fileName: string): void {
  textureFileNames.set(tex, fileName);
}

function toColor(c: unknown): number[] {
  const color = c as THREE.Color;
  return color ? [color.r, color.g, color.b] : [1, 1, 1];
}

function serializeMaterial(mat: THREE.Material): FbxMaterialData {
  const anyMat = mat as unknown as Record<string, unknown>;
  const out: FbxMaterialData = {
    type: mat.type,
    name: typeof anyMat.name === "string" ? (anyMat.name as string) : undefined,
    color: toColor(anyMat.color),
    emissive: toColor(anyMat.emissive),
  };
  const texNameOf = (key: string): string | undefined => {
    const tex = anyMat[key] as THREE.Texture | undefined;
    return tex && typeof tex.isTexture === "boolean" ? textureFileNames.get(tex) : undefined;
  };
  const optional = (key: string, write: (v: unknown) => void): void => {
    const v = anyMat[key];
    if (v !== undefined && v !== null) write(v);
  };
  optional("specular", (v) => { out.specular = toColor(v); });
  optional("shininess", (v) => { out.shininess = v as number; });
  optional("transparent", (v) => { out.transparent = v as boolean; });
  optional("opacity", (v) => { out.opacity = v as number; });
  for (const key of ["map", "normalMap", "specularMap", "alphaMap", "emissiveMap"] as const) {
    const name = texNameOf(key);
    if (name) out[key] = name;
  }
  return out;
}

function serializeGeometry(geo: THREE.BufferGeometry): FbxGeometryData {
  const getAttr = (
    name: string,
    ctor: { from(a: ArrayLike<number>): Float32Array | Uint16Array | Uint32Array },
  ): (Float32Array | Uint16Array | Uint32Array) | undefined => {
    const attr = geo.getAttribute(name);
    return attr ? ctor.from(attr.array as ArrayLike<number>) : undefined;
  };
  const out: FbxGeometryData = { position: getAttr("position", Float32Array) as Float32Array };
  for (const name of ["normal", "uv", "uv2", "color", "skinWeight"] as const) {
    const arr = getAttr(name, Float32Array);
    if (arr) (out as unknown as Record<string, unknown>)[name] = arr;
  }
  const skinIndex = geo.getAttribute("skinIndex");
  if (skinIndex) out.skinIndex = Uint16Array.from(skinIndex.array as ArrayLike<number>);
  const index = geo.getIndex();
  if (index) out.index = Uint32Array.from(index.array as ArrayLike<number>);
  return out;
}

function serializeSkeleton(mesh: THREE.SkinnedMesh): FbxSkeletonData {
  const skeleton = mesh.skeleton;
  const indexOf = new Map<THREE.Object3D, number>();
  skeleton.bones.forEach((b, i) => indexOf.set(b, i));
  return {
    bones: skeleton.bones.map((b) => ({
      name: b.name,
      position: [b.position.x, b.position.y, b.position.z],
      quaternion: [b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w],
      parent: b.parent ? (indexOf.get(b.parent) ?? -1) : -1,
    })),
    boneInverses: Float32Array.from(skeleton.boneInverses.flatMap((m) => Array.from(m.elements))),
    bindMatrix: Float32Array.from(mesh.bindMatrix.elements),
  };
}

function serializeMesh(mesh: THREE.Mesh): FbxMeshData {
  const materialsArray = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const geo = mesh.geometry as THREE.BufferGeometry;
  const out: FbxMeshData = {
    name: mesh.name,
    transform: {
      position: [mesh.position.x, mesh.position.y, mesh.position.z],
      quaternion: [mesh.quaternion.x, mesh.quaternion.y, mesh.quaternion.z, mesh.quaternion.w],
      scale: [mesh.scale.x, mesh.scale.y, mesh.scale.z],
    },
    geometry: serializeGeometry(geo),
    materials: materialsArray
      .filter((m): m is THREE.Material => Boolean(m))
      .map((m) => serializeMaterial(m)),
    hasSkeleton: false,
  };
  const skinned = mesh as THREE.SkinnedMesh;
  if (skinned.isSkinnedMesh && skinned.skeleton && skinned.skeleton.bones.length > 0) {
    out.hasSkeleton = true;
    out.skeleton = serializeSkeleton(skinned);
  }
  return out;
}

export function fbxSceneToData(group: THREE.Object3D): FbxSceneData {
  const meshes: FbxMeshData[] = [];
  group.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) meshes.push(serializeMesh(obj as THREE.Mesh));
  });
  const anims = (group as THREE.Object3D & { animations?: THREE.AnimationClip[] }).animations;
  return {
    meshes,
    animations: (anims ?? []).map((clip) => ({
      name: clip.name,
      duration: clip.duration,
      tracks: clip.tracks.map((track) => ({
        name: track.name,
        times: track.times as Float32Array,
        values: track.values as Float32Array,
      })),
    })),
  };
}