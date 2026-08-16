// ===== web-stats 编排层测试（审核 B 缺口 #1，可测部分）=====
// 降级标记（consume 复位）、runner 注入的降级传播、terminate 幂等。
// 单槽守卫/超时/onerror 走 Worker 路径（new Worker 测试环境不支持），标注为环境限制。
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  batchStatsWebModels,
  setStatsRunnerForTest,
  consumeWebSearchDegraded,
  terminateStatsWorker,
} from "./web-stats.ts";

beforeEach(() => {
  setStatsRunnerForTest(null);
});

describe("web-stats 编排（可测部分）", () => {
  it("runner 注入：返回统计 → 不降级；consume 标记 false", async () => {
    setStatsRunnerForTest(async (paths) =>
      paths.map(() => ({ boneCount: 10, cubeCount: 5, texWidth: 64, texHeight: 64, hasError: false })),
    );
    const res = await batchStatsWebModels(["/web/ysm/a.ysm"]);
    expect(res?.[0]?.boneCount).toBe(10);
    expect(consumeWebSearchDegraded()).toBe(false);
  });

  it("runner 返回 null → 整批降级 + 降级标记置位（consume 一次后复位）", async () => {
    setStatsRunnerForTest(async () => null);
    const res = await batchStatsWebModels(["/web/ysm/a.ysm"]);
    expect(res).toBeNull();
    expect(consumeWebSearchDegraded()).toBe(true);
    expect(consumeWebSearchDegraded()).toBe(false); // 一次消费复位
  });

  it("runner 抛错 → 降级（不向上抛，批返回 null）", async () => {
    setStatsRunnerForTest(async () => {
      throw new Error("boom");
    });
    const res = await batchStatsWebModels(["/web/ysm/a.ysm"]);
    expect(res).toBeNull();
    expect(consumeWebSearchDegraded()).toBe(true);
  });

  it("空路径 → 空数组（不启动统计）", async () => {
    const res = await batchStatsWebModels([]);
    expect(res).toEqual([]);
    expect(consumeWebSearchDegraded()).toBe(false);
  });

  it("terminateStatsWorker 幂等（无 Worker 时不抛）", () => {
    expect(() => terminateStatsWorker()).not.toThrow();
    expect(() => terminateStatsWorker()).not.toThrow();
  });
});
