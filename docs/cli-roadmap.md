# CLI 发展规划（Roadmap）

> 面向项目维护者（人类 + AI）的 CLI 发展路线图：现状盘点、方向探索、阶段规划。
> 定位：CLI 是 GUI 之外的「第二操作面」——脱壳诊断、批量运维、自动化落地的武器库。
> 原则：复用已有函数优先，通用化、统一、长治久安（见 AGENTS.md 用户偏好）。
> 最后校准：2026-08-21（命令清单与文档同步机制全面刷新；写能力命令已长成）。

---

## 一、现状盘点（2026-08-21）

### 1.1 命令清单（38 个顶层命令，按域）

> **完整命令参考（含子命令/选项）以 [`docs/cli-commands.md`](./cli-commands.md) 为准**——
> 由 `scripts/gen-cli-doc.mjs` 从 `go/cli/` 注册表自动生成，`tests/test_cli_doc_parity.mjs`
> 锁注册表↔文档双向一致，本文档仅作定位概览不再逐命令维护（防漂移）。

| 域 | 命令 |
|----|------|
| 模型管理 | `search` / `analyze` / `list` / `verify` / `export` / `benchmark` / `install` / `tags` / `move` / `copy` / `rename` / `toggle` |
| MMD 分析 | `file-bench` / `scan-dir` / `analyze-mmd` |
| 性能基准 | `single-bench` / `concurrent-bench` / `gui-flow` / `perf-log` / `perf-snapshot` |
| 缓存管理 | `cache-status` / `cache-verify` / `cache-clear` / `cache-diag` |
| 配置/流程 | `config` / `config-show` / `link-mode` |
| 资源仓库 | `scan` / `resource-scan` / `repo-audit` / `health-report` / `dedup` / `avatar` / `creator` / `workshop` / `instance` / `recycle` / `download` |

**测试覆盖**：`go test ./go/cli/...` 全绿（0.27s，40+ 用例）。
**源码规模**：`go/cli/` 共 23 个文件，全部 `package cli`。

### 1.2 架构现状

- 入口：`RunCLI` / `ExecuteCLIWithApp`（可测入口）→ `DispatchCommand` → `CmdContext{App, FilesRoot, Args}`。
- 命令自注册：各文件 `init()` 里 `RegisterCommandC(name, cat, desc, run)`，新增命令零侵入。
- 退出码分级：`ErrParam`（参数错，exit 2）/ `ErrRuntime`（业务错，exit 1）/ 其他（0）。
- 核心优势：**命令天然拿到 `*app.App`**，GUI 与 CLI 共享同一套业务层——CLI 能做的，GUI 链路都能复用。

### 1.3 定位判断（2026-08-21 刷新）

> 现状是「只读诊断 + 轻量审计 + **已具备写/运维能力**」：除了查询/分析/测性能/健康评分，
> `install` / `tags` / `move/copy/rename/toggle` / `recycle` / `instance sync|push|pull` /
> `config mirror|link-mode` 等写操作已落地（早前「没有写能力」结论已过时）。

| 能力 | 现状 | 缺口 |
|------|------|------|
| 查询/分析 | ✅ 完备 | — |
| 性能诊断 | ✅ 完备（single-bench 是地基 + 前端已消费 + `--baseline` 基准回归） | — |
| 汇总报告 | ✅ **已落地**（`health-report`：完整性+缓存+资源+去重聚合 + 可选 --bench 性能基线，方向 A 完成） | — |
| 写/运维 | ✅ 已落地（install/tags/fileops/recycle/instance/config mirror/dedup clean） | — |
| 批量/流水线 | ❌ 无 | 缺 scan→analyze→export→report 串联 |
| 交互体验 | ⚠️ 单命令执行 | 缺 REPL 连续操作 |
| GUI↔CLI 桥接 | ✅ 后端桥 + 前端消费 + B 门禁/回归 + C 性能护栏全落地 | — |
| **文档同步** | ✅ **已治本**：`gen-cli-doc.mjs` 生成 `docs/cli-commands.md`，AGENTS.md 转指针页，契约测试锁 parity | — |

---

## 二、方向探索（五个候选）

> 来自 2026-08-19 评审后的前景讨论，按「复用现有能力、统一入口」排序。

### 方向 A：模型仓库一键体检报告 🎯（首推）— ✅ 已落地（2026-08-21）

**一句话**：复用现有命令的能力，合成一份「仓库健康报告」。

- 落地：`health-report [--dir X] [--output health.json] [--bench]`（`go/cli/health.go`）
  - 聚合：完整性 + 缓存 + 资源 + **去重**（`dedup.FindDuplicateFiles`），`--bench` 追加首模型 single-bench 性能基线
  - 复用：核心走 `collectRepoHealth`（自 `repo-audit` 抽出，一次遍历出审计结构，**双命令同源防双轨漂移**）
  - 替代了原规划里的 `verify+cache-verify+analyze-mmd` 手工串联——`collectRepoHealth`（含完整性/缓存/资源）
    + dedup 去重占比 80% 体检需求，超大贴图维度留作 `--bench`/`analyze-mmd` 专项
- 契约：`tests/test_cli_doc_parity.mjs` 命令数 38 锁定入册
- 遗留：GUI「仓库健康度」面板仍由前端自算，后续可消费 `health-report --json`（复用同源口径）

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

### Phase B：影子测试体系（3-5 天）— ✅ 已完成

