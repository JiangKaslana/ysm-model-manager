---
kind: app-preview
name: 预览面板 app-preview
tier: architecture
category: ui
source_files:
  - frontend/src/views/app-preview/index.ts
  - frontend/src/views/app-preview/tpl.ts
  - frontend/src/views/app-preview/loader.ts
  - frontend/src/views/app-preview/detail.ts
  - frontend/src/views/app-preview/skeleton.ts
  - frontend/src/views/app-preview/skeleton-render.ts
  - frontend/src/views/app-preview/skeleton-utils.ts
  - frontend/src/views/app-preview/zoom.ts
  - frontend/src/views/app-preview/wasm.ts
  - frontend/src/views/app-preview/litematic-3d.ts
  - frontend/src/views/app-preview/litematic-meta.ts
  - frontend/src/views/app-preview/cache.ts
  - frontend/src/views/app-preview/model3d-loader.ts
  - frontend/src/views/app-preview/screenshot-renderer.ts
  - frontend/src/views/app-preview/geometry.ts
  - frontend/src/views/app-preview/utils.ts
  - frontend/src/views/app-preview/css.ts
  - frontend/src/views/app-preview/bone-names.ts
  - frontend/src/views/app-preview/parse-ysm-json.ts
  - frontend/src/views/app-preview/texture-order.ts
  - frontend/src/views/app-preview/skeleton-fill-panel.ts
  - frontend/src/views/app-preview/mount-preview-core.ts
  - frontend/src/views/app-preview/litematic-adapter.ts
  - frontend/src/views/app-preview/vrm-3d.ts
  - frontend/src/views/app-preview/vrm-adapter.ts
  - frontend/src/views/app-preview/ysm-3d.ts
  - frontend/src/views/app-preview/ysm-adapter.ts
  - frontend/src/views/app-preview/ysm-controls.ts
tests:
  - frontend/src/views/app-nav/index.test.ts
  - frontend/src/views/app-preview/utils.test.ts
  - frontend/src/views/app-preview/component.test.ts
  - frontend/src/views/app-resource-manager/index.test.ts
  - frontend/src/views/app-sidebar/loader.test.ts
  - frontend/src/views/app-sync-manager/index.test.ts
  - frontend/src/views/app-toast/index.test.ts
  - frontend/src/utils/dom/feedback.test.ts
  - frontend/src/views/context-menu/index.test.ts
use_when:
  - 预览
  - 模型预览
  - 2D 骨骼
  - 3D 预览
  - Litematic
  - 蓝图
  - 缩略图
  - WASM 解码
  - 放大预览
invariant_anchors:
  - frontend/src/views/app-preview/index.ts|_previewGen
---

# 预览面板 app-preview

## 概览

`app-preview` 是仓库页右侧的预览面板组件（Shadow DOM），负责 YSM 模型的详情/2D 骨骼/3D 预览、Litematic 蓝图 3D 预览、资源包与光影包信息展示。它按 `model:select` 事件驱动，解码链路为「缓存 → 前端 WASM → Go 兜底」。组件由 `app-content` 顶部副作用**静态**导入完成注册（`app-content/index.ts:34`，原动态 import 预加载方案已废弃）。

## 核心职责

