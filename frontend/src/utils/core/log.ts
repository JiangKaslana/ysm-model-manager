// utils/core/log.ts — 极简日志出口，供 async 等叶模块复用。
// 保持零应用层依赖：仅封装 console.warn / console.error，作为 ysm 统一告警通道的薄封装。

/** 统一告警日志。tag 用于按模块聚合排查；err 可为任意错误值。 */
export function logWarn(tag: string, msg: string, err?: unknown): void {
    // eslint-disable-next-line no-console
    console.warn(`[${tag}] ${msg}`, err ?? "");
}

/** 统一错误日志。 */
export function logError(tag: string, msg: string, err?: unknown): void {
    // eslint-disable-next-line no-console
    console.error(`[${tag}] ${msg}`, err ?? "");
}
