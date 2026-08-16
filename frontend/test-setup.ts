// ===== vitest 全局测试基建（setupFiles）=====
// 环境修复，新测试文件免重复处理：
// 1. @wailsio/runtime 全局阻断 —— 其 drag.js 在模块加载时访问 window，
//    happy-dom teardown 后延迟回调报 "window is not defined" 环境噪声
// 2. i18n t() 函数 —— 预加载 zh-CN 翻译表，测试中 t() 返回中文而非 key
// 3. node 环境 localStorage 兜底 —— 纯逻辑测试标 @vitest-environment node 后无
//    localStorage，测试内裸调（beforeEach clear / setItem）会炸；注入内存实现，
//    happy-dom 环境自带 localStorage（in 判断跳过）。ADR-089 编写约定配套基建。
import { vi } from "vitest";
import { zhCN } from "./src/core/i18n/locales/zh-CN.ts";

// 1. Wails runtime 全局阻断（测试环境无需真实 runtime；组件测试可省去各自 vi.mock）
vi.mock("@wailsio/runtime", () => ({
  Events: {
    On: () => () => {},
  },
}));

// 2. i18n t() 全局 mock —— 直接查表 zhCN，无需 fetch
vi.mock("./src/core/i18n/t.ts", async () => {
  const actual = await vi.importActual<typeof import("./src/core/i18n/t.ts")>("./src/core/i18n/t.ts");
  return {
    ...actual,
    t: (key: string, params?: Record<string, string | number>): string => {
      let text = zhCN[key] ?? key;
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          text = text.replace(new RegExp(`\\{${k}\\}`, "g"), () => String(v));
        }
      }
      return text;
    },
  };
});

// 3. node 环境 localStorage 兜底（内存实现，Map 语义；happy-dom 自带，跳过）
if (!("localStorage" in globalThis)) {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    },
  });
}
