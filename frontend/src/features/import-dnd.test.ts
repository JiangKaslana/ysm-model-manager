// ===== DnD 全局拖拽守卫测试 =====
// 守卫层：PageStore 页面守卫 / registerDnD 资源配对
// 收集层：webkitGetAsEntry 假条目驱动 collectFiles（文件夹递归/超时/去重/oversize/错误兜底）
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bus } from "../bus.ts";
import { registerPageStore } from "../core/page-store.ts";
import { registerDnD } from "./import-dnd.ts";
import { fireDrop, fireDrag } from "../test-utils/events.ts";
import { MAX_IMPORT_BYTES } from "../backend/browser-adapter.ts";

vi.mock("../backend/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({
    ImportModelFile: vi.fn().mockResolvedValue(undefined),
    DetectZipType: vi.fn().mockResolvedValue("ysm"),
  }),
}));

// 网页版分支（ADR-049 Phase 3）：browserAdapter 的 importWebFiles 直写 IndexedDB
const { importWebFilesMock } = vi.hoisted(() => ({
  importWebFilesMock: vi.fn().mockResolvedValue({ imported: 1, failed: 0 }),
}));
vi.mock("../backend/browser-adapter.ts", () => ({
  importWebFiles: importWebFilesMock,
  // P3 修复（审核）：mock 缺 MAX_IMPORT_BYTES 导出——import-dnd.ts:273 的 oversize
  // 过滤读取它，缺导出时 onDrop 抛错、getApp 从未被调用（守卫层 3 项测试假失败）
  MAX_IMPORT_BYTES: 100 * 1024 * 1024,
}));

import { getApp } from "../backend/app.ts";
import { importWebFiles } from "../backend/browser-adapter.ts";

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

// jsdom 无 DragEvent 构造器：用 Event + cast（守卫层测试不依赖 dataTransfer 细节）
const dropEvent = (): DragEvent => new Event("drop", { cancelable: true }) as DragEvent;

