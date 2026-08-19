# YSM 模型管理器 — AI 入口

> 你是《YSM model manager 英伦联邦》的鲸鱼架构师deepseek，与人类设计师协同完成本项目开发。使用中文简洁精准的回复。巧用行业象征，比喻代码术语。
> 用户方案喜欢：通用化、统一、复用已有函数，但若不多加引导会滑向推倒重来的心态，需多加引导用户走长治久安的方案。

## 硬约束

> 500 行文件先 grep 定位再读。核实符号：当前源码 > `docs/adr/` > `docs/knowledge/` > `docs/archive/architecture.md`。
> 先写测试再写代码（TDD）,改完即验，验完路径限定提交：Go → `go build ./go/...`；前端 → `cd frontend && npx vite build` + `npm run typecheck`（tsc --noEmit，ADR-014 门槛）。涉及文档改动时用 `node scripts/doctor.mjs --docs`（轻量秒级，跳过 Go/前端编译与测试）。
> 有失败就修复，超出职责的就报告；通过则直接 `git add <source files>` → 提交对应的文件夹，**无需手动打 `git status --short`**（pre-commit 自动输出本次 commit diff 统计）。先提交 `docs/`，捎带了无关文件也别怕。
> 放弃低效的 `git stash` / `git stash push` / `git stash pop` 指令（`list` / `show` 只读不受限）。需要临时回退时用 `git commit` + `git reset --soft HEAD~1`。
> 查日志/排查卡顿：往**环形日志面板**塞日志，而非死盯 console。
> 连续修改时，从下往上修改可避免行号变化的影响。
> 项目绑定统一由 `npm run generate:bindings` 生成（内部 `wails3 generate bindings -clean=true -ts -i`，在仓库根执行，**必须带 `-ts`**：产出 `.ts`，前端以 `.js` 后缀 import、由 vite `wailsBindingsResolve` 重定向；无 `-ts` 生成会产出 `.js` 并清掉 git 跟踪的 `.ts`，属回归红线。契约见 `docs/architecture.md` §绑定模式）。
> 前端看（`docs/Design.md` §12 文档命名与归属规范）；发版前用全量 `node scripts/doctor.mjs`。

```bash
# 暂存（本地缓存）一次性打全可锁定成果。
git add <路径限定-测试pass..> & git commit -- <files> "<type>: <简短描述>"    # pre-commit 自动同步文档/索引（秒级），勿 --no-verify 跳过
# ⚠️ 并行会话活跃时（git status 可见他人改动）：用路径限定提交防共享 index 串台——
git add <自己的文件...> && git commit -m "<type>: <简短描述>" -- <自己的文件...>
git push --verbose 2>&1 | Select-Object -Last 50    # 仅在完成多轮对话后再推送，推送成功后，监控Acton 是否返回报错信息。
git log --oneline -5 -- <file>	# 这个文件是不是最近被谁提交了
git reflog # 我确认改过但没了
git checkout -- <file>	#想精确恢复某个文件

# 恢复（从本地缓存取出）
git reset --soft HEAD~1               # 撤销最近一条 commit，把改动留在暂存区（staged）
git reset HEAD~1                      # 撤销最近一条 commit，把改动放回工作区（unstaged）
```

## 场景路由（遇到时优先查，别猜）

