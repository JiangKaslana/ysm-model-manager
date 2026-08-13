// @vitest-environment node
// ===== friendlyError 错误友好化测试（ADR-014 P2 + ADR-045 i18n + ADR-051 单一事实来源）=====
// Go 原始错误 → 友好提示；覆盖空值/中文直通/结构化 Code/兜底四类路径。
// ADR-051：删除正则兜底表，只消费结构化 AppError.Code。
import { describe, it, expect, vi } from "vitest";
import { friendlyError } from "./errors.ts";

// 本地 mock t() —— 返回 key 本身（与 test-setup.ts 全局 mock 行为一致，
// 但此文件必须显式 mock，否则 node 环境下路径不匹配导致 t is not defined）
vi.mock("../../core/i18n/t.ts", () => ({
  t: (key: string): string => key,
}));

describe("friendlyError 空值与中文直通", () => {
  it("null/undefined/空串 → 未知错误", () => {
    expect(friendlyError(null)).toBe("error.unknown");
    expect(friendlyError(undefined)).toBe("error.unknown");
    expect(friendlyError("")).toBe("error.unknown");
  });

  it("已含中文的字符串直接返回", () => {
    expect(friendlyError("磁盘已满，请清理")).toBe("磁盘已满，请清理");
  });

  it("已含中文的 Error.message 直接返回", () => {
    expect(friendlyError(new Error("存储路径未配置"))).toBe("存储路径未配置");
  });
});

describe("friendlyError 结构化 AppError Code（ADR-051 单一事实来源）", () => {
  it("err.cause.Code 已知 → 映射 i18n（Wails RuntimeError 形状）", () => {
    const err = new Error("问题描述：文件已存在 操作：导入模型");
    (err as { cause?: unknown }).cause = { Code: "FILE_EXISTS" };
    expect(friendlyError(err)).toBe("error.alreadyExists");
  });

  it("err.Code 已知（兼容兜底形状）→ 映射 i18n", () => {
    expect(friendlyError({ Code: "UNSUPPORTED_FORMAT" })).toBe("error.unsupported");
    expect(friendlyError({ Code: "INVALID_PARAM" })).toBe("error.invalidArg");
    expect(friendlyError({ Code: "DECODE_FAILED" })).toBe("error.dataFormat");
    expect(friendlyError({ Code: "FILENAME_INVALID" })).toBe("error.invalidArg");
    expect(friendlyError({ Code: "INVALID_PATH" })).toBe("error.invalidArg");
    expect(friendlyError({ Code: "ALREADY_EXISTS" })).toBe("error.alreadyExists");
  });

  it("未知 Code → 透传中文 Reason 或 fallback", () => {
    // FILE_TOO_LARGE：中文 Reason 透传
    expect(friendlyError({ Code: "FILE_TOO_LARGE", message: "文件大小超过 500MB 限制" })).toBe(
      "文件大小超过 500MB 限制",
    );
    // FILE_EMPTY：中文 Reason 透传
    expect(friendlyError({ Code: "FILE_EMPTY", message: "文件内容为空" })).toBe("文件内容为空");
    // LINK_FAILED：中文 Reason 透传
    expect(friendlyError({ Code: "LINK_FAILED", message: "创建符号链接需要管理员权限" })).toBe(
      "创建符号链接需要管理员权限",
    );
    // IO_ERROR：英文 message → fallback（Go 端不会这样，仅测试兜底）
    expect(friendlyError({ Code: "IO_ERROR", message: "io: read/write on closed file" })).toBe(
      "error.fallback: io: read/write on closed file",
    );
    // WRITE_FAILED：英文 message → fallback
    expect(friendlyError({ Code: "WRITE_FAILED", message: "写入失败: boom" })).toBe(
      "写入失败: boom",
    );
    // MKDIR_FAILED：中文 Reason 透传
    expect(friendlyError({ Code: "MKDIR_FAILED", message: "无法创建目标目录" })).toBe(
      "无法创建目标目录",
    );
  });

  it("未知 Code 含内部路径 → stripPathSegments 后 fallback", () => {
    const msg = "无法创建目标目录 源路径：C:\\Users\\test 目标路径：D:\\game 解决建议：重试";
    expect(friendlyError({ Code: "MKDIR_FAILED", message: msg })).toBe(
      "无法创建目标目录 解决建议：重试",
    );
  });
});

describe("friendlyError 兜底与非结构化输入", () => {
  it("纯英文字符串（非 AppError）→ fallback 前缀拼接", () => {
    expect(friendlyError("quantum flux")).toBe("error.fallback: quantum flux");
  });

  it("自定义 fallback 生效", () => {
    expect(friendlyError("quantum flux", "重命名失败")).toBe(
      "重命名失败: quantum flux",
    );
  });

  it("Error 对象提取 message → fallback（无 Code 且不含中文）", () => {
    expect(friendlyError(new Error("ENOTFOUND host"))).toBe("error.fallback: ENOTFOUND host");
  });

  it("无 message 的对象走 String(err) 兜底", () => {
    const result = friendlyError({});
    expect(result).toBe("error.fallback: [object Object]");
  });

  it("含中文的 Error.message → 直接透传", () => {
    expect(friendlyError(new Error("网络超时，请重试"))).toBe("网络超时，请重试");
  });
});