- `index.ts` — `<app-preview>` 生命周期编排：监听 `model:select`（回调开头 `++this._previewGen`）、目录走 `_showPackInfo`、文件走 `_showModelDetail` 并按 `DetectResourceType` 结果分流（pack → `showResourcePack`；ysm/空 → `showModelDetail`；litematic/blueprint → `showLitematic`；vrchat-avatar `.vrm` → `showVrmMeta`（meta 卡 + FAB 进 3D，对齐 YSM 模式）；shaderpack → `showShaderpack`（`ReadShaderpackLang` 提显示名+配置简介）；mmd-skin 等其他已知类型 → `showSimplePreview`；类型元信息经 `_typeMeta` 查 `LoadResourceTypes` 预载表）、`_loadPreviewImage` 缩略图三级加载、`cacheSetEvictHandler` 注册缓存淘汰时回收 blob URL（含 `geometry.textures` / `authors[].avatarUrl` / `avatars` 去重后 revoke）
- `loader.ts` — `loadModelData`：统一模型加载（缓存 → WASM → Go `AnalyzeBedrockModel` 兜底）；**ADR-066 P0 解硬编码墙**：WASM 能力判定由内联正则 `/\.(ysm|zip|json)$/i` 改为 `matchTypeByExt(modelPath, RESOURCE_TYPES.YSM)`（注册表驱动，附带修复原正则漏判 `.7z`）
- `detail.ts` — `showModelDetail` / `showResourcePack` / `showShaderpack` / `showSimplePreview` / `showVrmMeta`：详情面板渲染（Go 侧 `ExtractYsmSummary` / `ExtractYSMHeader` / `ReadPackMeta` / `ReadShaderpackLang`；VRM meta 卡经 `vrm-adapter.readVrmMeta` 取 three-vrm `vrm.meta`：VRM0 `title/author/licenseName` ↔ VRM1 `name/authors/licenseUrl` 归一化 + 缩略图 dataURL，FAB 点击 `createVrm3D` 进 3D）
- `skeleton.ts` — `loadModel2D`：2D/3D 骨骼渲染编排，委托 `utils/3d/model2d.ts` 的 `renderModel2D` 与 `utils/3d/model3d.ts` 的 `renderModel3D`；window 级拖拽监听存模块级 `_prevWindowMove` / `_prevWindowUp` 槽位（`skeleton.ts:20`、`:193`），先移除上一轮再绑定并把移除逻辑 push 进 `ctx._unsubs`（`skeleton.ts:211`）；`_model3dGen` 作废在途 3D 渲染；截图走 `SaveScreenshotFile`。**ADR-057 控制层重构**：3D overlay 顶/底控制栏原内联 `style.cssText` 抽为全局 CSS 类（`utils/dom/fab.ts` 的 `ensureFabStyles()` 注入 head——overlay 挂 `document.body` 为 light DOM，全局 CSS 直接生效）；触发键 `🎨3D` 由面板内普通 tab 改为右下角悬浮 FAB（`.ysm-fab`，Shadow DOM 内样式在 `css.ts`，隔离不继承 head）；并接入 `registerAndroidBackHandler` 在 overlay 打开时消费安卓返回键关层。**async 窗口期守卫约定**（P2 修复）：每个 `await` 前后及 DOM 创建后立即检查 `container.isConnected`，防组件卸载后异步回调写入已卸载 DOM（`skeleton.ts:82`、`:112`、`:631` 三处）
- `zoom.ts` — `openFullPreview`：全屏放大预览
- `wasm.ts` — `decodeYsmViaWasm`：前端 WASM 解码 .ysm（经 Go `ReadFileBytes` 取字节，走 `cache.ts` 缓存）；**加密模型详情增强**（P2 修复链：`decodeYsmViaWasm` 解码后把 `properties.extra_animation*` 经 `utils/format/ysm-anim-config.ts` 的 `extractAnimGroupsAndConfigs` 抽出「其他动画 / 模型配置 / 自定义表情」，与 Go `summary.go:appendAnimGroupsAndConfigs` 口径对齐，供详情卡渲染；`.zip`/裸 `ysm.json` 共用同一提取逻辑）
- `litematic-3d.ts` — `createLitematic3D` / `cleanupVoxel3D`：**ADR-066 P3 脚手架收缴**——原 627 行内联实现抽为 26 行薄包装：通用外壳（overlay/renderer/rAF 循环/相机控制/资源释放）归 `mount-preview-core.ts` 的 `mount3D(adapter, path)`（PreviewAdapter 契约），体素内容层归 `litematic-adapter.ts` 的 `buildLitematicScene`；`voxelFn` 经适配器工厂传入决定走哪条 Go RPC；vrm 预览同构迁移（`vrm-adapter.ts`）
- `litematic-meta.ts` — `showLitematic`（Go `ReadLitematicMeta` / `ReadNbtStructure` / `ReadSchematic`）与 `cleanupLitematic3D`（转发 `cleanupVoxel3D`）
- `utils.ts` — 共享类型与工具：`PreviewCtx` 接口、`DecodedYsm`、`getPrefer3D` / `setPrefer3D`（跨模型保留 3D 偏好）、`stripYsgpTextHeader`（YSGP 文本变体转标准头，内部私有 `buildStdYsgpFromTextVariant`）、`devLog`
- `geometry.ts` — 纯函数层：`BedrockCube` / `BedrockBone` / `BedrockGeometry` 类型 + `parseBedrockGeometryFromJSON`
- `model3d-loader.ts` / `screenshot-renderer.ts` — 3D 规格加载（Go `GetModel3DSpec`）与多角度截图渲染（`renderMultiAngle`），均静态依赖 three
- `cache.ts` — 模块级预览缓存：`cacheGet` / `cacheSet` / `cacheSetEvictHandler` + `CacheValue`
- `tpl.ts` — `modelDetailHTML`（详情面板）/ `statsCardHTML`（模型概览卡片）
- `css.ts` — Shadow DOM 样式表 `previewCSS`（adoptedStyleSheets）
- `bone-names.ts` — `buildBoneNamesText(modelPath, boneCount, bones)`：构建「📋 导出骨骼名」文本行；`interface BoneEntry` 兼容 `DecodedYsm.bones` 元素（纯函数层，ADR-023 L3）
- `parse-ysm-json.ts` — `parseYsmJsonDirect(json)`：解压后 YSM 的 `ysm.json` 直接解析，不依赖 WASM/IO；双格式分支——YSM 专属格式（`spec`+`files`）提取模型/纹理清单并将 `default_texture` 置首（R1 契约），标准 Bedrock 格式映射 bones/cubes 字段；向量/数值守卫防畸形 JSON（ADR-044 ②）
- `texture-order.ts` — `buildOrderedTexKeys(input)`：纹理有序列表计算；有 `ysmTexOrder` 按声明序匹配 `matchTexKey`，`ysmDefaultTex` 置首；无声明序按 `areaOf` 降序；三处消费方（本文件、`wasm.ts orderedTexKeys`、Go `AnalyzeBedrockModel`），口径与 `internal/app/texture_order.go` 严格对称

