// ===== sidebar 卡片事件绑定测试 =====
// 覆盖：list 复用（renderVersionCards 只清 innerHTML 不替换 #vg）时，
// 旧 handler 闭包仍读到最新 instances（P2 数据陈旧回归）
import { describe, it, expect, vi, beforeEach } from "vitest";

const { emitMock } = vi.hoisted(() => ({
  emitMock: vi.fn(),
}));

vi.mock("../../bus.ts", () => ({ bus: { emit: emitMock, on: vi.fn() } }));
vi.mock("./tpl.ts", () => ({
  vcHeaderHTML: () => '<div class="vc-header"><div class="name"></div></div>',
}));
// bindFooter 的 btn-mc 检测走 getApp → 动态 import bindings：mock 阻断
// Wails runtime（getApp 在 node/jsdom 下 window.go 不存在 → 走动态 import 路径）
vi.mock("../../../bindings/ysm-model-manager/internal/app/app.js", () => ({
  LoadAppConfig: vi.fn().mockResolvedValue({ mcRoot: "/mc", filesRoot: "", resourcepackRoot: "", linkMode: "copy" }),
  GetMinecraftPaths: vi.fn().mockResolvedValue([]),
  SaveAppConfig: vi.fn().mockResolvedValue(undefined),
}));

import { bindCardEvents, bindFooter, resetSelectedEmit } from "./events.ts";
import { renderVersionCards } from "./render.ts";
import { waitFor } from "../../test-utils/index.ts";
import type { SidebarInstance } from "./data.ts";

function instance(name: string): SidebarInstance {
  return {
    name,
    dir: "/mc/instances/" + name,
    exists: true,
    hasMod: true,
    status: "complete",
    synced: 1,
    missing: 0,
    extra: 0,
    disabled: 0,
    rtype: "ysm",
    variantGroups: null,
    _missingPaths: [],
    _extraPaths: [],
    items: { synced: [] },
  };
}

function mount(instances: SidebarInstance[]) {
  const host = document.createElement("div");
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = '<div class="list" id="vg"></div>';
  const container = root.getElementById("vg")!;
  renderVersionCards(container, instances);
  const cleanup = bindCardEvents(root, instances);
  return { root, container, cleanup };
}

beforeEach(() => {
  emitMock.mockClear();
  localStorage.clear();
  resetSelectedEmit(); // 隔离模块级 _lastEmittedPkg 状态（P3 补测：去重状态机跨用例不串）
});

describe("bindCardEvents — list 复用数据陈旧回归（P2）", () => {
  it("reload 后 #vg 未替换时点击仍用最新 instances", () => {
    const A = [instance("A1"), instance("A2")];
    const { container } = mount(A);

    // 首次点击 → 用 A 数据
    (container.querySelector(".vc-header") as HTMLElement).click();
    expect(emitMock).toHaveBeenLastCalledWith("package:selected", A[0]);

    // 模拟 _reload：同一容器重渲染（#vg 元素不变）+ 重新绑定（走 list 复用早退分支）
    const B = [instance("B1"), instance("B2")];
    renderVersionCards(container, B);
    bindCardEvents(container.getRootNode() as ShadowRoot, B);

    // 修复前：旧闭包捕获首次的 A 数组 → 点击 emit A[0]（陈旧）；
    // 修复后：currentInstances 已更新为 B → emit B[0]
    (container.querySelector(".vc-header") as HTMLElement).click();
    expect(emitMock).toHaveBeenLastCalledWith("package:selected", B[0]);
  });
});

