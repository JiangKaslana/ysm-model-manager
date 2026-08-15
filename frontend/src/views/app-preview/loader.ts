// ===== 模型数据加载（唯一入口）=====
// 供给 skeleton.ts 和 screenshot-renderer.ts 使用
import { cacheGet, cacheSet } from "./cache.ts";
import { matchTypeByExt, RESOURCE_TYPES } from "../../utils/resource/types.ts";
import { getApp } from "../../backend/app.ts";
import { parseBedrockAnimationJSON } from "../../utils/animation/animation.ts";
import type { YsmDecoder, PreviewDebugger } from "./utils.ts";
import type { BedrockGeometry } from "./geometry.ts";

/**
 * 加载模型几何数据 + 纹理 + 作者信息
 * 统一路径：缓存 → WASM 解码 → Go AnalyzeBedrockModel 兜底
 */
export async function loadModelData(
  modelPath: string,
  ctx: YsmDecoder & PreviewDebugger,
): Promise<{ model: BedrockGeometry | null; decodedBy: string }> {
  let model: BedrockGeometry | null = null;
  let _decodedBy = "";
  // 按注册表判定 ysm 扩展名（.ysm/.zip/.7z/.json）是否前端 WASM 可解码（ADR-066 解墙，不再散硬正则）。
  // .zip/.7z 内含 ysm.json + models/ + textures/，WASM 解码器 decodeYsmFileFromMemory 直接处理（与 .ysm 同格式）；
  // 若 WASM 失败/空骨骼，下方回退 Go AnalyzeBedrockModel。
  const isWasmCapable = matchTypeByExt(modelPath, RESOURCE_TYPES.YSM);
  let _wasmAuthors: BedrockGeometry["_authors"] = [];
  let _wasmAvatars: Record<string, string> = {};

  // 查缓存
  const cached = cacheGet(modelPath);
  const cachedGeo = cached?.geometry as BedrockGeometry | undefined;
  if (cachedGeo?.bones?.length) {
    model = cachedGeo;
    _decodedBy = cached?._decodedBy || "";
  }

  // .ysm/.json → 前端 WASM 解码（含 parseYsmJsonDirect 提取作者元数据）
  if (!model && isWasmCapable) {
    const decoded = await ctx.decodeYsmViaWasm(modelPath);
    _wasmAuthors = decoded?.authors || [];
    _wasmAvatars = decoded?.avatars || {};
    if (decoded?.geometry?.bones?.length) {
      model = decoded.geometry;
      model._authors = _wasmAuthors;
      model._avatars = _wasmAvatars;
      _decodedBy = "🧠 WASM 内置解码";
      // P3 修复：WASM 解码结果直接写回缓存 geometry——原实现仅补 _decodedBy 标记，
      // geometry 依赖 wasm.ts/index.ts 的外部补写，缺路径时缓存丢失 WASM 更优结果
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
    const { AnalyzeBedrockModel } =
      await getApp();
    model = (await AnalyzeBedrockModel(modelPath)) as BedrockGeometry | null;

    // .json 解压目录：用 WASM 解析出的 authors 填补（Go 不返回此字段）
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
          geoSize: model.texWidth
            ? `${model.texWidth}×${model.texHeight}`
            : "—",
          uvSize: "—",
          finalSize: model.texWidth
            ? `${model.texWidth}×${model.texHeight}`
            : "—",
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
        // P2 修复（审核反推）：必须 spread 旧值保留 avatars/authors——Go 兜底成功时若
        // 只写 texture/geometry，cache.ts 同 key re-set 差异检测发现旧值 blob URL 不在新值，
        // 会把 WASM 解析出的头像 blob URL revoke 掉（详情页 <img> 裂图）。与 L45-49 的
        // WASM 分支口径一致。
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

  // 作者/头像兜底补全（覆盖 .zip 解压目录 + .ysm 裸文件名头像缺失）
  // - .zip 走 WASM 解码路径（isWasmCapable 包含 .zip），WASM 解析出的作者已挂上 model
  // - .ysm 经 WASM 解析出的头像常因 ysm.json 用裸文件名（如 "sdf"）声明而匹配失败 → 用 Go 后端兜底
  if (model) {
    if (!model._authors) model._authors = [];
    // .zip 等无 authors：从 Go 摘要补齐作者名（头像走下方缓存回填）
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
    // 任一作者缺头像 → 经 Go 后端缓存回填（ExtractAvatarURI 已放开裸文件名，
    // CacheModelAvatars 已覆盖 .ysm/.zip）
    if (model._authors.length > 0 && model._authors.some((a) => !a.avatarUrl)) {
      try {
        const { CacheModelAvatars, CachedCreatorAvatar } = await getApp();
        await CacheModelAvatars(modelPath);
        for (const au of model._authors) {
          if (!au.avatarUrl && au.name) {
            const uri = await CachedCreatorAvatar(au.name);
            if (uri) au.avatarUrl = uri;
          }
        }
      } catch {
        /* 不影响几何渲染 */
      }
    }
  }

  if (model) model._modelPath = modelPath;

  return { model: model || null, decodedBy: _decodedBy };
}
