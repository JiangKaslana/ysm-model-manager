// @vitest-environment node
// ===== 同类型候选列表通用底座测试 =====
// 覆盖：resolveSiblingsByType（GetRepoRoot(rtype) → ScanModelEntries(root) →
// 按 extRe 过滤；根为空 / 扫描失败 → []，下拉不渲染）。
import { describe, it, expect, vi, beforeEach } from "vitest";

const { getAppMock, getRepoRootMock, scanEntriesMock } = vi.hoisted(() => ({
  getAppMock: vi.fn(),
  getRepoRootMock: vi.fn(),
  scanEntriesMock: vi.fn(),
}));
vi.mock("../../backend/app.ts", () => ({ getApp: getAppMock }));

import { resolveSiblingsByType } from "./siblings.ts";

beforeEach(() => {
  vi.clearAllMocks();
  getAppMock.mockResolvedValue({
    GetRepoRoot: getRepoRootMock,
    ScanModelEntries: scanEntriesMock,
  });
});

describe("resolveSiblingsByType", () => {
  it("GetRepoRoot(rtype) → ScanModelEntries(root) → 按 extRe 过滤（含大小写）", async () => {
    getRepoRootMock.mockResolvedValue("/root");
    scanEntriesMock.mockResolvedValue([
      { Path: "/root/a.fbx" },
      { Path: "/root/b.pmx" },
      { Path: "/root/c.FBX" },
    ]);
    expect(await resolveSiblingsByType("fbx", /\.fbx$/i)).toEqual([
      "/root/a.fbx",
      "/root/c.FBX",
    ]);
    expect(getRepoRootMock).toHaveBeenCalledWith("fbx");
    expect(scanEntriesMock).toHaveBeenCalledWith("/root");
  });

  it("根为空 / 扫描失败 → []（优雅降级，不阻断）", async () => {
    getRepoRootMock.mockResolvedValue("");
    expect(await resolveSiblingsByType("fbx", /\.fbx$/i)).toEqual([]);
    getRepoRootMock.mockResolvedValue("/root");
    scanEntriesMock.mockRejectedValue(new Error("scan fail"));
    expect(await resolveSiblingsByType("fbx", /\.fbx$/i)).toEqual([]);
  });
});
