// ===== loadCommunityData 集成测试 =====
// 覆盖：本地作者合并（type 分号分段去重）、失败降级（全链 / 单绑定）
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mocks } = vi.hoisted(() => {
  const mocks = {
    DefaultWorkshopSites: vi.fn(),
    LoadWorkshopCreators: vi.fn(),
    ListModelAuthors: vi.fn(),
    ScanLocalAuthors: vi.fn(),
    resolveWebMode: vi.fn().mockReturnValue(false), // 默认桌面
  };
  return { mocks };
});

vi.mock("../../wails/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({
    DefaultWorkshopSites: mocks.DefaultWorkshopSites,
    LoadWorkshopCreators: mocks.LoadWorkshopCreators,
    ListModelAuthors: mocks.ListModelAuthors,
    ScanLocalAuthors: mocks.ScanLocalAuthors,
    SaveWorkshopCreatorsBySite: vi.fn(),
  }),
}));

vi.mock("../../wails/platform.ts", () => ({
  resolveWebMode: mocks.resolveWebMode,
}));

vi.mock("../../utils/debug/debug.ts", () => ({
  dbg: vi.fn(),
}));

import { loadCommunityData } from "./community-data.ts";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveWebMode.mockReturnValue(false); // 默认桌面
  // 切断 tryAutoMergeCommunity 的真实网络依赖：fetchCommunityCreators 三路回退
  // 每路 8s 超时，不 stub 会让 CI/无网环境挂起、有网时异步改 data.creators 产生
  // 环境相关非确定性。stub 后后台合并路径返回空、静默结束。
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
  // 默认空数据
  mocks.DefaultWorkshopSites.mockResolvedValue([{ id: "bilibili" }]);
  mocks.LoadWorkshopCreators.mockResolvedValue([]);
  mocks.ListModelAuthors.mockResolvedValue([]);
  mocks.ScanLocalAuthors.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadCommunityData", () => {
  it("本地作者 type 与现有 type 分段去重（子串不误判）", async () => {
    mocks.LoadWorkshopCreators.mockResolvedValue([
      { name: "A", type: "bilibili" },
    ]);
    mocks.ScanLocalAuthors.mockResolvedValue([
      { name: "A", type: "bili" }, // "bilibili" 的子串，原 includes 实现会误判已包含
    ]);

    const data = await loadCommunityData();

    const a = data.creators.find((c) => c.name === "A");
    expect(a?.type).toBe("bilibili;bili");
    expect(a?._fromLocal).toBe(true);
  });

  it("已存在的 type 不重复追加", async () => {
    mocks.LoadWorkshopCreators.mockResolvedValue([
      { name: "A", type: "bilibili;x" },
    ]);
    mocks.ScanLocalAuthors.mockResolvedValue([
      { name: "A", type: "x" },
    ]);

    const data = await loadCommunityData();

    const a = data.creators.find((c) => c.name === "A");
    expect(a?.type).toBe("bilibili;x");
  });

  it("本地独有作者追加为 _fromLocal 条目", async () => {
    mocks.ScanLocalAuthors.mockResolvedValue([
      { name: "新作者", desc: "本地描述" },
    ]);

    const data = await loadCommunityData();

    const c = data.creators.find((x) => x.name === "新作者");
    expect(c?._fromLocal).toBe(true);
    expect(c?.desc).toBe("本地描述");
  });

  it("Go 绑定失败 → 降级为空数据不抛", async () => {
    mocks.DefaultWorkshopSites.mockRejectedValue(new Error("net down"));
    const data = await loadCommunityData();
    expect(data.sites).toEqual([]);
    expect(data.creators).toEqual([]);
  });

  it("仅 ScanLocalAuthors 失败 → 其余绑定正常加载，本地作者视为空（单绑定降级）", async () => {
    mocks.ScanLocalAuthors.mockRejectedValue(new Error("scan fail"));
    mocks.LoadWorkshopCreators.mockResolvedValue([{ name: "A", type: "bilibili" }]);

    const data = await loadCommunityData();

    expect(data.sites).toEqual([{ id: "bilibili" }]);
    expect(data.creators).toEqual([{ name: "A", type: "bilibili" }]);
    expect(data.creators.find((c) => c.name === "A")?._fromLocal).toBeUndefined();
  });

  it("网页版（resolveWebMode=true）桥接增强 Batch 2：经 Go binding（adapter）加载 bundled 默认，不绕道 GitHub 拉取", async () => {
    mocks.resolveWebMode.mockReturnValue(true);
    // 绑定返回 bundled 默认（网页版由 browser-adapter 桥接，见 ADR-049 Batch 2）
    mocks.DefaultWorkshopSites.mockResolvedValue([{ id: "bilibili", url: "https://bili.test", label: "B站" }]);
    mocks.LoadWorkshopCreators.mockResolvedValue([{ name: "A", type: "bilibili" }]);
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: async () => [] }));
    vi.stubGlobal("fetch", fetchMock);

    const data = await loadCommunityData();

    // 网页版不再走 GitHub 拉取旁路，而是经桥接的 Go binding 读取 bundled 默认
    expect(mocks.DefaultWorkshopSites).toHaveBeenCalled();
    expect(mocks.LoadWorkshopCreators).toHaveBeenCalled();
    expect(data.sites).toEqual([{ id: "bilibili", url: "https://bili.test", label: "B站" }]);
    expect(data.creators.find((c) => c.name === "A")).toBeDefined();
  });
});
