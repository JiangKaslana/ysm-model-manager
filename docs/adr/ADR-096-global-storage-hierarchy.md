# ADR-096：全局库存储分层规范：MMD 子目录三链路消费

- **状态**：已采纳（Accepted）
- **日期**：2026-08-18
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`go/types/extensions.go`（`IsMMDSubDir`）；`go/sync/sync_dirlevel.go`（`dirLevelSync`）；`go/instance/instance.go`（`BuildSyncItems` SubDir 填充）；`frontend/src/views/app-sync-manager/`（分组展示 + subdir 过滤）；`frontend/src/utils/resource/types.ts`（`MMD_SUBTYPES`）；ADR-092 / ADR-094 / ADR-095

---

## 1. 背景（Context）

MC-MMD 模型在 Minecraft 内按「用途子目录」组织（`EntityPlayer`/`SceneModel`/`CustomAnim`/`CustomMorph`/`StageAnim`/`Shader`，及系统内置 `DefaultAnim`/`DefaultMorph`，与上游 `PathConstants.java` 的 SKIN 子目录对齐）。但全局库（`FilesRoot`）此前只有两层路由（`group/storageSubDir`，ADR-092），**MMD 子目录分层未纳入存储规范**，导致：

1. **识别/展示不分层**：整合包 MMD 同步列表把 `entityplayer`/`scenemodel` 等子目录单元平铺成普通行（SyncItem 无 subdir 字段），角色/场景/动画混在一锅（ADR-095 后续实测）；
2. **选择链路断**：`app-nav` 的 MMD 子目录下拉（`MMD_SUBTYPES`，ADR-094）`repo_subdir` 写入后**零消费**，选了没效果；
3. **存储堆积风险**：全局库导入 MMD 无子目录归类，模型继续堆在 `FilesRoot/mmd/EntityPlayer` 根下。

数据层（`sync_dirlevel.go` 的 `mmdSubdirNames`）**已有层级保留能力**，但识别/展示/选择三链路未消费。

## 2. 决策（Decision）

**统一「MMD 用途子目录」为注册表无关的共享集合（`go/types.IsMMDSubDir`），并让三链路消费同一规范**：

1. **共享集合单一来源**：`mmdSubdirNames`（8 项）上移 `go/types/extensions.go`，导出 `IsMMDSubDir(name)`；`go/sync`（同步保留层级）与 `go/instance`（展示分组）引用同一集合，消除双源。
2. **展示链路（已落地）**：`ResourceSyncItem.SubDir`（Go 侧 `BuildSyncItems` 按 `IsMMDSubDir` 填充，根下空）→ 前端 `SyncItem.subdir` → `app-sync-manager` 按 `MMD_SUBTYPES` 顺序分组渲染（组头 + 组内条目），根下归「PMX 模型 (EntityPlayer)」组。
3. **选择链路（已落地）**：`app-nav` 切 MMD 子目录 → `repo:subdir-changed` 事件 + `repo_subdir` 持久化 → sync 订阅按 subdir 过滤列表；切类型重置过滤。
4. **存储分层（规划，分阶段）**：
   - 存储规范：`FilesRoot/mmd/EntityPlayer`（根/默认）+ `FilesRoot/mmd/{SceneModel|CustomAnim|CustomMorph|StageAnim|Shader}`（用途子目录）；
   - 导入归类：MMD 导入时按用途选择落到对应子目录（后续实现，导入 UI 增用途下拉或自动识别）；
   - 扫描：`ScanModelEntries` 对 mmd 返回含子目录分组的条目（后续，`ModelEntry` 加分组字段或前端推导）；
   - 同步：`dirLevelSync` 已保留层级，无需改。

## 3. 后果（Consequences）

**正面**：
- 角色/场景/动画在同步列表分开展示，与模组目录结构一致；
- 下拉选择真正生效（`repo_subdir` 从死字段变活）；
- 三链路（同步/展示/选择）消费同一子目录集合，无口径漂移；
- 为全局库存储分层（导入归类/扫描分组）铺路。

**负面 / 已知遗留**：
- 展示分组仅覆盖**整合包同步列表**；全局库资源管理器（`app-resource-manager`）的 MMD 分组与导入归类**未实施**（存储分层 Phase 2）；
- 系统内置 `DefaultAnim`/`DefaultMorph` 在展示中显示原名（前端 `MMD_SUBTYPES` 刻意缺省，注释已说明）；
- `go/types/types_subdir_test.go` 与既有测试重名（并行会话文件，2026-08-18 14:40，构建挡路）——需并行会话删除重复。

## 4. 数据溯源

- 断链实证：`MMD_SUBTYPES` 仅被 `app-nav` 消费（无扫描/展示消费）；`SyncItem` 无 subdir 字段；`repo_subdir` 写入后零消费。
- 数据层已有：`sync_dirlevel.go` `mmdSubdirNames`（同步保留层级，P5 修复 Sable 同源）。
- 修复验证：`go build ./go/...`；`go test ./go/instance/ ./go/sync/`；前端 `typecheck` + `vitest run src/views/app-sync-manager/ src/views/app-nav/`（23 用例全绿，含分组与 subdir 过滤新用例）。

<!-- 文件名: global-storage-hierarchy.md → 实际文件 ADR-096-global-storage-hierarchy.md -->
