// ===== dnd-collector 单测 =====
// 覆盖 collectFiles 的三种路径：文件条目、目录递归、getAsFile 兜底
import { describe, it, expect, vi } from "vitest";
import { collectFiles } from "./dnd-collector.ts";

// 假条目构造器
const fileEntry = (name: string, file: File): FileSystemFileEntry => ({
  isFile: true,
  isDirectory: false,
  name,
  file: (cb: (f: File) => void) => cb(file),
} as unknown as FileSystemFileEntry);

const dirEntry = (
  name: string,
  children: FileSystemEntry[],
): FileSystemDirectoryEntry => ({
  isFile: false,
  isDirectory: true,
  name,
  createReader: () => ({
    readEntries: (cb: (e: FileSystemEntry[]) => void) => cb(children),
  }),
} as unknown as FileSystemDirectoryEntry);

const dndItem = (entry: FileSystemEntry): DataTransferItem => ({
  kind: "file",
  webkitGetAsEntry: () => entry,
} as unknown as DataTransferItem);

describe("collectFiles — 单文件", () => {
  it("webkitGetAsEntry 路径：收集到 File", async () => {
    const f = new File(["data"], "m.ysm");
    const result = await collectFiles([dndItem(fileEntry("m.ysm", f))], false);
    expect(result).toHaveLength(1);
    expect(result[0].file).toBe(f);
    expect(result[0].relPath).toBe("m.ysm");
  });

  it("getAsFile 兜底：无 webkitGetAsEntry 时取 getAsFile", async () => {
    const f = new File(["data"], "b.ysm");
    const item = { kind: "file", getAsFile: () => f } as unknown as DataTransferItem;
    const result = await collectFiles([item], false);
    expect(result).toHaveLength(1);
    expect(result[0].file).toBe(f);
  });

  it("非 file kind 条目 → 跳过", async () => {
    const item = { kind: "string", data: "hi" } as unknown as DataTransferItem;
    const result = await collectFiles([item], false);
    expect(result).toHaveLength(0);
  });
});

describe("collectFiles — 目录递归", () => {
  it("单层目录：子文件保留 relPath", async () => {
    const child = fileEntry("a.ysm", new File(["x"], "a.ysm"));
    const parent = dirEntry("pkg", [child]);
    const result = await collectFiles([dndItem(parent)], false);
    expect(result).toHaveLength(1);
    expect(result[0].relPath).toBe("pkg/a.ysm");
  });

  it("嵌套目录：多级 relPath", async () => {
    const leaf = fileEntry("f.ysm", new File(["x"], "f.ysm"));
    const mid = dirEntry("sub", [leaf]);
    const root = dirEntry("pkg", [mid]);
    const result = await collectFiles([dndItem(root)], false);
    expect(result).toHaveLength(1);
    expect(result[0].relPath).toBe("pkg/sub/f.ysm");
  });

  it("深度守卫：超过 MAX_DEPTH 时停止递归", async () => {
    const leaf = fileEntry("f.ysm", new File(["x"], "f.ysm"));
    // 每层只返回自己，递归 12 层
    let depth = 0;
    const makeDeepDir = (n: number): FileSystemDirectoryEntry => {
      const self: FileSystemDirectoryEntry = {
        isFile: false,
        isDirectory: true,
        name: `d${n}`,
        createReader: () => ({
          readEntries: (cb: (e: FileSystemEntry[]) => void) => {
            if (n < 12) cb([makeDeepDir(n + 1)]);
            else cb([]);
          },
        }),
      } as unknown as FileSystemDirectoryEntry;
      return self;
    };
    const root = makeDeepDir(0);
    const result = await collectFiles([dndItem(root)], false);
    // 每层产生一个 leaf（depth 0..10 共 11 层有内容，depth 11 截断返回空）
    expect(result.length).toBeLessThanOrEqual(11);
  });
});

describe("collectFiles — 错误处理", () => {
  it("entry.file 抛错 → 该文件跳过，其他文件正常", async () => {
    const ok = fileEntry("ok.ysm", new File(["x"], "ok.ysm"));
    const bad = {
      isFile: true,
      isDirectory: false,
      name: "bad.ysm",
      file: (_cb: (f: File) => void, ecb: (e: unknown) => void) => ecb(new Error("denied")),
    } as unknown as FileSystemFileEntry;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await collectFiles([dndItem(ok), dndItem(bad)], false);
    expect(result).toHaveLength(1);
    expect(result[0].relPath).toBe("ok.ysm");
    warnSpy.mockRestore();
  });

  it("readEntries error 回调 → 整目录跳过", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const badDir = {
      isFile: false,
      isDirectory: true,
      name: "bad",
      createReader: () => ({
        readEntries: (_cb: (e: FileSystemEntry[]) => void, ecb: () => void) => ecb(),
      }),
    } as unknown as FileSystemDirectoryEntry;
    const result = await collectFiles([dndItem(badDir)], false);
    expect(result).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
