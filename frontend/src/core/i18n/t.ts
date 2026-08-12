// ===== i18n 翻译函数（ADR-045）=====
// 纯查表函数，语言包缓存由 locale.ts 管理（避免循环依赖）。

import { getBundle, warnedKeys } from "./locale.ts";

/**
 * 翻译函数。
 * @param key - 扁平化 key，如 "nav.repository"
 * @param params - 插值参数，如 { n: 3 } 替换 "{n}"
 * @returns 翻译后的字符串，缺失时返回 key 本身
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const bundle = getBundle();

  let text = bundle[key];
  if (text === undefined) {
    if (!warnedKeys.has(key)) {
      warnedKeys.add(key);
      console.warn(`[i18n] 缺失 key: ${key}`);
    }
    return key;
  }

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      // P1/P2 修复（子代理审计）：① 替换值用函数型替换——字符串替换会把 `$&`/`$1`/
      // `$<name>` 当特殊序列解析（参数值含 "$1" 会被替换成空串或捕获组内容，产生错译文）；
      // ② 参数名先正则转义——`{a.b}`/`{[` 等含正则元字符的 key 会构造非法正则（RangeError）
      // 或误匹配。函数型替换 + 转义双保险
      const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      text = text.replace(new RegExp(`\\{${escaped}\\}`, "g"), () => String(v));
    }
  }
  return text;
}
