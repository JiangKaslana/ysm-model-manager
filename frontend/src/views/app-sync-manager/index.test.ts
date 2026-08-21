// ===== <app-sync-manager> 组件级测试（G-1 — ADR-035 / Design.md §19.1）=====
// 断言基于 data-testid 稳定钩子；交互模拟类型标签切换、状态筛选、按钮点击。
// 注意：模块级变量 _lastSelectedType 在类型切换后泄漏，测试间隔离需靠 localStorage + 顺序。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getByTestId, getAllByTestId, waitFor, sleep, mountCustomElement, unmountElement } from "../../test-utils/index.ts";
import { bus } from "../../bus.ts";
import type { SyncItem } from "./tpl.ts";

// getApp 全绑定 mock（P1 修复：mocks 提为 vi.hoisted 可引用，原内联 vi.fn 无法精确断言）
const { mocks } = vi.hoisted(() => {
  const mocks = {
    LoadResourceTypes: vi.fn().mockResolvedValue(
      JSON.stringify({
        resourceTypes: [
          { id: "ysm", name: "YSM 模型", icon: "💎" },
          { id: "EntityPlayer", name: "PMX 模型", icon: "🎭" },
          { id: "SceneModel", name: "场景模型", icon: "🏰" },
          { id: "vrchat-avatar", name: "VRC 模型", icon: "🥽" },
          { id: "resourcepack", name: "资源包", icon: "🎨" },
          { id: "shaderpack", name: "光影包", icon: "☀️" },
          { id: "blueprint", name: "蓝图", icon: "⚙️" },
          { id: "litematic", name: "投影", icon: "📐" },
        ],
      }),
    ),
    GetInstanceSyncStatus: vi.fn().mockResolvedValue(
      JSON.stringify([
        { path: "a.ysm", name: "模型A", status: "synced", type: "ysm", size: 1024 },
        { path: "b.ysm", name: "模型B", status: "missing", type: "ysm", size: 2048 },
        { path: "c.ysm", name: "模型C", status: "disabled", type: "ysm", size: 512 },
        { path: "d.ysm", name: "模型D", status: "synced", type: "ysm", size: 0 },
      ]),
    ),
    PushSingleResourceToInstance: vi.fn().mockResolvedValue(undefined),
    PullSingleResourceFromInstance: vi.fn().mockResolvedValue(undefined),
    GetRepoRoot: vi.fn().mockResolvedValue("/repo"),
    ScanModelEntriesWithLabel: vi.fn().mockResolvedValue([]),
  };
  return { mocks };
});

vi.mock("../../backend/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({
    LoadResourceTypes: mocks.LoadResourceTypes,
    GetInstanceSyncStatus: mocks.GetInstanceSyncStatus,
    PushSingleResourceToInstance: mocks.PushSingleResourceToInstance,
    PullSingleResourceFromInstance: mocks.PullSingleResourceFromInstance,
    GetRepoRoot: mocks.GetRepoRoot,
    ScanModelEntriesWithLabel: mocks.ScanModelEntriesWithLabel,
  }),
}));

import "./index.ts"; // 触发 customElements.define("app-sync-manager")

