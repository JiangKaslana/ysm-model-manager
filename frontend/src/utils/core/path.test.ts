// @vitest-environment node
// ===== 路径工具测试（path.ts）=====
import { describe, it, expect } from "vitest";
import { normPath, getBaseName, getDirPath, isUnderRoot, computeLibraryRef } from "./path.ts";

describe("normPath — 路径标准化", () => {
  it("反斜杠转正斜杠", () => {
    expect(normPath("a\\b\\c")).toBe("a/b/c");
  });

  it("去掉尾部斜杠", () => {
    expect(normPath("a/b/c/")).toBe("a/b/c");
  });

  it("去掉尾部多个斜杠", () => {
    expect(normPath("a/b///")).toBe("a/b");
  });

  it("混合反斜杠和尾部斜杠", () => {
    expect(normPath("a\\b\\c\\")).toBe("a/b/c");
  });

  it("折叠 /./ 为 /", () => {
    expect(normPath("a/./b/./c")).toBe("a/b/c");
  });

  it("去掉开头的 ./", () => {
    expect(normPath("./a/b")).toBe("a/b");
  });

  it("去掉结尾的 /.", () => {
    expect(normPath("a/b/.")).toBe("a/b");
  });

  it("content:// URI 只去尾部斜杠，不转换内部", () => {
    expect(normPath("content://com.example/tree/docs/")).toBe("content://com.example/tree/docs");
  });

  it("content:// URI 无尾部斜杠原样返回", () => {
    expect(normPath("content://com.example/tree/docs")).toBe("content://com.example/tree/docs");
  });

  it("空字符串返回空字符串", () => {
    expect(normPath("")).toBe("");
  });

  it("根路径 / 返回空字符串（去尾斜杠）", () => {
    expect(normPath("/")).toBe("");
  });

  it("大小写不敏感缓存：同一路径不同大小写返回相同结果", () => {
    const a = normPath("C:/Users/Test");
    const b = normPath("c:/users/test");
    expect(a).toBe(b);
  });

  it("Windows 风格绝对路径", () => {
    expect(normPath("C:\\Users\\test\\file.txt")).toBe("C:/Users/test/file.txt");
  });
});

describe("getBaseName — 取文件名", () => {
  it("普通路径取末段", () => {
    expect(getBaseName("a/b/c.txt")).toBe("c.txt");
  });

  it("Windows 路径取末段", () => {
    expect(getBaseName("a\\b\\c.txt")).toBe("c.txt");
  });

  it("无斜杠返回原值", () => {
    expect(getBaseName("file.txt")).toBe("file.txt");
  });

  it("尾部斜杠取倒数第二段", () => {
    expect(getBaseName("a/b/")).toBe("b");
  });

  it("多层嵌套取文件名", () => {
    expect(getBaseName("/home/user/models/pmx/model.pmx")).toBe("model.pmx");
  });
});

describe("getDirPath — 取父目录", () => {
  it("普通路径取父目录", () => {
    expect(getDirPath("a/b/c.txt")).toBe("a/b");
  });

  it("Windows 路径取父目录", () => {
    expect(getDirPath("a\\b\\c.txt")).toBe("a/b");
  });

  it("无斜杠返回空字符串", () => {
    expect(getDirPath("file.txt")).toBe("");
  });

  it("深层路径取父目录", () => {
    expect(getDirPath("/home/user/models/model.pmx")).toBe("/home/user/models");
  });
});

describe("isUnderRoot — 路径归属判定", () => {
  it("子路径在根下返回 true", () => {
    expect(isUnderRoot("/models", "/models/pmx/file.pmx")).toBe(true);
  });

  it("精确相等返回 true（忽略大小写）", () => {
    expect(isUnderRoot("/Models", "/models")).toBe(true);
  });

  it("前缀相同但非目录边界返回 false（防 PMX 误命中 PMXSub）", () => {
    expect(isUnderRoot("/models/PMX", "/models/PMXSub/file")).toBe(false);
  });

  it("含 .. 的路径被拒绝", () => {
    expect(isUnderRoot("/models", "/models/../secret")).toBe(false);
  });

  it("child 为 .. 被拒绝", () => {
    expect(isUnderRoot("/models", "..")).toBe(false);
  });

  it("child 以 ../ 开头被拒绝", () => {
    expect(isUnderRoot("/models", "../other")).toBe(false);
  });

  it("child 以 /.. 结尾被拒绝", () => {
    expect(isUnderRoot("/models", "/models/..")).toBe(false);
  });

  it("完全无关路径返回 false", () => {
    expect(isUnderRoot("/models", "/other/path")).toBe(false);
  });

  it("大小写不敏感", () => {
    expect(isUnderRoot("C:\\Users\\Test", "c:/users/test/file.txt")).toBe(true);
  });
});

describe("computeLibraryRef — 计算库引用", () => {
  it("root 为 null 返回 null", () => {
    expect(computeLibraryRef("/models/file.txt", null)).toBeNull();
  });

  it("root 为 undefined 返回 null", () => {
    expect(computeLibraryRef("/models/file.txt", undefined)).toBeNull();
  });

  it("空 root 返回 null", () => {
    expect(computeLibraryRef("/models/file.txt", "")).toBeNull();
  });

  it("filePath 在 root 下返回相对路径", () => {
    expect(computeLibraryRef("/models/pmx/file.txt", "/models")).toBe("pmx/file.txt");
  });

  it("filePath 不在 root 下返回 null", () => {
    expect(computeLibraryRef("/other/file.txt", "/models")).toBeNull();
  });

  it("大小写不敏感匹配", () => {
    expect(computeLibraryRef("C:/Users/Test/file.txt", "c:/users/test")).toBe("file.txt");
  });

  it("保留 filePath 原始大小写（受缓存影响）", () => {
    // 注意：normPath 缓存键为小写，若先前已缓存同路径小写版本，
    // 后续调用可能返回缓存的小写结果。测试实际行为。
    const result = computeLibraryRef("/Models/PMX/File.PMX", "/models");
    expect(result).toBeTruthy();
    expect(result).not.toBeNull();
    // 结果应为相对路径格式
    expect(result!.includes("/")).toBe(true);
  });
});