// P3 补测（code_review）：_lastEmittedPkg 去重状态机——该逻辑已两次回归
// （每次 reload 重发 / 每次 reload 复位致去重恒真失效），此前零测试覆盖。
// 现契约：同实例 reload 不重发、resetSelectedEmit（disconnectedCallback）后新挂载重发、
// rtype 切换（emitKey 含 rtype）重发。
describe("restoreSelectedCard 去重状态机（P2 复核修复回归护栏）", () => {
  // restoreSelectedCard 的 emit 在 requestAnimationFrame 回调中延迟执行——
  // 断言前必须先 flush rAF，否则 emit 尚未发生
  const flushRaf = (): Promise<void> =>
    new Promise((resolve) => requestAnimationFrame(() => resolve()));

  function mountWithSavedSelection(name: string) {
    localStorage.setItem("sb_selectedName_ysm", name);
    return mount([instance(name), instance("Other")]);
  }

  it("同实例 reload（list 替换重绑）不重复 emit package:selected", async () => {
    mountWithSavedSelection("A1");
    await flushRaf();
    expect(emitMock).toHaveBeenCalledTimes(1);

    // 模拟 _reload：同一组件重绑（cleanup 已置空 _lastList → 走 list 替换分支）
    mountWithSavedSelection("A1");
    await flushRaf();
    expect(emitMock).toHaveBeenCalledTimes(1); // 去重跨 reload 生效：不得再次 emit
  });

  it("resetSelectedEmit（disconnectedCallback 语义）后新挂载重新 emit", async () => {
    mountWithSavedSelection("A1");
    await flushRaf();
    expect(emitMock).toHaveBeenCalledTimes(1);

    resetSelectedEmit(); // 模拟组件卸载
    mountWithSavedSelection("A1");
    await flushRaf();
    expect(emitMock).toHaveBeenCalledTimes(2); // 新挂载会话重新 emit
  });

  // P2-1 补测：点击路径的去重状态机同步——点击卡片后若触发 reload，
  // restoreSelectedCard 不得再次 emit（修复前点击不更新 _lastEmittedPkg，
  // reload 读到 localStorage 恢复选中 → 去重恒真失效 → 重发 package:selected）
  it("点击卡片后 reload 不重复 emit（P2-1 点击路径同步去重状态）", async () => {
    const { container } = mount([instance("B1"), instance("B2")]);
    // 点击卡片 → emit 一次 + localStorage 记录
    (container.querySelectorAll(".vc-header")[0] as HTMLElement).click();
    expect(emitMock).toHaveBeenCalledTimes(1);
    expect(emitMock).toHaveBeenLastCalledWith("package:selected", instance("B1"));

    // 模拟点击触发的 reload：新绑定走 restoreSelectedCard 恢复选中（localStorage 有 B1）
    mount([instance("B1"), instance("B2")]);
    await flushRaf();
    // 修复前：reload 后 restoreSelectedCard 再次 emit（共 2 次）；修复后：点击已同步去重状态 → 仍 1 次
    expect(emitMock).toHaveBeenCalledTimes(1);
  });

  it("rtype 切换（不同 emitKey）重新 emit", async () => {
    localStorage.setItem("sb_selectedName_ysm", "A1");
    mount([instance("A1")]);
    await flushRaf();
    expect(emitMock).toHaveBeenCalledTimes(1);

    // 切到另一 rtype：savedName key 不同 → emitKey 不同 → 重发
    localStorage.setItem("sb_selectedName_resourcepack", "RP1");
    const rp = instance("RP1");
    rp.rtype = "resourcepack";
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = '<div class="list" id="vg"></div>';
    const container = root.getElementById("vg")!;
    renderVersionCards(container, [rp]);
    bindCardEvents(root, [rp]);
    await flushRaf();
    expect(emitMock).toHaveBeenCalledTimes(2);
    void container;
  });
});

