// ===== <app-resource-manager> 组件级测试（G-1 — ADR-035 / Design.md §19.1）=====
// 断言基于 data-testid 稳定钩子；验证生命周期、list 渲染、detail 面板。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getByTestId, getAllByTestId, waitFor, sleep, mountCustomElement, unmountElement } from "../../test-utils/index.ts";
import { bus } from "../../bus.ts";

// getApp 全绑定 mock（AppResourceManager 依赖大量 bindings）
const mockScanResult = vi.hoisted(() => [
    { Name: "pack1.zip", Path: "/repo/resourcepack/pack1.zip", enabled: true },
    { Name: "pack2.zip", Path: "/repo/resourcepack/pack2.zip", enabled: false },
  ]);
// P2 修复：mock 提为 vi.hoisted 可引用，供恒真断言改为精确断言（rtype 切换验证 ReadShaderpackLang）
const { readShaderpackLangMock, scanEntriesWithLabelMock, loadResourceTypesMock, getAndroidBridgeMock, resolveAndroidRepoDirMock, openFolderMock, isViewerModeMock, toggleMock, importByTypeMock, selectImportZipMock } = vi.hoisted(() => ({
  readShaderpackLangMock: vi.fn().mockResolvedValue(
    JSON.stringify({ name: "光影包测试", entries: {} }),
  ),
  // 默认返回列表数据（与 ScanModelEntries 同源），config:updated 用例内可临时改值
  scanEntriesWithLabelMock: vi.fn().mockResolvedValue(mockScanResult),
  // 资源类型配置（_loadConfig 走 getApp().LoadResourceTypes），config:updated 用例改值验证缓存失效
  loadResourceTypesMock: vi.fn().mockResolvedValue(
    JSON.stringify({
      resourceTypes: [
        { id: "resourcepack", name: "资源包", icon: "🎨", actions: ["import", "toggle", "delete", "openFolder"] },
        { id: "shaderpack", name: "光影包", icon: "☀️", actions: ["import", "openFolder"] },
      ],
    }),
  ),
  // Android 双端桥（openFolder 分支）：默认桌面（无桥/非查看器），Android 用例内 override
  getAndroidBridgeMock: vi.fn().mockReturnValue(null),
  isViewerModeMock: vi.fn().mockReturnValue(false),
  resolveAndroidRepoDirMock: vi.fn().mockResolvedValue("/storage/emulated/0/YSM-Model-Manager"),
  openFolderMock: vi.fn().mockResolvedValue(undefined),
  // P3 审核新增（覆盖 toggle/import 未测分支）：默认 toggle 成功（Go 端返回 bool）
  toggleMock: vi.fn().mockResolvedValue(true),
  // 默认导入成功（ImportByType 返回空串=成功）；错误路径用例内 override 为非空串
  importByTypeMock: vi.fn().mockResolvedValue(""),
  // 默认取消（返空串）；导入错误路径用例内 override 为真实路径以触达 ImportByType
  selectImportZipMock: vi.fn().mockResolvedValue(""),
}));
vi.mock("../../backend/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({
    GetRepoRoot: vi.fn().mockResolvedValue("/repo/resourcepack"),
    ReadPackMeta: vi.fn().mockResolvedValue(JSON.stringify({
      name: "测试资源包",
      description: "一个测试用的资源包",
      pack_format: 15,
    })),
    ScanModelEntries: vi.fn().mockResolvedValue(mockScanResult),
    ScanModelEntriesWithLabel: scanEntriesWithLabelMock,
    ToggleResourcePack: toggleMock,
    IsResourcePackEnabled: vi.fn().mockResolvedValue(true),
    SelectImportZip: selectImportZipMock,
    SelectImportFile: vi.fn().mockResolvedValue(""),
    ImportByType: importByTypeMock,
    DeleteResourcePack: vi.fn().mockResolvedValue(undefined),
    OpenFolder: openFolderMock,
    LoadAppConfig: vi.fn().mockResolvedValue({}),
    ListVersionInstances: vi.fn().mockResolvedValue([]),
    ReadShaderpackLang: readShaderpackLangMock,
    LoadResourceTypes: loadResourceTypesMock,
  }),
}));

vi.mock("../../utils/dom/android-bridge.ts", () => ({
  getAndroidBridge: getAndroidBridgeMock,
  isViewerMode: isViewerModeMock,
}));
vi.mock("../../utils/dom/directory-picker.ts", () => ({
  resolveAndroidRepoDir: resolveAndroidRepoDirMock,
}));

import "./index.ts"; // 触发 customElements.define("app-resource-manager")
import { registerResourceManagerGlobal } from "./index.ts";