## 对外 API / 入口

- 自定义元素：`<app-preview>`
- 监听 bus：`model:select`（`{ path, isDir }`；目录走整合包信息 `GetPackInfo`，文件走类型分流）
- 派发 bus：`toast:show`（仅子模块的加载失败路径：`litematic-3d.ts:580` 体素 3D 加载失败、`skeleton.ts:812` 3D 预览加载失败）；`index.ts` 本身不 emit
- Go 调用（经 `getApp()`）：`index.ts` 的 `DetectResourceType` / `FindPreviewImage` / `ExtractPreviewTexture` / `LoadResourceTypes` / `GetPackInfo`；子模块的 `AnalyzeBedrockModel`（loader）、`ExtractYsmSummary` / `ExtractYSMHeader` / `ReadPackMeta` / `ReadShaderpackLang`（detail）、`ReadFileBytes`（wasm）、`ReadLitematicMeta` / `ReadNbtStructure` / `ReadSchematic`（litematic-meta）、`GetLitematicVoxelData` 等体素函数（litematic-3d）、`GetModel3DSpec`（model3d-loader / screenshot-renderer）、`SaveScreenshotFile`（skeleton）
- 子模块入口：`loadModelData` / `loadModel2D` / `openFullPreview` / `decodeYsmViaWasm` / `createLitematic3D` / `cleanupVoxel3D` / `showLitematic` / `cleanupLitematic3D` / `showModelDetail` / `showResourcePack` / `showShaderpack` / `showSimplePreview` / `preloadModel` / `renderMultiAngle`

## 与其他子系统关系

- 由 `app-content/index.ts:34` 顶部副作用静态导入完成注册，仓库页模板直接放置 `<app-preview>` 元素（见知识卡 `app_content`）
- `model:select` 派发方为 `app-tree` 节点点击与诊断页去重定位（见知识卡 `app_tree`）
- 2D/3D 骨骼计算委托 `frontend/src/utils/3d/model2d.ts` / `utils/3d/model3d.ts`，动画解析走 `utils/animation/animation.ts`
- Litematic/schematic 解析对应 Go 端 `go/litematic`；该包的 `extractBits` 对损坏或截断文件已加 `longIdx` 越界守卫（`go/litematic/nbt.go`，42d1839），前端 `litematic-3d.ts` 只做「体素数据为空」的空态兜底，不重复校验位宽（见知识卡 `go_litematic`）
- WASM 解析口径与 Go 端 `go/ysm` 一致（YSMViewer 算法口径）；缓存层为 `frontend/src/views/app-preview/cache.ts`
- 组件实例实现 `PreviewCtx` 最小接口，子模块只依赖该接口，不反向引用组件全貌

## 不变量