// P3 补测（审核）：原绑定状态为模块级共享变量（_lastList/_clickHandler/currentInstances），
// 多实例并存时 A 重绑会移除 B 的监听、点击数据被 B 覆盖（幽灵状态）。修复后状态收敛到
// 每 ShadowRoot 的 WeakMap，实例间互不干扰。
describe("bindCardEvents — 多实例并存互不干扰（模块级状态收敛回归）", () => {
  it("A 重绑不移除 B 的监听，B 点击仍 emit 自己的数据", () => {
    const A = mount([instance("A1")]);
    const B = mount([instance("B1")]);
    // 模拟 A 的 _reload：同一容器重渲染 + 重新绑定
    renderVersionCards(A.container, [instance("A2")]);
    bindCardEvents(A.container.getRootNode() as ShadowRoot, [instance("A2")]);
    // B 的监听必须仍然有效，且点击读到的是 B 的实例数据
    (B.container.querySelector(".vc-header") as HTMLElement).click();
    expect(emitMock).toHaveBeenLastCalledWith("package:selected", instance("B1"));
  });
});

// P4 补测（审核）：bindFooter（底部统计 + MC 根目录检测）此前零测试覆盖
describe("bindFooter", () => {
  function mountFooter() {
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML =
      '<div class="footer-stats"><span class="stat-item" id="stat-sync">完全同步 -/-</span></div>' +
      '<button class="btn-mc-dir" id="btn-mc">🎮 未设置</button>';
    return { root };
  }

  it("部分同步 → stat-sync 显示 synced/total", () => {
    const { root } = mountFooter();
    const partial = instance("A");
    partial.missing = 1;
    const full = instance("B");
    bindFooter(root, [partial, full]);
    expect(root.getElementById("stat-sync")!.textContent).toBe("完全同步 1/2");
  });

  it("全部同步 → stat-sync 显示 total/total", () => {
    const { root } = mountFooter();
    bindFooter(root, [instance("A"), instance("B")]);
    expect(root.getElementById("stat-sync")!.textContent).toBe("完全同步 2/2");
  });

  it("空实例 → stat-sync 保持占位不动（不写 -/-）", () => {
    const { root } = mountFooter();
    bindFooter(root, []);
    expect(root.getElementById("stat-sync")!.textContent).toBe("完全同步 -/-");
  });

  it("mcRoot 已配置 → 按钮显示路径", async () => {
    const app = await import("../../../bindings/ysm-model-manager/internal/app/app.js");
    (app.LoadAppConfig as ReturnType<typeof vi.fn>).mockResolvedValue({
      mcRoot: "/mc/root",
      filesRoot: "/f",
      resourcepackRoot: "/r",
      linkMode: "copy",
    });
    const { root } = mountFooter();
    bindFooter(root, []);
    await waitFor(() =>
      expect((root.getElementById("btn-mc") as HTMLElement).textContent).toBe("🎮 /mc/root"),
    );
  });

  it("未配置且无检测路径 → 按钮保持未设置", async () => {
    const app = await import("../../../bindings/ysm-model-manager/internal/app/app.js");
    (app.LoadAppConfig as ReturnType<typeof vi.fn>).mockResolvedValue({ mcRoot: "" });
    (app.GetMinecraftPaths as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const { root } = mountFooter();
    bindFooter(root, []);
    await waitFor(() => expect(app.GetMinecraftPaths).toHaveBeenCalled());
    expect((root.getElementById("btn-mc") as HTMLElement).textContent).toBe("🎮 未设置");
  });

  it("未配置但有检测路径 → 自动使用第一个路径并保存配置", async () => {
    const app = await import("../../../bindings/ysm-model-manager/internal/app/app.js");
    (app.LoadAppConfig as ReturnType<typeof vi.fn>).mockResolvedValue({
      mcRoot: "",
      filesRoot: "/f",
      resourcepackRoot: "/r",
      linkMode: "copy",
    });
    (app.GetMinecraftPaths as ReturnType<typeof vi.fn>).mockResolvedValue(["/detected"]);
    const { root } = mountFooter();
    bindFooter(root, []);
    await waitFor(() =>
      expect((root.getElementById("btn-mc") as HTMLElement).textContent).toBe("🎮 /detected"),
    );
    expect(app.SaveAppConfig).toHaveBeenCalled();
  });
});