> 目标：CLI 成为 GUI 的「无头验证替身」——Go 后端改动先让 CLI 跑一遍，再让人点 GUI。
> 核心洞察：CLI 和 GUI 共享同一个 `app.App` 业务层，`gui-flow` 跑通 ≈ 后端加载链健康。

| 项 | 计划 | 关键点 | 状态 |
|----|------|--------|------|
| ① | `gui-flow` 契约测试 | 静态契约 `tests/test_cli_gui_flow_contract.mjs`（白名单 + 输出格式↔前端正则锚定）进每次 push 门禁；真跑门禁 `scripts/gui-flow-gate.mjs`（配置/扫描必绿、有模型强验全链路、无模型降级）独立 CI/手动触发 | ✅ 已落地（e0f70090） |
| ② | `single-bench` 回归守卫 | `scripts/perf-gate.mjs`：`--init` 建 baseline 锚点 + 逐阶段阈值对比（默认 1.5x）。fixtures 小模型耗时 ms 级噪声无锚定价值——须真实模型库建锚点 | ✅ 已落地（c01220a3） |
| ③ | 前端「性能回归」指示器 | 规划设想 dev 启动自动跑 single-bench 退化标红；已由 perf.ts 趋势图（按需看）+ perf-gate（显式对比）覆盖，判定不单独做（真跑慢 + 落盘副作用） | ✅ 已收敛 |

### Phase C：性能护栏闭环（5-7 天）— ✅ 已完成

> 目标：形成「诊断→优化→验证→锁住」闭环；baseline 文件纳入 git 作为性能锚点。

| 项 | 计划 | 关键点 | 状态 |
|----|------|--------|------|
| ① | `single-bench --baseline` 增强（Go 侧） | 新增 `--baseline`/`--save-baseline`/`--threshold` 参数：逐阶段输出「基准→当前」delta，退化超阈值报错（CI exit 1）；基准 JSON `[{name,ms}]`；`avgBenchStages` 复用 | ✅ 已落地（e834d6f9） |
| ② | `perf-log` 从文件驱动 | `perf.go` 改解析 `docs/knowledge/optimization_log.md` 表格（AI 改文档即同步 CLI）；`findOptimizationLog` 向上定位仓库根，兼容 go test / CLI 双 cwd | ✅ 已落地（e834d6f9） |
| ③ | 前端「性能趋势图」 | perf.ts 每次 single-bench 存历史（localStorage `safeSet` 收敛封装，量小不引 IndexedDB 新基建）+ 原生 SVG 折线（每阶段一条线 + 图例 + 网格） | ✅ 已落地（0f75132c） |

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

## 五、Phase B/C 落地记录（2026-08-19）

> CLI 从「沉睡的金矿」到「通车」——诊断可视化(A) → 加载链门禁+回归守卫(B) → 性能护栏闭环(C) 全部落地。

| 提交 | 阶段 | 内容 |
|------|------|------|
| `e0f70090` | B-1 | 静态契约 `tests/test_cli_gui_flow_contract.mjs`（进门禁）+ 真跑门禁 `scripts/gui-flow-gate.mjs` |
| `c01220a3` | B-2 | single-bench 回归守卫 `scripts/perf-gate.mjs`（baseline 锚点 + 阈值对比） |
| `0f75132c` | B-3 | 前端性能趋势图（localStorage 历史 + SVG 折线） |
| `e834d6f9` | C-1/C-2 | single-bench `--baseline` 对比 + perf-log 改 `optimization_log.md` 文档驱动 |

**关键决策**：
- 门禁分层：静态契约（无副作用）进每次 push 门禁；`gui-flow-gate` / `perf-gate` 真跑（有 `SaveAppConfig` 落盘副作用 + `go run` 慢）保持独立 CI/手动触发，不堆进 pre-push。
- B-3 趋势图存 localStorage `safeSet`（复用既有存储收敛）而非 IndexedDB——历史量小，避免新基建，符合「复用优先」。
- 附随排查修复：`--json` 失败分支原本丢弃命令输出（规律六），重构 `jsonDataPayload` 成功/失败共用并补单测（`5af09b32`）；门禁漂移修复（deadcode 基线 / 知识卡 / project-map，`8872d1cc`）。

---

## 六、治理红线（CLI 专属）

| 红线 | 说明 |
|------|------|
| 写操作必须 dry-run 默认开启 | 未经确认不得改动用户文件（AGENTS.md 损害控制） |
| 新命令必须带单测 | 入口错误路径 + 参数校验 + 输出断言（参考 cli_test.go 现有模式） |
| JSON 输出结构加版本号 | baseline/报告格式漂移会导致 Phase 2 回归门禁失效 |
| 命令注册走 `RegisterCommand` | 禁止手写 `cliCommands` 映射，保持自注册统一 |
| 复用 `app` 层函数 | 命令内不得复制 GUI 业务逻辑，统一走 `ctx.App` |

---

## 七、相关链接

- 命令使用说明（完整参考）：[`docs/cli-commands.md`](./cli-commands.md)（由 `scripts/gen-cli-doc.mjs` 从注册表自动生成）
- 入口姿势与高频场景：`AGENTS.md` 末尾「CLI 模式使用说明」
- 源码：`go/cli/`（入口 `cli.go`，`main.go` 经 `cli.RunCLI` 接线）
- 文档登记：`docs/funcmap.md`（go/cli 章节，pre-commit 自动同步）
- 性能理念：`single-bench` 优先（单模型快 = 所有场景快，P0 测试策略）
