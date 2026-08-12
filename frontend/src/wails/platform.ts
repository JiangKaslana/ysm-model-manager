// ===== 平台环境判定（ADR-049 Phase 1，参考 MikuMikuAR ADR-176/177 Tier 分层）=====
// 判定网页版（无 Wails 壳的纯浏览器）以路由到 browser adapter。
//
// Tier 0：入口 HTML 显式声明 globalThis.__YSM_BACKEND__（'go' | 'browser'）——权威信号。
//          web.html 置 'browser' 后即便误嵌进 WebView 也强制走 browserAdapter，
//          消除「网页构建参杂 Go 逻辑」误判；桌面/Android 构建不声明（走 Tier 2）。
// Tier 1：旧 web 短路标记 __YSM_WEB__ === true 或 import.meta.env.MODE === 'web'。
// Tier 2：运行时探测 window.go（Wails 桌面）或 window.wails（Android 桥）——纯浏览器
//          两者都不存在。Phase 1 用同步判定（Tier 0/1 足够）；awaitWailsBridge 的
//          冷启动等待（桌面 WebView2 注入竞态）留到 Phase 3 引入。

/** 读取入口 HTML 声明的适配器身份（'go' | 'browser'），未声明返回 undefined */
export function readDeclaredBackend(): "go" | "browser" | undefined {
  const v = (globalThis as Record<string, unknown>)["__YSM_BACKEND__"];
  return v === "go" || v === "browser" ? v : undefined;
}

/** Tier 1：旧 web 短路标记 / vite MODE=web 构建 */
export function isWebEntryMode(): boolean {
  if ((globalThis as Record<string, unknown>)["__YSM_WEB__"] === true) return true;
  // ⚠️ 必须直接写 `import.meta.env.MODE`（无中间变量/可选链）：vite 的 define 是
  // 文本替换，`meta.env?.MODE` 编译后变成 `(t=import.meta.env)==null?void 0:t.MODE`，
  // 匹配不到 `import.meta.env.MODE` 原文 → mode:"web" 构建不生效（实测 2026-08）
  return import.meta.env.MODE === "web";
}

/** 同步判定：当前是否应路由到 browser adapter（网页版） */
export function resolveWebMode(): boolean {
  const declared = readDeclaredBackend();
  if (declared !== undefined) return declared === "browser";
  return isWebEntryMode();
}
