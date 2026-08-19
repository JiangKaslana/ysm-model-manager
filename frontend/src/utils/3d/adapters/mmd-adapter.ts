// ===== MMD 内容适配器（ADR-066 P2：富格式前端直引 @moeru/three-mmd）=====
// 本文件只负责 MMD 专属逻辑：经 Go 绑定 ReadFileBytes 取 PMX/PMD 字节 →
// MMDLoader（@moeru/three-mmd，parser 自带，无 babylon 依赖）解析 →
// LoadingManager.setURLModifier 把模型同目录纹理映射为 blob URL（Wails 环境
// 浏览器读不了本地磁盘路径）→ 挂入核心场景 + 灯光 + 包围盒定相机。
// 通用外壳（overlay/renderer/循环/释放）由 mount-preview-core.ts 拥有。

import * as THREE from "three";
import { MMDLoader, VmdObject, buildAnimation, VPDLoader, applyVPD, type VpdObject } from "@moeru/three-mmd";
import { t } from "../../../core/i18n/t.ts";
import type { PreviewBuildCtx, PreviewScene } from "./mount-preview-core.ts";
import type { PreviewMenuItemDef } from "./preview-menu-defs.ts";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { scheduleBackgroundEncoding, cancelPendingEncodings } from "./mmd-ktx2-encoder.ts";
import { getTextureDecoder, applyWorkerDecodedTextures, type DecodedTexture } from "./mmd-texture-decoder.ts";
import { createPmxParser, buildPmxSceneSliced, type PmxParser, type PmxBuildResult } from "./mmd-pmx-parser.ts";
import { Ktx2TextureLoader } from "./mmd-ktx2-texture-loader.ts";
import { startMainThreadWatch, formatLongTask } from "../../../utils/main-thread-watch.ts";
import type {
  MmdBottomNavCtx,
  MmdPlayBridge,
  MaterialControlBridge,
} from "../../../views/app-preview/mmd-controls.ts";
import {
  listMmdMaterials,
  getMmdMaterialDetail,
  setMmdMaterialVisible,
  setMmdMaterialOpacity,
} from "../mmd-materials.ts";
import { mmdBonesToBoneNodes } from "../mmd-bones.ts"; // ADR-077: pmx.bones 索引结构 → BoneNode[]
import { buildBoneTree, type BoneTree } from "../bone-tools.ts";
import { mmdSemanticBoneMap } from "../semantic-bones.ts";
import { mmdSemanticMorphMap } from "../semantic-morphs.ts";
import { makeBonePanelRenderer } from "./vrm-bone-ui.ts"; // ADR-074 S2: 通用骨骼面板
import { createBreathController } from "../perception/breath.ts"; // 语义骨骼消费方：程序化生命力 L1
import { createGazeController } from "../perception/gaze.ts"; // 语义骨骼消费方：程序化生命力 L2
import { createBlinkController } from "../perception/blink.ts"; // 语义 morph 消费方：程序化生命力 L1.5
import { createLipSyncController } from "../perception/lipsync.ts"; // 语义 morph 消费方：程序化生命力 L2
import { createAutoDanceController } from "../perception/autodance.ts"; // 语义骨骼消费方：程序化生命力 L3
import { buildLipMorphIndices } from "../perception/lipsync.ts"; // 多 morph index 提取
import { createFootIKController } from "../mmd-foot-ik.ts"; // 程序化足部锚地（待机态 IK）
import { screenshotFromRenderer } from "../screenshot.ts"; // ADR-052 P3：截图走共享 renderer（通用化）
import { registerModelRoot, unregisterModelRoot } from "../frustum-cull.ts";
// import { createBlinkController } from "../perception/blink.ts"; // 待 three-mmd 暴露 morph 权重 API 后接入

/** 并发读取纹理的分片大小（fallback 路径：readFileBytesBatch 失败时降级）
 * 默认 4：平衡内存占用与 I/O 并发性，适合大多数 MMD 模型（通常 < 20 贴图）。
 * 若项目纹理数量大或网络/磁盘 I/O 慢，可调大（如 8/16）；内存紧张则调小（如 2）。
 * ADR-101：对齐后端 goroutine 池设计哲学。 */
const TEXTURE_READ_CHUNK_SIZE = 4;

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

/** MMD 数据端口（视图壳注入，适配器 0 backend import——ADR-072 边界判据） */
export interface MmdDataPort {
  readFileBytes(path: string): Promise<string | null>;
  readFileBytesBatch(paths: string[]): Promise<Record<string, string | null>>;
  /** 批量读取 + SHA256 hash（一次 RPC 返回数据和哈希，替代前端算 hash） */
  readFileBytesBatchWithMeta?(paths: string[]): Promise<Record<string, { data: string | null; hash: string } | null>>;
  listAllFilePaths(dir: string): Promise<string[] | null>;
  addOpLog(op: string, msg: string, status: "ok" | "fail" | "warn", err?: string): Promise<void>;
  /** 读取纹理文件并检查 KTX2 缓存，返回 { format, data, hash }（已废弃，保留兼容） */
  getCachedTexture?(path: string): Promise<{ format: string; data: string; hash: string } | null>;
}

/** 环形日志面板诊断（AGENTS.md：排查卡顿往环形日志塞日志而非死盯 console）；失败静默不阻断 */
async function mmdDiag(
  port: MmdDataPort,
  op: string,
  msg: string,
  status: "ok" | "fail" | "warn",
  err?: string,
): Promise<void> {
  try {
    await port.addOpLog(op, msg, status, err);
  } catch {
    /* 诊断不阻断加载 */
  }
}

/**
 * 并发分片映射：将 items 按 chunkSize 分组，每组内 Promise.all 并发执行，
 * 组与组之间串行。fallback 批量读取的并发版——避免 N 次串行 await，
 * 又不一次性爆栈（ADR-101 配套前端优化，对齐后端 goroutine 池设计）。
 */
async function concurrentMap<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  chunkSize = TEXTURE_READ_CHUNK_SIZE,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results: R[] = new Array(items.length);
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const chunkResults = await Promise.all(chunk.map((item) => fn(item)));
    for (let j = 0; j < chunkResults.length; j++) {
      results[i + j] = chunkResults[j];
    }
  }
  return results;
}

/** 同目录纹理候选扩展名（PMX/PMD 引用的贴图；.spa/.sph 特殊格式 Image 解不了，命中后降级无贴图） */
const TEXTURE_EXTS = [".png", ".jpg", ".jpeg", ".bmp", ".tga", ".gif", ".webp"];

