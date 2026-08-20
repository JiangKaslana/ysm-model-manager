// ===== 键盘导航测试（keyboard-nav.ts）=====
// happy-dom 环境（vitest 默认）：真实 DOM + KeyboardEvent 冒泡。
// 探测确认 happy-dom 支持 :focus 伪类与 document.activeElement。
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createKeyboardNav, type KeyboardNavOptions } from "./keyboard-nav.ts";

function makeContainer(count = 3): { container: HTMLElement; items: HTMLElement[] } {
  const container = document.createElement("div");
  const items: HTMLElement[] = [];
  for (let i = 0; i < count; i++) {
    const el = document.createElement("div");
    el.tabIndex = 0;
    el.textContent = `item${i}`;
    container.appendChild(el);
    items.push(el);
  }
  document.body.appendChild(container);
  return { container, items };
}

/** 聚焦 target 并向其派发按键（冒泡到 container；e.target 为 target，贴合真实键盘语义） */
function pressKey(target: HTMLElement, key: string): void {
  target.focus();
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
  );
}

let container: HTMLElement;
let items: HTMLElement[];

beforeEach(() => {
  document.body.innerHTML = "";
  ({ container, items } = makeContainer());
});

describe("createKeyboardNav — 箭头键移动", () => {
  it("ArrowDown 从当前项移到下一项（默认 wrap）", () => {
    createKeyboardNav(container);
    pressKey(items[0], "ArrowDown");
    expect(document.activeElement).toBe(items[1]);
  });

  it("wrap：最后一项 ArrowDown 回到第一项", () => {
    createKeyboardNav(container);
    pressKey(items[2], "ArrowDown");
    expect(document.activeElement).toBe(items[0]);
  });

  it("ArrowUp 移到上一项；wrap：第一项 ArrowUp 到末尾", () => {
    createKeyboardNav(container);
    pressKey(items[1], "ArrowUp");
    expect(document.activeElement).toBe(items[0]);
    pressKey(items[0], "ArrowUp");
    expect(document.activeElement).toBe(items[2]);
  });

  it("wrap:false 边界不循环（末项 ArrowDown 停在原地）", () => {
    createKeyboardNav(container, { wrap: false });
    pressKey(items[2], "ArrowDown");
    expect(document.activeElement).toBe(items[2]);
  });

  it("rovingTabIndex：移动后旧项 tabIndex=-1、新项 tabIndex=0", () => {
    createKeyboardNav(container, { rovingTabIndex: true });
    pressKey(items[0], "ArrowDown");
    expect(items[0].tabIndex).toBe(-1);
    expect(items[1].tabIndex).toBe(0);
  });

  it("onArrowActivate 每次移动后触发（携带新活跃项）", () => {
    const onArrowActivate = vi.fn();
    createKeyboardNav(container, { onArrowActivate });
    pressKey(items[0], "ArrowDown");
    expect(onArrowActivate).toHaveBeenCalledWith(items[1]);
  });
});

