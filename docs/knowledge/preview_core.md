---
kind: preview_core
name: 统一 3D 预览核心 preview-core
tier: architecture
category: utils
source_files:
  - frontend/src/utils/3d/adapters/
  - frontend/src/utils/3d/bone-tools.ts
  - frontend/src/utils/3d/caps/sky-capability.ts
  - frontend/src/utils/3d/caps/ground-capability.ts
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
  - frontend/src/utils/3d/adapters/mount-preview-core.ts|_singletonScene.background
  - frontend/src/utils/3d/caps/sky-capability.ts|SkyCapability
  - frontend/src/utils/3d/adapters/mount-preview-core.ts|PreviewAdapter
---

# 统一 3D 预览核心 preview-core

## 概览

ADR-066 落地的**统一 3D 预览核心**，收缴 vrm / litematic 复制脚手架（旧实现各内联 ~250 行同构），成为所有富格式 3D 预览的**单一事实来源外壳**。内容差异经 `PreviewAdapter.build(ctx, path)` 注入，核心统一持有 scene / camera / renderer / OrbitControls / 灯光 / rAF / ESC / GPU 释放。

这正是「**全模型预览器**」：YSM + VRM + MMD(`@moeru/three-mmd`) + Litematic 共用同一套外壳，MMD 在 Three 内预览（非 Babylon）。

## 核心职责

- **外壳**：overlay + ⚙️ 声明式根菜单(`preview-menu-defs.ts`：`CORE_MENU_ITEMS` + `PREVIEW_MENU_GROUPS`，能力驱动 dock) + viewContainer + loadingEl + 适配器控件容器(`topBar`，仅 vrm/litematic 遗留 `extraControls` 单按钮，Phase 3 收编)
- **渲染基座（shared 模式）**：创建 `scene` / `camera` / `renderer` / `OrbitControls` / 灯光，驱动 rAF 循环、WASD/拖拽自转、resize、ESC 关闭、GPU 资源释放
- **适配器注入**：内容层经 `PreviewAdapter.build()` 挂进 `ctx.scene`；每帧 `update(dt)` 驱动动态部分（VRM SpringBone、动画）
- **VRM 动画播放（VRMA）**：`vrm-adapter` 注册 `VRMAnimationLoaderPlugin`，加载同目录 `.vrma`（`listAllFilePaths` 经端口注入，0 backend import），`createVRMAnimationClip` → `THREE.AnimationMixer`；每帧严格 `mixer.update(dt)` → `vrm.update(dt)`（后者内部已含 humanoid / springBone 更新，禁止手动 `vrm.humanoid.update()` 否则 T-pose 回归）；播放时暂停呼吸 / 视线 / 眨眼（与 MMD 行为对齐），复用 `MmdPlayBridge` + `fillMmdPlayPanel` 渲染播放 / 暂停 / 选片面板，无 `.vrma` 时优雅降级（面板不显示）
- **3D 内模型切换**：`switchToSession(path)` 复用外壳重建内容层（ADR-066 §5.6），对外暴露为 `switchPreview`；`switchPreview(path, { keepInScene: true })` 同台追加（多角色同框，`MAX_MODELS=8` 上限）；角色面板（🧍 模型组 🎭 roles）列出已加载角色（`sceneRegistry`），支持焦点切换 / 详情 / 卸载 / 追加
- **「➕ 追加」三态语义（ADR-115 行为契约）**：同类型候选 ➕ → `switchTo(p, { keepInScene: true })`（复用当前会话 adapter 追加）；跨类型候选 ➕ → `switchExternal(p, siblings, { keepInScene: true })` → `openModel3DFullscreen({ cooperate })` → 有活跃会话时 `switchPreview(path, { keepInScene: true })`（注册表主门按目标 rtype 路由到对应 opener 同台追加，**不喂当前会话 adapter**——`switchToSession` 无类型 dispatch，跨类型喂错格式解析失败）；行本体点击跨类型 → `switchExternal(p, siblings)`（无 keepInScene）= 替换语义（整段重建）。**红线（ADR-115）**：跨类型追加必须走 switchExternal 主门路由，禁止直接喂当前会话 adapter.build
- **在途作废**：`invalidatePreview()` / `_gen` 防止并发加载竞态

## 对外 API / 入口

