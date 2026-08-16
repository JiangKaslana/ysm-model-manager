# ADR-089：测试环境切分持续推进：慢测试定位与 node 环境甄别

- **状态**：✅ 已采纳
- **日期**：2026-08-17
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/vitest.config.ts`（环境分流约定注释）/ `frontend/test-setup.ts` / `frontend/src/**/*.test.ts` / `ADR-054 测试性能治理` / `ADR-023 测试体系`

---

## 1. 背景（Context）

ADR-054（2026-08-12）已落地 vitest 环境分流第一轮：58 个纯逻辑测试文件标 `// @vitest-environment node`，3 个源模块顶层 window 惰性化，vitest 全量 62s→20.3s。

2026-08-17 用户询问「测试文件跑这么慢是不是测试的对象比较慢」，触发重新实测定位。vitest Duration 分解（`--reporter=verbose`，162 文件 / 2263 用例）：

```
transform   16.69s   ← 模块转换
setup        8.53s
import      30.47s   ← 模块导入（最大头之一）
tests       28.37s   ← 纯测试执行
environment 30.09s   ← 环境创建（每文件 happy-dom 重建）
```

**关键结论：`import(30.5s) + environment(30.1s)` 是 `tests(28.4s)` 的两倍以上——慢的是测试基建（模块导入 + 环境初始化），不是测试对象本身**。单测实测全部毫秒级（0-140ms），无一个被测对象超过 200ms。

## 2. 决策（Decision）

### 2.1 环境切分持续推进（ADR-054 2.2 的延续，非新方向）

- **现状盘点（2026-08-17）**：162 个测试文件，80 个已标 node 环境，**82 个仍默认 happy-dom 重建**（vitest `isolate: true` 每文件 ~1.2s——82 × 1.2s ≈ 环境成本主来源）。
- **继续甄别**：82 个未标注文件中，凡不触碰 `window/document` 的纯逻辑测试（backend 解析类、utils 纯函数类）继续标 `@vitest-environment node`——预计再省 ~15-20s。
- **真 DOM 测试保留 happy-dom**：3D 预览菜单 / modal / dnd / recycle-bin 等 DOM 交互测试的环境成本是必要的，不切。

### 2.2 切环境障碍的标准解法（本轮实测确认）

node 环境切分失败根因（ADR-054 已识）是 import 链上模块的**顶层 DOM 副作用**。本轮隔壁提交 `e6d234ae` 补充两个标准解法：

- **`vi.stubGlobal` 替代直接赋值**：`globalThis.navigator` / `crossOriginIsolated` 在 Node 20+ 为 getter-only，直接赋值抛 TypeError——用 `vi.stubGlobal("navigator", {...})` 等替代（`coi-sw.test.ts` 4 处）。
- **`document` mock**：`--environment node` 下无 `document`，对被测模块顶层引用的 DOM 全局在测试内 `vi.stubGlobal` / mock（`context-menus.test.ts`）。

### 2.3 测试编写约定（延续 ADR-054，写入 vitest.config.ts 注释）

- 首行标注 `// @vitest-environment node`：纯逻辑测试（不触碰 window/document 等 DOM 全局）——成本 ~0ms。
- 保持默认 happy-dom：依赖 DOM 的测试。
- 源模块顶层 window 副作用须惰性化（`typeof window !== "undefined"` 守卫），如 bus.ts / app-modules.ts / debug.ts。

## 3. 后果（Consequences）

**正面**：
- 慢测试定位结论固化：**慢在框架基建（import + 环境重建），非被测对象**——避免未来再误判「测试对象慢」而错误优化业务代码。
- 环境切分方向延续 ADR-054，隔壁已推进（`e834ad55` 切 21 文件 + `e6d234ae` DOM 兼容），剩余甄别有明确标准（是否触碰 DOM 全局）。
- `vi.stubGlobal` / `document` mock 解法沉淀，后续切环境直接套用。

**负面 / 风险**：
- 🔴 剩余 82 个文件中真 DOM 测试（3D 预览等）的环境成本无法消除——这是隔离正确性的必要代价，`isolate: false` / 文件合并（MikuMikuAR ADR-256 路线）已评估不采纳（单例穿透风险 / import 非瓶颈）。
- 🟡 切环境是逐文件甄别，误切真 DOM 测试会引发 `window is not defined`——切前须跑单文件验证。

**已知遗留**：
- 82 个 happy-dom 文件中具体哪些可切 node，待逐文件甄别（按「是否触碰 DOM 全局」标准）。
- 环境累计成本仍在（真 DOM 测试必要付出），全量 vitest ~17-20s 为当前基线。

## 4. 数据溯源

来源：用户询问「测试文件慢是不是测试对象慢」→ 实测 vitest Duration 分解（import 30.47s / environment 30.09s ≫ tests 28.37s）→ 量化 162 文件 / 80 标 node / 82 默认 happy-dom → 确认 ADR-054 环境分流方向正确、推进不足 → 隔壁提交 `e834ad55`（21 文件切 node）+ `e6d234ae`（vi.stubGlobal/document mock 标准解法）→ ADR-089 固化定位结论与甄别标准。

<!-- 文件名: test-env-split-continued.md → 实际文件 ADR-089-test-env-split-continued.md -->
