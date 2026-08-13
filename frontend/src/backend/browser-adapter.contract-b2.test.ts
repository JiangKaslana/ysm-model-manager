// ===== B2 社区/工坊契约测试（反推源码问题）=====
// 对照 Go 真实契约 internal/app/app_workshop.go，校验网页桥接（browser-adapter.ts）
// 中 LoadWorkshopCreators / SaveWorkshopCreators / LoadGitHubRepos /
// DefaultWorkshopSites / SaveWorkshopSites 的 bundled 默认 + localStorage 覆盖层
// 行为是否与 Go 契约一致。本文件只新增、不改源码。
//
// Go 契约速查（internal/app/app_workshop.go）：
//   DefaultWorkshopSites : 用户配置 workshop_sites.json > 内联 bundled > 硬编码 defaultWorkshopSites() (3 站)
//   SaveWorkshopSites    : 整体覆盖写盘（签名 []WorkshopSite，无 null）
//   LoadWorkshopCreators : 用户配置 creators.json > 内联 bundled > nil
//   SaveWorkshopCreators : 整体覆盖写盘（签名 []WorkshopCreator，无 null）
//   LoadGitHubRepos      : 用户配置 workshop-github.json > 内联 bundled > nil  ← 可被用户覆盖！
// 关键差异：Go 全部从「用户配置目录优先」读取，覆盖层存在于磁盘；网页版仅创作者/站点
// 有 localStorage 覆盖层，GitHub 仓库列表无任何覆盖层（纯 bundled 只读）。
import { describe, it, expect, vi, beforeEach } from "vitest";
import { browserAdapter } from "./browser-adapter.ts";

// 复刻 harness：idb 层内存实现 + vi.mock；localStorage 由 happy-dom 提供。
const idbMock = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  return {
    idbGet: vi.fn(async (_s: string, k: string) => store.get(k)),
    idbSet: vi.fn(async (_s: string, k: string, v: unknown) => {
      store.set(k, v);
    }),
    idbKeys: vi.fn(async (_s: string, prefix: string) =>
      [...store.keys()].filter((k) => k.startsWith(prefix)),
    ),
    idbDel: vi.fn(async (_s: string, k: string) => {
      store.delete(k);
    }),
    _store: store,
  };
});

vi.mock("./idb.ts", () => ({
  idbGet: idbMock.idbGet,
  idbSet: idbMock.idbSet,
  idbKeys: idbMock.idbKeys,
  idbDel: idbMock.idbDel,
}));

// 各覆盖层 key（与 browser-adapter.ts 中保持一致，供测试直接探查）。
const WEB_CREATORS_KEY = "web:workshop-creators";
const WEB_SITES_KEY = "web:workshop-sites";
// 注意：网页版根本没有为 GitHub 仓库定义覆盖层 key（Go 侧却有 workshop-github.json 覆盖）。

beforeEach(() => {
  vi.clearAllMocks();
  idbMock._store.clear();
  localStorage.clear();
});

describe("B2 契约：LoadWorkshopCreators — 覆盖层优先级", () => {
  it("无覆盖层时返回 bundled 默认（非空、含 name/desc）", async () => {
    const c = (await browserAdapter.LoadWorkshopCreators()) as Array<{ name: string; desc: string }>;
    expect(Array.isArray(c)).toBe(true);
    expect(c.length).toBeGreaterThan(0);
    expect(typeof c[0].name).toBe("string");
    expect(typeof c[0].desc).toBe("string");
  });

  it("有覆盖层时返回覆盖值（覆盖优先于 bundled，对齐 Go 用户配置优先）", async () => {
    const custom = [{ name: "测试作者", desc: "单测注入", type: "bilibili" }];
    localStorage.setItem(WEB_CREATORS_KEY, JSON.stringify(custom));
    const got = (await browserAdapter.LoadWorkshopCreators()) as Array<{ name: string }>;
    expect(got).toHaveLength(1);
    expect(got[0].name).toBe("测试作者");
  });

  it("覆盖层 JSON 损坏 → 回退 bundled 不抛错（对齐 Go 读取失败回退 bundled）", async () => {
    localStorage.setItem(WEB_CREATORS_KEY, "{broken json");
    const c = (await browserAdapter.LoadWorkshopCreators()) as Array<unknown>;
    expect(c.length).toBeGreaterThan(0);
  });

  it("返回值为深拷贝：外部 mutate 不影响后续 Load（对齐 Go 每次重新反序列化）", async () => {
    const a = (await browserAdapter.LoadWorkshopCreators()) as Array<{ name: string }>;
    const len = a.length;
    a.push({ name: "被污染" } as never);
    const b = (await browserAdapter.LoadWorkshopCreators()) as Array<{ name: string }>;
    expect(b.length).toBe(len);
  });

  // Go 契约偏离点（不抛失败，仅记录）：Go LoadWorkshopCreators 在 bundled 缺失/损坏时
  // 返回 nil（app_workshop.go:164）；网页版始终返回 bundled 数组（永不 null）。
  // 因 bundled 在 build 期内联，实践中等价；但契约形态不同，属低危偏差。
});

