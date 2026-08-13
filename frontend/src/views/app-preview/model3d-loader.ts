// ===== 3D 模型加载器（类型化版 — ADR-014 P2）=====
import * as THREE from "three";
import { getApp } from "../../backend/app.ts";
import { isViewerMode } from "../../utils/dom/android-bridge.ts";
import { resolveWebMode } from "../../backend/platform.ts";
import { decodeYsmViaWasm } from "./wasm.ts";
import { buildSpecFromGeometryJSON } from "../../utils/3d/spec-builder.ts";

/** 模型对象（轻量接口，覆盖 loadTextures/fetchSpec/preloadModel 用到的字段） */
export interface ModelLike {
  _modelPath?: string;
  bones?: unknown[];
  textures?: string[];
  texture?: string;
  /** R1 契约校验用：Go 端返回的纹理名数组 */
  textureNames?: string[];
}

/** Go 返回的 3D spec（models 数组） */
export interface ModelSpec {
  models?: unknown[];
  [key: string]: unknown;
}

const specCache = new Map<string, string>();
const SPEC_CACHE_MAX = 20;
function cacheSpec(path: string, data: string): void {
  // LRU：命中先删后插（刷新访问序，避免高频 spec 被冷数据挤出——R5）；
  // 满员时淘汰最久未用（Map 首项，插入序即访问序）
  if (specCache.has(path)) {
    specCache.delete(path);
  } else if (specCache.size >= SPEC_CACHE_MAX) {
    const firstKey = specCache.keys().next().value;
    if (firstKey !== undefined) specCache.delete(firstKey);
  }
  specCache.set(path, data);
}
function getCachedSpec(path: string): string | undefined {
  const data = specCache.get(path);
  if (data !== undefined) {
    // LRU 读取刷新：删除重插，保持「最近使用在前」
    specCache.delete(path);
    specCache.set(path, data);
  }
  return data;
}

/** 并行加载纹理 URL 列表，返回 THREE.Texture 数组 */
export async function loadTextures(urls?: string[]): Promise<(THREE.Texture | null)[]> {
  if (!urls?.length) return [];
  const texMap = new Map<string, THREE.Texture>();
  const loads = urls.filter(Boolean).map(
    (url) =>
      new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = (): void => {
          const tex = new THREE.Texture(img);
          tex.flipY = false;
          tex.minFilter = THREE.NearestFilter;
          tex.magFilter = THREE.NearestFilter;
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.needsUpdate = true;
          tex.userData.imgWidth = img.naturalWidth;
          tex.userData.imgHeight = img.naturalHeight;
          texMap.set(url, tex);
          resolve();
        };
        img.onerror = (): void => resolve();
        img.src = url;
      }),
  );
  await Promise.all(loads);
  // 失败项保留 null **占位**（不 filter 压缩索引）：多组件 spec 的 texIdx 是全局组件序
  // （0,1,2...），压缩会让后续组件索引漂移 → 贴错纹理（P1）。消费端用 `texArr[i] ?? texArr[0]`
  // 降级到 fallback 颜色，不影响其他组件索引。
  const texArr: (THREE.Texture | null)[] = urls.map((url) => texMap.get(url) ?? null);
  if (texArr.every((t) => t === null))
    console.warn("[3D] 纹理加载失败，模型将显示为 fallback 颜色");
  return texArr;
}

/** 获取模型 spec（Go 绑定为唯一事实来源，ADR-004；Android 等无 Node 环境降级前端 WASM 解码兜底） */
async function fetchSpec(model: ModelLike): Promise<ModelSpec> {
  if (!model._modelPath) return { models: [] };
  let jsonStr = getCachedSpec(model._modelPath);
  if (!jsonStr) {
    const { GetModel3DSpec } = await getApp();
    jsonStr = await GetModel3DSpec(model._modelPath);
    cacheSpec(model._modelPath, jsonStr);
  }
  const parsed = JSON.parse(jsonStr) as ModelSpec;
  if (!parsed.models?.length) {
    // 降级：仅无 Node 解码通道的平台（Android 双端桥 / 网页版 browser adapter，
    // GetModel3DSpec 恒空）走前端 WASM 解码兜底；桌面 Go 有 Node 通道，spec 空是
    // 异常而非常态——保持 ADR-004「Go 为唯一事实来源」快速报错语义，避免桌面端
    // 每个空 spec 模型都被拖进完整 WASM 解码（加载变慢）。
    if (isViewerMode()) {
      const spec = await fetchSpecViaWasmFallback(model);
      if (spec) return spec;
    }
    throw new Error("3D spec 为空");
  }
  return parsed;
}

