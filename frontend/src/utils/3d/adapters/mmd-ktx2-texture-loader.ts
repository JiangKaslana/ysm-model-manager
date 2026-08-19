// ===== KTX2 直载纹理 loader（方案 A）=====
// 通过 LoadingManager.addHandler 注册到 MMDLoader 的 manager，拦截 loadTextureResource
// 的 loader 选择（three-mmd dist/index.js:2202 `ctx.manager.getHandler(fullPath)`）：
// 纹理 URL → resolveHash 查 KTX2 缓存 → 命中则 KTX2Loader 直载压缩纹理，
// 未命中/失败回退原 TextureLoader（PNG 原路径）。
//
// 收益：材质构建阶段直接拿到 CompressedTexture，PNG 解码从加载路径消失
// （二次加载 Decode Image 不再出现，texture 阶段 2900ms → 数百 ms）。
//
// 一致性契约：load() 同步返回占位纹理（材质/ctx.textures 引用它），
// 异步填充后 onLoad 收到同一对象——与 three-mmd 的 loadTextureResource
// 缓存语义（ctx.textures[fullPath]）兼容。
//
// toon 排除：toon 贴图会走 getRotatedImage(t.image)（canvas 旋转），
// CompressedTexture 的 image 是 mipmap 数组无法 drawImage——toon 不直载
// （由 resolveHash 返回 undefined 实现，本 loader 不感知 toon）。
import * as THREE from "three";

/** 拦截 loader 依赖注入（装配方提供） */
export interface Ktx2TextureLoaderDeps {
  /** URL(fullPath) → 缓存 hash；返回 undefined = 不直载（回退原 loader） */
  resolveHash: (url: string) => string | undefined;
  /** 读取 KTX2 缓存（Go RPC），返回 base64 或 null */
  getCachedTextureByHash: (hash: string) => Promise<string | null>;
  /** KTX2 解码器（需 detectSupport(renderer) 后传入） */
  ktx2Loader: { loadAsync: (url: string) => Promise<THREE.CompressedTexture> };
  /** 回退 loader（原 TextureLoader，同 manager 继承 URLModifier） */
  fallbackLoader: THREE.TextureLoader;
}

/** 将 CompressedTexture 的关键字段合并到占位纹理（保持对象身份一致） */
function mergeInto(placeholder: THREE.CompressedTexture, src: THREE.CompressedTexture): void {
  placeholder.image = src.image;
  placeholder.mipmaps = src.mipmaps;
  placeholder.format = src.format;
  placeholder.type = src.type;
  placeholder.minFilter = src.minFilter;
  placeholder.magFilter = src.magFilter;
  placeholder.generateMipmaps = src.generateMipmaps;
  placeholder.needsUpdate = true;
}

/** base64 → Uint8Array */
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export class Ktx2TextureLoader extends THREE.Loader {
  constructor(private readonly deps: Ktx2TextureLoaderDeps) {
    super();
  }

  /**
   * 与 TextureLoader.load 同签名：同步返回纹理（直载为占位 CompressedTexture，
   * 回退为原 loader 的 Texture），异步填充/解码后 onLoad 收到同一对象。
   */
  load(
    url: string,
    onLoad?: (texture: THREE.Texture) => void,
    onProgress?: (event: ProgressEvent) => void,
    onError?: (event: unknown) => void,
  ): THREE.Texture {
    const hash = this.deps.resolveHash(url);
    // 未命中缓存候选 → 原样回退
    if (!hash) {
      return this.deps.fallbackLoader.load(url, onLoad, onProgress, onError);
    }

    const placeholder = new THREE.CompressedTexture([], 0, 0);
    const fallback = (): void => {
      // 回退：原 loader 加载 PNG，onLoad 收到其纹理（与直载返回对象不同——
      // 但回退路径下材质引用的是 fallbackLoader 返回的纹理，仍一致）
      const tex = this.deps.fallbackLoader.load(url, onLoad, onProgress, onError);
      void tex; // fallback 返回对象由调用方直接使用
    };

    this.deps
      .getCachedTextureByHash(hash)
      .then(async (b64) => {
        if (!b64) {
          fallback();
          return;
        }
        const ktxBytes = b64ToBytes(b64);
        const blob = new Blob([ktxBytes as unknown as BlobPart], { type: "image/ktx2" });
        const blobUrl = URL.createObjectURL(blob);
        try {
          const compressed = await this.deps.ktx2Loader.loadAsync(blobUrl);
          mergeInto(placeholder, compressed);
          onLoad?.(placeholder);
        } catch {
          fallback();
        } finally {
          URL.revokeObjectURL(blobUrl);
        }
      })
      .catch(() => fallback());

    return placeholder;
  }
}
