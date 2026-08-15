---
kind: go-instance
name: 整合包实例 go/instance
tier: architecture
category: go
source_files:
  - go/instance/
use_when:
  - 整合包
  - 实例
  - 版本实例
  - VersionInstance
  - 同步项
  - BuildSyncItems
  - 资源同步
invariant_anchors:
  - go/instance/instance.go|ysmsync.SyncResources
---

# 整合包实例 go/instance

## 概览

`go/instance/` 包处理整合包（Minecraft 版本实例）的资源同步项构建，是 `app_install.go` 中 `GetInstanceSyncStatus` Binding 的下沉逻辑（知识卡旧文称 `GetResourceInstanceStatus` 为消费方属漂移——该 Binding 走 `ysmsync.GetInstanceStatus`/`CompareGlobalInstanceHashes`，与本包无关）。

## 核心职责

- 将版本实例 + 资源类型 + 仓库根映射为 `ResourceSyncItem[]`（同步状态列表）。`ResourceTypeInfo` 定义于本包 `instance.go:16`（go/types 下无此类型，知识卡旧文漂移已修正）

## 对外 API / 入口

- `BuildSyncItems(ins, rtypes, repoRoots)` — 构建实例的资源同步项（供同步管理界面展示）；内部同步比对走 `ysmsync.SyncResources`（ADR-064 相对路径口径），非 `CompareGlobalInstanceHashes`（知识卡旧文漂移已修正）

## 与其他子系统关系

- `internal/app/app_install.go`：薄壳调用（`GetInstanceSyncStatus`）
- `go/types/`：`VersionInstance` / `ResourceSyncItem` / `ResourceTypeInfo`（本包定义）
- `go/sync/`：同步比对（`SyncResources`）

## 不变量

- 条目过滤统一走 `types.IsTypeModelFile`（ADR-064 阶段一收敛，原 `extMatch` 内联实现删除）；资源包文件夹（`pack.mcmeta`）在三分支放行（`fsutil.IsResourcePackFolder` 兜底，保持 SyncResources 判定的真实状态）
- **兜底 Walk（IsScanInstance）已移除**（ADR-064 阶段二）：`SyncResources` 相对路径对比全树递归收集所有受支持文件（含嵌套），同名不同目录不再 map 去重丢失，原兜底已无新增条目可补，删除防重复列示——`TestBuildSyncItems_FallbackWalk` 语义由 SyncResources 的 Extra 覆盖后仍通过

## 相关

- ADR-024（多资源类型联邦架构：按资源类型分目录同步）