/** 假 TGA 检测：合法 TGA 头部第 3 字节（图像类型）∈ {1,2,3,9,10,11}；MMD 素材常有扩展名 .tga 但内容非法的占位文件，跳过避免 TGALoader 刷错 */
function isLikelyTga(bytes: Uint8Array): boolean {
  if (bytes.length < 18) return false;
  const type = bytes[2];
  return type === 1 || type === 2 || type === 3 || type === 9 || type === 10 || type === 11;
}

/** 可释放的纹理字段名（MMDToonMaterial 特有 + 标准纹理，对齐 cleanup-3d.ts SAFE_DISPOSE_TEX_KEYS） */
const DISPOSE_TEX_KEYS = [
  "map", "emissiveMap", "normalMap", "roughnessMap",
  "metalnessMap", "aoMap", "lightMap", "alphaMap", "envMap",
  "sphereMap", "toonMap", "displacementMap", "bumpMap",
] as const;

/** 估算纹理 GPU 内存（字节），只计 RGBA 全尺寸；压缩纹理格式不在此列 */
function estimateTexGpuBytes(tex: THREE.Texture): number {
  const img = tex.image as HTMLImageElement | undefined;
  if (!img?.width || !img?.height) return 0;
  // RGBA8888 = 4B/px（最普适场景）；其它格式估算偏保守
  return img.width * img.height * 4;
}

/** 释放 MMD mesh 的全部几何/材质/纹理，并记录统计到环形日志 */
async function disposeMmdMesh(
  mesh: THREE.SkinnedMesh,
  diag: typeof mmdDiag,
  port: MmdDataPort,
  op: string,
): Promise<void> {
  // 收集材质（单材质 / 多材质数组）
  const allMats: THREE.Material[] = Array.isArray(mesh.material)
    ? mesh.material
    : mesh.material
      ? [mesh.material]
      : [];
  let texCount = 0;
  let totalGpuBytes = 0;
  for (const mat of allMats) {
    for (const key of DISPOSE_TEX_KEYS) {
      const tex = (mat as unknown as Record<string, unknown>)[key];
      if (tex instanceof THREE.Texture) {
        totalGpuBytes += estimateTexGpuBytes(tex);
        texCount++;
        try { tex.dispose(); } catch { /* 防御性 */ }
      }
    }
    try { mat.dispose(); } catch { /* 防御性 */ }
  }
  try { mesh.geometry.dispose();
    mesh.skeleton?.dispose(); } catch { /* 防御性 */ }
  const gpuMb = (totalGpuBytes / (1024 * 1024)).toFixed(1);
  void diag(port, op, `tex=${texCount} gpu≈${gpuMb}MB`, "ok");
}

/**
 * MMD 内容构建：读 PMX/PMD 字节 + 同目录纹理 → 挂入核心 scene，返回每帧 update + dispose。
 * 成功路径自行移除 loadingEl（对齐 vrm/litematic 既有口径）。数据读取经 port 注入（ADR-072）。
 */
/** 面板填充回调（视图层注入，解除 utils→views 运行时分层违规 R1；缺失时菜单 render 退化为 no-op） */
export interface MmdPanelHooks {
  fillModelPanel: (list: HTMLElement, ctx: MmdBottomNavCtx) => void;
  fillPlayPanel: (list: HTMLElement, bridge: MmdPlayBridge) => void;
  fillShotPanel: (list: HTMLElement, ctx: MmdBottomNavCtx, screenshot: (() => Promise<string | null>) | null) => void;
  buildMaterialControls: (container: HTMLElement, bridge: MaterialControlBridge) => void;
}

