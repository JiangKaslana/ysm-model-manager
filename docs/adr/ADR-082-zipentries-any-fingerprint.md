# ADR-082：材质包识别长治久安：zipEntries 任意层级指纹（any 模式）+ detector 容器统一

- **状态**：✅ 已采纳
- **日期**：2026-08-16
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`go/types/resource.go, go/packs/mcmeta.go, resource_types.json, go/types/resource_types_embed.go, frontend/src/utils/resource/types.ts, frontend/src/backend/extract.ts, ADR-067, ADR-068, ADR-069`

---

## 1. 背景（Context）

ADR-067（zip 化资源识别）落地后，材质包（resourcepack）识别仍有两个真实场景失效，复现测试实锤：

| 场景 | 现状 | 根因 |
|------|------|------|
| **zip 套一层目录**（`MyPack/pack.mcmeta`，创建者常用打包方式） | `DetectResourceType` 返回 `""`（未知） | `pack.mcmeta` 指纹是 `match: "exact"`，只匹配根目录条目；套目录后条目名变 `mypack/pack.mcmeta`，exact 不命中 → resourcepack 分支失败，后续类型也无一命中 |
| **`.7z` 材质包**（部分作者用 7z 打包） | 识别为 `ysm`（模型） | resourcepack/shaderpack 的 `extensions` 只有 `.zip`，`.7z` 过不了 `hasExt` 准入门槛；而 ysm 声明了 `.7z`，其 `isYsmFile` 对 `.7z` 直接返回 true → 材质包被 ysm 兜底抢走，导入进模型目录、预览走模型链路 |

深层病灶（与 ADR-069 同源）：识别实现与配置割裂——`mcmeta.go` 的 `hasMcmeta`/`hasShaders`/`isYsmFile` 三个硬编码谓词各持一套 `zip.OpenReader` 直开（只支持 `.zip`），与注册表 `zipEntries` 指纹（`matchZipArchive` + `container.Open`，支持 `.zip/.7z/目录`）并行；前端 `extract.ts detectZipType` 更是硬编码 if 链，与 Go `MatchZipEntry` 注册表遍历各自为政。修一处坏一处，正是 ADR-065 记录过的「修好蓝图坏 MMD」式漂移。

## 2. 决策（Decision）

**改实现不改 schema：把 `exact`/`prefix` 指纹升级为「任意层级段后缀」匹配语义，detector 统一走 container 打开，前端指纹注册表化。** 新增类型仍只需改 JSON，老配置自动变强（`pack.mcmeta` exact 无需改 match 值即获得任意层级能力）。

### S1 — `MatchZipEntry` 任意层级段后缀匹配（go/types/resource.go）

对条目名按 `/` 分段，生成全部「段后缀」（`a/b/c` → `["a/b/c", "b/c", "c"]`），每个段后缀分别按 exact/prefix/suffix 匹配指纹：

- `exact` `pack.mcmeta` → 命中 `MyPack/pack.mcmeta`（段后缀 `pack.mcmeta`）✅ 修复套目录材质包
- `prefix` `shaders/` → 命中 `MyPack/shaders/foo.fsh`（段后缀 `shaders/foo.fsh`）✅ 修复套目录光影包
- `suffix` `.pmx`/`ysm.json` 等 → 原 HasSuffix 已覆盖任意层级，语义不变（段后缀化幂等）

误报风险评估：`pack.mcmeta` 只可能出现在资源包内，任意层级匹配安全；`shaders/`/`models/` 同理。资源包指纹在注册表顺序中位于 ysm 之前，YSM 包内出现 `pack.mcmeta` 的冲突场景不存在。

### S2 — detector 容器统一（go/packs/mcmeta.go）

`DetectResourceType` 的 detector 分支全部收敛到 `container.Open`（ADR-068 已建，支持 `.zip/.7z/目录`）：

