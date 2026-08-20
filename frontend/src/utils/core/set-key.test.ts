// @vitest-environment node
// ===== 键值写入工具测试（set-key.ts）=====
import { describe, it, expect } from "vitest";
import { setKey } from "./set-key.ts";

describe("setKey — 泛型键值写入", () => {
  it("设置对象属性", () => {
    const obj = { a: 1, b: 2 };
    setKey(obj, "a", 99);
    expect(obj.a).toBe(99);
  });

  it("设置新属性", () => {
    const obj = { a: 1 } as { a: number; b?: number };
    setKey(obj, "b", 42);
    expect(obj.b).toBe(42);
  });

  it("设置字符串值", () => {
    const obj = { name: "old" };
    setKey(obj, "name", "new");
    expect(obj.name).toBe("new");
  });

  it("设置布尔值", () => {
    const obj = { flag: false };
    setKey(obj, "flag", true);
    expect(obj.flag).toBe(true);
  });

  it("设置对象值", () => {
    const obj = { data: { x: 1 } };
    const newData = { x: 2, y: 3 };
    setKey(obj, "data", newData);
    expect(obj.data).toBe(newData);
  });

  it("多次设置同一键", () => {
    const obj = { count: 0 };
    setKey(obj, "count", 1);
    setKey(obj, "count", 2);
    setKey(obj, "count", 3);
    expect(obj.count).toBe(3);
  });
});
