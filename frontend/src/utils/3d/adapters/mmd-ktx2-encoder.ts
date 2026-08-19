// ===== MMD 纹理 KTX2 后台编码器 =====
// 在浏览器中通过 WASM basis_encoder 将 PNG 纹理编码为 KTX2 格式，
// 结果通过 SaveCachedTexture 保存到 Go 侧缓存目录。下次加载时直接命中缓存。
//
// 编码在后台进行（Promise），不阻塞模型加载和渲染。
// 编码失败静默降级，不影响已有 PNG 纹理。
//
// P1-1 优化：并发控制（MAX_CONCURRENT=3）+ 取消机制 + 幂等调度

// 使用动态 import 加载 KTX2BasisWriter（含 BasisEncoder WASM）
import type { MmdDataPort } from "./mmd-adapter.ts";

/** 最大并发编码数（WASM BasisEncoder 单实例，并发过高会争抢资源） */
const MAX_CONCURRENT = 3;

/** 并发信号量：等待队列中等待执行的任务 */
type WaitingTask = () => void;
let activeCount = 0;
const waitingQueue: WaitingTask[] = [];
let cancelled = false;

/** 已完成编码的 hash 集合（幂等去重） */
const completedHashes = new Set<string>();

/** 正在进行中的编码 hash 集合（防止重复调度） */
const inProgressHashes = new Set<string>();

/** 将 Uint8Array 转为 base64 字符串（分块处理，避免大数组栈溢出） */
function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000; // 32768 字节/块
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK)));
  }
  return btoa(chunks.join(""));
}

/** 信号量：获取执行槽位，返回释放函数 */
function acquire(): Promise<() => void> {
  return new Promise((resolve) => {
    const task: WaitingTask = () => {
      activeCount++;
      let released = false;
      resolve(() => {
        if (released) return;
        released = true;
        activeCount--;
        // 从等待队列取下一个任务
        const next = waitingQueue.shift();
        if (next) next();
      });
    };
    if (activeCount < MAX_CONCURRENT && !cancelled) {
      // 立即执行
      task();
    } else {
      waitingQueue.push(task);
    }
  });
}

/** 取消所有待执行的编码（已在执行的不受影响） */
export function cancelPendingEncodings(): void {
  cancelled = true;
  // 清空等待队列
  waitingQueue.length = 0;
}

/** 重置取消状态（下次调度前调用） */
function resetCancelled(): void {
  cancelled = false;
}

/** 重置编码器状态（测试用） */
export function resetEncoderState(): void {
  activeCount = 0;
  waitingQueue.length = 0;
  cancelled = false;
  completedHashes.clear();
  inProgressHashes.clear();
}

/** 从 blob URL 解码图像数据为 { data, width, height } */
async function blobUrlToImageData(blobUrl: string): Promise<{
  data: Uint8Array;
  width: number;
  height: number;
}> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = blobUrl;
  });
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, img.width, img.height);
  return { data: new Uint8Array(imageData.data.buffer), width: img.width, height: img.height };
}

