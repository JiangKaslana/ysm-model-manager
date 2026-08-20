// ===== litematic-adapter 单元测试：借测试反推源码问题 =====
// @vitest-environment happy-dom
// 核心目标：通过 litematicMenuItems 的调用契约、参数边界、回调绑定，
// 反推并暴露源码中的隐式假设与未校验路径。
// 每条 bug 以 `// BUG: ...` 在注释中标注，便于主模型/审阅者定位。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { litematicMenuItems } from "../litematic-adapter.ts";
import type { PreviewMenuItemDef } from "../preview-menu-defs.ts";

// ===== 测试夹具 =====

/** 构造一次符合 LitematicMenuRenderArgs 的 DOM 元素集合 */
function makeEls(): Parameters<typeof litematicMenuItems>[0] {
  return {
    sep: document.createElement("span"),
    axisLabel: document.createElement("span"),
    axisSel: document.createElement("select"),
    layerMode: document.createElement("select"),
    layerSlider: document.createElement("input"),
    layerInput: document.createElement("input"),
    layerSlider2: document.createElement("input"),
    layerInput2: document.createElement("input"),
  };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("litematicMenuItems — 菜单项结构契约", () => {
  it("返回数组长度恒为 1（分层切片面板）", () => {
    const items = litematicMenuItems(makeEls());
    expect(items.length).toBe(1);
  });

  it("返回项的固定字段与约定一致", () => {
    const items = litematicMenuItems(makeEls());
    const [item] = items;
    expect(item.id).toBe("slice");
    expect(item.icon).toBe("🧊");
    expect(item.labelKey).toBe("preview.sliceControl");
    expect(item.fallback).toBe("分层切片");
    expect(item.kind).toBe("panel");
    expect(item.dockGroup).toBe("model");
    expect(item.legacyTestId).toBe("litematic-slice-entry");
  });

  it("返回项无 run（panel 型只走 render）", () => {
    const [item] = litematicMenuItems(makeEls());
    expect(item.run).toBeUndefined();
  });

  it("返回项无 danger / sharedOnly / needsSiblings / requiresEnvironment", () => {
    const [item] = litematicMenuItems(makeEls());
    expect(item.danger).toBeUndefined();
    expect(item.sharedOnly).toBeUndefined();
    expect(item.needsSiblings).toBeUndefined();
    expect(item.requiresEnvironment).toBeUndefined();
  });
});

describe("litematicMenuItems — render 回调行为", () => {
  it("render 清空 list 内容后挂载 8 个控件元素（顺序固定）", () => {
    const els = makeEls();
    const [item] = litematicMenuItems(els);
    const list = document.createElement("div");
    // 预先塞入一个干扰子节点，验证 innerHTML="" 会清空
    list.appendChild(document.createElement("div"));
    expect(list.children.length).toBe(1);
    (item.render as (list: HTMLElement) => void)(list);
    expect(list.children.length).toBe(8);
    // 顺序：sep, axisLabel, axisSel, layerMode, layerSlider, layerInput, layerSlider2, layerInput2
    expect(list.children[0] === els.sep).toBe(true);
    expect(list.children[1] === els.axisLabel).toBe(true);
    expect(list.children[2] === els.axisSel).toBe(true);
    expect(list.children[3] === els.layerMode).toBe(true);
    expect(list.children[4] === els.layerSlider).toBe(true);
    expect(list.children[5] === els.layerInput).toBe(true);
    expect(list.children[6] === els.layerSlider2).toBe(true);
    expect(list.children[7] === els.layerInput2).toBe(true);
  });

  // BUG: P2 — render 回调签名与 PreviewMenuItemDef.render 契约不一致。
  // PreviewMenuItemDef.render 签名: (list: HTMLElement, closePopup: () => void) => void
  // 实际 render: (list: HTMLElement) => { ... }  只吃一个参数，closePopup 被静默丢弃。
  // 影响：如果 menu 框架以 (list, closePopup) 双参数调用，render 内的 this / 闭包不受影响，
  // 但 litematicMenuItems 永远拿不到 closePopup——无法主动关闭面板，且无法通过 closePopup 触达
  // 外层菜单生命周期钩子（例如面板关闭时清理焦点）。此处用第二个参数传一个哨兵函数验证忽略。
  it("BUG: render 回调第二个参数 closePopup 被静默忽略", () => {
    const els = makeEls();
    const [item] = litematicMenuItems(els);
    const list = document.createElement("div");
    const closeSpy = vi.fn();
    // 按 PreviewMenuItemDef.render 契约以双参数调用
    (item.render as (list: HTMLElement, closePopup: () => void) => void)(list, closeSpy);
    // render 内部没有消费 closePopup，因此 spy 永远不会被调用
    expect(closeSpy).not.toHaveBeenCalled();
  });

  // BUG: P2 — render 直接操作同一个 DOM 元素引用，重复调用 render 时只是移动元素
  // （appendChild 自动 detach）。若外层 menu 框架在相邻两次 render 之间对 list.children
  // 做了额外操作（例如插入 loading 遮罩），这些插入节点会在下一次 render 时被
  // innerHTML="" 一次性清空——render 与外部容器没有隔离，属隐式依赖。
  it("BUG: 重复 render 只是移动复用元素，中间插入的临时节点被丢弃", () => {
    const els = makeEls();
    const [item] = litematicMenuItems(els);
    const list = document.createElement("div");
    (item.render as (list: HTMLElement) => void)(list);
    // 在 render 后向 list 插入一个"临时遮罩"节点
    const overlay = document.createElement("div");
    overlay.dataset.temp = "1";
    list.appendChild(overlay);
    expect(list.querySelector('[data-temp="1"]')).not.toBeNull();
    // 第二次 render：innerHTML="" 会杀掉 overlay
    (item.render as (list: HTMLElement) => void)(list);
    expect(list.querySelector('[data-temp="1"]')).toBeNull();
    // 原有 8 个元素仍在
    expect(list.children.length).toBe(8);
  });

  // BUG: P2 — render 没有把 legacyTestId 挂到任何渲染出的 DOM 上，
  // 而 PreviewMenuItemDef.legacyTestId 的设计意图正是"渲染为 data-testid"。
  // 这导致 e2e 选择器 `data-testid="litematic-slice-entry"` 永远匹配不到真实 DOM。
  it("BUG: render 未挂载 legacyTestId 到任何子元素", () => {
    const els = makeEls();
    const [item] = litematicMenuItems(els);
    expect(item.legacyTestId).toBe("litematic-slice-entry");
    const list = document.createElement("div");
    (item.render as (list: HTMLElement) => void)(list);
    // 检查 render 出的 8 个元素中是否有 data-testid="litematic-slice-entry"
    const found = list.querySelector('[data-testid="litematic-slice-entry"]');
    expect(found).toBeNull(); // BUG: 期望应能匹配到
  });
});

describe("litematicMenuItems — 参数校验与防御", () => {
  // BUG: P1 — 传入 null / undefined 元素时 render 内部直接调 appendChild(null) 抛 TypeError。
  // litematicMenuItems 对入参完全无校验，buildLitematicScene 的调用点是安全的（永远传入真实 DOM），
  // 但若将来被其他调用方（例如测试夹具 / 未来新增的 litematic 变体）误用，会崩溃。
  it.each([
    { case: "sep 为 null", override: { sep: null } as any },
    { case: "axisLabel 为 null", override: { axisLabel: null } as any },
    { case: "axisSel 为 null", override: { axisSel: null } as any },
    { case: "layerMode 为 null", override: { layerMode: null } as any },
    { case: "layerSlider 为 null", override: { layerSlider: null } as any },
    { case: "layerInput 为 null", override: { layerInput: null } as any },
    { case: "layerSlider2 为 null", override: { layerSlider2: null } as any },
    { case: "layerInput2 为 null", override: { layerInput2: null } as any },
  ] as const)("BUG: render 在传入 $case 时抛 TypeError", ({ override }) => {
    const els = makeEls();
    Object.assign(els, override);
    const [item] = litematicMenuItems(els);
    const list = document.createElement("div");
    expect(() => (item.render as (list: HTMLElement) => void)(list)).toThrow(TypeError);
  });

  // BUG: P1 — 空对象传入时 render 直接对 8 个字段读，全部为 undefined，
  // 第一个 appendChild 就抛 TypeError。构造函数没有防御性兜底（例如用 document.createElement("span") 补默认值）。
  it("BUG: 空对象作为入参时 render 抛 TypeError", () => {
    const [item] = litematicMenuItems({} as any);
    const list = document.createElement("div");
    expect(() => (item.render as (list: HTMLElement) => void)(list)).toThrow(TypeError);
  });

  // BUG: P2 — 即使传入完整 8 个字段，render 也不检查元素类型。
  // 例如把 axisSel 传入一个普通 <div>，代码依旧 appendChild 它，不会抛错——
  // 但 <div> 没有 value / options / onchange 语义，buildLitematicScene 侧
  // 若以 HTMLSelectElement 使用它会静默失效（value 读取为空）。
  it("BUG: render 不校验元素类型——传入 <div> 冒充 axisSel 不报错", () => {
    const els = makeEls();
    const fakeSel = document.createElement("div");
    (els as any).axisSel = fakeSel;
    const [item] = litematicMenuItems(els);
    const list = document.createElement("div");
    // 不抛错：静默接受 <div>
    expect(() => (item.render as (list: HTMLElement) => void)(list)).not.toThrow();
    expect(list.children[2]).toBe(fakeSel);
  });

  // BUG: P2 — 多余字段被忽略，render 仅消费 8 个固定字段。
  it("多余字段被静默忽略（render 只消费 8 个固定字段）", () => {
    const els = makeEls();
    const extra = document.createElement("button");
    const [item] = litematicMenuItems({ ...els, extra } as any);
    const list = document.createElement("div");
    (item.render as (list: HTMLElement) => void)(list);
    expect(list.children.length).toBe(8);
    expect([...list.children].includes(extra)).toBe(false);
  });
});

describe("litematicMenuItems — 返回项可变性", () => {
  // NOTE: 非 bug — render 闭包捕获的是 `els` 对象引用（非各属性快照），
  // 因此外部修改 els.axisSel 后再次 render 确实会使用新元素。
  // 这反而使该函数"响应式"地复用元素——但代价是 buildLitematicScene 侧
  // 的事件监听器（.onchange / .oninput）绑定在旧元素上，元素替换后监听器失效。
  it("render 闭包捕获的是 els 对象引用，修改属性后 render 生效", () => {
    const els = makeEls();
    const [item] = litematicMenuItems(els);
    const list = document.createElement("div");
    (item.render as (list: HTMLElement) => void)(list);
    expect(list.children[2]).toBe(els.axisSel);

    const newAxisSel = document.createElement("select");
    newAxisSel.value = "Z";
    (els as any).axisSel = newAxisSel;

    // render 闭包读的是 els.axisSel 的当前值，会看到新元素
    (item.render as (list: HTMLElement) => void)(list);
    expect(list.children[2]).toBe(newAxisSel);
    // 旧元素的事件监听器（若有）已永久丢失——这是"闭包捕获对象引用"的副作用
  });

  // BUG: P2 — litematicMenuItems 是纯函数但返回的 item.render 有副作用（修改 DOM），
  // 且 render 依赖外部 mutable 状态（layerAxis/layerVal 在 buildLitematicScene 闭包中）。
  // 这使 render 本身不可纯测试——只能通过 DOM 元素属性间接验证，
  // 但 render 不设置任何 stateful 属性，只是搬运元素。
  it("render 幂等：连续两次调用后 list 的 8 个元素顺序不变", () => {
    const els = makeEls();
    const [item] = litematicMenuItems(els);
    const list = document.createElement("div");
    (item.render as (list: HTMLElement) => void)(list);
    const first = [...list.children];
    (item.render as (list: HTMLElement) => void)(list);
    const second = [...list.children];
    expect(second).toEqual(first);
  });
});

describe("litematicMenuItems — 返回项与 PreviewMenuItemDef 契约完整性", () => {
  // BUG: P1 — render 参数签名 (list) 与 PreviewMenuItemDef.render 的 (list, closePopup) 不一致。
  // TypeScript 不会报错（函数参数可省略），但在"契约"层面，适配器声明式菜单项
  // 无法响应菜单框架的 closePopup 回调。此处断言 render.length（JS 参数个数）与契约不符。
  it("BUG: render.length === 1 与 PreviewMenuItemDef.render 声明的参数个数 (2) 不一致", () => {
    const [item] = litematicMenuItems(makeEls());
    expect(item.render!.length).toBe(1); // 契约要求是 2
  });

  // BUG: P2 — item 没有 render 时 menu 框架会走 fillers 映射，litematicMenuItems
  // 总是设置 render——这个契约没问题。但 item 也没有提供 onRender / renderAfterMount
  // 之类的钩子让 buildLitematicScene 在 render 后注入 focus-trap / a11y 属性。
  it("render 回调存在且非 null（确保 panel 型必走适配器渲染）", () => {
    const [item] = litematicMenuItems(makeEls());
    expect(typeof item.render).toBe("function");
  });

  // BUG: P2 — 每个调用返回的都是一个新数组 + 一个新对象，无稳定引用。
  // 如果 menu 框架用 === 比较"是否同一菜单项"（例如判重、撤销重复注入），
  // 每次调用都会被认为是一个新项——可能造出重复的分层切片入口。
  it("BUG: 多次调用返回的对象引用不相等（无稳定标识）", () => {
    const els = makeEls();
    const itemsA = litematicMenuItems(els);
    const itemsB = litematicMenuItems(els);
    expect(itemsA).not.toBe(itemsB);
    expect(itemsA[0]).not.toBe(itemsB[0]);
    // 仅 id 相同（稳定标识）
    expect(itemsA[0].id).toBe(itemsB[0].id);
  });
});