---
kind: preview_core
name: 统一 3D 预览核心 preview-core
tier: architecture
category: utils
source_files:
  - frontend/src/utils/3d/adapters/mount-preview-core.ts
  - frontend/src/utils/3d/caps/sky-capability.ts
  - frontend/src/utils/3d/adapters/ysm-adapter.ts
  - frontend/src/utils/3d/adapters/vrm-adapter.ts
  - frontend/src/utils/3d/adapters/mmd-adapter.ts
  - frontend/src/utils/3d/adapters/litematic-adapter.ts
  - frontend/src/utils/3d/renderer-setup.ts
tests:
  - frontend/src/utils/3d/adapters/mmd-adapter.test.ts
  - frontend/src/utils/3d/adapters/ysm-3d.test.ts
  - frontend/src/views/app-preview/litematic-3d.test.ts
use_when:
  - 3D 预览
  - 统一预览外壳
  - 程序化天空 / sky / 背景 / scene.background
  - PreviewAdapter 适配器
  - 全模型预览（YSM / VRM / MMD / Litematic）
  - mount3D
invariant_anchors:
  - frontend/src/utils/3d/adapters/mount-preview-core.ts|mount3D
  - frontend/src/utils/3d/adapters/mount-preview-core.ts|scene.background
  - frontend/src/utils/3d/caps/sky-capability.ts|SkyCapability
  - frontend/src/utils/3d/adapters/mount-preview-core.ts|PreviewAdapter
---

# 统一 3D 预览核心 preview-core

## 概览

ADR-066 落地的**统一 3D 预览核心**，收缴 vrm / litematic 复制脚手架（旧实现各内联 ~250 行同构），成为所有富格式 3D 预览的**单一事实来源外壳**。内容差异经 `PreviewAdapter.build(ctx, path)` 注入，核心统一持有 scene / camera / renderer / OrbitControls / 灯光 / rAF / ESC / GPU 释放。

这正是「**全模型预览器**」：YSM + VRM + MMD(`@moeru/three-mmd`) + Litematic 共用同一套外壳，MMD 在 Three 内预览（非 Babylon）。

## 核心职责

- **外壳**：overlay + ⚙️ 声明式根菜单(`PREVIEW_MENU_DEFS`) + viewContainer + loadingEl + 适配器控件容器(`topBar`，仅 vrm/litematic 遗留 `extraControls` 单按钮，Phase 3 收编)
- **渲染基座（shared 模式）**：创建 `scene` / `camera` / `renderer` / `OrbitControls` / 灯光，驱动 rAF 循环、WASD/拖拽自转、resize、ESC 关闭、GPU 资源释放
- **适配器注入**：内容层经 `PreviewAdapter.build()` 挂进 `ctx.scene`；每帧 `update(dt)` 驱动动态部分（VRM SpringBone、动画）
- **3D 内模型切换**：`switchTo(path)` 复用外壳重建内容层（ADR-066 §5.6）
- **在途作废**：`invalidatePreview()` / `_gen` 防止并发加载竞态

## 对外 API / 入口

- `mount3D(adapter, path, opts?)` — 主入口，`cleanupPreview()` 旧会话后建新
- `cleanupPreview()` / `invalidatePreview()` / `switchPreview(path)`
- `buildCameraControls(topBar, bridge)` — 通用相机控件（旋转模式/速度/重置），已收进根菜单 `camera` 项（sharedOnly）
- `mountPreviewRootMenu(overlay, ctx)` → `PreviewMenuHandle`（`dispose`/`setAdapterItems`/`openPanel`）+ `PREVIEW_MENU_DEFS`（`preview-menu-defs.ts` / `preview-menu.ts`）— **ADR-076 v3 声明式根菜单**（顶栏砍掉，⚙️ 按钮 + 弹出菜单，项表驱动；core 项 close/switch/environment/camera；**适配器项经 `PreviewBuildCtx.menu.setAdapterItems` 注入**；legacyTestId `ysm-close-3d`/`env-menu-btn`/`mmd-switch` + 适配器项 `ysm-model-entry`/`mmd-model-entry` 等保留兼容 e2e）
- 契约接口：`PreviewBuildCtx`（外壳句柄 + **`menu: PreviewMenuHandle` 注册通道**）、`PreviewScene`（内容契约：`update`/`dispose`/`resetCamera`/`extraControls`…）、`PreviewAdapter`（`id`/`mode`/`build`/`onClose`）、`PreviewHandle`、`CameraControlBridge`

## 与其他子系统关系

- **适配器**：`ysm-adapter` / `vrm-adapter`（`GLTFLoader`）/ `mmd-adapter`（`@moeru/three-mmd`）/ `litematic-adapter` 各自实现 `PreviewAdapter`，`build()` 进 `ctx.scene`
- **数据层**：YSM 经 `model3d-loader`（`GetModel3DSpec` 唯一事实来源 + WASM 兜底）；MMD 经 `@moeru/three-mmd`；VRM / Litematic 各加载器
- **旧并行链路（死代码，勿同步）**：`model3d.ts` 的 `RenderSession`（ADR-052）仍存在于 `frontend/src/utils/3d/`，其 `renderer-setup.ts:44` 也设纯色背景 `0x1a1b2e`。但 `renderModel3D` 已无生产调用（仅定义 + 测试），属死代码；程序化天空**仅落统一核心**，不触碰此链路以免波及其测试。

## 不变量