describe("createKeyboardNav — 激活 / 返回 / 退出", () => {
  it("Enter 触发 onEnter（携带当前项）", () => {
    const onEnter = vi.fn();
    createKeyboardNav(container, { onEnter });
    pressKey(items[1], "Enter");
    expect(onEnter).toHaveBeenCalledWith(items[1]);
  });

  it("Space 触发 onEnter；无 onEnter 时回退 click()", () => {
    const onEnter = vi.fn();
    const nav1 = createKeyboardNav(container, { onEnter });
    pressKey(items[0], " ");
    expect(onEnter).toHaveBeenCalledWith(items[0]);
    nav1.dispose();

    const clicked = vi.fn();
    items[0].onclick = clicked;
    createKeyboardNav(container); // 无 onEnter → 回退 click()
    pressKey(items[0], "Enter");
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it("arrowRightActivate：ArrowRight 激活当前项而非平级移动", () => {
    const onEnter = vi.fn();
    const onArrowActivate = vi.fn();
    createKeyboardNav(container, { arrowRightActivate: true, onEnter, onArrowActivate });
    pressKey(items[0], "ArrowRight");
    expect(onEnter).toHaveBeenCalledWith(items[0]);
    expect(onArrowActivate).not.toHaveBeenCalled(); // 未移动
    expect(document.activeElement).toBe(items[0]);
  });

  it("ArrowLeft 触发 onArrowBack（菜单返回）", () => {
    const onArrowBack = vi.fn();
    createKeyboardNav(container, { onArrowBack });
    pressKey(items[0], "ArrowLeft");
    expect(onArrowBack).toHaveBeenCalledTimes(1);
  });

  it("无 onArrowBack 时 ArrowLeft 回退平级移动", () => {
    createKeyboardNav(container);
    pressKey(items[1], "ArrowLeft");
    expect(document.activeElement).toBe(items[0]);
  });

  it("Escape 触发 onEscape", () => {
    const onEscape = vi.fn();
    createKeyboardNav(container, { onEscape });
    pressKey(items[0], "Escape");
    expect(onEscape).toHaveBeenCalledTimes(1);
  });
});

describe("createKeyboardNav — 跳过与守卫", () => {
  it("perKeySkip 返回 true 时按键被忽略（不移动、不 preventDefault）", () => {
    const perKeySkip = vi.fn((_t: HTMLElement | null, kind: string) => kind === "vertical");
    createKeyboardNav(container, { perKeySkip });
    items[0].focus();
    const ev = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true });
    items[0].dispatchEvent(ev);
    expect(document.activeElement).toBe(items[0]); // 未移动
    expect(ev.defaultPrevented).toBe(false); // 事件透传
    expect(perKeySkip).toHaveBeenCalledWith(items[0], "vertical");
  });

  it("skipSelector：焦点在跳过元素内时箭头键不导航", () => {
    const skip = document.createElement("div");
    skip.className = "skip-me";
    skip.tabIndex = 0;
    container.appendChild(skip);
    createKeyboardNav(container, { skipSelector: ".skip-me" });
    pressKey(skip, "ArrowDown");
    expect(document.activeElement).toBe(skip); // 未移动
  });

  it("transitioningGuard 为 true 时所有按键被忽略", () => {
    const onEnter = vi.fn();
    const transitioningGuard = vi.fn(() => true);
    createKeyboardNav(container, { onEnter, transitioningGuard });
    pressKey(items[0], "Enter");
    expect(onEnter).not.toHaveBeenCalled();
  });

  it("空列表（无匹配项）不抛错", () => {
    const empty = document.createElement("div");
    document.body.appendChild(empty);
    expect(() => createKeyboardNav(empty)).not.toThrow();
    empty.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  });

  it("dispose 解绑监听后按键不再响应", () => {
    const nav = createKeyboardNav(container);
    nav.dispose();
    pressKey(items[0], "ArrowDown");
    expect(document.activeElement).toBe(items[0]);
  });
});

describe("createKeyboardNav — 外部焦点真相源", () => {
  it("getActiveIndex/setActiveIndex 接管焦点（不依赖原生 focus）", () => {
    let idx = 1;
    const getActiveIndex = vi.fn((_list: HTMLElement[]) => idx);
    const setActiveIndex = vi.fn((_list: HTMLElement[], next: number) => { idx = next; });
    const onArrowActivate = vi.fn();
    createKeyboardNav(container, { getActiveIndex, setActiveIndex, onArrowActivate });
    pressKey(items[0], "ArrowDown");
    expect(setActiveIndex).toHaveBeenCalledWith(items, 2);
    expect(onArrowActivate).toHaveBeenCalledWith(items[2]);
    expect(getActiveIndex).toHaveBeenCalled();
  });

  it("getItems 提供自定义导航项来源（与真相源索引一致）", () => {
    let idx = 0;
    const navItems = [items[2], items[0]]; // 自定义顺序
    const getItems = vi.fn(() => navItems);
    const setActiveIndex = vi.fn((_l: HTMLElement[], next: number) => { idx = next; });
    createKeyboardNav(container, {
      getItems,
      getActiveIndex: () => idx,
      setActiveIndex,
      wrap: false,
    });
    pressKey(navItems[0], "ArrowDown");
    expect(setActiveIndex).toHaveBeenCalledWith(navItems, 1);
  });
});
