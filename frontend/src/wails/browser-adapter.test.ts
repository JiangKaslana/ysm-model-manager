// ===== 浏览器后端适配器测试（ADR-049 Phase 1 骨架 + Phase 2 IndexedDB 模型库）=====
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  browserAdapter,
  WebUnsupportedError,
  importWebFiles,
  selectLocalRepo,
  WEB_ROOT,
} from "./browser-adapter.ts";

// idb 层内存实现（真实 indexedDB 仅在浏览器存在，测试注入 Map 语义）
const idbMock = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  return {
    idbGet: vi.fn(async (_s: string, k: string) => store.get(k)),
    idbSet: vi.fn(async (_s: string, k: string, v: unknown) => {
      store.set(k, v);
    }),
    idbKeys: vi.fn(async (_s: string, prefix: string) =>
      [...store.keys()].filter((k) => k.startsWith(prefix)),
    ),
    // P3 修复（code review）：mock 缺 idbDel——importWebFiles 回滚路径在测试中
    // 解析到 undefined，任何触发回滚的用例都会 TypeError（被 best-effort catch 吞掉，
    // 测试假绿而清理永不执行）
    idbDel: vi.fn(async (_s: string, k: string) => {
      store.delete(k);
    }),
    _store: store,
  };
});

vi.mock("./idb.ts", () => ({
  idbGet: idbMock.idbGet,
  idbSet: idbMock.idbSet,
  idbKeys: idbMock.idbKeys,
  idbDel: idbMock.idbDel,
}));

const enc = new TextEncoder();

beforeEach(() => {
  vi.clearAllMocks();
  idbMock._store.clear();
  localStorage.clear();
});

describe("browserAdapter — 虚拟根与仓库路径", () => {
  it("GetDefaultRepoRoot → /web；GetRepoRoot(type) → /web/<type>", async () => {
    expect(await browserAdapter.GetDefaultRepoRoot()).toBe(WEB_ROOT);
    expect(await browserAdapter.GetRepoRoot("ysm")).toBe("/web/ysm");
  });
});

describe("browserAdapter — Phase 2 模型库（IndexedDB）", () => {
  it("空库 ScanModelEntries → []", async () => {
    expect(await browserAdapter.ScanModelEntries("/web/ysm")).toEqual([]);
  });

  it("导入后 ScanModelEntries 返回条目（Name 含扩展名 / Path / Size 与 IDB 一致）", async () => {
    await importWebFiles([new File([enc.encode("YSM")], "狐狸.ysm", { type: "application/octet-stream" })], "ysm");
    const entries = (await browserAdapter.ScanModelEntries("/web/ysm")) as Array<{
      Name: string;
      Path: string;
      Size: number;
      Ext: string;
    }>;
    expect(entries).toHaveLength(1);
    // Name 必须含扩展名，对齐桌面 filepath.Base(p)，否则 loader.ts 的 endsWith(ext) 过滤会丢条目
    expect(entries[0].Name).toBe("狐狸.ysm");
    expect(entries[0].Ext).toBe(".ysm");
    expect(entries[0].Path).toBe("/web/ysm/狐狸/狐狸.ysm");
    expect(entries[0].Size).toBe(3); // "YSM" = 3 bytes
  });

  it("ScanModelEntriesWithLabel 同 ScanModelEntries（真实列表入口）", async () => {
    await importWebFiles([new File([enc.encode("YSM")], "狐狸.ysm")], "ysm");
    const entries = (await browserAdapter.ScanModelEntriesWithLabel("/web/ysm", "模型")) as Array<{
      Name: string;
    }>;
    expect(entries).toHaveLength(1);
    expect(entries[0].Name).toBe("狐狸.ysm");
  });

  it("ReadFileBytes 读回 base64（wasm.ts 解码链零改动复用）", async () => {
    await importWebFiles([new File([enc.encode("YSM")], "狐狸.ysm")], "ysm");
    const b64 = await browserAdapter.ReadFileBytes("/web/ysm/狐狸/狐狸.ysm");
    expect(b64).toBe(btoa("YSM"));
  });

  it("ReadFileBytes：不存在/非 /web/ 路径 → null（不抛错）", async () => {
    expect(await browserAdapter.ReadFileBytes("/web/ysm/不存在/a.ysm")).toBeNull();
    expect(await browserAdapter.ReadFileBytes("/repo/ysm/a.ysm")).toBeNull();
  });
});

