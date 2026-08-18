// ===== TextureCache 险恶测试 =====
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TextureCacheImpl } from "./texture-cache.ts";

describe("TextureCache 险恶测试", () => {
  let cache: TextureCacheImpl;

  beforeEach(() => {
    cache = new TextureCacheImpl();
  });

  it("acquire 同 url 两次 → 返回同一实例", () => {
    const fakeTex = { dispose: vi.fn() } as never;
    const make = vi.fn(() => fakeTex);
    const t1 = cache.acquire("a.png", make);
    const t2 = cache.acquire("a.png", make);
    expect(t1).toBe(t2);
    expect(make).toHaveBeenCalledTimes(1);
  });

  it("acquire 不同 url → 返回不同实例", () => {
    const make = vi.fn((u: string) => ({ id: u, dispose: vi.fn() }) as never);
    const t1 = cache.acquire("a.png", make);
    const t2 = cache.acquire("b.png", make);
    expect(t1).not.toBe(t2);
    expect(make).toHaveBeenCalledTimes(2);
  });

  it("release 后 acquire 同 url → 返回缓存实例（归零保留）", () => {
    const fakeTex = { dispose: vi.fn() } as never;
    const make = vi.fn(() => fakeTex);
    cache.acquire("a.png", make);
    cache.release("a.png");
    const t2 = cache.acquire("a.png", make);
    expect(t2).toBe(fakeTex);
    expect(make).toHaveBeenCalledTimes(1);
  });

  it("release 未 acquire 的 url → 不抛", () => {
    expect(() => cache.release("ghost.png")).not.toThrow();
  });

  it("disposeAll 释放所有缓存纹理", () => {
    const t1 = { dispose: vi.fn() } as never;
    const t2 = { dispose: vi.fn() } as never;
    cache.acquire("a.png", () => t1);
    cache.acquire("b.png", () => t2);
    cache.disposeAll();
    expect(t1.dispose).toHaveBeenCalledTimes(1);
    expect(t2.dispose).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(0);
  });

  it("disposeAll 后 acquire → 重新创建", () => {
    const t1 = { dispose: vi.fn() } as never;
    const make = vi.fn(() => t1);
    cache.acquire("a.png", make);
    cache.disposeAll();
    const t2 = { dispose: vi.fn() } as never;
    cache.acquire("a.png", () => t2);
    expect(cache.size).toBe(1);
    expect(make).toHaveBeenCalledTimes(1);
  });

  it("多次 release 同 url → refs 不会变负", () => {
    const fakeTex = { dispose: vi.fn() } as never;
    cache.acquire("a.png", () => fakeTex);
    cache.release("a.png");
    cache.release("a.png");
    cache.release("a.png");
    const t2 = cache.acquire("a.png", vi.fn(() => ({ dispose: vi.fn() }) as never));
    expect(t2).toBe(fakeTex);
  });

  it("size 正确反映缓存数量", () => {
    expect(cache.size).toBe(0);
    cache.acquire("a.png", () => ({ dispose: vi.fn() }) as never);
    expect(cache.size).toBe(1);
    cache.acquire("b.png", () => ({ dispose: vi.fn() }) as never);
    expect(cache.size).toBe(2);
    cache.disposeAll();
    expect(cache.size).toBe(0);
  });
});