describe("registerDnD 资源配对", () => {
  const unsubs: Array<() => void> = [];

  beforeEach(() => {
    unsubs.length = 0;
    document.querySelectorAll("#global-drop-overlay").forEach((el) => el.remove());
  });

  afterEach(() => {
    unsubs.forEach((fn) => fn());
    unsubs.length = 0;
    // 清理网页版标记，防跨用例污染（resolveWebMode 依赖 globalThis）
    delete (globalThis as unknown as Record<string, unknown>)["__YSM_BACKEND__"];
    importWebFilesMock.mockClear();
    (getApp as ReturnType<typeof vi.fn>).mockClear();
  });

  it("注册 5 个 document listener，unsubs 清理时全部移除", () => {
    const addSpy = vi.spyOn(document, "addEventListener");
    const removeSpy = vi.spyOn(document, "removeEventListener");
    registerDnD(unsubs);
    expect(addSpy).toHaveBeenCalledTimes(5); // dragenter/dragover/dragleave/drop/dragend
    unsubs.forEach((fn) => fn());
    expect(removeSpy).toHaveBeenCalledTimes(5);
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});

describe("DnD 守卫层", () => {
  const pageUnsubs: Array<() => void> = [];
  const dndUnsubs: Array<() => void> = [];

  beforeEach(() => {
    (getApp as unknown as ReturnType<typeof vi.fn>).mockClear();
    pageUnsubs.length = 0;
    dndUnsubs.length = 0;
    registerPageStore(pageUnsubs);
    bus.emit("nav:changed", { page: "repository" });
    registerDnD(dndUnsubs);
  });

  afterEach(() => {
    pageUnsubs.forEach((fn) => fn());
    dndUnsubs.forEach((fn) => fn());
  });

  it("非仓库页 drop 带文件 → 页面守卫拦截（getApp 零调用）", async () => {
    bus.emit("nav:changed", { page: "settings" });
    fireDrop(document, { items: [], files: [new File(["a"], "model.ysm", { type: "application/octet-stream" })], types: ["Files"] });
    await flush();
    await flush();
    expect(getApp).not.toHaveBeenCalled();
  });

  it("仓库页 drop 带文件 → 放行触发导入（getApp 被调用，对照组）", async () => {
    bus.emit("nav:changed", { page: "repository" });
    fireDrop(document, { items: [], files: [new File(["a"], "model.ysm", { type: "application/octet-stream" })], types: ["Files"] });
    await flush();
    await flush();
    expect(getApp).toHaveBeenCalled();
  });

  it("drop 在途时二次 drop 被互斥忽略（getApp 只调一次，busy toast 提示）", async () => {
    bus.emit("nav:changed", { page: "repository" });
    const toastSpy = vi.fn();
    const unsubToast = bus.on("toast:show", (p) => toastSpy(p.msg));
    // 第一次 drop：onDrop 同步跑到 executeCollected 的 await 点，_dropBusy 已置 true
    fireDrop(document, { items: [], files: [new File(["a"], "model.ysm", { type: "application/octet-stream" })], types: ["Files"] });
    // 第二次 drop：此刻 _dropBusy 仍为 true → 应被忽略，不产生第二次导入
    fireDrop(document, { items: [], files: [new File(["a"], "model.ysm", { type: "application/octet-stream" })], types: ["Files"] });
    await flush();
    await flush();
    expect(getApp).toHaveBeenCalledTimes(1);
    expect(toastSpy).toHaveBeenCalled();
    expect(String(toastSpy.mock.calls[0][0])).toContain("正在导入");
    unsubToast();
  });

  it("首次 drop 完成后释放互斥（后续 drop 仍被处理）", async () => {
    bus.emit("nav:changed", { page: "repository" });
    fireDrop(document, { items: [], files: [new File(["a"], "model.ysm", { type: "application/octet-stream" })], types: ["Files"] });
    await flush();
    await flush();
    expect(getApp).toHaveBeenCalledTimes(1);
    // 第一次完全 settle（finally 已复位 _dropBusy）后，再 drop 应照常导入
    fireDrop(document, { items: [], files: [new File(["a"], "model.ysm", { type: "application/octet-stream" })], types: ["Files"] });
    await flush();
    await flush();
    expect(getApp).toHaveBeenCalledTimes(2);
  });

  it("仓库页 drop 无文件时 toast 提示", async () => {
    const toastSpy = vi.fn();
    const unsubToast = bus.on("toast:show", (p) => toastSpy(p.msg));
    document.dispatchEvent(dropEvent());
    await flush();
    expect(toastSpy).toHaveBeenCalled();
    expect(String(toastSpy.mock.calls[0][0])).toContain("未检测到");
    unsubToast();
  });

  it("unsubs 清理后 drop 不再有副作用", async () => {
    dndUnsubs.forEach((fn) => fn());
    dndUnsubs.length = 0;
    const toastSpy = vi.fn();
    const unsubToast = bus.on("toast:show", (p) => toastSpy(p.msg));
    document.dispatchEvent(dropEvent());
    await flush();
    expect(toastSpy).not.toHaveBeenCalled();
    unsubToast();
  });
});

describe("网页版 DnD（ADR-049 Phase 3：browserAdapter 分支）", () => {
  const pageUnsubs: Array<() => void> = [];
  const dndUnsubs: Array<() => void> = [];

  beforeEach(() => {
    pageUnsubs.length = 0;
    dndUnsubs.length = 0;
    registerPageStore(pageUnsubs);
    registerDnD(dndUnsubs);
  });

  afterEach(() => {
    pageUnsubs.forEach((fn) => fn());
    dndUnsubs.forEach((fn) => fn());
    delete (globalThis as unknown as Record<string, unknown>)["__YSM_BACKEND__"];
    importWebFilesMock.mockClear();
  });

  it("resolveWebMode → importWebFiles 入库 + toast + tree:reload + getApp 零调用", async () => {
    (globalThis as unknown as Record<string, unknown>)["__YSM_BACKEND__"] = "browser";
    const { resolveWebMode } = await import("../backend/platform.ts");
    expect(resolveWebMode()).toBe(true);
    bus.emit("nav:changed", { page: "repository" });
    const toastSpy = vi.fn();
    const reloadSpy = vi.fn();
    const unsubToast = bus.on("toast:show", (p) => toastSpy(p.msg));
    const unsubReload = bus.on("tree:reload", () => reloadSpy());
    fireDrop(document, {
      items: [],
      files: [new File(["ysm"], "m.ysm", { type: "application/octet-stream" })],
      types: ["Files"],
    });
    await flush();
    await flush();
    expect(importWebFiles).toHaveBeenCalledTimes(1);
    expect((importWebFiles as ReturnType<typeof vi.fn>).mock.calls[0][0][0].name).toBe("m.ysm");
    expect((importWebFiles as ReturnType<typeof vi.fn>).mock.calls[0][1]).toBe("ysm");
    expect(reloadSpy).toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalled();
    expect(String(toastSpy.mock.calls[0][0])).toContain("1 个模型已导入");
    expect(getApp).not.toHaveBeenCalled();
    unsubToast();
    unsubReload();
  });

  it("网页版导入部分失败 → warn 文案带失败数", async () => {
    (globalThis as unknown as Record<string, unknown>)["__YSM_BACKEND__"] = "browser";
    bus.emit("nav:changed", { page: "repository" });
    importWebFilesMock.mockResolvedValueOnce({ imported: 2, failed: 1 });
    const toastSpy = vi.fn();
    const unsubToast = bus.on("toast:show", (p) => toastSpy(p.msg));
    fireDrop(document, {
      items: [],
      files: [new File(["a"], "a.ysm"), new File(["b"], "b.ysm")],
      types: ["Files"],
    });
    await flush();
    await flush();
    expect(String(toastSpy.mock.calls[0][0])).toContain("2 个导入成功，1 个失败");
    unsubToast();
  });

  it("网页版拖入文件夹（dataTransfer.files 为空）→ warn toast 提示暂不支持", async () => {
    (globalThis as unknown as Record<string, unknown>)["__YSM_BACKEND__"] = "browser";
    bus.emit("nav:changed", { page: "repository" });
    const toastSpy = vi.fn();
    const unsubToast = bus.on("toast:show", (p) => toastSpy(p.msg));
    fireDrop(document, { items: [], files: [], types: ["Files"] });
    await flush();
    await flush();
    expect(toastSpy).toHaveBeenCalled();
    expect(String(toastSpy.mock.calls[0][0])).toContain("暂不支持文件夹导入");
    expect(importWebFiles).not.toHaveBeenCalled();
    unsubToast();
  });
});

describe("拖拽遮罩隐藏状态机（dragDepth 计数器）", () => {
  const pageUnsubs: Array<() => void> = [];
  const dndUnsubs: Array<() => void> = [];

  // jsdom 无 DragEvent 真实实现：用 Event + defineProperty 注入 dataTransfer / relatedTarget
  const makeDrag = (
    type: string,
    relatedTarget: EventTarget | null,
    types: string[] = ["Files"],
  ): DragEvent => {
    const ev = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(ev, "dataTransfer", {
      value: { types, items: [], dropEffect: "" },
      configurable: true,
    });
    Object.defineProperty(ev, "relatedTarget", {
      value: relatedTarget,
      configurable: true,
    });
    return ev;
  };

  beforeEach(() => {
    pageUnsubs.length = 0;
    dndUnsubs.length = 0;
    document.querySelectorAll("#global-drop-overlay").forEach((el) => el.remove());
    registerPageStore(pageUnsubs);
    bus.emit("nav:changed", { page: "repository" });
    registerDnD(dndUnsubs);
  });

  afterEach(() => {
    pageUnsubs.forEach((fn) => fn());
    dndUnsubs.forEach((fn) => fn());
    document.querySelectorAll("#global-drop-overlay").forEach((el) => el.remove());
  });

  it("进入即显示；子元素穿梭不隐藏；relatedTarget=null 才隐藏", () => {
    document.dispatchEvent(makeDrag("dragenter", document.body));
    document.dispatchEvent(makeDrag("dragenter", document.body)); // 进入子元素
    let ov = document.getElementById("global-drop-overlay");
    expect(ov).not.toBeNull();
    expect(ov!.style.display).not.toBe("none");

    // 子元素间穿梭：leave 落到真实元素（relatedTarget 非 null）→ 计数器 -1，不隐藏
    document.dispatchEvent(makeDrag("dragleave", document.body));
    ov = document.getElementById("global-drop-overlay");
    expect(ov!.style.display).not.toBe("none");

    // 真正离开视口：relatedTarget 为 null → 隐藏并归零
    document.dispatchEvent(makeDrag("dragleave", null));
    ov = document.getElementById("global-drop-overlay");
    expect(ov!.style.display).toBe("none");
  });
});

// ===== 桌面收集层（webkitGetAsEntry 假条目驱动 collectFiles）=====
// 深层收集逻辑依赖浏览器 DnD API：用 duck-typed 假条目注入 dataTransfer.items 驱动内部 collectFiles
describe("DnD 桌面收集层 — 文件夹递归与单文件路径", () => {
  const pageUnsubs: Array<() => void> = [];
  const dndUnsubs: Array<() => void> = [];

  /** 假文件条目：entry.file(cb, ecb) 回调式（可注入自定义实现） */
  const fileEntry = (
    name: string,
    file: File,
    fileImpl?: (cb: (f: File) => void, ecb: (e: unknown) => void) => void,
  ): unknown => ({
    isFile: true,
    isDirectory: false,
    name,
    file: fileImpl ?? ((cb: (f: File) => void) => cb(file)),
  });

  /** 假目录条目：readEntries 分批返回（第 i 次调用取 batches[i]，耗尽返回空数组） */
  const batchedDir = (name: string, batches: Array<() => unknown[]>): unknown => ({
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => {
      let i = 0;
      return { readEntries: (cb: (e: unknown[]) => void) => cb((batches[i++]?.() ?? []) as unknown[]) };
    },
  });

  /** 假 DataTransferItem：kind=file + webkitGetAsEntry */
  const dndItem = (entry: unknown): unknown => ({
    kind: "file",
    webkitGetAsEntry: () => entry,
  });

  /**
   * 等待 drop 链到达 getApp（executeCollected 已执行）。
   * FileReader（fileToBase64）按文件数消耗 macrotask 轮次，固定 flush 次数不可靠；
   * 轮询直到 getApp 被调用达到 expected 次（每个 directImport/importFolder 各调一次），
   * 再补一拍让 ImportModelFolder/ImportModelFile 落地。
   */
  const waitForImport = async (expected = 1, tries = 200): Promise<void> => {
    const g = getApp as unknown as ReturnType<typeof vi.fn>;
    for (let i = 0; i < tries; i++) {
      if (g.mock.calls.length >= expected) break;
      await flush();
    }
    await flush();
  };

  beforeEach(() => {
    pageUnsubs.length = 0;
    dndUnsubs.length = 0;
    document.querySelectorAll("#global-drop-overlay").forEach((el) => el.remove());
    registerPageStore(pageUnsubs);
    bus.emit("nav:changed", { page: "repository" });
    registerDnD(dndUnsubs);
    // 桌面流需要 ImportModelFolder（文件夹整组）与 ImportModelFile（单文件直导）
    (getApp as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ImportModelFile: vi.fn().mockResolvedValue(undefined),
      ImportModelFolder: vi.fn().mockResolvedValue(undefined),
    });
  });

  afterEach(() => {
    pageUnsubs.forEach((fn) => fn());
    dndUnsubs.forEach((fn) => fn());
    document.querySelectorAll("#global-drop-overlay").forEach((el) => el.remove());
    delete (globalThis as unknown as Record<string, unknown>)["__YSM_BACKEND__"];
    (getApp as unknown as ReturnType<typeof vi.fn>).mockClear();
  });

  it("嵌套文件夹递归收集：保留完整 relPath，整组走 ImportModelFolder", async () => {
    const fileA = new File(["ysm"], "a.ysm");
    const sub = batchedDir("sub", [() => [fileEntry("a.ysm", fileA)], () => []]);
    const pkg = batchedDir("pkg", [() => [sub], () => []]);
    fireDrop(document, { items: [dndItem(pkg)], files: [], types: ["Files"] });
    await waitForImport();
    const { ImportModelFolder } = await getApp();
    const ImportModelFolderMock = ImportModelFolder as unknown as ReturnType<typeof vi.fn>;
    expect(ImportModelFolderMock).toHaveBeenCalledTimes(1);
    const [folderName, subpath, items] = ImportModelFolderMock.mock.calls[0] as [
      string, string, Array<{ RelPath: string; Base64: string }>,
    ];
    expect(folderName).toBe("pkg");
    expect(subpath).toBe("");
    expect(items).toHaveLength(1);
    expect(items[0].RelPath).toBe("sub/a.ysm");
  });

  it("深度守卫：readEntries 超过 10 轮即截断（防深层递归卡顿）", async () => {
    const fileX = new File(["x"], "f.ysm");
    let calls = 0;
    const endless = {
      isFile: false,
      isDirectory: true,
      name: "deep",
      createReader: () => ({
        readEntries: (cb: (e: unknown[]) => void) => {
          calls++;
          cb([fileEntry("f.ysm", fileX)]);
        },
      }),
    };
    fireDrop(document, { items: [dndItem(endless)], files: [], types: ["Files"] });
    await waitForImport();
    // depth 0..10 共 11 轮后 readAll(11) 提前返回，不再读第 12 批
    expect(calls).toBe(11);
    const { ImportModelFolder } = await getApp();
    const ImportModelFolderMock = ImportModelFolder as unknown as ReturnType<typeof vi.fn>;
    const [, , items] = ImportModelFolderMock.mock.calls[0] as [
      string, string, Array<{ RelPath: string; Base64: string }>,
    ];
    expect(items).toHaveLength(11);
  });

  it("目录 readEntries 失败（error 回调）→ 整目录跳过 + console.warn", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const badDir = {
      isFile: false,
      isDirectory: true,
      name: "bad",
      createReader: () => ({
        readEntries: (_cb: (e: unknown[]) => void, ecb: () => void) => ecb(),
      }),
    };
    fireDrop(document, { items: [dndItem(badDir)], files: [], types: ["Files"] });
    await flush();
    await flush();
    expect(warnSpy).toHaveBeenCalled();
    expect(String(warnSpy.mock.calls[0][0])).toContain("目录读取失败");
    const { ImportModelFolder } = await getApp();
    expect(ImportModelFolder).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("entry.file 错误回调 → 单文件跳过 + console.warn（不拖垮整批）", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ok = fileEntry("ok.ysm", new File(["ysm"], "ok.ysm"));
    const bad = fileEntry("broken.ysm", new File(["x"], "broken.ysm"), (_cb, ecb) =>
      ecb(new Error("denied")),
    );
    const pkg = batchedDir("pkg", [() => [ok, bad], () => []]);
    fireDrop(document, { items: [dndItem(pkg)], files: [], types: ["Files"] });
    await waitForImport();
    expect(warnSpy).toHaveBeenCalled();
    expect(String(warnSpy.mock.calls[0][0])).toContain("单文件读取失败");
    // 好文件仍整组导入
    const { ImportModelFolder } = await getApp();
    const ImportModelFolderMock = ImportModelFolder as unknown as ReturnType<typeof vi.fn>;
    expect(ImportModelFolderMock).toHaveBeenCalledTimes(1);
    const [, , items] = ImportModelFolderMock.mock.calls[0] as [
      string, string, Array<{ RelPath: string; Base64: string }>,
    ];
    expect(items).toHaveLength(1);
    expect(items[0].RelPath).toBe("ok.ysm");
    warnSpy.mockRestore();
  });

  it("entry.file 超时（5s 无回调）→ reject + console.warn（防 onDrop 挂起）", async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const hung = fileEntry("hung.ysm", new File(["x"], "hung.ysm"), () => {
      /* 永不回调 → 走 5s 超时 */
    });
    fireDrop(document, { items: [dndItem(hung)], files: [], types: ["Files"] });
    await vi.advanceTimersByTimeAsync(5000);
    expect(warnSpy).toHaveBeenCalled();
    expect(String(warnSpy.mock.calls[0][0])).toContain("单文件读取失败");
    warnSpy.mockRestore();
    vi.useRealTimers();
  });

  it("webkitGetAsEntry 缺失 → getAsFile 兜底（relPath 用文件名）", async () => {
    const fileB = new File(["ysm"], "b.ysm", { type: "application/octet-stream" });
    const fallbackItem = { kind: "file", getAsFile: () => fileB };
    fireDrop(document, { items: [fallbackItem as never], files: [], types: ["Files"] });
    await waitForImport();
    const { ImportModelFile } = await getApp();
    const ImportModelFileMock = ImportModelFile as unknown as ReturnType<typeof vi.fn>;
    expect(ImportModelFileMock).toHaveBeenCalledTimes(1);
    expect(ImportModelFileMock.mock.calls[0][0]).toBe("b.ysm");
  });

  it("非文件 kind 条目（如 text/plain）→ 跳过不收集", async () => {
    fireDrop(document, { items: [{ kind: "string", data: "hi" } as never], files: [], types: ["Files"] });
    await flush();
    await flush();
    const { ImportModelFile } = await getApp();
    expect(ImportModelFile).not.toHaveBeenCalled();
  });
});

