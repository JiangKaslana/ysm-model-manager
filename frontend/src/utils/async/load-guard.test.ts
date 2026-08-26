// ===== load-guard 代数守卫测试（oldest-models / recycle-bin 共用的渲染代数模式）=====
import { describe, expect, it } from "vitest";
import { createLoadGuard } from "./load-guard.ts";

describe("createLoadGuard", () => {
  it("next() 自增并返回新代数，stale 对当前代数为 false", () => {
    const g = createLoadGuard();
    const gen = g.next();
    expect(g.stale(gen)).toBe(false);
  });

  it("新一轮 next() 使旧代数变 stale（慢响应丢弃）", () => {
    const g = createLoadGuard();
    const old = g.next();
    g.next();
    expect(g.stale(old)).toBe(true);
  });

  it("invalidate() 使所有在途代数 stale（cleanup 后迟到写入被丢弃）", () => {
    const g = createLoadGuard();
    const gen = g.next();
    g.invalidate();
    expect(g.stale(gen)).toBe(true);
  });

  it("invalidate 后 next() 的新代数依然有效（组件复用场景）", () => {
    const g = createLoadGuard();
    g.next();
    g.invalidate();
    const gen = g.next();
    expect(g.stale(gen)).toBe(false);
  });
});
