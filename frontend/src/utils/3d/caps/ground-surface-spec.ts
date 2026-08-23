// ===== GroundSurfaceSpec：地面材质单一事实源（借鉴 MikuMikuAR ADR-226 精髓）=====
// 「地面材质应该长什么样」描述为纯数据 spec，由 buildGroundSurfaceSpec 唯一生成：
//   - structural：换纹理/换颜色的结构性字段 → 触发重建（specKey 自动序列化，杜绝手拼 key）
//   - appearance：数值性外观字段 → 原地更新（applyGroundSurfaceAppearance 单路径落地）
// 不变量（测试锁死，见 ground-surface-spec.test.ts Suite 3 合约）：
//   1. 外观参数只经 applyGroundSurfaceAppearance 落地，禁止在 capability 里散落 mutate；
//   2. 纹理密度 = meshSize / TILE_WORLD_SIZE / scale，只在 textureRepeat() 一处计算；
//   3. 新增结构字段 = 改接口 + build 里赋值，specKey 自动纳入（无手拼遗漏风险）。
// 本模块保持可独立单测：除 THREE 类型外无渲染依赖；像素生成走 Uint8Array（node 可测，
// 对齐 ground-capability.generateNormalMap 的 DataTexture 口径），不用 DOM canvas。

import type * as THREE from "three";

/* ============ 类型 ============ */

/** 地面表面模式（扁平枚举：来源 × 画布样式合一，避免双字段耦合守卫） */
export type GroundSurfaceMode = "none" | "solid" | "plain" | "grid" | "checker" | "texture";

export interface GroundMaterialParams {
  /** 表面模式 */
  matSource: GroundSurfaceMode;
  /** 底色 / 素面色（0xRRGGBB） */
  matColor: number;
  /** 网格线 / 棋盘副色（0xRRGGBB） */
  matLineColor: number;
  /** 整面网格/棋盘格数（每边） */
  matGridSize: number;
  /** 表面不透明度 0=全透 1=不透明 */
  matOpacity: number;
  /** 纹理缩放倍率（越大重复越多越细） */
  matScale: number;
  /** 纹理旋转角（度，UI 直读） */
  matRotationDeg: number;
  /** PBR 粗糙度 */
  matRoughness: number;
  /** PBR 金属度 */
  matMetalness: number;
}

export const DEFAULT_GROUND_SURFACE_PARAMS: GroundMaterialParams = {
  matSource: "none",
  matColor: 0x9a8b78,
  matLineColor: 0x1c2030,
  matGridSize: 8,
  matOpacity: 1,
  matScale: 1,
  matRotationDeg: 0,
  matRoughness: 0.85,
  matMetalness: 0,
};

export interface GroundSurfaceStructuralSpec {
  mode: GroundSurfaceMode;
  color: [number, number, number];
  lineColor: [number, number, number];
  gridSize: number;
  /** 自定义贴图身份标识（文件名:尺寸）；"" = 无。变化触发重建 */
  textureToken: string;
}

export interface GroundSurfaceAppearanceSpec {
  opacity: number;
  textureScale: number;
  rotationRad: number;
  roughness: number;
  metalness: number;
}

export interface GroundSurfaceSpec {
  structural: GroundSurfaceStructuralSpec;
  appearance: GroundSurfaceAppearanceSpec;
}

/* ============ spec 构建（唯一真相源）============ */

