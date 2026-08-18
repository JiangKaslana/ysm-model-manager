# ADR-092：资源类型分组（Group）分层路由：Minecraft / Minecraft-Mod / MMD 总目录归并

- **状态**：🔄 部分采纳（group 层第 1 层已落地；MMD 子类型化为后续）
- **日期**：2026-08-18
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`ADR-066 通用资源预览, ADR-067 压缩容器资源检测, resource_types.json 单一事实来源`
- **落地进度（2026-08-18 追加）**：group 字段 + resourceGroups 顶层数组已写入 `resource_types.json`（第 1 层通用分组）；Go 侧 `GroupOf` / `GroupStorageRoot` / `GroupLabel` 已实现并接入 `GetRepoRoot` / MkdirAll；前端 `GROUP_META` / `GROUP_OF` / `groupStorageRootOf` 已派生并接入 path-cards 显示；schema 校验已纳入 group（可选 + 白名单）。**MMD 段冻结点已用 `upstream/MC-MMD-rust` 真实源码解冻（见 §4 溯源补充）。**

---

## 1. 背景（Context）

`resource_types.json`（仓库根，单一事实来源）当前登记 7 类资源，每类仅有一个 `storageSubDir`——即 `FilesRoot` 下的**叶子目录**，类型之间**完全平铺、无更高层分组**（已读源码确认：根 `resource_types.json` 7 个条目均无 `group` 字段；`frontend/src/utils/resource/types.ts:9-17` 的 `RESOURCE_TYPES` 亦无 group 维度）。

实际使用中的资源远不止这 7 类的平铺：

- **通用资源**：资源包 `resourcepack`（resourcepacks/）、光影包 `shaderpack`（shaderpacks/）本应归到「Minecraft 本体总目录」；
- **模组资源**：YSM 模型 `ysm`、机械动力蓝图 `create-blueprint` 应归到「Minecraft-Mod 总目录」；还要纳入**车万女仆（Touhou Maid）基岩版模型**（当前尚无对应类型）；
- **MMD 资源**：`mmd-skin` 目录结构**⚠️ 初稿冻结，已解冻（2026-08-18 拉取 `shiroha-233/MC-MMD-rust` 源码核实）**：真实结构为 `3d-skin/` 根 + 按用途分的 7 类子目录，**推翻初稿「5 子目录含 mp3」假设**。详见 §4 溯源补充。**子类型化（mmd-scene / mmd-anim / mmd-morph / mmd-stage / mmd-shader）为第 2 层后续工作，本 ADR 第 1 层只归并 mmd-skin 到 mmd 组。**
- **VRM**：`vrchat-avatar` 用户明确「先独立」，不参与归并（group=vrm 独立组）。

若继续平铺，跨实例同步时文件夹会随「类别×实例」指数膨胀，且 UI / 扫描 / 安装逻辑散落。需在**不推翻现有注册表优先（ADR-066）与压缩容器检测（ADR-067）架构**的前提下，引入一层稳定的 group 分组。

## 2. 决策（Decision）

在现有注册表优先架构上**增量**引入 `group` 分组，绝不推倒重来：

