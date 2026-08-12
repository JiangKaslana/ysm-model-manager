// ===== 错误信息友好化（类型化版 — ADR-014 P2 + ADR-045 i18n）=====
// Go 返回的原始错误 → 用户能看懂的友好提示（支持多语言）

import { t } from "../../core/i18n/t.ts";

// ADR-051：AppError 结构化 Code → i18n key（优先消费结构化字段，正则表降为兜底）。
// Code 来自 Go 端 types.AppError.Code；未列出的 Code（如 IO_ERROR/MKDIR_FAILED/
// WRITE_FAILED/FILE_EMPTY/FILE_TOO_LARGE/LINK_FAILED）语义靠 Reason 中文透传，
// 不在此武断归类（各 Code 的 Reason/Suggestion 比通用分类更具体，映射会误导用户）。
const CODE_KEYS: Record<string, string> = {
  FILE_EXISTS: "error.alreadyExists",
  ALREADY_EXISTS: "error.alreadyExists",
  INVALID_PARAM: "error.invalidArg",
  INVALID_PATH: "error.invalidArg",
  FILENAME_INVALID: "error.invalidArg",
  FILE_TYPE_UNSUPPORTED: "error.unsupported",
  UNSUPPORTED_FORMAT: "error.unsupported",
  DECODE_FAILED: "error.dataFormat",
};

/**
 * 从错误对象提取 AppError.Code。
 * Wails v3 将 Go 返回的 error 序列化到异常对象的 cause 属性（calls.d.ts：
 * "The exception might have a 'cause' field with the value returned"），
 * 即 RuntimeError.cause.Code 才是 AppError 的 Code 字段；err.Code 仅作兼容兜底。
 */
function extractAppErrorCode(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const cause = (err as { cause?: unknown }).cause;
  const codeSource =
    cause !== null && typeof cause === "object" && "Code" in cause
      ? (cause as { Code: unknown }).Code
      : "Code" in err
        ? (err as { Code: unknown }).Code
        : undefined;
  return codeSource === undefined ? undefined : String(codeSource);
}

/**
 * 将 Go 错误转换为友好提示
 * @param err - 错误对象或字符串
 * @param fallback - 未匹配时的前缀，默认 "操作失败"
 */
export function friendlyError(err: unknown, fallback?: string): string {
  const fb = fallback ?? t("error.fallback");
  if (!err) return t("error.unknown");
  // ADR-051：优先消费结构化 Code（Wails 把 AppError 放异常 cause.Code），
  // 消除「file exists 双归」等正则表与 Go 端分类矛盾
  const code = extractAppErrorCode(err);
  if (code !== undefined) {
    const key = CODE_KEYS[code];
    if (key) return t(key);
  }
  const msg =
    typeof err === "string"
      ? err
      : String((err as { message?: unknown }).message || err);

  // 已经包含汉字 → 直接使用（Go 端已有友好提示或已翻译）
  // P2 修复（子代理审计）：透传前剥离内部路径段——Go 端 AppError.Error() 会把
  // `源路径：C:\... 目标路径：D:\...`（内部绝对路径）拼入 message，原样透传给
  // 用户侧 toast 会泄漏磁盘布局（ADR-051「透传截断」决策：用户侧只显示分类提示）
  if (/[\u4e00-\u9fff]/.test(msg)) return stripPathSegments(msg);

  // 常见错误模式匹配 → i18n key
  // 优先级：社区抓取常见错误 > 通用文件/网络错误
  const patterns: Array<[RegExp, string]> = [
    // ===== 社区功能高频错误 =====
    [/\brate limit\b|\b429\b|\btoo many requests\b/i, "error.rateLimited"],
    [/abort|cancelled/i, "error.cancelled"],
    [/parse error|unexpected token|malformed|syntaxerror/i, "error.dataFormat"],
    [/dns|getaddrinfo|ENOTFOUND|resolve host|resolve.*domain/i, "error.dnsFailed"],
    [/econnrefused|econnreset|eof|socket|connection refused/i, "error.connectionLost"],
    [/ssl|tls|certificate/i, "error.sslError"],
    // ===== 通用文件/网络错误 =====
    [/access is denied|permission denied|eacces|access refused/i, "error.permissionDenied"],
    [/no such file|not found|cannot find|does not exist/i, "error.notFound"],
    [/sharing violation|used by another process|is locked/i, "error.fileLocked"],
    // P3 修复（code_review）：与 go/errors 收窄对齐——裸 `no files` 是 "no filesystem"
    // 子串会误分类；只匹配目录/文件夹场景的完整短语
    [/(?:directory|folder) is empty|no files found|no files in (?:directory|folder)/i, "error.dirEmpty"],
    [/timeout|timed out/i, "error.timeout"],
    [/network|proxy|fetch/i, "error.networkError"],
    [/invalid argument/i, "error.invalidArg"],
    [/file exists|already exists/i, "error.alreadyExists"],
    [/disk full|no space|disk quota/i, "error.diskFull"],
    [/unsupported|not supported/i, "error.unsupported"],
    [/too many/i, "error.tooMany"],
    [/not a directory/i, "error.notADir"],
    [/is a directory/i, "error.isADir"],
  ];

  for (const [regex, key] of patterns) {
    if (regex.test(msg)) return t(key);
  }

  return `${fb}: ${stripPathSegments(msg)}`;
}

// stripPathSegments 剥离 Go 端 AppError.Error() 拼入的内部路径段（ADR-051 透传截断）。
// 格式：`问题描述：X 操作：Y 源路径：P 目标路径：Q 解决建议：R`——路径为内部绝对
// 路径（Windows 驱动器号/UNC），用户侧 toast 不应泄漏。仅剥离标记段，保留其余文案。
// P3 修复（审核）：导出供 error-diary 复用（写日记同样不应持久化完整内部路径）
export function stripPathSegments(msg: string): string {
  return msg.replace(/\s+(?:源路径|目标路径)：[^\s]*/g, "");
}
