// @vitest-environment node
// ===== 深拷贝测试（deep-clone.ts）=====
import { describe, it, expect } from "vitest";
import { deepClone } from "./deep-clone.ts";

describe("deepClone — JSON 深拷贝", () => {
  it("基本对象克隆", () => {
    const obj = { a: 1, b: "hello", c: true };
    const cloned = deepClone(obj);
    expect(cloned).toEqual(obj);
    expect(cloned).not.toBe(obj);
  });

  it("嵌套对象克隆", () => {
    const obj = { a: { b: { c: 42 } } };
    const cloned = deepClone(obj);
    expect(cloned).toEqual(obj);
    expect(cloned.a).not.toBe(obj.a);
    expect(cloned.a.b).not.toBe(obj.a.b);
  });

  it("数组克隆", () => {
    const arr = [1, [2, 3], { a: 4 }];
    const cloned = deepClone(arr);
    expect(cloned).toEqual(arr);
    expect(cloned).not.toBe(arr);
    expect(cloned[1]).not.toBe(arr[1]);
  });

  it("null 克隆", () => {
    expect(deepClone(null)).toBeNull();
  });

  it("基本类型克隆", () => {
    expect(deepClone(42)).toBe(42);
    expect(deepClone("hello")).toBe("hello");
    expect(deepClone(true)).toBe(true);
  });

  it("修改克隆不影响原对象", () => {
    const obj = { a: 1, b: { c: 2 } };
    const cloned = deepClone(obj);
    cloned.a = 99;
    cloned.b.c = 99;
    expect(obj.a).toBe(1);
    expect(obj.b.c).toBe(2);
  });

  it("注意：函数会丢失（JSON 序列化限制）", () => {
    const obj = { a: 1, fn: () => 42 };
    const cloned = deepClone(obj);
    expect(cloned.a).toBe(1);
    expect(cloned.fn).toBeUndefined();
  });

  it("注意：undefined 值会丢失", () => {
    const obj = { a: 1, b: undefined };
    const cloned = deepClone(obj);
    expect(cloned).toEqual({ a: 1 });
  });

  it("空对象克隆", () => {
    expect(deepClone({})).toEqual({});
  });

  it("空数组克隆", () => {
    expect(deepClone([])).toEqual([]);
  });
});