export async function buildMmdScene(
  ctx: PreviewBuildCtx,
  path: string,
  port: MmdDataPort,
  panels?: MmdPanelHooks,
): Promise<PreviewScene> {
  ctx.loadingEl.innerHTML =
    '<div style="font-size:32px">🎭</div><div>' + t("preview.loadingModel") + '</div><div style="width:200px;height:3px;background:rgba(255,255,255,0.1);border-radius:2px;overflow:hidden"><div id="ysm-mmd-progress" style="height:100%;width:5%;background:var(--accent,#7c83ff);border-radius:2px;transition:width 0.2s"></div></div>';

  // 主线程长任务观测（ADR-101 观测增强）：>50ms 同步阻塞塞环形日志，
  // 排查卡顿不再依赖 DevTools trace；dispose / build 失败时断开。
  const stopLongTaskWatch = startMainThreadWatch((info) => {
    void mmdDiag(port, "main-thread", formatLongTask(info), "warn");
  });

  const b64 = await port.readFileBytes(path);
  await mmdDiag(port, "read-model", path, b64 ? "ok" : "fail", b64 ? `bytes=${b64.length}` : "ReadFileBytes 返回空（路径语义/守卫？）");
  if (!b64) throw new Error("ReadFileBytes 返回空");
  const bytes = b64ToBytes(b64);
  const modelBase = (path.split(/[/\\]/).pop() || "").toLowerCase();

  // ---- PMX 二进制解析 Worker（与纹理读取/解码并行，把 ~5s 解析从主线程搬走）----
  const pmxParser: PmxParser = createPmxParser();
  const pmxParsePromise = pmxParser.parse(bytesToArrayBuffer(bytes));
  void mmdDiag(port, "pmx-parse-dispatch", path, "ok", "PMX binary parse dispatched to worker");

  // ---- 同目录文件清单：ListAllFilePaths 递归列全部文件（不能用 ScanModelEntries——
  // 它只返回主文件条目，纹理/VMD 拿不到，URLModifier 全放行导致纹理 502）----
  const dirPath = path.replace(/[^/\\]*$/, "").replace(/[/\\]$/, "");
  const texMap = new Map<string, string>();
  const blobUrls: string[] = [];
  const vmdPaths: string[] = [];
  const vpdPaths: string[] = []; // 同目录 VPD 姿势文件
  // KTX2 缓存映射：纹理相对路径 → KTX2 blob URL（post-load 替换用）
  const texKtx2Map = new Map<string, string>();
  // 纹理内容哈希：纹理相对路径 → SHA256（用于 KTX2 缓存查找）
  const texHashMap = new Map<string, string>();
  // Worker 解码任务：纹理相对路径 → 原始字节（并行解码，与 PMX 解析同时进行）
  const decodeTasks: Array<{ relPath: string; bytes: ArrayBuffer; mimeType: string }> = [];
  // Worker 解码结果 Promise（try 块外声明，确保 loadAsync 后可访问）
  let decodedTexturesPromise: Promise<Map<string, DecodedTexture>> | null = null;
  // 模型本体也注册 blob：MMDLoader 内部 FileLoader 从 URL 读字节（WebView2 读不了磁盘路径），
  // URLModifier 拦截模型 URL → blob 后才可加载。
  const modelBlobUrl = URL.createObjectURL(new Blob([bytesToArrayBuffer(bytes)]));
  blobUrls.push(modelBlobUrl);
  texMap.set(modelBase, modelBlobUrl);
  // blob URL → 相对路径反向映射（post-load KTX2 替换时从纹理 image.src 反查 relPath）
  const blobUrlToRel = new Map<string, string>();
  // blob URL → hash 映射（后台 KTX2 编码用）
  const blobUrlToHash = new Map<string, string>();
  try {
    const files = (await port.listAllFilePaths(dirPath)) || [];
    // ADR-101：批量读取纹理（1 次 RPC 替代 N 次 readFileBytes，减少 Go↔JS IPC 往返）
    const texFiles = files.filter((p) => TEXTURE_EXTS.some((ext) => p.toLowerCase().endsWith(ext)));
    // 优先用 readFileBytesBatchWithMeta（数据 + hash 一次性返回），降级到 readFileBytesBatch
    let texBatch: Record<string, string | null> = {};
    let texHashBatch: Record<string, string> = {};
    if (texFiles.length > 0) {
      try {
        if (port.readFileBytesBatchWithMeta) {
          const metaBatch = await port.readFileBytesBatchWithMeta(texFiles);
          if (metaBatch) {
            for (const p of texFiles) {
              const entry = metaBatch[p];
              if (entry) {
                texBatch[p] = entry.data;
                if (entry.hash) texHashBatch[p] = entry.hash;
              }
            }
          }
        }
        // 回退：如果 readFileBytesBatchWithMeta 不可用或未返回全部数据，用普通 batch 补缺
        if (Object.keys(texBatch).length < texFiles.length) {
          const fallback = await port.readFileBytesBatch(texFiles);
          for (const p of texFiles) {
            if (!(p in texBatch) && fallback[p] !== undefined) {
              texBatch[p] = fallback[p];
            }
          }
        }
      } catch {
        // P0-3 fallback：批量读取失败时降级为并发分片 readFileBytes
        void mmdDiag(port, "batch-read", dirPath, "warn", "批量读取失败，降级并发分片读取");
        const fallbackResults = await concurrentMap(texFiles, async (p) => {
          try {
            return [p, await port.readFileBytes(p)] as const;
          } catch {
            return [p, null] as const;
          }
        });
        for (const [p, v] of fallbackResults) {
          texBatch[p] = v;
        }
      }
    }
    for (const p of texFiles) {
      // 先计算相对路径（rel），后续 KTX2 和 PNG 分支都用到
      const lower = p.toLowerCase().replace(/\\/g, "/");
      const dirNorm = dirPath.toLowerCase().replace(/\\/g, "/");
      const rel = lower.startsWith(dirNorm + "/")
        ? lower.slice(dirNorm.length + 1)
        : lower;
      const baseName = lower.split("/").pop() || "";

      // 从批量读取结果取纹理数据（避免每纹理一次 RPC + SHA256，ADR-101）
      const texB64 = texBatch[p] ?? null;
      if (!texB64) continue;
      const texBytes = b64ToBytes(texB64);
      // 假 TGA（扩展名 .tga 但头部类型非法）：不注册 blob → TGALoader 不会加载它 → 无刷屏错误
      if (p.toLowerCase().endsWith(".tga") && !isLikelyTga(texBytes)) continue;
      const blob = new Blob([bytesToArrayBuffer(texBytes)]);
      const url = URL.createObjectURL(blob);
      blobUrls.push(url);
      // 收集 Worker 解码任务（与 PMX 解析并行，避免主线程 Decode Image 阻塞）
      // TGA 跳过：浏览器 createImageBitmap 不支持 TGA
      if (!p.toLowerCase().endsWith(".tga")) {
        const ext = p.split(".").pop()?.toLowerCase() || "";
        const mimeMap: Record<string, string> = {
          png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
          bmp: "image/bmp", gif: "image/gif", webp: "image/webp",
        };
        const mime = mimeMap[ext] || "image/png";
        decodeTasks.push({ relPath: rel || baseName, bytes: bytesToArrayBuffer(texBytes), mimeType: mime });
      }
      // 键1：相对目录路径（PMX 内记录如 "textures/face.png"，对齐 URLModifier 收到的 fullPath）
      texMap.set(rel, url);
      // 键2：basename 兜底（同名不同子目录由最长后缀匹配区分）
      texMap.set(baseName, url);
      // 反向映射：blob URL → 相对路径（post-load KTX2 替换溯源）
      blobUrlToRel.set(url, rel);
      // 存储 hash（来自 readFileBytesBatchWithMeta 的 Go 侧 SHA256，免费）
      // TGA 不参与 KTX2 编码：浏览器 Image 无法解码 TGA（blobUrlToImageData 必然 onerror），跳过
      if (texHashBatch[p] && !p.toLowerCase().endsWith(".tga")) {
        texHashMap.set(rel, texHashBatch[p]);
        blobUrlToHash.set(url, texHashBatch[p]);
      }
    }
    // ---- Worker 纹理解码：与 MMDLoader 解析并行执行，主线程解码被 Worker 接管 ----
    if (decodeTasks.length > 0) {
      const decoder = getTextureDecoder();
      decodedTexturesPromise = decoder.decodeAll(decodeTasks);
      void mmdDiag(port, "tex-decode-dispatch", dirPath, "ok",
        `dispatched=${decodeTasks.length} textures to decode workers`);
    }
    // 同目录 VMD 动作文件（模型加载后逐个解析）
    vmdPaths.push(...files.filter((p) => p.toLowerCase().endsWith(".vmd")));
    // 同目录 VPD 姿势文件（模型加载后逐个应用）
    vpdPaths.push(...files.filter((p) => p.toLowerCase().endsWith(".vpd")));
    await mmdDiag(
      port,
      "list-files",
      dirPath,
      "ok",
      `files=${files.length} tex=${files.filter((p) => TEXTURE_EXTS.some((ext) => p.toLowerCase().endsWith(ext))).length} vmd=${vmdPaths.length}`,
    );
  } catch (e) {
    await mmdDiag(port, "list-files", dirPath, "fail", e instanceof Error ? e.message : String(e));
    /* 目录不可列 → 白模降级，不阻断模型渲染 */
  }

  // ---- URLModifier：模型自身 + 纹理 URL → blob URL（未命中原样返回，toon 内置 dataURL 天然放行）----
  const manager = new THREE.LoadingManager();
  // 诊断（环形日志）：MMD 加载三段耗时。完整 perf 在 manager.onLoad 输出——
  // 纹理完成时才有 texture 值（loadAsync resolve 后贴图仍异步解码，build 结束往往未完成）。
  let textureLoadedAt = 0;
  let tParseStart = 0;
  let tParseEnd = 0;
  let tBuildEnd = 0;
  // mmd 提升到 onLoad 之前声明（onLoad 统计贴图尺寸需引用；类型取 loadAsync 返回值）
  let mmd: Awaited<ReturnType<MMDLoader["loadAsync"]>> | null = null;
  // 真实进度条（替代假动画）：MMDLoader 的 FileLoader/TextureLoader 都走本 manager，
  // loaded/total = 已加载文件数/总文件数（模型 + 纹理），驱动 loadingEl 进度条
  manager.onProgress = (url: string, loaded: number, total: number): void => {
    const pct = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
    const bar = ctx.loadingEl.querySelector<HTMLElement>("#ysm-mmd-progress");
    if (bar) bar.style.width = `${Math.max(5, pct)}%`;
  };
  manager.onLoad = (): void => {
    textureLoadedAt = performance.now();
    if (tParseEnd === 0) return; // loadAsync 未完成（异常时序），放弃 perf
    const buildMs = tBuildEnd > 0 ? Math.max(0, tBuildEnd - tParseEnd) : 0;
    // 贴图尺寸分布（诊断：决定降采样阈值）——统计各材质主贴图 map 的像素尺寸
    const dimCount = new Map<string, number>();
    const mmdMesh = mmd?.mesh;
    const mats = Array.isArray(mmdMesh?.material)
      ? mmdMesh.material
      : mmdMesh?.material
        ? [mmdMesh.material]
        : [];
    for (const m of mats) {
      const img = (m as { map?: { image?: HTMLImageElement } })?.map?.image;
      if (img?.width && img?.height) {
        const key = `${img.width}x${img.height}`;
        dimCount.set(key, (dimCount.get(key) ?? 0) + 1);
      }
    }
    const texSizes = [...dimCount.entries()].map(([k, n]) => `${k}x${n}`).join(",") || "none";
    // GPU 内存估算：各尺寸 × 数量 × 4B/px（RGBA8888）
    let gpuBytes = 0;
    for (const [dim, n] of dimCount) {
      const [w, h] = dim.split("x").map(Number);
      if (w && h) gpuBytes += w * h * 4 * n;
    }
    const gpuMb = (gpuBytes / (1024 * 1024)).toFixed(1);
    void mmdDiag(
      port,
      "perf",
      path,
      "ok",
      `parse=${Math.round(tParseEnd - tParseStart)}ms texture=${Math.round(textureLoadedAt - tParseEnd)}ms build=${Math.round(buildMs)}ms tex=${texSizes} gpu≈${gpuMb}MB`,
    );
  };
  manager.setURLModifier((url: string): string => {
    const lower = url.toLowerCase().replace(/\\/g, "/");
    // 最长路径后缀匹配（保留目录上下文：同名纹理在不同子目录时各归其位，basename 冲突兜底）
    let best: string | undefined;
    let bestLen = -1;
    for (const [key, blobUrl] of texMap) {
      if (key.length > bestLen && lower.endsWith(key)) {
        best = blobUrl;
        bestLen = key.length;
      }
    }
    return best ?? url;
  });

  // ---- KTX2 直载（方案 A）：拦截 loadTextureResource 的 loader 选择（getHandler），
  // 缓存命中时材质构建阶段直接拿 CompressedTexture，PNG 解码从加载路径消失 ----
  if (ctx.renderer) {
    const ktx2DirectLoader = new Ktx2TextureLoader({
      resolveHash: (url: string): string | undefined => {
        const lower = url.toLowerCase().replace(/\\/g, "/");
        const base = lower.split("/").pop() ?? "";
        // toon 排除：toon 走 getRotatedImage(t.image)（canvas 旋转），
        // CompressedTexture 的 image 是 mipmap 数组无法 drawImage → 不直载
        if (base.startsWith("toon") || lower.includes("/toon/")) return undefined;
        // texHashMap: rel → hash；用 basename 最长后缀匹配（同名冲突取目录上下文最深者）
        let best: string | undefined;
        let bestLen = -1;
        for (const [rel, hash] of texHashMap) {
          const rl = rel.toLowerCase();
          if (rl.endsWith(base) && rl.length > bestLen) {
            best = hash;
            bestLen = rl.length;
          }
        }
        return best;
      },
      getCachedTextureByHash: async (hash: string): Promise<string | null> => {
        try {
          const { getApp } = await import("../../../backend/app.ts");
          const app = await getApp();
          const fn = (app as unknown as Record<string, (h: string) => Promise<string>>)["GetCachedTextureByHash"];
          if (typeof fn !== "function") return null;
          const b64 = await fn(hash);
          return b64 || null;
        } catch {
          return null; // 绑定不可用 → 回退原 loader
        }
      },
      ktx2Loader: new KTX2Loader().setTranscoderPath("/basis/").detectSupport(ctx.renderer),
      fallbackLoader: new THREE.TextureLoader(manager),
    });
    // png/jpg/bmp/gif/webp 命中（tga 由 TGALoader 处理，天然不拦截）
    manager.addHandler(/\.(png|jpe?g|bmp|gif|webp)$/i, ktx2DirectLoader);
  }

  // ---- Worker PMX 解析路径：优先用 Worker 解析结果构建，失败 fallback 到 MMDLoader ----
  let workerBuilt: PmxBuildResult | null = null;
  let workerParseOk = false;
  let pmxParsedData: import("./mmd-pmx-parser.worker.ts").PmxParseResponse | null = null;
  try {
    const pmxResult = await pmxParsePromise;
    pmxParsedData = pmxResult;
    if (pmxResult.ok && pmxResult.vertices && pmxResult.faces) {
      workerParseOk = true;
      workerBuilt = await buildPmxSceneSliced(pmxResult, { texUrlMap: texMap });
      if (workerBuilt) {
        await mmdDiag(port, "pmx-worker-build", path, "ok",
          `vertices=${pmxResult.vertices.count} faces=${pmxResult.faces.count} bones=${pmxResult.bones?.length ?? 0} mats=${pmxResult.materials?.length ?? 0} (Worker path)`);
      }
    } else if (!pmxResult.ok) {
      await mmdDiag(port, "pmx-worker-build", path, "warn",
        `Worker parse failed: ${pmxResult.error ?? "unknown"} (fallback to MMDLoader)`);
    }
  } catch {
    await mmdDiag(port, "pmx-worker-build", path, "warn", "Worker parse threw, fallback to MMDLoader");
  }

  let mesh: THREE.SkinnedMesh;
  if (workerBuilt) {
    // ---- Worker 路径：直接用 Worker 构建的场景，跳过 MMDLoader ----
    mesh = workerBuilt.mesh;
    tParseStart = performance.now();
    tParseEnd = tParseStart; // Worker 路径解析已完成
    // 创建轻量 mmd 适配器：给 post-load 代码（骨骼树/材质面板/语义映射）提供必要数据
    mmd = {
      mesh: workerBuilt.mesh,
      pmx: pmxParsedData ? {
        bones: pmxParsedData.bones ?? [],
        materials: pmxParsedData.materials ?? [],
        morphs: pmxParsedData.morphs ?? [],
      } : undefined,
      updateWithMixer: () => {}, // Worker 路径跳过 MMD 物理/IK 更新
      dispose: () => {},
    } as unknown as Awaited<ReturnType<MMDLoader["loadAsync"]>>;
    pmxParser.dispose();
  } else {
    // ---- Fallback 路径：MMDLoader 主线程解析 ----
    const loader = new MMDLoader(manager);
    tParseStart = performance.now();
    try {
      mmd = await loader.loadAsync(path);
    } catch (e) {
      // 加载失败：回收已建 blob（模型 + 已读纹理），避免 WebView2 会话期内泄漏内存
      for (const url of blobUrls) URL.revokeObjectURL(url);
      await mmdDiag(port, "parse", path, "fail", e instanceof Error ? e.message : String(e));
      throw e;
    }
    await mmdDiag(
      port,
      "parse",
      path,
      "ok",
      `bones=${mmd?.pmx?.bones?.length ?? 0} mats=${mmd?.pmx?.materials?.length ?? 0} morphs=${mmd?.pmx?.morphs?.length ?? 0}`,
    );
    tParseEnd = performance.now();
    mesh = mmd!.mesh;
    pmxParser.dispose();
  }

  // ---- 应用 Worker 解码纹理：替换主线程解码的 HTMLImageElement 纹理为 ImageBitmap ----
  if (decodedTexturesPromise) {
    try {
      const decoded = await decodedTexturesPromise;
      if (decoded.size > 0) {
        const { replaced, total } = applyWorkerDecodedTextures(mesh, decoded, blobUrlToRel);
        if (replaced > 0) {
          await mmdDiag(port, "tex-decode-apply", path, "ok",
            `worker-decoded=${replaced}/${total} textures (${decoded.size} bitmaps from workers)`);
        }
      }
    } catch {
      await mmdDiag(port, "tex-decode-apply", path, "warn",
        "Worker 解码纹理应用失败，使用主线程 fallback");
    }
  }

  let buildSucceeded = false;
  try {
    ctx.scene!.add(mesh);
    registerModelRoot(mesh);
  ctx.loadingEl.remove(); // 加载完成，移除占位（对齐 vrm-adapter 口径）

  // ---- KTX2 纹理替换（post-load）：有 KTX2 缓存时用压缩纹理替换已加载的 PNG 纹理 ----
  // 通过 HasCachedTextures 批量检查缓存（1 次 RPC 替代 N 次串行 HasCachedTexture）
  let cachedHashes: Set<string> | null = null;
  if (blobUrlToHash.size > 0 && ctx.renderer) {
    const { getApp } = await import("../../../backend/app.ts");
    const app = await getApp();
    const appAny = app as unknown as Record<string, (x: unknown) => Promise<unknown>>;
    const hasCachedBatch = appAny["HasCachedTextures"] as ((hashes: string[]) => Promise<Record<string, boolean>>) | undefined;
    const getCached = appAny["GetCachedTextureByHash"] as ((h: string) => Promise<string>) | undefined;
    if (hasCachedBatch && getCached) {
      // 收集所有纹理 hash → 批量检查缓存
      const allHashes = [...new Set(blobUrlToHash.values())];
      const cacheStatus = await hasCachedBatch(allHashes);
      cachedHashes = new Set(allHashes.filter((h) => cacheStatus[h]));
      if (cachedHashes.size > 0) {
        const ktx2Loader = new KTX2Loader()
          .setTranscoderPath("/basis/")
          .detectSupport(ctx.renderer);
        // 并发替换所有被缓存的纹理
        const allMats: THREE.Material[] = Array.isArray(mesh.material)
          ? mesh.material
          : mesh.material
            ? [mesh.material]
            : [];
        const replaceTasks: Array<Promise<void>> = [];
        for (const mat of allMats) {
          for (const key of DISPOSE_TEX_KEYS) {
            const tex = (mat as unknown as Record<string, unknown>)[key];
            if (!(tex instanceof THREE.Texture)) continue;
            const img = tex.image as HTMLImageElement | undefined;
            if (!img?.src?.startsWith("blob:")) continue;
            const hash = blobUrlToHash.get(img.src);
            if (!hash || !cachedHashes.has(hash)) continue;
            replaceTasks.push(
              getCached(hash).then((ktx2B64) => {
                if (!ktx2B64) return;
                const ktxBytes = b64ToBytes(ktx2B64);
                const ktxBlob = new Blob([bytesToArrayBuffer(ktxBytes)]);
                const ktxUrl = URL.createObjectURL(ktxBlob);
                blobUrls.push(ktxUrl);
                return ktx2Loader.loadAsync(ktxUrl).then((compressedTex) => {
                  (mat as unknown as Record<string, unknown>)[key] = compressedTex;
                  tex.dispose();
                  mat.needsUpdate = true;
                }).catch(() => {
                  /* KTX2 加载失败不阻断 */
                });
              }),
            );
          }
        }
        // 并行执行所有替换
        await Promise.all(replaceTasks);
        // 命中日志（环形日志可见性：缓存是否真正生效）
        await mmdDiag(port, "ktx2-replace", "cache-hit", "ok", `cached=${cachedHashes.size} replaced=${replaceTasks.length} total=${allHashes.length}`);
      } else {
        await mmdDiag(port, "ktx2-replace", "cache-miss", "warn", `total=${allHashes.length}（缓存未命中，将后台编码）`);
      }
    }
  }

  // ---- 后台 KTX2 编码：未缓存的纹理在后台编码并保存到 Go 侧缓存 ----
  if (blobUrlToHash.size > 0 && port.getCachedTexture) {
    // 已缓存的 hash 跳过编码（防重复落盘/重复 WASM 编码）；cachedHashes 为 null 表示替换链路未执行（无 renderer），全量调度
    const toEncode = cachedHashes
      ? new Map([...blobUrlToHash].filter(([, h]) => !cachedHashes!.has(h)))
      : blobUrlToHash;
    if (toEncode.size > 0) {
      scheduleBackgroundEncoding(toEncode, port);
    }
  }

  // ---- VMD 动作（同目录 .vmd）：批量读取 + VmdObject.ParseFromBuffer 直解字节，坏文件跳过不阻断 ----
  const mixer = new THREE.AnimationMixer(mesh);
  const clips: Array<{ label: string; clip: THREE.AnimationClip }> = [];
  // ADR-101：批量读取 VMD/VPD（1 次 RPC 替代 N 次 readFileBytes）
  const allAnimPaths = [...vmdPaths, ...vpdPaths];
  const animBatch = allAnimPaths.length > 0 ? await port.readFileBytesBatch(allAnimPaths) : {};
  for (const v of vmdPaths) {
    try {
      const vmdB64 = animBatch[v] ?? null;
      if (!vmdB64) continue;
      // await 包装：真实库 ParseFromBuffer 同步返回（await 无害），但损坏/异步实现时
      // reject 能被 try/catch 捕获，不会把 Promise 对象当 vmd 传给 buildAnimation
      const vmd = await VmdObject.ParseFromBuffer(bytesToArrayBuffer(b64ToBytes(vmdB64)));
      clips.push({
        label: (v.split(/[/\\]/).pop() || "").replace(/\.vmd$/i, "") || "motion",
        clip: buildAnimation(vmd, mesh),
      });
    } catch {
      /* 单个 VMD 损坏 → 跳过，其余照常 */
    }
  }
  // 同目录 VPD 姿势文件：加载并缓存（applyVPD 直接修改骨骼变换，非动画 clip）
  const vpdPoses: Array<{ label: string; vpd: VpdObject }> = [];
  for (const v of vpdPaths) {
    try {
      const vpdB64 = animBatch[v] ?? null;
      if (!vpdB64) continue;
      const vpdBytes = b64ToBytes(vpdB64);
      // VPDLoader.loadAsync 需要 URL，构造 blob URL（ArrayBuffer 兼容 BlobPart）
      const vpdBlobUrl = URL.createObjectURL(new Blob([vpdBytes.buffer as ArrayBuffer]));
      blobUrls.push(vpdBlobUrl);
      const vpd = await new VPDLoader().loadAsync(vpdBlobUrl);
      vpdPoses.push({
        label: (v.split(/[/\\]/).pop() || "").replace(/\.vpd$/i, "") || "pose",
        vpd,
      });
    } catch {
      /* 单个 VPD 损坏 → 跳过，其余照常 */
    }
  }
  let playing = true;
  let curIdx = 0;
  let action: THREE.AnimationAction | null = null;
  if (clips.length > 0) {
    action = mixer.clipAction(clips[0].clip); // 默认 LoopRepeat 循环
    action.play();
  }

  // 包围盒定相机（MMD Y-up、单位约厘米，原点一般在脚底；尺寸差由相机距离吸收，不缩放模型）
  const box = new THREE.Box3().setFromObject(mesh);
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

  // MMDToon 材质对光有响应，补环境 + 主光 + 半球光（对齐 vrm-adapter 灯位）

  // ---- 声明式根菜单专属项（ADR-076 v2 Phase 2）：model / 材质 / 播放 ----
  // 切换模型归 core switch 项（needsSiblings），相机归 core camera 项（sharedOnly）。
  // 菜单表提取为可导出 mmdMenuItems()：测试遍历同一份真实数组断言结构（对齐 MikuMikuAR）。
  const navCtx: MmdBottomNavCtx = {
    mmd: mmd!,
    mesh,
    modelName: path.split(/[/\\]/).pop() || "",
    modelPath: path,
    cameraControls: ctx.cameraControls,
    switchTo: ctx.switchTo,
  };
  const mats = mesh.material as unknown as THREE.Material[];
  const bonePanelRef: { current: (() => void) | null } = { current: null };
  // ADR-077 + 语义骨骼层：骨骼树构建复用一次，既喂骨骼面板也产语义映射
  const boneTree = mmd?.pmx?.bones && mesh.skeleton
    ? buildBoneTree(mmdBonesToBoneNodes(mmd?.pmx.bones, mesh.skeleton.bones))
    : null;
  const items = mmdMenuItems({
    navCtx,
    panels,
    screenshot: () => Promise.resolve(screenshotFromRenderer(ctx.renderer!, ctx.scene, ctx.camera)),
    material: {
      list: () => listMmdMaterials(mmd?.pmx.materials),
      getDetail: (i) => getMmdMaterialDetail(mmd?.pmx.materials, mats, i),
      setVisible: (i, v) => setMmdMaterialVisible(mats, i, v),
      setOpacity: (i, o) => {
        setMmdMaterialOpacity(mats, i, o);
        const m = mats[i];
        if (m) m.needsUpdate = true; // 透明状态变更需重编译着色器
      },
    },
    play:
      clips.length > 0
        ? {
            clips,
            isPlaying: () => playing,
            toggle: () => {
              playing = !playing;
              // AnimationAction 的暂停是 paused 属性（无 pause() 方法），play() 兼容重置
              if (action) action.paused = !playing;
            },
            currentIndex: () => curIdx,
            select: (i) => {
              if (i === curIdx) return;
              curIdx = i;
              action?.stop();
              action = mixer.clipAction(clips[i].clip);
              if (playing) action.play();
            },
          }
        : null,
    // ADR-077: 骨骼面板（MMD 特有：THREE.Bone 无几何，拾取走距离法）——收编为根菜单 bones 项
    bonePanel: boneTree
      ? {
          tree: boneTree,
          viewContainer: ctx.viewContainer,
          camera: ctx.camera,
          scene: ctx.scene,
          cleanupRef: bonePanelRef,
        }
      : null,
  });
  ctx.menu.setAdapterItems(items);

  // MMD 语义骨骼：候选名匹配表移植自 MikuMikuAR motion-algos；消费方读取驱动感知层
  const semanticBones = boneTree ? mmdSemanticBoneMap(boneTree) : undefined;
  // MMD 语义 morph：候选名匹配（blink/lipOpen 等）→ morphTargetDictionary index
  const semanticMorphs = mmdSemanticMorphMap(mmd?.pmx?.morphs ?? []);
  // 感知层呼吸（程序化生命力 L1）：待机态下对 chest/spine/shoulders 施加正弦微位移
  const breath = createBreathController();
  // 感知层注视追踪（程序化生命力 L2）：head/eyes 跟随相机方向
  const gaze = createGazeController();
  // 感知层眨眼（程序化生命力 L1.5）：随机间隔触发 morph
  const blink = createBlinkController();
  // 感知层 LipSync（程序化生命力 L2）：待机态下多 morph 驱动口型
  const lipSync = createLipSyncController({ multiMorph: true });
  let lipSyncTime = 0;
  // 构建口型 morph index 映射（从语义 morph map + mesh.morphTargetDictionary）
  const lipIndices = (mesh.morphTargetDictionary && semanticMorphs
    ? buildLipMorphIndices(semanticMorphs, mesh.morphTargetDictionary)
    : undefined);
  // 感知层 AutoDance（程序化生命力 L3）：按 BPM 节拍驱动骨骼律动（待机态生效）
  const autoDance = createAutoDanceController({ bpm: 120, intensity: 0.3 });
  // 程序化足部锚地（Foot IK）：待机态下保持双足贴地，防悬空/穿模
  const footIK = createFootIKController(boneTree, semanticBones);

  const result: PreviewScene = {
    // MMD 动态部分（VMD 动画 + IK/追加变换姿态解算）靠 updateWithMixer 驱动；静态模型摆正初始姿势
    update: (dt: number): void => {
      if (!mesh.visible) return; // Frustum Culling 不可见 → 跳过 IK/感知层，省 CPU
      mmd?.updateWithMixer(dt, mixer, { ik: true, grant: true });
      if (semanticBones) {
        // 待机呼吸：有动画播放时暂停（避免与动画打架）
        if (!action || action.paused) breath.apply(dt, semanticBones);
        // 注视追踪：始终生效（动画中头也跟随相机，增强生命力）
        gaze.apply(dt, semanticBones, ctx.camera!.position);
      }
      // 眨眼：随机间隔触发 morph（待机态，有动画时暂停避免冲突）
      const blinkEntry = semanticMorphs.blink;
      if (blinkEntry && mesh.morphTargetDictionary && mesh.morphTargetInfluences && (!action || action.paused)) {
        const idx = mesh.morphTargetDictionary[blinkEntry.name];
        if (idx !== undefined) {
          blink.apply(dt, (weight: number) => { mesh.morphTargetInfluences![idx] = weight; });
        }
      }
      // LipSync：待机态下多 morph 驱动（open/close/pucker/smile）
      // 当前用呼吸相位模拟，后续可接入 Web Audio API 真实振幅
      if (lipIndices && (!action || action.paused)) {
        lipSyncTime += dt;
        const breathPhase = Math.sin(lipSyncTime / 2.5 * Math.PI * 2);
        // 张嘴随呼吸相位变化，其他音素静默
        const openAmp = Math.max(0, breathPhase) * 0.4;
        lipSync.applyMulti(dt, { lipOpen: openAmp }, (morphId, weight) => {
          const idx = morphId === "lipOpen" ? lipIndices.open
            : morphId === "lipClose" ? lipIndices.close
            : morphId === "lipPucker" ? lipIndices.pucker
            : morphId === "lipSmile" ? lipIndices.smile
            : undefined;
          if (idx !== undefined) mesh.morphTargetInfluences![idx] = weight;
        });
      }
      // AutoDance：待机态下按节拍律动（与呼吸/眨眼/注视共存，动作叠加）
      const isIdle = !action || action.paused;
      // Foot IK：待机态下锚定双足（在 AutoDance 之前，防足部偏移被覆盖）
      footIK.apply(dt, isIdle);
      if (isIdle) {
        autoDance.apply(dt, semanticBones ?? {});
      }
    },
    // 释放 MMD 纹理/材质/几何（@moeru/three-mmd 的 MMD.dispose 只释放物理引擎，不释放 GPU 资源——
    // 见 node_modules/@moeru/three-mmd/dist/index.js:2901-2905。切换模型时 switchToSession 只调
    // 本 dispose，不跑 fullCleanup 的 scene.traverse catch-all，所以必须在此显式释放）。
    dispose: (): void => {
      // GPU 内存泄漏检测：记录 dispose 前的 renderer.info.memory
      const renderer = ctx.renderer;
      if (renderer) {
        const memBefore = (renderer as unknown as { info?: { memory?: { geometries: number; textures: number } } }).info?.memory;
        if (memBefore) {
          console.log(`[gpu-leak] mmd dispose before: geometries=${memBefore.geometries} textures=${memBefore.textures}`);
        }
      }
      try {
        bonePanelRef.current?.();
        unregisterModelRoot(mesh);
        mixer.stopAllAction();
        mixer.uncacheRoot(mesh); // 释放 PropertyMixer 缓存，对齐 vrm-adapter（ADR-084 L2）
        breath.reset();
        gaze.reset();
        blink.dispose();
        lipSync.dispose();
        autoDance.dispose();
        footIK.dispose();
      } catch {
        /* 前置步骤抛错 → 吞掉，确保后续清理继续 */
      } finally {
        // 取消排队中的后台 KTX2 编码（已开始的会因 blob revoke 在 Image onerror 处静默降级）
        cancelPendingEncodings();
        // 断开主线程长任务观测
        stopLongTaskWatch();
        // 始终回收 blob URL，无论上面是否抛错（revokeObjectURL 幂等）
        for (const url of blobUrls) URL.revokeObjectURL(url);
      }
      try {
        // 显式释放几何/材质/纹理（mmd?.dispose() 不会释放这些）
        disposeMmdMesh(mesh, mmdDiag, port, "dispose-tex");
        mmd?.dispose();
      } catch {
        /* 几何/纹理释放抛错 → 吞掉，blob URL 已在 finally 回收 */
      }
      // GPU 内存泄漏检测：记录 dispose 后的 renderer.info.memory
      if (renderer) {
        const memAfter = (renderer as unknown as { info?: { memory?: { geometries: number; textures: number } } }).info?.memory;
        if (memAfter) {
          console.log(`[gpu-leak] mmd dispose after: geometries=${memAfter.geometries} textures=${memAfter.textures}`);
        }
      }
    },
    // ADR-052 P3：截图走共享 renderer（通用化，与 ysm/vrm/litematic 呑约对称）
    screenshot: () =>
      Promise.resolve(screenshotFromRenderer(ctx.renderer!, ctx.scene, ctx.camera)),
    semanticBones,
    // VPD 姿势导入：同目录 .vpd 文件加载后缓存，点击触发 applyVPD
    applyPose: vpdPoses.length > 0
      ? (index: number): void => {
          const pose = vpdPoses[index];
          if (!pose) return;
          try {
            applyVPD(mmd!, pose.vpd, { ik: true, grant: true });
          } catch {
            /* 单个 VPD 应用失败不阻断预览 */
          }
        }
      : undefined,
  };
  // 诊断（环形日志）：build 段结束打点；完整 perf 由 manager.onLoad 在纹理完成时输出（见上）
  tBuildEnd = performance.now();
  buildSucceeded = true;
  return result;
  } finally {
    // build 失败时兜底回收 blobUrls（build 成功由 dispose 负责回收）
    if (!buildSucceeded) {
      stopLongTaskWatch(); // 失败时同样断开观测，防泄漏（成功由 dispose 断开）
      for (const url of blobUrls) URL.revokeObjectURL(url);
    }
  }
}

