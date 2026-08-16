---
kind: adr
status: draft
title: "ADR-088：检查体系并行调度——pre-push-gate 域间并行 + 静态工具分组 + pre-commit gen 并行"
date: 2026-08-17
authors: [deepseek, jieling]
related: [ADR-086, ADR-087, scripts/pre-push-gate.mjs, scripts/_lib/contract-tests.mjs]
---

# ADR-088：检查体系并行调度——pre-push-gate 域间并行 + 静态工具分组 + pre-commit gen 并行

- **状态**：🔄 部分采纳
- **日期**：2026-08-17
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`ADR-086`、`ADR-087`、`scripts/pre-push-gate.mjs`、`scripts/_lib/contract-tests.mjs`

---

## 1. 背景（Context）

ADR-086 完成了**检查体系减负**（星级评定 + 职责去重 + AI 调用公约 + 契约测试串行→并行），但 pre-push-gate 主体仍是**全局串行调度**：Go build → 前端 build → 静态工具逐条跑。ADR-086 §1.1 实测全量 ~75s，24 核 CPU 仅 ~30% 利用。

**当前串行瓶颈**（按 pre-push-gate.mjs 执行顺序）：

| 阶段 | 耗时（ADR-086 实测） | 可否并行 |
|------|---------------------|---------|
| Go 域（updater→build→test→vet→gofmt→binding） | ~18s | ⚠️ 域内部分可并行 |
| 前端域（layering→menu-health→vite→vitest→tsc） | ~40s | ⚠️ 域内部分可并行 |
| 静态工具（14 个 check-*.mjs 串行） | ~8s | ✅ 可分组并行 |
| 契约测试（tests/*.mjs） | ~31s | ✅ 已并行 |
| 其他（link/redline/adr/gen/check） | ~12s | ✅ 部分可并行 |

**域间完全独立**：Go build 与 vite build 无共享状态、无文件写冲突、无依赖关系。24 核 CPU 上两者可完全并行，时间从 18+40=58s 降到 max(18,40)=40s。

**零依赖约束**：ADR-086 已确认所有工具零 npm 依赖（`node:child_process` + `git` + `go` 系统命令）。本 ADR 同样零依赖——只用 `spawn`（`node:child_process` 已存在）。

---

## 2. 决策（Decision）

### Take巧 #1：域间并行（Go + 前端 + 静态工具三阶段独立）

**当前**：
```
Go build(18s) → 前端 build(40s) → 静态工具(8s)
总耗时: 66s
```

**并行后**：
```
[Go build(18s) ∥ 前端 build(40s) ∥ 静态工具(8s)]
总耗时: max(18, 40, 8) = 40s
节省: 26s（39%）
```

**实现**：pre-push-gate `main()` 中，将 Go/前端/静态工具三个独立阶段包成 `Promise.allSettled([goDomain(), frontendDomain(), staticTools()])`。

**约束**：
- `planFromFiles` 在并行前完成（域分类依赖文件列表，不可并行）
- 阻塞标记（`blocked`）在各阶段内部独立维护，`Promise.allSettled` 返回后聚合
- 用 `allSettled` 而非 `all`：一个域失败不中断其他域，全部执行完聚合结果（ADR-086 §2.3 保留「需人工的同样阻断推送」）

---

### Take巧 #2：Go 域内部分并行

**当前**（pre-push-gate:310-348）：
```
updater → go build → go test → go vet → gofmt → binding-check
```

**并行后**：
```
updater(5s) → go build(5s) → [go test(5s) ∥ go vet(2s)] → gofmt(0.3s) → binding-check(1s)
```

**理由**：`go test` 和 `go vet` 均依赖 `go build` 产物（编译通过的包），但不相互依赖。两者可并行。

---

### Take巧 #3：前端域内部分并行

**当前**（pre-push-gate:351-401）：
```
check-layering → check-menu-health → vite build → vitest → tsc
```

**并行后**：
```
[check-layering(1s) ∥ check-menu-health(1s)] → vite build(15s) → [vitest(15s) ∥ tsc(5s)]
```

**理由**：
- `check-layering` 和 `check-menu-health` 均为静态正则扫描，不依赖 vite build 产物
- `vitest` 和 `tsc` 均依赖 vite build 产物，但不相互依赖

---

### Take巧 #4：静态工具分组并行

**当前**（pre-push-gate:497-504）：`runTools()` 逐条串行执行 14 个工具。

**并行后**：按 4 个/组 `Promise.all` 分批：
```
第 1 批(4 个, ~2s) → 第 2 批(4 个, ~2s) → 第 3 批(4 个, ~2s) → 第 4 批(2 个, ~1s)
总耗时: 7s → 5s（节省 28%）
```

**理由**：14 个工具相互独立（纯静态分析），每组 4 个避免 CPU 过载（24 核上 4 个 Node 进程并行不冲突）。

---

### Take巧 #5：pre-commit gen 脚本分组并行

**当前**（`.githooks/pre-commit:42-58`）：11 个 gen 脚本逐行 `while read` 串行。

**并行后**：4 个/组，bash 用后台进程 `&` + `wait`：
```
第 1 批(4 个, ~0.3s) → 第 2 批(4 个, ~0.3s) → 第 3 批(3 个, ~0.3s)
总耗时: 1.0s → 0.4s（节省 60%）
```

**理由**：gen 脚本均为秒级且相互独立（各自写不同文件：`docs/adr/index.md` / `docs/knowledge/index.md` / `docs/project-map.md` 等）。

---

## 3. 与 ADR-086 的分工

| 维度 | ADR-086（减负） | ADR-088（加速） |
|------|----------------|----------------|
| 核心目标 | 删冗余、降级噪音、防重复调用 | 串行→并行，充分利用 CPU |
| 范围 | 33 个 check 脚本星级 + 重叠对 + AI 公约 | pre-push-gate + pre-commit 并行调度 |
| 契约测试 | 串行 43s → 并行 31s（`runContractTestsParallel`） | 不变（已并行） |
| 静态工具 | 去重 P1/P2/P3 重叠对 | 分组并行 14 个工具 |
| 实现 | `scripts/check-*.mjs` 内容精简 | `scripts/pre-push-gate.mjs` + `.githooks/pre-commit` 调度 |

---

## 4. 性能预算

```
当前 pre-push-gate（ADR-086 实测 ~75s）:
  Go 域:              18s
  前端域:             40s
  静态工具:             8s
  契约测试:            31s（已并行）
  其他（link/redline/adr/gen/check）: ~12s
  ─────────────────────────────
  总计:               75s

并行后（ADR-088）:
  域间并行: max(Go 18s, 前端 40s, 静态 8s) = 40s（省 26s）
    Go 域内: max(go test 5s, go vet 2s) = 5s（省 3s）
    前端域内: max(vitest 15s, tsc 5s) = 15s（省 10s）
  静态工具分组: ~5s（省 3s）
  契约测试:             31s（不变，可与域间并行）
  其他:                12s（不变）
  ─────────────────────────────
  总计:               max(40s 域间, 31s 契约测试) + 12s = 52s
  节省: 75s → 52s（省 23s，31%）
```

---

## 5. 后果（Consequences）

**正面**：
- pre-push-gate 总耗时从 ~75s 降到 ~52s（省 31%），AI 验证等待时间显著缩短
- 24 核 CPU 利用率从 ~30% 提升到 ~60%（Go + 前端 + vitest 并行）
- pre-commit gen 并行从 1.0s → 0.4s，与 ADR-087 T1/T2/T3 叠加后 pre-commit 总耗时降至 ~1s
- `commit-with-check.mjs` 自动受益（依赖 pre-push-gate dry-run，并行化后无需改）

**负面 / 风险**：
- 🟡 **并行后 CPU 争用**：`go test -race` + `vite build` + `vitest` 同时跑可能争抢 IO，翻转条件：单项耗时超预算 20% 即回退
- 🟡 **CI 环境无 24 核**：4 核 CI runner 上并行收益有限，翻转条件：CI 上并行耗时 > 串行则回退
- 🟢 **pre-commit 分组并行**：bash 后台进程 `&` + `wait` 在 Windows Git Bash 下兼容，翻转条件：任一 gen 脚本输出冲突（写同一文件）则回退

---

## 6. 实现计划

### 前置

1. **`_lib/proc.mjs` 新增 `runSpawn`**（async 版本，复用现有超时/错误分类/平台适配）：
   ```js
   export async function runSpawn(bin, args, opts = {}) {
     return new Promise((resolve) => {
       const proc = spawn(bin, args, {
         cwd: opts.cwd || ROOT,
         shell: opts.shell || false,
         maxBuffer: opts.maxBuffer || DEFAULT_MAX_BUFFER,
         timeout: opts.timeout || DEFAULT_TIMEOUT,
       });
       // ... 收集 stdout/stderr，超时处理
     });
   }
   ```

### 实施顺序

| 优先级 | 任务 | 行数 | 风险 |
|--------|------|------|------|
| T1 | `_lib/proc.mjs` 新增 `runSpawn` async 封装 | ~30 行 | 🟢 低（新增函数，不改动 `run`） |
| T2 | `pre-push-gate.mjs` Go 域异步化（go test ∥ go vet） | ~20 行 | 🟢 低（局部重构） |
| T3 | `pre-push-gate.mjs` 前端域异步化（check-* ∥ + vitest ∥ tsc） | ~25 行 | 🟢 低 |
| T4 | `pre-push-gate.mjs` 域间 `Promise.allSettled` | ~15 行 | 🟢 低 |
| T5 | `pre-push-gate.mjs` 静态工具分组并行（`runTools` → `runToolsParallel`） | ~15 行 | 🟢 低 |
| T6 | `.githooks/pre-commit` gen 脚本分组并行（bash `&` + `wait`） | ~10 行 | 🟢 低 |
| T7 | 并行后全量实测耗时 vs ADR-086 §1.1 基准对比 | — | 🟢 低 |
| T8 | 若任一 T1-T6 触发回退条件，回退并记录 | — | 🟢 低（翻转条件） |

---

## 7. 数据溯源

- 用户「我们还没关注脚本的并行能力呢」→ 摸底 pre-push-gate / pre-commit 并行现状 → 识别 5 个 Take巧
- ADR-086 §1.1 实测数据（~75s 全量耗时 + 39% 契约测试占比）
- ADR-086 §2.3 保留项「check-layering R1/R2 零容忍」— 并行不降级
- ADR-087 §2 Take巧 #1-#3 已验证 pre-commit 秒级扩展可行（+0.6s 预算）
- 隔壁子代理 10 个 fix 已验证 `commit-with-check.mjs` 与 pre-push-gate 的衔接（#8 stdin 传入 staged files）

---

## 8. 待办

| 项 | 描述 | 优先级 | 状态 |
|----|------|--------|------|
| T1 | `_lib/proc.mjs` 新增 `runSpawn` async 封装 | P1 | ⏸️ 待实施 |
| T2 | Go 域异步化 | P2 | ⏸️ 待实施 |
| T3 | 前端域异步化 | P3 | ⏸️ 待实施 |
| T4 | 域间 `Promise.allSettled` | P4 | ⏸️ 待实施 |
| T5 | 静态工具分组并行 | P5 | ⏸️ 待实施 |
| T6 | pre-commit gen 分组并行 | P6 | ⏸️ 待实施 |
| T7 | 并行后实测 vs ADR-086 基准 | P7 | ⏸️ 待实施 |
| T8 | 回退条件触发时回退并记录 | P8（翻转条件） | ⏸️ 待命 |