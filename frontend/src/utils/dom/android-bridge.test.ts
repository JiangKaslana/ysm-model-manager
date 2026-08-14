// ===== Android 桥 / 查看器模式判定测试（ADR-046/049）=====
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getAndroidBridge,
  isViewerMode,
  registerAndroidBackHandler,
  emitAndroidBack,
} from "./android-bridge.ts";

beforeEach(() => {
  delete (window as unknown as { wails?: unknown }).wails;
  delete (globalThis as Record<string, unknown>)["__YSM_BACKEND__"];
});

describe("getAndroidBridge — window.wails 判定", () => {
  it("无 wails → null（桌面）", () => {
    expect(getAndroidBridge()).toBeNull();
  });

  it("wails 无 requestStoragePermission → null（非 Android 桥）", () => {
    (window as unknown as { wails?: unknown }).wails = { hasStoragePermission: () => true };
    expect(getAndroidBridge()).toBeNull();
  });

  it("wails 含 requestStoragePermission → 返回桥", () => {
    (window as unknown as { wails?: unknown }).wails = {
      hasStoragePermission: () => true,
      requestStoragePermission: () => {},
    };
    expect(getAndroidBridge()).not.toBeNull();
  });
});

describe("isViewerMode — 查看器模式（Android 或网页版）", () => {
  it("桌面（无桥 + 无 web 标记）→ false", () => {
    expect(isViewerMode()).toBe(false);
  });

  it("Android（window.wails 桥）→ true", () => {
    (window as unknown as { wails?: unknown }).wails = { requestStoragePermission: () => {} };
    expect(isViewerMode()).toBe(true);
  });

  it("网页版（__YSM_BACKEND__=browser，无桥）→ true", () => {
    (globalThis as Record<string, unknown>)["__YSM_BACKEND__"] = "browser";
    expect(isViewerMode()).toBe(true);
  });

  it("声明 go（误嵌 WebView）→ false（Tier 0 权威信号）", () => {
    (globalThis as Record<string, unknown>)["__YSM_BACKEND__"] = "go";
    (window as unknown as { wails?: unknown }).wails = { requestStoragePermission: () => {} };
    expect(isViewerMode()).toBe(false);
  });
});

// P3 补测（审核）：返回键处理器栈——栈顶优先消费、true 短路、unregister 注销（ADR-057 §2.5）
describe("registerAndroidBackHandler / emitAndroidBack — 返回键栈", () => {
  const unsubs: Array<() => void> = [];
  afterEach(() => {
    unsubs.forEach((u) => u());
    unsubs.length = 0;
  });

  it("空栈 → false（无消费，交给原生默认行为）", () => {
    expect(emitAndroidBack()).toBe(false);
  });

  it("栈顶优先：后注册先消费，true 即短路不触发下层", () => {
    const a = vi.fn(() => false);
    const b = vi.fn(() => true);
    unsubs.push(registerAndroidBackHandler(a), registerAndroidBackHandler(b));
    expect(emitAndroidBack()).toBe(true);
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();
  });

  it("无人消费 → 从栈顶依次触发全部，返回 false", () => {
    const a = vi.fn(() => false);
    const b = vi.fn(() => false);
    unsubs.push(registerAndroidBackHandler(a), registerAndroidBackHandler(b));
    expect(emitAndroidBack()).toBe(false);
    expect(b).toHaveBeenCalled();
    expect(a).toHaveBeenCalled();
  });

  it("unregister 后不再触发", () => {
    const fn = vi.fn(() => true);
    const unsub = registerAndroidBackHandler(fn);
    unsub();
    expect(emitAndroidBack()).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });
});