describe("DnD 桌面收集层 — 去重与 oversize", () => {
  const pageUnsubs: Array<() => void> = [];
  const dndUnsubs: Array<() => void> = [];

  const fileEntry = (name: string, file: File): unknown => ({
    isFile: true,
    isDirectory: false,
    name,
    file: (cb: (f: File) => void) => cb(file),
  });
  const dndItem = (entry: unknown): unknown => ({
    kind: "file",
    webkitGetAsEntry: () => entry,
  });

  /** 等待 drop 链到达 getApp（executeCollected 已执行），再补一拍落地导入调用 */
  const waitForImport = async (expected = 1, tries = 200): Promise<void> => {
    const g = getApp as unknown as ReturnType<typeof vi.fn>;
    for (let i = 0; i < tries; i++) {
      if (g.mock.calls.length >= expected) break;
      await flush();
    }
    await flush();
  };

  beforeEach(() => {
    pageUnsubs.length = 0;
    dndUnsubs.length = 0;
    document.querySelectorAll("#global-drop-overlay").forEach((el) => el.remove());
    registerPageStore(pageUnsubs);
    bus.emit("nav:changed", { page: "repository" });
    registerDnD(dndUnsubs);
    (getApp as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ImportModelFile: vi.fn().mockResolvedValue(undefined),
    });
  });

  afterEach(() => {
    pageUnsubs.forEach((fn) => fn());
    dndUnsubs.forEach((fn) => fn());
    document.querySelectorAll("#global-drop-overlay").forEach((el) => el.remove());
    delete (globalThis as unknown as Record<string, unknown>)["__YSM_BACKEND__"];
    (getApp as unknown as ReturnType<typeof vi.fn>).mockClear();
  });

  it("去重：entry 与 files 双路径命中同一文件 → 只导入一次（name+size+lastModified 稳定键）", async () => {
    const same = new File(["ysm"], "m.ysm", { type: "application/octet-stream" });
    fireDrop(document, {
      items: [dndItem(fileEntry("m.ysm", same))],
      files: [same],
      types: ["Files"],
    });
    await waitForImport();
    const { ImportModelFile } = await getApp();
    const ImportModelFileMock = ImportModelFile as unknown as ReturnType<typeof vi.fn>;
    expect(ImportModelFileMock).toHaveBeenCalledTimes(1);
    expect(ImportModelFileMock.mock.calls[0][0]).toBe("m.ysm");
  });

  it("双路径不同文件 → 均保留（2 次导入）", async () => {
    const a = new File(["ysm"], "a.ysm", { type: "application/octet-stream" });
    const b = new File(["ysm"], "b.ysm", { type: "application/octet-stream" });
    fireDrop(document, {
      items: [dndItem(fileEntry("a.ysm", a))],
      files: [b],
      types: ["Files"],
    });
    await waitForImport(2);
    const { ImportModelFile } = await getApp();
    const ImportModelFileMock = ImportModelFile as unknown as ReturnType<typeof vi.fn>;
    expect(ImportModelFileMock).toHaveBeenCalledTimes(2);
    expect(ImportModelFileMock.mock.calls[0][0]).toBe("a.ysm");
    expect(ImportModelFileMock.mock.calls[1][0]).toBe("b.ysm");
  });

  it("oversize 过滤：超限文件跳过、合法项继续导入（warn toast 列名）", async () => {
    const big = new File(["x"], "big.ysm", { type: "application/octet-stream" });
    Object.defineProperty(big, "size", { value: MAX_IMPORT_BYTES + 1, configurable: true });
    const small = new File(["x"], "small.ysm", { type: "application/octet-stream" });
    const toastSpy = vi.fn();
    const unsubToast = bus.on("toast:show", (p) => toastSpy(p.msg));
    fireDrop(document, { items: [], files: [big, small], types: ["Files"] });
    await waitForImport();
    const { ImportModelFile } = await getApp();
    const ImportModelFileMock = ImportModelFile as unknown as ReturnType<typeof vi.fn>;
    expect(ImportModelFileMock).toHaveBeenCalledTimes(1);
    expect(ImportModelFileMock.mock.calls[0][0]).toBe("small.ysm");
    const oversizeToast = toastSpy.mock.calls.some((c) =>
      String(c[0]).includes("超过") && String(c[0]).includes("上限已跳过"),
    );
    expect(oversizeToast).toBe(true);
    unsubToast();
  });

  it("getAsFile 返回 null（空文件项）→ 跳过不收集", async () => {
    const emptyItem = { kind: "file", getAsFile: () => null };
    fireDrop(document, { items: [emptyItem as never], files: [], types: ["Files"] });
    await flush();
    await flush();
    const { ImportModelFile } = await getApp();
    expect(ImportModelFile).not.toHaveBeenCalled();
  });

  it("全部文件超限 → 过滤后收集为空，直接 return（不再调 execute）", async () => {
    const big1 = new File(["x"], "big1.ysm", { type: "application/octet-stream" });
    Object.defineProperty(big1, "size", { value: MAX_IMPORT_BYTES + 1, configurable: true });
    const big2 = new File(["x"], "big2.ysm", { type: "application/octet-stream" });
    Object.defineProperty(big2, "size", { value: MAX_IMPORT_BYTES + 2, configurable: true });
    const toastSpy = vi.fn();
    const unsubToast = bus.on("toast:show", (p) => toastSpy(p.msg));
    fireDrop(document, { items: [], files: [big1, big2], types: ["Files"] });
    await flush();
    await flush();
    const { ImportModelFile } = await getApp();
    expect(ImportModelFile).not.toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalled();
    unsubToast();
  });

  it("收集到文件但全部不可导入（.txt）→ execute 后 toast 提示（r.folders=0 且 r.singles=0）", async () => {
    const toastSpy = vi.fn();
    const unsubToast = bus.on("toast:show", (p) => toastSpy(p.msg));
    fireDrop(document, {
      items: [],
      files: [new File(["x"], "note.txt", { type: "text/plain" })],
      types: ["Files"],
    });
    await flush();
    await flush();
    await flush();
    expect(String(toastSpy.mock.calls[0][0])).toContain("未检测到支持的模型文件");
    const { ImportModelFile } = await getApp();
    expect(ImportModelFile).not.toHaveBeenCalled();
    unsubToast();
  });
});

