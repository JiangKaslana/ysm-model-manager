// ===== Android Java 桥访问（ADR-046 P2）=====
// WailsJSBridge 以 "wails" 名注册到 WebView（MainActivity addJavascriptInterface），
// 暴露 Android 专属 API；桌面端无此桥（返回 null）。
// 共享模块：loader.ts 授权引导 / directory-picker.ts 目录选择均引用，避免重复实现。
import { readDeclaredBackend, resolveWebMode } from "../../wails/platform.ts";

export interface WailsAndroidBridge {
  hasStoragePermission?: () => boolean;
  requestStoragePermission?: () => void;
}

/** 返回 Android Java 桥（桌面端为 null），类型安全断言（无 as any） */
export function getAndroidBridge(): WailsAndroidBridge | null {
  const w = (window as unknown as { wails?: WailsAndroidBridge }).wails;
  return w && typeof w.requestStoragePermission === "function" ? w : null;
}

/**
 * 查看器模式判定（ADR-049 Phase 3 能力门控统一入口）：
 * Android（双端桥存在）或网页版（browser adapter）——均无本地文件系统写能力、
 * 无桌面专属 UI（系统对话框/自更新/资源管理器/整合包概念）。
 * 各按钮/功能守卫统一用本函数，禁止各自拼 getAndroidBridge()/resolveWebMode()。
 */
export function isViewerMode(): boolean {
  // Tier 0 权威信号优先：入口显式声明 go → 桌面模式（即使误残留 wails 桥）
  if (readDeclaredBackend() === "go") return false;
  return getAndroidBridge() !== null || resolveWebMode();
}
