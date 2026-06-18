import { cacheGet, cacheSet } from "../../utils/preview-cache.js";

/**
 * Load model geometry and textures from cache, frontend WASM, or Go fallback.
 *
 * @param {string} modelPath
 * @param {{ decodeYsmViaWasm(path:string): Promise<object|null>, appendDebug(msg:string): void }} ctx
 * @returns {Promise<{model: object|null, decodedBy: string}>}
 */
export async function loadModelData(modelPath, ctx) {
  let model;
  let decodedBy = "";
  const isYsmLike = /\.(ysm|json)$/i.test(modelPath);

  const cached = cacheGet(modelPath);
  if (cached?.geometry?.bones?.length) {
    model = cached.geometry;
    decodedBy = cached._decodedBy || "";
  }

  if (!model && isYsmLike) {
    const decoded = await ctx.decodeYsmViaWasm(modelPath);
    if (decoded?.geometry?.bones?.length) {
      model = decoded.geometry;
      decodedBy = decoded._decodedBy || "WASM 内置解码";
      const cur = cacheGet(modelPath);
      if (cur) cacheSet(modelPath, { ...cur, _decodedBy: decodedBy });
    } else {
      ctx.appendDebug("[YSM] WASM 未返回骨骼数据，回退 Go 解析");
    }
  }

  if (!model?.bones?.length) {
    const { AnalyzeBedrockModel } =
      await import("../../../wailsjs/go/main/App.js");
    model = await AnalyzeBedrockModel(modelPath);
    if (model?.bones?.length) {
      const goClips = await parseGoAnimations(model);
      const goTexCount = model.textures?.length || 0;
      model._texMappingLog = buildGoTextureLog(modelPath, model, goTexCount);
      decodedBy = isYsmLike ? "CLI 外置解码" : "Go 原生解析";
      cacheSet(modelPath, {
        texture: model.texture,
        geometry: model,
        animations: goClips.length > 0 ? goClips : undefined,
        _decodedBy: decodedBy,
      });
    }
  }

  return { model: model || null, decodedBy };
}

async function parseGoAnimations(model) {
  const clipsOut = [];
  if (!model.animations?.length) return clipsOut;

  const { parseBedrockAnimationJSON } = await import("../../utils/animation.js");
  for (const jsonStr of model.animations) {
    const { clips } = parseBedrockAnimationJSON(jsonStr);
    if (clips.length > 0) clipsOut.push(...clips);
  }
  return clipsOut;
}

function buildGoTextureLog(modelPath, model, goTexCount) {
  const size = model.texWidth ? `${model.texWidth}x${model.texHeight}` : "-";
  const rows = [
    {
      file: modelPath.split("/").pop().split("\\").pop(),
      texKey: goTexCount > 0 ? "texture[0]" : "-",
      texIdx: 0,
      pngSize: "-",
      geoSize: size,
      uvSize: "-",
      finalSize: size,
    },
  ];
  if (goTexCount > 1) {
    rows.push({
      file: "(更多贴图)",
      texKey: `+${goTexCount - 1}`,
      texIdx: 0,
      pngSize: "-",
      geoSize: "-",
      uvSize: "-",
      finalSize: "-",
    });
  }
  return rows;
}
