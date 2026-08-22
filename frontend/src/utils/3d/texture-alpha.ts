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
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(texture.image as CanvasImageSource, 0, 0, width, height);
    return ctx.getImageData(0, 0, width, height).data;
  } catch {
    // Preserve rendering for unsupported/tainted image sources.
    return null;
  }
}
