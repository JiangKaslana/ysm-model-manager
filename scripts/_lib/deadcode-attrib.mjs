/**
 * _lib/deadcode-attrib.mjs — 死代码/重复代码发现项归属（纯函数）。
 *
 * 设计：check-deadcode-baseline 的门禁按域裁剪——新增发现项只有落在
 * 「本次责任文件集」（staged / 未推送提交改动）内才阻断提交；
 * 他人遗留债务不拦路，由调用方自动收编进基线并留痕。
 * 责任集为 null = 无法归属（无 git 上下文），严格模式全阻断（fail-closed）。
 */
import { toPosix } from './to-posix.mjs';

/** 从发现项 key 提取涉及文件（posix，工具 cwd 相对路径）。
 * knip 键形如 `file|type|name`；jscpd 键形如 `f1#f2`。无法解析返回 []。 */
export function findingFiles(key) {
  if (typeof key !== 'string') return [];
  if (key.includes('|')) {
    return [key.slice(0, key.indexOf('|'))].filter(Boolean);
  }
  if (key.includes('#')) {
    const i = key.indexOf('#');
    return [key.slice(0, i), key.slice(i + 1)].filter(Boolean);
  }
  return [];
}

/** 判断发现项是否归属责任文件集。
 * 兼容三种形态：候选补 `frontend/` 前缀后命中、根路径直配、候选自带前缀直配。 */
export function attributable(key, responsibleSet) {
  if (!responsibleSet) return true; // null = 严格模式
  for (const f of findingFiles(key)) {
    const p = toPosix(f);
    if (responsibleSet.has(p)) return true;
    if (responsibleSet.has(`frontend/${p}`)) return true;
    if (p.startsWith('frontend/') && responsibleSet.has(p.slice('frontend/'.length))) return true;
  }
  return false;
}

/** 拆分新增发现项 → { blocking, absorbable }。
 * responsibleSet 为 null 时全部 blocking（严格兜底）。 */
export function splitNewFindings(newKeys, responsibleSet) {
  const blocking = [];
  const absorbable = [];
  for (const k of newKeys) {
    (attributable(k, responsibleSet) ? blocking : absorbable).push(k);
  }
  return { blocking, absorbable };
}
