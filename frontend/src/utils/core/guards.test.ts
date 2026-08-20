// @vitest-environment node
// ===== 类型守卫测试（guards.ts）=====
import { describe, it, expect } from "vitest";
import { guardNum } from "./guards.ts";

describe("guardNum — 数值守卫", () => {
  it("正常数字原样返回", () => {
    expect(guardNum(42)).toBe(42);
  });

  it("负数原样返回", () => {
    expect(guardNum(-3.14)).toBe(-3.14);
  });

  it("0 返回 0", () => {
    expect(guardNum(0)).toBe(0);
  });

  it("undefined 返回 fallback 默认值 0", () => {
    expect(guardNum(undefined)).toBe(0);
  });

  it("NaN 返回 fallback", () => {
    expect(guardNum(NaN)).toBe(0);
  });

  it("字符串返回 fallback", () => {
    expect(guardNum("42")).toBe(0);
  });

  it("null 返回 fallback", () => {
    expect(guardNum(null)).toBe(0);
  });

  it("自定义 fallback", () => {
    expect(guardNum(undefined, 99)).toBe(99);
  });

  it("NaN 使用自定义 fallback", () => {
    expect(guardNum(NaN, -1)).toBe(-1);
  });

  it("Infinity 返回 Infinity（有限数判断）", () => {
    expect(guardNum(Infinity)).toBe(0);
  });

  it("-Infinity 返回 fallback", () => {
    expect(guardNum(-Infinity)).toBe(0);
  });

  it("布尔值返回 fallback", () => {
    expect(guardNum(true)).toBe(0);
  });

  it("对象返回 fallback", () => {
    expect(guardNum({})).toBe(0);
  });
});
