// ===== sidebar MMD 变体聚合纯函数测试 =====
// groupMmdVariants：按父文件夹聚合 .pmx 变体 / 单层路径自身为组 / Windows 分隔符归一 / 去重。
// loadInstances：失败路径 toast + loading:start/end 配对（此前零测试覆盖）。
import { describe, it, expect, vi } from "vitest";
import { groupMmdVariants, loadInstances } from "./loader.ts";
import { bus } from "../../bus.ts";

// 阻断 Wails runtime 加载链：loader.ts 顶部静态 import bindings → @wailsio/runtime
// （其 drag.js 在模块加载时访问 window，jsdom teardown 后延迟回调触发
// "window is not defined" 环境噪声）。groupMmdVariants 是纯函数不依赖 bindings，mock 安全。
vi.mock("../../../bindings/ysm-model-manager/internal/app/app.js", () => ({
  LoadAppConfig: vi.fn(),
  ListVersionInstances: vi.fn(),
  GetResourceInstanceStatus: vi.fn(),
  GetRepoRoot: vi.fn(),
}));

describe("groupMmdVariants", () => {
  it("按父文件夹聚合 missing/extra 变体", () => {
    const r = groupMmdVariants(
      ["char/a.pmx", "char/b.pmx"],
      ["char/c.pmx"],
    );
    expect(r.missingGroups).toEqual(["char"]);
    expect(r.extraGroups).toEqual(["char"]);
    expect(r.variantMap["char"]).toEqual({
      items: ["char/a.pmx", "char/b.pmx", "char/c.pmx"],
      count: 3,
    });
  });

  it("单层路径无父文件夹 → 自身为组", () => {
    const r = groupMmdVariants(["solo.pmx"], []);
    expect(r.missingGroups).toEqual(["solo.pmx"]);
    expect(r.variantMap["solo.pmx"].items).toEqual(["solo.pmx"]);
    expect(r.variantMap["solo.pmx"].count).toBe(1);
  });

  it("Windows 分隔符归一为 / 后聚合（items 保留原始路径供展示）", () => {
    const r = groupMmdVariants(["dir\\sub\\a.pmx"], []);
    expect(r.missingGroups).toEqual(["dir/sub"]);
    expect(r.variantMap["dir/sub"].items).toEqual(["dir\\sub\\a.pmx"]);
  });

  it("同父文件夹缺失+多余 → missing 与 extra 组都保留（seen 隔离）", () => {
    const r = groupMmdVariants(
      ["char/a.pmx", "char/b.pmx"],
      ["char/c.pmx", "other/d.pmx"],
    );
    expect(r.missingGroups).toEqual(["char"]);
    expect(r.extraGroups.sort()).toEqual(["char", "other"]);
  });

  it("多个目录分别聚合，组列表去重", () => {
    const r = groupMmdVariants(["x/a.pmx", "x/b.pmx", "y/c.pmx"], []);
    expect(r.missingGroups.sort()).toEqual(["x", "y"]);
  });

  it("空列表 → 空组与空 map", () => {
    const r = groupMmdVariants([], []);
    expect(r.missingGroups).toEqual([]);
    expect(r.extraGroups).toEqual([]);
    expect(Object.keys(r.variantMap)).toHaveLength(0);
  });
});

describe("loadInstances", () => {
  it("加载失败 → 空列表 + toast 提示 + loading:start/end 配对", async () => {
    const { LoadAppConfig } = await import(
      "../../../bindings/ysm-model-manager/internal/app/app.js"
    );
    (LoadAppConfig as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"));
    const seq: string[] = [];
    const toasts: Array<{ msg?: string }> = [];
    const offs = [
      bus.on("loading:start", () => seq.push("start")),
      bus.on("loading:end", () => seq.push("end")),
      bus.on("toast:show", (p) => toasts.push(p)),
    ];
    try {
      const result = await loadInstances("ysm");
      expect(result).toEqual([]);
      // 失败不静默：toast 提示 + loading 标志必配对（防止全局 loading 卡死）
      expect(seq).toEqual(["start", "end"]);
      expect(toasts.some((t) => (t.msg || "").includes("整合包列表加载失败"))).toBe(true);
    } finally {
      offs.forEach((fn) => fn());
    }
  });

  it("mcRoot 未配置 → 空列表且不 toast（非错误场景）", async () => {
    const { LoadAppConfig } = await import(
      "../../../bindings/ysm-model-manager/internal/app/app.js"
    );
    (LoadAppConfig as ReturnType<typeof vi.fn>).mockResolvedValue({ mcRoot: "" });
    const toasts: Array<{ msg?: string }> = [];
    const off = bus.on("toast:show", (p) => toasts.push(p));
    try {
      const result = await loadInstances("ysm");
      expect(result).toEqual([]);
      expect(toasts).toHaveLength(0);
    } finally {
      off();
    }
  });

  it("成功加载 → 转换实例并按 hasMod 优先 + synced 降序排序", async () => {
    const app = await import(
      "../../../bindings/ysm-model-manager/internal/app/app.js"
    );
    (app.LoadAppConfig as ReturnType<typeof vi.fn>).mockResolvedValue({ mcRoot: "/mc" });
    (app.ListVersionInstances as ReturnType<typeof vi.fn>).mockResolvedValue([
      { Name: "NoMod", VersionDir: "/v/nomod", Exists: true },
      { Name: "A", VersionDir: "/v/a", Exists: true },
      { Name: "B", VersionDir: "/v/b", Exists: true },
    ]);
    (app.GetRepoRoot as ReturnType<typeof vi.fn>).mockResolvedValue("/repo");
    (app.GetResourceInstanceStatus as ReturnType<typeof vi.fn>).mockResolvedValue([
      { Name: "NoMod", Missing: ["x"], Extra: [], Synced: 5, HasMod: false },
      { Name: "A", Missing: [], Extra: [], Synced: 3, HasMod: true },
      { Name: "B", Missing: [], Extra: [], Synced: 9, HasMod: true },
    ]);
    const result = await loadInstances("ysm");
    // hasMod 优先；同 hasMod 按 synced 降序；无 mod 排最后
    expect(result.map((i) => i.name)).toEqual(["B", "A", "NoMod"]);
    expect(result[0].status).toBe("complete");
    expect(result[2].hasMod).toBe(false);
    expect(result[2].status).toBe("missing");
    expect(result[2].missing).toBe(1);
  });
});