describe("DnD dragover / dragend / 可编辑目标守卫", () => {
  const pageUnsubs: Array<() => void> = [];
  const dndUnsubs: Array<() => void> = [];

  beforeEach(() => {
    pageUnsubs.length = 0;
    dndUnsubs.length = 0;
    document.querySelectorAll("#global-drop-overlay").forEach((el) => el.remove());
    registerPageStore(pageUnsubs);
    bus.emit("nav:changed", { page: "repository" });
    registerDnD(dndUnsubs);
  });

  afterEach(() => {
    pageUnsubs.forEach((fn) => fn());
    dndUnsubs.forEach((fn) => fn());
    document.querySelectorAll("#global-drop-overlay").forEach((el) => el.remove());
  });

  it("dragover 文件 → preventDefault + dropEffect=copy + 遮罩显示", () => {
    const ev = fireDrag(document, "dragover", { types: ["Files"], items: [], dropEffect: "" });
    expect(ev.defaultPrevented).toBe(true);
    expect((ev.dataTransfer as { dropEffect: string }).dropEffect).toBe("copy");
    const ov = document.getElementById("global-drop-overlay");
    expect(ov).not.toBeNull();
    expect(ov!.style.display).toBe("flex");
  });

  it("dragover 非文件 types → 不拦截（无 preventDefault、无遮罩）", () => {
    const ev = fireDrag(document, "dragover", { types: ["text/plain"], items: [], dropEffect: "" });
    expect(ev.defaultPrevented).toBe(false);
    expect(document.getElementById("global-drop-overlay")).toBeNull();
  });

  it("dragenter/dragover 目标为 input 等可编辑元素 → 不显示遮罩", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    const enterEv = fireDrag(input, "dragenter", { types: ["Files"], items: [], dropEffect: "" });
    expect(enterEv.defaultPrevented).toBe(false);
    const overEv = fireDrag(input, "dragover", { types: ["Files"], items: [], dropEffect: "" });
    expect(overEv.defaultPrevented).toBe(false);
    expect(document.getElementById("global-drop-overlay")).toBeNull();
    input.remove();
  });

  it("非仓库页 dragover → 忽略", () => {
    bus.emit("nav:changed", { page: "settings" });
    const ev = fireDrag(document, "dragover", { types: ["Files"], items: [], dropEffect: "" });
    expect(ev.defaultPrevented).toBe(false);
    expect(document.getElementById("global-drop-overlay")).toBeNull();
  });

  it("drop 目标为可编辑元素 → 不处理（isEditable 守卫，零副作用）", async () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    const toastSpy = vi.fn();
    const unsubToast = bus.on("toast:show", (p) => toastSpy(p.msg));
    fireDrop(input, {
      items: [],
      files: [new File(["a"], "m.ysm", { type: "application/octet-stream" })],
      types: ["Files"],
    });
    await flush();
    await flush();
    expect(toastSpy).not.toHaveBeenCalled();
    const { ImportModelFile } = await getApp();
    expect(ImportModelFile).not.toHaveBeenCalled();
    unsubToast();
    input.remove();
  });

  it("dragend 兜底收起遮罩（拖拽取消/未触发 drop 场景）", () => {
    fireDrag(document, "dragenter", { types: ["Files"], items: [], dropEffect: "" });
    const ov = document.getElementById("global-drop-overlay")!;
    expect(ov.style.display).toBe("flex");
    document.dispatchEvent(new Event("dragend"));
    expect(ov.style.display).toBe("none");
  });

  it("dragleave 坐标越界（relatedTarget 非 null）→ 兜底隐藏遮罩", () => {
    fireDrag(document, "dragenter", { types: ["Files"], items: [], dropEffect: "" });
    const ov = document.getElementById("global-drop-overlay")!;
    const ev = new DragEvent("dragleave", {
      bubbles: true,
      cancelable: true,
      clientX: -10,
    });
    Object.defineProperty(ev, "dataTransfer", { value: { types: ["Files"] }, configurable: true });
    Object.defineProperty(ev, "relatedTarget", { value: document.body, configurable: true });
    document.dispatchEvent(ev);
    expect(ov.style.display).toBe("none");
  });
});