1. **JSON 加字段（单一事实来源）**：每个类型新增 `group` 枚举字段（`minecraft` / `minecraft-mod` / `mmd` / `vrm` / `other`）；新增顶层 `resourceGroups` 数组声明分组元数据（`id` / `name` / `icon` / `order`）。分组本身也由 JSON 派生，新增分组只改 JSON。
2. **两层路由**：引入 `FilesRoot/{group}/{storageSubDir}`。Go 侧新增 `GroupOf(rtype)` 与 `GroupStorageRoot(group)`，与现有 `StorageSubDir(rtype)`（`go/types/extensions.go:277`）同构；前端 `types.ts` 派生 `GROUP_OF` / `GROUP_LABELS`。
3. **分组归并映射**：
   - `minecraft`：`resourcepack`、`shaderpack`（光影包**正式纳入** Minecraft 总目录，此前平铺）；
   - `minecraft-mod`：`ysm`、`create-blueprint`、**新增 `maid-model`（车万女仆基岩模型）**；
   - `mmd`：`mmd-skin`，第 1 层只归并到 mmd 组（`FilesRoot/mmd/mmd`）。**其物理子目录结构已于 2026-08-18 拉取 `upstream/MC-MMD-rust` 源码核实解冻**：真实为 `3d-skin/` 根 + 按用途分的 7 类子目录——`EntityPlayer/`（玩家模型 pmx/pmd/vrm）、`SceneModel/`（场景模型）、`DefaultAnim/` + `CustomAnim/`（动画 vmd/fbx）、`StageAnim/`（舞台包 vmd+mp3/ogg/wav）、`DefaultMorph/` + `CustomMorph/`（表情 vpd）、`shader/`（着色器 glsl）。**推翻初稿「5 子目录含 mp3」假设**：mp3 仅存在于 `StageAnim/<包>/`（舞台配乐），非独立顶层子目录。**mmd 子类型化（mmd-scene / mmd-anim / mmd-morph / mmd-stage / mmd-shader）为第 2 层后续工作，本 ADR 第 1 层不落地。**
   - **MMD 资源归属澄清（2026-08-18 补充，防第 2 层混淆）**：`shader/`（`.vsh/.fsh`，全局用户自定义渲染管线，`ShaderProvider.java` 编译替换默认渲染，开关 `mmdShaderEnabled`）**独立于模型**，属全局层，第 2 层应建 `mmd-shader` 类型；而 `.spa/.sph`（MMD 模型自带的 Standard/球面反射贴图，pmx 引用）**随模型文件夹走**，不建独立类型，靠 `mmd-skin` 的 `installExts` 覆盖即可（当前已含 `.spa/.sph`）。内置 `.glsl`（compute_skinning/toon_*）是 mod 打包在 assets 的资源，用户不可换，无需类型。
   - `vrm`：`vrchat-avatar`，**独立**，group=`vrm`，不与其他合并。
4. **向后兼容（不 mass-move）**：存量数据已落在 `FilesRoot/{storageSubDir}`（单级）的保持可读；`GroupStorageRoot` 在无 `group` 时回退单级 `storageSubDir`。仅**新增 / 带 group 的类型**写入两级路径，不强制迁移旧目录。
5. **`maid-model` 作为新类型**登记（storageSubDir / extensions / detector / installDir / scanDir / actions 另行实现），本 ADR 只锁定其归属 `minecraft-mod`。

## 3. 后果（Consequences）

- **正面**：文件夹从 7 个平铺叶子收敛为分组树，直击「防塞爆」诉求；跨实例同步按 group 聚合，UI / 扫描 / 安装逻辑可统一在 group 层编排。新增 group / 类型仍只改 JSON（延续 ADR-066 注册表优先），不散改 Go / 前端。
- **负面 / 改动面**：两级路径影响落盘 / 读取点——`internal/app/app.go`（MkdirAll）、`internal/app/resource_bindings.go:184`（`GetRepoRoot`，**仓库根唯一收敛点**，sync 经 `app_install_instance.go` 自动跟随、**无需改 sync 内部**）、`frontend/src/views/app-content/settings/path-cards.ts:225`（`filesRoot + "/" + storageSubDir`）；均统一改走 `GroupStorageRoot`。**第 1 层已全部落地（2026-08-18）。**
- **风险与缓解**：① 存量单级目录兼容性——靠 `GroupStorageRoot` 回退兜底，不触发 mass-move；② `maid-model` 注册需补 full schema（扩展名 / 检测器），否则扫描不到（**第 2 层后续**）；③ MMD 子类型化（mmd-scene/mmd-anim/mmd-morph/mmd-stage/mmd-shader）第 2 层实现时需与 `installExts` / `dirLevelSync` 协同对齐。
- **已知遗留**：VRM 独立策略为临时态，待用户确认后再决定是否纳入某 group；`subFolders` 与现有 `installExts` / `dirLevelSync` 的协同需实现时对齐。

## 4. 数据溯源