/** mmdMenuItems 组装依赖：适配器 build 内组装；测试可构造假依赖遍历真实菜单表 */
export interface MmdMenuItemsOpts {
  navCtx: MmdBottomNavCtx;
  /** 截图能力（ADR-052 P3：screenshotFromRenderer 共享 renderer）；null → 不注入 shot 项 */
  screenshot: (() => Promise<string | null>) | null;
  /** 材质面板桥（mmd-materials.ts 纯逻辑层，ADR-072） */
  material: MaterialControlBridge;
  /** 播放/动作桥；null（无同目录 VMD）→ 不注入 play 项 */
  play: MmdPlayBridge | null;
  /** 骨骼面板依赖；null（无 pmx.bones / skeleton）→ 不注入 bones 项 */
  bonePanel: {
    /** 已构建骨骼树（buildBoneTree 产物） */
    tree: BoneTree;
    viewContainer: HTMLElement | null;
    /** 兼容真实 ctx 可选字段（undefined）与测试假依赖（null） */
    camera: THREE.PerspectiveCamera | null | undefined;
    scene: THREE.Object3D | null | undefined;
    cleanupRef: { current: (() => void) | null };
  } | null;
  /** 面板填充回调（视图层注入；缺失则 render 退化为 no-op，解除 utils→views 分层违规 R1） */
  panels?: MmdPanelHooks;
}

