// @vitest-environment node
// ===== 时间戳格式化测试（format-timestamp.ts）=====
import { describe, it, expect } from "vitest";
import { formatTimestamp } from "./format-timestamp.ts";

describe("formatTimestamp — 格式化为 HH:MM:SS.mmm", () => {
  it("指定时间格式化", () => {
    const d = new Date(2024, 0, 1, 9, 5, 3, 42);
    expect(formatTimestamp(d)).toBe("09:05:03.042");
  });

  it("零值时间", () => {
    const d = new Date(2024, 0, 1, 0, 0, 0, 0);
    expect(formatTimestamp(d)).toBe("00:00:00.000");
  });

  it("最大值时间 23:59:59.999", () => {
    const d = new Date(2024, 0, 1, 23, 59, 59, 999);
    expect(formatTimestamp(d)).toBe("23:59:59.999");
  });

  it("毫秒不足三位补零", () => {
    const d = new Date(2024, 0, 1, 1, 2, 3, 7);
    expect(formatTimestamp(d)).toBe("01:02:03.007");
  });

  it("毫秒两位补零", () => {
    const d = new Date(2024, 0, 1, 1, 2, 3, 42);
    expect(formatTimestamp(d)).toBe("01:02:03.042");
  });

  it("无参数调用不抛错（使用当前时间）", () => {
    expect(() => formatTimestamp()).not.toThrow();
    const result = formatTimestamp();
    // 格式应为 HH:MM:SS.mmm
    expect(result).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3}$/);
  });
});
