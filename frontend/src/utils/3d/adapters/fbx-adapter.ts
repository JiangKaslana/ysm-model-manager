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
import { disposeMaterial } from "../mesh.ts";
import { b64ToBytes, bytesToArrayBuffer } from "../base64.ts";

/** FBX 数据端口（视图壳注入，适配器 0 backend import——ADR-072 边界判据） */
export interface FbxDataPort {
  readFileBytes(path: string): Promise<string | null>;
  addOpLog?(op: string, msg: string, status: "ok" | "fail" | "warn", err?: string): Promise<void>;
}

/** FBX 归一化目标：包围盒最长边（单位）。对齐 MMD 厘米惯例（1.6m 人体 ≈ 160），
 *  与场景能力雾距（50-800，厘米尺度）及 MMD 同框尺度一致；cm/m 导出差 100× 均收敛于此。 */
export const FBX_TARGET_MAX_DIM = 160;

/** Box3 尺度归一结果（factor 供诊断日志回显，size/center 为缩放后坐标） */
export interface FbxScaleInfo {
  /** 实际应用的均匀缩放系数（1 = 未缩放） */
  factor: number;
  /** 缩放后包围盒尺寸 */
  size: THREE.Vector3;
  /** 缩放后包围盒中心 */
  center: THREE.Vector3;
}

/**
 * Box3 尺度归一（ADR-112 P1）：DCC 导出单位混乱（cm/m/Unity units 可差 100×）时，
 * 模型要么小到穿近平面看不见、要么顶天立地顶爆场景能力。均匀缩放组根节点，
 * 使包围盒最长边贴合 FBX_TARGET_MAX_DIM；等比缩放不破坏宽高比，
 * 骨骼动画在局部空间运算，组缩放不干扰 AnimationClip。
 * 空组 / 零尺寸 / 非有限值退化：factor=1 原样返回，不抛错。
 */
export function normalizeFbxScale(group: THREE.Group): FbxScaleInfo {
  const box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(maxDim) || maxDim <= 0) {
    return { factor: 1, size, center };
  }
  const factor = FBX_TARGET_MAX_DIM / maxDim;
  group.scale.multiplyScalar(factor);
  // 组根节点等比缩放（绕组本地原点），包围盒尺寸与中心随之等比放大
  size.multiplyScalar(factor);
  center.multiplyScalar(factor);
  return { factor, size, center };
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

  // ADR-112 P1 尺度归一：DCC 导出单位混乱（cm/m 差 100×）→ 包围盒最长边归一至 FBX_TARGET_MAX_DIM。
  // 否则小模型穿近平面（near=0.05 恒值）看不见、大模型顶爆场景能力（雾距 50-800 厘米尺度）。
  const scaleInfo = normalizeFbxScale(group);
  if (scaleInfo.factor !== 1) {
    await fbxDiag(port, "fbx-scale", `尺度归一 ×${scaleInfo.factor.toFixed(3)}`, "warn");
  }

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