describe("browserAdapter — Phase 2 配置（localStorage）", () => {
  it("SaveAppConfig → LoadAppConfig 往返（字段名对齐 AppConfig.resourcepackRoot）", async () => {
    await browserAdapter.SaveAppConfig("/web", "/web", "", "copy", "dark");
    const cfg = (await browserAdapter.LoadAppConfig()) as unknown as Record<string, string>;
    expect(cfg.filesRoot).toBe("/web");
    // rpRoot 必须落到 resourcepackRoot，否则 community.ts 读回恒 undefined 并永久丢失资源包根
    expect(cfg.resourcepackRoot).toBe("/web");
    expect(cfg.linkMode).toBe("copy");
    expect(cfg.theme).toBe("dark");
  });

  it("SaveAppConfig 空串保留旧值（对齐桌面 orDefault 语义，避免整体覆盖丢失其他配置）", async () => {
    await browserAdapter.SaveAppConfig("/web", "/rp", "", "copy", "dark");
    // 第二次以空串传 rpRoot —— 应保持上一次的 "/rp" 而非清空
    await browserAdapter.SaveAppConfig("/web2", "", "", "move", "light");
    const cfg = (await browserAdapter.LoadAppConfig()) as unknown as Record<string, string>;
    expect(cfg.resourcepackRoot).toBe("/rp");
    expect(cfg.filesRoot).toBe("/web2");
    expect(cfg.linkMode).toBe("move");
  });

  it("无配置 LoadAppConfig → {}（主应用可启动）", async () => {
    expect(await browserAdapter.LoadAppConfig()).toEqual({});
  });
});

describe("browserAdapter — Phase 2 3D 兜底守卫（ADR-049 P2-2 路径可达）", () => {
  it("GetModel3DSpec 网页版恒空（让 model3d-loader WASM 兜底守卫可达，而非 WebUnsupportedError 逃逸）", async () => {
    expect(await browserAdapter.GetModel3DSpec("/web/ysm/狐狸/狐狸.ysm")).toBe("{}");
  });
});

describe("browserAdapter — fail-fast（Phase 3 能力门控隐藏对应 UI）", () => {
  it("未实现 binding → reject WebUnsupportedError（明确报错，非 undefined 穿透）", async () => {
    await expect(browserAdapter.ImportModelFile("a", "b") as never).rejects.toBeInstanceOf(
      WebUnsupportedError,
    );
    await expect(
      (browserAdapter as unknown as { DownloadFile: () => Promise<unknown> }).DownloadFile(),
    ).rejects.toThrow("浏览器端未实现");
  });

  it("错误信息带 binding 名（可定位 Phase 3 待隐藏项）", async () => {
    await expect(browserAdapter.ImportModelFile("a", "b") as never).rejects.toThrow(
      "ImportModelFile",
    );
  });
});

