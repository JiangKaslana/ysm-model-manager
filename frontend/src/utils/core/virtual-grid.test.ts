// ===== VirtualGrid 虚拟滚动网格测试（virtual-grid.ts）=====
// happy-dom 环境：mock ResizeObserver + rAF，验证可见行渲染/列数/滚动/销毁。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createVirtualGrid } from "./virtual-grid.ts";

class MockResizeObserver {
  static instances: MockResizeObserver[] = [];
  callback: ResizeObserverCallback;
  observed: Element[] = [];

  constructor(cb: ResizeObserverCallback) {
    this.callback = cb;
    MockResizeObserver.instances.push(this);
  }
  observe(el: Element): void {
    this.observed.push(el);
  }
  disconnect(): void {
    this.observed = [];
  }
  unobserve(): void {}
}

let rafQueue: Array<() => void>;

beforeEach(() => {
  rafQueue = [];
  MockResizeObserver.instances = [];
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  vi.stubGlobal("requestAnimationFrame", (fn: () => void) => {
    rafQueue.push(fn);
    return rafQueue.length;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

function flushRaf(): void {
  const q = rafQueue;
  rafQueue = [];
  for (const fn of q) fn();
}

/** 构造容器：固定可见区 300px 高、600px 宽 */
function makeContainer(): HTMLElement {
  const c = document.createElement("div");
  Object.defineProperty(c, "clientHeight", { value: 300, configurable: true });
  Object.defineProperty(c, "clientWidth", { value: 600, configurable: true });
  document.body.appendChild(c);
  return c;
}

const ITEM_HEIGHT = 50;

describe("createVirtualGrid — 初始渲染", () => {
  it("只渲染可见行 ± buffer（远少于总行数）", () => {
    const container = makeContainer();
    const items = Array.from({ length: 200 }, (_, i) => i); // 4 列 → 50 行
    createVirtualGrid(container, {
      items,
      itemHeight: ITEM_HEIGHT,
      columns: 4,
      renderItem: (item) => {
        const el = document.createElement("div");
        el.textContent = String(item);
        return el;
      },
    });
    // 可见区 300px → 6 行 + buffer 2*2 = 最多 10 行，远小于 50 行
    const rows = container.querySelectorAll(".virtual-grid-row");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(50);
  });

  it("content 高度 = 总行数 × 项高（撑开滚动）", () => {
    const container = makeContainer();
    createVirtualGrid(container, {
      items: Array.from({ length: 30 }, (_, i) => i), // 4 列 → 8 行
      itemHeight: ITEM_HEIGHT,
      columns: 4,
      renderItem: () => document.createElement("div"),
    });
    const content = container.querySelector(".virtual-grid-content") as HTMLElement;
    expect(content.style.height).toBe(`${8 * ITEM_HEIGHT}px`);
  });

  it("行内 grid 列数与 columns 一致；空位补占位（不渲染越界项）", () => {
    const container = makeContainer();
    const rendered: number[] = [];
    createVirtualGrid(container, {
      items: [0, 1, 2, 3, 4], // 4 列 → 2 行，最后一行 1 项 + 3 占位
      itemHeight: ITEM_HEIGHT,
      columns: 4,
      renderItem: (item) => {
        rendered.push(item);
        const el = document.createElement("div");
        el.textContent = String(item);
        return el;
      },
    });
    const firstRow = container.querySelector(".virtual-grid-row") as HTMLElement;
    expect(firstRow.style.gridTemplateColumns).toContain("repeat(4");
    // 5 项都在可见区内（300px 覆盖 6 行），2 行全渲染
    expect(rendered).toEqual([0, 1, 2, 3, 4]);
    const rows = container.querySelectorAll(".virtual-grid-row");
    expect(rows.length).toBe(2);
    expect(rows[0].children.length).toBe(4); // 第一行 4 个实际项
    expect(rows[1].children.length).toBe(4); // 第二行 1 实际项 + 3 占位
    expect(rows[1].children[0].textContent).toBe("4");
    expect(rows[1].children[1].textContent).toBe(""); // 占位无内容
  });
});

describe("createVirtualGrid — 句柄操作", () => {
  it("updateItems 更新数据源并重渲染（高度随之变化）", () => {
    const container = makeContainer();
    const handle = createVirtualGrid<number>(container, {
      items: [1, 2, 3, 4],
      itemHeight: ITEM_HEIGHT,
      columns: 4,
      renderItem: (item) => {
        const el = document.createElement("div");
        el.textContent = String(item);
        return el;
      },
    });
    handle.updateItems([1, 2, 3, 4, 5, 6, 7, 8, 9]); // 4 列 → 3 行
    const content = container.querySelector(".virtual-grid-content") as HTMLElement;
    expect(content.style.height).toBe(`${3 * ITEM_HEIGHT}px`);
    expect(container.querySelectorAll(".virtual-grid-row").length).toBe(3);
  });

  it("setColumns 更新列数与高度并重渲染", () => {
    const container = makeContainer();
    const handle = createVirtualGrid<number>(container, {
      items: [1, 2, 3, 4, 5, 6],
      itemHeight: ITEM_HEIGHT,
      columns: 3, // 2 行
      renderItem: (item) => {
        const el = document.createElement("div");
        el.textContent = String(item);
        return el;
      },
    });
    handle.setColumns(2); // 3 行
    const firstRow = container.querySelector(".virtual-grid-row") as HTMLElement;
    expect(firstRow.style.gridTemplateColumns).toContain("repeat(2");
    const content = container.querySelector(".virtual-grid-content") as HTMLElement;
    expect(content.style.height).toBe(`${3 * ITEM_HEIGHT}px`);
    expect(container.querySelectorAll(".virtual-grid-row").length).toBe(3);
  });

  it("scrollToTop 将滚动位置归零", () => {
    const container = makeContainer();
    const handle = createVirtualGrid<number>(container, {
      items: Array.from({ length: 100 }, (_, i) => i),
      itemHeight: ITEM_HEIGHT,
      columns: 4,
      renderItem: () => document.createElement("div"),
    });
    const wrapper = container.querySelector(".virtual-grid-wrapper") as HTMLElement;
    wrapper.scrollTop = 500;
    handle.scrollToTop();
    expect(wrapper.scrollTop).toBe(0);
  });

  it("滚动事件经 RAF 去抖后重渲染可见行（窗口下移）", () => {
    const container = makeContainer();
    createVirtualGrid<number>(container, {
      items: Array.from({ length: 200 }, (_, i) => i), // 50 行
      itemHeight: ITEM_HEIGHT,
      columns: 4,
      renderItem: () => document.createElement("div"),
    });
    const wrapper = container.querySelector(".virtual-grid-wrapper") as HTMLElement;
    const before = container.querySelectorAll(".virtual-grid-row").length;
    wrapper.scrollTop = 500; // 第 10 行开始
    wrapper.dispatchEvent(new Event("scroll"));
    expect(container.querySelectorAll(".virtual-grid-row").length).toBe(before); // RAF 前不变
    flushRaf();
    const after = container.querySelectorAll(".virtual-grid-row").length;
    expect(after).toBeGreaterThan(0);
    // 窗口下移后首行 top 应 ≥ 500 - buffer*50（至少不在第 0 行）
    const firstRow = container.querySelector(".virtual-grid-row") as HTMLElement;
    expect(parseInt(firstRow.style.top, 10)).toBeGreaterThanOrEqual(300);
  });

  it("dispose 移除 wrapper 并断开 ResizeObserver", () => {
    const container = makeContainer();
    const handle = createVirtualGrid<number>(container, {
      items: [1, 2, 3],
      itemHeight: ITEM_HEIGHT,
      columns: 3,
      responsiveColumnWidth: 100,
      renderItem: () => document.createElement("div"),
    });
    expect(container.querySelector(".virtual-grid-wrapper")).not.toBeNull();
    expect(MockResizeObserver.instances.length).toBeGreaterThan(0);
    handle.dispose();
    expect(container.querySelector(".virtual-grid-wrapper")).toBeNull();
    expect(MockResizeObserver.instances.every((o) => o.observed.length === 0)).toBe(true);
  });
});

describe("createVirtualGrid — 响应式列数", () => {
  it("responsiveColumnWidth：按容器宽度自动计算列数", () => {
    const container = makeContainer(); // clientWidth 600
    createVirtualGrid<number>(container, {
      items: Array.from({ length: 20 }, (_, i) => i),
      itemHeight: ITEM_HEIGHT,
      columns: 1,
      responsiveColumnWidth: 100, // gap 8 → floor((600+8)/108) = 5
      renderItem: () => document.createElement("div"),
    });
    const firstRow = container.querySelector(".virtual-grid-row") as HTMLElement;
    expect(firstRow.style.gridTemplateColumns).toContain("repeat(5");
  });
});
