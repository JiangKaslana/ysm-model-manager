// ===== MMD 纹理解码器（Worker 池管理器）=====
// 与 mmd-ktx2-encoder.ts 的 Worker 池哲学一致：
// 1. 固定 Worker 池（默认 4 个，与 TEXTURE_READ_CHUNK_SIZE 对齐）
// 2. 每个 Worker 接收一个 TexDecodeRequest → 返回 TexDecodeResponse
// 3. 主线程 dispatch 所有解码任务 → 汇总结果 → 返回 Map<relPath, ImageBitmap>
// 4. 失败的纹理静默跳过，由主线程 fallback 处理

import * as THREE from "three";
import type { TexDecodeRequest, TexDecodeResponse } from "./mmd-texture-decode.worker.ts";

/** Worker 池大小：4 个并行解码线程 */
const TEX_DECODE_WORKER_COUNT = 4;

/** 解码器配置 */
export interface TexDecodeConfig {
  /** 最大 Worker 数（默认 4） */
  maxWorkers?: number;
  /** 单纹理解码超时 ms（默认 8000） */
  timeoutMs?: number;
}

/** 解码结果条目 */
export interface DecodedTexture {
  relPath: string;
  bitmap: ImageBitmap;
  width: number;
  height: number;
}

/**
 * 解码管理器：创建 Worker 池、分发任务、收集结果。
 * 使用方法：const decoder = createTextureDecoder(); const results = await decoder.decodeAll(tasks);
 */
export interface TextureDecoder {
  /** 解码一批纹理（并行 Worker 池处理） */
  decodeAll(tasks: Array<{ relPath: string; bytes: ArrayBuffer; mimeType: string }>): Promise<Map<string, DecodedTexture>>;
  /** 释放 Worker 池 */
  dispose(): void;
}

