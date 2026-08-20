// @vitest-environment node
// ===== 异步工具测试（async.ts）=====
// 覆盖：swallowError/fireAndForget/delay/waitForFrame/makeLazyLoader、
// LoadingGuard/DebouncedTimer/Abortable 生命周期守卫。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// async.ts 仅依赖 ./log.ts——mock 掉，断言错误不沉默
vi.mock("./log.ts", () => ({ logWarn: vi.fn() }));
import { logWarn } from "./log.ts";
import {
  swallowError,
  fireAndForget,
  delay,
  waitForFrame,
  makeLazyLoader,
  LoadingGuard,
  DebouncedTimer,
  Abortable,
} from "./async.ts";

describe("swallowError / fireAndForget", () => {
  beforeEach(() => {
    vi.mocked(logWarn).mockClear();
  });

  it("swallowError 吞掉 reject 并记日志（不产生未处理异常）", async () => {
    const err = new Error("boom");
    swallowError(Promise.reject(err));
    await vi.waitFor(() => expect(logWarn).toHaveBeenCalled());
    expect(logWarn).toHaveBeenCalledWith("swallow", "", err);
  });

  it("swallowError 对 resolve 的 promise 无副作用", async () => {
    swallowError(Promise.resolve(1));
    await Promise.resolve();
    expect(logWarn).not.toHaveBeenCalled();
  });

  it("fireAndForget 调用 fn 且异常被兜底", async () => {
    const err = new Error("x");
    fireAndForget(async () => { throw err; });
    await vi.waitFor(() => expect(logWarn).toHaveBeenCalled());
    expect(logWarn).toHaveBeenCalledWith("swallow", "", err);
  });
});

describe("delay / waitForFrame", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("delay 在 ms 之后 resolve", async () => {
    const spy = vi.fn();
    delay(100).then(spy);
    expect(spy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(99);
    expect(spy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("waitForFrame 在 rAF 回调后 resolve", async () => {
    // 直接 stub 全局 rAF 为立即执行回调（node 无 rAF；stubGlobal 的 unknown
    // 参数推断会把闭包变量收窄成 never，绕开它手动赋值）
    const orig = globalThis.requestAnimationFrame;
    (globalThis as { requestAnimationFrame?: (fn: (t: number) => void) => number }).requestAnimationFrame = (fn) => {
      fn(16);
      return 1;
    };
    try {
      const spy = vi.fn();
      waitForFrame().then(spy);
      await Promise.resolve();
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      // 断言失败也须恢复全局 rAF，避免泄漏 stub 污染同 worker 后续 rAF 依赖测试
      (globalThis as { requestAnimationFrame?: (fn: (t: number) => void) => number }).requestAnimationFrame = orig;
    }
  });
});

describe("makeLazyLoader", () => {
  it("首次调用执行 loader，后续返回缓存（loader 只执行一次）", async () => {
    const loader = vi.fn(async () => "mod");
    const load = makeLazyLoader(loader);
    expect(await load()).toBe("mod");
    expect(await load()).toBe("mod");
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("并发调用共享同一 promise（loader 不重复执行）", async () => {
    let resolveFn: (v: string) => void = () => {};
    const loader = vi.fn(() => new Promise<string>((r) => { resolveFn = r; }));
    const load = makeLazyLoader(loader);
    const p1 = load();
    const p2 = load();
    resolveFn("done");
    expect(await p1).toBe("done");
    expect(await p2).toBe("done");
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("失败后清锁，下次调用可重试", async () => {
    const loader = vi.fn()
      .mockRejectedValueOnce(new Error("first"))
      .mockResolvedValueOnce("ok");
    const load = makeLazyLoader(loader);
    await expect(load()).rejects.toThrow("first");
    expect(await load()).toBe("ok");
    expect(loader).toHaveBeenCalledTimes(2);
  });
});

describe("LoadingGuard", () => {
  it("tryEnter 首次 true、同 key 重复 false、leave 后恢复", () => {
    const g = new LoadingGuard();
    expect(g.tryEnter("a")).toBe(true);
    expect(g.tryEnter("a")).toBe(false);
    expect(g.isLoading("a")).toBe(true);
    g.leave("a");
    expect(g.isLoading("a")).toBe(false);
    expect(g.tryEnter("a")).toBe(true);
  });

  it("不同 key 互不阻塞", () => {
    const g = new LoadingGuard();
    expect(g.tryEnter("a")).toBe(true);
    expect(g.tryEnter("b")).toBe(true);
  });

  it("无参默认 key 语义（单实例锁）", () => {
    const g = new LoadingGuard();
    expect(g.tryEnter()).toBe(true);
    expect(g.tryEnter()).toBe(false);
    expect(g.isLoading()).toBe(true);
    g.leave();
    expect(g.isLoading()).toBe(false);
  });

  it("clear 清空全部加载状态（异常恢复）", () => {
    const g = new LoadingGuard();
    g.tryEnter("a");
    g.tryEnter("b");
    g.clear();
    expect(g.isLoading("a")).toBe(false);
    expect(g.tryEnter("a")).toBe(true);
  });
});

describe("DebouncedTimer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("schedule 后 isPending true，到点执行 fn 并复位", () => {
    const t = new DebouncedTimer();
    const fn = vi.fn();
    t.schedule(fn, 100);
    expect(t.isPending).toBe(true);
    vi.advanceTimersByTime(99);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(t.isPending).toBe(false);
  });

  it("重复 schedule 只执行最后一次（前一个被取消）", () => {
    const t = new DebouncedTimer();
    const fn = vi.fn();
    t.schedule(fn, 100);
    t.schedule(fn, 100);
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("cancel 取消待执行定时器", () => {
    const t = new DebouncedTimer();
    const fn = vi.fn();
    t.schedule(fn, 100);
    t.cancel();
    expect(t.isPending).toBe(false);
    vi.advanceTimersByTime(200);
    expect(fn).not.toHaveBeenCalled();
  });

  it("dispose 等同 cancel（释放资源）", () => {
    const t = new DebouncedTimer();
    const fn = vi.fn();
    t.schedule(fn, 100);
    t.dispose();
    vi.advanceTimersByTime(200);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("Abortable", () => {
  it("signal 初始未中止", () => {
    const a = new Abortable();
    expect(a.signal.aborted).toBe(false);
  });

  it("abort 后重置为新 controller（旧 signal 中止、新 signal 可复用）", () => {
    const a = new Abortable();
    const s1 = a.signal;
    a.abort();
    expect(s1.aborted).toBe(true);
    expect(a.signal).not.toBe(s1);
    expect(a.signal.aborted).toBe(false);
  });

  it("dispose 只 abort 不重置（对象不再使用）", () => {
    const a = new Abortable();
    const s1 = a.signal;
    a.dispose();
    expect(s1.aborted).toBe(true);
    expect(a.signal).toBe(s1);
  });
});
