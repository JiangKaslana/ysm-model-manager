# ADR-066：全资源预览器：统一预览契约与注册表驱动分发

- **状态**：🔄 部分采纳（统一契约方向已定；**P0「硬编码派发墙」已于 `0615b21d` 落地**，D2–D5 待后续阶段）
- **日期**：2026-08-16
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/views/app-preview/loader.ts`、`frontend/src/views/app-preview/index.ts`、`frontend/src/views/app-preview/litematic-meta.ts`、`frontend/src/utils/resource/types.ts`、`resource_types.json`、`frontend/src/utils/3d/model3d.ts`、`frontend/src/views/app-preview/litematic-3d.ts`、`ADR-061`、`ADR-064`、`ADR-065`、`ADR-067`（zip 化资源识别，P0.x 硬前置）

---

## 1. 背景（Context）

### 1.1 目标

一个统一预览入口，按资源类型分发到对应适配器，归一化后由**单一渲染核心**呈现。新增格式 = 加一个适配器 + 注册表一条目，不污染既有渲染逻辑。资源面广（YSM 已管理 7 类），正需要 Three.js 当生态基石——但「基石」管渲染底层，格式摄入由各自的解析通道（YSMParser WASM / three-vrm / babylon-mmd）接管，职责分离。

### 1.2 当前三条（实为两条 + 缩略图）渲染路径各自为政

| 资源类型 | 扩展名 | 当前预览 | 数据源 | 现状路径 |
|---------|--------|---------|--------|---------|
| ysm | .ysm/.zip/.json | 3d | YSMParser WASM → go/threejs.Build → Spec3D | `model3d.ts`（`renderModel3D`） |
| create-blueprint | .nbt/.schematic | 3d | Go `GetNbt/SchematicVoxelData` → InstancedMesh | `litematic-3d.ts`（`createLitematic3D`） |
| litematic | .litematic | 3d | Go `GetLitematicVoxelData` → InstancedMesh | `litematic-3d.ts` |
| mmd-skin | .pmx/.pmd | **none** | three-mmd（babylon-mmd parser） | 🆕 路线 B |
| vrchat-avatar | .vrca/.vrm | **none** | GLTFLoader + @pixiv/three-vrm | 🆕 路线 B |
| resourcepack / shaderpack | .zip | thumbnail | 纹理/mcmeta | 缩略图通道 |

`renderModel3D` 与 `createLitematic3D` 是**两套独立的 renderer / rAF loop / OrbitControls / cleanup**。`mmd-skin` / `vrchat-avatar` 仍是 `preview: "none"`（resource_types.json:143 / :168）。若路线 B 不收敛直接落地，会变成**第三条路径**——正是 AGENTS.md 警告的「格式散装 / 各写一套 loader」。

### 1.3 尚未动手就撞上的墙：硬编码资源路径 / 扩展名派发

全资源预览器还没写一行代码，先在预览层摸到三处硬编码派发（这是「墙」的实体，非测试桩）：

| 位置 | 硬编码内容 | 性质 |
|------|-----------|------|
| `loader.ts:21` | `const isWasmCapable = /\.(ysm\|zip\|json)$/i.test(modelPath)` | 扩展名正则硬编码，决定走 WASM 还是 Go |
| `index.ts:108` | `if (/\.(ysm\|json)$/i.test(modelPath))`（`loadPreviewImage`） | 同上，另一处独立判断 |
| `litematic-meta.ts:212` | `const voxelFn = isNbt ? "GetNbtVoxelData" : isSch ? "GetSchematicVoxelData" : "GetLitematicVoxelData"` | 类型→Go binding 函数名**字符串分支**硬编码 |
| `model3d-loader.ts:84-89` | `getCachedSpec(model._modelPath)` / `GetModel3DSpec(model._modelPath)` | 依赖缓存里写死的 `_modelPath` 字符串 |

同一语义（「这个扩展名属于哪个类型、该走哪条加载链」）在 3+ 处各写一遍，无单一口径——新增 VRM/MMD 时，若不在 each 处补分支，预览就会静默漏掉。

> **延伸墙（`.zip` 化资源识别）已拆为独立 ADR-067**：P0 解的是「前端硬编码派发」，但 `.zip` 可被任意资源包裹（mmd/vrc/蓝图/投影的 `.zip` 当前 Go 端 `DetectResourceType` 完全识别不了），该难题落在 Go 检测核心的扩展名门槛 + 内容指纹覆盖，且 S1/S2 改动有回归风险。ADR-067 已给出 S1–S4 精确方案（S4 前端契约本批已落地），是 P1 VRM / P2 MMD 接入的硬前置。

### 1.4 根因：注册表已建，但消费端未暴露能力元数据

`resource_types.json` **已是单一事实来源**，每个类型定义了 `extensions` 与 `preview` 字段（如 `ysm` → `extensions:[.ysm,.zip,.json]`, `preview:"3d"`；`mmd-skin` → `preview:"none"`）。但前端注册表封装 `frontend/src/utils/resource/types.ts` **只导出了 ID/label 映射**：

- `RESOURCE_TYPES`（短标签→id：YSM→"ysm" / MMD→"mmd-skin" …）
- `RESOURCE_TYPE_LABELS`（id→中文名）
- `ALL_RESOURCE_TYPES`（从 JSON `id` 派生）

它**没有把 `extensions` / `preview` 能力元数据暴露给消费端**。因此预览层无法「查表得派发」，只能各自内联正则与字符串分支。墙不是「缺注册表」，而是「注册表的能力元数据没接出来」。

### 1.5 这不是新问题——与近期提交同病（先例已在 sync 层收拾过）

最近提交链正是反复治理同一类「注册表建了、消费端仍硬编码」的病灶：

- **ADR-064**（落地 commit `d05afa3e`）：同步层「scanner 单一扫描源，对比实现单点化」——消除 4 套对比逻辑、5 处扩展名过滤重复、4 处 `.json` 特判。
- **ADR-065**（落地 commit `e120b5cf`：**整合包侧资源类型语义收敛：rtype 分支注册表驱动单点**）——标题已点明范式：`resource_types.json` 已注册表化，但**消费端仍分散硬编码**，须收敛到 `types` 单点。

预览层的 `loader.ts:21` / `index.ts:108` / `litematic-meta.ts:212` 正是 ADR-065 之后**下一个尚未收敛的消费端**。治理语言应与其一致：**扩展名/加载链判定收敛到 `types` 单点，从 `resource_types.json` 派生**。

---

## 2. 决策（Decision）

### D1 · 注册表驱动派发（落地前置，必须先解墙）

扩展 `frontend/src/utils/resource/types.ts`，从 `resource_types.json` 派生并暴露**能力元数据**：

```ts
// 新增：类型 → 扩展名列表 / 预览模式（单一事实来源派生，vite 内联防漂移）
export interface ResourceTypeCapability { extensions: string[]; preview: "3d" | "thumbnail" | "none"; }
export const RESOURCE_CAPS: Record<string, ResourceTypeCapability> = /* 从 resourceTypesJson 派生 */;
// 新增：扩展名 → 类型 ID 反查（消灭 loader.ts/index.ts 的内联正则）
export function resolveTypeByExt(path: string): string | null;
```

预览层全部改吃注册表，删除散硬正则与字符串分支：

- `loader.ts:21` 的 `/\.(ysm|zip|json)$/` → `resolveTypeByExt(modelPath)` 命中即 WASM capable；
- `index.ts:108` 同改；
- `litematic-meta.ts:212` 的 `GetXxxVoxelData` 字符串分支 → 按 `RESOURCE_CAPS[type].extensions` 或显式 `voxelFnFor(type)` 单点映射；
- `model3d-loader.ts` 的 `_modelPath` 透传改为经注册表解析的规范 path key。

**P0 先行**：新增 VRM/MMD 前先完成 D1，否则只是把散硬从 3 处变 5 处。

### D2 · 统一预览契约 + 单一渲染核心

定义归一化抽象，把「格式差异」关进适配器：

```
PreviewAdapter (每格式一个)
   └─ load(ctx) → PreviewScene { root: Object3D; cameraHint; controls; boneProvider?; animator?; meta }
        ↓
