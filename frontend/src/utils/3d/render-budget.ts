export const PREVIEW_MAX_PIXEL_RATIO = 1.5;
export const PREVIEW_FRAME_INTERVAL_MS = 1000 / 60;

export function previewPixelRatio(devicePixelRatio: number): number {
  if (!Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0) return 1;
  return Math.min(devicePixelRatio, PREVIEW_MAX_PIXEL_RATIO);
}

export function shouldRenderPreviewFrame(
  now: number,
  nextFrame: number,
  hidden: boolean,
): boolean {
  if (hidden) return false;
  return now >= nextFrame - 0.5;
}
