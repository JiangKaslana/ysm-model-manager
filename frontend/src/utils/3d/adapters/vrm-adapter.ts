// ===== VRM 内容适配器（ADR-066 P3：从 vrm-3d.ts 抽离内容层）=====
// 本文件只负责 VRM 专属逻辑：经 Go 绑定 ReadFileBytes 取字节 → 官方 GLTFLoader +
// VRMLoaderPlugin 解析 → rotateVRM0 摆正 → 注入核心场景 + 灯光 + 包围盒定相机。
// 通用外壳（overlay/renderer/循环/释放）由 mount-preview-core.ts 拥有。

import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import { t } from "../../../core/i18n/t.ts";
import type { PreviewBuildCtx, PreviewScene } from "./mount-preview-core.ts";

/** base64 → Uint8Array（ReadFileBytes 返回 Go []byte 的 base64 序列化） */
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** 把 THREE.Texture / HTMLImageElement 转 dataURL（meta 卡缩略图） */
function imageToDataURL(img: unknown): string {
  try {
    // VRM0 meta.texture 是 THREE.Texture（取 .image）；VRM1 meta.thumbnailImage 直接是 HTMLImageElement
    const holder = img as { image?: unknown } | null;
    const raw = holder && typeof holder.image !== "undefined" ? holder.image : img;
    const source = raw as HTMLImageElement | HTMLCanvasElement | ImageBitmap | null;
    if (!source) return "";
    const w =
      source instanceof HTMLImageElement
        ? source.naturalWidth
        : (source as HTMLCanvasElement | ImageBitmap).width;
    const h =
      source instanceof HTMLImageElement
        ? source.naturalHeight
        : (source as HTMLCanvasElement | ImageBitmap).height;
    if (!w || !h) return "";
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext("2d");
    if (!g) return "";
    g.drawImage(source as CanvasImageSource, 0, 0);
    return canvas.toDataURL("image/png");
  } catch {
    return "";
  }
}

/** VRM meta 归一化信息（meta 卡展示用） */
export interface VrmMetaInfo {
  name: string;
  authors: string[];
  version?: string;
  license?: string;
  contact?: string;
  thumbnail?: string; // dataURL，空串表示无缩略图
  metaVersion: "0" | "1";
}

/** 解析 VRM meta（不渲染 3D，parse 后立即 deepDispose），失败返回 null */
export async function readVrmMeta(
  path: string,
  readFn: (p: string) => Promise<string | null>,
): Promise<VrmMetaInfo | null> {
  try {
    const b64 = await readFn(path);
    if (!b64) return null;

    const bytes = b64ToBytes(b64);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    const gltf = await new Promise<GLTF>((resolve, reject) => {
      loader.parse(buffer, "", resolve, reject);
    });
    const vrm = (gltf.userData as { vrm?: VRM }).vrm;
    if (!vrm) return null;
    const meta = vrm.meta;
    let info: VrmMetaInfo;
    if (meta.metaVersion === "0") {
      info = {
        metaVersion: "0",
        name: meta.title || "",
        authors: meta.author ? [meta.author] : [],
        version: meta.version,
        license: meta.licenseName ? meta.licenseName + (meta.otherLicenseUrl ? " · " + meta.otherLicenseUrl : "") : undefined,
        contact: meta.contactInformation,
        thumbnail: meta.texture ? imageToDataURL(meta.texture) : "",
      };
    } else {
      info = {
        metaVersion: "1",
        name: meta.name || "",
        authors: meta.authors || [],
        version: meta.version,
        license: meta.licenseUrl,
        contact: meta.contactInformation,
        thumbnail: meta.thumbnailImage ? imageToDataURL(meta.thumbnailImage) : "",
      };
    }
    VRMUtils.deepDispose(vrm.scene); // 仅取 meta，释放 parse 出的 GPU 资源
    return info;
  } catch {
    return null;
  }
}

/** VRM 内容构建：把模型挂入核心 scene，返回每帧 update + dispose */
export async function buildVrmScene(
  ctx: PreviewBuildCtx,
  path: string,
  readFn: (p: string) => Promise<string | null>,
): Promise<PreviewScene> {
  ctx.loadingEl.innerHTML =
    '<div style="font-size:32px">🥽</div><div>' + t("preview.loadingModel") + '</div><div style="width:200px;height:3px;background:rgba(255,255,255,0.1);border-radius:2px;overflow:hidden"><div style="height:100%;width:30%;background:var(--accent,#7c83ff);border-radius:2px;animation:ysm-prog 1.5s ease-in-out infinite"></div></div>';

  const b64 = await readFn(path);
  if (!b64) throw new Error("ReadFileBytes 返回空");

  const bytes = b64ToBytes(b64);
  // GLTFLoader.parse 要求 ArrayBuffer
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

  const loader = new GLTFLoader();
  // v3 架构：往官方 GLTFLoader 注册 VRM 插件（不接管资源管线）
  loader.register((parser) => new VRMLoaderPlugin(parser));

  const gltf = await new Promise<GLTF>((resolve, reject) => {
    loader.parse(buffer, "", resolve, reject);
  });
  const vrm = (gltf.userData as { vrm?: VRM }).vrm;
  if (!vrm) throw new Error("VRM 实例解析失败（非标准 .vrm？）");

  // VRM0.0 模型背对镜头，转正；VRM1.0 为 no-op 但调用安全
  VRMUtils.rotateVRM0(vrm);
  ctx.scene!.add(vrm.scene);
  ctx.loadingEl.remove(); // 加载完成，移除占位（旧 vrm-3d.ts:172 同款）

  // 包围盒定相机（VRM 原点在脚底、Y-up、面朝 +Z）
  const box = new THREE.Box3().setFromObject(vrm.scene);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;

  ctx.camera!.near = 0.05;
  ctx.camera!.far = maxDim * 50;
  ctx.camera!.position.set(center.x, center.y + size.y * 0.1, center.z + maxDim * 1.6);
  ctx.camera!.updateProjectionMatrix();

  ctx.controls!.target.copy(center);
  ctx.controls!.minDistance = maxDim * 0.1;
  ctx.controls!.maxDistance = maxDim * 12;
  ctx.controls!.update();

  // MToon 材质对光有响应，补环境 + 主光 + 半球光
  ctx.scene!.add(new THREE.AmbientLight(0xffffff, 0.7));
  const dl = new THREE.DirectionalLight(0xffffff, 1.0);
  dl.position.set(1, 2, 1);
  ctx.scene!.add(dl);
  ctx.scene!.add(new THREE.HemisphereLight(0xffffff, 0x444466, 0.4));

  return {
    // VRM 动态部分（SpringBone/表情/LookAt/MToon UV）靠 vrm.update 驱动
    update: (dt: number): void => {
      vrm.update(dt);
    },
    // 释放 VRM 几何/材质/纹理（含 MToon），避免 GPU 缓冲泄漏
    dispose: (): void => {
      VRMUtils.deepDispose(vrm.scene);
    },
  };
}
