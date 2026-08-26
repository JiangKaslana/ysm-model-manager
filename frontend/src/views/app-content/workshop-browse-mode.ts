// ===== 创作者频道浏览模式（外链/内嵌/窗口）=====
import { safeGet, safeSet } from "../../utils/dom/storage.ts";

/** 创作者频道浏览模式 */
export type BrowseMode = 'external' | 'embed' | 'window';

/**
 * 从 localStorage 加载浏览模式
 */
export function loadBrowseMode(): BrowseMode {
  const v = safeGet("ysm-browse-mode");
  if (v === "embed" || v === "window") return v as BrowseMode;
  // 兼容旧 boolean 存储
  if (safeGet("ysm-embed-mode") === "1") return "embed";
  return "external";
}

/**
 * 保存浏览模式到 localStorage
 */
export function saveBrowseMode(mode: BrowseMode): void {
  safeSet("ysm-browse-mode", mode);
  // 兼容旧 key
  safeSet("ysm-embed-mode", mode === "embed" ? "1" : "0");
}
