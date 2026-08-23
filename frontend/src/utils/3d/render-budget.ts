import { safeGet } from "../../utils/dom/storage.ts";

const PREVIEW_MAX_PIXEL_RATIO_DEFAULT = 1.5;
const MAX_PIXEL_RATIO_KEY = "ysm_3d_maxPixelRatio";

/** 读取用户设置的渲染分辨率上限（设置面板 slider 持久化）；缺省 1.5 */
export function getMaxPixelRatio(): number {
  const v = safeGet(MAX_PIXEL_RATIO_KEY);
  if (v === null) return PREVIEW_MAX_PIXEL_RATIO_DEFAULT;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : PREVIEW_MAX_PIXEL_RATIO_DEFAULT;
}

export const PREVIEW_FRAME_INTERVAL_MS = 1000 / 60;
const ADAPTIVE_SAMPLE_FRAMES = 30;
const SLOW_FRAME_MS = 22;
const MIN_PIXEL_RATIO = 0.75;

export interface AdaptiveRenderBudget {
  pixelRatio: number;
  sampleStart: number;
  sampleFrames: number;
}

export function previewPixelRatio(devicePixelRatio: number): number {
  if (!Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0) return 1;
  return Math.min(devicePixelRatio, getMaxPixelRatio());
}

export function createAdaptiveRenderBudget(
  pixelRatio: number,
  now: number,
): AdaptiveRenderBudget {
  return { pixelRatio, sampleStart: now, sampleFrames: 0 };
}

/** Returns a new pixel ratio only when sustained frame delivery is too slow. */
export function sampleAdaptivePixelRatio(
  budget: AdaptiveRenderBudget,
  now: number,
): number | null {
  budget.sampleFrames++;
  if (budget.sampleFrames < ADAPTIVE_SAMPLE_FRAMES) return null;
  const averageFrameMs = (now - budget.sampleStart) / budget.sampleFrames;
  budget.sampleStart = now;
  budget.sampleFrames = 0;
  if (averageFrameMs <= SLOW_FRAME_MS || budget.pixelRatio <= MIN_PIXEL_RATIO) return null;
  budget.pixelRatio = Math.max(MIN_PIXEL_RATIO, budget.pixelRatio - 0.25);
  return budget.pixelRatio;
}

export function shouldRenderPreviewFrame(
  now: number,
  nextFrame: number,
  hidden: boolean,
): boolean {
  if (hidden) return false;
  return now >= nextFrame - 0.5;
}
