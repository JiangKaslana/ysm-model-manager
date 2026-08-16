# ADR-080：资源包 block/item 模型 JSON 解析与渲染（PackModelAdapter）

- **状态**：✅ 已采纳
- **日期**：2026-08-16
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`ADR-066`（统一预览契约/适配器地图）、`ADR-068`（ContainerReader 容器解包）、`ADR-072`（适配器下沉 utils/3d/adapters）、`ADR-041`（UV 口径对齐）、`poc/mc-java-model/`（POC 验证产物）

---

## 1. 背景（Context）

### 1.1 目标

MC Java 版资源包（.zip）本质是 `assets/` 下的文件树，其中 `models/block|item/*.json` 是**完全可渲染**的几何描述（elements 立方体 + faces + UV + display）。当前资源包走 `ThumbnailAdapter` 缩略图通道（ADR-066 适配器地图），只读 `pack.mcmeta` + `pack.png`，不进 3D 核心。ADR-066 遗留"缩略图类型是否进统一入口待拍板"。

本 ADR 拍板：**资源包内 block/item 模型 JSON 渲染进统一预览入口**（新 `PackModelAdapter`），无模型的包保持缩略图通道。

### 1.2 POC 已验证（poc/mc-java-model/，21/21 断言通过，真实 vanilla 1.21.4 样本）

| 验证点 | 结论 |
|--------|------|
| parent 链 | 3 级（stone→cube_all→cube→block），elements 继承、display 逐视角继承、子覆盖父 |
| 纹理变量 | `#all`→`block/stone`→`textures/block/stone.png` 链式 + 命名空间剥离；缺失变量→null |
| 缺省 UV | 面无显式 uv 回退全纹理 `[0,0,16,16]` |
| UV 口径 | 像素坐标→归一化 + v 翻转；"方块顶=纹理顶"由真实纹理像素断言锁定（草在顶、泥在底） |
| element rotation | 45° 顶点位移正确；face UV rotation 90° 角置换正确 |
| tintindex | grass_block 5 个染色面（overlay 4 + 顶面 1） |
| item 复用 | elements 继承 + display 覆盖 |

**关键口径结论**：`expandBoxUV`/`parseFaceUV`（ADR-041，基岩版 box UV 展开）**不可直接复用**——Java 版每面显式 `uv` 像素坐标，输入口径不同；仅"像素÷纹理尺寸"归一化模式可借鉴。顶点顺序/UV 角映射取自 prismarine-viewer（多年验证与 MC 渲染一致）。

## 2. 决策（Decision）

### D1 · 新增 Go binding：`ListPackModels` / `ReadPackEntry`

- `ListPackModels(path) string`：枚举容器内 `assets/<ns>/models/{block,item}/**/*.json` 条目路径（升序 JSON 数组），复用 `container.Reader.Entries()`（ADR-068，统一支持 zip/目录/7z）；
- `ReadPackEntry(path, entry) string`：读容器内条目内容（base64），上限 64MB；entry 须 `assets/` 前缀 + 无 `..`/反斜杠/绝对路径（防穿越守卫）；
- 归置新文件 `internal/app/resourcepack_models.go`，不污染既有 `resource_bindings.go`。

### D2 · 前端 TS 解析器：`frontend/src/utils/3d/parse-java-model.ts`

POC `parse-java-model.mjs` 纯 TS 移植（零依赖），加载抽象为 `read(entry) → base64` 回调（JSON 经 atob 解码、PNG 直接 dataURL 给 TextureLoader）；模型/纹理尺寸缓存；`parseJavaModel(entry, read)` 输出面数据（positions 像素÷16 转米 + Three 域 UV + texEntry/texColor/tintindex）。

### D3 · `PackModelAdapter`（`frontend/src/utils/3d/adapters/pack-model-adapter.ts`）

对齐 ADR-066/072 适配器模式（参考 vrm-adapter/litematic-adapter）：

- `build(ctx, path)`：`ListPackModels` → 解析**首个完整可渲染模型**（有实际纹理定义的 block 模型；纯模板如 cube/cube_all 自动跳过）→ 逐面 `BufferGeometry` + `MeshLambertMaterial`（纹理加载 / 纯色兜底 / tint 面近似草绿）→ 挂 `ctx.scene` → 包围盒定相机；
- 模型浏览：`extraControls(topBar)` 挂"上一个/下一个"切换（含模型序号），重挂内容层，复用外壳（贴合 ADR-066 §5.6 的 3D 内切换语义）；
- `dispose()` 释放几何/材质/纹理；`onClose()` 复位列表状态。

### D4 · 预览路由：`PACK` handler 双通道

`frontend/src/views/app-preview/index.ts` 的 `[RESOURCE_TYPES.PACK]` 改为：`ListPackModels` 非空 → `mount3D(packModelAdapter, path)`；空 → 回退 `showResourcePack`（缩略图通道）。`resource_types.json` 的 `resourcepack.preview` 保持 `"thumbnail"` **不动**（避免 Go 一致性测试与扫描链路连锁；声明语义由 handler 双通道承接）。`shaderpack` 不进 3D。

### 不纳入本次范围

- blockstate variant 选择（默认变体渲染；完整支持二期）
- biome tint 精确染色（近似草绿/纯色，标注已知限制）
- display 变换应用（静态方块预览用默认视角；item 手持视角后续）
- 光影 shaders（GLSL 依赖游戏管线，明确不做）

## 3. 后果（Consequences）

**正面**：
- 资源包从"缩略图卡片"升级为"包内模型 3D 浏览"，贴合全模型预览器定位；
- 新适配器 + 注册表 handler 一行接入，零污染既有渲染核心（`mount-preview-core.ts` 不动）；
- POC 已验证解析口径，落地即复用，无算法风险。

**负面 / 风险**：
- 🟡 blockstate 未处理：贴地方块（楼梯/栅栏等）只显默认变体，观感不完整——二期按 `variants` 提供选择；
- 🟡 tint 面近似染色：草/树叶色与原版有偏差（无 biome 数据）；
- 🟢 资源包模型量大（vanilla 数百个）：列表/切换性能需懒解析（当前仅解析当前模型）。

**已知遗留**：
- `ListPackModels` 首次枚举大包（数百 MB）耗时随条目数线性，可后续加缓存；
- 目录型资源包（解压目录）经 `container.OpenDir` 天然支持，未单独验证。

## 4. 数据溯源

- **来源**：用户对话（2026-08-16，资源包渲染可行性讨论）+ POC 实测（`poc/mc-java-model/`：真实 vanilla 1.21.4 样本 + prismarine-viewer 权威 UV 角映射 + grass_block_side 像素级方向断言）。
- **方法**：POC 解析器 21 断言全绿 → 立项落地（本 ADR）。
- **结果**：解析口径全部锁定（parent 链/变量/UV/旋转/tint/display 继承），落地改造面 = Go 2 binding + TS 1 解析器 + 1 适配器 + 路由 1 行。

<!-- 文件名: pack-model-adapter.md → 实际文件 ADR-080-pack-model-adapter.md -->
