// ===== <app-nav> 组件级测试（G-1 — ADR-035 / Design.md §19.1）=====
// 断言基于 data-testid 稳定钩子；交互验证 nav:change 事件 + nav:changed 高亮更新。
// 注意：nav:change 是请求事件（app-content 处理），nav:changed 是响应事件（app-nav 监听）。
// 单独挂载 app-nav 时 nav:change → nav:changed 链路无消费方，需直接发射 nav:changed 验证。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getByTestId, getAllByTestId, waitFor, sleep, mountCustomElement, unmountElement } from "../../test-utils/index.ts";
import { bus } from "../../bus.ts";

const { isViewerModeMock } = vi.hoisted(() => ({
  isViewerModeMock: vi.fn().mockReturnValue(false), // 默认桌面
}));

vi.mock("../../utils/dom/android-bridge.ts", () => ({
  isViewerMode: isViewerModeMock,
}));

// getApp 仅在 version 加载时调用，mock 阻断
vi.mock("../../backend/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({
    GetAppVersion: vi.fn().mockResolvedValue("v1.0.0"),
  }),
}));

import "./index.ts"; // 触发 customElements.define("app-nav")

describe("app-nav（testid 钩子 + 导航交互）", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.removeItem("nav_page");
    localStorage.removeItem("nav_collapsed");
    isViewerModeMock.mockReturnValue(false); // 默认桌面
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("connected → 渲染 6 个导航项（初始 active 同源 resolveInitialPage）", async () => {
    const el = mountCustomElement("app-nav");
    const root = el.shadowRoot!;
    await waitFor(() => getAllByTestId(root, "nav-item").length >= 6);
    const items = getAllByTestId(root, "nav-item");
    expect(items.length).toBe(6);
    // 构造器与 PageStore 同源：nav_page 未保存时默认 repository，首个导航项 active
    // （旧行为硬编码幽灵值 "dashboard"，无任何项 active——启动高亮缺失的根因）
    const active = items.filter((i) => i.classList.contains("active"));
    expect(active.length).toBe(1);
    expect((active[0] as HTMLElement).dataset.page).toBe("repository");
    unmountElement(el);
  });

  it("查看器模式隐藏整合包导航项；GitHub 已由桥接增强 Batch 2 启用（ADR-049）", async () => {
    isViewerModeMock.mockReturnValue(true); // Android/网页版
    const el = mountCustomElement("app-nav");
    const root = el.shadowRoot!;
    await waitFor(() => getAllByTestId(root, "nav-item").length >= 5);
    const items = getAllByTestId(root, "nav-item");
    expect(items.length).toBe(5); // repository/workshop/github/diagnostics/settings
    expect(items.some((i) => (i as HTMLElement).dataset.page === "instances")).toBe(false);
    expect(items.some((i) => (i as HTMLElement).dataset.page === "github")).toBe(true);
    expect(items.some((i) => (i as HTMLElement).dataset.page === "repository")).toBe(true);
    expect(items.some((i) => (i as HTMLElement).dataset.page === "settings")).toBe(true);
    unmountElement(el);
  });

  it("点击 nav-item → 发射 nav:change", async () => {
    const el = mountCustomElement("app-nav");
    const root = el.shadowRoot!;
    await waitFor(() => getAllByTestId(root, "nav-item").length >= 6);
    const spy = vi.fn();
    const offNav = bus.on("nav:change", spy);
    const items = getAllByTestId(root, "nav-item");
    (items[1] as HTMLElement).click(); // 点击第二个（整合包管理）
    expect(spy).toHaveBeenCalledWith({ page: "instances" });
    offNav();
    unmountElement(el);
  });

  it("nav:changed → 激活项高亮更新", async () => {
    const el = mountCustomElement("app-nav");
    const root = el.shadowRoot!;
    await waitFor(() => getAllByTestId(root, "nav-item").length >= 6);
    bus.emit("nav:changed", { page: "settings" });
    await sleep(50);
    const items = getAllByTestId(root, "nav-item");
    const active = items.filter((i) => i.classList.contains("active"));
    expect(active.length).toBe(1);
    expect((active[0] as HTMLElement).dataset.page).toBe("settings");
    unmountElement(el);
  });

  it("disconnected → 清理 nav:changed 订阅（P3 修复：原 expect(true) 恒真）", async () => {
    const el = mountCustomElement("app-nav");
    const root = el.shadowRoot!;
    await waitFor(() => getAllByTestId(root, "nav-item").length >= 6);
    // 卸载前初始 active 为 repository
    unmountElement(el);
    // 断开后发射：若订阅已清理，已卸载元素的高亮不应被更新（仍为 repository）
    bus.emit("nav:changed", { page: "settings" });
    await sleep(50);
    const active = getAllByTestId(root, "nav-item").filter((i) =>
      i.classList.contains("active"),
    );
    expect(active.length).toBe(1);
    expect((active[0] as HTMLElement).dataset.page).toBe("repository");
  });

  it("版本号最终渲染", async () => {
    const el = mountCustomElement("app-nav");
    const root = el.shadowRoot!;
    await waitFor(() => {
      const v = root.getElementById("nav-version");
      return v !== null && v.textContent !== "加载中…";
    });
    const version = root.getElementById("nav-version")!;
    expect(version.textContent).toContain("v1.0.0");
    unmountElement(el);
  });

  it("折叠按钮：点击折叠为窄条（data-collapsed + 持久化），再点展开恢复", async () => {
    const el = mountCustomElement("app-nav");
    const root = el.shadowRoot!;
    await waitFor(() => getAllByTestId(root, "nav-item").length >= 6);
    // 初始展开
    expect(el.hasAttribute("data-collapsed")).toBe(false);
    // 点击折叠
    (getByTestId(root, "nav-toggle") as HTMLElement).click();
    await sleep(50);
    expect(el.hasAttribute("data-collapsed")).toBe(true);
    expect(localStorage.getItem("nav_collapsed")).toBe("1");
    // 折叠态窄条上按钮仍常驻（防意外找不回导航）
    expect(root.querySelector(".nav-toggle")).not.toBeNull();
    // 再点展开
    (root.querySelector(".nav-toggle") as HTMLElement)!.click();
    await sleep(50);
    expect(el.hasAttribute("data-collapsed")).toBe(false);
    expect(localStorage.getItem("nav_collapsed")).toBe("0");
    unmountElement(el);
  });

  it("setCollapsed(persist=false) 折叠但不污染用户手动记忆", async () => {
    const el = mountCustomElement("app-nav");
    const root = el.shadowRoot!;
    await waitFor(() => getAllByTestId(root, "nav-item").length >= 6);
    (el as unknown as { setCollapsed(c: boolean, p?: boolean): void }).setCollapsed(true, false);
    await sleep(50);
    expect(el.hasAttribute("data-collapsed")).toBe(true);
    // 不落盘：localStorage 仍为空
    expect(localStorage.getItem("nav_collapsed")).toBeNull();
    unmountElement(el);
  });

  it("点击「🧭 导航栏」整行也能折叠（扩大触发区，label 可点）", async () => {
    const el = mountCustomElement("app-nav");
    const root = el.shadowRoot!;
    await waitFor(() => getAllByTestId(root, "nav-item").length >= 6);
    expect(el.hasAttribute("data-collapsed")).toBe(false);
    // 点击 label 而非箭头按钮——事件挂在整行 menu-head 上
    (root.querySelector(".menu-label") as HTMLElement).click();
    await sleep(50);
    expect(el.hasAttribute("data-collapsed")).toBe(true);
    unmountElement(el);
  });
});