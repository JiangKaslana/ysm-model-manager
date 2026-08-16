# Vitest 环境切换规则

> 测试文件从 `happy-dom` 切到 `@vitest-environment node` 的判定标准和修复模式。

## 核心原则

`@vitest-environment node` 环境无 `window` / `document` / `localStorage` / `navigator` 等浏览器 API。**只有纯逻辑测试（不碰 DOM）才能切**。

## 判定流程

```
检查测试文件是否使用以下 API：
├── document.body / document.createElement / querySelector
├── innerHTML / attachShadow / adoptedStyleSheets
├── addEventListener / removeEventListener
├── localStorage / sessionStorage
├── new Image() / canvas / getContext
├── window.go / window.wails（Wails 桥接）
└── navigator / location / crossOriginIsolated
     └── 有任一 → 需要 happy-dom（不可切）
         └── 全无 → 可以切 node
```

**注意**：即使测试文件本身不用 DOM，import 的源文件也可能在模块顶层或函数体内访问 `window`。逐一检查 import 链。

## 翻车修复模式

### 模式 1：`vi.stubGlobal` 替代 `(globalThis)` 赋值

Node.js 20+ 的 `navigator` / `crossOriginIsolated` / `location` 是 getter-only，直接 `(globalThis)["x"] = y` 抛 TypeError。

```ts
// ❌ 错误
(globalThis as any)["navigator"] = { serviceWorker: { register: vi.fn() } };

// ✅ 正确
vi.stubGlobal("navigator", { serviceWorker: { register: vi.fn() } });
vi.stubGlobal("crossOriginIsolated", false);
vi.stubGlobal("location", { reload: vi.fn() });

// 清理（afterEach）
vi.unstubAllGlobals();
```

### 模式 2：`vi.stubGlobal("document", mockDoc)`

测试文件中 import 的 handler 在运行时调用 `document.createElement` 等 DOM API，但 handler 本身是纯逻辑，不依赖 DOM 渲染结果。

```ts
// 在 describe 顶层或 beforeAll 中
const documentMock = {
  createElement: vi.fn(() => ({
    style: {},
    click: vi.fn(),
    // 按需补齐被调用的属性/方法
  })),
  appendChild: vi.fn(),
  removeChild: vi.fn(),
  execCommand: vi.fn(),
  body: { appendChild: vi.fn(), removeChild: vi.fn() },
  createTextNode: vi.fn(),
};
vi.stubGlobal("document", documentMock);

afterAll(() => { vi.unstubAllGlobals(); });
```

### 模式 3：mock 顶层模块，阻断 import 链

当 import 链中的模块（如 `capabilities.ts` → `android-bridge.ts` → `window`）在函数体内访问 `window`，且测试不直接调用该函数：

```ts
// capabilities.ts 被 bus-handlers.ts 导入，但 can() 只在运行时调用
vi.mock("../../utils/dom/capabilities.ts", () => ({
  can: vi.fn(() => true),
}));
```

### 模式 4：mock `getApp` 阻断 Wails 桥

`backend/app.ts` 的 `getApp()` 在函数体内访问 `window.go.main.App`。node 下 `window` 不存在，需要在 `app.ts` 层 mock：

```ts
const { getAppMock } = vi.hoisted(() => ({ getAppMock: vi.fn() }));
vi.mock("../../backend/app.ts", () => ({ getApp: getAppMock }));

// 测试中设置 mock return 值
getAppMock.mockResolvedValue({
  LoadAppConfig: vi.fn().mockResolvedValue({ mcRoot: "" }),
  ListVersionInstances: vi.fn(),
  // ...
});
```

**注意**：`vi.mock` factory 会被 hoist 到文件顶部，引用的变量须用 `vi.hoisted()` 包裹，不能直接用 `const` 定义。

## 已切换文件清单

### 第一批（27 个，提交 e834ad55 + 后续）

| 文件 | 切换方式 | 注意事项 |
|------|---------|---------|
| `backend/extract.test.ts` | 直接标注 | 纯逻辑 |
| `backend/nbt-parse.test.ts` | 直接标注 | 纯逻辑 |
| `backend/voxel-parse.test.ts` | 直接标注 | 纯逻辑 |
| `backend/web-stats.test.ts` | 直接标注 | 纯逻辑 |
| `backend/web-store.logs.test.ts` | 直接标注 | 纯逻辑 |
| `backend/coi-sw.test.ts` | 标注 + 模式1 | 隔壁已修 `vi.stubGlobal` |
| `core/handlers/instance-ops.test.ts` | 直接标注 | 纯逻辑 |
| `core/context-menus.test.ts` | 标注 + 模式2 | 隔壁已修 `document` mock |
| `features/dnd-collector.test.ts` | 直接标注 | 纯逻辑 |
| 14 个 `utils/3d/*.test.ts` | 直接标注 | 纯逻辑（骨骼/材质/感知/能力） |
| `utils/3d/adapters/vrm-bone.test.ts` | 直接标注 | 纯逻辑 |
| `views/app-preview/mmd-siblings.test.ts` | 直接标注 | 纯逻辑 |
| `views/app-sidebar/loader.test.ts` | 标注 + 模式4 | mock `getApp` |
| `views/app-tree/bus-handlers.test.ts` | 标注 + 模式3 | mock `capabilities` |

### 仍需 happy-dom 的（80 个）

所有涉及 DOM 渲染（Web Components / Shadow DOM / querySelector / innerHTML / localStorage 端到端测试）的文件。

## 收益

| 指标 | 改前 | 改后 | 变化 |
|------|------|------|------|
| node 环境文件 | 61 | 88 | +27 |
| happy-dom 文件 | 101 | 74 | -27 |
| vitest 墙钟 | ~19s | ~16s | -3s（-16%） |