import { safeErrorMessage } from "../../safe-error-msg.ts";

// ===== MMD 纹理 KTX2 后台编码器 =====
// 在浏览器中通过 WASM basis_encoder 将 PNG 纹理编码为 KTX2 格式，
// 结果通过 SaveCachedTexture 保存到 Go 侧缓存目录。下次加载时直接命中缓存。
//
// 编码在后台进行（Promise），不阻塞模型加载和渲染。
// 编码失败静默降级，不影响已有 PNG 纹理。
//
// P1-1 优化：并发控制（MAX_CONCURRENT=3）+ 取消机制 + 幂等调度
//
// ⚠️ 不直接使用 @loaders.gl/textures 的 KTX2BasisWriter.encode：
// 其 4.4.4 实现返回 `basisFileData.subarray(0, n).buffer`——subarray 是视图，
// `.buffer` 是整个底层 ArrayBuffer（原始 RGBA 大小），导致缓存写入"原始大小 +
// 零填充"的假 KTX2（魔数合法但体积虚胖）。这里直接调 BasisEncoder API，
// 用 `slice(0, n)` 复制出真实长度的压缩数据。

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

// ===== 本地 basis_encoder WASM 加载与 KTX2 编码（绕开 loaders.gl 的 subarray().buffer 假成功 bug）=====
// 核心实现已抽取到 mmd-ktx2-basis.ts（主线程与 Worker 共用，无 DOM 依赖）。
// 本文件保留编码调度/并发/缓存逻辑，并在此处导出兼容符号。

export { TextureTooLargeError, MAX_KTX2_PIXELS } from "./mmd-ktx2-basis.ts";
import { encodeToKTX2Basis, TextureTooLargeError, MAX_KTX2_PIXELS } from "./mmd-ktx2-basis.ts";
// type-only import：不产生运行时 import（worker 文件含 self.onmessage，主线程不能执行它）
import type { Ktx2EncodeRequest, Ktx2EncodeResponse } from "./mmd-ktx2-worker.ts";

/** Worker 池大小（与 MAX_CONCURRENT 对齐：3 个并行编码线程） */
const KTX2_WORKER_COUNT = 3;

/** 单次编码超时（ms）：4096² 实测 ~10s，120s 仅兜底防 worker 僵尸 */
const KTX2_ENCODE_TIMEOUT_MS = 120_000;

let ktx2Workers: Worker[] | null = null;
let nextWorkerIdx = 0;
let encodeRequestSeq = 0;
const pendingEncode = new Map<number, {
  resolve: (b: ArrayBuffer) => void;
  reject: (e: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}>();

/** 懒创建 Worker 池；不支持（非浏览器/被屏蔽）返回 null → 调用方降级同步编码 */
function getKtx2WorkerPool(): Worker[] | null {
  if (ktx2Workers) return ktx2Workers;
  if (typeof Worker === "undefined") return null;
  try {
    const pool: Worker[] = [];
    for (let i = 0; i < KTX2_WORKER_COUNT; i++) {
      const w = new Worker(new URL("./mmd-ktx2-worker.ts", import.meta.url), { type: "module" });
      w.onmessage = (e: MessageEvent<Ktx2EncodeResponse>) => {
        const { id, ok, buffer, error } = e.data;
        const p = pendingEncode.get(id);
        if (!p) return;
        pendingEncode.delete(id);
        clearTimeout(p.timer);
        if (ok && buffer) p.resolve(buffer);
        else p.reject(new Error(error ?? "KTX2 worker 编码失败"));
      };
      // worker 崩溃 → 终止整池并让在途任务降级（对齐 web-stats 降级契约）
      w.onerror = () => {
        terminateKtx2Workers();
      };
      pool.push(w);
    }
    ktx2Workers = pool;
    return pool;
  } catch {
    ktx2Workers = null;
    return null;
  }
}

/** 终止全部 KTX2 worker，在途任务全部 reject（降级同步路径） */
function terminateKtx2Workers(): void {
  if (ktx2Workers) {
    for (const w of ktx2Workers) w.terminate();
    ktx2Workers = null;
  }
  for (const [, p] of pendingEncode) {
    clearTimeout(p.timer);
    p.reject(new Error("KTX2 worker 终止"));
  }
  pendingEncode.clear();
}

/**
 * 主线程编码入口：优先走 Worker（mmd-ktx2-worker.ts）避免 WASM 同步编码阻塞 UI；
 * Worker 不可用（测试/受限环境）时降级同步编码。
 * 测试注入点 __setEncodeImplForTest 会整体替换此函数，故测试不触碰 Worker。
 */
export async function encodeToKTX2(img: { data: Uint8Array; width: number; height: number }): Promise<ArrayBuffer> {
  // 超大纹理直接跳过（主线程先拦，语义清晰；worker 内 encodeToKTX2Basis 也有双保险）
  if (img.width * img.height > MAX_KTX2_PIXELS) {
    throw new TextureTooLargeError(img.width, img.height);
  }
  const pool = getKtx2WorkerPool();
  if (!pool) {
    // 降级：同步编码（测试环境 / Worker 被屏蔽）
    return encodeToKTX2Basis(img);
  }
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const id = ++encodeRequestSeq;
    const w = pool[nextWorkerIdx % pool.length];
    nextWorkerIdx = (nextWorkerIdx + 1) % pool.length;
    const timer = setTimeout(() => {
      pendingEncode.delete(id);
      reject(new Error(`KTX2 编码超时（${KTX2_ENCODE_TIMEOUT_MS}ms）`));
    }, KTX2_ENCODE_TIMEOUT_MS);
    pendingEncode.set(id, { resolve, reject, timer });
    // blobUrlToImageData 返回 new Uint8Array(imageData.data.buffer)，保证是 ArrayBuffer（非 SharedArrayBuffer）
    const dataBuf = img.data.buffer as ArrayBuffer;
    const req: Ktx2EncodeRequest = { id, width: img.width, height: img.height, data: dataBuf };
    w.postMessage(req, [dataBuf]); // transfer：零拷贝，避免 64MB 大数组复制阻塞主线程
  });
}

/** 测试注入点：替换编码实现（默认走本地 WASM） */
let encodeImpl: (img: { data: Uint8Array; width: number; height: number }) => Promise<ArrayBuffer> = encodeToKTX2;

/** 测试用：注入编码实现（默认走本地 WASM） */
export function __setEncodeImplForTest(fn: typeof encodeImpl): void {
  encodeImpl = fn;
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
    // 本地 WASM 编码为 KTX2（绕开 loaders.gl 4.4.4 subarray().buffer 假成功 bug，见文件头注释）
    const ktx2Buffer = await encodeImpl(imageData);
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
      const msg = safeErrorMessage(e);
      // 超大纹理跳过：非错误，记 warn（避免误报失败刷屏）
      void port.addOpLog("ktx2-encode", hash, e instanceof TextureTooLargeError ? "warn" : "fail", msg);
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