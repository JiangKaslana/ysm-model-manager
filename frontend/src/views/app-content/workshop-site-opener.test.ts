// ===== openSite 站点打开器单测（透传 targetUrl 回归）=====
// 背景：搜索按钮拼好的带词链接经 ctx.openUrl 转发，但实现曾丢弃 url 只按 site.url 打开，
// 导致「所有站点搜索退化为只开首页」。本文件锁定 openSite 必须把 targetUrl 真传给各打开分支。
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../backend/app.ts", () => ({
  getApp: vi.fn(),
}));

import { getApp } from "../../backend/app.ts";
import { openSite } from "./workshop-site-opener.ts";
import type { AppContentHost } from "./init-workshop.ts";

/** 组装 openEmbedded 分支需要的假 host（shadow DOM 节点直供） */
function makeHost() {
  const nodes: Record<string, any> = {
    "ws-iframe": { style: {}, src: "", onload: null },
    "ws-url": { textContent: "" },
    "ws-browser": { style: {} },
    "ws-blocked": { style: {} },
  };
  const host = {
    _root: { getElementById: (id: string) => nodes[id] ?? null },
  } as unknown as AppContentHost;
  return { host, nodes };
}

function makeApp() {
  return { OpenInBrowser: vi.fn(), NavigatePlazaWindow: vi.fn() };
}

/** 冲刷 getApp().then 的微任务 */
async function flush() {
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  vi.clearAllMocks();
  const app = makeApp();
  (getApp as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(app);
  return app;
});

const site = { id: "github", url: "https://github.com/", label: "GitHub" } as any;

describe("openSite — 透传 targetUrl", () => {
  it("外链模式：无 targetUrl → OpenInBrowser(site.url)", async () => {
    const app = makeApp();
    (getApp as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(app);
    openSite(makeHost().host, site, "external");
    await flush();
    expect(app.OpenInBrowser).toHaveBeenCalledWith("https://github.com/");
  });

  it("外链模式：带 targetUrl → OpenInBrowser(targetUrl)，而非 site.url（回归：搜索带词链接被丢弃）", async () => {
    const app = makeApp();
    (getApp as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(app);
    const target = "https://github.com/search?q=%E5%B0%8F%E7%BA%A2";
    openSite(makeHost().host, site, "external", target);
    await flush();
    expect(app.OpenInBrowser).toHaveBeenCalledWith(target);
    expect(app.OpenInBrowser).not.toHaveBeenCalledWith(site.url);
  });

  it("窗口模式：带 targetUrl → NavigatePlazaWindow(targetUrl, true)", async () => {
    const app = makeApp();
    (getApp as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(app);
    const target = "https://github.com/search?q=foo";
    openSite(makeHost().host, site, "window", target);
    await flush();
    expect(app.NavigatePlazaWindow).toHaveBeenCalledWith(target, true);
  });

  it("内嵌模式：带 targetUrl → iframe.src 与地址栏都落实到 targetUrl", () => {
    const { host, nodes } = makeHost();
    const target = "https://github.com/search?q=bar";
    openSite(host, site, "embed", target);
    expect(nodes["ws-iframe"].src).toBe(target);
    expect(nodes["ws-url"].textContent).toBe(target);
  });

  it("内嵌模式：无 targetUrl → iframe.src 用 site.url", () => {
    const { host, nodes } = makeHost();
    openSite(host, site, "embed");
    expect(nodes["ws-iframe"].src).toBe(site.url);
  });
});