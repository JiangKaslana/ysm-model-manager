// ===== FBX 内容适配器（ADR-112：独立 FBX 预览地基）=====
// 经 Go 绑定 ReadFileBytes 取字节 → blob URL → three FBXLoader 解析 →
// 挂入核心场景 + 灯光 + 包围盒定相机；AnimationMixer 播内嵌 animations，
// 经核心 perFrame 循环驱动。通用外壳（overlay/renderer/循环/释放）由 mount-preview-core.ts 拥有。
//
// 关键边界：FBX 是「模型 + 骨架 + 内嵌动画」完整容器，≠ MMD 动画格式。
// 本适配器只做独立预览；FBX→PMX 重定向（骨骼映射 + 单位换算）属 ADR-112 明确推迟的重活。

import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import type { PreviewBuildCtx, PreviewScene } from "./mount-preview-core.ts";
import { screenshotFromRenderer } from "../screenshot.ts";
import { safeErrorMessage } from "../../safe-error-msg.ts";
import { recordLoadTrace } from "../load-trace.ts";

/** FBX 数据端口（视图壳注入，适配器 0 backend import——ADR-072 边界判据） */
export interface FbxDataPort {
  readFileBytes(path: string): Promise<string | null>;
  addOpLog?(op: string, msg: string, status: "ok" | "fail" | "warn", err?: string): Promise<void>;
}

/** base64 → Uint8Array（ReadFileBytes 返回 Go []byte 的 base64 序列化） */
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Uint8Array → ArrayBuffer（Blob 构造要求 ArrayBufferView<ArrayBuffer>，规避 SharedArrayBuffer 泛型） */
function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** 环形日志面板诊断（AGENTS.md：排查卡顿往环形日志塞日志而非死盯 console）；失败静默不阻断 */
async function fbxDiag(
  port: FbxDataPort,
  op: string,
  msg: string,
  status: "ok" | "fail" | "warn",
  err?: string,
): Promise<void> {
  try {
    await port.addOpLog?.(op, msg, status, err);
  } catch {
    /* 诊断不阻断加载 */
  }
}

/** 释放单材质及其贴图（geometry 在外层 traverse 释放） */
function disposeMaterial(mat: THREE.Material): void {
  const m = mat as THREE.Material & {
    map?: THREE.Texture | null;
    emissiveMap?: THREE.Texture | null;
    normalMap?: THREE.Texture | null;
  };
  for (const tex of [m.map, m.emissiveMap, m.normalMap]) tex?.dispose();
  mat.dispose();
}

/**
 * 构建 FBX 内容场景（ADR-112 地基）。
 * @param ctx   统一预览上下文（核心提供 scene/camera/controls/renderer）
 * @param path  FBX 文件绝对路径（Wails 下经 Go RPC 取字节，浏览器读不了本地盘）
 * @param port  数据端口（readFileBytes / 可选诊断日志）
 */
export async function buildFbxScene(ctx: PreviewBuildCtx, path: string, port: FbxDataPort): Promise<PreviewScene> {
  // 1) 取字节 → blob URL（Wails 读不了本地盘，必须经 Go RPC 取字节再包 URL）
  const tStart = performance.now();
  const b64 = await port.readFileBytes(path);
  if (!b64) {
    throw new Error("FBX 字节读取失败（ReadFileBytes 返回空）");
  }
  const blobUrl = URL.createObjectURL(
    new Blob([bytesToArrayBuffer(b64ToBytes(b64))], { type: "application/octet-stream" }),
  );

  // 2) 加载（默认 LoadingManager：内嵌纹理自动处理；外链纹理为 ADR-112 🟡 后续）
  const manager = new THREE.LoadingManager();
  const loader = new FBXLoader(manager);
  let group: THREE.Group & { animations: THREE.AnimationClip[] };
  try {
    group = await new Promise<THREE.Group & { animations: THREE.AnimationClip[] }>((resolve, reject) => {
      loader.load(
        blobUrl,
        (g) => resolve(g as THREE.Group & { animations: THREE.AnimationClip[] }),
        undefined,
        (e) => reject(e instanceof Error ? e : new Error(safeErrorMessage(e))),
      );
    });
    await fbxDiag(port, "fbx-load", `已加载 ${path}`, "ok");
  } catch (e) {
    await fbxDiag(port, "fbx-load", "FBX 解析失败", "fail", safeErrorMessage(e));
    throw e;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
  const tLoadEnd = performance.now();
  // 加载剖析
  let meshCount = 0, texCount = 0;
  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      meshCount++;
      const mat = (o as THREE.Mesh).material;
      if (Array.isArray(mat)) texCount += mat.length;
      else if (mat) texCount++;
    }
  });
  recordLoadTrace({
    ts: Date.now(),
    format: "fbx",
    path,
    stages: [{ name: "加载", ms: Math.round(tLoadEnd - tStart), status: "ok" }],
    assets: { files: 1, textures: texCount, materials: texCount, animations: group.animations?.length ?? 0, fbxAnimations: group.animations?.length ?? 0 },
    ok: true,
  });

  if (ctx.scene) ctx.scene.add(group);

  // 3) 动画：播全部内嵌 clip（FBX 通常为单段角色动画）
  let mixer: THREE.AnimationMixer | null = null;
  if (group.animations && group.animations.length > 0) {
    mixer = new THREE.AnimationMixer(group);
    for (const clip of group.animations) mixer.clipAction(clip).play();
    await fbxDiag(port, "fbx-anim", `内嵌动画 ${group.animations.length} 段`, "ok");
  }

  // 4) 相机取景（镜像 vrm-adapter.ts:267，包围盒定相机 + controls 约束）
  const box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  if (ctx.camera) {
    ctx.camera.near = 0.05;
    ctx.camera.far = maxDim * 50;
    ctx.camera.position.set(center.x, center.y + size.y * 0.1, center.z + maxDim * 1.6);
    ctx.camera.updateProjectionMatrix();
  }
  if (ctx.controls) {
    ctx.controls.target.copy(center);
    ctx.controls.minDistance = maxDim * 0.1;
    ctx.controls.maxDistance = maxDim * 12;
    ctx.controls.update();
  }

  return {
    update: (dt: number) => {
      mixer?.update(dt);
    },
    dispose: () => {
      try {
        mixer?.stopAllAction();
        if (ctx.scene) ctx.scene.remove(group);
        group.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.geometry) mesh.geometry.dispose();
          const mat = mesh.material;
          if (Array.isArray(mat)) mat.forEach((m) => disposeMaterial(m));
          else if (mat) disposeMaterial(mat as THREE.Material);
        });
      } catch {
        /* 释放容错 */
      }
    },
    screenshot: () =>
      Promise.resolve(
        ctx.renderer && ctx.scene && ctx.camera
          ? screenshotFromRenderer(ctx.renderer, ctx.scene, ctx.camera)
          : null,
      ),
  };
}
