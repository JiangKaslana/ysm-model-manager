// ===== 所有 ES module 组件的统一入口 =====
import { bus } from "./bus.ts";
import { PAGE_WHITELIST } from "./core/page-store.ts";
import { register } from "./services/registry.ts";
import { Window } from "@wailsio/runtime";
import { getApp } from "./backend/app.ts";
import { registerErrorDiary } from "./core/error-diary.ts";
import { registerCoiServiceWorker } from "./backend/coi-sw.ts";
import { prefetchStatsWorker } from "./backend/browser-adapter.ts";
import { initI18n } from "./core/i18n/locale.ts";
import { friendlyError } from "./utils/dom/errors.ts";
import { checkUpdateSilent } from "./features/version-updater.ts";
import { applyUIPrefs } from "./views/app-content/settings/ui-prefs.ts";
import { loadView } from "./utils/module-loader.ts";
import { revealMainWindow } from "./startup-reveal.ts";

// bus 已在 bus.ts 中挂载 window.bus，此处不再重复赋值

// 注册全局可替换服务
import { loadInstances } from "./views/app-sidebar/loader.ts";
import { loadEntries } from "./views/app-tree/loader.ts";
register("loadInstances", loadInstances);
register("loadEntries", loadEntries);

// 新版 Web Component（通过 ES Module 导入以支持 shadow DOM）
// 静态导入（浏览器加载失败时直接报错，不 try/catch 以免静默吞错）
// 注意：app-nav 的注册已移至 async IIFE 中，放在 initI18n() 之后，
// 避免首帧渲染时 i18n bundle 尚未加载导致 [i18n] 缺失 key 警告。
import "./views/context-menu/index.ts";
import "./views/app-toast/index.ts";

// Web Components 动态导入（使用字面量确保 Vite 能在构建时解析路径）
loadView("app-tree", () => import("./views/app-tree/index.ts"));
loadView("app-sidebar", () => import("./views/app-sidebar/index.ts"));
const appContentReady = loadView("app-content", () => import("./views/app-content/index.ts"));
loadView("app-resource-manager", () => import("./views/app-resource-manager/index.ts"));
loadView("app-sync-manager", () => import("./views/app-sync-manager/index.ts"));

//  窗口状态已由 Go 端 shutdown 保存，前端不再重复写入

// ===== 全局主题控制 =====

// 2026-08-17 神桶拆分：normalizeTheme/applyTheme/initTheme 已移至 theme-core.ts
// （纯逻辑无顶层副作用，测试可独立 import）；本文件保留启动装配 + window 桥接。
import { normalizeTheme, applyTheme, initTheme } from "./theme-core.ts";
import { safeGet } from "./utils/dom/storage.ts";
export { normalizeTheme, applyTheme, initTheme };

// P3 修复（code_review）：把 page-store 白名单桥接到 window，供 index.html 内联
// DOMContentLoaded 脚本复用（经典脚本无法 import）——消除内联源硬编码第二份列表的
// 双源漂移（新增页时内联源把新页重置回 repository 的静默回归）。
// 红线 §3.1 只禁双下划线前缀（window. 后接两个下划线）；非 __ 前缀与 window.applyTheme 同模式。
// node 测试环境无 window，跳过桥接（浏览器语义不变）
if (typeof window !== "undefined") {
  (window as unknown as { PAGE_WHITELIST?: readonly string[] }).PAGE_WHITELIST = PAGE_WHITELIST;
}

// 启动初始化
(async () => {
 try {
  registerErrorDiary();
  // ADR-079 M1：网页版注册 COI Service Worker（补 COOP/COEP → crossOriginIsolated，
  // 为 pthread WASM 铺路；渐进增强，失败静默降级单线程）
  registerCoiServiceWorker();
  await initI18n();
  try {
    await import("./views/app-nav/index.ts");
  } catch (e) {
    console.warn("[module] app-nav 加载失败:", e);
    bus.emit("toast:show", {
      msg: "❌ " + friendlyError(e, "导航组件加载失败"),
      duration: 5000,
      type: "error",
    });
  }
  try {
    await initTheme();
  } catch (e) {
    console.warn("[theme] 主题初始化失败:", e);
    bus.emit("toast:show", {
      msg: "⚠️ " + friendlyError(e, "主题初始化失败"),
      duration: 5000,
      type: "error",
    });
  }
  applyUIPrefs();
  checkUpdateSilent().catch((e) => console.warn("[updater] 静默检查失败:", e));
  // ADR-101 方向 A：Three.js 模块预加载（非阻塞，省掉首次 3D 预览 ~105ms 脚本编译）
  import("three").catch((e) => console.warn("[preload] three 预加载失败:", e));
  // 启动 2s 后后台预下载 stats.worker chunk（网页版）：让首次数值搜索不用等下载
  setTimeout(() => prefetchStatsWorker(), 2000);
 } finally {
   await appContentReady;
   await revealMainWindow(() => Window.Show());
 }
})();

// node 测试环境无 window，跳过系统主题跟随注册（浏览器语义不变）
if (typeof window !== "undefined") {
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", (e) => {
      // P3 修复（code_review）：裸调改 safeGet——隐私模式每次系统主题切换抛错 → 主题跟随静默失效
      const theme = safeGet("theme") || "system";
      if (theme === "system") {
        applyTheme("system");
        bus.emit("toast:show", {
          msg: `已跟随系统切换至${e.matches ? "深色" : "浅色"}主题`,
          duration: 2000,
          type: "info",
        });
      }
    });
}

// ===== F12 / Ctrl+Shift+I 打开 DevTools（仅开发/调试环境）=====
// 通过查询参数 ?dev=1 或 localStorage 标志启用
// P3 修复：localStorage 裸调在隐私模式抛错会中止模块求值——即使 ?dev=1 也无法启用
const _devtoolsFlag = safeGet("_devtools") === "1";
// node 测试环境无 window，短路跳过 devtools 判定（浏览器语义不变）
const _devMode =
  (typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("dev")) ||
  _devtoolsFlag;
if (_devMode && typeof document !== "undefined") {
  document.addEventListener("keydown", (e) => {
    if (e.key === "F12" || (e.ctrlKey && e.shiftKey && e.key === "I")) {
      e.preventDefault();
      try {
        Window.OpenDevTools();
      } catch (_) {}
    }
  });
}