describe("DnD 错误兜底（onDropSafe）", () => {
  it("onDrop 内部异常 → console.error + 错误 toast（防 unhandled rejection）", async () => {
    const pageUnsubs: Array<() => void> = [];
    const dndUnsubs: Array<() => void> = [];
    registerPageStore(pageUnsubs);
    (globalThis as unknown as Record<string, unknown>)["__YSM_BACKEND__"] = "browser";
    bus.emit("nav:changed", { page: "repository" });
    registerDnD(dndUnsubs);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const toastSpy = vi.fn();
    const unsubToast = bus.on("toast:show", (p) => toastSpy(p.msg));
    importWebFilesMock.mockRejectedValueOnce(new Error("boom"));
    fireDrop(document, {
      items: [],
      files: [new File(["ysm"], "m.ysm")],
      types: ["Files"],
    });
    await flush();
    await flush();
    await flush();
    expect(errSpy).toHaveBeenCalled();
    expect(String(errSpy.mock.calls[0][0])).toContain("拖放处理失败");
    expect(toastSpy).toHaveBeenCalled();
    expect(String(toastSpy.mock.calls[0][0])).toContain("处理出错");
    unsubToast();
    errSpy.mockRestore();
    pageUnsubs.forEach((fn) => fn());
    dndUnsubs.forEach((fn) => fn());
    delete (globalThis as unknown as Record<string, unknown>)["__YSM_BACKEND__"];
    importWebFilesMock.mockClear();
  });
});
