// ===== WASM 解码层 =====
// 从 index.ts 拆分：.ysm 文件的前端 WASM 解码逻辑
import { devLog } from "./utils.ts";
import { stripYsgpTextHeader, type DecodedYsm } from "./utils.ts";
import { cacheGet, cacheSet } from "./cache.ts";
import { parseBedrockGeometryFromJSON, type BedrockGeometry } from "./geometry.ts";
import { parseBedrockAnimationJSON } from "../../utils/animation/animation.ts";
import { initYSMParser, decodeYsmFileFromMemory, decodeYsmFile } from "../../wasm/ysm-parser.ts";
import { parseYsmJsonDirect } from "./parse-ysm-json.ts";
import { extractAnimGroupsAndConfigs } from "../../utils/format/ysm-anim-config.ts";
import { buildOrderedTexKeys } from "./texture-order.ts";
import { getApp } from "../../backend/app.ts";

/** 并发去重：同一路径在途解码共享（Android 兜底与纹理并行触发时只解一次）。
 *  无此守卫时 preloadModel 并行发起的两次 decodeYsmViaWasm 会各自完整解码
 *  （atob 大字符串 ×2 + 解析 ×2，内存翻倍、时间翻倍、WASM 状态竞争——容错下降）。 */
const _decodeInFlight = new Map<string, Promise<DecodedYsm | null>>();

export function decodeYsmViaWasm(modelPath: string): Promise<DecodedYsm | null> {
  const inFlight = _decodeInFlight.get(modelPath);
  if (inFlight) return inFlight;
  const p = doDecodeYsmViaWasm(modelPath);
  _decodeInFlight.set(modelPath, p);
  // 防御：finally 的派生 Promise 显式挂 catch，防未来 doDecode 新增 reject 路径
  // 时产生 unhandled rejection（当前 doDecode 外层 catch 返回 null，不 reject）
  // 不吞错：记录便于排查（devLog 仅 DEV 输出，零运行时开销）
  void p.finally(() => _decodeInFlight.delete(modelPath)).catch((e) =>
    devLog(`[YSM] in-flight 守卫异常: ${e instanceof Error ? e.message : String(e)}`),
  );
  return p;
}

/** WASM 解码输出文件 */
interface DecodedFile {
  path: string;
  data: Uint8Array;
}

/** 纹理尺寸 */
interface TexDim {
  w: number;
  h: number;
}

// --- 纹理头魔数（与 Go 端 imagePixelArea 守部一致，勿单独改）---
/** PNG 8 字头签名前 3 字节（89 50 4E，后接 47 0A 16 0A） */
const PNG_SIG = [0x89, 0x50, 0x4e];
/** JPEG SOI(0xD8) 标记——段起始 0xFF */
const JPEG_MARKER = 0xff;
/** JPEG SOF0-15 段携带尺寸；排除无尺寸的 DHT(0xC4)/JPG(0xC8)/DAC(0xCC) */
const JPEG_SOF_MASK = 0xc0;
const JPEG_SOF_EXCLUDE = [0xc4, 0xc8, 0xcc];
/** JPEG 头部扫描上限（足够覆盖 SOI 后首个 SOF，与 Go 端一致） */
const JPEG_HEADER_SCAN_LIMIT = 4096;

/**
 * 通过前端 WASM 解码 .ysm，返回 { texture, geometry, animations }
 * 不依赖组件实例（无 this 引用），可独立调用
 */