describe("importWebFiles — Phase 2 数据层", () => {
  it("成功导入返回 {imported: n, failed: 0}，且 dir/file 双记录落库", async () => {
    const r = await importWebFiles(
      [
        new File([enc.encode("A")], "模型A.ysm"),
        new File([enc.encode("B")], "模型B.ysm"),
      ],
      "ysm",
    );
    expect(r).toEqual({ imported: 2, failed: 0 });
    expect(idbMock.idbSet).toHaveBeenCalledWith("files", "dir:ysm/模型A:", expect.anything());
    expect(idbMock.idbSet).toHaveBeenCalledWith("files", "file:ysm/模型A/模型A.ysm", expect.anything());
  });

  it("空文件名（如 .ysm 隐藏文件）→ failed 计数", async () => {
    const r = await importWebFiles([new File([enc.encode("X")], ".ysm")], "ysm");
    expect(r).toEqual({ imported: 0, failed: 1 });
  });

  it("非支持扩展名（.txt/.png）与任意 .json → failed（复用 dnd-shared 白名单，防杂物入库）", async () => {
    const r = await importWebFiles(
      [
        new File([enc.encode("x")], "说明.txt"),
        new File([enc.encode("x")], "avatar.png"),
        new File([enc.encode("{}")], "动作.json"),
      ],
      "ysm",
    );
    expect(r).toEqual({ imported: 0, failed: 3 });
    expect(idbMock.idbSet).not.toHaveBeenCalled();
  });

  it(".zip/.7z 明确降级不入库（网页版无解包通道，入库后解码必败）", async () => {
    const r = await importWebFiles(
      [new File([enc.encode("z")], "模型.zip"), new File([enc.encode("z")], "模型.7z")],
      "ysm",
    );
    expect(r).toEqual({ imported: 0, failed: 2 });
    expect(idbMock.idbSet).not.toHaveBeenCalled();
  });

  it("多文件模型按 stem 分组：同组非主文件并入同一 dir（消灭每文件独立成模型）", async () => {
    const f1 = new File([enc.encode("Y")], "狐狸.ysm");
    const f2 = new File([enc.encode("{}")], "main.json");
    // 文件夹拖入扁平化：webkitRelativePath 同首段 → 同模型
    Object.defineProperty(f1, "webkitRelativePath", { value: "狐狸/狐狸.ysm" });
    Object.defineProperty(f2, "webkitRelativePath", { value: "狐狸/main.json" });
    const r = await importWebFiles([f1, f2], "ysm");
    expect(r).toEqual({ imported: 1, failed: 0 });
    // 组内非主文件（main.json）也落库（供 preview 读纹理/清单），但只建一个 dir 条目
    expect(idbMock.idbSet).toHaveBeenCalledWith("files", "dir:ysm/狐狸:", expect.anything());
    expect(idbMock.idbSet).toHaveBeenCalledWith("files", "file:ysm/狐狸/main.json", expect.anything());
    const entries = (await browserAdapter.ScanModelEntries("/web/ysm")) as Array<{ Name: string; Ext: string }>;
    expect(entries).toHaveLength(1);
    // 主文件优先选 .ysm，而非 main.json
    expect(entries[0].Name).toBe("狐狸.ysm");
  });

  it("组内无主文件（.ysm/ysm.json）→ 整组丢弃", async () => {
    const f = new File([enc.encode("{}")], "main.json");
    Object.defineProperty(f, "webkitRelativePath", { value: "杂项/main.json" });
    const r = await importWebFiles([f], "ysm");
    expect(r).toEqual({ imported: 0, failed: 1 });
  });

  it("超过 100MB → failed（对齐 import-dnd oversize 过滤）", async () => {
    const big = new File([new Uint8Array(100 * 1024 * 1024 + 1)], "超大.ysm");
    const r = await importWebFiles([big], "ysm");
    expect(r).toEqual({ imported: 0, failed: 1 });
  });

  it("ysm.json 可作主文件（桌面 IsYsmEntryJSON 白名单）；Ext 小写化 + 无点号保护", async () => {
    await importWebFiles([new File([enc.encode("{}")], "ysm.json")], "ysm");
    const entries = (await browserAdapter.ScanModelEntries("/web/ysm")) as Array<{ Name: string; Ext: string }>;
    expect(entries).toHaveLength(1);
    expect(entries[0].Name).toBe("ysm.json");
    expect(entries[0].Ext).toBe(".json");
    // 大小写变体：FOO.YSM → Ext 小写化（桌面 strings.ToLower 同口径）
    await importWebFiles([new File([enc.encode("Y")], "FOO.YSM")], "ysm");
    const entries2 = (await browserAdapter.ScanModelEntries("/web/ysm")) as Array<{ Name: string; Ext: string }>;
    expect(entries2.find((e) => e.Name === "FOO.YSM")?.Ext).toBe(".ysm");
  });

  it("中途 idbSet 失败 → 回滚只删本次新建 key，保留 preExisted（P3 code review）", async () => {
    // 预置：dir + 主文件已存在（模拟先前成功导入的同一模型）
    await importWebFiles([new File([enc.encode("OLD")], "狐狸.ysm")], "ysm");
    expect(idbMock._store.has("file:ysm/狐狸/狐狸.ysm")).toBe(true);
    expect(idbMock._store.has("dir:ysm/狐狸:")).toBe(true);
    // 本次重导入：主文件 + 辅助文件；第一次 idbSet（覆盖主文件）成功，
    // 第二次 idbSet（辅助文件写入）reject → 触发回滚
    const fMain = new File([enc.encode("NEW")], "狐狸.ysm");
    const fAux = new File([enc.encode("{}")], "main.json");
    Object.defineProperty(fMain, "webkitRelativePath", { value: "狐狸/狐狸.ysm" });
    Object.defineProperty(fAux, "webkitRelativePath", { value: "狐狸/main.json" });
    idbMock.idbSet
      .mockResolvedValueOnce(undefined) // 第一次（覆盖主文件）成功
      .mockRejectedValueOnce(new Error("QuotaExceededError")); // 第二次（辅助文件）失败
    const r = await importWebFiles([fMain, fAux], "ysm");
    expect(r.failed).toBeGreaterThan(0);
    // 主文件 key 是 preExisted（先前成功导入）→ 回滚不得删除，旧数据保留
    expect(idbMock._store.has("file:ysm/狐狸/狐狸.ysm")).toBe(true);
    // dir key 是 preExisted → 保留
    expect(idbMock._store.has("dir:ysm/狐狸:")).toBe(true);
  });

  it("中途失败回滚调用 idbDel 且只传本次新建 key（P3 code review：mock 补齐前不可测）", async () => {
    const f = new File([enc.encode("Y")], "新人.ysm");
    // 单文件组：第一次 idbSet（写 file key）成功，第二次 idbSet（写 dir key）失败
    // → 回滚删本次新建的 file key（preExisted=false）
    idbMock.idbSet
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("abort"));
    await importWebFiles([f], "ysm");
    expect(idbMock.idbDel).toHaveBeenCalledWith("files", "file:ysm/新人/新人.ysm");
    // 回滚后孤儿清理完成：库中无残留
    expect(idbMock._store.has("file:ysm/新人/新人.ysm")).toBe(false);
  });
});

