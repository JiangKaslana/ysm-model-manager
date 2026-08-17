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

// 0. idb 层全局共享 mock（2026-08-17，isolate:false 穿透修复）——
// browser-adapter 系测试原各自 vi.hoisted 独立 store + per-file vi.mock("./idb.ts")，
// isolate:false 共享模块图下 web-fs.ts 首次求值捕获先运行文件的绑定 → 写入/读取错位。
// 解法：setup 层用 vi.hoisted 建唯一 store 挂 globalThis，vi.mock factory 引用它——
// 所有测试文件（含 web-fs.ts import 链）读写同一 store，穿透消失。
// 注意：vi.hoisted 变量不能 export（vitest 限制），共享实例经 globalThis 传递。
vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  if (!g.__YSM_TEST_IDB__) {
    const store = new Map<string, unknown>();
    g.__YSM_TEST_IDB__ = {
      idbGet: vi.fn(async (_s: string, k: string) => store.get(k)),
      idbSet: vi.fn(async (_s: string, k: string, v: unknown) => {
        store.set(k, v);
      }),
      idbKeys: vi.fn(async (_s: string, prefix: string) =>
        [...store.keys()].filter((k) => k.startsWith(prefix)),
      ),
      idbDel: vi.fn(async (_s: string, k: string) => {
        store.delete(k);
      }),
      _store: store,
    };
  }
  return g.__YSM_TEST_IDB__;
});
vi.mock("./src/backend/idb.ts", () => {
  const m = (globalThis as Record<string, unknown>).__YSM_TEST_IDB__ as {
    idbGet: unknown; idbSet: unknown; idbKeys: unknown; idbDel: unknown;
  };
  return { idbGet: m.idbGet, idbSet: m.idbSet, idbKeys: m.idbKeys, idbDel: m.idbDel };
});

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

// 4. three 全局 mock（2026-08-17，isolate:false 审核模式修复）
// 根因：isolate:false 共享模块图，先跑的兄弟测试（mmd-adapter 等）把真实 three
// 求值进共享图，mount-preview-core 的 `import * as THREE` 绑定固化指向真实 three，
// 后跑文件的 per-file vi.mock("three") 无法改写已求值绑定 → 真实 WebGLRenderer 在
// happy-dom（getContext 返回 null）下抛 "Error creating WebGL context"。
// 解法：setupFiles 全局 mock——每个测试文件运行前都执行，worker 内第一个 import
// "three" 就拿到 mock，真实 three 永不进入共享图，isolate:true/false 双模式同口径。
// importActual 保留纯 JS 部分（Box3/Vector3/Light 等），15+ 个用真实 three 的测试零回归；
// 只 stub WebGLRenderer / PMREMGenerator（需真实 WebGL context 的构造路径）。
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  class FakeWebGLRenderer {
    domElement: HTMLElement;
    constructor() {
      // 构造时引用 document（延迟求值，node 环境安全；happy-dom 有 document）
      this.domElement = document.createElement("div");
    }
    setSize(): void {}
    setPixelRatio(): void {}
    render(): void {}
    dispose(): void {}
    setPointerCapture(): void {}
    hasPointerCapture(): boolean { return false; }
    releasePointerCapture(): void {}
    getContext(): null { return null; }
  }
  class FakePMREMGenerator {
    constructor() {}
    fromScene(): { texture: {} } { return { texture: {} }; }
    dispose(): void {}
  }
  return {
    ...actual,
    WebGLRenderer: FakeWebGLRenderer as unknown as typeof actual.WebGLRenderer,
    PMREMGenerator: FakePMREMGenerator as unknown as typeof actual.PMREMGenerator,
  };
});