- `mount3D(adapter, path, opts?)` — 主入口，`cleanupPreview()` 旧会话后建新
- `cleanupPreview()` / `invalidatePreview()` / `switchPreview(path)`
- `buildCameraControls(topBar, bridge)` — 通用相机控件（旋转模式/速度/重置），已收进根菜单 `camera` 项（sharedOnly）
- `mountPreviewRootMenu(overlay, ctx)` → `PreviewMenuHandle`（`dispose`/`setAdapterItems`/`openPanel`/`refreshDock`）+ `PREVIEW_MENU_GROUPS` + `CORE_MENU_ITEMS`（`preview-menu-defs.ts` / `preview-menu.ts`）— **ADR-076 v3 声明式根菜单**（顶栏砍掉，⚙️ 按钮 + 弹出菜单，项表驱动；core 项 roles/environment/camera/lighting/shadow/postproc；**适配器项经 `PreviewBuildCtx.menu.setAdapterItems` 注入**；legacyTestId `ysm-close-3d`/`env-menu-btn`/`ysm-roles-entry` + 适配器项 `ysm-model-entry`/`mmd-model-entry` 等保留兼容 e2e）

  **2026-08-19 环境拆组**：环境体量 > 全部场景设置，故将 `environment` 从 `scene` 组拆出，独立成 `env` 组（🌍 环境）。scene 组 icon 换 🎛️ 避免双 🌍 混淆。dock 按钮顺序：🧍 模型 → 💃 动作 → 🌍 环境 → 🎛️ 场景。组内仅一个 panel 项时自动快捷直达面板（不渲染组根视图），故 env 组（单 environment 项）点击直接进环境面板。

  **2026-08-19 下钻箭头**：组根视图（多 panel 列表）中，`kind === "panel"` 的行右侧显示 `>` 装饰性箭头（`data-testid="row-chevron"`），提示该行可点击进入下级面板。action 型行无箭头。渲染见 `makeRow(def, { chevron: def.kind === "panel" })`。
- 契约接口：`PreviewBuildCtx`（外壳句柄 + **`menu: PreviewMenuHandle` 注册通道**）、`PreviewScene`（内容契约：`update`/`dispose`/`resetCamera`/`extraControls`…）、`PreviewAdapter`（`id`/`mode`/`build`/`onClose`）、`PreviewHandle`、`CameraControlBridge`

## 与其他子系统关系

- **适配器**：`ysm-adapter` / `vrm-adapter`（`GLTFLoader`）/ `mmd-adapter`（`@moeru/three-mmd`）/ `litematic-adapter` 各自实现 `PreviewAdapter`，`build()` 进 `ctx.scene`
- **数据层**：YSM 经 `model3d-loader`（`GetModel3DSpec` 唯一事实来源 + WASM 兜底）；MMD 经 `@moeru/three-mmd`；VRM / Litematic 各加载器
- **旧并行链路（已全部删除，勿再建）**：`RenderSession` / `renderModel3D`（ADR-052）曾存在于 `frontend/src/utils/3d/`；render-session.ts（470 行）与 renderer-setup.ts 均随 ADR-052 P2 收尾删除（生产无调用方），`model3d.ts` 缩为 Spec 类型枢纽。程序化天空**仅落统一核心**。

## 不变量

- **`scene.background` 兜底（shared 模式，`mount-preview-core.ts:322`）**：核心创建 `scene` 并设 `scene.background = new THREE.Color("#1a1b2e")`；所有适配器 mount 进同一 `ctx.scene`
- **天空落点（已实现，ADR-073 L1）**：统一核心在 shared 模式创建 `renderer` 后立即 `new SkyCapability({ scene, renderer }).apply()`（`mount-preview-core.ts`），复用 Three 官方 `Sky`（Preetham 散射）。YSM / VRM / MMD / Litematic 因共用同一 `ctx.scene` **零改动继承**——即「MMD 有天空 → YSM/VRM 自动获得」在 Three 域内的真·自动机制。能力层 `frontend/src/utils/3d/caps/sky-capability.ts` 封装 uniform 管线 + 可选 IBL（`setEnvironmentEnabled`，默认关）+ 会话级 tone mapping（dispose 还原）。`scene.background` 纯色保留为禁用天空时的兜底。
- **self 模式**（`adapter.mode === "self"`，如个别单例）：核心仅提供外壳、不创建 `scene`，背景由适配器自管
- **dock 🧍 模型组按钮恒定直达 roles 面板（2026-08-22 收口，commit e8d6f5aa）**：`renderDock` 模型组**不再**按 `sceneRegistry` 是否为空分流。生产环境每个 `built` 都经 `mount-preview-core.ts:827` 注册进 `sceneRegistry`，故注册表恒非空——原「无角色→组根视图」兜底分支是**死分支**，且会导致加载模型后 🧍 显示旧组根菜单（与 FAB 直进 roles 不一致）。🧍 永远走 `makePanelView(rolesDef)` 直接开角色面板（角色管理 + 内嵌加载入口 `fillSwitch`）。单模型实例工具（模型信息/截图/骨骼/材料）保留 `dockGroup:"model"` 不变，由 `roleDetailView` 按 `dockGroup==="model"` 过滤，从 dock 根**下沉到角色详情内可达**——YS'M+PMX 同台时天然自洽，且多蓝图/投影等注册的实体也能经各自详情卸载（复用类型无关的 `unloadRole`）。

