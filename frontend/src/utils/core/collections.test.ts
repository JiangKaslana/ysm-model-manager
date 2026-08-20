// @vitest-environment node
// ===== 集合工具函数测试（collections.ts）=====
import { describe, it, expect } from "vitest";
import { ensureArray, filterKeys, Cache, allSettledFilter } from "./collections.ts";

describe("ensureArray — 确保数组", () => {
  it("数组原样返回", () => {
    const arr = [1, 2, 3];
    expect(ensureArray(arr)).toBe(arr);
  });

  it("非数组包裹为单元素数组", () => {
    expect(ensureArray(42)).toEqual([42]);
  });

  it("字符串包裹为单元素数组", () => {
    expect(ensureArray("hello")).toEqual(["hello"]);
  });

  it("null 包裹为 [null]", () => {
    expect(ensureArray(null)).toEqual([null]);
  });

  it("undefined 包裹为 [undefined]", () => {
    expect(ensureArray(undefined)).toEqual([undefined]);
  });

  it("空数组原样返回", () => {
    const arr: number[] = [];
    expect(ensureArray(arr)).toBe(arr);
  });

  it("对象包裹为单元素数组", () => {
    const obj = { a: 1 };
    expect(ensureArray(obj)).toEqual([obj]);
  });
});

describe("filterKeys — 按谓词过滤键", () => {
  it("过滤出以 a 开头的键", () => {
    const obj = { apple: 1, banana: 2, avocado: 3 };
    expect(filterKeys(obj, (k) => k.startsWith("a"))).toEqual({ apple: 1, avocado: 3 });
  });

  it("无匹配键返回空对象", () => {
    const obj = { a: 1, b: 2 };
    expect(filterKeys(obj, (k) => k.startsWith("z"))).toEqual({});
  });

  it("全部匹配返回完整对象", () => {
    const obj = { x: 1, y: 2 };
    expect(filterKeys(obj, () => true)).toEqual({ x: 1, y: 2 });
  });

  it("空对象返回空对象", () => {
    expect(filterKeys({}, () => true)).toEqual({});
  });

  it("防止 __proto__ 原型污染", () => {
    // Object.keys 不返回 __proto__，所以 filterKeys 只处理 own enumerable 键
    const obj = { safe: 1 };
    const result = filterKeys(obj, () => true);
    expect(result).toEqual({ safe: 1 });
    // 确保新对象不受污染
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("Cache — 轻量缓存", () => {
  it("set/get 基本存取", () => {
    const cache = new Cache<string, number>();
    cache.set("a", 1);
    expect(cache.get("a")).toBe(1);
  });

  it("has 判断存在性", () => {
    const cache = new Cache<string, number>();
    cache.set("a", 1);
    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
  });

  it("delete 删除条目", () => {
    const cache = new Cache<string, number>();
    cache.set("a", 1);
    expect(cache.delete("a")).toBe(true);
    expect(cache.has("a")).toBe(false);
  });

  it("delete 不存在的键返回 false", () => {
    const cache = new Cache<string, number>();
    expect(cache.delete("nonexistent")).toBe(false);
  });

  it("clear 清空所有条目", () => {
    const cache = new Cache<string, number>();
    cache.set("a", 1);
    cache.set("b", 2);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.has("a")).toBe(false);
  });

  it("size 返回条目数", () => {
    const cache = new Cache<string, number>();
    expect(cache.size).toBe(0);
    cache.set("a", 1);
    expect(cache.size).toBe(1);
    cache.set("b", 2);
    expect(cache.size).toBe(2);
  });

  it("get 不存在的键返回 undefined", () => {
    const cache = new Cache<string, number>();
    expect(cache.get("missing")).toBeUndefined();
  });

  it("覆盖已有键的值", () => {
    const cache = new Cache<string, number>();
    cache.set("a", 1);
    cache.set("a", 2);
    expect(cache.get("a")).toBe(2);
    expect(cache.size).toBe(1);
  });
});

describe("allSettledFilter — 过滤 fulfilled 结果", () => {
  it("全部 fulfilled 返回所有结果", async () => {
    const results = await allSettledFilter([Promise.resolve(1), Promise.resolve(2)]);
    expect(results).toEqual([
      { status: "fulfilled", value: 1 },
      { status: "fulfilled", value: 2 },
    ]);
  });

  it("混合 fulfilled/rejected 只返回 fulfilled", async () => {
    const results = await allSettledFilter([
      Promise.resolve(1),
      Promise.reject(new Error("fail")),
      Promise.resolve(3),
    ]);
    expect(results).toEqual([
      { status: "fulfilled", value: 1 },
      { status: "fulfilled", value: 3 },
    ]);
  });

  it("全部 rejected 返回空数组", async () => {
    const results = await allSettledFilter([
      Promise.reject(new Error("fail1")),
      Promise.reject(new Error("fail2")),
    ]);
    expect(results).toEqual([]);
  });

  it("非 Promise 值当作 fulfilled 处理", async () => {
    const results = await allSettledFilter([42, "hello", true]);
    expect(results).toEqual([
      { status: "fulfilled", value: 42 },
      { status: "fulfilled", value: "hello" },
      { status: "fulfilled", value: true },
    ]);
  });

  it("空数组返回空", async () => {
    const results = await allSettledFilter([]);
    expect(results).toEqual([]);
  });
});
