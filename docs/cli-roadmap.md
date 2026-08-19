# CLI 发展规划（Roadmap）

> 面向项目维护者（人类 + AI）的 CLI 发展路线图：现状盘点、方向探索、阶段规划。
> 定位：CLI 是 GUI 之外的「第二操作面」——脱壳诊断、批量运维、自动化落地的武器库。
> 原则：复用已有函数优先，通用化、统一、长治久安（见 AGENTS.md 用户偏好）。
> 最后校准：2026-08-19（Phase A 落地后更新；ADR-102 已采纳）。

---

## 一、现状盘点（2026-08-19）

### 1.1 命令清单（19 个，按域）

| 域 | 命令 | 说明 |
|----|------|------|
| 模型管理 | `search` / `analyze` / `list` / `verify` / `export` / `benchmark` | 查询、分析、完整性验证、结构导出、性能基准 |
| MMD 分析 | `file-bench` / `scan-dir` / `analyze-mmd` | 大文件读取性能、目录资产统计、模型资产分析 |
| 性能基准 | `single-bench` / `concurrent-bench` | 单模型加载基准（优化基础）/ 并发能力对比 |
| 缓存管理 | `cache-status` / `cache-verify` / `cache-clear` / `cache-diag` | 状态、命中检查、清空、流程诊断 |
| 配置/流程 | `config-show` / `gui-flow` | 配置查看 / 模拟 GUI 完整加载流程 |
| 日志 | `perf-log` | 优化记录日志（时间倒序） |
| 仓库审计 | `resource-scan` / `repo-audit` | 资产分布扫描 / 健康分数 + 完整性 + 缓存聚合 |

**测试覆盖**：`go test ./go/cli/...` 全绿（0.27s，40+ 用例）。
**源码规模**：`go/cli/` 共 13 个文件，约 115KB，全部 `package cli`。

### 1.2 架构现状

- 入口：`RunCLI` / `runCLIWithApp`（可测入口）→ `dispatchCommand` → `CmdContext{App, FilesRoot, Args}`。
- 命令自注册：各文件 `init()` 里 `RegisterCommand(name, desc, run)`，新增命令零侵入。
- 退出码分级：`ErrParam`（参数错，exit 2）/ `ErrRuntime`（业务错，exit 1）/ 其他（0）。
- 核心优势：**命令天然拿到 `*app.App`**，GUI 与 CLI 共享同一套业务层——CLI 能做的，GUI 链路都能复用。

### 1.3 定位判断

> 现状是「只读诊断工具 + 轻量审计」：查询、分析、测性能、健康评分。**没有写能力，没有自动化落地。**

| 能力 | 现状 | 缺口 |
|------|------|------|
| 查询/分析 | ✅ 完备 | — |
| 性能诊断 | ✅ 完备（single-bench 是地基 + 前端已消费） | 缺基线回归（防性能倒退）→ Phase B |
| 汇总报告 | ⚠️ 单命令输出 / repo-audit 轻度聚合 | 缺一键全仓体检报告（方向 A） |
| 写/运维 | ❌ 无 | 缺导入/清理/同步/转换等写能力 |
| 批量/流水线 | ❌ 无 | 缺 scan→analyze→export→report 串联 |
| 交互体验 | ⚠️ 单命令执行 | 缺 REPL 连续操作 |
| GUI↔CLI 桥接 | ✅ 后端桥 + 前端消费已实现 | Phase B 影子测试体系待落地 |

---

## 二、方向探索（五个候选）

> 来自 2026-08-19 评审后的前景讨论，按「复用现有能力、统一入口」排序。

### 方向 A：模型仓库一键体检报告 🎯（首推）

**一句话**：复用现有命令的能力，合成一份「仓库健康报告」。

