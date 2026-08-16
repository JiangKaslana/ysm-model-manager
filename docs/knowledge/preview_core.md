---
kind: preview_core
name: 统一 3D 预览核心 preview-core
tier: architecture
category: utils
source_files:
  - frontend/src/utils/3d/adapters/mount-preview-core.ts
  - frontend/src/utils/3d/adapters/ysm-adapter.ts
  - frontend/src/utils/3d/adapters/vrm-adapter.ts
  - frontend/src/utils/3d/adapters/mmd-adapter.ts
  - frontend/src/utils/3d/adapters/litematic-adapter.ts
  - frontend/src/utils/3d/renderer-setup.ts
tests:
  - frontend/src/utils/3d/adapters/mmd-adapter.test.ts
  - frontend/src/utils/3d/adapters/ysm-3d.test.ts
  - frontend/src/utils/3d/adapters/litematic-3d.test.ts
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
  - frontend/src/utils/3d/adapters/mount-preview-core.ts|PreviewAdapter
---

# 统一 3D 预览核心 preview-core

## 概览

ADR-066 落地的**统一 3D 预览核心**，收缴 vrm / litematic 复制脚手架（旧实现各内联 ~250 行同构），成为所有富格式 3D 预览的**单一事实来源外壳**。内容差异经 `PreviewAdapter.build(ctx, path)` 注入，核心统一持有 scene / camera / renderer / OrbitControls / 灯光 / rAF / ESC / GPU 释放。

这正是「**全模型预览器**」：YSM + VRM + MMD(`@moeru/three-mmd`) + Litematic 共用同一套外壳，MMD 在 Three 内预览（非 Babylon）。

## 核心职责

- **外壳**：overlay + topBar(关闭/旋转模式/速度) + viewContainer + loadingEl
- **渲染基座（shared 模式）**：创建 `scene` / `camera` / `renderer` / `OrbitControls` / 灯光，驱动 rAF 循环、WASD/拖拽自转、resize、ESC 关闭、GPU 资源释放
- **适配器注入**：内容层经 `PreviewAdapter.build()` 挂进 `ctx.scene`；每帧 `update(dt)` 驱动动态部分（VRM SpringBone、动画）
- **3D 内模型切换**：`switchTo(path)` 复用外壳重建内容层（ADR-066 §5.6）
- **在途作废**：`invalidatePreview()` / `_gen` 防止并发加载竞态

## 对外 API / 入口

- `mount3D(adapter, path, opts?)` — 主入口，`cleanupPreview()` 旧会话后建新
- `cleanupPreview()` / `invalidatePreview()` / `switchPreview(path)`
- `buildCameraControls(topBar, bridge)` — 通用相机控件（旋转模式/速度/重置）
- 契约接口：`PreviewBuildCtx`（外壳句柄）、`PreviewScene`（内容契约：`update`/`dispose`/`resetCamera`/`extraControls`…）、`PreviewAdapter`（`id`/`mode`/`build`/`onClose`）、`PreviewHandle`、`CameraControlBridge`

## 与其他子系统关系

- **适配器**：`ysm-adapter` / `vrm-adapter`（`GLTFLoader`）/ `mmd-adapter`（`@moeru/three-mmd`）/ `litematic-adapter` 各自实现 `PreviewAdapter`，`build()` 进 `ctx.scene`
- **数据层**：YSM 经 `model3d-loader`（`GetModel3DSpec` 唯一事实来源 + WASM 兜底）；MMD 经 `@moeru/three-mmd`；VRM / Litematic 各加载器
- **旧并行链路**：`model3d.ts` 的 `RenderSession`（ADR-052）仍存在于 `frontend/src/utils/3d/`，其 `renderer-setup.ts:44` 也设纯色背景 `0x1a1b2e`（与核心同款）。新增全局背景/天空须**两处同步**或后续收敛，避免 preview-core 与 RenderSession 视觉分叉

## 不变量

- **shared 模式**：核心创建 `scene` 并设 `scene.background = new THREE.Color("#1a1b2e")`（**`mount-preview-core.ts:346`**）；所有适配器 mount 进同一 `ctx.scene`
- **天空落点**：「改核心层背景」即被全部模型类型**零改动继承**——程序化天空只需升级这一行（→ sky mesh / `ShaderMaterial` / `scene.environment`），YSM / VRM / MMD / Litematic 同时获得。这是「MMD 有天空 → YSM/VRM 自动获得」在 Three 域内的真·自动机制
- **self 模式**（`adapter.mode === "self"`，如个别单例）：核心仅提供外壳、不创建 `scene`，背景由适配器自管

## 相关

- `model3d.md`（RenderSession 旧链路，背景设于 `renderer-setup.ts:44`）
- `app-preview.md`（预览面板组件：2D 骨骼 / 3D / 缩略图）
- 程序化天空落地见本卡「不变量」背景升级点（`mount-preview-core.ts:346` + `renderer-setup.ts:44`）
