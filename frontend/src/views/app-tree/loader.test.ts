// @vitest-environment node
// ===== 文件树数据加载层测试 =====
// 覆盖：loadEntries 空 repoRoot / 空 raw / 扩展名过滤 / banned / relPath / 异常 toast
// mock 基线来自 e2e/mock-data.ts（共享单源：改 Go 数据只改一处，防双源漂移），
// 测试专用值用 override 覆盖（如反斜杠路径用例）。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bus } from "../../bus.ts";
import { MOCK_DATA } from "../../../e2e/mock-data.ts";

const { mocks } = vi.hoisted(() => {
  const mocks = {
    getExts: vi.fn(),
    GetRepoRoot: vi.fn(),
    ScanModelEntriesWithLabel: vi.fn(),
    IsFileBanned: vi.fn(),
    getAndroidBridge: vi.fn(),
  };
  return { mocks };
});

vi.mock("../../utils/resource/extensions.ts", () => ({
  getExts: mocks.getExts,
}));

vi.mock("../../utils/resource/types.ts", () => ({
  RESOURCE_TYPE_LABELS: { ysm: "YSM模型", pack: "资源包" },
}));

vi.mock("../../backend/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({
    GetRepoRoot: mocks.GetRepoRoot,
    ScanModelEntriesWithLabel: mocks.ScanModelEntriesWithLabel,
    IsFileBanned: mocks.IsFileBanned,
  }),
}));

vi.mock("../../utils/dom/errors.ts", () => ({
  friendlyError: (e: unknown, fallback: string): string =>
    e instanceof Error ? e.message : fallback,
}));

vi.mock("../../utils/dom/android-bridge.ts", () => ({
  getAndroidBridge: mocks.getAndroidBridge,
}));

let cleanups: Array<() => void> = [];

beforeEach(() => {
  cleanups = [];
  vi.clearAllMocks();
  mocks.getExts.mockReturnValue([".ysm", ".zip"]);
  // 共享基线：GetRepoRoot 取 MOCK_DATA 值（"/e2e/repo"），与 e2e 一致
  mocks.GetRepoRoot.mockResolvedValue(MOCK_DATA.GetRepoRoot);
  mocks.IsFileBanned.mockResolvedValue(false);
});

afterEach(() => {
  cleanups.splice(0).forEach((fn) => fn());
});

function spyToasts() {
  const toasts: Array<{ msg: string; type: string }> = [];
  cleanups.push(bus.on("toast:show", (t) => toasts.push(t as { msg: string; type: string })));
  return toasts;
}

describe("loadEntries", () => {
  it("repoRoot 未配置 → 空结果，不扫文件", async () => {
    mocks.GetRepoRoot.mockResolvedValue("");
    const { loadEntries } = await import("./loader.ts");
    const r = await loadEntries("ysm");
    expect(r).toEqual({ filesRoot: "", entries: [] });
    expect(mocks.ScanModelEntriesWithLabel).not.toHaveBeenCalled();
  });

  it("扫描结果为空 → 空 entries", async () => {
    mocks.ScanModelEntriesWithLabel.mockResolvedValue([]);
    const { loadEntries } = await import("./loader.ts");
    const r = await loadEntries("ysm");
    expect(r).toEqual({ filesRoot: MOCK_DATA.GetRepoRoot, entries: [] });
  });

  it("按扩展名过滤（.ban 后缀先剥离）并计算相对路径、并入 banned 状态", async () => {
    // Path 前缀与共享基线 GetRepoRoot（/e2e/repo）一致，动态拼接防再次硬编码漂移
    const repo = MOCK_DATA.GetRepoRoot;
    mocks.ScanModelEntriesWithLabel.mockResolvedValue([
      { Name: "a.ysm", Path: `${repo}/sub/a.ysm`, Size: 10, ModTime: 1 },
      { Name: "b.ban", Path: `${repo}/sub/b.ban`, Size: 10, ModTime: 1 },
      { Name: "c.txt", Path: `${repo}/sub/c.txt`, Size: 10, ModTime: 1 },
      { Name: "d.ysm", Path: `${repo}/sub/d.ysm`, Size: 10, ModTime: 1 },
    ]);
    mocks.IsFileBanned.mockImplementation((p: string) =>
      Promise.resolve(p.endsWith("d.ysm")),
    );
    const { loadEntries } = await import("./loader.ts");
    const r = await loadEntries("ysm");

    // b.ban 剥离后缀后为 "b"，不匹配 .ysm/.zip → 过滤；c.txt 直接过滤
    expect(r.entries).toHaveLength(2);
    expect(r.entries[0]).toMatchObject({
      name: "a.ysm",
      path: "sub/a.ysm", // 去掉 repoRoot 前缀
      fullPath: `${repo}/sub/a.ysm`,
      banned: false,
    });
    expect(r.entries[1]).toMatchObject({ name: "d.ysm", path: "sub/d.ysm", banned: true });
  });

  it("banned 检查失败兜底为 false（不中断加载）", async () => {
    mocks.ScanModelEntriesWithLabel.mockResolvedValue([
      { Name: "a.ysm", Path: `${MOCK_DATA.GetRepoRoot}/a.ysm`, Size: 0, ModTime: 0 },
    ]);
    mocks.IsFileBanned.mockRejectedValue(new Error("lock"));
    const { loadEntries } = await import("./loader.ts");
    const r = await loadEntries("ysm");
    expect(r.entries[0].banned).toBe(false);
  });

  it("仓库根路径带反斜杠时也能剥离前缀", async () => {
    mocks.GetRepoRoot.mockResolvedValue("C:\\repo");
    mocks.ScanModelEntriesWithLabel.mockResolvedValue([
      { Name: "a.ysm", Path: "C:\\repo\\sub\\a.ysm", Size: 0, ModTime: 0 },
    ]);
    const { loadEntries } = await import("./loader.ts");
    const r = await loadEntries("ysm");
    expect(r.entries[0].path).toBe("sub/a.ysm");
  });

  it("ScanModelEntriesWithLabel 抛错 → error toast + 空结果", async () => {
    mocks.ScanModelEntriesWithLabel.mockRejectedValue(new Error("boom"));
    const toasts = spyToasts();
    const { loadEntries } = await import("./loader.ts");
    const r = await loadEntries("ysm");
    expect(r).toEqual({ filesRoot: "", entries: [] });
    expect(toasts.some((t) => t.type === "error" && t.msg.includes("boom"))).toBe(true);
  });
});

