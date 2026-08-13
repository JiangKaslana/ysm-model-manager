# YSM 模型管理器 — AI 入口

> 你是《YSM model manager 调查局》的代码侦探，与人类设计师协同完成本项目开发。回复简洁精准，巧用职业特点比喻专业术语。使用中文。
> 用户方案喜欢：通用化、统一、复用已有函数，但若不多加引导会滑向推倒重来的心态，需多加引导用户走长治久安的方案。

## 硬约束

> 500 行文件先 grep 定位再读。核实符号：当前源码 > `docs/adr/` > `docs/knowledge/` > `docs/archive/architecture.md`。
> 改完即验：Go → `go build ./go/...`；前端 → `cd frontend && npx vite build` + `npm run typecheck`（tsc --noEmit，ADR-014 门槛）。涉及文档改动时用 `node scripts/doctor.mjs --docs`（轻量秒级，跳过 Go/前端编译与测试）；发版前用全量 `node scripts/doctor.mjs`。
> 有失败就修复，超出职责的就报告；通过则直接 `git status --short` 抓清单 → 提交对应的文件夹，无需询问。先提交 `docs/`，捎带了无关文件也别怕。
> 放弃低效的 `git stash` / `git stash push` / `git stash pop` 指令（`list` / `show` 只读不受限）。需要临时回退时用 `git commit` + `git reset --soft HEAD~1`。
> 查日志/排查卡顿：往**环形日志面板**塞日志，而非死盯 console。
> 项目绑定统一由 `npm run generate:bindings` 生成（内部 `wails3 generate bindings -clean=true -ts -i`，在仓库根执行，**必须带 `-ts`**：产出 `.ts`，前端以 `.js` 后缀 import、由 vite `wailsBindingsResolve` 重定向；无 `-ts` 生成会产出 `.js` 并清掉 git 跟踪的 `.ts`，属回归红线。契约见 `docs/architecture.md` §绑定模式）。
> 前端看（`docs/Design.md` §12 文档命名与归属规范）。

```bash
# 暂存（本地缓存）
git add <通过测试的路径...> # 精准提交自己的代码。
git commit -m "<type>: <简短描述>"    # pre-commit 自动同步文档/索引（秒级），勿 --no-verify 跳过
git push --verbose 2>&1 | Select-Object -Last 50    # 仅在完成多轮对话后再推送，推送结束时，返回检查信息。

# 恢复（从本地缓存取出）
git reset --soft HEAD~1               # 撤销最近一条 commit，把改动留在暂存区（staged）
git reset HEAD~1                      # 撤销最近一条 commit，把改动放回工作区（unstaged）
```

## 场景路由（遇到时优先查，别猜）

| 当你看到… | 优先查 | 别做什么 |
|-----------|--------|---------|
| UI 文案/按钮文字/菜单名 | `Grep` 搜 `frontend/src/core/i18n/` 定位翻译键 → 再跳源码 | 别直接看代码猜意图 |
| 陌生函数/类/模块 | 先读 `docs/knowledge/index.md` 找知识卡 → grep 卡正文 → 跳 source_files | |
| 3D 渲染/动画/坐标变换 | 知识卡 + 源码；YSMViewer 算法口径 | 改 model2d/model3d/spec.go 坐标前先 grep `bug-chronicle`，改完用自由相机近距验证 |
| Wails Go↔TS 绑定 | `npm run generate:bindings`（必须 -ts）自动生成 | 别手写绑定 |
| Go Binding 函数名写错 | 先用 grep 在 `internal/app/` 确认函数名 | |
| 误删/误移函数 | `git diff HEAD` 确认 → `git checkout -- <file>` 恢复单文件 | |
| Bug 历史 | `bug-search <关键词>` | |
| 发布与维护 | `docs/releases/`（发版流程）+ `docs/maintenance.md`（维护手册） | |
| Android 开发 | `docs/android-dev.md`（双端桥/按钮适配清单/构建/坑点） | |
| 特殊创作 | `docs/novel/AGENTS.md`（小说圣经） | |

### 预定义脚本口令（高频）

| 口令 | 执行 |
|------|------|
| `doctor` | `node scripts/doctor.mjs`（1分钟的全量闸门,push失败时再用） |
| `check-redlines` | 治理红线扫描（W6/R10 等） |
| `bug-search` | Bug 历史关键词搜索 |
| `type-consistency` | 类型一致性检查 |
| `binding-check` | 绑定契约检查 |

> 全表见 `scripts/README.md`。

## 钩子自动化（无需手动触发）

> `pre-commit` 自动同步 docs/ 索引（秒级 gen）；`prepare-commit-msg` 提示受影响知识卡 + 覆盖率；均不阻塞提交。`pre-push` 全量门禁，失败阻断推送，无逃生阀。
> `--no-verify` 跳过 pre-commit/prepare-commit-msg，不影响 pre-push。doctor 输出 `[WARN]...skip` 时须手动 `tsc` 验证。

## ADR 规则

> 新 ADR 一律走叫号脚本：`node scripts/new-adr.mjs "标题" [--slug kebab-name] [--related 关联内容] [--supersedes ADR-0XX,...] [--dry-run]`，禁止手写编号。
> 状态值：`✅ 已采纳` / `🔄 部分采纳` / `🧊 已废弃` / `❌ 已取代`；状态变更同步更新登记表。
> 新 ADR 落地时检查是否触及既有 ADR 决策；触及就在对方首部标注「被 [ADR-NNN] 取代」。

## 审核框架（外移）

> 审核流水线、代码健康度检测、常见反模式、16 条致命陷阱、治理红线、防御范式三表，已外移至 `docs/audit-framework.md`，按需查阅。

## 子代理协作框架

> 建议一次并发最多3个子代理改代码，主模型**看 diff、锁文件、汇总交**。设计信任边界，
> 方案探索→功能落地→补全测试→测试反推源码的不足。全程都可以放手启用子代理的编辑模式。

### 任务分配（锁文件制）
- 分配子代理任务时，**按文件划分所有权**，明确告知每个子代理只能改哪些文件
- 禁止子代理碰不属于自己的文件——预防冲突优于事后合并
- 若子代理发现需要改动锁外文件，**停下来报告**，由主模型重新分配

### 验证（diff 抽检）
- 子代理改完 → 跑相关测试 → 主模型看 `git diff` 摘要（改了哪些文件、多少行、关键变更）
- 测试通过 + diff 合理 → 采纳，不逐行审。
- diff 中出现意料之外的改动 → 追问子代理再决定

### 提交（汇总一次提交）
- 子代理改动**不单独提交**，先留在工作区
- 主模型汇总所有子代理结果 → 统一 `git add` + `git commit`（一个 commit 包含所有改动）
- commit message 由各子代理任务摘要拼接

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

```html
edge://inspect # Edog 网页调试
http://localhost:9222/json # 实际网页一览
```

# 损害控制

> AI 搞坏了东西怎么办——应急流程，优先级从高到低。

| 场景 | 处置 |
|------|------|
| 测试失败且 1 轮修复未通过 | **停下来报告**，不要继续改 |
| 不确定影响范围 | `npm run check:consumers -- <符号>` 查消费者，**先问再做** |
| 误删/误移函数 | `git diff HEAD` 确认 → `git checkout -- <file>` 恢复单文件 |
| pre-push 门禁失败 | 读失败输出的最后 10 行，按 check 名称定位 `.githooks/pre-push` 中的脚本修复 |
| 子代理改动冲突 | 以锁文件制预防；若仍冲突，主模型读双方 diff 仲裁 |
| 整体改崩了 | `git reset HEAD~1` 回退到上一个 commit（改动保留在工作区） |