function hexToTriple(hex: number): [number, number, number] {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

export function buildGroundSurfaceSpec(p: GroundMaterialParams, textureToken: string): GroundSurfaceSpec {
  return {
    structural: {
      mode: p.matSource,
      color: hexToTriple(p.matColor),
      lineColor: hexToTriple(p.matLineColor),
      gridSize: p.matGridSize,
      textureToken,
    },
    appearance: {
      opacity: p.matOpacity,
      textureScale: p.matScale,
      rotationRad: (p.matRotationDeg * Math.PI) / 180,
      roughness: p.matRoughness,
      metalness: p.matMetalness,
    },
  };
}

/* ============ 自动 key（杀死手拼字符串哨兵）============ */

/** structural 子集确定性序列化：新增结构字段后在此补一行即自动纳入重建判别 */
export function surfaceSpecKey(s: GroundSurfaceSpec): string {
  const st = s.structural;
  return JSON.stringify([
    st.mode,
    st.color[0], st.color[1], st.color[2],
    st.lineColor[0], st.lineColor[1], st.lineColor[2],
    st.gridSize,
    st.textureToken,
  ]);
}

/** 结构性变化 → 需要重建材质与纹理；否则原地更新即可 */
export function groundSurfaceNeedsRebuild(prev: GroundSurfaceSpec, next: GroundSurfaceSpec): boolean {
  return surfaceSpecKey(prev) !== surfaceSpecKey(next);
}

/* ============ 纹理密度不变量（唯一计算点）============ */

/** 每格世界单位基准：50 单位地面默认铺 5×5 次重复 */
export const TILE_WORLD_SIZE = 10;

export function textureRepeat(meshSize: number, scale: number): number {
  return meshSize / TILE_WORLD_SIZE / scale;
}

/* ============ 程序化像素生成（RGBA，node 可测）============ */

export function generateSurfacePixels(st: GroundSurfaceStructuralSpec, sizePx: number): Uint8Array {
  const px = new Uint8Array(sizePx * sizePx * 4);
  const [r, g, b] = st.color;
  const [lr, lg, lb] = st.lineColor;

  if (st.mode === "solid" || st.mode === "none") {
    for (let i = 0; i < px.length; i += 4) {
      px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
    }
    return px;
  }

  const cell = sizePx / Math.max(1, st.gridSize);
  for (let y = 0; y < sizePx; y++) {
    const cy = Math.floor(y / cell);
    const fy = y - cy * cell;
    for (let x = 0; x < sizePx; x++) {
      const cx = Math.floor(x / cell);
      const fx = x - cx * cell;
      let pr: number, pg: number, pb: number;
      if (st.mode === "checker") {
        const even = (cx + cy) % 2 === 0;
        pr = even ? r : lr; pg = even ? g : lg; pb = even ? b : lb;
      } else {
        // grid：cell 首行/首列像素为线
        const line = fx < 1 || fy < 1;
        pr = line ? lr : r; pg = line ? lg : g; pb = line ? lb : b;
      }
      const i = (y * sizePx + x) * 4;
      px[i] = pr; px[i + 1] = pg; px[i + 2] = pb; px[i + 3] = 255;
    }
  }
  return px;
}

/* ============ 落地函数（两条路径共用，禁止绕过）============ */

/**
 * 重建路径专用：把 structural 落到新材质上。
 * @param tex 已就绪的纹理（solid/none 传 null，用 color 直出）
 */
export function applyGroundSurfaceStructural(
  mat: THREE.MeshStandardMaterial,
  st: GroundSurfaceStructuralSpec,
  tex: THREE.Texture | null,
): void {
  if (tex) {
    mat.map = tex;
    mat.color.setRGB(1, 1, 1); // 有贴图时颜色白乘，色值已烘进像素
  } else {
    mat.map = null;
    mat.color.setRGB(st.color[0] / 255, st.color[1] / 255, st.color[2] / 255);
  }
  mat.needsUpdate = true;
}

/**
 * 原地/重建通用：appearance 字段统一落地（唯一入口）。
 * @param meshSize 地面世界尺寸（UV 密度不变量依赖；见 textureRepeat）
 */
export function applyGroundSurfaceAppearance(
  mat: THREE.MeshStandardMaterial,
  spec: GroundSurfaceSpec,
  meshSize: number,
): void {
  const a = spec.appearance;
  mat.opacity = a.opacity;
  mat.transparent = a.opacity < 1;
  mat.depthWrite = a.opacity >= 1;
  mat.roughness = a.roughness;
  mat.metalness = a.metalness;
  if (mat.map) {
    mat.map.center.set(0.5, 0.5);
    mat.map.rotation = a.rotationRad;
    const rep = textureRepeat(meshSize, a.textureScale);
    mat.map.repeat.set(rep, rep);
  }
}
