---
kind: go-sync
name: 整合包同步 go/sync
tier: architecture
category: go
source_files:
  - go/sync/sync.go
  - go/sync/sync_diff.go
  - go/sync/sync_hash.go
  - go/sync/sync_dirlevel.go
  - go/sync/sync_discovery.go
  - go/sync/sync_push.go
  - go/sync/sync_relink.go
  - go/fsutil/hardlink_windows.go
  - go/fsutil/hardlink_other.go
use_when:
  - 整合包
  - 同步
  - 实例
  - 硬链接
  - 符号链接
  - 缺失
  - 多余
  - .ban
  - PrismLauncher
invariant_anchors:
  - go/sync/sync.go|fsutil.IsRecycleDir
  - go/sync/sync_relink.go|installer.CopyFile
---

# 整合包同步 go/sync

## 概览

`go/sync/` 包负责模型库（全局仓库）与 Minecraft 整合包实例之间的同步：发现实例（原版 / PrismLauncher 布局）、按 SHA256 哈希对比出缺失/多余/禁用文件、按文件名或文件夹对比资源包差异、检测目标文件的链接类型（符号链接/硬链接/复制），并**编排推送/拉取/重链接的执行循环**（ADR-003 补充下沉，从 `internal/app/app_install.go` 提取）。单文件的实际落地（复制/硬链接/符号链接）仍由 [go_installer](./go-installer.md) 按 `LinkMode` 完成，本包只负责「算差异 + 决定对哪些条目调用 installer + 计数与失败上报」。

## 核心职责

- `sync.go` — 实例枚举、哈希差异对比、启禁状态同步、资源差异对比、链接类型判定
- `sync_push.go` — 推送/拉取执行循环（`PushResources` / `PullResources` 及单条变体、`SyncCustomToRepo`），失败逐条经注入的 `Logger` 记账、聚合成一条错误返回
- `sync_relink.go` — 重链接执行（`RelinkDir`）：按哈希把实例文件重新指向仓库版本，文件夹级类型用「备份→重建→失败回滚」保证不丢目录
- `go/fsutil/hardlink_windows.go` — Windows 硬链接检测（`syscall.GetFileInformationByHandle` → `NumberOfLinks`，收敛自原 link_windows.go）
- `go/fsutil/hardlink_other.go` — Unix/macOS 硬链接检测（`syscall.Stat_t.Nlink`，含目录排除 ADR-038，收敛自原 link_unix.go）

## 对外 API / 入口

