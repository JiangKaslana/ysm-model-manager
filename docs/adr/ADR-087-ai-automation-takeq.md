---
kind: adr
status: draft
title: "ADR-087：AI 自动化取巧——pre-commit 智能 stage 与无脑指令下沉"
date: 2026-08-17
authors: [deepseek, jieling]
related: [ADR-086]
---

# ADR-087：AI 自动化取巧——pre-commit 智能 stage 与无脑指令下沉

- **状态**：🔄 部分采纳
- **日期**：2026-08-17
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`ADR-086`、`.githooks/pre-commit`、`scripts/check-knowledge-drift.mjs`

---

## 1. 背景（Context）

ADR-086 完成了**检查体系减负**（星级评定 + 职责去重 + AI 调用公约），但 AI 在**开发侧**的无脑指令仍依赖手动输入。以 15 分钟功能周期为单位计算：

| 指令类型 | 占比 | 典型 | 能否自动化 |
|----------|------|------|-----------|
| **无脑指令**（验证 + 状态） | ~30% | `git add` / `check-knowledge-drift --affected` / `git status --short` / `doctor --docs` | ✅ 可下沉 pre-commit |
| **思考指令**（探索 + 决策） | ~70% | `read` / `edit` / `grep` 定位 / `subagent` 委派 / `Select-String` 定向调查 | ❌ 不可替代 |

**核心判断**：只自动化「无脑」30%，让 AI 把宝贵的 15s/轮思考时机留给逻辑链，不替代思考本身。

**关键约束**：pre-commit 是秒级约束（< 5s），不触碰阻断逻辑（阻断留给 pre-push，ADR-086 已确认）。

---

## 2. 决策（Decision）

### Take巧 #1：智能 stage（改源码 → 自动 stage 对应测试文件）

**规则**：当 `git diff --cached` 检测到新增/修改的 `.ts` 源码文件时，pre-commit 自动 stage 同目录/同名的 `.test.ts` / `.test.js`。

**实现位置**：`.githooks/pre-commit` 第 10 行（gen 脚本循环之后，`git add docs/` 之前）。

**幂等保证**：`git add <file>` 对已 stage 文件无副作用（exit 0），已 test 文件被 stage 时 `git status` 无变化。

**示例**：
```
用户: edit 修改 frontend/src/core/context-menus.ts
pre-commit:
  gen 脚本循环...
  [intelligent-stage] git add frontend/src/core/context-menus.test.ts
  git add docs/
  gofmt...
```

**收益**：消除「改了源码忘了 stage 测试」的低级错误；AI 少打一条 `git add`。

---

### Take巧 #2：drift --affected 秒级接入

**规则**：gen 脚本跑完后，取 `git diff --name-only HEAD`（未 stage 的本次变更文件），调用 `check-knowledge-drift.mjs --affected <files>`。

**输出**：stderr（非阻断），格式与 prepare-commit-msg 钩子一致（卡片 stem 列表）。

**实现位置**：`.githooks/pre-commit` 第 15 行（gen 循环结束后）。

**性能**：
```
gen 循环:        ~3-5s（10 个 gen 脚本）
drift --affected: +0.3s（只扫变更文件相关卡，非全量）
取 diff 文件:    +0.05s
总增量:          +0.35s/commit
```

**收益**：每次 commit 自动知道「N 张卡受影响」，AI 不需要手动 `check-knowledge-drift --affected`。

---

### Take巧 #3：git status 摘要（commit 前预览）

**规则**：pre-commit 末尾 stderr 输出 `git status --short` 的最后 15 行（已 stage + 未 stage），非阻断。

**格式**：
```
[pre-commit] 当前 git status（提交前预览）:
M  docs/knowledge/model3d.md
 M frontend/src/core/context-menus.ts
?? frontend/src/utils/dom/capabilities.ts
```

**收益**：AI 不需要额外打 `git status --short` 看状态——commit 前的最后一次确认自动弹出来。

---

## 3. 与 ADR-086 的分工

