// ===== preview-library 测试：_openers 覆盖率 + 注册表一致性 + 多仓库聚合 =====
// 审核 P3：验证所有已知资源类型要么有 3D opener，要么在显式豁免列表中。
// 各 createXxx3D 包装器在模块加载时 registerReRoute，测试通过 import 触发注册。
// 多仓库聚合（2026-08-18）：loadAllModels 应跨各 rtype 物理仓库聚合，
// 每项带来源 rtype（tab 过滤用）+ 扩展名粗判标签。

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ALL_RESOURCE_TYPES } from "../../utils/resource/types.ts";
import { getRegisteredRoutes, withPreviewExtras } from "./preview-library.ts";
import type { LibraryAsset } from "../../utils/3d/adapters/preview-menu.ts";

// mock getApp：按 rtype 返回各自仓库根 + 模型列表（模拟物理分类目录）
const { getAppMock, GetRepoRootMock, SearchModelsMock } = vi.hoisted(() => ({
  getAppMock: vi.fn(),
  GetRepoRootMock: vi.fn(),
  SearchModelsMock: vi.fn(),
}));
vi.mock("../../backend/app.ts", () => ({
  getApp: getAppMock,
}));
getAppMock.mockResolvedValue({
  GetRepoRoot: GetRepoRootMock,
  SearchModels: SearchModelsMock,
  DetectResourceType: vi.fn(),
});

// 触发注册（import 即有 side effect：模块加载时调用 registerReRoute）
import "./ysm-3d.ts";
import "./mmd-3d.ts";
import "./vrm-3d.ts";
import "./pack-3d.ts";

/** 已知无 3D 预览能力的资源类型（走 YSM 兜底回退或 toast 提示） */
const NO_3D_TYPES = new Set<string>([
  "shaderpack",
  "create-blueprint",
  "litematic",
]);

describe("preview-library _openers 覆盖率", () => {
  it("所有已知资源类型要么有 3D opener，要么在豁免列表中", () => {
    const registered = new Set(getRegisteredRoutes());
    const missing: string[] = [];

    for (const rtype of ALL_RESOURCE_TYPES) {
      if (!registered.has(rtype) && !NO_3D_TYPES.has(rtype)) {
        missing.push(rtype);
      }
    }

    expect(missing, `缺少 3D opener 且未豁免的类型: ${missing.join(", ")}`).toEqual([]);
  });

  it("已注册的 opener 类型全部在已知资源类型列表中", () => {
    const known = new Set(ALL_RESOURCE_TYPES);
    const registered = getRegisteredRoutes();
    const unknown = registered.filter((t) => !known.has(t));

    expect(unknown, `已注册但不在已知类型列表中的类型: ${unknown.join(", ")}`).toEqual([]);
  });

  it("已注册的 opener 类型与豁免列表无交集（豁免 = 暂无 3D，不应有注册）", () => {
    const registered = new Set(getRegisteredRoutes());
    const overlap = [...NO_3D_TYPES].filter((t) => registered.has(t));

    expect(overlap, `既在豁免列表又有注册的类型: ${overlap.join(", ")}`).toEqual([]);
  });
});

describe("loadAllModels 多仓库聚合（跨 rtype 物理分类目录）", () => {
  beforeEach(() => {
    GetRepoRootMock.mockReset();
    SearchModelsMock.mockReset();
  });

  /** 经 withPreviewExtras 拿库加载引用（loadAllModels 未导出，契约出口在 opts.library） */
  const lib = (): Promise<LibraryAsset[]> =>
    (withPreviewExtras({}) as { library: () => Promise<LibraryAsset[]> }).library();

  it("聚合各 rtype 仓库（有 opener 的 4 类），每项带来源 rtype", async () => {
    GetRepoRootMock.mockImplementation(async (rtype: string) => `/repo/${rtype}`);
    SearchModelsMock.mockImplementation(async (_root: string, kw: string) =>
      kw ? [] : [{ name: `m.${kw || "ysm"}`, path: `/repo/x/m.ysm` }],
    );
    const assets = await lib();
    // 每个仓库各返回 1 条 → 聚合 ≥ 4（ysm/mmd-skin/vrchat-avatar/resourcepack）
    expect(assets.length).toBeGreaterThanOrEqual(4);
    const rtypes = new Set(assets.map((a) => a.rtype));
    expect(rtypes.has("ysm")).toBe(true);
    expect(rtypes.has("mmd-skin")).toBe(true);
    expect(rtypes.has("vrchat-avatar")).toBe(true);
    expect(rtypes.has("resourcepack")).toBe(true);
    // 每项必有扩展名粗判标签 + 图标（列表展示契约）
    for (const a of assets) {
      expect(a.tag.length).toBeGreaterThan(0);
      expect(a.icon.length).toBeGreaterThan(0);
    }
  });

  it("空仓库跳过（GetRepoRoot 返回空 → 不聚合该 rtype）", async () => {
    GetRepoRootMock.mockImplementation(async (rtype: string) =>
      rtype === "ysm" ? "/repo/ysm" : "",
    );
    SearchModelsMock.mockResolvedValue([{ name: "a.ysm", path: "/repo/ysm/a.ysm" }]);
    const assets = await lib();
    expect(assets.length).toBe(1);
    expect(assets[0].rtype).toBe("ysm");
    // 空仓库不产生该 rtype 条目
    expect(assets.some((a) => a.rtype === "mmd-skin")).toBe(false);
  });

  it("混入他类文件 → 按扩展名粗判标签（YSM 仓库里的 .vrm 标 VRM）", async () => {
    GetRepoRootMock.mockResolvedValue("/repo/ysm");
    SearchModelsMock.mockResolvedValue([
      { name: "a.ysm", path: "/repo/ysm/a.ysm" },
      { name: "人.vrm", path: "/repo/ysm/人.vrm" },
    ]);
    const assets = await lib();
    const vrm = assets.find((a) => a.path.endsWith(".vrm"));
    expect(vrm).toBeDefined();
    expect(vrm!.tag).toBe("VRM");
    expect(vrm!.icon).toBe("🥽");
    expect(vrm!.rtype).toBe("ysm"); // 来源仓库仍是 ysm（物理分类），标签才按扩展名
  });

  it("超 500 条限流（防超大库拖垮菜单）", async () => {
    GetRepoRootMock.mockResolvedValue("/repo/ysm");
    SearchModelsMock.mockResolvedValue(
      Array.from({ length: 600 }, (_, i) => ({ name: `m${i}.ysm`, path: `/repo/ysm/m${i}.ysm` })),
    );
    const assets = await lib();
    expect(assets.length).toBeLessThanOrEqual(500);
  });
});