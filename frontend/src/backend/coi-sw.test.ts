// ===== COI Service Worker 注册测试（ADR-079 M1）=====
// 仅网页版注册；首次注册 reload 一次（localStorage 标记防循环）；已控制/已隔离不 reload。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isCrossOriginIsolated, registerCoiServiceWorker } from "./coi-sw.ts";
import { resolveWebMode } from "./platform.ts";

const { resolveWebModeMock } = vi.hoisted(() => ({
  resolveWebModeMock: vi.fn(() => true),
}));
vi.mock("./platform.ts", () => ({
  resolveWebMode: resolveWebModeMock,
  readDeclaredBackend: () => undefined,
}));

// safeGet/safeSet 走 storage.ts——mock 掉避免污染
vi.mock("../utils/dom/storage.ts", () => ({
  safeGet: vi.fn(() => null),
  safeSet: vi.fn(),
}));

const registerMock = vi.fn();
const reloadMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  resolveWebModeMock.mockReturnValue(true);
  registerMock.mockResolvedValue({});
  (globalThis as Record<string, unknown>)["crossOriginIsolated"] = false;
  (globalThis as Record<string, unknown>)["navigator"] = {
    serviceWorker: {
      register: registerMock,
      controller: null,
    },
  };
  (globalThis as Record<string, unknown>)["location"] = { reload: reloadMock };
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as Record<string, unknown>)["crossOriginIsolated"];
});

describe("COI Service Worker（ADR-079 M1）", () => {
  it("仅网页版注册（resolveWebMode=true → register 调用；false → 不调）", () => {
    registerCoiServiceWorker();
    expect(registerMock).toHaveBeenCalledWith(expect.stringMatching(/sw\.js$/), { scope: expect.any(String) });
    resolveWebModeMock.mockReturnValue(false);
    registerCoiServiceWorker();
    expect(registerMock).toHaveBeenCalledTimes(1);
  });

  it("首次注册（无 controller + 未隔离）→ reload 一次", async () => {
    registerCoiServiceWorker();
    await Promise.resolve(); // 等 register().then
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it("SW 已控制当前页 → 不 reload", async () => {
    (globalThis as Record<string, unknown>)["navigator"] = {
      serviceWorker: { register: registerMock, controller: {} },
    };
    registerCoiServiceWorker();
    await Promise.resolve();
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it("已跨源隔离（crossOriginIsolated=true）→ 不 reload", async () => {
    (globalThis as Record<string, unknown>)["crossOriginIsolated"] = true;
    registerCoiServiceWorker();
    await Promise.resolve();
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it("无 serviceWorker 支持 → 静默 no-op（渐进增强）", () => {
    (globalThis as Record<string, unknown>)["navigator"] = {};
    expect(() => registerCoiServiceWorker()).not.toThrow();
    expect(registerMock).not.toHaveBeenCalled();
  });

  it("isCrossOriginIsolated：布尔属性判定", () => {
    expect(isCrossOriginIsolated()).toBe(false);
    (globalThis as Record<string, unknown>)["crossOriginIsolated"] = true;
    expect(isCrossOriginIsolated()).toBe(true);
  });
});
