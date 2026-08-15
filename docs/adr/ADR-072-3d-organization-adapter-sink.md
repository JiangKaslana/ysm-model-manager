# ADR-072：3D 代码归置与预览派发注册表化：适配器下沉 utils/3d/adapters

- **状态**：🔄 部分采纳（方向已定，编码待立项落地——等 ADR-070/071 web 端施工稳定后动工，避免与施工中地基冲突）
- **日期**：2026-08-16
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/views/app-preview/`、`frontend/src/utils/3d/`、`frontend/src/utils/resource/types.ts`、`resource_types.json`、`ADR-066`、`ADR-070`、`ADR-071`

---

## 1. 背景（Context）

### 1.1 用户提问：6 类资源 3D 代码是否与管理器本体参杂、审核很乱

用户原话（2026-08-16）：「一个项目塞 6 个资源，虽然都是 npx 直接解决加载问题，但 3d 相关的代码会不会与管理器本体参杂在一起，审核起来很乱，是否合理呢。」

审计结论：**架构方向合理，3D 并未与管理器本体参杂；但「审核乱」的感觉不是错觉，有 3 处实锤**，值得归置。用户拍板「出 ADR 吧，隔壁还在施工地基」——即本期只记决策、不动代码。

### 1.2 已做对的（本期不动，作为「不该推倒」的基线）

| 层 | 位置 | 状态 |
|----|------|------|
| 3D 渲染基础设施 | `frontend/src/utils/3d/`（26 个源文件 + 4 个测试） | ✅ **0 个 backend import**（已 grep 验证），纯渲染工具：renderer-setup / camera-control / render-loop / mesh-builder / spec-builder / ysm-object… |
| 3D 内容适配器 | `ysm-adapter.ts` / `vrm-adapter.ts` / `litematic-adapter.ts` / `mmd-adapter.ts` | ✅ ADR-066 适配器模式已落地，每格式一个 adapter + `mount-preview-core.ts` 统一渲染核心，`switchTo(path)` 3D 内切换已 path 驱动 |
| Go 侧解析 | `go/threejs/` `go/litematic/` `go/geometry/` | ✅ 独立包，与管理器本体（fileops/importer/recycle…）分离 |
| 管理器本体 | `features/`、`views/app-resource-manager`、`app-tree` 等 | ✅ 完全不碰 3D |

### 1.3 实锤乱点 ①：`app-preview` 目录 50+ 文件三层混居

`frontend/src/views/app-preview/` 单目录平铺三类职责，无分组：

- **UI 壳**：`index.ts` / `detail.ts` / `tpl.ts` / `css.ts` / `cache.ts` / `skeleton.ts` / `utils.ts`；
- **3D 适配器 + 渲染核心**：`ysm-adapter.ts` / `vrm-adapter.ts` / `litematic-adapter.ts` / `mmd-adapter.ts` + 薄包装 `ysm-3d.ts` / `vrm-3d.ts` / `litematic-3d.ts` / `mmd-3d.ts` + `mount-preview-core.ts`；
- **WASM/加载胶水**：`wasm.ts` / `loader.ts` / `model3d-loader.ts` / `geometry.ts` / `parse-ysm-json.ts` / `litematic-meta.ts` / `skeleton-render.ts` 等。

同一目录内，纯渲染（可放 `utils/3d/`）与视图壳（必须留 `views/`）靠文件名与注释区分，审核要猜。

### 1.4 实锤乱点 ②：`detail.ts` 一个文件聚合 6 个 show 函数（314 行）

```ts
showModelDetail   // YSM 模型详情（detail.ts:21）
showResourcePack  // 资源包（detail.ts:132）
showSimplePreview // 通用/其他（detail.ts:169）
showShaderpack    // 光影包（detail.ts:187）
showVrmMeta       // VRM 模型（detail.ts:233）
showMmdPreview    // MMD 模型（detail.ts:292）
```

6 个入口对应 7 个注册表类型中的 6 条展示路径（litematic/blueprint 走 `litematic-meta.ts` 的 `showLitematic`），全挤一个文件，跨资源域职责混杂。

### 1.5 实锤乱点 ③：`index.ts` 派发仍是手写 if 链，注册表没接上

`index.ts` 的 `_showModelDetail`（172–217 行）是 `if PACK / if YSM / if LITEMATIC|BLUEPRINT / if VRC / if SHADER / if MMD` 一长串。ADR-066 D1 的注册表驱动**只落地一半**：`matchTypeByExt` 目前仅服务 YSM 的 WASM 判定（`loader.ts:23`），**类型 → show 函数的映射没有走 `RESOURCE_CAPS`**。新增一个 3D 类型仍需回来改 if 链——这正是 ADR-066 §1.3 警告的「把散硬从 3 处变 5 处」残留。

---

## 2. 决策（Decision）

### D1 · 3D 适配器层下沉 `utils/3d/adapters/`（方案 B，已拍板）

把纯 3D 内容层从 `views/app-preview/` 物理迁入 `frontend/src/utils/3d/adapters/`，与既有渲染基础设施同层：

```
frontend/src/utils/3d/
├── (既有 26 个渲染基础设施文件，不动)
└── adapters/
    ├── mount-preview-core.ts   # 统一渲染核心（renderer/rAF/controls/overlay）
    ├── ysm-adapter.ts / ysm-3d.ts
    ├── vrm-adapter.ts / vrm-3d.ts
    ├── litematic-adapter.ts / litematic-3d.ts
    └── mmd-adapter.ts / mmd-3d.ts
