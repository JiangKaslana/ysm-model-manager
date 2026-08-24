// @vitest-environment node
// ===== can() 能力门控真实实现三态测试（审核 B 缺口 #3）=====
// 桌面（__YSM_BACKEND__='go'）→ true；web（resolveWebMode）→ 'X' in browserAdapter；
// Android viewer（getAndroidBridge 非 null）→ false。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { can } from "./capabilities.ts";

const KEY = "__YSM_BACKEND__";

const webImplKeys = [
  "ScanModelEntries",
  "ToggleModelEnable",
  "ToggleEnable",
  "DeleteResourcePack",
  "RenameFile",
  "ReadPackMeta",
  "GetNbtVoxelData",
];

beforeEach(() => {
  vi.stubGlobal(KEY, undefined);
  // node 环境无 window——android-bridge.getAndroidBridge 读 window.wails（非全局 wails）
  vi.stubGlobal("window", { wails: undefined });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("can() — 三级能力门控", () => {
  it("桌面（声明 go）→ 恒 true（Go 桥全量可用）", () => {
    vi.stubGlobal(KEY, "go");
    expect(can("DeleteResourcePack")).toBe(true);
    expect(can("MoveModelFile")).toBe(true);
  });

  it("网页版（resolveWebMode）→ binding in browserAdapter（has trap）", async () => {
    // 模拟 web：MODE=web 无法在 vitest 直接设，用 __YSM_BACKEND__='browser'（Tier 0）
    vi.stubGlobal(KEY, "browser");
    // webImpls 已实现的 binding → true
    for (const k of webImplKeys) {
      expect(can(k)).toBe(true);
    }
    // 未实现（fail-fast）→ false
    expect(can("MoveModelFile")).toBe(true); // 已实现（57f6d84f）
    expect(can("GetPackInfo")).toBe(false);
    expect(can("CheckUpdate")).toBe(false);
    expect(can("OpenFolder")).toBe(false);
  });

  it("Android viewer（getAndroidBridge 非 null）→ false（无本地 FS 写能力）", () => {
    // Android Java 桥：window.wails 带 requestStoragePermission（android-bridge.ts:13-16 检测）
    vi.stubGlobal(KEY, undefined);
    vi.stubGlobal("window", { wails: { requestStoragePermission: () => {} } });
    expect(can("DeleteResourcePack")).toBe(false);
    expect(can("ToggleModelEnable")).toBe(false);
    expect(can("ToggleEnable")).toBe(false);
    expect(can("ScanModelEntries")).toBe(false);
  });

  it("默认环境（无声明/无 web/无 android）→ true（视作桌面/测试环境）", () => {
    expect(can("ScanModelEntries")).toBe(true);
  });
});
