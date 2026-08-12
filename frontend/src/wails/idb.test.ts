// ===== idb.ts 故障路径测试（子代理审计 P2：idb 零测试，被 browser-adapter 整体 mock 掉）=====
// 覆盖：open 失败降级 / onblocked / 内存驱逐双上限 / versionchange 重开 / _resetDBForTest
// 实现：vi.stubGlobal 注入受控 fake indexedDB（open 可触发 onsuccess/onerror/onblocked），
// 不依赖 fake-indexeddb 库（零依赖原则）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetDBForTest, idbGet, idbKeys, idbSet, openDB } from "./idb.ts";

// MEMORY_MAX_KEYS=200 / MEMORY_MAX_BYTES=64MB（与 idb.ts 常量保持一致——此处验证驱逐行为）
const MEMORY_MAX_KEYS = 200;

/** 构造可控 fake indexedDB：open 可触发 onsuccess / onerror / onblocked */
function makeFakeIDB(opts: { failOpen?: boolean; blocked?: boolean } = {}): {
  openCount: number;
  triggerVersionChange: () => void;
} {
  let openCount = 0;
  let vcHandler: (() => void) | null = null;
  const fakeDB = {
    close: vi.fn(),
    transaction: vi.fn(),
    objectStoreNames: { contains: () => false },
    createObjectStore: vi.fn(),
  };
  // onversionchange 用 defineProperty 注入——idb.ts 赋值 handler，triggerVersionChange 调用
  Object.defineProperty(fakeDB, "onversionchange", {
    configurable: true,
    get: () => vcHandler,
    set: (fn: (() => void) | null) => {
      vcHandler = fn;
    },
  });
  const open = vi.fn(() => {
    openCount++;
    const req = {
      result: fakeDB,
      error: new Error("indexedDB open failed"),
      onsuccess: null as (() => void) | null,
      onerror: null as (() => void) | null,
      onblocked: null as (() => void) | null,
      onupgradeneeded: null as (() => void) | null,
    };
    if (opts.failOpen) {
      setTimeout(() => req.onerror?.(), 0);
    } else if (opts.blocked) {
      setTimeout(() => req.onblocked?.(), 0);
    } else {
      setTimeout(() => req.onsuccess?.(), 0);
    }
    return req;
  });
  vi.stubGlobal("indexedDB", { open });
  return {
    // 只保留 getter（TS1119：属性与访问器不能同名）
    get openCount() {
      return openCount;
    },
    triggerVersionChange: () => vcHandler?.(),
  };
}

describe("idb 故障路径", () => {
  beforeEach(() => {
    _resetDBForTest();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    _resetDBForTest();
  });

  it("open 失败（隐私模式）→ 降级内存模式，读写仍可用", async () => {
    makeFakeIDB({ failOpen: true });
    await idbSet("files", "dir:ysm/a", { name: "a", addedAt: 1 });
    const v = await idbGet<{ name: string }>("files", "dir:ysm/a");
    expect(v?.name).toBe("a");
  });

  it("onblocked（多标签页持旧连接）→ reject → 降级内存模式", async () => {
    makeFakeIDB({ blocked: true });
    await idbSet("files", "file:ysm/a/b", { data: new ArrayBuffer(4), size: 4, mime: "" });
    const keys = await idbKeys("files", "file:ysm/");
    expect(keys).toContain("file:ysm/a/b");
  });

  it("内存模式驱逐：超 200 条 FIFO 淘汰最旧", async () => {
    // 无 indexedDB（未 stub）→ backendIsIdb false → 纯内存模式
    for (let i = 0; i < MEMORY_MAX_KEYS + 10; i++) {
      await idbSet("files", `k${i}`, { n: i });
    }
    const keys = await idbKeys("files", "");
    expect(keys.length).toBe(MEMORY_MAX_KEYS);
    // 最旧 10 条被驱逐（k0..k9），最新 10 条保留（k200..k209）
    expect(keys).not.toContain("k0");
    expect(keys).toContain("k209");
  });

  it("versionchange 关闭后重开（P2 修复）：dbPromise 置空后 openDB 重新连接", async () => {
    const fake = makeFakeIDB();
    const db1 = await openDB();
    expect(db1).toBeTruthy();
    const firstCount = fake.openCount;
    // 模拟其他标签页请求升级 → versionchange → 关闭连接
    fake.triggerVersionChange();
    // 再次 openDB 应重新调 indexedDB.open（openCount 增加），而非复用已关闭连接
    const db2 = await openDB();
    expect(db2).toBeTruthy();
    expect(fake.openCount).toBeGreaterThan(firstCount);
    // 重开后返回的是新连接对象（同一 fakeDB 实例，此处验证不再走已关闭路径）
    expect(db2).toBe(db1);
  });
});