```

`views/app-preview/` 只留 UI 壳（index/detail/tpl/css/cache/skeleton 面板）+ WASM/加载胶水（wasm/loader/model3d-loader/geometry/parse-ysm-json）。**边界判据：`utils/3d/` 保持 0 个 backend import**，视图壳负责调 Go binding、把数据链注入适配器。

### D2 · 派发注册表化：`index.ts` if 链 → `RESOURCE_CAPS` + show 映射表

`RESOURCE_CAPS`（`utils/resource/types.ts`，ADR-066 D1 已派生）补上**类型 → show/cleanup/invalidate 函数映射**，`_showModelDetail` 的 if 链整体替换为查表：

```ts
// 单点映射：新增格式 = 注册表一条目 + 这里一行，不再改 if 链
const PREVIEW_HANDLERS: Record<string, PreviewHandler> = {
  ysm:               { show: showModelDetail, ... },
  "create-blueprint":{ show: showLitematic, ... },
  litematic:         { show: showLitematic, ... },
  "mmd-skin":        { show: showMmdPreview, ... },
  "vrchat-avatar":   { show: showVrmMeta, ... },
  resourcepack:      { show: showResourcePack, ... },
  shaderpack:        { show: showShaderpack, ... },
};
```

保留 `showSimplePreview` 作未命中兜底。缩略图类型（pack/shader）维持独立缩略图卡片，不进 `mountPreview`（ADR-066 既定）。

### D3 · `detail.ts` 按资源域拆分

6 个 show 函数按资源域拆文件（ysm / pack / shader / vrm / mmd / 通用），或至少把 3D 入口（`showVrmMeta`/`showMmdPreview`）与 2D 详情（`showModelDetail`/`showResourcePack`/`showShaderpack`）分离。落地方案二选一，以文件行数与 import 面最小为准。

### D4 · 落地时机：编码待立项，等 web 施工稳定（用户拍板）

**本期只记决策，不动代码。** 落地排期在 ADR-070（web 体素 3D）/ ADR-071（web 能力边界）施工稳定之后，避免文件迁移与并行分支冲突；同时不阻塞 ADR-066 其余待立项项（P3-E、MmdAdapter 成熟度评估）。

---

## 3. 后果（Consequences）

**正面**：
- 审核按目录分层：`utils/3d/` 纯渲染、`app-preview/` 视图壳、`go/*` 解析，各层一眼定位；
- 新增 3D 格式 = 注册表一条目 + `PREVIEW_HANDLERS` 一行 + 一个 adapter，不再改 if 链；
- `utils/3d/` 维持 0 backend import 的纯渲染边界，可整体复用（web 端移植天然受益，呼应 ADR-070）。

**负面 / 风险**：
- 🟡 文件迁移牵动 import 路径与测试（`app-preview/` 现有 21 个测试文件，`utils/3d/` 4 个），需全量改 import + 测试同迁；
- 🟡 与 ADR-070/071 并行开发有合并冲突风险——故 D4 明确等 web 施工稳定后动工；
- 🔴 不动 `utils/3d/` 既有 26 个文件（纯基础设施），只迁适配器层，避免把「归置」扩大成「重构」。

**已知遗留**：
- `ysm-adapter.ts` 已知降级：调试模式（F 键 normal/pivot/bone 可视化）未接入 shared（`ysm-adapter.ts:12` 注释），不在本 ADR 范围；
- MmdAdapter 成熟度风险（ADR-066 §3）不因本 ADR 改变；
- `skeleton.ts` / `skeleton-render.ts` 与 ysm-adapter 的编排边界在落地时按 import 方向裁定（视图壳留 `views/`，内容构建下沉 `utils/3d/`）。

---

## 4. 数据溯源

- **来源**：用户对话（2026-08-16，「一个项目塞 6 个资源……审核起来很乱，是否合理呢」）+ 代码审计（`frontend/src` 目录结构 + `index.ts`/`detail.ts` 派发 + `utils/3d` backend import grep）+ 用户拍板（「出 ADR 吧，隔壁还在施工地基」）。
- **审计证据（file:line）**：
  - `frontend/src/views/app-preview/index.ts:172-217` — `_showModelDetail` 手写 if 链（PACK/YSM/LITEMATIC|BLUEPRINT/VRC/SHADER/MMD）；
  - `frontend/src/views/app-preview/detail.ts` — 6 个 show 函数聚合（21/132/169/187/233/292 行）；
  - `frontend/src/views/app-preview/` — 50+ 文件三层混居（UI 壳 / 3D 适配器 / WASM 胶水）；
  - `frontend/src/utils/3d/` — 26 源文件 + 4 测试，grep `backend|wails` 零命中（纯渲染边界已验证）；
  - `frontend/src/utils/resource/types.ts` — `RESOURCE_CAPS` 已派生但消费端未接（ADR-066 D1 半落地）。
- **决策**：方案 B（适配器下沉 + 派发注册表化）已拍板；D4 编码待立项（等 ADR-070/071 稳定）。
