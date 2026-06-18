// ===== WASM decode layer =====
// Frontend WASM decode logic for .ysm files.
import { devLog, stripYsgpTextHeader } from "./preview-utils.js";
import { cacheGet, cacheSet } from "../../utils/preview-cache.js";
import {
  parseBedrockGeometryVariantsFromJSON,
  selectPrimaryVariant,
} from "./utils.js";
import { parseBedrockAnimationJSON } from "../../utils/animation.js";
import {
  buildOpenYsmPreviewBundle,
  buildOpenYsmPreviewBundleFromJsonPath,
} from "./openysm-bundle.js";

/**
 * Decode .ysm through frontend WASM and return { texture, geometry, animations }.
 * This function is independent from the component instance.
 */
export async function decodeYsmViaWasm(modelPath) {
  const cached = cacheGet(modelPath);
  if (cached?.geometry) return cached;

  try {
    devLog("[YSM] 加载 WASM 模块...");
    const { initYSMParser, decodeYsmFileFromMemory, decodeYsmFile } =
      await import("../../wasm/ysm-parser.js");
    const ok = await initYSMParser();
    console.log(`[YSM] WASM init: ${ok ? "ok" : "failed"}`);
    if (!ok) return null;

    devLog("[YSM] 读取文件...");
    const { ListOpenYsmFunctionFiles, ReadFileBytes } = await import(
      "../../../wailsjs/go/main/App.js"
    );
    let bytes = await ReadFileBytes(modelPath);
    if (typeof bytes === "string") {
      const raw = atob(bytes);
      const len = raw.length;
      const arr = new Uint8Array(len);
      for (let i = 0; i < len; i++) arr[i] = raw.charCodeAt(i);
      bytes = arr;
    } else if (!(bytes instanceof Uint8Array)) {
      bytes = new Uint8Array(bytes);
    }
    devLog(`[YSM] 已读取 ${bytes?.length || 0} bytes`);
    if (!bytes?.length) return null;

    if (/\.json$/i.test(modelPath)) {
      const text = new TextDecoder("utf-8").decode(bytes);
      try {
        const json = JSON.parse(text);
        const openYsmBundle = await buildOpenYsmPreviewBundleFromJsonPath(
          modelPath,
          json,
          ReadFileBytes,
          { devLog, listFunctionFiles: ListOpenYsmFunctionFiles },
        );
        if (openYsmBundle?.geometry?.bones?.length) {
          cacheSet(modelPath, {
            texture: openYsmBundle.texture,
            geometry: openYsmBundle.geometry,
            animations: openYsmBundle.animations,
            openYsm: openYsmBundle.openYsm,
            _decodedBy: "OpenYSM 文件夹解析",
          });
          return { ...openYsmBundle, _decodedBy: "OpenYSM 文件夹解析" };
        }
        const result = parseYsmJsonDirect(json);
        if (result) {
          cacheSet(modelPath, { ...result, _decodedBy: "JSON 直接解析" });
          return result;
        }
      } catch (_) {}
      return null;
    }

    let files = await decodeFromMemory(bytes, decodeYsmFileFromMemory);

    if (!files?.length) {
      console.log("[YSM] 原始字节解码失败，尝试 MEMFS 路径解码...");
      try {
        files = await decodeYsmFile(bytes);
        if (files?.length) {
          console.log(`[YSM] MEMFS 解码成功: ${files.length} 个文件`);
        }
      } catch (e2) {
        console.log(`[YSM] MEMFS 解码异常: ${e2?.message}`);
      }
    }

    if (!files?.length) {
      files = await decodeAfterStrippingHeader(bytes, decodeYsmFileFromMemory);
    }

    if (!files?.length) {
      console.log("[YSM] WASM 解码失败，没有输出文件");
      return null;
    }

    console.log(`[YSM] 输出 ${files.length} 个文件`);
    console.log(`[YSM] 文件: ${files.map((f) => f.path).join(", ")}`);

    const openYsmBundle = buildOpenYsmPreviewBundle(files, { devLog });
    if (openYsmBundle?.geometry?.bones?.length) {
      cacheSet(modelPath, {
        texture: openYsmBundle.texture,
        geometry: openYsmBundle.geometry,
        animations: openYsmBundle.animations,
        openYsm: openYsmBundle.openYsm,
        _decodedBy: "OpenYSM 内嵌解析",
      });
      return { ...openYsmBundle, _decodedBy: "OpenYSM 内嵌解析" };
    }

    const ysmInfo = readYsmMeta(files);
    const textureInfo = collectTextures(files, ysmInfo);
    const parsed = parseModelFiles(files, ysmInfo, textureInfo);

    if (!parsed.geometry && files.length > 0) {
      console.log("[YSM] WASM 解码成功但几何体解析为空，回退 Go CLI");
      return null;
    }

    const animations = parseAnimations(files);
    const texUrl =
      parsed.geometry?.texture ||
      textureInfo.textures[textureInfo.orderedTexKeys[0]] ||
      null;

    cacheSet(modelPath, {
      texture: texUrl,
      geometry: parsed.geometry,
      animations,
    });
    return { texture: texUrl, geometry: parsed.geometry, animations };
  } catch (e) {
    devLog(`[YSM] 解析失败：${e?.message || e}`);
    return null;
  }
}