- **shared 模式**：核心创建 `scene` 并设 `scene.background = new THREE.Color("#1a1b2e")`（**`mount-preview-core.ts:346`**）；所有适配器 mount 进同一 `ctx.scene`
- **天空落点（已实现，ADR-073 L1）**：统一核心在 shared 模式创建 `renderer` 后立即 `new SkyCapability({ scene, renderer }).apply()`（`mount-preview-core.ts`），复用 Three 官方 `Sky`（Preetham 散射）。YSM / VRM / MMD / Litematic 因共用同一 `ctx.scene` **零改动继承**——即「MMD 有天空 → YSM/VRM 自动获得」在 Three 域内的真·自动机制。能力层 `frontend/src/utils/3d/caps/sky-capability.ts` 封装 uniform 管线 + 可选 IBL（`setEnvironmentEnabled`，默认关）+ 会话级 tone mapping（dispose 还原）。`scene.background` 纯色保留为禁用天空时的兜底。
- **self 模式**（`adapter.mode === "self"`，如个别单例）：核心仅提供外壳、不创建 `scene`，背景由适配器自管

## 验证状态与迭代清单（2026-08-16）

- **ADR-076 v2 声明式根菜单（Phase 1 已落地）**：顶栏整块砍掉，预览控件收进 overlay 内 ⚙️ 根菜单（`PREVIEW_MENU_DEFS` 表驱动，对齐 ADR-021 范式）。`mount3D` 内 `mountPreviewRootMenu(overlay, ctx)` 挂 ⚙️ 按钮（`preview-menu-btn`）+ 弹出（`ysm-preview-menu`）；`close` 复刻原 `closeBtn` 分支（`cleanupFn?fullCleanup:closeOverlay`），`fullCleanup` 内 `unsubMenu?.()` 解绑 `document` 监听；`switchTo` 成功后 `currentPath = newPath` 同步高亮。适配器底部导航容器 `topBar` 重建为底部容器承接 `extraControls(topBar)`，Phase 2 经 `previewMenuItems` 收编。三语 locale 补齐 7 键（settings/back/switchModel/noOtherModel/timeOfDay/cloudCoverage/environmentLight）。验证：`tsc --noEmit` 本文件零错、`vite build` 通过（exit 0）。预存无关错误 `web-stats.ts:152` / `vrm-bone-ui.ts:146` 非本轮引入，备案不擅改。

- **L1 程序化天空已落地并目视验证**：`task dev` / `npm run dev:web` 跑通，天空渲染正常、四种模型（YSM/VRM/MMD/Litematic）零改动继承。用户评定「效果一般但能跑，作为基线收口，后续迭代」。
- **基线参数**（`sky-capability.ts` 默认值）：`scale 12000`（相机 maxDistance 5000 留余量）、`turbidity 8 / rayleigh 2 / mieCoefficient 0.005 / mieDirectionalG 0.8`、`cloudCoverage 0`、默认太阳方位、`ACESFilmicToneMapping` + 曝光 0.5（会话级，dispose 还原）、IBL `scene.environment` 默认关。
- **已知观感短板（后续迭代项，非阻断）**：
  1. ✅ 时间-of-day 滑块已收进**环境菜单**（🌍 环境按钮 → 滑出面板 `createSlideMenu`，与云量/IBL/地面开关并列；`preview.timeOfDay` i18n 三语，代码层 `tr` 兜底）；默认 9:00；`oninput` 经闭包 `skyCap?.setTime(hour)`，0-24 映射日出/正午/日落，夜间转暗；
  2. ✅ IBL 已默认开启（`environment: true`，2026-08-16 目视验证通过，模型反射/环境光更真实）；如需关闭调 `setEnvironmentEnabled(false)`；
  3. ✅ 按模型类别散射/曝光预设已落地（`MODEL_SKY_PRESETS` 表 + `setPreset(adapter.id)`：ysm/vrm/mmd/litematic 各自 turbidity/rayleigh/exposure；数值为初始合理值，待目视微调）；
  4. ✅ 云量滑块已收进**环境菜单**（`skyCap.setCloudCoverage(v)`，0-1 映射晴空→多云，oninput 实时改天空、onchange 松手刷新 IBL；`preview.cloudCoverage` i18n 三语，代码层 `tr` 兜底）。重构背景：原顶栏滑块被批「塞垃圾」，统一收进 🌍 环境菜单面板；三语键 `preview.envMenu/timeOfDay/cloudCoverage/environmentLight` 已入库，但保留 `tr` 代码兜底防并行 locale 竞争退化显示原始键名。

> **已知坑（构建期 capability 引用）**：环境菜单在 `if(!selfMode)` **之前**构建，此时 `skyCap`/`groundCap` 尚未赋值（仍为 `null`）。直接 `skyCap?.getX()` 取初始值会因 TS 收窄 `null` → `never` 报 `Property 'getX' does not exist on type 'never'`。正确模式：初始值用**字面量默认值**（time=9、IBL=true），交互处理器写在 `oninput`/`onChange` **闭包**内用 `skyCap?.`（闭包取声明类型 `SkyCapability | null`，安全）。地面行 `value: true`、IBL 行 `value: true` 即此口径。

## 相关

- `model3d.md`（RenderSession 旧链路，背景设于 `renderer-setup.ts:44`）
- `app-preview.md`（预览面板组件：2D 骨骼 / 3D / 缩略图）
- 程序化天空落地见本卡「不变量」（能力层 `frontend/src/utils/3d/caps/sky-capability.ts`，经统一核心 shared 模式注入；旧 `renderer-setup.ts:44` 为死代码不触碰）
