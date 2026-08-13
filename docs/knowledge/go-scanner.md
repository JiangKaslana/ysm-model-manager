---
kind: go-scanner
name: 扫描核心 go/scanner
tier: architecture
category: go
source_files:
  - go/scanner/
use_when:
  - 扫描
  - 扫描条目
  - 文件树
  - 哈希
  - 缓存
  - 作者提取
  - ScanEntries
  - 索引生成
invariant_anchors:
  - go/scanner/scanner.go|fsutil.IsRecycleDir
  - go/scanner/scanner.go|IsYsmEntryJSON
---

# 扫描核心 go/scanner

## 概览

`go/scanner/` 包实现仓库文件扫描、哈希计算、缓存失效、作者提取、索引生成（ADR-003 P2 下沉，薄壳 `internal/app/app_scan.go` 仅保留依赖 App 的方法）。

## 核心职责

- `ScanEntries` 递归扫描目录产出 `ModelEntry[]`（支持 `.ban` 后缀还原扩展名）
- `.json` 白名单：仅 `ysm.json` 作为模型条目（ADR-038 D2，几何/动画/语言 json 不单独扫描）
- 30s 扫描缓存 + 路径级失效：`scanCache` 为 `sync.Map`（`string → *atomic.Uint64`），`keyVersions` 用 `(*atomic.Uint64).Add(1)` 原子递增，防并发 `InvalidatePath` 竞态——P1 修复；单全局 `cacheGen atomic.Uint64` 仅作短路标记，实际路径级计数走 sync.Map
- SHA256 哈希（同步系统文件匹配用）
- 作者提取（`[作者]` 前缀统计）、本地作者扫描、`index.json` 生成

## 白名单口径（ADR-038 D2）

| 扩展名 | 扫描行为 |
|--------|---------|
| `.ysm` / `.zip` / `.7z` / `.nbt` / `.schematic` / `.litematic` | ✅ 扫描 + 哈希 |
| `.json` | `ShouldHashExt` 纳入哈希清单，但 scanner.go:195 按 baseName 过滤，仅 `ysm.json` 实际参与扫描（ADR-038 D2） |
| `.ban` / `.disabled` 后缀 | 还原原始扩展名后按上述判断 |

> **注意**：CI workflow 模板（`generateIndexWorkflow`）的 `paths:` 触发条件仅列 `**.ysm` / `**.zip` / `**.7z`，与扫描侧 `.json` 白名单口径分工不同——扫描负责全量发现，CI 只感知 YSM/压缩包变更。

## 对外 API / 入口

- `ScanEntries(dir)` — 扫描核心（缓存 30s，`.recycle` 跳过）
- `InvalidateCache()` / `InvalidatePath(dir)` — 缓存失效（导入/启用禁用后调用）
- `ComputeFileHash(path)` — SHA256
- `ListModelAuthors` / `ScanLocalAuthors` — 作者统计
- `GenerateRepoIndex(repoPath)` — 生成 `index.json`（GitHub Actions workflow 模板）

## 与其他子系统关系

- `go/fileops/`：`ToggleModelEnable` 成功后代调用 `InvalidatePath`（薄壳层）
- `go/types/`：`ModelEntry` / `IsSupportedExt` / `IsYsmEntryJSON`
- `internal/app/app_scan.go`：薄壳转发（`AnalyzeBedrockModel` / `tagsStore` / `AddOpLog` 保留在薄壳）

## 不变量

- 扫描结果受 30s 缓存保护，直接改盘后需显式失效缓存
- `.json` 只允许 `ysm.json` 与 Go importer / 前端 `isImportableFile` 三处口径一致（ADR-038 D2 纵深防御）
- **目录级 `.ban` 整体跳过**（P2 修复：`fileops.ToggleModelEnable` 对文件夹模型整组禁用时把父目录改名 `modelA.ban`，ADR-038 D3.7——原实现只过滤文件级 `.ban`，目录级禁用模型会以活跃身份进入 sync 的 repoHash 被列为 Missing 或被 SyncToggleStatus 重新启用；源码按目录基名匹配 `strings.HasSuffix(strings.ToLower(d.Name()), ".ban")` 跳过）
- **`.github` 目录跳过**（scanner.go:167）：与 CI `genindex.go` 的 `strings.Contains(p, "/.github")` 口径对齐（ADR-011），避免生成仓库索引时把 GitHub Actions .workflow 误入 index

## 相关

- ADR-003（逻辑下沉）、ADR-038（ysm.json 白名单统一 D2）