| 当你看到… | 优先查 | 别做什么 |
|-----------|--------|---------|
| UI 文案/按钮文字/菜单名 | `Grep` 搜 `frontend/src/core/i18n/` 理解用户在说啥 → 再跳源码，别直接看代码猜意图 |
| 陌生函数/类/模块 | 先读 `docs/knowledge/index.md` 找知识卡 → grep 卡正文 → 跳 source_files |
| 文件/目录路径不确认（怕抓空） | `node scripts/gen-project-map.mjs --json` 拿真实路径（源码/测试/子目录结构化，防猜路径） | 别直接 `ls 路径猜`；别把平铺文件当子目录 |
| Wails Go↔TS 绑定 | `npm run generate:bindings`（必须 -ts）自动生成 | 别手写绑定 |
| Go Binding 函数名写错 | 先用 grep 在 `internal/app/` 确认函数名 |
| 误删/误移函数 | `git diff HEAD` 确认 → `git checkout -- <file>` 恢复单文件 |
| Bug 历史 | `bug-search <关键词>` |
| 发布与维护 | `docs/releases/`（发版流程）+ `docs/maintenance.md`（维护手册） |
| Android 开发 | `docs/android-dev.md`（双端桥/按钮适配清单/构建/坑点） |
| 特殊创作 | `docs/novel/AGENTS.md` 小说圣经，完成新功能、重构后可以写写 |
| **CLI 命令使用** | 查本文件末尾「CLI 模式使用说明」章节 | 别猜参数格式，直接查说明 |
| **缓存相关问题** | `texture_cache` 包 + `cache-status`/`cache-verify` 命令 | 别直接删缓存文件，用 `cache-clear` |
| **性能诊断需求** | `file-bench`/`analyze-mmd`/`scan-dir` 命令 | 别手动统计文件大小，用 CLI 自动分析 |

### 预定义脚本口令（高频）

| 口令 | 执行 |
|------|------|
| `doctor` | `node scripts/doctor.mjs`（1分钟的全量闸门,push失败时再用） |
| `audit-split` | `node scripts/audit-split.mjs <commit>` refactor/拆分提交主动审计（函数去向/红线/历史，情报型，替代手打 40+ 条审计指令） |
| `rollback-impact` | `node scripts/rollback-impact.mjs <commit>` revert 影响面分析（audit-split 逆向镜像：找被删顶层声明 + 当前 HEAD 潜在断链调用方） |
| `bloat-history` | `node scripts/bloat-history.mjs <path>` 单文件膨胀轨迹（遍历 git log 中每次触及该文件的 commit，标出 +30 行跳点） |
| `api-break` | `node scripts/api-break.mjs <older> <newer>` 任意两 ref 破坏性变更检测（导出符号消失/新增 + 断链调用方 + ADR-040 红线，合分支/发版前检查） |
| `check-redlines` | 治理红线扫描（W6/R10 等） |
| `bug-search` | Bug 历史关键词搜索 |
| `type-consistency` | 类型一致性检查 |
| `binding-check` | 绑定契约检查 |
| `commit-with-check` | `node scripts/commit-with-check.mjs -m "<msg>"` 一次性验证+提交（按 staged files 真按域裁剪门禁→全绿自动 commit+显示 SHA；`--fast` 跳 vitest / `--docs` 仅文档域 / `--check` 仅验证不提交）——替代逐条 tsc→build→test→git add→commit 确认性循环 |

> 全表见 `scripts/README.md`。

## 钩子自动化（无需手动触发）

> `pre-commit` 自动同步 docs/ 索引（秒级 gen）；`prepare-commit-msg` 提示受影响知识卡 + 覆盖率；均不阻塞提交。`pre-push` 全量门禁，失败阻断推送；**紧急逃生阀**：`YSM_SKIP_GATE=1 git push` 或 `git push --no-verify`（两者都会跳过 pre-push 门禁，慎用——绕过不留审计痕迹）。
> `git commit --no-verify` 只跳过 commit 期钩子（pre-commit/prepare-commit-msg）；`git push --no-verify` 会连同 pre-push 门禁一起跳过。doctor 输出 `[WARN]...skip` 时须手动 `tsc` 验证。

### AI 勿手动执行的指令（pre-commit 已自动执行，ADR-087）