## 验证状态与迭代清单（2026-08-19）

- **ADR-076 v3 声明式根菜单（Phase 1+2 已落地，Phase 3 待立项）**：
  - **Phase 1**：顶栏整块砍掉，预览控件收进 overlay 内 ⚙️ 根菜单（`PREVIEW_MENU_DEFS` 表驱动，对齐 ADR-021 范式）。`mount3D` 内 `mountPreviewRootMenu(overlay, ctx)` 挂 ⚙️ 按钮（`preview-menu-btn`）+ 弹出（`ysm-preview-menu`）；`close` 复刻原 `closeBtn` 分支（`cleanupFn?fullCleanup:closeOverlay`），`fullCleanup` 内 `menuHandle.dispose()` 解绑 `document` 监听；`switchTo` 成功后 `currentPath = newPath` 同步高亮。三语 locale 补齐 7 键。
  - **Phase 2**：ysM/mmd 底部导航脚手架删除（`buildYsm/MmdBottomNav` + `mkNavBtn` + 两份 togglePopup/closePopup），适配器经 `PreviewBuildCtx.menu.setAdapterItems` 注入专属项——ysM：model/截图/骨骼；mmd：model/材质/播放（+ADR-077 bones 并行落地经仲裁收编）。切换归 core switch 项、相机归 core camera 项，消灭双入口。测试：`preview-menu.test.ts` 新增（14 例）+ `preview-menu-items.test.ts`（24 例全绿）。顺带修复 ysm 两处现存缺陷（navBuilder 死参数——底部导航从未挂载；骨骼按钮点击找不存在的 `#ysm-3d-panel`——无效）。
  - **Phase 2 后续（2026-08-19）**：
    - **环境拆组**：environment 从 scene 组拆出，独立为 env 组（🌍 环境），场景组 icon 换 🎛️。dock 按钮顺序：🧍 → 💃 → 🌍 → 🎛️。组定义 `PREVIEW_MENU_GROUPS` 新增 `{ id: "env", icon: "🌍", fallback: "环境" }`，`PreviewMenuGroupId` 扩展 `"env"`。`CORE_MENU_ITEMS` 中 environment 项 `dockGroup` 从 `"scene"` 改为 `"env"`。地面/水面系统后续继续膨胀时，往 env 组加 panel 项即可（组内多 panel 自动走组根视图 → 下钻导航）。
    - **下钻箭头**：panel 型行右侧加 `>` 装饰性箭头（`data-testid="row-chevron"`），提示可点击进入下级面板。`makeRow(def, { chevron: def.kind === "panel" })` 实现，action 型行无箭头。
    - **入口合并（2026-08-21）**：独立 `switch` 项（🔁 切换模型，legacyTestId `mmd-switch`）撤除——其面板（`fillSwitch`：类型 tab + siblings + 手动路径）本是角色面板底部的内嵌加载入口，双入口属重复。模型组 core 项仅余 `roles`（无适配器项时 dock-model 单 panel 快捷直达）；`needsSiblings` 字段随之删除；i18n 键 `preview.switchModel` 三语移除。后续「最近加载」类候选源应作为 `fillSwitch` 的新类型 tab 接入（行渲染/样式复用），勿另起面板。
  - **Phase 3 待立项**：vrm/litematic `extraControls` 单按钮（骨骼/分层/切换）收编为菜单项后删除 topBar 容器；ADR-074 S2 VRM 骨骼面板已接 UI（topBar 骨骼按钮开关面板，经 `makeBonePanelRenderer` 通用外壳），ysm 骨骼面板同构落地（ADR-077）。
  - **dock 🧍 模型组统一为 roles 入口（2026-08-22，commit e8d6f5aa）**：删掉 `renderDock` 模型组基于 `sceneRegistry` 是否为空的 if/else 分流补丁——生产恒非空使其成死分支，且造成加载模型后 🧍 显示旧组根菜单（与 FAB 直进 roles 不一致）。🧍 永远快捷直达 roles 面板；单模型实例工具（模型信息/截图/骨骼/材料）保留 `dockGroup:"model"`，下沉至角色详情（`roleDetailView` 按该字段过滤）可达。litematic 蓝图切片同步从 `ctx.menu.setAdapterItems`（dock 平铺 sink）搬家到 `buildLitematicScene` 返回值 `menuItems: sliceItems`（角色详情 sink），使蓝图注册进 `sceneRegistry` 的 entry 携带切片、可在其详情内显示与卸载。测试契约见 `preview-menu.test.ts` / `preview-menu-items.test.ts`。