- `GetInstanceStatus(mcRoot, repoDir string, scanFn ScanFunc) []types.InstanceStatus` — 哈希对比模型仓库与各实例 custom 目录，产出 Missing/Extra/Disabled/Files（链接类型）
- `GetInstanceStatusWith(mcRoot, repoDir string, scanFn ScanFunc, listFn ListVersionsFunc)` — 可注入 listFn 的测试变体
- `SyncToggleStatus(instanceCustomDir, repoRoot string, scanFn ScanFunc) (int, int, error)` — 把仓库 `.ban` 启禁状态同步到实例文件（哈希 → 相对路径 → 纯文件名三级匹配，重命名加/去 `.ban` 后缀），返回禁用数、启用数
- `ListVersions(mcRoot string) []types.VersionInstance` — 枚举实例，三种布局：目录本身是 instances（子目录含 `.minecraft`/`minecraft`）、PrismLauncher `{mcRoot}/instances/{name}/.minecraft/`、标准 `{mcRoot}/versions/{name}/`
- `HasDotMinecraftSubdirs(path string) bool` / `FindMinecraftDir(parentDir string) string` — 实例布局探测辅助
- `SyncResources(globalDir, instanceDir string, rtype ...string) types.ResourceSyncResult` — **ADR-064 阶段二：全树递归 + 相对路径（relKey）对比**全局 ↔ 整合包资源；嵌套文件天然区分、无同名冲突，原「只扫顶层」深度守卫已取消。含 `pack.mcmeta` 的文件夹作为整体单元（仅资源包类型收集）；过滤/归一化统一走 `types.IsResourceAllowed` / `types.NormalizeResourceName`，归并走 `ResourceDiff`（sync_diff.go）
- `SyncResourcesDirLevel(globalDir, instanceDir, rtype string) types.ResourceSyncResult` — 按文件夹名对比（YSM 的 ysm.json 文件夹 / MMD 的 .pmx/.pmd 文件夹 / 蓝图 .nbt 文件夹），同名时文件夹优先于平铺文件；目录级语义 scanner 无法表达，保留自 Walk
- `CompareGlobalInstanceHashes(mcRoot, globalDir, subDir, rtype string, scanFn ScanFunc, listFn ListVersionsFunc, hasModFn HasModInDirFn) []types.InstanceStatus` — 非 YSM 资源类型的通用实例状态对比，**ADR-064 与 `SyncResources` 同口径**（`relKey` 相对路径 + 大小 + `ResourceDiff` 单点归并，消除手工对齐漂移）；实例目录经 `types.FindInstDir` 解析（标准目录不存在时兜底扫描）。修复 MMD（`.pmx/.pmd` 不计算 SHA256，旧哈希比对恒 0）与蓝图（实例目录非标准路径）在侧栏不显示的问题
- `ResourceDiff(global, instance map[string]DiffEntry) types.ResourceSyncResult` — **单点对比归并**（sync_diff.go，ADR-064 阶段一）：同名同大小 Synced / 同名不同大小 Missing / 仅单侧 Extra，结果排序确定性；`SyncResources` 与 `CompareGlobalInstanceHashes` 共享，key 由调用方决定（统一为 `relKey` 相对路径）
- `GetLinkType(path string) types.LinkType` — 判定 `symlink` / `hardlink` / `copy` / `unknown`
- `SortEntries(entries []types.ModelEntry)` — 按名称排序
- `PushResources(rtype, globalDir, targetDir, linkMode string, logger Logger) (int, error)` — 推送缺失资源；**`types.IsDirLevelSync(rtype)` 注册表驱动**（YSM/MMD 等 `dirLevelSync` 类型）走文件夹级（`SyncResourcesDirLevel` + `installer.InstallDir`），其余走文件级（`SyncResources` + `installer.Install`）
- `PullResources(rtype, globalDir, targetDir string, logger Logger) (int, error)` — 把实例侧 Extra 拉回仓库（纯复制，不建链接）
- `PushSingleResource(filePath, customDir, globalDir, linkMode, rtype string) error` / `PullSingleResource(globalDir, targetDir, srcPath string) error` — 单条推送/拉取；`.json`/`.pmx`/`.pmd` 与目录按整文件夹处理
- `SyncCustomToRepo(customDir, repoDir string, scanFn, logger) (int, error)` — 把实例 custom 目录的模型收编回仓库，同哈希/同名跳过
- `RelinkDir(customDir, repoRoot, rtype, linkMode string, scanFn, logger) (int, error)` — 按哈希重链接实例目录到仓库版本
- 函数类型：`ScanFunc`（扫描注入，由 internal/app 提供）、`ListVersionsFunc`、`HasModInDirFn`、`Logger`（导入日志回调，薄壳注入 `App.logger.Add`）

## 与其他子系统关系

- 被 `internal/app/app_install.go` 调用（状态对比、推送/拉取、启禁同步、`GetLinkType` 决定删除策略）
- 被 `internal/app/app_scan.go` 调用（`ListVersions`）、`internal/app/app_config.go` 引用
- 被 [go_watcher](./go-watcher.md) 调用（文件变更时 `ListVersions` + `SyncToggleStatus` 自动同步启禁）
- 依赖 `go/types`（ModelEntry/InstanceStatus/LinkType 等）、`go/ysm`（`ysm.HasYSMMod` 检测实例 mod）
- `sync_push.go` / `sync_relink.go` 反向依赖 [go_installer](./go-installer.md)（`Install` / `InstallDir` / `CopyFile`）——本包→installer 是单向的，installer 不得回调本包

## 不变量

