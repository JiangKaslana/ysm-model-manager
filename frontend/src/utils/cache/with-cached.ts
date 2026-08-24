// ===== 通用异步缓存工具 =====
// 基于 key + ttl 的内存缓存，支持 STALE / NORMAL / FORCE 策略
// 适用场景：网络拉取、磁盘扫描等"计算成本高但结果可复用"的操作

import { dbg } from "../debug/debug.ts";

/** 缓存条目 */
interface CacheEntry<T> {
  value: T;
  /** 过期时间戳（毫秒） */
  expiryMs: number;
}

/** 缓存策略 */
export type CachePolicy = "NORMAL" | "STALE" | "FORCE";

/** 进程级缓存表，key → CacheEntry */
const _cache = new Map<string, CacheEntry<unknown>>();

/**
 * 带过期时间的异步缓存包装器
 *
 * @param key    缓存键（同一进程内唯一）
 * @param ttlMs  过期时间（毫秒），0 = 永不过期
 * @param fn     异步工厂函数，当缓存失效时调用
 * @param policy 缓存策略（默认 NORMAL）
 * @returns 缓存结果或 fn 的执行结果
 *
 * 策略行为（优先级从高到低）：
 *   FORCE  — 忽略缓存，强制重新计算（不写入缓存）
 *   STALE  — 命中缓存直接返回；过期则立即返回旧值 + 后台刷新缓存（不阻塞）
 *   NORMAL — 命中缓存直接返回；过期则重新计算并更新缓存
 */
export async function withCached<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
  policy: CachePolicy = "NORMAL",
): Promise<T> {
  const now = Date.now();
  const entry = _cache.get(key) as CacheEntry<T> | undefined;

  // FORCE 最高优先级：完全不依赖缓存
  if (policy === "FORCE") {
    dbg("cache", `[force] ${key} 强制重新计算`);
    return fn();
  }

  if (entry && now < entry.expiryMs) {
    // 缓存命中
    dbg("cache", `[hit] ${key} (${Math.round((entry.expiryMs - now) / 1000)}s 后过期)`);
    return entry.value;
  }

  if (entry && policy === "STALE") {
    // 过期但返回旧值，后台刷新
    dbg("cache", `[stale] ${key} 已过期，返回旧值并后台刷新`);
    refreshInBackground(key, ttlMs, fn).catch((e) => dbg("cache", `refreshInBackground ${key} 失败:`, e));
    return entry.value;
  }

  // NORMAL 且缓存过期或不存在：重新计算
  dbg("cache", `[miss] ${key} 重新计算，ttl=${ttlMs}ms`);
  const value = await fn();
  if (ttlMs > 0) {
    _cache.set(key, { value, expiryMs: now + ttlMs });
  }
  return value;
}

/** 后台刷新缓存（不阻塞调用方） */
async function refreshInBackground<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<void> {
  try {
    const value = await fn();
    _cache.set(key, { value, expiryMs: Date.now() + ttlMs });
    dbg("cache", `[refresh] ${key} 刷新成功`);
  } catch (e) {
    dbg("cache", `[refresh] ${key} 刷新失败:`, e);
    // 刷新失败不删除旧缓存，维持 STALE 值
  }
}

/** 清除指定缓存条目 */
export function invalidateCache(key: string): void {
  _cache.delete(key);
  dbg("cache", `[invalidate] ${key}`);
}

/** 清除所有缓存 */
export function clearAllCache(): void {
  _cache.clear();
  dbg("cache", `[clearAll]`);
}

/** 获取缓存条目的剩余 TTL（毫秒），未命中返回 -1 */
export function getCacheTtlMs(key: string): number {
  const entry = _cache.get(key) as CacheEntry<unknown> | undefined;
  if (!entry) return -1;
  return Math.max(0, entry.expiryMs - Date.now());
}