mountPreview(container, scene)  ← 唯一渲染核心（接管 renderer / rAF / OrbitControls / cleanup / debug）
```

`renderModel3D` 与 `createLitematic3D` **都降级为「适配器 + 复用核心」**，overlay/renderer/controls 不再各写。核心只认 `THREE.Object3D` + 元信息，不关心来源。

### D3 · 适配器地图

| 适配器 | 输入 | 输出到 PreviewScene | 来源 |
|--------|------|---------------------|------|
| `YsmAdapter` | Spec3D | `root`=buildSceneMesh(spec) | 既有包一层 |
| `LitematicAdapter` / `BlueprintAdapter` | voxel JSON | `root`=InstancedMesh | 复用 litematic |
| `VrmAdapter` | .vrm/.vrca | three-vrm 场景 + springbone | 路线 B（glTF 原生，最干净） |
| `MmdAdapter` | .pmx/.pmd | three-mmd 场景 + IK | 路线 B（实验态，见 §3 风险） |
| `ThumbnailAdapter` | zip/meta | 缩略图卡片（不进 3D 核心） | 既有 |

### D4 · 双管线收敛

- YSM 仍走 `go/threejs.Build` → Spec3D，**不动既有契约**；
- VRM/MMD 走前端直引（three-vrm / babylon-mmd），桥接 `boneProvider`/`animator` 进统一契约；
- 二者都进同一 `mountPreview`——「通用化单一管线」偏好成立，新增格式只加适配器。

### D5 · 富格式走前端直引（路线 B，已拍板）

VRM 用 `@pixiv/three-vrm` + `GLTFLoader`；MMD 用 `babylon-mmd` 的 Three.js 适配（`@moeru/three-mmd`，其 parser 直接借 `babylon-mmd`）。MMD 解析大脑在 Babylon 侧，与联邦 Babylon 9.19.x 栈天然对齐；MMD 在 Three.js 侧的社区库为实验态，P2 须评估成熟度或改走联邦 Babylon 分屏视图。

### 不纳入本次范围

- 动画播放：默认静态预览（`architecture.md §4.3` 明写「不需要动画」）；VRM/MMD 动画价值后续独立立项。
- 缩略图类型（resourcepack/shaderpack）是否进统一入口：维持独立缩略图卡片，仅 5 个 3D 类型纳入 `mountPreview`（待用户拍板）。
- `go/threejs.Build` 跨平台硬债：路线 B WASM 化归入 P4，不影响 P0–P3。

---

## 3. 后果（Consequences）

**正面**：
- 消灭扩展名/加载链硬编码，与 ADR-064/065 同一治理语言，口径单点维护；
- 新增格式只加「适配器 + 注册表一条目」，不再散硬；
- 单一渲染核心去重，相机/cleanup/debug 一次做对；
- VRM/MMD 直引天然跨平台，契合「网页 + 移动 + 桌面」全平台定位。

**负面 / 风险**：
- 🔴 **MmdAdapter 成熟度**：three-mmd 实验态（v0.1.1），其 IK/动画为自写移植版（`mmd-ik-solver.ts` 532 行标 "adapted from babylon-mmd"），未受同等战场检验；建议先评估 `babylon-mmd` 直桥或 MMD→GLB 离线烘焙。
- 🔴 **坐标口径（陷阱 #11）**：vrm/mmd 自带坐标系，需验证与现有相机/网格对齐，避免历史 9 次 fix 重演。
- 🟡 **依赖体积**：three-vrm + babylon-mmd parser 增包体，需 tree-shaking 评估。
- 🟡 **D1 迁移面**：`loader.ts`/`index.ts`/`litematic-meta.ts` 三处散硬判断须迁移到 `types` 单点，含对应测试断言迁移。

**已知遗留**：
- `go/threejs.Build` 跨平台硬债（`spec-portability-assessment.md` 路线 B：编 WASM，让 Spec3D 生成脱离 Wails 桌面壳进浏览器）——仅约束 YSM 路径，不阻碍 VRM/MMD 前端直引。
- `RESOURCE_TYPES` 短标签≠JSON 全名（`types.ts:2-4` 注释），`resolveTypeByExt` 须基于 `extensions` 而非 label，避免与 Go 端 `ScanModelEntriesWithLabel` 语义混淆。

---

## 4. 数据溯源

- **来源**：用户对话（2026-08-16，「还没开始折腾就栽在硬编码资源路径上」）+ 代码审计（`frontend/src` grep 扩展名/binding 派发 + `git log` 近期提交）。
- **硬编码排查清单（「墙」实体，file:line）**：
  - `frontend/src/views/app-preview/loader.ts:21` — `/\.(ysm|zip|json)$/i` 内联正则；
  - `frontend/src/views/app-preview/index.ts:108` — `/\.(ysm|json)$/i` 内联正则（`loadPreviewImage`）；
  - `frontend/src/views/app-preview/litematic-meta.ts:212` — `GetNbtVoxelData / GetSchematicVoxelData / GetLitematicVoxelData` 字符串分支；
  - `frontend/src/views/app-preview/model3d-loader.ts:84-89` — 依赖缓存写死的 `_modelPath`。
- **注册表现状 vs 缺口**：`resource_types.json` 已含 `extensions` + `preview` 单一事实来源；`frontend/src/utils/resource/types.ts` 仅导出 `RESOURCE_TYPES` / `RESOURCE_TYPE_LABELS` / `ALL_RESOURCE_TYPES`（id/label），**未暴露 extensions/preview 能力元数据**——消费端因此无法驱动，被迫散硬。
- **近期提交先例（治理范式引用）**：
  - ADR-064 落地 `d05afa3e`（scanner 单一扫描源 + 对比单点化，消除多处扩展名过滤/`.json` 特判重复）；
  - ADR-065 落地 `e120b5cf`（**整合包侧 rtype 语义收敛：注册表驱动单点**）——标题即范式：注册表已建、消费端仍硬编码须收敛。
  - 结论：预览层是 ADR-065 之后**下一个待收敛的消费端**，D1 与 ADR-065 同构。
- **必做 diff（registry-driven 改造最小改动面）**：
  1. `types.ts`：新增 `ResourceTypeCapability` 接口 + `RESOURCE_CAPS`（从 JSON 派生）+ `resolveTypeByExt(path)`；
  2. `loader.ts:21` / `index.ts:108`：内联正则 → `resolveTypeByExt`；
  3. `litematic-meta.ts:212`：字符串分支 → `voxelFnFor(type)` 单点映射（并入 `types` 或 `litematic-meta` 常量表）；
  4. 补/迁移断言：扩展名→类型解析、voxelFn 映射的单元测试。
- **落地计划（P0 先解墙，再扩能力）**：
  - **P0**：D1 注册表驱动派发（解硬编码墙，零新格式）；
  - **P1**：`VrmAdapter`（three-vrm，最干净，价值最高）；
  - **P2**：`MmdAdapter`（three-mmd / 或 babylon-mmd 直桥，标实验态）；
  - **P3**：ysm/blueprint/litematic 包成适配器接入 `mountPreview` 单一核心，消灭双 renderer；
  - **P4**：跨平台——ysm 的 `go/threejs.Build` 硬债（WASM 化）；VRM/MMD 天然纯前端。

---

## 5. 实现说明（审核补注）— P0 已落地 `0615b21d`

### 5.1 实际代码 diff（registry-driven 改造落地面）

**`frontend/src/utils/resource/types.ts`**（新增能力元数据派生层，单一事实来源）：
- 新增 `extOf(path)`：路径→小写扩展名（含点）；
- 新增 `RESOURCE_CAPS: Record<string, ResourceCap>`：从 `resourceTypesJson` 派生，暴露 `extensions` / `preview` / `label` / `icon`；
- 新增 `matchTypeByExt(path, typeId)`：按注册表 extensions 判定归属（不处理歧义）；
- 新增 `resolveTypeByExt(path)`：扩展名→类型 ID 反查，歧义扩展名（`.zip` 同时归属 ysm/resourcepack/shaderpack）返回 `null`，调用方回退 Go 内容检测；
- 新增 `isYsmWasmPreview(path)`：ysm 单文件（`.ysm`/`.json`）走 WASM 预览，`.zip`/`.7z` 容器由 Go `FindPreviewImage` 兜底；
- 新增 `VOXEL_RPC_BY_EXT`：`.nbt/.schematic/.litematic` → `GetNbtVoxelData/GetSchematicVoxelData/GetLitematicVoxelData` 单点映射。

**`loader.ts:21`**：`/\.(ysm|zip|json)$/i` → `matchTypeByExt(modelPath, RESOURCE_TYPES.YSM)`。
- 🟢 **附带修复**：注册表 ysm `extensions` 含 `.7z`，原正则漏判 `.7z` 的 YSM 文件（硬编码副作用），现自动覆盖。

**`index.ts:108`**（`loadPreviewImage`）：`/\.(ysm|json)$/i` → `isYsmWasmPreview(modelPath)`，保留 `.zip`/`.7z` 走 Go 的语义。

**`litematic-meta.ts:212`**：三元字符串分支 → `VOXEL_RPC_BY_EXT[ext]`；同时删除 `isNbt`/`isSch` 内联正则与未使用的 `label` 死变量，改以 `extOf(path)` 单点取扩展名驱动 `ReadNbtStructure`/`ReadSchematic`/`ReadLitematicMeta` 分支。

### 5.2 验证

- `cd frontend && npm run typecheck`（tsc --noEmit）：✅ EXIT 0；
- `cd frontend && npx vite build`：✅ EXIT 0（chunk >500kB 警告为既有项，与本次无关）；
- 行为保持：ysm `.ysm`/`.json`/`.zip`/`.7z` WASM 解码路径不变；`.zip`/`.7z` 预览仍走 Go；蓝图/投影体素 RPC 选择等价迁移。

### 5.3 遗留

- `model3d-loader.ts:84-89` 的 `_modelPath` 透传未纳入 P0（属 D1 后续项，不影响 VRM/MMD 路线 B 接入点）；
- 单元测试断言迁移（§4 必做 diff 第 4 项）待补：扩展名→类型解析、voxelFn 映射的契约测试。

<!-- 文件名: universal-resource-preview.md → 实际文件 ADR-066-universal-resource-preview.md -->
