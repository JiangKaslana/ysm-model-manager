import * as THREE from "three";

export type TextureAlphaMode = "opaque" | "cutout" | "blend";

const ALPHA_MODE_KEY = "ysmAlphaMode";

/** Classify alpha once per cached texture so material setup can choose a render path. */
export function getTextureAlphaMode(texture: THREE.Texture): TextureAlphaMode {
  const cached = texture.userData[ALPHA_MODE_KEY] as TextureAlphaMode | undefined;
  if (cached) return cached;

  const pixels = readRgbaPixels(texture);
  const mode = pixels ? classifyRgba(pixels) : "blend";
  texture.userData[ALPHA_MODE_KEY] = mode;
  return mode;
}

function classifyRgba(data: ArrayLike<number>): TextureAlphaMode {
  let hasTransparent = false;
  for (let i = 3; i < data.length; i += 4) {
    const alpha = data[i] ?? 255;
    if (alpha > 0 && alpha < 255) return "blend";
    if (alpha === 0) hasTransparent = true;
  }
  return hasTransparent ? "cutout" : "opaque";
}

function readRgbaPixels(texture: THREE.Texture): ArrayLike<number> | null {
  const image = texture.image as {
    data?: ArrayLike<number>;
    width?: number;
    height?: number;
    naturalWidth?: number;
    naturalHeight?: number;
  } | null;
  if (!image) return null;

  if (image.data && texture.format === THREE.RGBAFormat) return image.data;
  if (image.data && texture.format !== THREE.RGBAFormat) return null;

  const width = image.naturalWidth ?? image.width ?? 0;
  const height = image.naturalHeight ?? image.height ?? 0;
  if (!width || !height || typeof document === "undefined") return null;

  try {
    // 缩小采样（code review P3）：全分辨率 readback 对 2048²/4096² 纹理分配 16-64MB
    // 并阻塞主线程数十 ms（每纹理一次，模型构建关键路径）；alpha 模式分类只需
    // 有界样本，256px 封顶即可
    const MAX_SAMPLE = 256;
    const scale = Math.min(1, MAX_SAMPLE / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(texture.image as CanvasImageSource, 0, 0, canvas.width, canvas.height);
    return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  } catch {
    // Preserve rendering for unsupported/tainted image sources.
    return null;
  }
}
