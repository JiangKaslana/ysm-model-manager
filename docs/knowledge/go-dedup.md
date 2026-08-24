---
kind: go-dedup
name: 去重 go/dedup
tier: architecture
category: go
source_files:
  - go/dedup/
use_when:
  - 去重
  - 重复检测
  - dedup
invariant_anchors:
  - go/dedup/dedup.go|fsutil.IsRecycleDir
---

# 去重 go/dedup

## 概览

`go/dedup/` 包提供资源去重检测，避免重复导入相同资源。

**路径安全（BUG-1 已免疫）**：`filepath.WalkDir` 不跟随符号链接（Go 标准库语义，仅 root 自身例外）+ 显式跳过 `ModeSymlink` 条目 + 根为 符号链接时返回 `ErrSymlinkRoot`。Go 1.25.0 处于 GO-2026-4970 受影响范围，若未来考虑 `os.Root` 迁移需先升 go1.25.12+。

## 核心职责

- 基于文件哈希（**纯 SHA256 内容哈希，元数据 name/size/modtime 仅随 FileEntry 展示、不参与重复判定**——知识卡旧文「哈希/元数据检测」表述漂移已修正）检测重复
- 返回重复匹配信息

## 对外 API / 入口

- `FindDuplicateFiles` — 扫描目录，按文件哈希分组，返回重复文件组（`FileEntry`/`Group`）；符号链接跳过防环、空文件跳过、超大文件流式全量哈希（`io.Copy` 错误已检查）；**共享并行哈希管道（ADR-119：串行收集 + 并行 SHA256 + 序号还原）**，组顺序 = hash 首次出现于遍历的顺序、组内 Files 按 Path 排序，输出与串行实现逐字节一致（确定性契约，CLI `dedup clean` 依赖组内排序）；**size 预分组（零语义损失）**——唯一 size 的文件必不成组、跳过其哈希，把大文件长尾收窄到"同尺寸大文件"
- `CountDuplicates` — 统计重复文件总数（**消费同一并行管道，与 `FindDuplicateFiles` 同源，禁止双实现漂移**）
- `CleanEmptyDirs` — 清理空目录（内部 `removeEmptyDirs`/`isEmptyDir` 递归实现）；**无 `skipRecycle` 参数**（与 fsutil 签名不一致，且全仓库无生产消费方——闲置 API，P3 观察）

## 与其他子系统关系

- **实际消费方**：`internal/app/resource_bindings.go`（Wails 绑定，`FindDuplicateFiles`/`CountDuplicates`）；前端 `app-content/diagnostics/init.ts` 去重页
- **无 `go/importer` 引用**（导入前去重的旧表述为幽灵关系，知识卡已自纠）；**无 `go/ysm` 引用**（元数据比对同为幽灵关系）
- 去重只检测不删除；实际删除走 `go/recycle.DeduplicateEntries`（recycle_clean.go），已安装资源不受影响

## 不变量

- 重复检测不影响已安装资源
- `CleanEmptyDirs` 只删空**子目录**，根目录自身永不删除（与 `go/fsutil.CleanEmptyDirs` 语义对齐）
- **`.recycle` 判定大小写不敏感**（P3 修复：`strings.EqualFold`，与 fsutil.isRecycleDir 对齐——原大小写敏感，Windows `.RECYCLE` 目录会漏排）
- **`computeHash` 是包级可注入变量（测试承重点，删改须同步测试）**：`dedup_parallel_test.go` 通过替换它验证「并行管道确定性」「size 预分组跳过哈希」。49afd979 重构时曾将其内联删除，测试包 `undefined: computeHash` 编译失败（go vet 兜住）。重构此文件时保留该注入点；若确需移除，必须同步改写两个测试

## 相关

- `go/fsutil/`（CleanEmptyDirs 同类实现）