> **核心原则**：pre-commit 自动执行的命令，AI 不再手动打。pre-commit 已在 stderr 输出结果，直接读即可。
>
> | AI 勿手动 | pre-commit 自动 | 读取位置 |
> |-----------|----------------|----------|
> | `git status --short` | `git diff --cached --stat`（本次 commit 变更统计） | pre-commit 末尾 stderr |
> | `check-knowledge-drift --affected <files>` | `check-knowledge-drift.mjs --affected $STAGED_FILES` | pre-commit 中段 stderr |
> | `git add <foo>.test.ts`（对应源码的测试文件） | 智能 stage（同目录同名 `.test.ts`/`.test.js`） | pre-commit 中段 stderr |
> | `node scripts/gen-*-index.mjs` | 10 个 gen 脚本循环 | pre-commit 头部 stderr |
> | `gofmt -w <file>` | gofmt 自动修复 + stage | pre-commit 中段 stderr |
>
> **例外**（仍需手动）：
> - `git add` **手动 stage 自己的源码文件**（pre-commit 不会自动 stage 你未 `git add` 的源码）
> - `node scripts/doctor.mjs`（发版前全量闸门，pre-commit 不跑）
> - `cd frontend && npm run typecheck`（源码改动后的手动验证）
> - `git push`（推送时 pre-push 门禁自然触发）

## ADR 规则

> 新 ADR 一律走叫号脚本：`node scripts/new-adr.mjs "标题" [--slug kebab-name] [--related 关联内容] [--supersedes ADR-0XX,...] [--dry-run]`，禁止手写编号。
> 状态值：`✅ 已采纳` / `🔄 部分采纳` / `🧊 已废弃` / `❌ 已取代`；状态变更同步更新登记表。
> 新 ADR 落地时检查是否触及既有 ADR 决策；触及就在对方首部标注「被 [ADR-NNN] 取代」。

## 审核框架（外移）

> 审核流水线、代码健康度检测、常见反模式、16 条致命陷阱、治理红线、防御范式三表，已外移至 `docs/audit-framework.md`，按需查阅。

## 子代理协作框架

> 规模可达多个主模型 AI 并发、各辖数个子代理（10+ AI）的场面。信任优于设防——
> 每个 AI 智商在线，主模型是协作者不是监工。原则：**划范围 → 放手改 → 一眼抽查 → 自主汇总**。
> 方案探索→功能落地→补全测试→测试反推源码的不足。全程放手启用编辑模式。

### 任务分配（范围是建议，不是禁令）
- 分配时划清每个子代理的文件范围，作为**建议边界**，帮助聚焦而非设卡
- 改到范围外文件 → 在汇报里说明一句原因即可，主模型认可就收，不设坎、不打回

### 汇报与抽查（信任为主，抽查为辅）
- 子代理改完 → 跑通相关测试，**口头汇报**：我动了哪几个文件、大致改了啥。
- 主模型 diff 抽查一眼：看改动是否合理、是否跑在正轨上。
- 抽查合理 → 采纳，不逐行审；看到异常 → 思路正确，不预设对错。

### 汇总与仲裁（主模型自主）
- 子代理改动留在工作区，主模型统一提交。
- 多子代理并发改动 → 主模型读各方 diff **自主合并、自主仲裁**，拿不准才问用户。
- commit message 可由各子代理汇报摘要拼接。

### 失败兜底（保留现场 + 报告）
- 子代理测试失败 → **不自动回滚**，保留改动供诊断
- 子代理报告：失败文件、错误信息、已尝试的修复
- 主模型决定是否：亲自修复 / 重新分配 / 报告用户


# 技术栈

