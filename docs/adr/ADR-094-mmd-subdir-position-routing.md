# ADR-094：MMD 子类型位置路由：3d-skin 目录层级优先于扩展名

- **状态**：✅ 已采纳
- **日期**：2026-08-18
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`ADR-092`
- **演进（2026-08-23 审核）**：核心「目录层级优先于扩展名」决策仍成立；「不新增独立 rtype」策略已被 ADR-104 扁平化演进覆盖（MMD 现拆为 9 个独立类型，各自独立 installDir）

---

## 1. 背景（Context）

ADR-092 为资源类型引入 `group` 分组，并将 mmd-skin 归入 `mmd` 组。但 MMD 的**子类型**（玩家模型 / 场景模型 / 动画 / 表情 / 舞台 / 着色器）如何区分与落位，ADR-092 未定稿，第 2 层悬而未决。

实测发现一个**根本冲突**：MC-MMD-rust（`shiroha-233/MC-MMD-rust`，已克隆至 `upstream/`）靠**目录位置**区分子类型（`3d-skin/EntityPlayer/` vs `3d-skin/SceneModel/` vs `3d-skin/CustomAnim/`），而我们的资源类型系统靠**扩展名**路由（`resolveTypeSafe` / `ExtBelongsTo`）。信息量不匹配：

- `.pmx` 无法区分玩家模型（EntityPlayer）与场景模型（SceneModel）；
- `.vmd` 无法区分动画（CustomAnim）与舞台（StageAnim）与模型随行动画；
- `.vpd` 无法区分表情。

若强行给各子类型建独立 rtype 并认领这些扩展名，会导致 `ExtBelongsTo` 歧义、破坏现有 mmd-skin 单文件导入（曾以 4 个前端测试失败实证）。**扩展名路由不适用于 MMD 子类型**。

## 2. 决策（Decision）

采用**位置路由**：MMD 子类型由**仓库/整合包的目录层级**决定，而非扩展名。

1. **mmd-skin 以 `3d-skin/` 为安装/扫描根**（`installDir`/`scanDir` 从 `3d-skin/EntityPlayer` 改为 `3d-skin`），覆盖 MC-MMD 完整资源树，而非仅玩家模型子目录。
2. **仓库侧按 MC-MMD 子目录组织**：`FilesRoot/mmd/mmd/{EntityPlayer,SceneModel,CustomAnim,CustomMorph,StageAnim,shader}/`。用户拖入已按该结构组织的文件夹时，`inferFolderType`（ADR 前序改动）路由到 mmd-skin 根，`WriteModelFolder` 保留 subpath 层级落位。
3. **同步层保留子目录层级**：`SyncResourcesDirLevel` 识别 MC-MMD 子目录名（`EntityPlayer`/`SceneModel`/`CustomAnim`/`CustomMorph`/`StageAnim`/`DefaultAnim`/`DefaultMorph`/`shader`）作为独立同步单元，不展平到 `3d-skin/` 根——否则 `EntityPlayer/角色A` 会错落为 `3d-skin/角色A` 丢 EntityPlayer 层。
4. **不新增独立 rtype**：不建 mmd-scene / mmd-anim-custom 等，避免 `.pmx/.vmd/.vpd` 扩展名歧义。子类型仅作为 mmd 组内的目录层级存在。
5. **前端不新增类型 tab**：app-tree 已支持子目录嵌套展示（render.test.ts R3 验证），文件树天然按子目录分组；子类型标签作为 mmd tab 内的快捷筛选 UI（可选增强）。

## 3. 后果（Consequences）

- **正面**：
  - 与 MC-MMD 原版资源树语义完全一致，用户按 `3d-skin/` 结构放置即可正确同步；
  - 无扩展名歧义，现有 mmd-skin 单文件导入不破坏；
  - 前端文件树天然分组，无需新类型 tab（避免 UI 膨胀到 15+ tab）；
  - 同步层保留层级，玩家/场景/动画各归其位。
- **负面 / 改动面**：
  - 仓库侧需按 MC-MMD 子目录组织，**存量直接放根模型需迁移**（移入 `EntityPlayer/`）或兼容处理；
  - `SyncResourcesDirLevel` 增加 `mmd-skin` 专用分支（`mmdSubdirNames` 识别），其他 rtype 不受影响；
  - `FindInstDir` 找 `3d-skin` 目录（更宽），递归扫描范围扩大。
- **已知遗留**：
  - ~~存量仓库迁移脚本未实现（模型直接放根 → 移入 EntityPlayer）~~——**已取消**：ADR-104 扁平化后各 MMD 子类型为独立顶级类型，仓库侧按 `storageSubDir` 分目录存储，不再需要根→子目录迁移脚本；
  - 前端子类型标签 UI 未落地（文件树已能分组，标签为纯增强）；
  - `DefaultAnim`/`DefaultMorph` 系统内置目录（首次运行 zip 释放，用户不导入）已纳入同步识别，但无仓库类型入口。

## 4. 数据溯源

- 来源：`upstream/MC-MMD-rust/common/src/main/java/com/shiroha/mmdskin/config/PathConstants.java` → 结果：MMD 资源树为 `3d-skin/` 根 + 按用途子目录（EntityPlayer/SceneModel/DefaultAnim/CustomAnim/StageAnim/DefaultMorph/CustomMorph/shader），证实"位置区分"语义。
- 来源：`resource_types.json`（当前）mmd-skin `installDir`/`scanDir` 改为 `3d-skin` → 结果：覆盖完整资源树。
- 来源：`go/sync/sync_dirlevel.go` `SyncResourcesDirLevel` + `mmdSubdirNames` → 结果：MC-MMD 子目录作为独立同步单元保留层级，端到端测试 `sync_mmd_subdir_test.go` 验证 `EntityPlayer/角色A` 正确映射到 `3d-skin/EntityPlayer/角色A`（非展平）。
- 来源：前端 types.test（曾失败 4 例）→ 结果：扩展名路由对 `.pmx/.vmd/.vpd` 歧义，实证否决"独立 rtype + 扩展名认领"方案（路线 C）。
- 来源：`app-tree/render.test.ts` R3 子目录展开 → 结果：前端已支持子目录分组展示，无需新类型 tab。

<!-- 文件名: mmd-subdir-position-routing.md → 实际文件 ADR-094-mmd-subdir-position-routing.md -->