/** 兜底：前端 WASM 解码 .ysm 拿 geometry JSON，构建 spec
 *  Android 路径调 Go binding Build3DSpecFromGeometryJSON；
 *  网页版路径（resolveWebMode）调纯 TS buildSpecFromGeometryJSON——
 *  Go binding 在网页版恒 "{}" 桩（ADR-049 P2-2 闭环）。 */
async function fetchSpecViaWasmFallback(model: ModelLike): Promise<ModelSpec | null> {
  try {
    const decoded = await decodeYsmViaWasm(model._modelPath!);
    if (!decoded?.geometryRaw) return null;
    let specStr: string;
    if (resolveWebMode()) {
      // 网页版：Go binding 不可用（恒 "{}" 桩），调纯 TS 移植
      specStr = buildSpecFromGeometryJSON(decoded.geometryRaw);
    } else {
      // Android：Go binding 可用
      const { Build3DSpecFromGeometryJSON } = await getApp();
      specStr = await Build3DSpecFromGeometryJSON(decoded.geometryRaw);
    }
    if (!specStr || specStr === "{}") return null;
    const spec = JSON.parse(specStr) as ModelSpec;
    if (!spec.models?.length) return null;
    // 兜底结果写 spec 缓存：否则每次预览都重新 WASM 解码（时间翻倍）
    cacheSpec(model._modelPath!, specStr);
    console.warn("[3D] GetModel3DSpec 无数据，已用前端 WASM 解码兜底构建 spec（Android 无 Node 通道）");
    return spec;
  } catch (e) {
    console.warn("[3D] 前端 WASM 解码兜底失败:", e);
    return null;
  }
}

/** 预加载：spec 先行，纹理按全量清单加载（texArr 槽位 = cube texSlot 下标） */
export async function preloadModel(model: ModelLike): Promise<{
  texArr: (THREE.Texture | null)[];
  spec: ModelSpec;
}> {
  const spec = await fetchSpec(model);
  // 实际纹理清单（URL + 名）；多组件走数组，单组件走单一 texture
  const actualUrls = model.textures && model.textures.length > 1
    ? model.textures.filter((u): u is string => Boolean(u))
    : (model.texture ? [model.texture] : []);
  // name 索引：优先显式 textureNames；缺失时从 URL 基名派生（R1 契约比对用）
  const actualNames = (model as { textureNames?: string[] }).textureNames
    ?? actualUrls.map((u) =>
      typeof u === "string"
        ? (u.split("/").pop()?.replace(/\.\w+$/, "").toLowerCase() ?? "")
        : "",
    );
  // texArr 必须以全量纹理清单 actualUrls 为槽位（cube texSlot 即其下标）——
  // 组件 texSlot = 声明序位置（未声明组件 = len(声明) + 按名段序号），与 Go 端
  // 纹理收集序（声明序 + 未声明按名）对齐。spec.texArrOrder 是「组件序期望纹理名」
  // （长度 = 组件数，R1 契约校验专用），不可当 texArr 槽位清单：魔法酒狐等模型用它
  // 会把 6 张声明纹理截断成 3 张（面板「纹理 (3)」），且 arrow texSlot=6 越界品红。
  const urls = actualUrls;
  const texArr = await loadTextures(urls);
  const order = (spec as ModelSpec).texArrOrder as string[] | undefined;
  // R1 契约校验：texArrOrder[i] = 组件 i 实际贴图名（Go 端按 texSlot 分配，多组件可**共享**
  // 同一张声明纹理，如 arm 与 main 共享 skin；未声明组件用 basename）。故改为**存在性**比对：
  // 每个期望名必须存在于 texArr 实际清单 actualNames——缺失（未加载/越界）才 warn 不阻断。
  // 不再逐一按索引比对（共享槽位下组件序 ≠ texArr 序，会误报）。WASM 路径 texArrOrder nil 跳过。
  if (order?.length && actualNames.length) {
    const present = new Set(actualNames.map((n) => String(n ?? "").trim().toLowerCase()));
    for (const expRaw of order) {
      const exp = String(expRaw ?? "").trim().toLowerCase();
      if (!exp) continue; // 空值跳过：未命名纹理（P2）
      if (!present.has(exp)) {
        console.warn(
          `[model3d] R1 纹理缺失: 组件期望贴图 ${expRaw} 不在已加载纹理清单 [${actualNames.join(", ")}]（可能越界/缺纹理）`,
        );
        break;
      }
    }
  }
  return { texArr, spec };
}
