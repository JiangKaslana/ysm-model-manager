// ===== VRM 内容适配器（ADR-066 P3：从 vrm-3d.ts 抽离内容层）=====
// 本文件只负责 VRM 专属逻辑：经 Go 绑定 ReadFileBytes 取字节 → 官方 GLTFLoader +
// VRMLoaderPlugin 解析 → rotateVRM0 摆正 → 注入核心场景 + 灯光 + 包围盒定相机。
// 通用外壳（overlay/renderer/循环/释放）由 mount-preview-core.ts 拥有。

import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import { getApp } from "../../backend/app.ts";
import { t } from "../../core/i18n/t.ts";
import type { PreviewBuildCtx, PreviewScene } from "./mount-preview-core.ts";

/** base64 → Uint8Array（ReadFileBytes 返回 Go []byte 的 base64 序列化） */
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** VRM 内容构建：把模型挂入核心 scene，返回每帧 update + dispose */
export async function buildVrmScene(ctx: PreviewBuildCtx, path: string): Promise<PreviewScene> {
  ctx.loadingEl.innerHTML =
    '<div style="font-size:32px">🥽</div><div>' + t("preview.loadingModel") + '</div><div style="width:200px;height:3px;background:rgba(255,255,255,0.1);border-radius:2px;overflow:hidden"><div style="height:100%;width:30%;background:var(--accent,#7c83ff);border-radius:2px;animation:ysm-prog 1.5s ease-in-out infinite"></div></div>';

  const App = await getApp();
  const readFn = (App as unknown as Record<string, (p: string) => Promise<string | null>>)["ReadFileBytes"];
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
