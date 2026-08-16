# ADR-086：检查体系减负与赋能决策表

- **状态**：✅ 已采纳
- **日期**：2026-08-17
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`scripts/pre-push-gate.mjs, scripts/doctor.mjs, .githooks/*, scripts/check-*.mjs, ADR-014, ADR-040, ADR-085`

---

## 1. 背景（Context）

检查体系经多轮治理（ADR-014 tsc 门禁、ADR-040 红线基线、ADR-085 菜单单一事实来源）已长成 33 个 check/doctor/gate 脚本 + 3 个 githooks 的规模。2026-08-17 全量实测发现三类问题：

### 1.1 耗时集中在可并行段

| 段 | 耗时 | 占比 |
|----|------|------|
| 契约测试（tests/*.mjs 串行） | 28.9s | 39% |
| vitest run | 28.9s | 39% |
| 静态工具 + 编译 + 红线 | ~17s | 22% |
| **合计** | **~75s** | **100%** |

契约测试与 vitest 职责不重叠（前者跑脚本/契约，后者跑前端单元），但被串行调度，白白浪费 24 核机器的并发能力。

### 1.2 存量债务制造「永远 FAIL」噪音

- `check-deadcode-baseline`：163 条死代码（全存量基线），每次全量门禁 FAIL 但不阻断
- `auto-import --strict`：3 条 missing import（存量基线），每次 FAIL 但不阻断
- `check-circular`：1 个环 `mount-preview-core.ts ↔ preview-menu.ts`（ADR-085 引入的同类层双向 import），FAIL 且阻断

「36 项里 3 个永远 FAIL」让真问题淹没在噪音里——AI/人类扫一眼结果表，分不清哪些是本轮引入、哪些是历史包袱。

### 1.3 输出缺修复路径

- `check-circular` 报环链 `A ↔ B` 但无「怎么解」
- `check-deadcode-baseline` 列 163 条死代码但无「新增 vs 基线」分级
- `auto-import` 给 candidates 但无「该选哪个」提示

检查项只说「坏了」，不说「怎么修」——AI 每次都要重新推理修复路径，赋能不足。

## 2. 决策（Decision）

**检查体系保持「秒级非阻断 + 全量阻断」双层架构**，按以下决策表治理每个检查项。决策锚定为 ADR，经得起业绩压力翻转——「挂与否」的辩论结果固化下来，不随当周心情摇摆。

### 2.1 减负决策表（3 项）

| 编号 | 检查项 | 决策 | 理由 | 翻转条件 |
|------|--------|------|------|----------|
| R1 | 契约测试 vs vitest 调度 | **改 Promise.all 并行** | 两者职责不重叠，串行浪费 24 核并发；并行后门禁 ~75s→~45s（省 30s） | CPU 竞争拖慢单项超 20% → 回退串行 |
| R2 | check-circular 阻塞性 | **降为非阻塞（docs 模式报告）** | 1 个环属「同层双向 import」常见模式，非真分层违规；check-layering R1/R2 零容忍已兜底反向依赖 | 环数量 > 3 或跨层环出现 → 恢复阻断 |
| R3 | deadcode-baseline + auto-import 阻塞性 | **确认 fail-closed 兜底**（扫描失败阻断，基线债务不阻断） | 163 条死代码 + 3 条 missing 全是存量基线，每次 FAIL 但不阻断——确认此行为是设计而非遗漏 | 新增死代码 > 10 条/轮 → 收紧为阻断 |

### 2.2 赋能决策表（2 项）

| 编号 | 检查项 | 决策 | 理由 | 翻转条件 |
|------|--------|------|------|----------|
| E1 | check-circular 输出 | **环检测后追加修复提示**（`💡 解环：抽公共层/参数注入`） | 现状报环链但无「怎么解」，AI 每次重新推理 | 提示模板覆盖 < 80% 真实环形态 → 扩充模板 |
| E2 | check-deadcode-baseline 输出 | **每条加 `[NEW]` / `[BASELINE]` 标签** | 现状 163 条平铺，看不出新增 vs 历史；分级后一眼看出本轮改动是否引入新死代码 | 基线收紧机制变化 → 同步调整标签语义 |

### 2.3 保留项（明确不动）

| 检查项 | 保留理由 |
|--------|----------|
| pre-commit 秒级文档同步 | 非阻断、幂等、零成本，设计正确 |
| prepare-commit-msg 非阻断建议 | 知识卡漂移 + 覆盖率建议直达 stderr，设计正确 |
| check-layering R1/R2 零容忍 | 分层公理的硬约束，不可降级 |
| check-redlines fail-closed | 扫描失败必须阻断，否则红线门禁静默放行 |
| adr-check | ADR 登记表一致性，秒级，零成本 |
| type-consistency | resource_types.json ↔ extensions.js 单一事实来源守护 |
| binding-check | Wails Go↔TS 绑定契约，ADR-014 红线 |
| check-menu-health | ADR-085 菜单表健康门禁，秒级正则扫描 |
| i18n-check / i18n-ui-check | 三语一致性，秒级 |
| gen-docs-index --check | 索引产物过期守护，秒级 |
| link-checker | 文档断链，秒级 |
| release-notes --check | git tag 单一事实源守护 |
| check-workflow-refs | GitHub workflow 引用一致性 |
| check-tpl-refs / check-dynamic-import | 前端模板/动态 import 守护 |
| check-boolean-naming | 布尔命名规范，秒级 |
| check-orphan-exports | 孤儿导出检测，秒级 |
| check-script-hygiene | 脚本卫生检查，秒级 |
| funcmap / gen-project-map --check | 函数/项目地图产物一致性 |
| build-novel-index --check | 小说索引产物一致性 |
| check-knowledge-drift | 知识卡漂移检测，秒级 |
| check-doc-drift / check-adr-health | 文档/ADR 漂移检测，秒级 |
| go build / go test / go vet / gofmt | Go 域全量门禁，不可降级 |
| vite build / vitest run / tsc --noEmit | 前端域全量门禁，不可降级 |

## 3. 后果（Consequences）

**正面**：
- 门禁总耗时从 ~75s 降到 ~45s（R1 并行调度省 30s）
- ADR-085 引入的 check-circular 回归阻断消除（R2 降级）
- 「永远 FAIL」噪音分级可见（R3 确认 + E2 标签）
- 环检测有修复路径提示（E1），AI 不用重新推理

**负面 / 风险**：
- 🟡 R1 并行调度可能 CPU 竞争拖慢单项——翻转条件设为「单项超 20% 慢就回退」
- 🟡 R2 check-circular 降级后真环漏报——但 check-layering R1/R2 零容忍已兜底反向依赖
- 🟢 R3/E1/E2 属输出层改造，不影响阻断逻辑

**已知遗留**：
- deadcode 163 条 + auto-import 3 条存量基线债务——本 ADR 不清理，留待后续「存量债务清零」专项
- check-circular 1 个环（mount-preview-core ↔ preview-menu）——降为非阻塞后报告但不强制解环；若后续 ADR-085 演进引入更多同类层双向 import，按 R2 翻转条件评估是否恢复阻断

## 3.1 钩子分散面 + add.yml 可行性（2026-08-17 补充）

### 钩子已分散什么

| 钩子 | 已分散 | 未分散（AI 仍手动） |
|------|--------|---------------------|
| pre-commit | 11 个 gen 脚本 + gofmt 自动修复 + docs/ stage | tsc / build / vitest（AI 逐条跑） |
| prepare-commit-msg | 知识卡漂移 + 覆盖率建议（非阻断 stderr） | — |
| pre-push | 7 大域全量门禁（Go/前端/数据/文档/ADR/红线/契约） | — |

**核心缺口**：pre-commit 只做 docs gen，没做 tsc/build/test 的组合——AI 必须逐条 bash 跑确认性循环。

### add.yml 可行性

**可行**。GitHub Actions 支持任意 `.yml` 文件名，只需新建 `.github/workflows/add.yml` 并定义 `on:` trigger。现有 4 个 workflow（ci.yml / pages-deploy.yml / release.yml / test.yml）已覆盖 CI 层。

但 **add.yml 不该做**：重复 pre-push 已做的全量门禁。add.yml 的定位应是 **CI 层补 pre-push 不跑的项**（如 E2E / 跨平台构建 / 覆盖率上报），而非再加一层重复检查。

### commit-with-check.mjs——把 AI 确认性循环压缩为单条命令

**已落地**：`scripts/commit-with-check.mjs`（232 行）

**核心洞察**：不是「加更多钩子」，而是**把 AI 的「确认性循环」变成单次命令**。

现在的模式（~80 条指令/功能）：
```
AI: 改代码
AI: 跑 tsc          ← 确认性循环
AI: 跑 build        ← 确认性循环
AI: 跑 test         ← 确认性循环
AI: git add + commit
AI: git log 确认    ← 确认性循环
```

应该是（~20 条指令/功能）：
```
AI: 改代码
AI: node scripts/commit-with-check.mjs -m "..."  ← 单条命令：按域跑 tsc+build+test，全绿后自动 commit + 显示 SHA
```

**commit-with-check.mjs 覆盖的检查项**：

| 域 | 检查项 | 耗时 |
|----|--------|------|
| Go | go build + go test | ~5s |
| 前端 | tsc --noEmit + vite build + vitest run | ~35s |
| 数据 | type-consistency | ~0.1s |
| 文档 | link-checker | ~0.2s |
| ADR | adr-check | ~0.1s |
| 红线 | check-redlines | ~1.1s |

**用法**：
- `node scripts/commit-with-check.mjs -m "feat: xxx"` — 全流程（按 staged files 判断域）
- `node scripts/commit-with-check.mjs -m "feat: xxx" --fast` — 跳过 vitest（仅 tsc+build）
- `node scripts/commit-with-check.mjs -m "feat: xxx" --docs` — 仅文档域
- `node scripts/commit-with-check.mjs --check` — 仅验证不提交

### 量化指令节省（基于今天真实指令清单）

**今天真实指令清单**（~80 条）：

| 操作 | 指令数 | commit-with-check 替代后 |
|------|--------|--------------------------|
| 类型检查 | 6 | 0（脚本内跑） |
| 构建验证 | 4 | 0（脚本内跑） |
| 测试运行 | 7 | 0（脚本内跑） |
| Git 提交 | 5 | 1（脚本自动 commit） |
| 状态检查 | 10+ | 0（脚本自动显示 SHA + status） |
| 文档同步 | 5 | 0（pre-commit 已做） |
| 文档验证 | 3 | 0（脚本内跑 adr-check） |
| ADR 生成 | 2 | 2（new-adr.mjs 不替代） |
| 文件读写 | 30+ | 30+（不可替代） |
| 后台编译 | 2 | 2（不替代） |

**节省测算**：
- 替代前：~80 条/功能
- 替代后：~35 条/功能（文件读写 30+ + ADR 2 + 后台编译 2 + commit-with-check 1）
- **目标**：从 ~80 条/功能降到 ~20 条/功能——需进一步压缩文件读写（子代理并行读）

**翻转条件**：若 commit-with-check.mjs 的按域判断漏跑某项检查导致回归 → 补 `--full` 模式跑全量 pre-push-gate

## 4. 检查脚本星级 Top 表（附录 A）

> 子代理 2026-08-17 抽查 scripts/check-*.mjs 头部注释 + 实测耗时，输出三星级评定。
> 评分尺度：耗时⭐（<0.2s=5 / >1.5s=1）、价值⭐（硬约束阻断=5 / 纯提醒噪音=1）、重复度⭐（独占职责=5 / 与别的重叠=1）。

### 4.1 星级表（综合降序）

| 脚本 | 耗时⭐ | 价值⭐ | 重复度⭐ | 综合 | 一句话定位 | 触发时机 |
|------|--------|--------|----------|------|------------|----------|
| check-circular.mjs | 4 (0.3s) | 5 | 4 | ⭐⭐⭐⭐⭐ | ESM import 图 DFS 找环，前端循环依赖硬阻断 | pre-push / CI |
| check-layering.mjs | 5 (秒级) | 5 | 5 | ⭐⭐⭐⭐⭐ | 前端三层分层方向守护（views→features→services→utils→core） | pre-push / CI |
| check-tpl-refs.mjs | 5 (0.1s) | 5 | 5 | ⭐⭐⭐⭐⭐ | getElementById 引用 ↔ 模板 id 定义交叉核对，断链 ERROR 阻断 | pre-push / CI |
| check-menu-health.mjs | 5 (0.1s) | 5 | 5 | ⭐⭐⭐⭐⭐ | 3D 预览菜单表健康门禁（ADR-085 配套，6 条校验） | pre-push / CI |
| check-dynamic-import.mjs | 5 (0.1s) | 4 | 5 | ⭐⭐⭐⭐½ | 动态 import() 合理性审查（失败处理 / 空吞 / .js 残留 / 轻量误动态） | pre-push / CI |
| check-orphan-exports.mjs | 4 (0.3s) | 3 | 4 | ⭐⭐⭐⭐ | 孤儿导出检测（0 消费者符号审计），WARN 不阻断 | pre-push / CI |
| check-workflow-refs.mjs | 5 (0.1s) | 4 | 5 | ⭐⭐⭐⭐ | GitHub Actions workflow 引用脚本/目录存在性卡点 | pre-push / CI |
| check-circular-go.mjs | 5 (0.1s) | 4 | 4 | ⭐⭐⭐⭐ | Go 包级循环依赖检测（与前端 check-circular 对称，不依赖完整编译） | pre-push / CI（Go 域变更时） |
| check-adr-health.mjs | 5 (0.1s) | 4 | 3 | ⭐⭐⭐⭐ | ADR 状态机合法性 + 登记表同步 + 技术债清单 | pre-push / CI |
| check-doc-drift.mjs | 5 (0.1s) | 4 | 3 | ⭐⭐⭐⭐ | 文档三一致检查（ADR 登记表 / 知识卡 / 架构树反引号路径） | pre-push / CI |
| check-knowledge-drift.mjs | 5 (0.2s) | 4 | 3 | ⭐⭐⭐⭐ | 知识卡 source_files 漂移 + frontmatter 必填 + 索引断链（含 --affected 主动防御） | pre-push / CI |
| check-boolean-naming.mjs | 5 (0.2s) | 3 | 5 | ⭐⭐⭐⭐ | 布尔变量命名规范检查（is/has/can/should 前缀），默认 WARN | pre-push / CI（--strict 时） |
| check-script-hygiene.mjs | 5 (0.1s) | 3 | 5 | ⭐⭐⭐⭐ | scripts/ 工具脚本卫生检查（退出码 / 内联 / --json 契约 / 文件头 5 字段），WARN 不阻断 | pre-push / CI |
| check-diff-coverage.mjs | 3 (未实测) | 5 | 5 | ⭐⭐⭐⭐ | 变更文件覆盖率门禁（diff-coverage gate，保护 PR 新代码不裸奔） | commit-msg / CI |
| check-redlines.mjs | 2 (1.1s) | 4 | 4 | ⭐⭐⭐⭐ | 代码红线审查（12 条规则 × 违规扫描，依赖 ripgrep） | pre-push / CI |
| check-deadcode-baseline.mjs | 1 (1.7s) | 4 | 4 | ⭐⭐⭐½ | 死代码 / 重复代码基线守卫（调用 knip + jscpd，对比基线） | pre-push / CI |

### 4.2 职责重叠对（5 对，治理优先级排序）

| 优先级 | 重叠对 | 重叠程度 | 判定 |
|--------|--------|----------|------|
| **P1** | check-knowledge-drift ↔ check-doc-drift（知识卡维度） | **中**（source_files/frontmatter/索引断链三项语义完全重叠） | 保留 check-knowledge-drift 作单一事实来源；check-doc-drift 移除知识卡块，聚焦 ADR + 架构树 |
| **P2** | check-adr-health ↔ check-doc-drift（ADR 登记表维度） | **中高**（两者都检测 ADR 文件 vs index.md 登记表不一致） | 保留 check-doc-drift 作 ADR 登记表一致性单一事实来源；check-adr-health 降为「状态机合法性 + 技术债清单」专项，移除登记同步块 |
| **P3** | check-orphan-exports ↔ check-deadcode-baseline（孤儿检测子集重叠） | **中**（孤儿导出是 knip 死代码检测的子集） | 分层触发：check-orphan-exports 留 pre-push 快速反馈（秒级）；check-deadcode-baseline 移出 pre-push，改 `npm run audit:deadcode` 周度审计（1.7s 太慢） |
| P4 | check-circular ↔ check-circular-go | 低（对称设计，不同语言域） | 两者保留，职责正交 |
| P5 | check-redlines ↔ comment-checker（W3/W4） | 低（已治理：W3/W4 已移交 comment-checker） | 无需降级 |

### 4.3 AI 调用公约（防「一轮打三次」）

> 实证：本轮会话里 `node scripts/pre-push-gate.mjs --docs` 被跑 2 次、`npx vitest run` 被跑 3 次（单测 / 3d 目录 / 全量）。AI 在对话过程反复 bash 调检查脚本，不进 commit message，难以从 git log 追踪。

**公约**：

1. **一轮对话一个检查目的只跑一次**——要查菜单健康就 `check-menu-health` 一次，不要连打三次「确认真的过了」
2. **优先用窄范围检查**——改了 docs/ 就 `doctor --docs`，不要 `doctor` 全量
3. **全量门禁只在 push 前跑一次**——`pre-push-gate --all --dry-run` 是最终验证，不是中间调试工具
4. **星级 Top 表是调用顺序锚**——按综合星级降序调，⭐⭐⭐⭐⭐ 先跑（快 + 硬阻断），⭐⭐⭐½ 后跑（慢 + 基线债务）

## 5. 附录 B：check 耗时 × 功能周期账（15min 功能 / 15s 思考）

> 用户节奏锚：15min（900s）落地一个功能，15s 完成一轮思考。ADR-086 §1.1 算的是门禁总耗时，本附录从"占功能周期比例"角度衡量"加一个新 check 值不值"。
> 实测数据：`node scripts/doctor.mjs --json`（2026-08-17 全量）。

| check | 耗时 | 占一轮思考（15s） | 占一个功能（900s） | 评价 |
|-------|------|------------------|-------------------|------|
| check-menu-health | 0.1s | 0.7% | 0.01% | 几乎无感，硬阻断，⭐⭐⭐⭐⭐ |
| i18n-check / i18n-ui-check | 各 0.1s | 各 0.7% | 各 0.01% | 秒级，必交 |
| check-redlines | 0.5s | 3.3% | 0.06% | 含 rg 扫描，仍秒级 |
| check-deadcode-baseline | 1.6s | 10.7% | 0.18% | 基线债务，非阻断 |
| 前端域门禁（R1 并行后） | ~45s | 300% | 5% | 含 vitest + tsc + build，一次全量 |
| vitest run（单独） | 28.9s | 193% | 3.2% | 真瓶颈：占功能周期 3.2%，但硬约束不可砍 |
| 契约测试（单独） | 28.9s | 193% | 3.2% | 同上，与 vitest 不重叠 |

**两个结论**：

1. **check 不是性能问题，vitest 才是**——check-menu-health 等秒级门禁连思考的空隙都占不满。真正的"打指令重灾区"是 vitest（28.9s × 每次改动都要跑）。
2. **"减少打指令"靠的不是多写 check，而是预检前置**——门禁的杠杆效应不在时间，在"免记忆"：把检查从"人记得跑"变成"push 时自动拦"。上次的 `preview.switchModel` 漏 i18n 键，如果依赖"我每次记得跑 vitest"，就有漏发概率；check-menu-health 在 pre-push 阶段自动拦，人根本不用"想起来"。

**边界固化**（必交门禁 vs 留人工）：

| 维度 | 必交门禁（可规则化、有明确对错、秒级） | 留人工（需语义判断、无明确对错） |
|------|--------------------------------------|-------------------------------|
| 菜单表 | id 唯一、labelKey 非空、i18n 齐全、dockGroup 合法、kind 合法、render/run 完备 | 文案措辞是否准确、交互是否优雅、功能组合是否合理 |
| 代码 | 红线违规、类型错误、循环依赖、死代码新增 | 算法设计是否合理、模块边界是否优雅 |

本边界由 ADR-085（菜单单一事实来源）+ ADR-086（决策表）固化，**不需要再开新 ADR**。新增 check 时照此账衡量"值不值"：耗时占一个功能（900s）超过 1% 的需特别说明理由。

## 6. 数据溯源

来源：用户「该折腾检查减负了，信息赋能了，看看各检查的配置是否合理吧」→ 全量实测 pre-push-gate --all --dry-run（36 项 ~75s，3 个 FAIL：check-circular 1 环 / deadcode 163 存量 / auto-import 3 存量）+ 文档模式实测（12 项 ~2s 全绿）+ 契约测试/vitest 耗时占比分析（各 28.9s，串行浪费并发）+ 用户「立项吧，值得痛斥后再折腾」「先把挂不挂的辩论做好」→ 立项 ADR-086，把减负 R1/R2/R3 + 赋能 E1/E2 + 保留项 25 条固化为决策表 → 用户「历史提交看一看，审核能拦截啥」「脚本的检查按星级排序，避免 ai 乱打检查，或者一轮检查打三次」→ 派子代理抽查 16 个 check-*.mjs 头部注释 + 实测耗时 → 输出三星级 Top 表（综合⭐⭐⭐⭐⭐ 4 项 / ⭐⭐⭐⭐½ 1 项 / ⭐⭐⭐⭐ 11 项 / ⭐⭐⭐½ 1 项）+ 5 个职责重叠对（P1 知识卡维度重叠 / P2 ADR 登记表重叠 / P3 孤儿检测子集重叠 / P4-P5 已治理或正交）+ AI 调用公约（防一轮打三次）→ ADR-086 附录 A 落地。

<!-- 文件名: check-system-reduction.md → 实际文件 ADR-086-check-system-reduction.md -->