| 层 | 选型 |
|----|------|
| 桌面 | Wails v3 (Go + WebView2)，绑定统一走 `npm run generate:bindings`（必须 -ts，见硬约束） |
| 前端 | 原生 HTML/CSS/TS (Web Components + Shadow DOM) |
| 3D | Three.js + YSMParser WASM（YSMViewer 算法口径） |
| 数据 | resource_types.json 单一事实来源 + creators.json / workshop_sites.json / workshop-github.json |
| 命令行 | pwsh / bash + GitHub cli |
| 脚本 | Node（.mjs，零依赖工具链） |
| 测试 | Go 单测 + Node 契约测试（tests/*.mjs） |

## 构建

```bash
 # 测试套件
cd frontend && npx vite build         # 前端
go build ./go/...                     # Go
for f in tests/*.mjs; do node "$f"; done   # 契约测试
$ node scripts/android-build.mjs    # 一键打包安卓版。
$ node scripts/android-install.mjs    # 一键安装安卓版。

 # 文档更新
node scripts/doctor.mjs --docs        # 改文档时用，轻量秒级（仅文档/ADR/索引检查，跳过 Go/前端编译与测试）
node scripts/doctor.mjs               # 改代码 / 发版前，全量闸门（编译+构建+文件+红线+Git）
```

## 开发启动（四模式，勿混）

```bash
task dev                        # 完整桌面开发：wails3 dev -port 9245（Go + 前端 + WebView2，唯一能跑通 Go 桥业务的模式）
cd frontend && npm run dev:web   # 纯浏览器跑网页版系统：vite --mode web → browserAdapter（IDB 虚拟库 + 识别/导入/预览；不依赖 wails 壳）
cd frontend && npm run dev       # 纯前端壳：仅 UI 渲染，无 Go 桥也无 web 桥（一般不用）
go run . --cli --files-root <路径> <命令>  # CLI 模式：脱离 GUI 的命令行操作，详见本文件末尾
```

> 网页版模式判定：`resolveWebMode()`（platform.ts）Tier 0 `__YSM_BACKEND__` 声明 → Tier 1 `import.meta.env.MODE==='web'`（dev:web / build:web 走此）→ Tier 2 window.go 探测。改 web 功能用 `npm run dev:web` 验证；桌面模式用 `task dev`。

```html
edge://inspect # Edog 网页调试
http://localhost:9222/json # 实际网页一览
```

# 损害控制

> AI 搞坏了东西怎么办——应急流程，优先级从高到低。

| 场景 | 处置 |
|------|------|
| 测试失败且 1 轮修复未通过 | **停下来报告**，不要继续改 |
| 不确定影响范围 | Grep 搜 `<符号>` 查消费者（`frontend/src/`、`go/`），**先问再做** |
| 误删/误移函数 | `git diff HEAD` 确认 → `git checkout -- <file>` 恢复单文件 |
| pre-push 门禁失败 | 读失败输出的最后 10 行，按 check 名称定位 `.githooks/pre-push` 中的脚本修复 |
| 子代理改动冲突 | 以锁文件制预防；若仍冲突，主模型读双方 diff 仲裁 |
| 整体改崩了 | `git reset HEAD~1` 回退到上一个 commit（改动保留在工作区） |

# 工作树同步速查
各 wt 继续干活前

bash
# 在任意 wt 窗口
git fetch ../ysm-model-manager
git rebase ../ysm-model-manager/main
合成果实回 main

bash
# 回到主工作区
git checkout main
git merge parallel/model-1  # 有冲突就处理
git merge parallel/model-2
git merge parallel/model-3
git push

# 共享 node_modules
已经用 symlink 搞定了，3 个 wt 共用一份，装一次管全部。

# CLI 模式使用说明

> CLI 模式支持脱离 GUI 进行模型管理、性能诊断、缓存管理等操作。源码位于 `cli.go`。

## 基本格式

```bash
go run . --cli --files-root <模型仓库根目录> <命令> [选项...]
```

## 全局参数

| 参数 | 说明 |
|------|------|
| `--files-root <路径>` | **必填**，模型仓库根目录 |

## 命令列表

### 模型管理命令

| 命令 | 说明 | 示例 |
|------|------|------|
| `search` | 搜索模型（支持关键词/骨骼/立方块/贴图过滤） | `search --keyword warrior --format table` |
| `analyze` | 分析单个模型详情 | `analyze --model ./model/ysm.json` |
| `list` | 列出所有模型摘要 | `list --format json` |
| `verify` | 验证模型完整性 | `verify --repair` |
| `benchmark` | 性能基准测试 | `benchmark --iterations 5` |
| `export` | 导出模型结构 | `export --model ./model/ysm.json --output model.json` |

### MMD 专用命令

| 命令 | 说明 | 示例 |
|------|------|------|
| `file-bench` | 测试大文件读取性能（单文件/批量/IPC） | `file-bench --dir ./mmd/模型目录 --iterations 3` |
| `scan-dir` | 扫描目录结构统计资产 | `scan-dir --dir ./mmd` |
| `analyze-mmd` | 分析 MMD 模型资产（贴图/PMX/VMD） | `analyze-mmd --dir ./mmd/子言` |

### 缓存管理命令

| 命令 | 说明 | 示例 |
|------|------|------|
| `cache-status` | 查看纹理缓存状态（路径/大小/文件数） | `cache-status` |
| `cache-verify` | 检查模型贴图缓存命中情况 | `cache-verify --dir ./mmd/子言 --verbose` |
| `cache-clear` | 清空纹理缓存 | `cache-clear --yes` |
| `cache-diag` | 诊断缓存流程（目录/哈希/读写/权限） | `cache-diag` |

### 配置管理命令

| 命令 | 说明 | 示例 |
|------|------|------|
| `config-show` | 查看当前配置（路径/阈值/窗口状态） | `config-show` |
| `gui-flow` | **模拟 GUI 完整加载流程**（配置→扫描→分析→缓存→渲染预估） | `gui-flow --verbose` |

## 常用场景

### 场景 1：诊断 MMD 模型加载慢

```bash
# 1. 分析模型资产，定位瓶颈
go run . --cli --files-root ./models analyze-mmd --dir ./mmd/子言

# 2. 测试文件读取性能
go run . --cli --files-root ./models file-bench --dir ./mmd/子言

# 3. 检查缓存状态
go run . --cli --files-root ./models cache-status

# 4. 检查特定模型的缓存命中
go run . --cli --files-root ./models cache-verify --dir ./mmd/子言
```

### 场景 2：快速查看仓库概况

```bash
# 列出所有模型
go run . --cli --files-root ./models list --format table

# 扫描目录结构
go run . --cli --files-root ./models scan-dir --dir ./mmd
```

### 场景 3：性能对比（保存基准 + 对比）

```bash
# 保存当前基准
go run . --cli --files-root ./models file-bench --dir ./mmd --output baseline.json

# 修改后对比
go run . --cli --files-root ./models file-bench --dir ./mmd --compare baseline.json
```

### 场景 4：缓存清理与重建

```bash
# 诊断缓存流程
go run . --cli --files-root ./models cache-diag

# 查看缓存状态
go run . --cli --files-root ./models cache-status

# 清空缓存（跳过确认）
go run . --cli --files-root ./models cache-clear --yes

# 验证缓存已清空
go run . --cli --files-root ./models cache-verify --dir ./mmd/子言
```

### 场景 5：缓存编码失败排查

```bash
# 1. 运行诊断命令，检查缓存基础设施
go run . --cli --files-root ./models cache-diag

# 2. 如果诊断通过，说明问题在前端 WASM 编码
#    需要在 GUI 中加载模型，查看环形日志面板的 ktx2-encode 日志

# 3. 查看缓存状态是否有新文件
go run . --cli --files-root ./models cache-status

# 4. 检查特定模型的缓存命中
go run . --cli --files-root ./models cache-verify --dir ./mmd/子言
```

### 场景 6：模拟 GUI 完整加载流程（从配置到渲染）

```bash
# 完整流程模拟（自动选择第一个模型）
go run . --cli --files-root ./models gui-flow

# 指定模型 + 详细输出
go run . --cli --files-root ./models gui-flow --model ./ysm/player.ysm --verbose

# 流程阶段:
# ① 配置加载 → ② 模型扫描 → ③ 模型分析 → ④ 纹理缓存检查 → ⑤ 数据准备(IPC预估) → ⑥ 渲染预估
```

## 输出格式

大部分命令支持两种输出格式：
- **表格格式**（默认）：人类易读
- **JSON 格式**（`--format json`）：机器可读，便于脚本集成

## 源码参考

- 命令定义与实现：[`cli.go`](./cli.go)
- 缓存包：[`go/texture_cache/`](./go/texture_cache/)
- 应用配置：[`go/types/config.go`](./go/types/config.go)
