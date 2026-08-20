// @vitest-environment node
// ===== JSON 序列化辅助测试（json-stringify.ts）=====
import { describe, it, expect } from "vitest";
import { jsonStringify, jsonParse } from "./json-stringify.ts";

describe("jsonStringify — 美化 JSON 序列化", () => {
  it("对象序列化为美化格式", () => {
    expect(jsonStringify({ a: 1 })).toBe('{\n  "a": 1\n}');
  });

  it("数组序列化", () => {
    expect(jsonStringify([1, 2, 3])).toBe("[\n  1,\n  2,\n  3\n]");
  });

  it("undefined 返回 'null'", () => {
    expect(jsonStringify(undefined)).toBe("null");
  });

  it("symbol 返回 'null'", () => {
    expect(jsonStringify(Symbol("test"))).toBe("null");
  });

  it("null 返回 'null'", () => {
    expect(jsonStringify(null)).toBe("null");
  });

  it("嵌套对象保留缩进", () => {
    const result = jsonStringify({ a: { b: 1 } });
    expect(result).toContain("  ");
    expect(result).toContain('"b": 1');
  });

  it("字符串序列化加引号", () => {
    expect(jsonStringify("hello")).toBe('"hello"');
  });

  it("数字序列化", () => {
    expect(jsonStringify(42)).toBe("42");
  });
});

describe("jsonParse — 安全 JSON 解析", () => {
  it("有效 JSON 解析", () => {
    expect(jsonParse('{"a":1}')).toEqual({ a: 1 });
  });

  it("有效数组 JSON 解析", () => {
    expect(jsonParse("[1,2,3]")).toEqual([1, 2, 3]);
  });

  it("无效 JSON 返回 null", () => {
    expect(jsonParse("not json")).toBeNull();
  });

  it("空字符串返回 null", () => {
    expect(jsonParse("")).toBeNull();
  });

  it("解析 null 字面量", () => {
    expect(jsonParse("null")).toBeNull();
  });

  it("解析数字", () => {
    expect(jsonParse<number>("42")).toBe(42);
  });

  it("解析布尔值", () => {
    expect(jsonParse<boolean>("true")).toBe(true);
  });
});