/** 创建纹理解码器（Worker 池） */
export function createTextureDecoder(config: TexDecodeConfig = {}): TextureDecoder {
  const maxWorkers = config.maxWorkers ?? TEX_DECODE_WORKER_COUNT;
  const timeoutMs = config.timeoutMs ?? 8000;

  // 创建 Worker 池
  const workers: Worker[] = [];
  for (let i = 0; i < maxWorkers; i++) {
    workers.push(new Worker(
      new URL("./mmd-texture-decode.worker.ts", import.meta.url),
      { type: "module" },
    ));
  }

  // 任务分配器：round-robin 到 Worker
  let workerIdx = 0;
  let nextId = 0;

  const pending = new Map<number, {
    resolve: (r: TexDecodeResponse) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  // Worker 消息处理
  for (const w of workers) {
    w.onmessage = (e: MessageEvent<TexDecodeResponse>) => {
      const { id } = e.data;
      const entry = pending.get(id);
      if (entry) {
        clearTimeout(entry.timer);
        pending.delete(id);
        entry.resolve(e.data);
      }
    };
    w.onerror = () => { /* Worker 错误由 timeout 兜底 */ };
  }

  function decodeAll(tasks: Array<{ relPath: string; bytes: ArrayBuffer; mimeType: string }>): Promise<Map<string, DecodedTexture>> {
    if (tasks.length === 0) return Promise.resolve(new Map());

    const results = new Map<string, DecodedTexture>();
    let completed = 0;
    const total = tasks.length;

    return new Promise((resolve) => {
      for (const task of tasks) {
        const id = nextId++;
        const w = workers[workerIdx % workers.length];
        workerIdx++;

        const req: TexDecodeRequest = {
          id,
          relPath: task.relPath,
          bytes: task.bytes,
          mimeType: task.mimeType,
        };

        const timer = setTimeout(() => {
          // 超时：静默跳过（主线程 fallback 会覆盖）
          pending.delete(id);
          completed++;
          if (completed >= total) resolve(results);
        }, timeoutMs);

        pending.set(id, {
          resolve: (resp: TexDecodeResponse) => {
            if (resp.ok && resp.bitmap) {
              results.set(resp.relPath, {
                relPath: resp.relPath,
                bitmap: resp.bitmap,
                width: resp.width!,
                height: resp.height!,
              });
            }
            completed++;
            if (completed >= total) resolve(results);
          },
          timer,
        });

        w.postMessage(req, [task.bytes]);
      }
    });
  }

  function dispose() {
    for (const w of workers) w.terminate();
    pending.clear();
  }

  return { decodeAll, dispose };
}

/** 单例：全局复用同一个 Worker 池，避免每次加载都重建 */
let sharedDecoder: TextureDecoder | null = null;

/** 获取共享解码器（懒创建） */
export function getTextureDecoder(): TextureDecoder {
  if (!sharedDecoder) {
    sharedDecoder = createTextureDecoder();
  }
  return sharedDecoder;
}

/** 释放共享解码器 */
export function disposeTextureDecoder(): void {
  if (sharedDecoder) {
    sharedDecoder.dispose();
    sharedDecoder = null;
  }
}

/**
 * 将 Worker 解码的 ImageBitmap 应用到 MMD 模型的材质纹理：
 * 遍历 mesh 的所有材质，将命中的 blob:HTMLImageElement 纹理替换为 ImageBitmap 纹理。
 * 未命中的纹理保持原样（主线程解码的 fallback）。
 */
export function applyWorkerDecodedTextures(
  mesh: THREE.Mesh | THREE.SkinnedMesh,
  decoded: Map<string, DecodedTexture>,
  blobUrlToRel: Map<string, string>,
): { replaced: number; total: number } {
  const allMats: THREE.Material[] = Array.isArray(mesh.material)
    ? mesh.material
    : mesh.material
      ? [mesh.material]
      : [];

  // 可替换的纹理字段
  const texKeys = [
    "map", "emissiveMap", "normalMap", "roughnessMap",
    "metalnessMap", "aoMap", "lightMap", "alphaMap", "envMap",
    "sphereMap", "toonMap", "displacementMap", "bumpMap",
  ] as const;

  let replaced = 0;
  let total = 0;

  for (const mat of allMats) {
    for (const key of texKeys) {
      const texVal = (mat as unknown as Record<string, unknown>)[key];
      if (!(texVal instanceof THREE.Texture)) continue;
      const tex: THREE.Texture = texVal;
      total++;

      // 获取当前纹理的 image
      const img = tex.image as HTMLImageElement | ImageBitmap | undefined;
      if (!img) continue;

      // 查找对应的 relPath：blob URL → relPath
      let relPath: string | undefined;
      if (img instanceof HTMLImageElement && img.src?.startsWith("blob:")) {
        relPath = blobUrlToRel.get(img.src);
      }
      if (!relPath) continue;

      // 检查是否有 Worker 解码结果
      const decodedTex = decoded.get(relPath);
      if (!decodedTex) continue;

      // 创建新的 THREE.Texture 从 ImageBitmap
      const newTex = new THREE.Texture(decodedTex.bitmap);
      // 复制关键属性
      newTex.wrapS = tex.wrapS;
      newTex.wrapT = tex.wrapT;
      newTex.repeat = tex.repeat;
      newTex.offset = tex.offset;
      newTex.center = tex.center;
      newTex.rotation = tex.rotation;
      newTex.flipY = tex.flipY;
      newTex.generateMipmaps = tex.generateMipmaps;
      newTex.minFilter = tex.minFilter;
      newTex.magFilter = tex.magFilter;
      newTex.anisotropy = tex.anisotropy;
      newTex.format = tex.format;
      newTex.type = tex.type;
      newTex.colorSpace = tex.colorSpace;

      // 替换
      (mat as unknown as Record<string, unknown>)[key] = newTex;
      tex.dispose();
      replaced++;
    }
  }

  if (total > 0) {
    mesh.material = allMats.length > 1 ? allMats : allMats[0];
  }

  return { replaced, total };
}