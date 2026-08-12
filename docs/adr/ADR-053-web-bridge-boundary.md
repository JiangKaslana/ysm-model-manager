# ADR-053：网页版桥接能力边界（ADR-049 增强 B1–B3 收尾）

- **状态**：✅ 已采纳（Accepted）
- **日期**：2026-08-12
- **决策人**：Jieling（人类首席架构师）、AI 代理（Riku）
- **相关**：`ADR-049 网页版桥接`；`frontend/src/wails/browser-adapter.ts`；`frontend/src/views/app-content/community-data.ts`；`frontend/src/views/app-nav/index.ts`；`frontend/src/views/app-tree/toolbar-events.ts`

---

## 1. 背景（Context）

ADR-049 确立了网页版（查看器模式）通过 `browser-adapter.ts` 的 Proxy 机制桥接 Go↔JS 绑定，未实现的 binding 走 `WebUnsupportedError` fail-fast（Phase 3 能力门控隐藏对应 UI）。

用户提出「部分问题并非不可桥接」，要求**探索并增强**可桥接的能力范围。经对网页版真实调用面（104 个经 `getApp()` 解构引用的绑定）逐批可行性判定与实现，已完成 B1–B3 三批纯前端可复现绑定。本 ADR 收尾，**正式界定网页版桥接的能力边界**：哪些可桥接（A 类）、哪些不可（C 类），避免后续无界重试。

## 2. 决策（Decision）

### 2.1 分类原则

| 类别 | 判定 | 桥接策略 |
|------|------|----------|
| **A 类 · 纯前端可复现** | 行为可完全由浏览器侧（IndexedDB / localStorage / bundled JSON / 静态派生）等价复现 | 在 `webImpls` 实现，业务调用零改动 |
| **C 类 · 桌面专属** | 依赖真实文件系统、OS 集成、目标目录选择 UI 或 Go 侧几何分析，网页版无对应物 | 保持 fail-fast，由 `isViewerMode()`/`resolveWebMode()` 门控隐藏，不桥接 |

### 2.2 已桥接清单（B1–B3，共 24 个）

- **B1（16）**：`SearchModels` / `IsFileBanned` / `ToggleModelEnable` / `GetModelTags` / `SetModelTags` / `ListByTag` / `AllTags` / `DeleteModelDir` / `RemoveDir` / `RenameDir` / `RenameFile` / `ClearImportLogs` / `ClearRuntimeLogs` / `GetSubDirMap` + 放开 `toolbar-events` 高级筛选守卫（数值范围条件降级提示）。
- **B2（5）**：`LoadWorkshopCreators` / `SaveWorkshopCreators` / `LoadGitHubRepos` / `DefaultWorkshopSites` / `SaveWorkshopSites`（bundled JSON 默认 + localStorage 覆盖层）；放开 `community-data` 网页旁路与 `app-nav` GitHub tab。
- **B3（3）**：`ListModelAuthors` / `ScanLocalAuthors`（基于 IDB 模型库 `[作者]` 前缀提取，对齐 `scanner.go`）/ `GenerateRepoIndex`（返回 index.json 内容字符串，网页版经 `<a download>` 触发下载）。

### 2.3 明确归 C 类（不桥接）

- **MoveModelFile / CopyModelFile**：依赖 `resolveDstDir`（桌面真实目录选择器）产出 `dstDir`；网页版无文件系统、无任意目标目录可选，`dstDir` 无对应物。阻塞点在缺失目标目录 UI，而非 binding 本身。强行映射 `dstDir→type` 有静默移错模型组的语义风险。
- **ExportBoneStructures**：已在 `toolbar-events.ts` 被 `resolveWebMode()` 守卫正确隐藏（fail-fast → 提示 toast），无红错，维持现状。
- **OS / 实例 / 自更新类**：`OpenInBrowser` / `RevealInExplorer` / `SelectDirectory` / `ListVersionInstances`（整合包）/ 实例同步 / 自更新 / 回收站等——均属桌面或 Android 原生能力，网页版不可等价复现。
- **3D 真闭环（P2-2）**：`GetModel3DSpec`/`Build3DSpecFromGeometryJSON` 当前返回 `"{}"` 兜底；真实渲染需将 Go 几何 JSON→spec 变换移植到 `ysm-parser` WASM，超出「纯前端复现」范畴，列为独立攻坚项。

## 3. 后果（Consequences）

- **正面**：网页版模型库核心（搜索/标签/开关/删除/重命名/日志/子目录）、社区与工坊（只读 + 本地覆盖）、作者扫描与仓库索引均已可用；创意工坊/作者 tab 不再恒空；GitHub tab 对查看器模式可见。验证：`tsc` 0 错、全量 vitest 1758/1758 通过、`build:web` 172 模块 transform 成功。
- **负面 / 边界**：网页版「移动到文件夹 / 复制到文件夹」因缺目标目录选择器不可用（与桌面体验差异，已文档化）；3D 预览仍为空 spec 兜底提示。
- **已知遗留**：B2 的 `SaveWorkshopCreatorsBySite` / `SaveWorkshopPresetsBySite` 仍 fail-fast，`community-data` 的 `tryAutoMergeCommunity` 实时合并写入被 `.catch` 静默降级——读取路径正确，写入持久化留待后续批次。

## 4. 数据溯源

- 来源：网页版 104 个 `getApp()` 解构引用绑定 ∩ 前端单测 / `tsc` 验证 ∩ `scanner.go` 作者提取口径。
- 结果：A 类 24 个已桥接并提交（`f2f38cb1` / `3a6967b7` / `2f3d3346`）；C 类维持 fail-fast 门控；边界判定写入本 ADR。

<!-- 文件名: web-bridge-bao.md → 实际文件 ADR-053-web-bridge-boundary.md -->
