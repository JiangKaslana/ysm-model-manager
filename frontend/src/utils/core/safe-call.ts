// utils/core/safe-call.ts — 统一「吞错并 logWarn」的散点模式。
//
// 替代项目中大量 `try { fn() } catch (err) { logWarn(tag, msg, err) }` 与
// `promise.catch((err) => logWarn(tag, msg, err))` 手写重复。
//
// 用法：
//   import { safeCall, safeCallVoid, safeCallAsync } from "@/core/safe-call";
//
//   const v = safeCall("audio", "decode", () => decode(buf));        // 同步，返回 T | undefined
//   safeCallVoid("physics", "step", () => step(dt));                  // 同步，无返回值
//   safeCallAsync("init", "Library init", () => initLibrary());      // 异步，Promise<T | undefined>

import { logWarn } from "./log.ts";

/**
 * 安全执行同步函数；异常时记录 logWarn(tag, msg, err) 并返回 undefined。
 * 仅用于 catch 块「只 logWarn、无其它副作用、无返回值依赖」的纯吞错场景。
 */
export function safeCall<T>(tag: string, msg: string, fn: () => T): T | undefined {
    try {
        return fn();
    } catch (err) {
        logWarn(tag, msg, err);
        return undefined;
    }
}

/** 同 safeCall，但 fn 无返回值。 */
export function safeCallVoid(tag: string, msg: string, fn: () => void): void {
    try {
        fn();
    } catch (err) {
        logWarn(tag, msg, err);
    }
}

/**
 * 安全执行异步函数；异常时记录 logWarn(tag, msg, err)，返回的 Promise 解析为
 * undefined（不 reject）。
 *
 * 注意：不传播 rejection，调用方不应再依赖其结果值；不保留 tag/msg 之外的上下文。
 */
export function safeCallAsync<T>(
    tag: string,
    msg: string,
    fn: () => Promise<T>
): Promise<T | undefined> {
    return fn().then(
        (v) => v,
        (err) => {
            logWarn(tag, msg, err);
            return undefined;
        }
    );
}
