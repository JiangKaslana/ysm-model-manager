// ===== MMD 纹理 KTX2 后台编码器 =====
// 在浏览器中通过 WASM basis_encoder 将 PNG 纹理编码为 KTX2 格式，
// 结果通过 SaveCachedTexture 保存到 Go 侧缓存目录。下次加载时直接命中缓存。
//
// 编码在后台进行（Promise），不阻塞模型加载和渲染。
// 编码失败静默降级，不影响已有 PNG 纹理。

// 使用动态 import 加载 KTX2BasisWriter（含 BasisEncoder WASM）
import type { MmdDataPort } from "./mmd-adapter.ts";

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
  try {
    // 解码 PNG → ImageData
    const imageData = await blobUrlToImageData(pngBlobUrl);
    // 动态导入 KTX2BasisWriter（运行时加载 encode 函数）
    const { KTX2BasisWriter } = await import("@loaders.gl/textures");
    // 编码为 KTX2（Basis Universal）
    const ktx2Buffer = await (KTX2BasisWriter as unknown as { encode: (img: unknown, opts?: unknown) => Promise<ArrayBuffer> }).encode(imageData, {
      "ktx2-basis-writer": {
        qualityLevel: 128, // 质量 1-255，128 是平衡值
        encodeUASTC: false, // 用 ETC1S（更小，兼容性更好）
        mipmaps: false, // 不需要 mipmap，预览用
        useSRGB: false,
      },
    });
    // 将 KTX2 ArrayBuffer 转为 base64
    const ktx2Bytes = new Uint8Array(ktx2Buffer);
    let binary = "";
    for (let i = 0; i < ktx2Bytes.length; i++) {
      binary += String.fromCharCode(ktx2Bytes[i]);
    }
    const ktx2B64 = btoa(binary);
    // 保存到 Go 侧缓存
    if (port.addOpLog) {
      void port.addOpLog("ktx2-encode", hash, "ok", `bytes=${ktx2Bytes.length} original=${imageData.width}x${imageData.height}`);
    }
    // 通过 Go 绑定保存缓存
    // 注意：这里需要调用 Go 的 SaveCachedTexture 绑定
    // 但由于 port 接口不包含 SaveCachedTexture，我们直接调用 go 绑定
    // 实际上，port 是 MmdDataPort 接口，没有 SaveCachedTexture
    // 我们需要通过 getApp() 来调用
    // 这是一个临时方案，后续可以重构
    const { getApp } = await import("../../../backend/app.ts");
    const app = await getApp();
    const saveFn = (app as unknown as Record<string, (h: string, d: string) => Promise<void>>)["SaveCachedTexture"];
    if (typeof saveFn === "function") {
      await saveFn(hash, ktx2B64);
    }
    return true;
  } catch (e) {
    // 编码失败静默降级，不影响已有纹理
    if (port.addOpLog) {
      void port.addOpLog("ktx2-encode", hash, "fail", e instanceof Error ? e.message : String(e));
    }
    return false;
  }
}

/**
 * 遍历 mesh 材质，对有 KTX2 缓存需要的纹理进行后台编码。
 * 在模型加载完成后调用，不阻塞渲染。
 * @param hashByBlobUrl blob URL → hash 映射
 * @param port 数据端口
 */
export function scheduleBackgroundEncoding(
  hashByBlobUrl: Map<string, string>,
  port: MmdDataPort,
): void {
  // 在微任务中启动编码，避免阻塞当前帧
  queueMicrotask(() => {
    for (const [blobUrl, hash] of hashByBlobUrl) {
      // 每个纹理编码是独立的 Promise，不互相等待
      encodeAndCacheTexture(hash, blobUrl, port).then((ok) => {
        if (ok) {
          console.debug(`[ktx2] 编码完成: ${hash.slice(0, 8)}...`);
        }
      });
    }
  });
}