// @vitest-environment node
// ===== fbx-siblings 测试（ADR-112 地基拓展：P0-1 预览内切换）=====
// 覆盖：resolveFbxSiblings 委托通用 resolveSiblingsByType，仅保留 .fbx（含大写）；
// GetRepoRoot 为空 / 扫描失败 → []。
import { describe, it, expect, vi, beforeEach } from "vitest";

const { getAppMock, getRepoRootMock, scanEntriesMock } = vi.hoisted(() => ({
  getAppMock: vi.fn(),
  getRepoRootMock: vi.fn(),
  scanEntriesMock: vi.fn(),
}));
vi.mock("../../backend/app.ts", () => ({ getApp: getAppMock }));
vi.mock("../../utils/resource/types.ts", () => ({
  RESOURCE_TYPES: { FBX: "fbx" },
}));

import { resolveFbxSiblings } from "./fbx-siblings.ts";

beforeEach(() => {
  vi.clearAllMocks();
  getAppMock.mockResolvedValue({
    GetRepoRoot: getRepoRootMock,
    ScanModelEntries: scanEntriesMock,
  });
});

describe("resolveFbxSiblings", () => {
  it("委托通用底座，仅保留 .fbx（含大写），排除 .vmd 等同目录异格式", async () => {
    getRepoRootMock.mockResolvedValue("/mmd-root/CustomAnim");
    scanEntriesMock.mockResolvedValue([
      { Path: "/mmd-root/CustomAnim/dance.fbx" },
      { Path: "/mmd-root/CustomAnim/walk.FBX" },
      { Path: "/mmd-root/CustomAnim/motion.vmd" },
    ]);
    expect(await resolveFbxSiblings()).toEqual([
      "/mmd-root/CustomAnim/dance.fbx",
      "/mmd-root/CustomAnim/walk.FBX",
    ]);
    expect(getRepoRootMock).toHaveBeenCalledWith("fbx");
  });

  it("GetRepoRoot 为空 / 扫描失败 → []", async () => {
    getRepoRootMock.mockResolvedValue("");
    expect(await resolveFbxSiblings()).toEqual([]);
    getRepoRootMock.mockResolvedValue("/r");
    scanEntriesMock.mockRejectedValue(new Error("x"));
    expect(await resolveFbxSiblings()).toEqual([]);
  });
});