- `model:select` 回调进入即 `++_previewGen`；`_showModelDetail` / `_showPackInfo` 在每个 `await` 之后必须 `if (gen !== this._previewGen) return`（`index.ts:171` / `:210`，**catch 分支同样必须比对**——P2 修复：`_showPackInfo` 的 catch 原无守卫，A 目录失败迟到会覆盖已切换的 B 预览），否则慢条目 A 的迟到结果会覆盖已切换的 B 的预览（与 `app-sidebar._reloadGen`、`app-sync-manager._gen` 同模式）
- **`showLitematic` 有独立模块级代际 `litematicGen`**（P2 修复：原无任何守卫，await Go 解析期间切模型时慢结果写进新模型的 `#preview-detail` 跨污染；现 await 后与 catch 分支均比对）
- `_unsubs` 中的 `bus.on` 订阅必须在 `disconnectedCallback` 清理；拖拽 window 监听经 `PreviewCtx._unsubs` 挂销毁清理；Litematic 3D 经 `cleanupLitematic3D`（转发 `cleanupVoxel3D`）终止 WebGL renderer + rAF 循环（防切页 GPU 残留）
- 2D 拖拽的 window 监听先移除上一轮再绑定（模块级槽位 `_prevWindowMove` / `_prevWindowUp`），禁止累积
- 预览缓存淘汰时必须 `URL.revokeObjectURL` 释放 blob URL（`cacheSetEvictHandler`）
- Three.js 现为静态依赖（`litematic-3d.ts` / `model3d-loader.ts` / `screenshot-renderer.ts` / `utils/3d/model3d.ts` 均 `import * as THREE from "three"`），且 `app-preview` 已被 `app-content` 静态导入，因此 three 进入主 chunk；vite 未配 `manualChunks`，若要恢复懒加载需同时改回动态 import 与分包配置
- 坐标变换遵循 ysmview 口径（陷阱 #11：改 model2d/model3d 前先 grep bug-chronicle）
- **纹理口径对称**：`texture-order.ts` 与 Go `internal/app/texture_order.go` 口径严格对称，改一侧须同步另一侧；`default_texture` 置首逻辑在 `parse-ysm-json.ts`（返回 `_ysmMeta.defaultTexture`）与 `texture-order.ts`（实际排序）两处协同处理
- **3D 预览布局**：渲染器全屏（`viewContainer` `position:absolute;inset:0`），信息面板为右侧浮层（`panel` `absolute;right:0;top:0;bottom:0`，`z-index:5`），顶部栏「◀ 隐藏 / ▶ 显示」切换显隐、左缘拖拽柄（`resizeHandle` 挂 body，`z-index:6`，`right` 随宽同步）调宽——浮层不占 flex 位，隐藏时渲染器天然填满，竖屏/窄窗口友好
- **3D overlay 单例钩子**（skeleton.ts 模块级 `_active3DClose`）：全局同时只允许一个活跃 3D overlay——新开 3D 前先调上一份的 `_active3DClose`（`keepPrefer=true` 保留 `_prefer3D`，仅切换模型路径）；用户主动关闭/ESC/组件销毁（走 `close3D` 默认 `keepPrefer=false`）才清 `_prefer3D` 并置空引用，防残留。**`model:select` 切换前同样先关闭活跃 3D overlay**（2026-08-12 修复：切模型时旧 3D 不关闭会与新渲染叠加冲突）。**onClose 区分主动关闭与切模型**（2026-08-16 回归 `b2fafea6`）：切模型路径先置 `_active3DClose=null`，onClose 据此判断——用户主动关闭（ESC/✕/返回键）清 `_prefer3D`，切模型保留（P3 曾误改统一保留导致退出 3D 后点资源仍自动弹全屏）
- **3D 控件文件层级（ADR-066 §5.6 方案 A + §5.7 查看器范式）**：相机控件（旋转/速度/重置）统一下沉 `mount-preview-core.ts` 的 `buildCameraControls`（shared/self 双模式复用）；YSM 专属控件集中于 `ysm-controls.ts`，**§5.7 起为「底部悬浮导航 + 分类弹窗」**（`buildYsmBottomNav`，对齐 MikuMikuAR 玻璃 HUD）：3D 全屏沉浸、无常驻侧栏——底部毛玻璃导航「🧍 模型 / 🎥 视图」按域分组，点击弹出 280px 毛玻璃弹窗（模型菜单 = 统计/纹理/骨骼列表/骨骼详情/多组件切换，复用 `fill3DPanel`；视图菜单 = `buildCameraControls` + 截图），用完即关；截图属视图域子项不当根菜单。`ysm-adapter.ts` 瘦身为「内容构建 + 装配」；旧 `skeleton-render.ts` 的 `build3DOverlay` 死代码已删（YSM 3D 走 `createYsm3D` → `mount3D`）。**overlay ✕ 关闭按钮绑定 `close3D`** 的历史修复（2026-08-16 `af260361`）仍有效——该绑定在 skeleton.ts `_toggle3D` 内，与 build3DOverlay 删除无关

## 相关

- `frontend/src/utils/3d/model2d.ts` / `utils/3d/model3d.ts` — 2D/3D 骨骼渲染与计算
- `frontend/src/views/app-preview/cache.ts` — 模块级预览缓存（跨组件生命周期持久）
- `frontend/src/wasm/` — WASM 生成数据（base64 豁免文件）
- 知识卡：`app_content`、`app_tree`、`go_ysm_parser`、`go_litematic`、`event_bus`、`pointer-events`（双端响应式触控热区）
- ADR-057（3D 预览悬浮触发按钮与双端响应式控制层）；`frontend/src/utils/dom/fab.ts` — FloatingActionButton 组件与全局样式注入