/**
 * MMD 声明式根菜单专属项（ADR-076 v2 Phase 2）：model / 材质 / 播放（+ 条件 bones）。
 * 提取为可导出表：适配器与测试共用同一份真实数组——测试遍历本表断言结构与
 * dock 渲染（对齐 MikuMikuAR 声明式菜单测试范式），加菜单项只改这里。
 */
export function mmdMenuItems(o: MmdMenuItemsOpts): PreviewMenuItemDef[] {
  const items: PreviewMenuItemDef[] = [
    {
      id: "model",
      icon: "🧍",
      labelKey: "preview.modelInfo",
      fallback: "模型",
      kind: "panel",
      legacyTestId: "mmd-model-entry",
      dockGroup: "model", // 底栏 🧍 模型组
      render: (list) => o.panels?.fillModelPanel?.(list, o.navCtx),
    },
    {
      id: "shot",
      icon: "📷",
      labelKey: "preview.screenshot",
      fallback: "截图",
      kind: "panel",
      dockGroup: "model", // 底栏 🧍 模型组
      legacyTestId: "mmd-shot-entry",
      render: (list) => o.panels?.fillShotPanel?.(list, o.navCtx, o.screenshot),
    },
    {
      id: "material",
      icon: "🎨",
      labelKey: "preview.materialList",
      fallback: "材质",
      kind: "panel",
      legacyTestId: "mmd-material-entry",
      dockGroup: "model", // 底栏 🧍 模型组
      render: (list) => o.panels?.buildMaterialControls?.(list, o.material),
    },
  ];
  if (o.play) {
    items.push({
      id: "play",
      icon: "▶️",
      labelKey: "preview.mmdPlay",
      fallback: "播放",
      kind: "panel",
      legacyTestId: "mmd-play-entry",
      dockGroup: "motion", // 底栏 💃 动作组
      render: (list) => o.panels?.fillPlayPanel?.(list, o.play!),
    });
  }
  if (o.bonePanel) {
    items.push({
      id: "bones",
      icon: "🦴",
      labelKey: "preview.bones",
      fallback: "骨骼",
      kind: "panel",
      dockGroup: "model", // 底栏 🧍 模型组（ADR-085：补齐，与 ysm/vrm bones 对齐）
      legacyTestId: "mmd-bones-entry",
      render: (list) => {
        // 通用骨骼面板：渲染进根菜单面板；重入时先清理旧 renderer
        if (o.bonePanel!.cleanupRef.current) {
          o.bonePanel!.cleanupRef.current();
          o.bonePanel!.cleanupRef.current = null;
        }
        o.bonePanel!.cleanupRef.current = makeBonePanelRenderer(o.bonePanel!.tree)(list, {
          viewContainer: o.bonePanel!.viewContainer!,
          camera: o.bonePanel!.camera!,
          scene: o.bonePanel!.scene!,
        });
      },
    });
  }
  return items;
}
