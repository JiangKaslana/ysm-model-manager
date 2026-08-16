// ===== 感知层：LipSync 测试（lipsync.ts）=====
import { describe, expect, it } from "vitest";
import { createLipSyncController } from "./lipsync.ts";

describe("createLipSyncController", () => {
  it("静音（amplitude=0）→ weight=0", () => {
    const traces: number[] = [];
    const ctrl = createLipSyncController({ sensitivity: 0.15, intensity: 0.8 });
    ctrl.apply(0.016, 0, (w) => traces.push(w));
    expect(traces[0]).toBe(0);
    ctrl.dispose();
  });

  it("低振幅（< sensitivity）→ weight=0", () => {
    const traces: number[] = [];
    const ctrl = createLipSyncController({ sensitivity: 0.2, intensity: 0.8 });
    ctrl.apply(0.016, 0.1, (w) => traces.push(w));
    expect(traces[0]).toBe(0);
    ctrl.dispose();
  });

  it("高振幅（> sensitivity）→ 输出正权重", () => {
    const traces: number[] = [];
    const ctrl = createLipSyncController({ sensitivity: 0.2, intensity: 0.8 });
    ctrl.apply(0.016, 0.8, (w) => traces.push(w));
    expect(traces[0]).toBeGreaterThan(0);
    expect(traces[0]).toBeLessThanOrEqual(0.8);
    ctrl.dispose();
  });

  it("无 callback → 静默降级", () => {
    const ctrl = createLipSyncController();
    expect(() => ctrl.apply(0.016, 0.5, null as unknown as () => void)).not.toThrow();
    ctrl.dispose();
  });

  it("dispose 后不再触发", () => {
    const traces: number[] = [];
    const ctrl = createLipSyncController();
    ctrl.dispose();
    ctrl.apply(0.016, 0.8, (w) => traces.push(w));
    expect(traces).toHaveLength(0);
  });

  it("平滑：连续高振幅后降低 → weight 渐进回落", () => {
    const traces: number[] = [];
    const ctrl = createLipSyncController({ sensitivity: 0.1, intensity: 1.0, smoothing: 0.8 });
    // 高振幅
    ctrl.apply(0.016, 0.9, (w) => traces.push(w));
    const high = traces[traces.length - 1];
    // 静音
    ctrl.apply(0.016, 0, (w) => traces.push(w));
    const afterSilence = traces[traces.length - 1];
    // 应回落但未归零（平滑效应）
    expect(afterSilence).toBeLessThan(high);
    expect(afterSilence).toBeGreaterThan(0);
    ctrl.dispose();
  });

  it("amplitude > 1 被 clamp 到 1", () => {
    const traces: number[] = [];
    const ctrl = createLipSyncController({ sensitivity: 0.1, intensity: 0.5 });
    ctrl.apply(0.016, 2.0, (w) => traces.push(w));
    expect(traces[0]).toBeLessThanOrEqual(0.5);
    ctrl.dispose();
  });
});
