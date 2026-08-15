// ===== Android Java 桥访问（ADR-046 P2）=====
// WailsJSBridge 以 "wails" 名注册到 WebView（MainActivity addJavascriptInterface），
// 暴露 Android 专属 API；桌面端无此桥（返回 null）。
// 共享模块：loader.ts 授权引导 / directory-picker.ts 目录选择均引用，避免重复实现。
import { readDeclaredBackend, resolveWebMode } from "../../backend/platform.ts";

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

/**
 * 安卓系统返回键处理器注册表（ADR-057 §2.5，对齐 MikuMikuAR handleAndroidBack）。
 * 栈顶优先：android-events.ts 收到 MainActivity 的 android:back 事件后调用
 * emitAndroidBack()，从栈顶向下询问已注册处理器；返回 true 表示已消费
 * （如 3D overlay 打开时关层），否则透传上层。
 */
type AndroidBackHandler = () => boolean | void;
const _androidBackHandlers: AndroidBackHandler[] = [];

/** 注册安卓返回键处理器，返回取消函数（供调用方在自身销毁/关闭时注销）。 */
export function registerAndroidBackHandler(fn: AndroidBackHandler): () => void {
  _androidBackHandlers.push(fn);
  return (): void => {
    const i = _androidBackHandlers.indexOf(fn);
    if (i > -1) _androidBackHandlers.splice(i, 1);
  };
}

/**
 * 系统返回键的前端触发入口：依次从栈顶触发已注册处理器。
 * 当前由 android-events.ts 在收到 MainActivity 的 android:back 事件时调用；
 * 返回 true 表示已被消费（阻止原生默认返回/退出）。
 */
export function emitAndroidBack(): boolean {
  for (let i = _androidBackHandlers.length - 1; i >= 0; i--) {
    if (_androidBackHandlers[i]() === true) return true;
  }
  return false;
}