- **L1 程序化天空已落地并目视验证**：`task dev` / `npm run dev:web` 跑通，天空渲染正常、四种模型（YSM/VRM/MMD/Litematic）零改动继承。用户评定「效果一般但能跑，作为基线收口，后续迭代」。
- **基线参数**（`sky-capability.ts` 默认值）：`scale 12000`（相机 maxDistance 5000 留余量）、`turbidity 8 / rayleigh 2 / mieCoefficient 0.005 / mieDirectionalG 0.8`、`cloudCoverage 0`、默认太阳方位、`ACESFilmicToneMapping` + 曝光 0.5（会话级，dispose 还原）、IBL `scene.environment` 默认关。
- **已知观感短板（后续迭代项，非阻断）**：
  1. ✅ 时间-of-day 滑块已收进**环境菜单**（🌍 环境根按钮 → 快捷直达面板，与云量/IBL/地面开关并列；`preview.timeOfDay` i18n 三语，代码层 `tr` 兜底）；默认 9:00；`oninput` 经闭包 `skyCap?.setTime(hour)`，0-24 映射日出/正午/日落，夜间转暗；
  2. ✅ IBL 已默认开启（`environment: true`，2026-08-16 目视验证通过，模型反射/环境光更真实）；如需关闭调 `setEnvironmentEnabled(false)`；
  3. ✅ 按模型类别散射/曝光预设已落地（`MODEL_SKY_PRESETS` 表 + `setPreset(adapter.id)`：ysm/vrm/mmd/litematic 各自 turbidity/rayleigh/exposure；数值为初始合理值，待目视微调）；
  4. ✅ 云量滑块已收进**环境菜单**（`skyCap.setCloudCoverage(v)`，0-1 映射晴空→多云，oninput 实时改天空、onchange 松手刷新 IBL；`preview.cloudCoverage` i18n 三语，代码层 `tr` 兜底）。重构背景：原顶栏滑块被批「塞垃圾」，统一收进 🌍 环境根菜单面板（环境独立成组后，地水系统同样收进此面板，不再挤占场景组）；三语键 `preview.envMenu/timeOfDay/cloudCoverage/environmentLight` 已入库，但保留 `tr` 代码兜底防并行 locale 竞争退化显示原始键名。
  5. ✅ **下钻箭头**：组根视图中 panel 型行右侧加 `>` 装饰箭头（`data-testid="row-chevron"`），与「🌍 环境组单 panel 快捷直达（不显示组根视图）」配合——多 panel 组（如 🎛️ 场景）的 camera/lighting/shadow/postproc 行均有箭头，提示可点击进入下级面板。

> **已知坑（构建期 capability 引用）**：环境菜单在 `if(!selfMode)` **之前**构建，此时 `skyCap`/`groundCap` 尚未赋值（仍为 `null`）。正确模式已改**getter 式 `PreviewMenuCtx`**（`preview-menu.ts`）：菜单项表通过 getter 在菜单渲染时按需取值，规避构建期 `null` 收窄报 `Property does not exist on type 'never'`；字面量默认值（time=9、IBL=true）只作为初始 UI 显示值，交互处理器写在 `oninput`/`onChange` 闭包内用 `skyCap?.`。地面行 `value: true`、IBL 行 `value: true` 即此口径。

## 相关

- `model3d.md`（3D 渲染层基础设施卡：Spec 类型枢纽 + 坐标口径 + 渲染管线，单会话架构）
- `app-preview.md`（预览面板组件：2D 骨骼 / 3D / 缩略图）
- 程序化天空落地见本卡「不变量」（能力层 `frontend/src/utils/3d/caps/sky-capability.ts`，经统一核心 shared 模式注入；旧 renderer-setup.ts 为死代码已删除不触碰）
