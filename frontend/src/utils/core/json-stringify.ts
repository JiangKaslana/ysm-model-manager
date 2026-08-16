// utils/core/json-stringify.ts — JSON 序列化辅助，零依赖叶。

/** Format a value as pretty-printed JSON (2-space indent). */
export function jsonStringify(x: unknown): string {
    const result = JSON.stringify(x, null, 2);
    // JSON.stringify returns undefined for undefined/symbol/function; normalize to 'null'
    return result === undefined ? "null" : result;
}

/** Safely parse JSON; returns null on failure instead of throwing. */
export function jsonParse<T>(s: string): T | null {
    try {
        return JSON.parse(s) as T;
    } catch {
        return null;
    }
}