- 复用：`verify`（完整性）+ `cache-verify`（缓存命中）+ `analyze-mmd`（超大贴图）+ `single-bench`（性能基线）。
- 形态：`health-report --format table|json`，输出到 stdout 或 `--output health.json`。
- 价值：GUI 的「仓库健康度」是前端算的，CLI 用同一批 Go 侧能力算后端报告——脚本/CI 可消费。
- 落地要点：抽一个 `collectHealthMetrics(app)` 复用函数，各命令调用它，避免三处重复。

### 方向 B：基准回归门禁（防性能倒退）

**一句话**：把 `single-bench` 接进 pre-push/CI，性能有量化基线。

- 形态：`single-bench --baseline baseline.json`（对比上次，超阈值即失败）+ 脚本集成到 pre-push。
- 价值：优化成果被量化锁住，重构/新增功能不敢悄悄拖慢单模型加载。
- 依赖：方向 A 的 JSON 输出结构先稳定，baseline 格式复用它。

### 方向 C：批处理 pipeline（流水线）

**一句话**：多命令串联成一条流水线。

- 形态：`pipeline --steps "scan:dir=./mmd -> analyze-mmd:dir=./mmd -> export"` 或预设场景（`--scene daily`）。
- 价值：脚本/CI 一键出报告，无需记住多条命令。
- 风险：通用化成本高（步骤参数传递、中间产物），**建议先用方向 A 的报告聚合顶替 80% 需求**。

### 方向 D：CLI 写能力扩展（从诊断到运维）

**一句话**：让 CLI 能动手——导入、清理、同步触发、批量转换。

- 形态：`import --model x.ysm`、`cleanup --dry-run`、`sync --push`、`convert-ktx2 --dir`。
- 价值：GUI 之外多一条自动化运维通道（脚本批量操作）。
- 注意：写操作必须 `--dry-run` 默认开启 + 确认提示，守住 AGENTS.md 损害控制红线。

### 方向 E：交互式 REPL（连续操作）

**一句话**：进入 shell 连续执行，不用每次带 `--files-root`。

- 形态：`app --cli --files-root ./models`（无子命令时进 REPL），或 `repl` 子命令。
- 价值：排查卡顿/缓存问题时连续敲命令体验好（AGENTS.md 的环形日志面板场景）。
- 成本：中；需处理提示符、历史、上下文保持（filesRoot 只解析一次）。

---

## 三、三阶段计划与现状对照（2026-08-19 校准）

> 人类设计师提出三阶段计划（清理期 → 深化期 → 打通期），本表逐项对照当前源码，标注已落地 / 进行中 / 待办。
> 原则：先做「复用现有能力、零新依赖」的，再做「需要新基建」的。每阶段完成即验证（go build + go test ./go/cli/...）。

### Phase 1：清理期（1-2 天）

| 项 | 计划 | 现状 | 结论 |
|----|------|------|------|
| ① | 消除 parseFilesRoot 重复调用 | `parseFilesRoot` 已不存在（grep 无结果）；命令统一经 `CmdContext.FilesRoot` 取根目录，不再从 args 反取 | ✅ 已落地（872347f3 重构吸收） |
| ② | 业务错误统一 ErrRuntime 包装 | `ErrParam`（exit 2）/ `ErrRuntime`（exit 1）分级 + `newParamErrf`/`newRuntimeErrf` helper（shared.go:92-99） | ✅ 已落地 |
| ③ | 补充错误类型测试覆盖 | `TestErrParam_Error` / `TestParseFlags_InvalidFlag` / iterations 校验测试等（cli_test.go） | ✅ 已落地 |

### Phase 2：深化期（3-5 天）