describe("selectLocalRepo — FSA 授权本地仓库（ADR-049 能力门控缺口补齐）", () => {
  // FSA 句柄桩：目录 → 异步迭代子项；文件 → kind/name/getFile（结构对齐 _FsaDirHandle）
  function fileHandle(name: string, content: string): unknown {
    return {
      kind: "file",
      name,
      getFile: async () => new File([enc.encode(content)], name),
    };
  }
  function dirHandle(name: string, children: unknown[]): unknown {
    return {
      kind: "directory", // 真实 FileSystemDirectoryHandle 带 kind，_collectYsmFiles 靠它判定递归
      name,
      async *values(): AsyncIterableIterator<unknown> {
        for (const c of children) yield c;
      },
    };
  }
  function setPicker(handle: unknown): void {
    Object.defineProperty(window, "showDirectoryPicker", {
      value: vi.fn(async () => handle),
      writable: true,
      configurable: true,
    });
  }

  it("授权目录 → 递归扫 .ysm 落 IDB，返回 {ok, imported, failed, dir}", async () => {
    setPicker(
      dirHandle("模型库", [
        fileHandle("狐狸.ysm", "YSM"),
        dirHandle("子目录", [fileHandle("小猫.YSM", "cat")]),
        fileHandle("说明.txt", "忽略"),
      ]),
    );
    const r = await selectLocalRepo();
    expect(r).toEqual({ ok: true, imported: 2, failed: 0, dir: "模型库" });
    // 递归（子目录）+ 大小写扩展名（.YSM）均入模型库
    const entries = (await browserAdapter.ScanModelEntries("/web/ysm")) as Array<{
      Name: string;
      Ext: string;
    }>;
    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.Name === "狐狸.ysm")).toBeDefined();
    expect(entries.find((e) => e.Name === "小猫.YSM")?.Ext).toBe(".ysm");
    // 非 .ysm 文件（说明.txt）不被收集
    expect(entries.some((e) => e.Name === "说明.txt")).toBe(false);
  });

  it("目录内无 .ysm → {imported: 0, failed: 0}（空授权不算失败）", async () => {
    setPicker(dirHandle("空库", [fileHandle("说明.txt", "x")]));
    await expect(selectLocalRepo()).resolves.toEqual({
      ok: true,
      imported: 0,
      failed: 0,
      dir: "空库",
    });
  });

  it("环境无 showDirectoryPicker → reject WebUnsupportedError（fail-fast 明确报错）", async () => {
    delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker;
    await expect(selectLocalRepo()).rejects.toBeInstanceOf(WebUnsupportedError);
  });
});

describe("browserAdapter — LoadResourceTypes（注册表驱动视图降级消除）", () => {
  it("返回与 resource_types.json 同形状 JSON（registry.ts 不再静默降级为空）", async () => {
    const json = (await browserAdapter.LoadResourceTypes()) as string;
    const parsed = JSON.parse(json) as { resourceTypes: Array<{ id: string }> };
    expect(Array.isArray(parsed.resourceTypes)).toBe(true);
    expect(parsed.resourceTypes.some((rt) => rt.id === "ysm")).toBe(true);
    expect(parsed.resourceTypes.length).toBeGreaterThanOrEqual(7);
  });
});

describe("browserAdapter — Proxy 原型成员（P3：Object 原型成员不路由 fail-fast）", () => {
  it("toString 等返回原型链实现，String(adapter) 正常而非 rejected Promise", () => {
    const proxy = browserAdapter as unknown as {
      toString: unknown;
      constructor: unknown;
      valueOf: unknown;
    };
    // fail-fast 不得路由到原型成员：读 toString 应拿到函数（原型链实现），非 rejected Promise
    expect(typeof proxy.toString).toBe("function");
    expect(typeof proxy.valueOf).toBe("function");
    // 若 fail-fast 路由到 toString → String(adapter) 得 "[object Promise]" 或抛错；
    // 走原型链 → "[object Object]"
    expect(String(browserAdapter)).toBe("[object Object]");
  });
});