/** 将 blob URL 转换为 base64 字符串 */
async function blobUrlToBase64(blobUrl: string): Promise<string> {
  const resp = await fetch(blobUrl);
  const blob = await resp.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // result 是 data:application/octet-stream;base64,... 格式，提取 base64 部分
      const b64 = result.includes(",") ? result.split(",")[1] : result;
      resolve(b64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * 将单个 PNG 纹理编码为 KTX2 并缓存。
 * @param hash 纹理内容的 SHA256 hash（来自 GetCachedTexture）
 * @param pngBlobUrl blob URL 指向 PNG 纹理数据
 * @param port 数据端口（用于 SaveCachedTexture 调用）
 * @returns 编码成功 true，失败 false（静默降级）
 */
export async function encodeAndCacheTexture(
  hash: string,
  pngBlobUrl: string,
  port: MmdDataPort,
): Promise<boolean> {
  // 获取并发槽位
  const release = await acquire();
  try {
    // 解码 PNG → ImageData
    const imageData = await blobUrlToImageData(pngBlobUrl);
    // 动态导入 KTX2BasisWriter（运行时加载 encode 函数）
    const { KTX2BasisWriter } = await import("@loaders.gl/textures");
    // 编码为 KTX2（Basis Universal）
    // modules 注入本地 basis 库：loaders.gl 默认从 `modules/textures/src/libs/` 相对路径或 CDN
    // 拉取 basis_encoder（vite 下 404 → BasisEncoderModule is not a function），
    // 显式映射到项目 public/basis/（与 KTX2Loader transcoderPath 同源）。
    const ktx2Buffer = await (KTX2BasisWriter as unknown as { encode: (img: unknown, opts?: unknown) => Promise<ArrayBuffer> }).encode(imageData, {
      "ktx2-basis-writer": {
        qualityLevel: 128, // 质量 1-255，128 是平衡值
        encodeUASTC: false, // 用 ETC1S（更小，兼容性更好）
        mipmaps: false, // 不需要 mipmap，预览用
        useSRGB: false,
      },
      modules: {
        "basis_encoder.js": "/basis/basis_encoder.js",
        "basis_encoder.wasm": "/basis/basis_encoder.wasm",
      },
    });
    // 将 KTX2 ArrayBuffer 转为 base64（分块避免栈溢出，O(n) 替代 O(n²) 字符串拼接）
    const ktx2Bytes = new Uint8Array(ktx2Buffer);
    const ktx2B64 = bytesToBase64(ktx2Bytes);
    // 保存到 Go 侧缓存
    if (port.addOpLog) {
      void port.addOpLog("ktx2-encode", hash, "ok", `bytes=${ktx2Bytes.length} original=${imageData.width}x${imageData.height}`);
    }
    // 通过 Go 绑定保存缓存
    const { getApp } = await import("../../../backend/app.ts");
    const app = await getApp();
    const saveFn = (app as unknown as Record<string, (h: string, d: string) => Promise<void>>)["SaveCachedTexture"];
    if (typeof saveFn === "function") {
      await saveFn(hash, ktx2B64);
    }
    // 标记为已完成
    completedHashes.add(hash);
    return true;
  } catch (e) {
    // 编码失败静默降级，不影响已有纹理
    if (port.addOpLog) {
      void port.addOpLog("ktx2-encode", hash, "fail", e instanceof Error ? e.message : String(e));
    }
    return false;
  } finally {
    release();
  }
}

/**
 * 遍历 mesh 材质，对有 KTX2 缓存需要的纹理进行后台编码。
 * 在模型加载完成后调用，不阻塞渲染。
 *
 * P1-1 优化：并发控制 + 取消机制 + 幂等调度
 * @param hashByBlobUrl blob URL → hash 映射
 * @param port 数据端口
 */
export function scheduleBackgroundEncoding(
  hashByBlobUrl: Map<string, string>,
  port: MmdDataPort,
): void {
  // 重置取消状态（新一轮调度开始）
  resetCancelled();

  // 在微任务中启动编码，避免阻塞当前帧
  queueMicrotask(() => {
    for (const [blobUrl, hash] of hashByBlobUrl) {
      // 幂等去重：已完成或已在队列中的 hash 跳过
      if (completedHashes.has(hash)) continue;

      // 检查是否已在进行中
      if (inProgressHashes.has(hash)) continue;

      // 加入进行中集合
      inProgressHashes.add(hash);

      // 每个纹理编码是独立的 Promise，通过 acquire 控制并发
      encodeAndCacheTexture(hash, blobUrl, port).then((ok) => {
        inProgressHashes.delete(hash);
        if (ok) {
          // 编码成功已在 encodeAndCacheTexture 中记录
        }
      }).catch(() => {
        inProgressHashes.delete(hash);
      });
    }
  });
}