| 项 | 计划 | 现状 | 结论 |
|----|------|------|------|
| ① | 实现 CmdContext 统一命令上下文 | `CmdContext{App, FilesRoot, Args}` 已定义（registry.go），全部命令签名 `runXxx(ctx *CmdContext)` | ✅ 已落地 |
| ② | 全局 --json 输出格式开关 | `json.go` 已有 `JsonResponse` 统一协议；`RunCLI` 入口级 `--json` 分支已接入（cli.go:44-66） | ✅ 已落地 |
| ③ | 新增 resource-scan / repo-audit 命令 | `resource.go` 已实现（classifyResourceTypeName 统一口径 + 健康分数算法 + JSON 输出） | ✅ 已落地（dff8f0a6 提交） |
| ④ | 命令文件按场景拆分到子包 | `go/cli/` 已拆 13 个文件（model/mmd/cache/flow/perf/config/resource/concurrent/shared/json/registry） | ✅ 文件级拆分完成 |

### Phase 3：打通期（5-7 天）— ✅ 已完成

| 项 | 计划 | 现状 | 结论 |
|----|------|------|------|
| ① | Wails 绑定 CLI 执行能力到前端 | `internal/app/cli_bridge.go` 已实现 + 测试；`npm run generate:bindings -ts` 已生成前端绑定 | ✅ 已落地 |
| ② | 统一 JSON 输出协议 | `JsonResponse` 协议已建；CLI↔GUI 路径（ExecuteCLI）已走协议；局部命令 `--format` 收敛降级为 Phase 4 可选项 | ✅ 核心路径已统一 |
| ③ | CLI↔GUI 双向联动 | 前端 `cli-bridge.ts` 动态白名单 + 降级缓存已落地；**Phase A 性能诊断面板已消费 single-bench/gui-flow/perf-log** | ✅ 已落地 |

### Phase A：诊断透镜落地（1-2 天）— ✅ 已完成

| 项 | 计划 | 现状 | 结论 |
|----|------|------|------|
| ① | 性能诊断面板（前端消费 single-bench） | `views/app-content/diagnostics/perf.ts`（287 行）：7 阶段柱状图 + >100ms 标红/ >50ms 标黄 + 代际守卫防陈旧响应 | ✅ 已落地（e3646d26） |
| ② | 全流程体检按钮（前端消费 gui-flow） | 6 阶段状态渲染（✅/❌ + 耗时）+ 失败阶段红字提示 | ✅ 已落地 |
| ③ | 优化历史侧栏（前端消费 perf-log） | 时间倒序卡片 + 问题/做法/效果三行明细 | ✅ 已落地 |
| ④ | ADR 立项 | ADR-102 已采纳（CLI 内嵌模式回归与诊断协同平台），标注与 ADR-059 修订演进关系 | ✅ 已落地（98137076） |
| ⑤ | 单测 | `perf.test.ts` 5 用例全绿（single-bench/gui-flow/perf-log 解析渲染 + 错误分支 + 代际守卫） | ✅ 已落地（ee3aca73） |

### Phase B：影子测试体系（3-5 天）— 🟡 待落地

> 目标：CLI 成为 GUI 的「无头验证替身」——Go 后端改动先让 CLI 跑一遍，再让人点 GUI。
> 核心洞察：CLI 和 GUI 共享同一个 `app.App` 业务层，`gui-flow` 跑通 ≈ 后端加载链健康。

| 项 | 计划 | 关键点 | 状态 |
|----|------|--------|------|
| ① | `gui-flow` 契约测试 | `tests/cli-gui-flow-contract.mjs`：跑 `gui-flow --json`，断言配置/扫描/分析三阶段 success + 总耗时 < 阈值；集成 `for f in tests/*.mjs; do node "$f"; done` | ⏳ 待落地 |
| ② | `single-bench` 回归守卫 | `scripts/perf-gate.mjs`：首次存 baseline.json，后续对比每阶段 delta，超 +50% 告警；可选 `YSM_SKIP_GATE=1` 跳过 | ⏳ 待落地 |
| ③ | 前端「性能回归」指示器 | 开发模式 `task dev` 启动后自动跑一次 `single-bench`，退化时环形日志标红 | ⏳ 待落地 |

### Phase C：性能护栏闭环（5-7 天）— 🟡 待落地

> 目标：形成「诊断→优化→验证→锁住」闭环；baseline 文件纳入 git 作为性能锚点。

