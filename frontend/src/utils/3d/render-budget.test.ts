import { describe, expect, it } from "vitest";
import {
  PREVIEW_FRAME_INTERVAL_MS,
  previewPixelRatio,
  createAdaptiveRenderBudget,
  sampleAdaptivePixelRatio,
  shouldRenderPreviewFrame,
} from "./render-budget.ts";

describe("3D preview render budget", () => {
  it("caps high-DPI rendering at 1.5x", () => {
    expect(previewPixelRatio(1)).toBe(1);
    expect(previewPixelRatio(1.25)).toBe(1.25);
    expect(previewPixelRatio(2)).toBe(1.5);
    expect(previewPixelRatio(3)).toBe(1.5);
  });

  it("caps rendering near 60fps and pauses while hidden", () => {
    expect(shouldRenderPreviewFrame(8, PREVIEW_FRAME_INTERVAL_MS, false)).toBe(false);
    expect(shouldRenderPreviewFrame(17, PREVIEW_FRAME_INTERVAL_MS, false)).toBe(true);
    expect(shouldRenderPreviewFrame(17, PREVIEW_FRAME_INTERVAL_MS, true)).toBe(false);
  });

  it("reduces resolution when frame delivery misses 60fps", () => {
    const budget = createAdaptiveRenderBudget(1.5, 0);
    let changed: number | null = null;
    for (let frame = 1; frame <= 30; frame++) {
      changed = sampleAdaptivePixelRatio(budget, frame * 34);
    }
    expect(changed).toBe(1.25);
  });

  it("keeps resolution stable for healthy frame delivery", () => {
    const budget = createAdaptiveRenderBudget(1.5, 0);
    let changed: number | null = null;
    for (let frame = 1; frame <= 30; frame++) {
      changed = sampleAdaptivePixelRatio(budget, frame * 16.7);
    }
    expect(changed).toBeNull();
    expect(budget.pixelRatio).toBe(1.5);
  });
});