- `.ban` 后缀 = 禁用模型：仓库侧 `.ban` 文件不进缺失列表；实例中对应哈希的文件标记 Disabled 而非 Extra
- 哈希全量计算（`scanner.ComputeFileHash`，`sync.go computeHash` 委托）；文件 >500MB（`types.MaxImportSize`）返回空串跳过哈希（同步对空哈希跳过匹配），读错误同样返回空
- **所有扫描路径都必须排除 `.recycle`**，与 `scanner.ScanEntries` 口径对齐：`SyncResources` 的 collect（`sync.go`，统一 collect 闭包内 `fsutil.IsRecycleDir` SkipDir）、`SyncResourcesDirLevel` 的 `collectEntries`（sync_dirlevel.go）均跳过；`SyncToggleStatus` 用 `strings.Contains(strings.ToLower(p), ".recycle")` 检查整个路径（sync.go），非路径前缀匹配——漏排会把回收站里的模型当成仓库活跃模型，同步管理器显示 missing 且可被推送回实例（回归测试 `TestSyncResources_IgnoresRecycleDir`）
- 跳过回收站时带 `path != 根目录` 守卫：若用户把仓库根/实例根本身命名为 `.recycle` 则不跳过，否则整次扫描会直接空掉
- 状态对比类入口（`GetInstanceStatus` / `CompareGlobalInstanceHashes`）自身不 Walk 仓库，`.recycle` 的排除依赖注入的 `scanFn`（即 `scanner.ScanEntries`）——换用不排 `.recycle` 的 scanFn 会重新引入误判
- `SyncResources` 对比 key 为**相对路径**（`relKey`：小写 + 正斜杠 + 去 `.disabled`/`.ban`，ADR-064 阶段二），同名文件按**大小**判定内容是否变化（复制会改 mtime，mtime 不可靠），大小不同归入 Missing 视为待更新；三个结果列表返回前均 `sort.Strings` 排序
- 扩展名过滤统一走 `types.IsResourceAllowed`（`types.AllExts()` + `.json` 仅 `ysm.json`）与 `types.IsTypeModelFile`（单类型扩展集 + `ysm.json`），原 `isSyncAllowed` / `isModelFile` / `instance.extMatch` 三处同义实现已收敛（ADR-064 阶段一）
- **两阶段遍历-执行模式**（`SyncToggleStatus`，`sync.go:162-231`）：`filepath.WalkDir` 回调中**不直接执行** `os.Rename`，而是先收集 `[]renameOp`（含源路径、目标路径、操作类型），遍历完成后再批量执行。原因：`filepath.WalkDir` 在遍历过程中修改目录结构（如重命名文件）会导致后续条目被跳过或重复处理——文件丢失/重复/损坏风险。这是本包最重要的设计模式，所有在 WalkDir 回调中修改文件系统的操作都必须遵循此模式
- `SyncToggleStatus` 与 `go/installer` 共用包级 `installer.InstallLock`（`sync.Mutex`，统一单锁——[ADR-056](../adr/ADR-056-shared-install-lock.md) 成文：2026-08-12 起原两包各自 `installLock`/`syncLock` 互不感知的并发竞态收敛为共享同一把锁，`sync.go:139-140`；2026-08-13 补齐回收/去重入口），防止与安装操作并发写同一文件
- `RelinkDir`（sync_relink.go）整段持 `InstallLock`：自身对 custom 目录的 `os.Rename`/`os.RemoveAll`（目录级分支备份/回滚）纳锁，内部对 `installer.Install/InstallDir/CopyFile` 改用 **`*Locked` 变体**（`InstallLocked`/`InstallDirLocked`/`CopyFileLocked`，installer.go 新增导出）——避免同 goroutine 重入非重入 mutex 死锁（曾踩：整段持锁 + 调公开函数 → sync 测试挂起 119s）
- 文件被占用（如 Minecraft 锁定）时 `isFileLocked` 识别后静默跳过不阻塞（errno 优先：Win ERROR_SHARING_VIOLATION(32) / Unix EBUSY(16)，再按消息兜底）
- `RelinkDir` 处理文件夹级类型时先把旧目录 rename 成 `.relink-bak`，重建成功才删备份、失败则回滚恢复——不能先 `RemoveAll` 再重建，否则失败即整目录丢失。**根层平铺的 ysm.json/.pmx 退化为 `installer.Install` 单文件路径**（P1 修复：`dstParent == customDir` 时原逻辑会把整个实例目录 rename 走、同目录其他模型随备份 RemoveAll 丢失）
- 硬链接检测跨平台分实现，系统调用失败一律降级 `LinkCopy`；`GetLinkType` 必须先 `os.Lstat` 判 `os.ModeSymlink`（`sync.go:602-614`）——用 `os.Stat` 会跟随链接、把符号链接误判成普通文件，进而按「复制」策略走回收站
- 链接类型是删除策略依据：硬链接(nlink>1)/符号链接直接删，普通文件才移回收站（致命陷阱 #8）
- 拉取侧 `copyFile`（`sync_push.go:228`）已修复为 **tmp+rename 原子落地**（P3 修复）：带 defer 清理半截文件，失败不清理残留；`copyDirRecursive`（`sync_push.go:271`）递归复制时保留符号链接语义（`os.Readlink` + `os.Symlink`），不跟随复制——与 [go_recycle](./go-recycle.md) 的 `copyDirRecursive` 口径已对齐
- 实例 custom 目录固定为 `config/yes_steve_model/custom`

## 相关

- [go_installer](./go-installer.md) — 按 LinkMode 实际落地复制/硬链接/符号链接
- [go_recycle](./go-recycle.md) — 删除时按链接类型分流
- [go_watcher](./go-watcher.md) — 文件监听触发自动同步
- AGENTS.md 致命陷阱 §二 #8（硬链接误删）
