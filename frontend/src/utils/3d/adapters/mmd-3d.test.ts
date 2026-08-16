// ===== mmd-3d 薄包装测试 =====
// 覆盖：resolveMmdSiblings（GetRepoRoot 类型根 → ScanModelEntries 主文件 Path 列表，
// filter .pmx/.pmd；根为空/扫描失败 → []，下拉不渲染）。
import { describe, it, expect, vi, beforeEach } from "vitest";

const { getAppMock, getRepoRootMock, scanEntriesMock } = vi.hoisted(() => ({
  getAppMock: vi.fn(),
  getRepoRootMock: vi.fn(),
  scanEntriesMock: vi.fn(),
}));
vi.mock("../../../backend/app.ts", () => ({ getApp: getAppMock }));
vi.mock("../../../utils/resource/types.ts", () => ({
  RESOURCE_TYPES: { MMD: "mmd-skin" },
}));
vi.mock("./mount-preview-core.ts", () => ({
  mount3D: vi.fn(),
  cleanupPreview: vi.fn(),
  invalidatePreview: vi.fn(),
}));

import { resolveMmdSiblings } from "./mmd-3d.ts";

beforeEach(() => {
  vi.clearAllMocks();
  getAppMock.mockResolvedValue({
    GetRepoRoot: getRepoRootMock,
    ScanModelEntries: scanEntriesMock,
  });
});

describe("resolveMmdSiblings", () => {
  it("GetRepoRoot 类型根 → ScanModelEntries 主文件 Path 列表（filter .pmx/.pmd）", async () => {
    getRepoRootMock.mockResolvedValue("/mmd-root");
    scanEntriesMock.mockResolvedValue([
      { Name: "a.pmx", Path: "/mmd-root/模型A/a.pmx" },
      { Name: "b.pmd", Path: "/mmd-root/模型B/b.pmd" },
      { Name: "readme.txt", Path: "/mmd-root/模型C/readme.txt" },
    ]);
    expect(await resolveMmdSiblings()).toEqual([
      "/mmd-root/模型A/a.pmx",
      "/mmd-root/模型B/b.pmd",
    ]);
    expect(getRepoRootMock).toHaveBeenCalledWith("mmd-skin");
    expect(scanEntriesMock).toHaveBeenCalledWith("/mmd-root");
  });

  it("根为空 / 扫描失败 → []（下拉不渲染，不阻断）", async () => {
    getRepoRootMock.mockResolvedValue("");
    expect(await resolveMmdSiblings()).toEqual([]);
    getRepoRootMock.mockResolvedValue("/mmd-root");
    scanEntriesMock.mockRejectedValue(new Error("scan fail"));
    expect(await resolveMmdSiblings()).toEqual([]);
  });
});
