// ===== 自愈工具测试（test-utils/self-healing）=====
// 覆盖：expectContainsAtLeast（缺项/允许额外/全匹配）/ expectNotContains（含/不含）/
// deriveTestIds（推导选择器）/ extractIds（提取排序）
import { describe, it, expect } from "vitest";
import {
  expectContainsAtLeast,
  expectNotContains,
  deriveTestIds,
  extractIds,
} from "./self-healing.ts";

describe("expectContainsAtLeast", () => {
  it("required 全部在 actual 中 → pass", () => {
    expectContainsAtLeast(["a", "b", "c"], ["a", "c"], "测试");
  });

  it("required 缺项 → fail 并提示缺项与实列", () => {
    expect(() =>
      expectContainsAtLeast(["a"], ["a", "b", "c"], "测试"),
    ).toThrow(/缺必需项: b, c/);
  });

  it("允许额外项（菜单表新增项不碎测试）", () => {
    expectContainsAtLeast(
      ["model", "shot", "bones", "vrma-play"],
      ["model", "shot", "bones"],
      "允许额外",
    );
  });

  it("required 为空 → pass（无必需约束）", () => {
    expectContainsAtLeast(["extra"], [], "无必需");
  });
});

describe("expectNotContains", () => {
  it("forbidden 都不在 actual → pass", () => {
    expectNotContains(["a", "b"], ["x", "y"], "测试");
  });

  it("forbidden 存在 → fail 并提示出现的项", () => {
    expect(() =>
      expectNotContains(["a", "forbidden"], ["forbidden"], "测试"),
    ).toThrow(/应不含: forbidden/);
  });

  it("forbidden 为空 → pass（无反向约束）", () => {
    expectNotContains(["anything"], [], "无反向");
  });
});

describe("deriveTestIds", () => {
  it("推导 preview-${id} 选择器", () => {
    const items = [
      { id: "model", dockGroup: "model" },
      { id: "shot", dockGroup: "model" },
      { id: "play", dockGroup: "motion" },
    ];
    expect(deriveTestIds(items)).toEqual([
      "preview-model",
      "preview-shot",
      "preview-play",
    ]);
  });

  it("空列表 → 空数组", () => {
    expect(deriveTestIds([])).toEqual([]);
  });
});

describe("extractIds", () => {
  it("提取 id 并排序", () => {
    const items = [
      { id: "shot" },
      { id: "model" },
      { id: "bones" },
    ];
    expect(extractIds(items)).toEqual(["bones", "model", "shot"]);
  });

  it("空列表 → 空数组", () => {
    expect(extractIds([])).toEqual([]);
  });
});
