// @vitest-environment node
// ===== 格式化函数测试（format.ts）=====
import { describe, it, expect } from "vitest";
import { formatTime, formatError } from "./format.ts";

describe("formatTime — 秒数格式化为 MM:SS.CC", () => {
  it("0 秒返回 00:00.00", () => {
    expect(formatTime(0)).toBe("00:00.00");
  });

  it("整数秒", () => {
    expect(formatTime(65)).toBe("01:05.00");
  });

  it("带百分秒", () => {
    expect(formatTime(1.23)).toBe("00:01.23");
  });

  it("超过 60 秒进位分钟", () => {
    expect(formatTime(121.5)).toBe("02:01.50");
  });

  it("大数值（超长时长不限分钟位数）", () => {
    expect(formatTime(3600)).toBe("60:00.00");
  });

  it("NaN 返回 00:00.00", () => {
    expect(formatTime(NaN)).toBe("00:00.00");
  });

  it("Infinity 返回 00:00.00", () => {
    expect(formatTime(Infinity)).toBe("00:00.00");
  });

  it("负 Infinity 返回 00:00.00", () => {
    expect(formatTime(-Infinity)).toBe("00:00.00");
  });

  it("极小正数", () => {
    expect(formatTime(0.001)).toBe("00:00.00");
  });

  it("0.99 秒显示为 00:00.99", () => {
    expect(formatTime(0.99)).toBe("00:00.99");
  });
});

describe("formatError — 错误格式化", () => {
  it("null 返回 unknown error", () => {
    expect(formatError(null)).toBe("unknown error");
  });

  it("undefined 返回 unknown error", () => {
    expect(formatError(undefined)).toBe("unknown error");
  });

  it("Error 对象取 message", () => {
    expect(formatError(new Error("something failed"))).toBe("something failed");
  });

  it("字符串直接返回", () => {
    expect(formatError("plain error")).toBe("plain error");
  });

  it("超长字符串截断", () => {
    const long = "x".repeat(200);
    const result = formatError(long, 50);
    expect(result.length).toBe(50);
    expect(result.endsWith("...")).toBe(true);
  });

  it("超长 Error.message 截断", () => {
    const err = new Error("x".repeat(200));
    const result = formatError(err, 50);
    expect(result.length).toBe(50);
    expect(result.endsWith("...")).toBe(true);
  });

  it("maxLen 最小为 3（防负值/0）", () => {
    const result = formatError("hello world", 0);
    // limit = Math.max(3, 0) = 3, "hello world" > 3 → slice(0, 0) + "..." = "..."
    expect(result).toBe("...");
  });

  it("结构化 LibraryLoadError 对象加前缀", () => {
    const err = {
      name: "LibraryLoadError",
      loadId: "lib1",
      phase: "parse",
      cause: "invalid data",
    };
    const result = formatError(err);
    expect(result).toBe("[lib1/parse] invalid data");
  });

  it("结构化错误超长截断", () => {
    const err = {
      name: "LibraryLoadError",
      loadId: "lib1",
      phase: "parse",
      cause: "x".repeat(200),
    };
    const result = formatError(err, 40);
    // 递归截断：cause 先被截断，然后整体再被截断，结果不超过 limit
    expect(result.length).toBeLessThanOrEqual(40);
    expect(result.endsWith("...")).toBe(true);
    expect(result.startsWith("[lib1/parse] ")).toBe(true);
  });

  it("数字类型转字符串", () => {
    expect(formatError(42)).toBe("42");
  });

  it("对象转字符串", () => {
    const obj = { toString: () => "custom error" };
    expect(formatError(obj)).toBe("custom error");
  });
});