describe("app-sync-manager（testid 钩子 + 同步交互）", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    // P2 修复（审核发现）：原键名 "ysm-sm-last-type" 写错——源码实际键是
    // "ysm_syncLastType"（LAST_TYPE_KEY，index.ts:39），清理无效导致测试隔离
    // 完全依赖文件内执行顺序
    localStorage.removeItem("ysm_syncLastType");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    // 2026-08-17 isolate:false 审核模式发现：全局残留会让 5000ms waitFor 渲染超时
    vi.unstubAllGlobals();
  });

  it("connected 无 instance → 显示错误提示", async () => {
    const el = mountCustomElement("app-sync-manager");
    expect(el.innerHTML).toContain("⚠️");
    unmountElement(el);
  });

  it("connected 有 instance → 渲染列表和推送按钮", async () => {
    const el = document.createElement("app-sync-manager");
    el.setAttribute("instance", "1.20.1-Fabric");
    document.body.appendChild(el);
    await waitFor(() => el.querySelector('[data-testid="sm-push"]') !== null, 5000);
    const pushBtn = el.querySelector('[data-testid="sm-push"]') as HTMLElement;
    expect(pushBtn).toBeTruthy();
    expect(pushBtn.textContent).toContain("推送");
    unmountElement(el);
  });

  it("推送按钮 → 调用 PushSingleResourceToInstance（P1 修复：原断言 getApp 恒真）", async () => {
    const el = document.createElement("app-sync-manager");
    el.setAttribute("instance", "test");
    document.body.appendChild(el);
    await waitFor(() => el.querySelector('[data-testid="sm-push"]') !== null, 5000);
    const pushBtn = el.querySelector('[data-testid="sm-push"]') as HTMLElement;
    pushBtn.click();
    await waitFor(() => mocks.PushSingleResourceToInstance.mock.calls.length > 0, 5000);
    // 精确断言：参数序 (selectedType, instanceName, filePath)，selectedType 默认 YSM
    expect(mocks.PushSingleResourceToInstance).toHaveBeenCalledWith(
      "ysm",
      "test",
      expect.any(String),
    );
    unmountElement(el);
  });

  it("stats:refresh → 重新加载数据（P2 修复：原只断言元素存在，handler 被移除也通过）", async () => {
    const el = document.createElement("app-sync-manager");
    el.setAttribute("instance", "test");
    document.body.appendChild(el);
    await waitFor(() => el.querySelector(".sm-item") !== null, 5000);
    const callsBefore = mocks.GetInstanceSyncStatus.mock.calls.length;
    bus.emit("stats:refresh");
    await sleep(500);
    // 订阅有效 → 重新加载（GetInstanceSyncStatus 调用次数 +1）
    expect(mocks.GetInstanceSyncStatus.mock.calls.length).toBe(callsBefore + 1);
    unmountElement(el);
  });

  it("disconnected → 清理订阅（P1 修复：原 expect(true) 恒真）", async () => {
    const el = document.createElement("app-sync-manager");
    el.setAttribute("instance", "test");
    document.body.appendChild(el);
    await waitFor(() => el.querySelector(".sm-item") !== null, 5000);
    // 记录卸载前的加载次数，断开后 emit 不应再触发 GetInstanceSyncStatus
    const callsBefore = mocks.GetInstanceSyncStatus.mock.calls.length;
    unmountElement(el);
    // 断开后发射 stats:refresh，订阅应已清理 → 调用次数不变
    bus.emit("stats:refresh");
    await sleep(100);
    expect(mocks.GetInstanceSyncStatus.mock.calls.length).toBe(callsBefore);
  });

  it("repo:rtype-changed → 当前类型跟随 + 数据重载（sm-tabs 移除后全局驱动）", async () => {
    const el = document.createElement("app-sync-manager");
    el.setAttribute("instance", "test");
    document.body.appendChild(el);
    await waitFor(() => el.querySelector(".sm-item") !== null, 5000);
    // 无类型 tab（已移除，防回归）
    expect(el.querySelector(".sm-tab")).toBeNull();
    // 发射全局焦点 → 订阅应重载数据（GetInstanceSyncStatus +1）
    const callsBefore = mocks.GetInstanceSyncStatus.mock.calls.length;
    bus.emit("repo:rtype-changed", "shaderpack");
    await sleep(500);
    expect(mocks.GetInstanceSyncStatus.mock.calls.length).toBe(callsBefore + 1);
    // 当前类型指示更新
    const cur = el.querySelector(".sm-cur-type") as HTMLElement;
    expect(cur).not.toBeNull();
    expect(cur.dataset.rtype).toBe("shaderpack");
    // 恢复全局焦点为 ysm（防模块级 _lastSelectedType 泄漏到后续用例）
    bus.emit("repo:rtype-changed", "ysm");
    await sleep(100);
    unmountElement(el);
  });

  it("EntityPlayer 走 sync tree：subdir 作为顶层文件夹（SceneModel/CustomAnim 平行可见）", async () => {
    const el = document.createElement("app-sync-manager");
    el.setAttribute("instance", "test");
    document.body.appendChild(el);
    await waitFor(() => el.querySelector(".sm-status-tab") !== null, 5000);

    // 驱动私有状态：EntityPlayer 条目含 subdir
    const self = el as unknown as {
      _selectedType: string;
      _allItems: SyncItem[];
      _filteredItems: SyncItem[];
      _typeConfig: Array<{ id: string; dirLevelSync: boolean }>;
      _dirOpen: Record<string, boolean>;
      _repoRoots: Record<string, string>;
      _doRender: () => void;
    };
    self._selectedType = "EntityPlayer";
    self._typeConfig = [{ id: "EntityPlayer", dirLevelSync: true }];
    self._allItems = [
      { path: "x/3d-skin/SceneModel/舞台.pmx", name: "舞台", status: "synced", type: "EntityPlayer", icon: "🎭", size: 10, subdir: "SceneModel" },
      { path: "x/3d-skin/角色A.pmx", name: "角色A", status: "missing", type: "EntityPlayer", icon: "🎭", size: 20 },
      { path: "x/3d-skin/CustomAnim/动作.pmx", name: "动作", status: "synced", type: "EntityPlayer", icon: "🎭", size: 30, subdir: "CustomAnim" },
    ];
    self._filteredItems = self._allItems;
    self._repoRoots = { "EntityPlayer": "/repo" };
    self._dirOpen = {};
    mocks.ScanModelEntriesWithLabel.mockResolvedValue([]);

    self._doRender();
    await sleep(100);
    // 顶层文件夹：SceneModel、CustomAnim、角色A（根下无 subdir 的条目也成文件夹）
    let dirs = el.querySelectorAll(".sm-dir");
    expect(dirs.length).toBe(3);
    // data-path = 后端绝对路径（供 push/pull 消费）；分组文件夹用 subdir 名、根下条目用原始 path
    const dirKeys = Array.from(dirs).map((d) => (d as HTMLElement).dataset.path || "");
    expect(dirKeys).toEqual(expect.arrayContaining(["SceneModel", "CustomAnim", "x/3d-skin/角色A.pmx"]));
    // 未展开无子文件
    expect(el.querySelectorAll(".sm-file").length).toBe(0);
    // 展开 SceneModel → 出现子文件（无 scan 时 files=[]，但文件夹仍可见）
    (dirs[0] as HTMLElement).click();
    await sleep(200);
    // 文件夹行仍在，且箭头变为 ▾
    dirs = el.querySelectorAll(".sm-dir");
    expect((dirs[0] as HTMLElement).querySelector(".sm-dir-arrow")?.textContent).toBe("▾");
    // 展开后 SceneModel 组下出现内部模型行（舞台），data-path 用后端绝对路径
    expect(dirs.length).toBe(4);
    const keysAfter = Array.from(dirs).map((d) => (d as HTMLElement).dataset.path || "");
    expect(keysAfter).toEqual(expect.arrayContaining(["x/3d-skin/SceneModel/舞台.pmx"]));
    // 恢复全局状态
    bus.emit("repo:rtype-changed", "ysm");
    await sleep(100);
    unmountElement(el);
  });

  it("状态筛选标签 → 切换后列表变化（P2 修复：原 if 包裹可空洞通过）", async () => {
    const el = document.createElement("app-sync-manager");
    el.setAttribute("instance", "test");
    document.body.appendChild(el);
    await waitFor(() => el.querySelector(".sm-status-tab") !== null, 5000);
    const statusTabs = el.querySelectorAll(".sm-status-tab");
    const missingTab = Array.from(statusTabs).find(
      (t) => (t as HTMLElement).dataset.status === "missing",
    ) as HTMLElement;
    // 直接断言存在（去掉 if 空洞包裹）
    expect(missingTab).toBeTruthy();
    missingTab.click();
    await sleep(100);
    const active = el.querySelector('.sm-status-tab.active') as HTMLElement;
    expect(active.dataset.status).toBe("missing");
    // 过滤后列表全部为 missing 状态
    const items = el.querySelectorAll(".sm-item[data-status]");
    expect(items.length).toBeGreaterThan(0);
    items.forEach((it) => {
      expect((it as HTMLElement).dataset.status).toBe("missing");
    });
    unmountElement(el);
  });

  // P4 审计新增（陷阱 #3）：异步在途时按钮须灰掉，finally 复位——防用户误判没响应连点
  it("推送在途 → 按钮禁用，完成后复位（陷阱 #3 视觉反馈）", async () => {
    const el = document.createElement("app-sync-manager");
    el.setAttribute("instance", "test");
    document.body.appendChild(el);
    await waitFor(() => el.querySelector('[data-testid="sm-push"]') !== null, 5000);
    const pushBtn = el.querySelector('[data-testid="sm-push"]') as HTMLButtonElement;
    expect(pushBtn.disabled).toBe(false);
    // 让 getApp() await 期间检查禁用态：mock 推迟一拍 resolves
    mocks.PushSingleResourceToInstance.mockImplementationOnce(() =>
      new Promise((r) => setTimeout(() => r(undefined), 100)),
    );
    pushBtn.click();
    // 在途：按钮 disabled=true、opacity=0.55、cursor=wait
    await waitFor(() => (el.querySelector('[data-testid="sm-push"]') as HTMLButtonElement)?.disabled === true, 3000);
    const busyBtn = el.querySelector('[data-testid="sm-push"]') as HTMLButtonElement;
    expect(busyBtn.style.opacity).toBe("0.55");
    expect(busyBtn.style.cursor).toBe("wait");
    // 完成：复位（注意 _render 会重建 DOM，故按钮引用须重取；delta 守卫）
    await waitFor(() => {
      const b = el.querySelector('[data-testid="sm-push"]') as HTMLButtonElement | null;
      return b !== null && b.disabled === false;
    }, 5000);
    const finalBtn = el.querySelector('[data-testid="sm-push"]') as HTMLButtonElement;
    expect(finalBtn.style.opacity).toBe("");
    expect(finalBtn.style.cursor).toBe("");
    unmountElement(el);
  });

  // P4 审计新增（陷阱 #31）：快速连点 3 次 → _singleBusy 重入守卫，仅执行 1 次
  it("快速连点推送 3 次 → 重入守卫，仅执行 1 次（陷阱 #31 重入守卫）", async () => {
    const el = document.createElement("app-sync-manager");
    el.setAttribute("instance", "test");
    document.body.appendChild(el);
    await waitFor(() => el.querySelector('[data-testid="sm-push"]') !== null, 5000);
    const pushBtn = el.querySelector('[data-testid="sm-push"]') as HTMLButtonElement;
    // 推迟 resolves 制造在途窗口
    mocks.PushSingleResourceToInstance.mockImplementation(() =>
      new Promise((r) => setTimeout(() => r(undefined), 150)),
    );
    // 用 delta 断言：mock.calls.length 跨用例累积（vi.hoisted 单例），取差值隔离
    const callsBefore = mocks.PushSingleResourceToInstance.mock.calls.length;
    pushBtn.click();
    pushBtn.click();
    pushBtn.click();
    await sleep(400);
    // 重入守卫：3 次点击仅 1 次真正调到底层 API（delta=1）
    const delta = mocks.PushSingleResourceToInstance.mock.calls.length - callsBefore;
    expect(delta).toBe(1);
    unmountElement(el);
  });

  // P4 审计新增（错误路径）：推送失败 → toast error + 按钮复位（不卡死）
  it("推送失败 → 错误 toast + 按钮复位（陷阱 #3 失败不卡死）", async () => {
    const el = document.createElement("app-sync-manager");
    el.setAttribute("instance", "test");
    document.body.appendChild(el);
    await waitFor(() => el.querySelector('[data-testid="sm-push"]') !== null, 5000);
    const pushBtn = el.querySelector('[data-testid="sm-push"]') as HTMLButtonElement;
    const toastCalls: Array<{ msg: string; type?: string }> = [];
    // P2 修复（codereview）：bus 是模块级单例，bus.on 返回的 unsub 必须调用，
    // 否则监听器泄漏跨测试文件（后续每个 toast:show 都会推入已卸载组件的 toastCalls）
    const offToast = bus.on("toast:show", (payload: { msg: string; type?: string }) => {
      toastCalls.push(payload);
    });
    mocks.PushSingleResourceToInstance.mockRejectedValueOnce(new Error("boom"));
    pushBtn.click();
    await waitFor(() => pushBtn.disabled === false, 5000);
    // 失败也复位按钮（finally），不卡死
    expect(pushBtn.disabled).toBe(false);
    // 至少一条 error 类型 toast
    const errToast = toastCalls.find((c) => c.type === "error");
    expect(errToast).toBeTruthy();
    expect(errToast!.msg).toContain("boom");
    offToast(); // 卸载监听器，防跨测试文件泄漏
    unmountElement(el);
  });

  it("dirLevelSync 类型（blueprint）→ 文件夹行 + 展开扫出子文件（missing 条目也可展开）", async () => {
    const el = document.createElement("app-sync-manager");
    el.setAttribute("instance", "test");
    document.body.appendChild(el);
    await waitFor(() => el.querySelector(".sm-status-tab") !== null, 5000);

    // 直接驱动组件私有状态（绕过 mock 链的多重 getApp 调用，避免 mockResolvedValue 被 afterEach 还原污染）
    const self = el as unknown as {
      _selectedType: string;
      _allItems: Array<{ path: string; name: string; status: string; type: string; icon: string; size: number }>;
      _filteredItems: Array<{ path: string; name: string; status: string; type: string; icon: string; size: number }>;
      _typeConfig: Array<{ id: string; name: string; icon: string; dirLevelSync: boolean }>;
      _dirOpen: Record<string, boolean>;
      _repoRoots: Record<string, string>;
      _doRender: () => void;
    };
    self._selectedType = "blueprint";
    self._typeConfig = [{ id: "blueprint", name: "蓝图", icon: "⚙️", dirLevelSync: true }];
    // 真实场景：蓝图在仓库、整合包缺失 → missing；path 为仓库绝对路径
    self._allItems = [
      { path: "D:/YSM管理器测试文件夹/minecraft-mod/blueprint/hello_new_generation_core", name: "hello_new_generation_core", status: "missing", type: "blueprint", icon: "⚙️", size: 4096 },
    ];
    self._filteredItems = self._allItems;
    self._repoRoots = { "blueprint": "/repo" };
    self._dirOpen = {};

    mocks.ScanModelEntriesWithLabel.mockResolvedValue([
      { Name: "建筑.nbt", Path: "D:/YSM管理器测试文件夹/minecraft-mod/blueprint/hello_new_generation_core/建筑.nbt", Size: 2048 },
      { Name: "建筑.schematic", Path: "D:/YSM管理器测试文件夹/minecraft-mod/blueprint/hello_new_generation_core/建筑.schematic", Size: 1024 },
    ]);

    self._doRender();
    await sleep(100);
    // 未展开：只有文件夹行
    let dirs = el.querySelectorAll(".sm-dir");
    expect(dirs.length).toBe(1);
    expect(el.querySelectorAll(".sm-file").length).toBe(0);
    // 点击展开（missing 条目也应能扫描出仓库内 nbt）
    (dirs[0] as HTMLElement).click();
    await sleep(300);
    dirs = el.querySelectorAll(".sm-dir");
    const arrow = (dirs[0] as HTMLElement).querySelector(".sm-dir-arrow");
    expect(arrow?.textContent).toBe("▾");
    expect(el.querySelectorAll(".sm-file").length).toBe(2);
    expect(Array.from(el.querySelectorAll(".sm-file")).map((f) => f.textContent || "")).toEqual(
      expect.arrayContaining([expect.stringContaining("建筑.nbt"), expect.stringContaining("建筑.schematic")]),
    );
    // 点击折叠
    (dirs[0] as HTMLElement).click();
    await sleep(300);
    dirs = el.querySelectorAll(".sm-dir");
    expect((dirs[0] as HTMLElement).querySelector(".sm-dir-arrow")?.textContent).toBe("▸");
    expect(el.querySelectorAll(".sm-file").length).toBe(0);
    unmountElement(el);
  });
});