describe("B2 契约：SaveWorkshopCreators / SaveWorkshopSites — 写入与重置", () => {
  it("SaveWorkshopCreators(data) 后 LoadWorkshopCreators 返回新值", async () => {
    const custom = [{ name: "新作者", desc: "x", type: "bilibili" }];
    await browserAdapter.SaveWorkshopCreators(custom as never);
    const got = (await browserAdapter.LoadWorkshopCreators()) as Array<{ name: string }>;
    expect(got).toHaveLength(1);
    expect(got[0].name).toBe("新作者");
  });

  it("SaveWorkshopSites(data) 后 DefaultWorkshopSites 返回新值（覆盖优先）", async () => {
    const custom = [{ id: "mysite", icon: "⭐", label: "我的站", url: "https://x.test", desc: "t", group: "search" }];
    await browserAdapter.SaveWorkshopSites(custom as never);
    const got = (await browserAdapter.DefaultWorkshopSites()) as Array<{ id: string }>;
    expect(got).toHaveLength(1);
    expect(got[0].id).toBe("mysite");
  });

  it("SaveWorkshopCreators(null) 重置覆盖层 → 回退 bundled（网页版自身约定）", async () => {
    await browserAdapter.SaveWorkshopCreators([{ name: "临时", desc: "x", type: "b" }] as never);
    await browserAdapter.SaveWorkshopCreators(null);
    const got = (await browserAdapter.LoadWorkshopCreators()) as Array<{ name: string }>;
    expect(got.length).toBeGreaterThan(1); // bundled 默认远大于 1
  });

  it("SaveWorkshopSites(null) 重置覆盖层 → 回退 bundled（网页版自身约定）", async () => {
    await browserAdapter.SaveWorkshopSites([{ id: "x", url: "https://x.test" }] as never);
    await browserAdapter.SaveWorkshopSites(null);
    const got = (await browserAdapter.DefaultWorkshopSites()) as Array<{ id: string }>;
    expect(got.length).toBeGreaterThan(1);
  });

  // 契约偏离（不抛失败，仅记录）：Go SaveWorkshopCreators/SaveWorkshopSites 签名为
  // 非空切片，无 null 重置语义；重置走 ResetWorkshopConfigs（app_workshop.go:217）。
  // 网页版 SaveX(null) 是额外约定，非 Go 契约。属设计性偏差，非源码 bug。
});

describe("B2 契约：DefaultWorkshopSites — 恒返回站点列表", () => {
  it("默认返回 bundled 站点（含 id/url，非空）", async () => {
    const s = (await browserAdapter.DefaultWorkshopSites()) as Array<{ id: string; url: string }>;
    expect(Array.isArray(s)).toBe(true);
    expect(s.length).toBeGreaterThan(0);
    expect(typeof s[0].id).toBe("string");
    expect(typeof s[0].url).toBe("string");
  });

  it("覆盖层损坏 → 回退 bundled 不抛错", async () => {
    localStorage.setItem(WEB_SITES_KEY, "{broken");
    const s = (await browserAdapter.DefaultWorkshopSites()) as Array<unknown>;
    expect(s.length).toBeGreaterThan(0);
  });

  it("返回值为深拷贝：外部 mutate 不影响后续调用", async () => {
    const a = (await browserAdapter.DefaultWorkshopSites()) as Array<{ id: string }>;
    const len = a.length;
    a.push({ id: "污染" } as never);
    const b = (await browserAdapter.DefaultWorkshopSites()) as Array<{ id: string }>;
    expect(b.length).toBe(len);
  });
});

describe("B2 契约：LoadGitHubRepos — 覆盖层缺口（真实偏差）", () => {
  it("Go 契约：LoadGitHubRepos 应优先读取用户覆盖（workshop-github.json）；网页版须提供覆盖层", async () => {
    // 模拟用户编辑了 GitHub 仓库列表（对照 Go 用户配置优先语义）
    const custom = [{ name: "user/repo-custom", desc: "用户覆盖", type: "github" }];
    // 网页版若有覆盖层，应使用与创作者/站点同构的 key（此处探测 web:github-repos）
    localStorage.setItem("web:github-repos", JSON.stringify(custom));

    const got = (await browserAdapter.LoadGitHubRepos()) as Array<{ name: string }>;
    // 期望：若网页版实现了覆盖层，应返回用户覆盖；当前实现硬编码 bundled，
    // 此断言将失败 → 暴露「网页版缺少 GitHub 仓库覆盖层」这一真实缺口。
    expect(got.some((r) => r.name === "user/repo-custom")).toBe(true);
  });

  it("LoadGitHubRepos 返回 bundled 列表（非 null、type=github）— 既有正确性基线", async () => {
    const r = (await browserAdapter.LoadGitHubRepos()) as Array<{ name: string; type: string }>;
    expect(Array.isArray(r)).toBe(true);
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].type).toBe("github");
  });
});