| 维度 | ADR-086（检查减负） | ADR-087（git 自动化） |
|------|---------------------|----------------------|
| 关注点 | 33 个检查脚本的星级/去重 | 4 个 git hook 扩展 |
| 范围 | pre-push / doctor 调度 | pre-commit 扩展 |
| AI 指令减少 | AI 调用公约（防一轮打三次） | 智能 stage + drift 反馈 + status 摘要 |
| 决策性质 | 减负（删/降级/并行） | 赋能（加/自动化） |

---

## 4. 性能预算

```
当前 pre-commit 耗时:  3-5s（10 个 gen 脚本）

Take巧 #1: 智能 stage
  git diff --cached:    +0.05s（极快）
  git add <files>:      +0.1s/文件 × 平均 2 文件 = +0.2s

Take巧 #2: drift --affected
  git diff --name-only: +0.05s
  drift 调用:           +0.3s

Take巧 #3: status 摘要
  git status --short:   +0.05s

总增量:                +0.6s/commit（从 3-5s → 3.6-5.6s）

15 分钟功能周期内（~2-3 次 commit）:
  累计增量:             ~1.2-1.8s
  占功能周期:           <0.01%（从 900s 里扣）
```

---

## 5. 收益估算

| 指令 | 当前（手动） | 自动化后 | 节省/commit |
|------|------------|---------|------------|
| `git add` 测试文件 | 1-2 次 | 0 | 5s（打字+思考） |
| `check-knowledge-drift --affected` | 1 次 | 0 | 10s（输入+等输出） |
| `git status --short` | 2-3 次 | 0（commit 时已出摘要） | 10s（打字×2-3） |
| **合计** | **4-6 次** | **0** | **25s/commit** |

按 2-3 次 commit/15 分钟周期：节省 **~50-75s** 的无脑输入 + 上下文切换时间，留给思考逻辑链。

---

## 6. 后果（Consequences）

**正面**：
- AI 每次 commit 自动收到「N 张卡受影响」反馈 + 当前 status 预览，无需额外打指令
- 「改源码忘 stage 测试」从人工记忆变成机械保证
- pre-commit 从「10 个 gen 脚本」升级为「gen + drift + stage + status」四合一

**负面 / 风险**：
- 🟡 **智能 stage 误 stage**：如果 `.test.ts` 文件存在但本次未改源码（旧测试文件），会被错误 stage。翻转条件：`git diff --cached` 中**必须同时存在对应源码文件的改动**（同目录 + 同名 + `.ts`/`.js` 前缀），才 stage 其测试文件。
- 🟡 **drift --affected 误报**：如果 gen 脚本本身改动了 knowledge 卡（如 `gen-knowledge-index` 更新了 `index.md`），这些变更在 `git diff --name-only HEAD` 中会出现，drift 会提示「index.md 改动影响所有卡」。翻转条件：drift 的 input 过滤 `docs/knowledge/index.md`（生成物，pre-commit 自身产物）。
- 🟢 **Take巧 #3** 纯输出层改造，无行为风险

---

## 7. 数据溯源

- 用户「是不是该参与门禁adr讨论了」→ 摸底 pre-push-gate / pre-commit / domain-classify 三层现状 → 识别「无脑 30% vs 思考 70%」边界 → 起草 3 个 Take巧
- ADR-086 已落地：检查体系星级 + 重叠对 + AI 调用公约（防一轮打三次）——ADR-087 聚焦其未覆盖的 git hook 侧
- 性能预算来源：pre-push-gate §1.1 实测耗时 + 当前 pre-commit gen 循环实测（3-5s）+ `check-knowledge-drift --affected` 实测（0.3s）
- ADR-086 §2.3 明确「pre-commit 秒级文档同步」保留——本 ADR 在其上扩展，不改动原有 gen 脚本

---

## 8. 待办（不阻塞，按序推进）

| 项 | 描述 | 优先级 |
|----|------|--------|
| T1 | 修改 `.githooks/pre-commit`：gen 循环后加 drift --affected | P1（~10 行） |
| T2 | 修改 `.githooks/pre-commit`：智能 stage .test.ts | P2（~15 行） |
| T3 | 修改 `.githooks/pre-commit`：status 摘要 stderr | P3（~5 行） |
| T4 | 若 T1-T3 上线后 pre-commit 超 5s，回退非阻断部分 | P4（翻转条件） |