// P3 修复：删除 mock 不存在的 ../../resource-types.ts（死 mock，误导注释）——
// 真实配置源已在 LoadResourceTypes mock（_loadConfig 走 getApp()）
describe("app-resource-manager（testid 钩子 + 资源管理交互）", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("connected → 渲染侧栏与列表", async () => {
    const el = mountCustomElement("app-resource-manager");
    await waitFor(() => el.querySelector('[data-testid="rm-item"]') !== null, 5000);
    const items = getAllByTestId(el, "rm-item");
    expect(items.length).toBeGreaterThanOrEqual(1);
    unmountElement(el);
  });

  it("connected → 导入按钮存在", async () => {
    const el = mountCustomElement("app-resource-manager");
    await waitFor(() => el.querySelector('[data-testid="rm-import"]') !== null, 5000);
    const importBtn = getByTestId(el, "rm-import")!;
    expect(importBtn).toBeTruthy();
    expect(importBtn.textContent).toContain("导入");
    unmountElement(el);
  });

  it("连接 → 打开文件夹按钮存在", async () => {
    const el = mountCustomElement("app-resource-manager");
    await waitFor(() => el.querySelector('[data-testid="rm-open"]') !== null, 5000);
    const openBtn = getByTestId(el, "rm-open");
    expect(openBtn).toBeTruthy();
    unmountElement(el);
  });

  it("打开文件夹 Android → resolveAndroidRepoDir（定位公共仓库），不调 OpenFolder", async () => {
    getAndroidBridgeMock.mockReturnValue({ requestStoragePermission: vi.fn() } as never);
    isViewerModeMock.mockReturnValue(true); // 查看器模式（Android）
    const el = mountCustomElement("app-resource-manager");
    await waitFor(() => el.querySelector('[data-testid="rm-open"]') !== null, 5000);
    const openBtn = getByTestId(el, "rm-open") as HTMLElement;
    openBtn.click();
    await waitFor(() => resolveAndroidRepoDirMock.mock.calls.length === 1, 5000);
    expect(resolveAndroidRepoDirMock).toHaveBeenCalledTimes(1);
    expect(openFolderMock).not.toHaveBeenCalled();
    unmountElement(el);
  });

  it("点击列表项 → 显示详情面板（P2 修复：原无断言，_showDetail 可完全坏掉仍绿）", async () => {
    const el = mountCustomElement("app-resource-manager");
    await waitFor(() => el.querySelector('[data-testid="rm-item"]') !== null, 5000);
    const firstItem = el.querySelector('[data-testid="rm-item"]') as HTMLElement;
    firstItem.click();
    // 详情渲染后：占位符消失，出现详情内容（删除按钮或包名文本）
    await waitFor(
      () => el.querySelector(".dp-placeholder") === null &&
        el.querySelector(".rm-del-btn") !== null,
      5000,
    );
    expect(el.querySelector(".rm-del-btn")).not.toBeNull();
    unmountElement(el);
  });

  it("rtype 属性变化 → 重新初始化并渲染新类型（P2 修复：原 expect(true) 恒真）", async () => {
    readShaderpackLangMock.mockClear();
    const el = mountCustomElement("app-resource-manager");
    await waitFor(() => el.querySelector('[data-testid="rm-item"]') !== null, 5000);
    // 切换到光影包类型（SHADER="shaderpack"）→ attributeChangedCallback 触发 _init 异步重建
    el.setAttribute("rtype", "shaderpack");
    // waitFor 首次检查会命中旧 rtype 残留的 rm-item（_init 尚未清空 DOM），
    // 故先 sleep 等 _init + _loadList 重建完成，再点击新列表项
    await sleep(400);
    await waitFor(() => el.querySelector('[data-testid="rm-item"]') !== null, 5000);
    // 点击列表项 → _showDetail 走 ReadShaderpackLang 分支（验证 shaderpack 渲染路径真实生效）
    (el.querySelector('[data-testid="rm-item"]') as HTMLElement).click();
    await waitFor(() => readShaderpackLangMock.mock.calls.length > 0, 5000);
    expect(readShaderpackLangMock).toHaveBeenCalled();
    unmountElement(el);
  });

  it("disconnected → 移除 DOM 无残留（P2 修复：原 expect(true) 恒真）", async () => {
    const el = mountCustomElement("app-resource-manager");
    await waitFor(() => el.querySelector('[data-testid="rm-item"]') !== null, 5000);
    unmountElement(el);
    expect(document.querySelector("app-resource-manager")).toBeNull();
  });

  it("config:updated → 缓存失效，下次 _init 重新拉取配置（F8：仅清缓存，不空转刷新实例）", async () => {
    // 模块级 STORE 缓存可能被前序用例污染 → 先注册订阅 emit 清缓存，确保本次挂载走真实拉取
    const unsubs: Array<() => void> = [];
    registerResourceManagerGlobal(unsubs);
    bus.emit("config:updated");
    loadResourceTypesMock.mockClear();
    const el = mountCustomElement("app-resource-manager");
    await waitFor(() => el.querySelector('[data-testid="rm-item"]') !== null, 5000);
    expect(loadResourceTypesMock.mock.calls.length).toBeGreaterThan(0);

    bus.emit("config:updated"); // 仅清 STORE._config 缓存，不直接刷新实例
    unsubs.forEach((fn) => fn());

    const callsBefore = loadResourceTypesMock.mock.calls.length;
    await (el as unknown as { _init(): Promise<void> })._init(); // 缓存已清 → 重新拉取配置
    expect(loadResourceTypesMock.mock.calls.length).toBe(callsBefore + 1);
    unmountElement(el);
  });

  // P3 审核新增：覆盖 toggle/import/搜索/未知 rtype 未测分支（原测试仅验按钮存在，操作路径全裸）

  it("点击 rm-toggle → 调 ToggleResourcePack 并刷新列表（toggle 操作路径）", async () => {
    toggleMock.mockClear();
    const el = mountCustomElement("app-resource-manager");
    await waitFor(() => el.querySelector('[data-testid="rm-item"]') !== null, 5000);
    const toggleEl = el.querySelector(".rm-toggle") as HTMLElement | null;
    expect(toggleEl).not.toBeNull();
    scanEntriesWithLabelMock.mockClear();
    toggleEl!.click();
    await waitFor(() => toggleMock.mock.calls.length === 1, 5000);
    expect(toggleMock).toHaveBeenCalledTimes(1);
    // _loadList 刷新（ScanModelEntriesWithLabel 被再次调用）
    await waitFor(() => scanEntriesWithLabelMock.mock.calls.length > 0, 5000);
    unmountElement(el);
  });

  it("导入 SelectImportZip 返回空 → 不调 ImportByType（取消路径）", async () => {
    importByTypeMock.mockClear();
    const el = mountCustomElement("app-resource-manager");
    await waitFor(() => el.querySelector('[data-testid="rm-import"]') !== null, 5000);
    (el.querySelector('[data-testid="rm-import"]') as HTMLElement).click();
    // await 一段让 click 的 async handler 跑完（SelectImportZip resolve "" → 早退）
    await sleep(150);
    expect(importByTypeMock).not.toHaveBeenCalled();
    unmountElement(el);
  });

  it("导入 ImportByType 返回非空错误 → 走 toast 失败分支（错误路径）", async () => {
    importByTypeMock.mockClear();
    // SelectImportZip 返回真实路径 → 不在 `if (!filePath) return` 早退
    // ImportByType 返回非空错误串 → 走 `if (errMsg)` 分支 → _toast("error")
    selectImportZipMock.mockResolvedValueOnce("/fake/pack.zip");
    importByTypeMock.mockResolvedValueOnce("文件已存在");
    const el = mountCustomElement("app-resource-manager");
    await waitFor(() => el.querySelector('[data-testid="rm-import"]') !== null, 5000);
    (el.querySelector('[data-testid="rm-import"]') as HTMLElement).click();
    await waitFor(() => importByTypeMock.mock.calls.length === 1, 5000);
    expect(importByTypeMock).toHaveBeenCalledTimes(1);
    unmountElement(el);
  });

  it("搜索输入 → _applyFilter 过滤列表（仅匹配项显示）", async () => {
    const el = mountCustomElement("app-resource-manager");
    await waitFor(() => el.querySelector('[data-testid="rm-item"]') !== null, 5000);
    const before = getAllByTestId(el, "rm-item").length;
    expect(before).toBeGreaterThanOrEqual(2); // mockScanResult 含 2 项
    const search = el.querySelector(".rm-search") as HTMLInputElement | null;
    expect(search).not.toBeNull();
    search!.value = "pack1";
    search!.dispatchEvent(new Event("input", { bubbles: true }));
    await waitFor(() => getAllByTestId(el, "rm-item").length === 1, 5000);
    expect(getAllByTestId(el, "rm-item").length).toBe(1);
    unmountElement(el);
  });

  it("未知 rtype → 渲染错误占态（_findType 返 undefined 分支）", async () => {
    const el = mountCustomElement("app-resource-manager");
    el.setAttribute("rtype", "nonexistent-type");
    await waitFor(
      () => el.querySelector('[data-testid="rm-item"]') === null &&
        (el.textContent || "").includes("⚠️"),
      5000,
    );
    expect(el.querySelector('[data-testid="rm-item"]')).toBeNull();
    unmountElement(el);
  });
});
