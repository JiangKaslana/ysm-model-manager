# ADR-054：测试性能治理：fixtures 裁剪与 vitest 环境分流

- **状态**：✅ 已采纳（Accepted）
- **日期**：2026-08-12
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`ADR-023 测试体系`；`frontend/vitest.config.ts`；`frontend/src/real-data-fuzz.test.ts`；`go/ysm/extracted_fixture_test.go`；`go/threejs/spec_fixture_test.go`；`frontend/src/utils/debug/debug.ts`；参考 `MikuMikuAR ADR-255`

---

## 1. 背景（Context）

全量质量门禁（doctor ~95s / vitest ~62s）的耗时构成实测暴露两个大头：

1. **real-data-fuzz 真实数据轰击（46s，vitest 的 72%）**：`tests/fixtures/ysm/` 从"最小真实样本"（注释声称 3 模型 25 JSON）膨胀到 392 文件 / 68MB——wine-fox 一整作者合集 22 个模型、suifan 8 个模型。227 个动画文件共 50.3MB，`parseBedrockAnimationJSON` 全量解析 45s 是硬成本，worker 并行也压不动（单文件串行天花板）。
2. **环境初始化（142.6s 累计）**：vitest `isolate: true` 下 happy-dom **每文件重建**（~1.2s/文件），119 个文件全部付 happy-dom 环境成本，即使纯逻辑测试（不触碰 DOM 全局）也付全价。

## 2. 决策（Decision）

### 2.1 fixtures 裁剪到最小样本（392 → 40 文件，68MB → ~5MB）

分两轮：

- **第一轮（AI 提交 d7f114b6）**：392→97 文件。保留 `lucia`/`shen-fengling`/`xigelika` 全量（go/ysm、go/threejs 测试按目录名硬依赖），suifan/wine-fox 各留 2 个代表模型（覆盖 vehicle/多组件/controller/fp.arm 等特殊形态）。
- **第二轮（用户提交 f26cf074）**：97→40 文件。作者目录层（wine-fox/suifan/shen-fengling/xigelika）移除，仅留 3 个顶层代表目录：`01_taisho_maid`（18 文件，vehicle + 多组件 + fp.arm）、`博丽灵梦Hakurei_Reimu`（17 文件，controller × 3 + 多动画）、`lucia`（5 文件，go/threejs 依赖）。

### 2.2 vitest 环境分流：纯逻辑测试切 node（58/60 文件）

- **新增测试编写约定**（写入 `vitest.config.ts` 注释）：不触碰 `window`/`document` 等 DOM 全局的测试文件首行标注 `// @vitest-environment node`（环境成本 ~0ms）；依赖 DOM 的保持默认 happy-dom。
- **60 个无 DOM 引用候选 → 21 个失败（`window is not defined`）→ 回滚 21 + 2 个真 DOM（app-modules/bus-handlers 测试）→ 58 个落地**。失败根因是 import 链上模块的**顶层 DOM 副作用**。
- **3 个源模块顶层 window 挂载惰性化**（`typeof window !== "undefined"` 守卫）：`bus.ts`（`window.bus`）、`app-modules.ts`（`window.applyTheme`）、`debug.ts`（顶层 `window.location` 计算 ENABLED + `window._DBG_RING` + `window.debugGetSpec`）。浏览器语义不变（有 window 照常挂载），node 下安全加载；`debug.ts` 的 `ENABLED` 在 node 下恒 false，`dbg()` 自动短路。

### 2.3 并发对齐

`doctor.mjs` / `pre-push-gate.mjs` 的 vitest 调用统一 `--maxWorkers 8`（与 `frontend/package.json` 一致）——24 核默认并发 fork 过多反有调度开销。

## 3. 后果（Consequences）

- **正面**：real-data-fuzz 46s→<10s；vitest 全量 62s→20.3s（-68%）；doctor 全量 ~95s→67.7s（-29%）；git 仓库 -60MB+。验证：vitest 119 文件全绿（fixtures 精简后 1440 用例）、go test 全过、vite build + tsc 通过。
- **负面 / 取舍**：
  - 模型覆盖样本从 30+ 模型收敛到 3 个代表（特殊形态 vehicle/controller/fp.arm 仍覆盖，批量多样性收窄）。
  - **go/ysm 目录式回归测试静默 SKIP**：`TestFindComponentsInExtractedYSM_DirFixture_ShenFengling / _Xigelika / _SourceNameNoExt / _WineFoxAll` 因对应目录移除而 `t.Skipf`（fixture 缺失按设计降级，不红但不测）——"真实目录式 YSM 模型（ysm.json + models/ + 纹理声明序）"链路的 Go 侧回归覆盖失效，仅保留 vitest 侧解析覆盖与 `lucia` 的 threejs 链路。若后续需要 Go 侧目录式回归，需重新引入一个含 `ysm.json + models/` 结构的目录样本。
  - 惰性化 3 个生产模块引入守卫分支（语义不变但需在新增模块顶层 window 副作用时保持此约定）。
- **已知遗留**：环境累计仍 ~70-78s（60 个 happy-dom 文件为真 DOM/渲染路径）；`isolate: false` 与测试文件合并（MikuMikuAR ADR-256 路线）均评估不采纳——isolate 关闭有单例穿透风险，合并解决的是 import 成本（本项目仅 7-9s，非瓶颈）。

## 4. 数据溯源

- 来源：doctor/pre-push/vitest 各环节 `Measure-Command` 实测计时 ∩ junit/JSON reporter 逐文件耗时分析 ∩ `git grep` fixtures 引用面 ∩ MikuMikuAR ADR-255/256 结论搬运。
- 结果：fixtures 392→40 文件（三轮提交 `c985660d` 并发对齐 / `d7f114b6` 首轮裁剪 / `e7e36de0` 环境分流 / `f26cf074` 用户二轮精简）；58 个测试文件标注 node 环境；3 个源模块惰性化；go/ysm 4 个 fixture 测试 SKIP 副作用如实记录。