- `mcmeta` / `shader`：不再走硬编码 `hasMcmeta`/`hasShaders`（zip.OpenReader），直接 `matchZipArchive(path, &rt)` 按注册表指纹匹配 → `.7z` 材质包/光影包也能内容指纹识别
- `ysm`：`.ysm`/`ysm.json` 直判保留；`.zip/.7z` 走 `matchZipArchive`；容器打开失败且扩展名 `.7z` → 兜底返回 ysm（保留坏 .7z 行为，有测试锁定）
- 删除 `zipEntryMatch`/`hasMcmeta`/`hasShaders` 三个硬编码谓词（`isYsmFile` 收敛进分支），识别逻辑只剩「注册表指纹 + container 打开」一条路（ADR-069 方向落地，打开/识别两 ADR 合流）

### S3 — resourcepack/shaderpack `extensions` 补 `.7z`（双副本同步）

`resource_types.json` 与 `go/types/resource_types_embed.go`（`resource_types_consistency_test.go` 强约束逐字段一致）同步：resourcepack/shaderpack 的 `extensions` 追加 `.7z`，使 `.7z` 材质包能过 `hasExt` 准入进入 detector。**兜底语义同步收严（ADR-082 续）**：坏 .7z 不再靠 ysm 扩展名直判接住——`DetectResourceType` 容器指纹打开失败即返回空、`DetectZipType` 无特征返回空、`ImportFromBase64` 空 rtype 明确报错 `FILE_TYPE_UNSUPPORTED`，「识别不出就是识别不出」，杜绝坏文件假装 YSM 模型。

### S4 — 前端指纹注册表化（frontend）

- `types.ts`：`RawResourceType` 补 `zipEntries`/`detector` 字段（从根 resource_types.json 派生），新增 `matchZipEntryTS(name)`（任意层级段后缀语义，与 Go S1 同构），`resolveTypeSafe` 歧义容器回退链改用注册表指纹
- `extract.ts` `detectZipType`：硬编码 if 链（`pack.mcmeta === name` 等）改为遍历注册表 `zipEntries` 调用 `matchZipEntryTS`——新增类型只改 JSON，前后端自动同步
- 前端 `ZipType` 类型保留，返回值语义不变

## 3. 后果（Consequences）

**正面**：
- 两个真实场景修复：套目录材质包 → resourcepack；`.7z` 材质包 → resourcepack（不再被 ysm 抢走）
- 识别实现单点化：Go 侧只剩「注册表指纹 + container 打开」，前端只剩「注册表指纹」，与 ADR-065/066/067 同一治理语言，新增类型零 Go 代码
- 老配置自动变强：`pack.mcmeta` exact、`shaders/` prefix 无需改 match 值即获任意层级能力，双副本同步压力小

**负面 / 风险**：
- 🔴 `MatchZipEntry` 语义放宽：exact/prefix 从「根目录限定」变「任意层级」——误报风险极低（指纹本身是资源包专属特征），但测试需覆盖「子目录同名字段」不误伤（如 `MyPack/pack.mcmeta` 与 `sub/pack.mcmeta`）
- 🟡 detector 统一后 `hasMcmeta` 等删除：需确认无其他调用方（grep 核实仅 mcmeta.go 内部）
- 🟢 web 端 `.7z` 仍无解压能力（浏览器无原生 7z），`.7z` 材质包网页版维持降级提示（ADR-067 已知遗留延续）

**已知遗留**：
- web 端 `.7z` 内容指纹（需 7z 纯 JS 解压，范围外）
- `.ysm` 纯 Go 解密后参与指纹（ADR-069 立项，识别层已解耦，未来零改动）

## 4. 数据溯源

来源：用户报障「资源系统大改后整合包识别坏了」→ 复现测试（`go/packs` 临时测试）实锤两场景：套目录 zip → `""`；`.7z` → `ysm`。定位 `mcmeta.go` 硬编码谓词 + `extensions` 缺 `.7z` + 前端硬编码 if 链三处病灶 → 方案：S1 段后缀匹配（改实现不改 schema）、S2 detector 容器统一（删 3 谓词）、S3 extensions 补 `.7z`（双副本）、S4 前端注册表化 → ADR-082 立项。

<!-- 文件名: zipentries-any-fingerprint.md → 实际文件 ADR-082-zipentries-any-fingerprint.md -->