- 来源：`resource_types.json`（根）全量读取 → 结果：7 类、每类仅 `storageSubDir`、无 `group` 字段，证实「缺分组」假设。
- 来源：`frontend/src/utils/resource/types.ts:9-17` `RESOURCE_TYPES` + `docs/knowledge/utils-resource-types.md` → 结果：group 维度此前不存在，需新增派生层。
- 来源：`go/types/extensions.go:277` `StorageSubDir(rtype)`、`go/types/resource.go:24` 结构体字段 → 结果：`GroupOf` / `GroupStorageRoot` 按同构模式落地。
- 来源：`internal/app/app.go:152-155` MkdirAll、`frontend/src/views/app-content/settings/path-cards.ts:225`、`tests/test_resource_schema.mjs:23` REQUIRED_FIELDS → 结果：改动清单已锁定，schema 校验需把 `group` 纳入（可选 + 回退）。
- 来源：用户口述分组意图（Minecraft 总目录 / Minecraft-Mod 总目录 / MMD 5 子目录 / VRM 独立）→ 结果：归并映射见 §2.3。**⚠️ 其中「MMD 5 子目录含 mp3」为口述假设，未经上游源码验证，已与下两条冲突。**
- 来源：`docs/archive/reference/mmdskin-analysis.md`（联邦自写逆向分析，2026-06-12）→ 结果：真实 MmdSkin（by shiroha, MIT）安装结构为 `3d-skin/EntityPlayer/<ModelName>/` **单文件夹**，内含 `model.pmx/.pmd` + 纹理 `.png` + 动作 `.vmd` + 表情 `.vpd`；**无 mp3、非 5 独立子目录**；该文档结论为「方案 C 暂不实现」。**→ 本 ADR 初稿的 MMD `subFolders` / mp3 假设全部与之冲突。**
- 来源：`upstream/` 目录现状 + `git submodule status` + `git remote -v` → 结果：仅含 `ModernYSM-1.20.1-forge`（YSM 上游），**无 mmd-skin 上游**；submodule 列表为空；remote 仅 4 个 ysm-model-manager 自身 fork，无指向 `shiroha-233/MC-MMD-rust`。**→ 证实 mmd-skin 上游源码与文档确实未拉入本仓库，ADR-092 MMD 段的事实来源缺失，须补拉 upstream 核实后定稿。**
- **溯源补充（2026-08-18，解冻 MMD 段）**：已 `git clone shiroha-233/MC-MMD-rust`（分支 `1.20-vr`）至 `upstream/MC-MMD-rust/`。核实结果：
  - `common/src/main/java/com/shiroha/mmdskin/config/PathConstants.java` → 定义 `3d-skin/` 根 + `EntityPlayer/` / `SceneModel/` / `DefaultAnim/` / `CustomAnim/` / `StageAnim/` / `DefaultMorph/` / `CustomMorph/` / `shader/` 各子目录，**证实 7 类按用途子目录、非 5 子目录、mp3 仅存于 StageAnim**。
  - `ModelCatalogEntry.java` / `SceneModelCatalog.java` → 玩家与场景模型扫描算法**完全同构**（子文件夹→`.pmx`>`.pmd`>`.vrm`→`model.*`优先→字母序兜底），模型是玩家还是场景**纯靠所在根目录区分**，无类型字段。
  - `AnimationInfo.java` / `ModelAnimConfig.java` → 动画发现支持 `DefaultAnim/` + `CustomAnim/` + 每模型 `anims/` 与模型根目录，格式含 `.vmd` 与 `.fbx`；槽位解析优先级 `animations.json` 映射 → `anims/<槽位>.vmd` → 模型根 `<槽位>.vmd` → `CustomAnim/<槽位>.vmd` → `DefaultAnim/<槽位>.vmd`。
  - `StagePack.java` / `StageConfig.java` → `StageAnim/<包>/` 内 vmd（motion/camera/morph 由 inspector 判定）+ 音频（`.mp3/.ogg/.wav`），`stage_config.json` 记舞台本地偏好。
  - `ShaderProvider.java` → `shader/` 读 `MMDShader.vsh/.fsh`（用户自定义渲染着色器），与 mod 内置 `.glsl`（`compute_skinning`/`toon_*`，打包在 assets）分属两层；`.spa/.sph` 在 MC-MMD 源码**零引用**（属 MMD 模型自带的材质贴图，非 MC-MMD 引入）。
  - **→ 解冻结论**：mmd-skin 的 `installDir=3d-skin/EntityPlayer/`（当前实现）只覆盖玩家模型，`SceneModel/DefaultAnim/CustomAnim/StageAnim/DefaultMorph/CustomMorph/shader/` 均无对应类型——第 2 层需为这些子目录各建类型（见 §2.3 mmd 条目）。

<!-- 文件名: resource-type-group-routing.md → 实际文件 ADR-092-resource-type-group-routing.md -->
