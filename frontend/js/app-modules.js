// ===== 所有 ES module 组件的统一入口 =====
import { bus } from "./bus.js";
import { register } from "./services/registry.js";

// bus 已在 bus.js 中挂载 window.bus，此处不再重复赋值

// 注册全局可替换服务
import { loadInstances } from "./components/app-sidebar/loader.js";
import { loadEntries } from "./components/app-tree/loader.js";
register("loadInstances", loadInstances);
register("loadEntries", loadEntries);

// 新版 Web Component（通过 ES Module 导入以支持 shadow DOM）
// 静态导入（浏览器加载失败时直接报错，不 try/catch 以免静默吞错）
import "./components/app-nav.js";
import "./components/context-menu.js";
import "./components/app-toast.js";
// Web Components 动态导入（使用字面量确保 Vite 能在构建时解析路径）
import("./components/app-tree/index.js").catch((e) =>
  console.warn("[module] 组件加载失败: app-tree", e),
);
import("./components/app-sidebar/index.js").catch((e) =>
  console.warn("[module] 组件加载失败: app-sidebar", e),
);
import("./components/app-content/index.js").catch((e) =>
  console.warn("[module] 组件加载失败: app-content", e),
);
import("./components/app-resource-manager/index.js").catch((e) =>
  console.warn("[module] 组件加载失败: app-resource-manager", e),
);
import("./components/app-sync-manager/index.js").catch((e) =>
  console.warn("[module] 组件加载失败: app-sync-manager", e),
);

// 右键菜单映射
import { registerContextMenus } from "./core/context-menus.js";
registerContextMenus();

//  窗口状态已由 Go 端 shutdown 保存，前端不再重复写入

import {
  applyUIPrefs,
  bindThemeBtn,
  initTheme,
  watchSystemTheme,
} from "./core/theme.js";
import { applyCustomColors } from "./core/custom-colors.js";

// 启动初始化
(async () => {
  await initTheme();
  applyUIPrefs();
  applyCustomColors();
  bindThemeBtn();
  watchSystemTheme();
  // 静默检查更新（不阻塞界面）
  const { checkUpdateSilent } = await import("./features/version-updater.js");
  checkUpdateSilent().catch((e) => console.warn("[updater] 静默检查失败:", e));
})();

// ===== 禁用旧版 document 拖拽处理器（新版组件已接管）=====
document.addEventListener(
  "dragover",
  (e) => {
    if (e.target?.closest?.("#ws-page, #dl-drop, .ws-page")) {
      e.preventDefault();
      e.stopPropagation();
    }
  },
  true,
);
document.addEventListener(
  "drop",
  (e) => {
    if (e.target?.closest?.("#ws-page, #dl-drop, .ws-page")) {
      e.preventDefault();
      e.stopPropagation();
    }
  },
  true,
);

// ===== F12 / Ctrl+Shift+I 打开 DevTools（仅开发/调试环境）=====
// 通过查询参数 ?dev=1 或 localStorage 标志启用
const _devMode =
  new URLSearchParams(window.location.search).has("dev") ||
  localStorage.getItem("_devtools") === "1";
if (_devMode) {
  document.addEventListener("keydown", (e) => {
    if (e.key === "F12" || (e.ctrlKey && e.shiftKey && e.key === "I")) {
      e.preventDefault();
      try {
        window.runtime.WindowShowDevtools?.();
      } catch (_) {}
    }
  });
}
