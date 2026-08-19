# CLI 发展规划（Roadmap）

> 面向项目维护者（人类 + AI）的 CLI 发展路线图：现状盘点、方向探索、阶段规划。
> 定位：CLI 是 GUI 之外的「第二操作面」——脱壳诊断、批量运维、自动化落地的武器库。
> 原则：复用已有函数优先，通用化、统一、长治久安（见 AGENTS.md 用户偏好）。

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

### 1.2 架构现状

- 入口：`RunCLI` / `runCLIWithApp`（可测入口）→ `dispatchCommand` → `CmdContext{App, FilesRoot, Args}`。
- 命令自注册：各文件 `init()` 里 `RegisterCommand(name, desc, run)`，新增命令零侵入。
- 退出码分级：`ErrParam`（参数错，exit 2）/ `ErrRuntime`（业务错，exit 1）/ 其他（0）。
- 核心优势：**命令天然拿到 `*app.App`**，GUI 与 CLI 共享同一套业务层——CLI 能做的，GUI 链路都能复用。

### 1.3 定位判断

> 现状是「只读诊断工具」：查询、分析、测性能。**没有写能力，没有自动化落地。**

| 能力 | 现状 | 缺口 |
|------|------|------|
| 查询/分析 | ✅ 完备 | — |
| 性能诊断 | ✅ 完备（single-bench 是地基） | 缺基线回归（防性能倒退） |
| 汇总报告 | ⚠️ 单命令输出 | 缺一键全仓体检报告 |
| 写/运维 | ❌ 无 | 缺导入/清理/同步/转换等写能力 |
| 批量/流水线 | ❌ 无 | 缺 scan→analyze→export→report 串联 |
| 交互体验 | ⚠️ 单命令执行 | 缺 REPL 连续操作 |

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

## 三、阶段规划

> 原则：先做「复用现有能力、零新依赖」的，再做「需要新基建」的。每阶段完成即验证（go build + go test ./go/cli/...）。

### Phase 1：报告聚合（方向 A）

- 目标：`health-report` 命令，聚合 verify/cache/analyze/bench 结果，JSON 可机器读。
- 产出：`go/cli/report.go` + 单测（复用现有命令函数，不重写逻辑）。
- 验收：`health-report --format json` 输出合法 JSON；对空仓库、正常仓库都有明确输出。

### Phase 2：基线回归（方向 B）

- 目标：`single-bench` 支持 `--baseline` 对比 + 阈值失败；JSON 输出结构稳定。
- 产出：baseline 文件格式约定（版本号字段，防格式漂移）+ pre-push 集成脚本（可选开关）。
- 验收：故意改慢单模型加载，pre-push 能拦住。

### Phase 3：写能力与 REPL（方向 D + E，择机并行）

- 目标：`import`/`cleanup --dry-run` 先落地；REPL 作为体验升级。
- 产出：写操作统一走 `confirm` helper（`--dry-run` 默认开）；REPL 复用 `dispatchCommand` 单次分发。
- 验收：写操作全部有 dry-run 与确认；REPL 连续 5 条命令无状态污染。

### 暂缓：pipeline（方向 C）

- 方向 A 报告聚合落地后重新评估——若报告已覆盖批量场景，pipeline 可降级为「预设场景别名」。

---

## 四、治理红线（CLI 专属）

| 红线 | 说明 |
|------|------|
| 写操作必须 dry-run 默认开启 | 未经确认不得改动用户文件（AGENTS.md 损害控制） |
| 新命令必须带单测 | 入口错误路径 + 参数校验 + 输出断言（参考 cli_test.go 现有模式） |
| JSON 输出结构加版本号 | baseline/报告格式漂移会导致 Phase 2 回归门禁失效 |
| 命令注册走 `RegisterCommand` | 禁止手写 `cliCommands` 映射，保持自注册统一 |
| 复用 `app` 层函数 | 命令内不得复制 GUI 业务逻辑，统一走 `ctx.App` |

---

## 五、相关链接

- 命令使用说明：`AGENTS.md` 末尾「CLI 模式使用说明」
- 源码：`go/cli/`（入口 `cli.go`，`main.go` 经 `cli.RunCLI` 接线）
- 文档登记：`docs/funcmap.md`（go/cli 章节，pre-commit 自动同步）
- 性能理念：`single-bench` 优先（单模型快 = 所有场景快，P0 测试策略）
