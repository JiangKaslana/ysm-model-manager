# ADR-056：共享单锁：安装/同步/回收去重并发互斥

- **状态**：✅ 已采纳
- **日期**：2026-08-13
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`go/installer/installer.go:19-22`（锁声明）、`go/sync/sync.go:20-21`（复用注释）、`internal/app/app_install.go`（ClearInstanceResources / DeduplicateCustomDir 持锁入口）、`docs/knowledge/go-sync.md` §锁与互斥

---

## 1. 背景（Context）

`watcher` 后台同步与用户安装/清理操作会**并发 Rename/Remove 同一批 custom 目录文件**：

- 用户安装：`Install` / `InstallDir` / `linkOrCopy` / `symlinkOrCopy` 等对 custom 目录写文件；
- 后台同步：`SyncToggleStatus` 阶段 2 将仓库文件逐个 Rename 进 custom 目录（`go/sync/sync.go`）；
- 回收/去重：`DeduplicateCustomDir`（按 SHA256 去重移入回收站）、`ClearInstanceResources`（清空整合包子目录）。

2026-08-12 之前，`installer` 与 `sync` 两包**各自定义** `installLock`/`syncLock`，互不感知——watcher 同步与用户安装可并发 Rename 同一文件，导致竞态/丢更新。当时收敛为共享 `installer.InstallLock`（单一事实），但**只覆盖了 installer 与 sync**：回收/去重路径（`internal/app` 的 `DeduplicateCustomDir` / `ClearInstanceResources` → `go/recycle` 的 `Move`）仍绕过锁，与同步并发操作同一批文件——闭环存在真实缺口（2026-08-13 侦查发现并补齐）。

## 2. 决策（Decision）

1. **单一事实**：`go/installer` 包导出 `var InstallLock sync.Mutex` 作为「模型目录文件写操作」的全局互斥锁；所有对 custom 目录 / 整合包子目录的 `Rename`/`Remove`/复制落盘操作必须持锁。
2. **持有者清单**（增删操作必须登记于此）：
   - `go/installer`：`Install`、`InstallDir`、`linkOrCopy`/`symlinkOrCopy` 各入口（`installer.go:45/141/327/352/433/467/505`）；
   - `go/sync`：`SyncToggleStatus`（`sync.go:139-140`）；
   - `internal/app`：`ClearInstanceResources`、`DeduplicateCustomDir`（`app_install.go`，2026-08-13 补齐入锁）。
3. **非重入约束**：`sync.Mutex` 不可重入——`*_Locked` 内部函数（如 `copyFileLocked`、`linkOrCopyLocked`）明示「调用方须持有 InstallLock，禁止直接调用」，任何持锁路径不得再调持锁入口。
4. **新增写路径必须评估**：新增对模型目录文件做 Rename/Remove/覆盖的代码路径，必须先确认是否纳入 `InstallLock`，不能静默绕过。

## 3. 后果（Consequences）

**正面**：安装/同步/回收去重三路写操作互斥，Rename 竞态与丢更新消除；锁约定成文，新增路径可查。

**负面 / 已知遗留**：
- 锁内重型 IO：`SyncToggleStatus` 持锁期间执行全量 SHA256 哈希 + WalkDir（`sync.go:139-197`），单次同步可阻塞安装操作秒级；`InstallDir` 持锁递归复制整目录。收敛方向（哈希阶段移出锁、仅 Rename 持锁）列为后续优化，不在本 ADR 强制。
- `go/logs.addOp` 持锁全量落盘（`logs.go:152-185`），批量导入时锁内磁盘 IO 频率偏高，暂接受。

## 4. 数据溯源

- 2026-08-12：installer/sync 双锁互不感知 → 收敛为 `installer.InstallLock`（`sync.go:20-21` 注释、`docs/knowledge/go-sync.md` §锁与互斥）；
- 2026-08-13：回收/去重缺口（`DeduplicateCustomDir`/`ClearInstanceResources` 绕过锁）侦查发现 → `app_install.go` 两入口补 `InstallLock`；
- 本 ADR 将该约定从源码注释（`installer.go:19`「ADR 统一为共享单锁」无编号）正式化为 ADR-056。

<!-- 文件名: shared-install-lock.md → 实际文件 ADR-056-shared-install-lock.md -->
