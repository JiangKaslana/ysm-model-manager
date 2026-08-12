// ===== Android 桥 / 查看器模式判定测试（ADR-046/049）=====
import { describe, it, expect, beforeEach } from "vitest";
import { getAndroidBridge, isViewerMode } from "./android-bridge.ts";

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