async function decodeFromMemory(bytes, decodeYsmFileFromMemory) {
  try {
    const files = await decodeYsmFileFromMemory(bytes);
    if (files?.length) {
      console.log(`[YSM] 原始字节解码成功: ${files.length} 个文件`);
    }
    return files;
  } catch (_) {
    return null;
  }
}

async function decodeAfterStrippingHeader(bytes, decodeYsmFileFromMemory) {
  for (const tryVer of [null, 3]) {
    const rebuilt = stripYsgpTextHeader(bytes, tryVer);
    if (rebuilt === bytes || !rebuilt) continue;
    const verLabel = tryVer ? `V${tryVer}` : "V2(auto)";
    console.log(`[YSM] 尝试剥离文本头部后解码 ${verLabel}...`);
    try {
      const files = await decodeYsmFileFromMemory(rebuilt);
      if (files?.length) {
        console.log(`[YSM] 剥离头部(${verLabel})后解码成功: ${files.length} 个文件`);
        return files;
      }
    } catch (e3) {
      console.log(`[YSM] 剥离${verLabel}解码异常: ${e3?.message}`);
    }
  }
  return null;
}

function readYsmMeta(files) {
  const info = {
    texOrder: null,
    modelOrder: null,
    defaultTex: null,
    hasExplicitModelOrder: false,
  };
  const ysmMeta = files.find((f) => f.path.endsWith("ysm.json"));
  if (!ysmMeta) return info;

  try {
    const txt = new TextDecoder().decode(ysmMeta.data);
    const json = JSON.parse(txt);
    info.texOrder = normalizePreviewTextureRefs(json?.files?.player?.texture || null);
    const modelField = json?.files?.player?.model;
    info.modelOrder = parsePlayerMainModelRefs(modelField);
    info.hasExplicitModelOrder = !!modelField;
    info.defaultTex = json?.properties?.default_texture || null;
    if (info.texOrder?.length) {
      console.log(
        "[YSM] ysm.json texture order:",
        info.texOrder
          .map((t) => (typeof t === "string" ? t : t?.uv || t?.path))
          .filter(Boolean),
        `default texture: ${info.defaultTex || "none"}`,
      );
    }
  } catch (_) {}
  return info;
}

function parsePlayerMainModelRefs(modelField) {
  if (!modelField) return null;
  const add = (out, value) => {
    const text = String(value || "").trim();
    if (text) out.push(text);
    return out;
  };
  if (typeof modelField === "string") return add([], modelField);
  if (Array.isArray(modelField)) {
    return modelField.reduce((out, value) => add(out, value), []);
  }
  if (typeof modelField === "object") {
    const out = [];
    add(out, modelField.main);
    return out;
  }
  return null;
}

