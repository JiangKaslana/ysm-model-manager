// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { withCached, invalidateCache, clearAllCache, getCacheTtlMs, type CachePolicy } from "./with-cached.ts";

beforeEach(() => {
  // 清除缓存状态
  clearAllCache();
});

describe("withCached", () => {
  it("首次调用执行 fn 并缓存结果", async () => {
    const fn = vi.fn(async () => 42);
    const result = await withCached("test-key", 60000, fn);
    expect(result).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("同一 key 在 ttl 内命中缓存，不重新调用 fn", async () => {
    const fn = vi.fn(async () => 42);
    await withCached("test-key", 60000, fn);
    const result = await withCached("test-key", 60000, fn);
    expect(result).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("ttl 过期后重新调用 fn", async () => {
    const fn = vi.fn(async (x: number) => x * 2);
    await withCached("ttl-key", 10, fn, "NORMAL");
    // 等待过期
    await new Promise((r) => setTimeout(r, 20));
    await withCached("ttl-key", 10, () => fn(100), "NORMAL");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("STALE 策略：过期时返回旧值并后台刷新", async () => {
    let callCount = 0;
    const fn = vi.fn(async () => {
      callCount++;
      return callCount * 10;
    });
    await withCached("stale-key", 10, fn, "NORMAL");
    await new Promise((r) => setTimeout(r, 20));
    // STALE 调用：应返回旧值 10，fn 不应被同步阻塞
    const result = await withCached("stale-key", 10, fn, "STALE");
    expect(result).toBe(10);
    // fn 已在后台触发（异步），等待一下确认
    await new Promise((r) => setTimeout(r, 10));
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("FORCE 策略：忽略缓存强制重新计算", async () => {
    const fn = vi.fn(async () => 99);
    await withCached("force-key", 60000, fn);
    await withCached("force-key", 60000, fn, "FORCE");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("getCacheTtlMs 返回正确剩余时间", async () => {
    await withCached("ttl-measure", 5000, async () => "ok");
    const ttl = getCacheTtlMs("ttl-measure");
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(5000);
  });

  it("getCacheTtlMs 未命中返回 -1", () => {
    expect(getCacheTtlMs("nonexistent")).toBe(-1);
  });

  it("invalidateCache 清除指定 key", async () => {
    const fn = vi.fn(async () => 1);
    await withCached("inv-key", 60000, fn);
    invalidateCache("inv-key");
    await withCached("inv-key", 60000, fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
