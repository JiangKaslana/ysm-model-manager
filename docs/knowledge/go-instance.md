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
- **展示树镜像磁盘层级（仓库是权威源）**：`BuildSyncItems` 对 dirLevel 类型（`IsDirLevelSync`）用 `nestDirLevelTree` 把 `SyncResourcesDirLevel` 的扁平单元按相对路径段重建为嵌套容器树——中间目录（仅含子模型夹、自身非模型文件夹，如 `wine_fox_json`）自动成为可展开容器节点，模型夹/文件为叶子。仓库怎么来，整合包就怎么来。**容器节点必须填 `Type`**（`nestDirLevelTree`/`treeChildren` 接收 rtype）——前端 `applyFilter` 按 `i.type === 选中类型` 过滤，容器缺 Type(=空串)会被整体丢弃，导致整棵嵌套子树（嵌套1→嵌套2→动力臂.ysm）不显示
- **文件夹图标 📁，扁平文件才用类型图标**（💎）；`isDirEntry` 时 icon 默认 `📁`，disabled/legacy 各自覆盖 ⛔/🔗，diverged 聚合夹用 🗂️
- **missing 夹展开显仓库侧预览**：`buildChildrenForDir` 不再要求实例侧存在——仓库是绝对权威源，missing（仓库有整合包无）夹从仓库侧列内部文件清单（全标 missing）供预览待推内容
- **missing/optional 夹保持自身状态，仅 synced 夹提升 diverged**：整体缺失/整体多余不降级成「部分差异」；`aggregateStatus` 保留 optional 语义（纯实例独有容器 → optional 可拉取，非误归 diverged）
- **容器 Path 按聚合状态选源侧**：`dirLevelContainerPath`——optional（可拉取）→ 实例根（pull 源），其余（可推送/同步）→ 全局根（push 源），避免混合夹锁错源侧
- **同段名叶子/容器冲突防御**：`nestDirLevelTree.insert` 对「同段名先是叶子、又作容器段下钻」用 `__self` 子项收容，防覆盖容器与 nil map 写入 panic

## 相关

- ADR-024（多资源类型联邦架构：按资源类型分目录同步）
