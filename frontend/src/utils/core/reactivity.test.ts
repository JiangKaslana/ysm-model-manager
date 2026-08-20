// @vitest-environment node
// ===== 轻量响应式测试（reactivity.ts）=====
// rAF 去抖：mock requestAnimationFrame 手动触发，精确断言订阅时序与 changedKeys。
// 订阅者签名 (changedKeys: Set<string>)；同帧多次变更只触发一次刷新。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  scheduleRefresh,
  subscribe,
  unsubscribeAll,
  reactive,
  readonly,
} from "./reactivity.ts";

let rafQueue: Array<() => void>;

beforeEach(() => {
  rafQueue = [];
  unsubscribeAll();
  vi.stubGlobal("requestAnimationFrame", (fn: () => void) => {
    rafQueue.push(fn);
    return rafQueue.length;
  });
});

afterEach(() => {
  // 执行残留 rAF（复位模块级 _refreshScheduled，防测试间污染）
  const q = rafQueue;
  rafQueue = [];
  for (const fn of q) fn();
  unsubscribeAll();
  vi.unstubAllGlobals();
  // 恢复 spyOn（订阅者抛错测试的 console.error spy），失败路径也不泄漏
  vi.restoreAllMocks();
});

function flushRaf(): void {
  const q = rafQueue;
  rafQueue = [];
  for (const fn of q) fn();
}

describe("scheduleRefresh / subscribe", () => {
  it("scheduleRefresh 同帧多次只触发一次订阅", () => {
    const fn = vi.fn();
    subscribe(fn);
    scheduleRefresh();
    scheduleRefresh();
    scheduleRefresh();
    expect(fn).not.toHaveBeenCalled(); // RAF 前不触发
    flushRaf();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("订阅者收到变更 key 集合（同帧去抖：快照取首次 scheduleRefresh 时刻）", () => {
    const fn = vi.fn();
    subscribe(fn);
    const state = reactive({ a: 1, b: 2 } as Record<string, number>);
    state.a = 10; // 首次 scheduleRefresh：快照 {a} 并清空
    state.b = 20; // 去抖返回（key 已清空，不入快照）
    flushRaf();
    expect(fn).toHaveBeenCalledTimes(1);
    const keys = fn.mock.calls[0][0] as Set<string>;
    expect([...keys]).toEqual(["a"]);
  });

  it("返回的取消函数使订阅失效", () => {
    const fn = vi.fn();
    const off = subscribe(fn);
    off();
    scheduleRefresh();
    flushRaf();
    expect(fn).not.toHaveBeenCalled();
  });

  it("unsubscribeAll 清空全部订阅者", () => {
    const fn = vi.fn();
    subscribe(fn);
    unsubscribeAll();
    scheduleRefresh();
    flushRaf();
    expect(fn).not.toHaveBeenCalled();
  });

  it("订阅者抛错不影响其他订阅者且记 console.error", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const bad = vi.fn(() => { throw new Error("sub"); });
    const good = vi.fn();
    subscribe(bad);
    subscribe(good);
    scheduleRefresh();
    flushRaf();
    expect(errSpy).toHaveBeenCalled();
    expect(good).toHaveBeenCalledTimes(1);
    // 恢复统一走 afterEach 的 vi.restoreAllMocks()
  });

  it("纯 () => void 签名订阅者兼容（多余参数被忽略）", () => {
    const fn = vi.fn(() => {});
    subscribe(fn);
    scheduleRefresh();
    flushRaf();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("reactive", () => {
  it("属性赋值触发刷新", () => {
    const fn = vi.fn();
    subscribe(fn);
    const state = reactive({ n: 1 } as Record<string, number>);
    state.n = 2;
    flushRaf();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("同值赋值短路（Object.is）不触发刷新", () => {
    const fn = vi.fn();
    subscribe(fn);
    const state = reactive({ n: 1 } as Record<string, number>);
    state.n = 1;
    flushRaf();
    expect(fn).not.toHaveBeenCalled();
  });

  it("嵌套对象深度代理：修改嵌套属性触发且引用稳定（WeakMap 缓存）", () => {
    const fn = vi.fn();
    subscribe(fn);
    const state = reactive({ nested: { deep: 1 } } as Record<string, { deep: number }>);
    const first = state.nested;
    state.nested.deep = 2;
    flushRaf();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(state.nested).toBe(first); // 重复 get 返回同一 proxy
  });

  it("数组字段内部变更不触发（Proxy 不代理数组）；整体替换触发", () => {
    const fn = vi.fn();
    subscribe(fn);
    const state = reactive({ arr: [1, 2] } as Record<string, number[]>);
    state.arr[0] = 99; // 数组内部变更：不触发
    flushRaf();
    expect(fn).not.toHaveBeenCalled();
    state.arr = [3, 4]; // 整体替换：触发
    flushRaf();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("同一原始对象重复 reactive 返回同一 proxy（引用稳定）", () => {
    const raw = { x: 1 } as Record<string, number>;
    const p1 = reactive(raw);
    const p2 = reactive(raw);
    expect(p1).toBe(p2);
  });

  it("readonly 直接返回原对象（passthrough，不做深冻结）", () => {
    const obj = { a: 1 };
    expect(readonly(obj)).toBe(obj);
  });
});
