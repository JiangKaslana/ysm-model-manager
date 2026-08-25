import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { AlphaIndex } from "./alpha-index.ts";
import { getTextureAlphaInfo, getTextureAlphaMode } from "./texture-alpha.ts";

function rgbaTexture(pixels: number[][]): THREE.DataTexture {
  const data = new Uint8Array(pixels.length * 4);
  pixels.forEach((px, i) => data.set(px, i * 4));
  return new THREE.DataTexture(data, pixels.length, 1);
}

describe("getTextureAlphaMode", () => {
  it("classifies fully opaque textures as opaque", () => {
    const tex = rgbaTexture([
      [10, 20, 30, 255],
      [40, 50, 60, 255],
      [70, 80, 90, 255],
      [0, 0, 0, 255],
    ]);
    expect(getTextureAlphaMode(tex)).toBe("opaque");
  });

  it("classifies binary alpha with holes as cutout", () => {
    const tex = rgbaTexture([
      [10, 20, 30, 255],
      [40, 50, 60, 0],
      [70, 80, 90, 255],
      [0, 0, 0, 255],
    ]);
    expect(getTextureAlphaMode(tex)).toBe("cutout");
  });

  it("classifies dense semi-transparent textures as blend", () => {
    const tex = rgbaTexture([
      [10, 20, 30, 128],
      [40, 50, 60, 128],
      [70, 80, 90, 128],
      [0, 0, 0, 255],
    ]);
    expect(getTextureAlphaMode(tex)).toBe("blend");
  });

  it("treats stray semi-transparent noise under threshold as cutout", () => {
    const tex = rgbaTexture(
      Array.from({ length: 512 }, (_, i) =>
        i === 0
          ? [10, 20, 30, 128]
          : i % 8 === 7
            ? [40, 50, 60, 0]
            : [0, 0, 0, 255],
      ),
    );
    expect(getTextureAlphaMode(tex)).toBe("cutout");
  });

  it("keeps blend when semi-transparent ratio exceeds threshold", () => {
    const tex = rgbaTexture(
      Array.from({ length: 50 }, (_, i) =>
        i < 4 ? [10, 20, 30, 128] : [0, 0, 0, 255],
      ),
    );
    // 4/50 = 8% 半透明 > 5% 阈值 → blend
    expect(getTextureAlphaMode(tex)).toBe("blend");
  });

  it("caches the classification in userData", () => {
    const tex = rgbaTexture([
      [10, 20, 30, 255],
      [40, 50, 60, 255],
    ]);
    expect(getTextureAlphaMode(tex)).toBe("opaque");
    (tex.image as { data: Uint8Array }).data.fill(128);
    expect(getTextureAlphaMode(tex)).toBe("opaque");
  });
});

describe("getTextureAlphaInfo", () => {
  it("returns mode plus face-query index for RGBA data textures", () => {
    const tex = rgbaTexture([
      [10, 20, 30, 0],
      [40, 50, 60, 128],
    ]);
    const info = getTextureAlphaInfo(tex);
    expect(info.mode).toBe("blend");
    expect(info.index).toBeInstanceOf(AlphaIndex);
    expect(info.width).toBe(2);
    expect(info.height).toBe(1);
  });

  it("returns null index when pixels are unreadable", () => {
    const tex = new THREE.DataTexture(new Uint8Array(16), 2, 2);
    (tex as unknown as { format: THREE.PixelFormat }).format = THREE.RGBFormat;
    const info = getTextureAlphaInfo(tex);
    expect(info.index).toBeNull();
    // 像素不可读回退 opaque：避免 taint/跨域源整模型被误判全透明（导致硬实部件丢失）
    expect(info.mode).toBe("opaque");
  });

  it("caches one info object per texture", () => {
    const tex = rgbaTexture([
      [10, 20, 30, 255],
      [40, 50, 60, 0],
    ]);
    expect(getTextureAlphaInfo(tex)).toBe(getTextureAlphaInfo(tex));
  });
});
