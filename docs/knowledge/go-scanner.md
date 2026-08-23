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
perf:
  - io-bound
  - concurrent
invariant_anchors:
  - go/scanner/scanner.go|fsutil.IsRecycleDir
  - go/scanner/scanner.go|IsYsmEntryJSON
quick_groups:
  - 模型扫描与仓库管理
quick_intents:
  - 扫描模型、ScanModelEntries
  - 资源类型识别、rtype 判定
  - 去重检测、dedup
  - 整合包同步、sync
  - 仓库审计、健康分
quick_risk_lines:
  - 容器指纹缓存失效需调 ClearScanCache
  - resource_types.json 是唯一事实来源
---

# 扫描核心 go/scanner

## 概览

`go/scanner/` 包实现仓库文件扫描、哈希计算、缓存失效、作者提取、索引生成（ADR-003 P2 下沉，薄壳 `internal/app/app_scan.go` 仅保留依赖 App 的方法）。

## 核心职责

- `ScanEntries` 递归扫描目录产出 `ModelEntry[]`（支持 `.ban` 后缀还原扩展名）
- **MMD 子目录分组（ADR-096 P1）**：扫描 MMD group 根时，`scanner.go` 通过 `filepath.Rel` + `strings.Split` 提取第一段路径，命中 `types.IsMMDSubDir` 时填充 `ModelEntry.SubDir`（如 `SceneModel`/`CustomAnim`）；非 MMD 类型 / 根下文件恒为 `""`（`omitempty` 不序列化）
- `.json` 白名单：仅 `ysm.json` 作为模型条目（ADR-038 D2，几何/动画/语言 json 不单独扫描）
- 30s 扫描缓存 + 路径级失效：`scanCache` 为 `sync.Map`（`string → scanCacheEntry{entries []ModelEntry, expiresAt time.Time}`），记录扫描条目与过期时刻；`keyVersions` 为另一份 `sync.Map`（`string → *atomic.Uint64`），用 `(*atomic.Uint64).Add(1)` 原子递增 per-key 版本戳，防并发 `InvalidatePath` 竞态——P1 修复；单全局 `cacheGen atomic.Uint64` 仅作全量失效的代际短路标记
- SHA256 哈希（同步系统文件匹配用）
- 作者提取（`[作者]` 前缀统计）、本地作者扫描、`index.json` 生成

## 白名单口径（ADR-038 D2）

| 扩展名 | 扫描行为 |
|--------|---------|
| `.ysm` / `.zip` / `.7z` / `.nbt` / `.schematic` / `.litematic` | ✅ 扫描 + 哈希 |
| `.json` | `ShouldHashExt` 纳入哈希清单，但 `scanner.go` 按 baseName 过滤（`types.IsYsmEntryJSON`），仅 `ysm.json` 实际参与扫描（ADR-038 D2） |
| `.ban` / `.disabled` 后缀 | 还原原始扩展名后按上述判断 |

> **注意**：CI workflow 模板（`generateIndexWorkflow`）的 `paths:` 触发条件仅列 `**.ysm` / `**.zip` / `**.7z`，与扫描侧 `.json` 白名单口径分工不同——扫描负责全量发现，CI 只感知 YSM/压缩包变更。

## 对外 API / 入口

- `ScanEntries(dir)` — 单返回值薄壳：内部 `ScanEntriesWithHit(dir)` 丢弃 `bool` 后返回条目
- `ScanEntriesWithHit(dir)` — 扫描核心（缓存 30s，`.recycle` 跳过），返回 `(entries []ModelEntry, hit bool)`，调用方据此决定是否记录扫描日志，避免 30s 内重复访问同一目录时刷屏操作日志面板
- **在途合并（single-flight，2026-08-21）**：缓存「扫完才 Store」，同目录并发请求在途重叠时会双双真扫（点击整合包时前端多组件并发要状态 → 操作日志同秒重复条目）。`inFlight`（`sync.Map: dir → *scanFlight`）让首个调用方注册航班走盘，后续调用方 `wg.Wait()` 并入航班取**克隆**结果且返回 `hit=true`（薄壳不重复记日志）；唯一 owner 返回 `hit=false`。`walkCount`/`flightJoins` 为诊断计数。测试 `scanner_singleflight_test.go`（walkStartHook 制造确定性重叠）
- `InvalidateCache()` / `InvalidatePath(dir)` — 缓存失效（导入/启用禁用后调用）
- `ComputeFileHash(path)` — SHA256
- `ListModelAuthors` / `ScanLocalAuthors` — 作者统计
- `GenerateRepoIndex(repoPath)` — 生成 `index.json`（GitHub Actions workflow 模板）

## 与其他子系统关系

- `go/fileops/`：`ToggleModelEnable` 只切换 `.ban` 文件名状态（包内不调用 InvalidatePath）；缓存失效由 `internal/app/app_files.go` 的 `App.ToggleModelEnable` 包装层在调用成功后执行 `scanner.InvalidatePath(filepath.Dir(path))`
- `go/sync/`：`computeHash` 直接委托 `scanner.ComputeFileHash`，并声明 >500MB 穿串、读错空串等口径与 scanner 一致；回收站过滤亦与 `ScanEntries` 对齐
- `internal/app/resource_bindings.go`：资源包启用/禁用切换成功后同样调 `scanner.InvalidatePath`，与 ToggleModelEnable 口径对齐防 30s 陈旧缓存
- `go/types/`：`ModelEntry` / `IsSupportedExt` / `IsYsmEntryJSON`
- `internal/app/app_scan.go`：薄壳转发（`AnalyzeBedrockModel` / `tagsStore` / `AddOpLog` 保留在薄壳）

## 不变量

- 扫描结果受 30s 缓存保护，直接改盘后需显式失效缓存
- `.json` 只允许 `ysm.json` 与 Go importer / 前端 `isImportableFile` 三处口径一致（ADR-038 D2 纵深防御）
- **目录级 `.ban` 整体跳过**（P2 修复：`fileops.ToggleModelEnable` 对文件夹模型整组禁用时把父目录改名 `modelA.ban`，ADR-038 D3.7——原实现只过滤文件级 `.ban`，目录级禁用模型会以活跃身份进入 sync 的 repoHash 被列为 Missing 或被 SyncToggleStatus 重新启用；源码按目录基名匹配 `strings.HasSuffix(strings.ToLower(d.Name()), ".ban")` 跳过）
- **`.github` 目录跳过**：与 CI `genindex.go` 的 `strings.Contains(p, "/.github")` 口径对齐（ADR-011），避免生成仓库索引时把 GitHub Actions .workflow 误入 index

## 相关

- ADR-003（逻辑下沉）、ADR-038（ysm.json 白名单统一 D2）