| 项 | 计划 | 关键点 | 状态 |
|----|------|--------|------|
| ① | `single-bench --baseline` 增强（Go 侧） | 新增 `--baseline`/`--threshold` 参数：对比上次结果输出每阶段 delta，超阈值 exit 1 供 CI 判定；复用 `file-bench` 已有 `loadAndCompareBenchmark` 模式 | ⏳ 待落地 |
| ② | `perf-log` 从文件驱动 | 当前 `perf.go` 硬编码 Go 结构体 → 改为解析 `docs/knowledge/optimization_log.md`；文档与 CLI 单一事实来源 | ⏳ 待落地 |
| ③ | 前端「性能趋势图」 | 每次 `single-bench` 结果存 IndexedDB → 时间线折线图（每阶段一条线） | ⏳ 待落地 |

### 暂缓：pipeline（方向 C-原）

- Phase B 的契约测试 + 回归守卫落地后重新评估——若已覆盖批量场景，pipeline 可降级为「预设场景别名」。

---

## 四、Phase A 落地记录（2026-08-19）

> 「沉睡的金矿」通车——CLI 性能诊断能力通过 Wails 桥到达前端，用户不用开终端即可跑 single-bench/gui-flow/perf-log。

**三个提交**：

| 提交 | 内容 |
|------|------|
| `98137076` | docs: ADR-102 CLI 内嵌模式回归与诊断协同平台（标注与 ADR-059 修订演进关系） |
| `e3646d26` | feat(frontend): 性能面板消费 CLI 能力（perf.ts 287 行 + tpl.ts/init.ts 接入 + 16 个 i18n key 三语言包同步） |
| `ee3aca73` | test(frontend): 性能面板单测（5 用例：single-bench/gui-flow/perf-log 解析渲染 + 错误分支 + 代际守卫） |

**实现亮点**：
- 代际守卫：`perfSingleSeq`/`perfGuiSeq`/`perfHistSeq` 防快速连点旧响应覆盖新响应（对齐 logs.ts 的 `diagLoadSeq` 模式）
- 正则精确对齐 Go 输出：`/^\s+(.+?)\s+(\d+(?:\.\d+)?)ms(?:\s+(.*))?$/` 匹配 `%-20s %10.2fms` 格式
- 瓶颈高亮：>100ms `perf-bar-danger` 标红、>50ms `perf-bar-warn` 标黄（复用 CLI 已有阈值逻辑）
- Web 降级：`resolveWebMode()` 检测后 toast 提示「网页版不支持性能诊断」
- 零 Go 改动：纯前端消费已有 CLI 能力 + 已有 `cli-bridge.ts` 封装

**验收**：`npm run typecheck` 零错误 + `npx vite build` 成功 + `vitest 5/5` 通过 + diff-coverage 通过。

---

## 五、治理红线（CLI 专属）

| 红线 | 说明 |
|------|------|
| 写操作必须 dry-run 默认开启 | 未经确认不得改动用户文件（AGENTS.md 损害控制） |
| 新命令必须带单测 | 入口错误路径 + 参数校验 + 输出断言（参考 cli_test.go 现有模式） |
| JSON 输出结构加版本号 | baseline/报告格式漂移会导致 Phase 2 回归门禁失效 |
| 命令注册走 `RegisterCommand` | 禁止手写 `cliCommands` 映射，保持自注册统一 |
| 复用 `app` 层函数 | 命令内不得复制 GUI 业务逻辑，统一走 `ctx.App` |

---

## 六、相关链接

- 命令使用说明：`AGENTS.md` 末尾「CLI 模式使用说明」
- 源码：`go/cli/`（入口 `cli.go`，`main.go` 经 `cli.RunCLI` 接线）
- 文档登记：`docs/funcmap.md`（go/cli 章节，pre-commit 自动同步）
- 性能理念：`single-bench` 优先（单模型快 = 所有场景快，P0 测试策略）
