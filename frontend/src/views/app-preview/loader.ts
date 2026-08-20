// ===== 模型数据加载（唯一入口）=====
// 供给 skeleton.ts 和 screenshot-renderer.ts 使用
import { cacheGet, cacheSet } from "./cache.ts";
import { extOf } from "../../utils/resource/types.ts";
import { getApp } from "../../backend/app.ts";
import { parseBedrockAnimationJSON } from "../../utils/animation/animation.ts";
import type { YsmDecoder, PreviewDebugger } from "./utils.ts";
import type { BedrockGeometry } from "./geometry.ts";

/** loadModelData 选项（Bedrock 通用模型加载控制） */
export interface LoadModelOpts {
  /** 跳过 WASM 解码（用于非 YSM 格式的 Bedrock 模型，如车万女仆） */
  skipWasm?: boolean;
}

/**
 * 加载模型几何数据 + 纹理（优先路径，阻塞渲染）
 * 统一路径：缓存 → WASM 解码（仅 .ysm）→ Go AnalyzeBedrockModel 兜底
 * 作者/头像延迟到 fillAuthorsAsync（不阻塞首帧渲染）
 *
 * ADR: .zip/.7z/.json 等通用 Bedrock 格式直接走 Go 解析路径，
 * WASM 仅用于 .ysm 二进制格式（YSM 专属）。非 YSM Bedrock 模型
 * （如车万女仆 .zip）可传 skipWasm 直接跳过 WASM 尝试。
 */
export async function loadModelData(
  modelPath: string,
  ctx: YsmDecoder & PreviewDebugger,
  opts: LoadModelOpts = {},
): Promise<{ model: BedrockGeometry | null; decodedBy: string }> {
  let model: BedrockGeometry | null = null;
  let _decodedBy = "";
  const ext = extOf(modelPath);
  // WASM 仅对 .ysm 二进制格式有意义；.zip/.7z/.json 通用格式走 Go
  const isWasmCapable = !opts.skipWasm && ext === ".ysm";
  let _wasmAuthors: BedrockGeometry["_authors"] = [];
  let _wasmAvatars: Record<string, string> = {};

  // 查缓存
  const cached = cacheGet(modelPath);
  const cachedGeo = cached?.geometry as BedrockGeometry | undefined;
  if (cachedGeo?.bones?.length) {
    model = cachedGeo;
    _decodedBy = cached?._decodedBy || "";
  }

  // .ysm/.json → 前端 WASM 解码
  if (!model && isWasmCapable) {
    const decoded = await ctx.decodeYsmViaWasm(modelPath);
    _wasmAuthors = decoded?.authors || [];
    _wasmAvatars = decoded?.avatars || {};
    if (decoded?.geometry?.bones?.length) {
      model = decoded.geometry;
      model._authors = _wasmAuthors;
      model._avatars = _wasmAvatars;
      _decodedBy = "🧠 WASM 内置解码";
      cacheSet(modelPath, {
        ...(cacheGet(modelPath) || {}),
        geometry: model,
        _decodedBy,
      });
    } else {
      ctx.appendDebug(null, "[YSM] WASM 返回空或无骨骼，回退 Go");
    }
  }

  // 非 YSM/ZIP/JSON 或 WASM 失败/空骨骼 → 走 Go
  if (!model?.bones?.length) {
    const { AnalyzeBedrockModel } = await getApp();
    model = (await AnalyzeBedrockModel(modelPath)) as BedrockGeometry | null;

    if (model && !model._authors && _wasmAuthors.length) {
      model._authors = _wasmAuthors;
      model._avatars = _wasmAvatars;
    }

    if (model && model.bones && model.bones.length) {
      let goClips: unknown[] = [];
      if (model.animations?.length) {
        for (const jsonStr of model.animations as string[]) {
          const { clips } = parseBedrockAnimationJSON(jsonStr);
          if (clips.length > 0) goClips.push(...clips);
        }
      }
      const goTexCount = model.textures?.length || 0;
      model._texMappingLog = [
        {
          file: modelPath.split(/[/\\]/).pop() || "",
          texKey: goTexCount > 0 ? "texture[0]" : "—",
          texIdx: 0,
          pngSize: "—",
          geoSize: model.texWidth ? `${model.texWidth}×${model.texHeight}` : "—",
          uvSize: "—",
          finalSize: model.texWidth ? `${model.texWidth}×${model.texHeight}` : "—",
        },
      ];
      if (goTexCount > 1) {
        model._texMappingLog.push({
          file: "(+多纹理)",
          texKey: `+${goTexCount - 1}`,
          texIdx: 0,
          pngSize: "—",
          geoSize: "—",
          uvSize: "—",
          finalSize: "—",
        });
      }
      cacheSet(modelPath, {
        ...(cacheGet(modelPath) || {}),
        texture: model.texture as string | undefined,
        geometry: model,
        animations: goClips.length > 0 ? goClips : undefined,
        _decodedBy: "📦 Go 原生解析",
      });
      _decodedBy = "📦 Go 原生解析";
    }
  }

  // 统一补充：缓存中可能有 WASM 解析出的 authors 但未挂上 model
  if (model && !model._authors) {
    const cur = cacheGet(modelPath);
    if (cur?.authors?.length) {
      model._authors = cur.authors.filter(
        (a): a is NonNullable<BedrockGeometry["_authors"]>[number] =>
          typeof a === "object" && a !== null,
      ) as BedrockGeometry["_authors"];
      model._avatars = cur.avatars || {};
    }
  }

  if (model) model._modelPath = modelPath;

  return { model: model || null, decodedBy: _decodedBy };
}

/**
 * 异步补全作者/头像信息（不阻塞首帧渲染）
 * 在几何渲染完成后调用，后台补齐作者名 + 头像 URL
 */
export async function fillAuthorsAsync(
  modelPath: string,
  model: BedrockGeometry,
): Promise<void> {
  if (!model) return;
  // 确保 _authors 数组存在（loadModelData 可能未初始化）
  if (!model._authors) model._authors = [];

  // 作者名缺失 → 从 Go 摘要补齐
  if (model._authors.length === 0) {
    try {
      const { ExtractYsmSummary } = await getApp();
      const goSummary = await ExtractYsmSummary(modelPath);
      const goAuthors = goSummary?.authors ?? [];
      if (goAuthors.length > 0) {
        model._authors = goAuthors.map((a) => ({
          name: a.name || "",
          role: a.roles || "",
          avatarUrl: null,
          avatarPath: "",
        }));
      }
    } catch {
      /* 不影响几何渲染 */
    }
  }

  // 任一作者缺头像 → 经 Go 后端缓存回填
  if (model._authors.length > 0 && model._authors.some((a) => !a.avatarUrl)) {
    try {
      const { CacheModelAvatars, CachedCreatorAvatar } = await getApp();
      await CacheModelAvatars(modelPath);
      // 并行请求所有作者头像（原实现串行 N 次 Go 调用 → 现并行 1 次 Promise.all）
      const avatarTasks = model._authors
        .filter((au): au is typeof au & { name: string } => !au.avatarUrl && !!au.name)
        .map(async (au) => {
          const uri = await CachedCreatorAvatar(au.name);
          if (uri) au.avatarUrl = uri;
        });
      await Promise.all(avatarTasks);
    } catch {
      /* 不影响几何渲染 */
    }
  }
}
