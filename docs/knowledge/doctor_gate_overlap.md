---
kind: doctor_gate_overlap
name: 质量闸门双调度器重叠审计
tier: leaf
category: go
source_files:
  - scripts/doctor.mjs
  - scripts/pre-push-gate.mjs
  - scripts/check-redlines.mjs
use_when:
  - 双调度器
  - 质量闸门重叠
  - doctor gate 差异
  - 治理红线下沉
---

# 质量闸门双调度器重叠审计

## 概览

2026-08-14 摸排结论：推送测试链路本身不臃肿，但质量闸门体系存在**双调度器 + 双重实现**，约 250 行重复逻辑，已出现参数漂移。

## 已知缺口

| # | 缺口 | 影响 |
|---|------|------|
| 1 | gate `go test` 少测 `./internal/app/` | 内部 app 测试不跑推送门禁 |
| 2 | `tsc --noEmit` 全链路缺失 | TS 类型错误无门禁覆盖 |
| 3 | `checkGovernance` 是 `check-redlines` 过时子集 | doctor 全量不查 16 条新红线表 |
| 4 | gate 缺 updater helper 前置构建 | 干净 checkout 下裸崩 |

## 双调度器重复清单

| 检查 | doctor 全量 | pre-push-gate |
|------|------------|--------------|
| go build | `checkGoBuild()` | 内联 |
| go test | `checkGoTest()`（含 `./internal/app/`） | 内联（缺 `./internal/app/`） |
| go vet | `checkGoVet()` | 内联 |
| 契约测试 | `checkContractTests()` | `runContractTests()` |
| vite build | `checkFrontendBuild()` | 内联 |
| vitest | `checkFrontendTest()` | 内联 |
| check-layering | STATIC_TOOLS | 前端域 |
| link-checker | `--strict` | 解析 JSON |
| binding-check | STATIC_TOOLS | Go 域 |
| check-redlines | ❌ 无（只有手写 `checkGovernance` 子集） | 完整 16 条规则 |

## 决策记录

2026-08-14 摸排后决定不修复（"折腾"），仅留知识卡存档。未来若双端漂移导致实际漏检，再统一委托。
