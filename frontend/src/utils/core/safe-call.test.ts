// @vitest-environment node
// ===== 安全调用测试（safe-call.ts）=====
import { describe, it, expect, vi, beforeEach } from "vitest";
import { safeCall, safeCallVoid, safeCallAsync } from "./safe-call.ts";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("safeCall — 同步安全调用", () => {
  it("正常执行返回结果", () => {
    const result = safeCall("test", "msg", () => 42);
    expect(result).toBe(42);
  });

  it("异常时返回 undefined", () => {
    const result = safeCall("test", "msg", () => {
      throw new Error("fail");
    });
    expect(result).toBeUndefined();
  });

  it("异常时调用 console.warn", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    safeCall("audio", "decode failed", () => {
      throw new Error("boom");
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toContain("[audio]");
    expect(spy.mock.calls[0][0]).toContain("decode failed");
  });

  it("不抛错", () => {
    expect(() =>
      safeCall("test", "msg", () => {
        throw new Error("fail");
      })
    ).not.toThrow();
  });

  it("返回复杂对象", () => {
    const obj = { a: 1, b: [2, 3] };
    const result = safeCall("test", "msg", () => obj);
    expect(result).toBe(obj);
  });
});

describe("safeCallVoid — 同步无返回值安全调用", () => {
  it("正常执行不抛错", () => {
    let called = false;
    safeCallVoid("test", "msg", () => {
      called = true;
    });
    expect(called).toBe(true);
  });

  it("异常时不传播", () => {
    expect(() =>
      safeCallVoid("test", "msg", () => {
        throw new Error("fail");
      })
    ).not.toThrow();
  });

  it("异常时调用 console.warn", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    safeCallVoid("physics", "step failed", () => {
      throw new Error("boom");
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toContain("[physics]");
  });
});

describe("safeCallAsync — 异步安全调用", () => {
  it("正常执行返回结果", async () => {
    const result = await safeCallAsync("test", "msg", async () => 42);
    expect(result).toBe(42);
  });

  it("异常时返回 undefined", async () => {
    const result = await safeCallAsync("test", "msg", async () => {
      throw new Error("fail");
    });
    expect(result).toBeUndefined();
  });

  it("异常时不 reject", async () => {
    await expect(
      safeCallAsync("test", "msg", async () => {
        throw new Error("fail");
      })
    ).resolves.toBeUndefined();
  });

  it("异常时调用 console.warn", async () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await safeCallAsync("init", "Library init", async () => {
      throw new Error("boom");
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toContain("[init]");
  });
});