function normalizePreviewTextureRefs(textureField) {
  const out = [];
  const push = (item, key = "") => {
    if (!item) return;
    if (typeof item === "string") {
      out.push({ key: key || baseName(item).replace(/\.\w+$/, ""), uv: item, path: item });
      return;
    }
    if (Array.isArray(item)) {
      item.forEach((child, index) => push(child, key ? `${key}_${index + 1}` : ""));
      return;
    }
    if (typeof item !== "object") return;
    if (item.uv || item.path) {
      out.push({
        key: key || item.name || item.label || baseName(item.uv || item.path).replace(/\.\w+$/, ""),
        uv: item.uv || item.path,
        path: item.uv || item.path,
      });
      return;
    }
    for (const [childKey, childValue] of Object.entries(item)) {
      push(childValue, childKey);
    }
  };
  push(textureField);
  const seen = new Set();
  return out.filter((item) => {
    const path = String(item?.uv || item?.path || "").trim();
    const key = path.replace(/\\/g, "/").toLowerCase();
    if (!path || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizePreviewPath(path) {
  return String(path || "").replace(/\\/g, "/").replace(/^\.?\//, "").toLowerCase();
}

function isReferencedTexturePath(path, refs = []) {
  const target = normalizePreviewPath(path);
  const targetBase = baseName(target).replace(/\.\w+$/, "").toLowerCase();
  return refs.some((ref) => {
    const refPath = normalizePreviewPath(ref?.uv || ref?.path || ref);
    const refBase = baseName(refPath).replace(/\.\w+$/, "").toLowerCase();
    return (
      target === refPath ||
      target.endsWith(`/${refPath}`) ||
      targetBase === refBase
    );
  });
}

function isNonPlayerPreviewImage(path) {
  const low = normalizePreviewPath(path);
  return /(^|\/)(avatar|background|gui|icon|icons|preview|previews|vehicle|vehicles|projectile|projectiles|item|items|arm|arms)\//i.test(low);
}

function collectTextures(files, ysmInfo) {
  const textures = {};
  const texLowerMap = {};
  const texDimensions = {};
  let maxTexW = 0;
  let maxTexH = 0;
  const explicitTexOrder = !!ysmInfo.texOrder?.length;

  for (const f of files) {
    if (!/\.(png|jpe?g)$/i.test(f.path)) continue;
    if (f.path.startsWith("avatar/") || f.path.startsWith("avatar\\")) {
      console.log(`[YSM] 跳过头像: ${f.path}`);
      continue;
    }

    if (explicitTexOrder && !isReferencedTexturePath(f.path, ysmInfo.texOrder)) {
      continue;
    }
    if (!explicitTexOrder && isNonPlayerPreviewImage(f.path)) {
      continue;
    }

    const blob = new Blob([f.data]);
    const key = baseName(f.path).replace(/\.\w+$/, "");
    textures[key] = URL.createObjectURL(blob);
    texLowerMap[key.toLowerCase()] = key;

    const dim = readImageDimensions(f.data);
    if (dim.w > 0 && dim.h > 0) {
      texDimensions[key] = dim;
      maxTexW = Math.max(maxTexW, dim.w);
      maxTexH = Math.max(maxTexH, dim.h);
    }
    devLog(
      `[YSM] 贴图: ${f.path} -> key="${key}"${
        texDimensions[key] ? ` (${texDimensions[key].w}x${texDimensions[key].h})` : ""
      }`,
    );
  }

  const matchTexKey = (name) => {
    if (!name) return null;
    if (textures[name]) return name;
    return texLowerMap[name.toLowerCase()] || null;
  };

  let orderedTexKeys = Object.keys(textures);
  if (explicitTexOrder) {
    let ordered = [];
    for (const t of ysmInfo.texOrder) {
      const path = typeof t === "string" ? t : t?.uv || t?.path || "";
      const matched = matchTexKey(baseName(path).replace(/\.\w+$/, ""));
      if (matched) ordered.push(matched);
    }
    if (ysmInfo.defaultTex) {
      const defKey = matchTexKey(baseName(ysmInfo.defaultTex).replace(/\.\w+$/, ""));
      if (defKey && ordered.includes(defKey) && ordered[0] !== defKey) {
        ordered = [defKey, ...ordered.filter((k) => k !== defKey)];
      }
    }
    orderedTexKeys = ordered;
  }

  return {
    textures,
    texDimensions,
    orderedTexKeys,
    maxTexW,
    maxTexH,
  };
}

function parseModelFiles(files, ysmInfo, textureInfo) {
  const modelVariants = [];
  const processedModels = new Set();
  const texMappingLog = [];

  const processModelFile = (file, forcedTexIdx) => {
    if (!file || processedModels.has(file.path)) return;
    processedModels.add(file.path);
    devLog(`[YSM] 解析 ${file.path}...`);

    try {
      const jsonStr = new TextDecoder().decode(file.data);
      const parsedRoot = JSON.parse(jsonStr);
      logGeometryDebug(parsedRoot, jsonStr);

      const parsedVariants = parseBedrockGeometryVariantsFromJSON(jsonStr, file.path);
      const parsed = selectPrimaryVariant(parsedVariants);
      if (!parsed?.bones?.length) return;
      devLog(`[YSM] OK ${file.path}: ${parsed.bones.length} bones ${parsed.cubeCount} cubes`);

      const texIdx = forcedTexIdx ?? 0;
      const texKey =
        textureInfo.orderedTexKeys.length > texIdx
          ? textureInfo.orderedTexKeys[texIdx]
          : textureInfo.orderedTexKeys[0] || null;
      const texUrl = texKey ? textureInfo.textures[texKey] : null;
      const uvSize = detectUVBounds(parsed);
      const texDim = texKey ? textureInfo.texDimensions[texKey] : null;
      const actualTexW = texDim ? texDim.w : 0;
      const actualTexH = texDim ? texDim.h : 0;
      const boneTexW = Math.max(actualTexW, parsed.texWidth, uvSize.w) || 64;
      const boneTexH = Math.max(actualTexH, parsed.texHeight, uvSize.h) || 64;

      texMappingLog.push({
        file: baseName(file.path),
        texKey: texKey || "-",
        texIdx,
        pngSize: actualTexW > 0 ? `${actualTexW}x${actualTexH}` : "-",
        geoSize:
          parsed.texWidth > 0 ? `${parsed.texWidth}x${parsed.texHeight}` : "-",
        uvSize: `${uvSize.w}x${uvSize.h}`,
        finalSize: `${boneTexW}x${boneTexH}`,
      });

      for (const variant of parsedVariants) {
        variant.texIdx = texIdx;
        variant.texIndex = texIdx;
        if (!variant.texWidth || boneTexW > variant.texWidth) variant.texWidth = boneTexW;
        if (!variant.texHeight || boneTexH > variant.texHeight) variant.texHeight = boneTexH;
        for (const b of variant.bones || []) {
          b._texIdx = texIdx;
          b._texUrl = texUrl;
          b._texWidth = boneTexW;
          b._texHeight = boneTexH;
        }
        modelVariants.push(variant);
      }
    } catch (e) {
      devLog(`[YSM] ${file.path}: ${e?.message}`);
    }
  };

  if (ysmInfo.modelOrder) {
    const texKeyToIdx = {};
    textureInfo.orderedTexKeys.forEach((k, i) => {
      texKeyToIdx[k] = i;
    });
    for (const mp of ysmInfo.modelOrder) {
      const mn = baseName(typeof mp === "string" ? mp : mp?.path || mp?.name || "");
      if (!mn) continue;
      const lowerBase = mn.replace(/\.json$/i, "").toLowerCase();
      let matchedKey = null;
      for (const k of Object.keys(texKeyToIdx)) {
        if (k.toLowerCase().includes(lowerBase) || lowerBase.includes(k.toLowerCase())) {
          matchedKey = k;
          break;
        }
      }
      const texIdx = matchedKey != null ? (texKeyToIdx[matchedKey] ?? 0) : 0;
      const file = files.find((ff) => pathEndsWith(ff.path, mn));
      if (file) processModelFile(file, texIdx);
    }
  }

  if (!ysmInfo.modelOrder?.length) {
    for (const file of files) {
      if (!file.path.startsWith("models/")) continue;
      processModelFile(file, 0);
    }
  }

  const geometry = selectPrimaryVariant(modelVariants, ysmInfo.modelOrder || []);
  if (geometry) {
    geometry.textures = textureInfo.orderedTexKeys
      .map((k) => textureInfo.textures[k])
      .filter(Boolean);
    geometry.texture = textureInfo.textures[textureInfo.orderedTexKeys[0]] || null;
    if (textureInfo.maxTexW > geometry.texWidth) geometry.texWidth = textureInfo.maxTexW;
    if (textureInfo.maxTexH > geometry.texHeight) geometry.texHeight = textureInfo.maxTexH;
    geometry._texMappingLog = texMappingLog;
  }
  return { geometry };
}

function parseAnimations(files) {
  const animations = [];
  for (const f of files) {
    const low = f.path.replace(/\\/g, "/").toLowerCase();
    if (!low.endsWith(".json") || !low.includes("animation")) continue;
    devLog(`[YSM] 动画 ${f.path}...`);
    try {
      const jsonStr = new TextDecoder().decode(f.data);
      const { clips } = parseBedrockAnimationJSON(jsonStr);
      if (clips.length > 0) animations.push(...clips);
    } catch (e) {
      devLog(`[YSM] ${f.path}: ${e?.message}`);
    }
  }
  return animations;
}

function logGeometryDebug(parsedRoot, jsonStr) {
  const rootKeys = Object.keys(parsedRoot);
  const geoKey = rootKeys.find(
    (k) => k.includes("minecraft:geometry") || k.includes("geometry"),
  );
  if (!geoKey) return;

  const geoArr = parsedRoot[geoKey];
  if (!Array.isArray(geoArr) || geoArr.length === 0) return;

  const hasBones = !!geoArr[0]?.bones?.length;
  console.log(
    `[YSM] JSON 调试: rootKeys=[${rootKeys}], geometryKey="${geoKey}", bones=${geoArr[0]?.bones?.length || 0}`,
  );
  if (!hasBones) {
    console.log(`[YSM] JSON 前 200 字符: ${jsonStr.slice(0, 200)}`);
  }
}

function detectUVBounds(parsed) {
  let w = 2;
  let h = 2;
  for (const b of parsed.bones) {
    for (const c of b.cubes || []) {
      const [sx, sy, sz] = c.size;
      if (Array.isArray(c.uv) && c.uv.length >= 2) {
        const [u, v] = c.uv;
        w = Math.max(w, u + 2 * (Math.abs(sx) + Math.abs(sz)));
        h = Math.max(h, v + Math.abs(sy) + Math.abs(sz));
      } else if (c.faceUV) {
        try {
          const faces = JSON.parse(c.faceUV);
          for (const name of ["east", "west", "up", "down", "south", "north"]) {
            const face = faces[name];
            if (!face?.uv) continue;
            const fw = Math.abs(face.uv_size?.[0] || 0);
            const fh = Math.abs(face.uv_size?.[1] || 0);
            w = Math.max(w, face.uv[0] + fw);
            h = Math.max(h, face.uv[1] + fh);
          }
        } catch (_) {}
      }
    }
  }
  return { w, h };
}

function readImageDimensions(data) {
  const arr = new Uint8Array(data);
  if (arr[0] === 0x89 && arr[1] === 0x50 && arr[2] === 0x4e) {
    return {
      w: (arr[16] << 24) | (arr[17] << 16) | (arr[18] << 8) | arr[19],
      h: (arr[20] << 24) | (arr[21] << 16) | (arr[22] << 8) | arr[23],
    };
  }
  if (arr[0] === 0xff && arr[1] === 0xd8) {
    for (let i = 2; i < Math.min(arr.length - 8, 4096); i++) {
      if (arr[i] === 0xff && (arr[i + 1] & 0xf0) === 0xc0) {
        return {
          h: (arr[i + 5] << 8) | arr[i + 6],
          w: (arr[i + 7] << 8) | arr[i + 8],
        };
      }
    }
  }
  return { w: 0, h: 0 };
}

function baseName(path) {
  return String(path || "").split("/").pop().split("\\").pop();
}

function pathEndsWith(path, name) {
  return path.endsWith(`/${name}`) || path.endsWith(`\\${name}`) || path === name;
}

// Parse a loose JSON file directly. ysm.json metadata returns an empty geometry
// placeholder so the Go extracted-directory path can resolve referenced models.
function parseYsmJsonDirect(json) {
  if (json?.spec !== undefined && json?.files) {
    const playerFiles = json.files?.player;
    if (!playerFiles) return null;
    const modelFiles = Array.isArray(playerFiles.model)
      ? playerFiles.model
      : playerFiles.model
        ? [playerFiles.model]
        : [];
    const texFiles = normalizePreviewTextureRefs(playerFiles.texture);
    return {
      texture: null,
      geometry: {
        bones: [],
        texWidth: json.properties?.texture_width || 64,
        texHeight: json.properties?.texture_height || 64,
        textures: [],
        _ysmMeta: {
          modelFiles,
          texFiles,
          defaultTexture: json.properties?.default_texture || null,
        },
      },
      animations: [],
    };
  }

  const root = json?.minecraft?.geometry?.[0] || json?.geometry?.model || json;
  const desc = root?.description || {};
  const texW = desc.texture_width || 64;
  const texH = desc.texture_height || 64;
  const bones = (root?.bones || []).map((b) => ({
    name: b.name,
    pivot: b.pivot || [0, 0, 0],
    parent: b.parent || "",
    cubes: (b.cubes || []).map((c) => ({
      origin: c.origin || [0, 0, 0],
      size: c.size || [0, 0, 0],
      pivot: c.pivot || [0, 0, 0],
      uv: c.uv || [0, 0],
      inflate: c.inflate || 0,
      mirror: !!c.mirror,
    })),
  }));
  if (!bones.length) return null;
  return {
    texture: null,
    geometry: {
      bones,
      texWidth: texW,
      texHeight: texH,
      textures: [],
    },
    animations: [],
  };
}