// ---- maybePromptAndroidStorage（经 loadEntries 失败路径触发，ADR-046 P2）----
// 库加载失败时若 Android 未授权 → 引导 requestStoragePermission（5s 节流）。
// _lastStoragePromptAt / _lastErrorToastAt 是模块级节流变量：fake 时间从真实
// 基线起步每用例递增 60s（>5s 窗口）自然过期，保证 > 上一用例（含前一个
// describe 在真实时间触发的）残留时间戳，避免 resetModules 连 bus.ts 一起
// 重置导致 loader 新实例与 spy 的 bus 实例分叉（toast 收不到）。
const realStartMs = Date.now(); // 捕获真实基线（fake timers 之前）
describe("maybePromptAndroidStorage（loadEntries 失败触发）", () => {
  let fakeMs = 0;
  beforeEach(() => {
    fakeMs += 60_000;
    vi.useFakeTimers();
    vi.setSystemTime(new Date(realStartMs + fakeMs));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function makeBridge(hasPermission: boolean) {
    const bridge = {
      hasStoragePermission: vi.fn(() => hasPermission),
      requestStoragePermission: vi.fn(),
    };
    mocks.getAndroidBridge.mockReturnValue(bridge);
    return bridge;
  }

  it("桌面（无桥）→ 不引导授权", async () => {
    mocks.getAndroidBridge.mockReturnValue(null);
    const toasts = spyToasts();
    const { loadEntries } = await import("./loader.ts");
    await loadEntries("ysm");
    // 仍走 error toast（loadEntries 自身错误出口），但无权限引导 toast
    expect(toasts.some((t) => t.type === "error")).toBe(true);
    expect(toasts.some((t) => t.type === "warn")).toBe(false);
  });

  it("Android 未授权 → 调用 requestStoragePermission + warn toast", async () => {
    const bridge = makeBridge(false);
    const toasts = spyToasts();
    const { loadEntries } = await import("./loader.ts");
    await loadEntries("ysm");
    expect(bridge.requestStoragePermission).toHaveBeenCalledTimes(1);
    expect(toasts.some((t) => t.type === "warn")).toBe(true);
  });

  it("Android 已授权 → 不引导", async () => {
    const bridge = makeBridge(true);
    const { loadEntries } = await import("./loader.ts");
    await loadEntries("ysm");
    expect(bridge.requestStoragePermission).not.toHaveBeenCalled();
  });

  it("5s 节流：连续失败只引导一次", async () => {
    const bridge = makeBridge(false);
    const { loadEntries } = await import("./loader.ts");
    await loadEntries("ysm");
    // 不推进时间，立即再次失败 → 节流吞掉第二次引导
    await loadEntries("ysm");
    expect(bridge.requestStoragePermission).toHaveBeenCalledTimes(1);
  });
});