export async function doDecodeYsmViaWasm(
  modelPath: string,
): Promise<DecodedYsm | null> {
  const cached = cacheGet(modelPath);
  const cachedGeo = cached?.geometry as BedrockGeometry | undefined;
  if (cachedGeo?.bones?.length) return cached as DecodedYsm;
  if (cached?._wasmFailed) return null;

  // 读文件（WASM 和 JSON 都需要，提升到外层作用域供两个 try 块共用）
  let bytes: Uint8Array | null = null;
  try {
    const { ReadFileBytes } = await getApp();
    // ReadFileBytes 绑定返回 base64 string | null（非 Uint8Array——原 JS 的
    // instanceof Uint8Array 分支是死代码，已清理）
    const raw = await ReadFileBytes(modelPath);
    if (raw) {
      const rawStr = atob(raw);
      const len = rawStr.length;
      const arr = new Uint8Array(len);
      for (let i = 0; i < len; i++) arr[i] = rawStr.charCodeAt(i);
      bytes = arr;
    } else {
      bytes = new Uint8Array(0);
    }
    devLog(`[YSM] 读取 ${bytes?.length || 0} bytes`);
    if (!bytes?.length) {
      cacheSet(modelPath, { _wasmFailed: true });
      return null;
    }

    // .json 文件直接解析（ysm.json spec 格式或 minecraft.geometry 格式）
    if (/\.json$/i.test(modelPath)) {
      const text = new TextDecoder("utf-8").decode(bytes);
      const json = JSON.parse(text);
      const result = parseYsmJsonDirect(json);
      if (result) {
        // 提取 baseDir（用于 ReadFileBytes 拼接相对路径）
        const dir = modelPath.replace(/\\/g, "/");
        const baseDir = dir.includes("/") ? dir.substring(0, dir.lastIndexOf("/")) : ".";

        // ysm.json spec 格式：parseYsmJsonDirect 返回 _ysmMeta，需读取 modelFiles + texFiles 合并
        const ysmMeta = (result.geometry as { _ysmMeta?: {
          modelFiles?: unknown[];
          texFiles?: unknown[];
          defaultTexture?: string | null;
        } })?._ysmMeta;
        if (ysmMeta?.modelFiles?.length) {
          // 守卫：占位 geometry 可能为 null（parseYsmJsonDirect 返回 DecodedYsm | null，
          // 合并前须断言非空，避免 TS18049 与运行时解构 null）
          if (!result.geometry) return result;
          try {
            const allBones: BedrockGeometry["bones"] = [];
            let boneCount = 0, cubeCount = 0;
            let firstGeoRaw: string | null = null;
            const processed = new Set<string>();

            // 读取模型文件，合并骨骼
            for (const mf of ysmMeta.modelFiles) {
              const mfStr = typeof mf === "string" ? mf : (mf as { path?: string })?.path || "";
              if (!mfStr || processed.has(mfStr)) continue;
              processed.add(mfStr);

              // 路径归一化：ysm.json 中 modelFiles 可能是相对路径或带 models/ 前缀
              let modelRel = mfStr;
              if (!modelRel.startsWith("models/") && !modelRel.startsWith("models\\")) {
                // 尝试补 models/ 前缀
                modelRel = "models/" + mfStr;
              }
              const rawModel = await ReadFileBytes(baseDir + "/" + modelRel);
              if (!rawModel) {
                // 补前缀失败，尝试原始路径
                const rawModel2 = await ReadFileBytes(baseDir + "/" + mfStr);
                if (!rawModel2) continue;
                // 继续用 rawModel2
                const rawStr2 = atob(rawModel2);
                const len2 = rawStr2.length;
                const arr2 = new Uint8Array(len2);
                for (let i = 0; i < len2; i++) arr2[i] = rawStr2.charCodeAt(i);
                const jsonStr2 = new TextDecoder().decode(arr2);
                const parsed2 = parseBedrockGeometryFromJSON(jsonStr2);
                if (parsed2?.bones?.length) {
                  if (!firstGeoRaw) firstGeoRaw = jsonStr2;
                  allBones.push(...parsed2.bones);
                  boneCount += parsed2.boneCount;
                  cubeCount += parsed2.cubeCount;
                }
                continue;
              }

              const rawStr = atob(rawModel);
              const len = rawStr.length;
              const arr = new Uint8Array(len);
              for (let i = 0; i < len; i++) arr[i] = rawStr.charCodeAt(i);
              const jsonStr = new TextDecoder().decode(arr);
              const parsed = parseBedrockGeometryFromJSON(jsonStr);
              if (parsed?.bones?.length) {
                if (!firstGeoRaw) firstGeoRaw = jsonStr;
                allBones.push(...parsed.bones);
                boneCount += parsed.boneCount;
                cubeCount += parsed.cubeCount;
              }
            }

            // 读取纹理文件
            const textures: Record<string, string> = {};
            const texDimensions: Record<string, { w: number; h: number }> = {};
            const texKeys: string[] = [];
            let maxTexW = 0, maxTexH = 0;

            for (const tf of ysmMeta.texFiles || []) {
              const tfStr = typeof tf === "string" ? tf : (tf as { uv?: string })?.uv || "";
              if (!tfStr) continue;
              const texRel = tfStr.startsWith("textures/") || tfStr.startsWith("textures\\")
                ? tfStr
                : "textures/" + tfStr;
              const rawTex = await ReadFileBytes(baseDir + "/" + texRel);
              if (!rawTex) continue;

              const rawStr = atob(rawTex);
              const len = rawStr.length;
              const arr = new Uint8Array(len);
              for (let i = 0; i < len; i++) arr[i] = rawStr.charCodeAt(i);

              const blob = new Blob([arr.buffer as ArrayBuffer], {
                type: tfStr.toLowerCase().endsWith(".jpg") || tfStr.toLowerCase().endsWith(".jpeg")
                  ? "image/jpeg"
                  : "image/png",
              });
              const key = tfStr.split(/[/\\]/).pop()?.replace(/\.\w+$/, "") || "";
              textures[key] = URL.createObjectURL(blob);
              texKeys.push(key);

              // 尺寸嗅探
              let texW = 0, texH = 0;
              if (arr[0] === PNG_SIG[0] && arr[1] === PNG_SIG[1] && arr[2] === PNG_SIG[2]) {
                texW = (arr[16] << 24) | (arr[17] << 16) | (arr[18] << 8) | arr[19];
                texH = (arr[20] << 24) | (arr[21] << 16) | (arr[22] << 8) | arr[23];
              }
              if (texW > 0 && texH > 0) {
                texDimensions[key] = { w: texW, h: texH };
                if (texW > maxTexW) maxTexW = texW;
                if (texH > maxTexH) maxTexH = texH;
              }
            }

            if (allBones.length > 0 && result.geometry) {
              // 合并骨骼：每个 bone 补 _texWidth/_texHeight
              const geo = result.geometry;
              // 计算 UV 最大范围（与 .ysm WASM 路径 boneTexW 一致，见 wasm.ts:547-583）
              let uvMaxW = 2,
                uvMaxH = 2;
              for (const b of allBones) {
                for (const c of b.cubes || []) {
                  if (Array.isArray(c.uv) && c.uv.length >= 2) {
                    const [u, v] = c.uv;
                    if (u > uvMaxW) uvMaxW = u;
                    if (v > uvMaxH) uvMaxH = v;
                  }
                }
              }
              const boneTexW = Math.max(maxTexW, geo.texWidth, uvMaxW) || 64;
              const boneTexH = Math.max(maxTexH, geo.texHeight, uvMaxH) || 64;
              for (const b of allBones) {
                b._texWidth = boneTexW;
                b._texHeight = boneTexH;
              }

              result.geometry = {
                ...geo,
                bones: allBones,
                boneCount,
                cubeCount,
                texWidth: Math.max(boneTexW, geo.texWidth),
                texHeight: Math.max(boneTexH, geo.texHeight),
                textures: texKeys.map((k) => textures[k]).filter(Boolean),
                texture: texKeys.length > 0 ? textures[texKeys[0]] : null,
                textureNames: texKeys,
              };
              if (firstGeoRaw) {
                result.geometryRaw = firstGeoRaw;
              }
            }
          } catch (e) {
            devLog(`[YSM] JSON 合并几何失败: ${e instanceof Error ? e.message : String(e)}`);
          }
        }

        // 头像读取（保留原有逻辑）
        if (result.authors?.length) {
          for (const au of result.authors) {
            if (!au.avatarPath) continue;
            try {
              const avatarRel =
                au.avatarPath.startsWith("avatar/") || au.avatarPath.startsWith("avatar\\")
                  ? au.avatarPath
                  : "avatar/" + au.avatarPath;
              let avatarBytes: Uint8Array | null = null;
              const rawAvatar = await ReadFileBytes(baseDir + "/" + avatarRel);
              if (rawAvatar) {
                const rawStr = atob(rawAvatar);
                const len = rawStr.length;
                const arr = new Uint8Array(len);
                for (let i = 0; i < len; i++) arr[i] = rawStr.charCodeAt(i);
                avatarBytes = arr;
              }
              if (avatarBytes?.length) {
                const blob = new Blob([avatarBytes.buffer as ArrayBuffer]);
                au.avatarUrl = URL.createObjectURL(blob);
              }
            } catch (_e) {}
          }
        }
        cacheSet(modelPath, { ...result, _decodedBy: "🧠 JSON 直接解析" });
        // 异步缓存头像到 creators_cache/ 供创作者界面使用
        getApp()
          .then(({ CacheModelAvatars }) => CacheModelAvatars(modelPath))
          .catch(() => {});
        return result;
      }
      return null;
    }
  } catch (e) {
    devLog(`[YSM] ❌ ${e instanceof Error ? e.message : String(e)}`);
    cacheSet(modelPath, { _wasmFailed: true });
    return null;
  }

  if (!bytes) return null;

  // .ysm 文件 → 初始化 WASM 解码
  try {
    devLog("[YSM] 加载 WASM 模块...");
    const ok = await initYSMParser();
    console.log(`[YSM] WASM init: ${ok ? "✅" : "❌"}`);
    if (!ok) {
      cacheSet(modelPath, { _wasmFailed: true });
      return null;
    }

    // 先快路径：decodeYsmFileFromMemory（对标准 V2/V1 文件秒出）
    let files: DecodedFile[] = [];
    try {
      files = (await decodeYsmFileFromMemory(bytes)) || [];
      if (files?.length) {
        console.log(`[YSM] ✅ 原始字节解码成功: ${files.length} 文件`);
      }
    } catch (e) {
      // 不静默吞错：abort/trap/out of memory 等硬崩溃信号需留痕便于排查
      // （ysm-parser 内部已对硬崩溃 resetYSMParser 重置单例，此处仅记录）
      devLog(`[YSM] 原始字节解码异常: ${e instanceof Error ? e.message : String(e)}`);
    }

    // 快路径失败 → 尝试 MEMFS（callMain，能处理 V3 文本头部等特殊格式）
    if (!files?.length) {
      console.log("[YSM] 原始字节解码失败，尝试 MEMFS 文件路径解码...");
      try {
        files = (await decodeYsmFile(bytes)) || [];
        if (files?.length) {
          console.log(`[YSM] ✅ MEMFS 解码成功: ${files.length} 文件`);
        }
      } catch (e2) {
        console.log(`[YSM] MEMFS 解码异常: ${e2 instanceof Error ? e2.message : String(e2)}`);
      }
    }

    // MEMFS 也失败 → 尝试剥离文本头部后重建
    if (!files?.length) {
      for (const tryVer of [null, 3]) {
        const rebuilt = stripYsgpTextHeader(bytes, tryVer ?? undefined);
        if (rebuilt === bytes || !rebuilt) continue;
        const verLabel = tryVer ? `V${tryVer}` : "V2(自动)";
        console.log(`[YSM] 原始解码失败，尝试剥离文本头部(${verLabel})...`);
        try {
          files = (await decodeYsmFileFromMemory(rebuilt)) || [];
          if (files?.length) {
            break;
          }
        } catch (e3) {
          console.log(`[YSM] 剥离${verLabel}解码异常: ${e3 instanceof Error ? e3.message : String(e3)}`);
        }
      }
    }

    if (!files?.length) {
      console.log("[YSM] 内存解析返回空（跳过 callMain 直接回退 Go CLI）");
    }
    console.log(`[YSM] 输出 ${files?.length || 0} 文件`);
    if (files?.length) {
      console.log(`[YSM] 文件: ${files.map((f) => f.path).join(", ")}`);
    }
    if (!files?.length) {
      console.log("[YSM] ❌ WASM 解码失败，无输出文件");
      cacheSet(modelPath, { _wasmFailed: true });
      return null;
    }

    // 读取 ysm.json 获取纹理顺序和模型顺序
    let ysmTexOrder: unknown[] | null = null;
    let ysmModelOrder: unknown[] | null = null;
    let ysmDefaultTex: string | null = null;
    // 动画分组 / 配置菜单（解密 ysm.json properties 提取，详情卡补显加密模型信息）
    let ysmAnimGroups: DecodedYsm["animGroups"] = [];
    let ysmConfigMenus: DecodedYsm["configMenus"] = [];
    const ysmAuthors: Array<{
      name: string;
      role: string;
      avatarUrl: string | null;
      avatarPath: string;
    }> = [];
    // avatars 声明提前（原 JS 在 ysmMeta 块之后声明 → TDZ ReferenceError 被 catch 吞，
    // 导致 WASM 路径作者信息恒为空——顺带修复）
    const avatars: Record<string, string> = {};
    const ysmMeta = files.find((f) => f.path.endsWith("ysm.json"));
    if (ysmMeta) {
      try {
        const txt = new TextDecoder().decode(ysmMeta.data);
        const json = JSON.parse(txt) as {
          files?: { player?: { texture?: unknown; model?: unknown } };
          properties?: {
            default_texture?: string | null;
            extra_animation?: Record<string, unknown> | null;
            extra_animation_classify?: Array<{
              id?: string;
              name?: string;
              extra_animation?: Record<string, unknown> | null;
            }> | null;
            extra_animation_buttons?: Array<{
              id?: string;
              name?: string;
              config_forms?: unknown;
            }> | null;
          };
          metadata?: { authors?: Array<{ name?: string; role?: string; avatar?: string }> };
        };
        ysmTexOrder = json?.files?.player?.texture
          ? Array.isArray(json.files.player.texture)
            ? json.files.player.texture
            : [json.files.player.texture]
          : null;
        ysmModelOrder = Array.isArray(json?.files?.player?.model)
          ? json.files.player.model
          : json?.files?.player?.model
            ? [json.files.player.model]
            : null;
        ysmDefaultTex = json?.properties?.default_texture || null;
        // 提取动画分组 + 配置菜单（其他动画 / 模型配置 / 自定义表情）
        const animCfg = extractAnimGroupsAndConfigs(json?.properties);
        ysmAnimGroups = animCfg.animGroups;
        ysmConfigMenus = animCfg.configMenus;
      } catch (e) {
        /* ignore */
      }
    }

    // 收集所有纹理文件（同时收集头像）
    const textures: Record<string, string> = {};
    const texNameMap: Record<string, string> = {};
    const texLowerMap: Record<string, string> = {};
    const texDimensions: Record<string, TexDim> = {};
    let maxTexW = 0,
      maxTexH = 0;
    for (const f of files) {
      if (!(f.path.endsWith(".png") || f.path.endsWith(".jpg"))) continue;
      if (f.path.startsWith("avatar/") || f.path.startsWith("avatar\\")) {
        const mime = f.path.toLowerCase().endsWith(".jpg") || f.path.toLowerCase().endsWith(".jpeg")
          ? "image/jpeg"
          : "image/png";
        const blob = new Blob([f.data.buffer as ArrayBuffer], { type: mime });
        const name = f.path.split(/[/\\]/).pop()?.replace(/\.\w+$/, "") || "";
        avatars[name] = URL.createObjectURL(blob);
        continue;
      }
      const blob = new Blob([f.data.buffer as ArrayBuffer]);
      const key = f.path.split(/[/\\]/).pop()?.replace(/\.\w+$/, "") || "";
      textures[key] = URL.createObjectURL(blob);
      texNameMap[key] = f.path;
      texLowerMap[key.toLowerCase()] = key;
      const arr = new Uint8Array(f.data);
      let texW = 0,
        texH = 0;
      if (arr[0] === PNG_SIG[0] && arr[1] === PNG_SIG[1] && arr[2] === PNG_SIG[2]) {
        texW = (arr[16] << 24) | (arr[17] << 16) | (arr[18] << 8) | arr[19];
        texH = (arr[20] << 24) | (arr[21] << 16) | (arr[22] << 8) | arr[23];
      } else if (arr[0] === JPEG_MARKER && arr[1] === 0xd8) {
        for (let i = 2; i < Math.min(arr.length - 8, JPEG_HEADER_SCAN_LIMIT); i++) {
          const m = arr[i + 1];
          // SOF0-15，排除无尺寸的 DHT/JPG/DAC（与 Go 端 imagePixelArea 一致）
          if (
            arr[i] === JPEG_MARKER &&
            (m & 0xf0) === JPEG_SOF_MASK &&
            !JPEG_SOF_EXCLUDE.includes(m)
          ) {
            texH = (arr[i + 5] << 8) | arr[i + 6];
            texW = (arr[i + 7] << 8) | arr[i + 8];
            break;
          }
        }
      }
      if (texW > 0 && texH > 0) {
        texDimensions[key] = { w: texW, h: texH };
        if (texW > maxTexW) maxTexW = texW;
        if (texH > maxTexH) maxTexH = texH;
      }
      const td = texDimensions[key];
      devLog(
        `[YSM] 纹理: ${f.path} → key="${key}"${
          td ? ` (${td.w}×${td.h})` : ""
        }`,
      );
    }

    // 解析作者信息（在纹理循环之后：avatars map 已填充，avatarUrl 回填才有意义）
    if (ysmMeta) {
      try {
        const authorJson = JSON.parse(new TextDecoder().decode(ysmMeta.data)) as {
          metadata?: { authors?: Array<{ name?: string; role?: string; avatar?: string }> };
        };
        if (authorJson?.metadata?.authors) {
          for (const au of authorJson.metadata.authors) {
            if (!au.name) continue;
            const avatarPath = au.avatar || "";
            const avatarKey = avatarPath.split(/[/\\]/).pop()?.replace(/\.\w+$/, "") || "";
            ysmAuthors.push({
              name: au.name,
              role: au.role || "",
              avatarUrl: avatars[avatarKey] || null,
              avatarPath: avatarPath,
            });
          }
        }
      } catch (e) {
        /* ignore */
      }
    }

    const matchTexKey = (tn: string): string | null => {
      if (!tn) return null;
      if (textures[tn]) return tn;
      const lower = tn.toLowerCase();
      return texLowerMap[lower] || null;
    };

    let orderedTexKeys = buildOrderedTexKeys({
      texKeys: Object.keys(textures),
      areaOf: (k) => (texDimensions[k] ? texDimensions[k].w * texDimensions[k].h : 0),
      ysmTexOrder,
      ysmDefaultTex,
      matchTexKey,
    });

    // 构建模型文件→纹理索引映射
    const modelTexIdxMap = new Map<string, number>();
    if (ysmModelOrder) {
      for (let i = 0; i < ysmModelOrder.length; i++) {
        const mp = ysmModelOrder[i];
        const mn =
          (
            typeof mp === "string"
              ? mp
              : (mp as { path?: string; name?: string })?.path ||
                (mp as { name?: string })?.name ||
                ""
          )
            .split(/[/\\]/)
            .pop() || "";
        if (mn) {
          modelTexIdxMap.set(mn, Math.min(i, orderedTexKeys.length - 1));
        }
      }
    }

    // 解析模型文件，合并骨骼
    let geometry: BedrockGeometry | null = null;
    // 首个成功解析的 geometry 原始 JSON（Android 3D 兜底用）。
    // ⚠️ 必须在 processModelFile 定义之前声明：348 行原直接写 result.geometryRaw
    // 而 result 在函数末尾才声明 → TDZ ReferenceError 被 catch 吞 → geometry 恒空 →
    // WASM 解码全部失败（每次预览白跑一遍 + 回退 Go），并行会话 d664ad21 回归
    let firstGeometryRaw: string | null = null;
    const allBones: BedrockGeometry["bones"] = [];
    const processedModels = new Set<string>();
    const texMappingLog: Array<Record<string, string | number>> = [];

    const processModelFile = (f: DecodedFile, forcedTexIdx?: number): void => {
      if (!f || processedModels.has(f.path)) return;
      processedModels.add(f.path);
      devLog(`[YSM] 解析 ${f.path}...`);
      try {
        const jsonStr = new TextDecoder().decode(f.data);
        const parsed = parseBedrockGeometryFromJSON(jsonStr);
        if (!parsed?.bones?.length) return;
        devLog(`[YSM] ✅ ${f.path}: ${parsed.bones.length}骨 ${parsed.cubeCount}方`);
        // 保留原始 geometry JSON（首个成功模型），供 Android 无 Node 环境的前端解码兜底构建 3D spec
        if (!firstGeometryRaw) firstGeometryRaw = jsonStr;

        const texIdx = forcedTexIdx ?? 0;
        const texKey =
          orderedTexKeys.length > texIdx ? orderedTexKeys[texIdx] : orderedTexKeys[0] || null;
        const texUrl = texKey ? textures[texKey] : null;

        let uvMaxW = 2,
          uvMaxH = 2;
        for (const b of parsed.bones) {
          for (const c of b.cubes || []) {
            const [sx, sy, sz] = c.size;
            if (Array.isArray(c.uv) && c.uv.length >= 2) {
              const [u, v] = c.uv;
              const maxU = u + 2 * (Math.abs(sx) + Math.abs(sz));
              const maxV = v + Math.abs(sy) + Math.abs(sz);
              if (maxU > uvMaxW) uvMaxW = maxU;
              if (maxV > uvMaxH) uvMaxH = maxV;
            } else if (c.faceUV) {
              try {
                const fd = JSON.parse(c.faceUV) as Record<
                  string,
                  { uv?: number[]; uv_size?: number[] }
                >;
                for (const fn of ["east", "west", "up", "down", "south", "north"]) {
                  const f = fd[fn];
                  if (!f?.uv) continue;
                  const fw = Math.abs(f.uv_size?.[0] || 0);
                  const fh = Math.abs(f.uv_size?.[1] || 0);
                  const uEnd = f.uv[0] + fw;
                  const vEnd = f.uv[1] + fh;
                  if (uEnd > uvMaxW) uvMaxW = uEnd;
                  if (vEnd > uvMaxH) uvMaxH = vEnd;
                }
              } catch {}
            }
          }
        }

        const texDim = texKey ? texDimensions[texKey] : null;
        const actualTexW = texDim ? texDim.w : 0;
        const actualTexH = texDim ? texDim.h : 0;
        const boneTexW = Math.max(actualTexW, parsed.texWidth, uvMaxW) || 64;
        const boneTexH = Math.max(actualTexH, parsed.texHeight, uvMaxH) || 64;

        texMappingLog.push({
          file: f.path.split(/[/\\]/).pop() || "",
          texKey: texKey || "—",
          texIdx,
          pngSize: actualTexW > 0 ? `${actualTexW}×${actualTexH}` : "—",
          geoSize: parsed.texWidth > 0 ? `${parsed.texWidth}×${parsed.texHeight}` : "—",
          uvSize: `${uvMaxW}×${uvMaxH}`,
          finalSize: `${boneTexW}×${boneTexH}`,
        });
        for (const b of parsed.bones) {
          b._texIdx = texIdx;
          b._texUrl = texUrl;
          b._texWidth = boneTexW;
          b._texHeight = boneTexH;
        }
        allBones.push(...parsed.bones);
        if (!geometry) {
          geometry = parsed;
        } else {
          geometry.boneCount += parsed.boneCount;
          geometry.cubeCount += parsed.cubeCount;
          if (parsed.texWidth > geometry.texWidth) geometry.texWidth = parsed.texWidth;
          if (parsed.texHeight > geometry.texHeight) geometry.texHeight = parsed.texHeight;
        }
      } catch (e) {
        devLog(`[YSM] ❌ ${f.path}: ${e instanceof Error ? e.message : String(e)}`);
      }
    };

    // 第一轮：按 ysmModelOrder 顺序处理
    if (ysmModelOrder) {
      const texKeyToIdx: Record<string, number> = {};
      orderedTexKeys.forEach((k, i) => {
        texKeyToIdx[k] = i;
      });
      for (const mp of ysmModelOrder) {
        const mn =
          (
            typeof mp === "string"
              ? mp
              : (mp as { path?: string; name?: string })?.path ||
                (mp as { name?: string })?.name ||
                ""
          )
            .split(/[/\\]/)
            .pop() || "";
        if (!mn) continue;
        const lowerBase = mn.replace(/\.json$/i, "").toLowerCase();
        let matchedKey: string | null = null;
        for (const k of Object.keys(texKeyToIdx)) {
          if (k.toLowerCase().includes(lowerBase) || lowerBase.includes(k.toLowerCase())) {
            matchedKey = k;
            break;
          }
        }
        const texIdx = matchedKey != null ? (texKeyToIdx[matchedKey] ?? 0) : 0;
        const f = files.find(
          (ff) => ff.path.endsWith("/" + mn) || ff.path.endsWith("\\" + mn) || ff.path === mn,
        );
        if (f) processModelFile(f, texIdx);
      }
    }
    // 第二轮：处理 models/ 目录下的未匹配模型文件
    for (const f of files) {
      if (!f.path.startsWith("models/")) continue;
      const modelName = f.path.split("/").pop();
      const matched = ysmModelOrder?.some((mp) => {
        const mn = (
          typeof mp === "string"
            ? mp
            : (mp as { path?: string; name?: string })?.path || (mp as { name?: string })?.name || ""
        )
          .split("/")
          .pop();
        return mn === modelName;
      });
      if (!matched) processModelFile(f, 0);
    }

    // 无 ysm.json → WASM 无法确定纹理映射，交 Go 处理（有启发式匹配）
    if (!geometry && !ysmMeta) {
      console.log("[YSM] 无 ysm.json 引导，移交 Go 确保纹理正确映射");
      cacheSet(modelPath, { _wasmFailed: true });
      return null;
    }

    if (!geometry && files?.length > 0) {
      console.log(`[YSM] ⚠️ WASM 解码成功但几何体解析为空，回退 Go CLI`);
      cacheSet(modelPath, { _wasmFailed: true });
      return null;
    }

    // TS 不追踪 processModelFile 闭包内的赋值，geometry 在 if 处被收窄为 never——
    // 用局部变量绕过（运行时语义不变）
    const geo = geometry as BedrockGeometry | null;
    if (geo) {
      geo.bones = allBones;
      geo.textures = orderedTexKeys.map((k) => textures[k]).filter(Boolean);
      // 纹理名与 textures 同序（key 即去扩展名文件名），供纹理列表显示
      geo.textureNames = orderedTexKeys;
      geo.texture = orderedTexKeys.length > 0 ? textures[orderedTexKeys[0]] : null;
      if (maxTexW > geo.texWidth) geo.texWidth = maxTexW;
      if (maxTexH > geo.texHeight) geo.texHeight = maxTexH;
      geo._texMappingLog = texMappingLog;
    }

    // 解析动画
    const animations: unknown[] = [];
    for (const f of files) {
      if (!f.path.startsWith("animations/") || !f.path.endsWith(".json")) continue;
      devLog(`[YSM] 动画 ${f.path}...`);
      try {
        const jsonStr = new TextDecoder().decode(f.data);
        const { clips } = parseBedrockAnimationJSON(jsonStr);
        if (clips.length > 0) animations.push(...clips);
      } catch (e) {
        devLog(`[YSM] ❌ ${f.path}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    const texUrl =
      (geometry as BedrockGeometry | null)?.texture ||
      (orderedTexKeys.length > 0 ? textures[orderedTexKeys[0]] : null) ||
      null;
    const result: DecodedYsm = {
      texture: texUrl,
      geometry,
      geometryRaw: firstGeometryRaw ?? undefined,
      animations,
      avatars,
      authors: ysmAuthors,
      animGroups: ysmAnimGroups,
      configMenus: ysmConfigMenus,
    };
    cacheSet(modelPath, { ...result, _decodedBy: "🧠 WASM 内置解码" });
    // 异步缓存头像到 creators_cache/ 供创作者界面使用（JSON 路径已有，此处对齐）
    getApp()
      .then(({ CacheModelAvatars }) => CacheModelAvatars(modelPath))
      .catch(() => {});
    return result;
  } catch (e) {
    devLog(`[YSM] ❌ ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

