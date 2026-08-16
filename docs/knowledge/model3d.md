---
kind: model3d
name: 3D 预览渲染 model3d
tier: architecture
category: utils
source_files:
  - frontend/src/utils/3d/model3d.ts
  - frontend/src/utils/3d/render-session.ts
  - frontend/src/utils/3d/mesh.ts
  - frontend/src/utils/3d/keymap.ts
  - frontend/src/utils/3d/debug-render.ts
  - frontend/src/utils/3d/camera-control.ts
  - frontend/src/utils/3d/bone-raycast.ts
  - frontend/src/utils/3d/cube-mesh.ts
  - frontend/src/utils/3d/model-group-builder.ts
  - frontend/src/utils/3d/quaternion.ts
  - frontend/src/utils/3d/spec-builder.ts
  - frontend/src/utils/3d/bone-list.ts
  - frontend/src/utils/3d/bone-visibility.ts
  - frontend/src/utils/3d/camera-setup.ts
  - frontend/src/utils/3d/cleanup-helper.ts
  - frontend/src/utils/3d/mesh-builder.ts
  - frontend/src/utils/3d/render-loop.ts
  - frontend/src/utils/3d/renderer-setup.ts
  - frontend/src/utils/3d/scene-lights.ts
  - frontend/src/utils/3d/session-state.ts
  - frontend/src/views/app-preview/model3d-loader.ts
  - frontend/src/utils/3d/model3d-spec.ts
tests:
  - frontend/src/utils/3d/model3d-spec.test.ts
use_when:
  - 3D 预览
  - Three.js
  - 相机
  - 骨骼渲染
  - 自由相机
  - 3D 截图
  - 纹理加载
  - spec 兜底
  - OrbitControls
invariant_anchors:
  - frontend/src/utils/3d/render-session.ts|RenderSession
  - frontend/src/utils/3d/cube-mesh.ts|computeBoneLocalPos
  - frontend/src/views/app-preview/model3d-loader.ts|specCache
---

# 3D 预览渲染 model3d

## 概览

前端 Three.js 3D 渲染层（`frontend/src/utils/3d/`），采用 **RenderSession 对象化架构**（ADR-052 落地）。核心入口 `renderModel3D()` 现为薄壳，实际逻辑在 `RenderSession` 类中。每个 3D 预览实例独立封装场景、相机、渲染器、控制器，消除模块级状态覆盖竞态。

**文件按层分组**：

| 层 | 文件 | 职责 |
|----|------|------|
| **场景/会话层**（核心，ADR-052） | `render-session.ts` / `session-state.ts` / `model3d.ts` / `cube-mesh.ts` | RenderSession 类 + 会话状态 + 薄壳入口 + 坐标口径工具 |
| **渲染管线层** | `renderer-setup.ts` / `render-loop.ts` / `camera-setup.ts` / `scene-lights.ts` / `cleanup-helper.ts` | 场景初始化 → 渲染循环 → 相机定位 → 灯光配置 → 资源释放 |
| **骨骼/几何层**（最大层） | `mesh.ts` / `mesh-builder.ts` / `cube-mesh.ts` / `model-group-builder.ts` / `bone-list.ts` / `bone-visibility.ts` / `bone-raycast.ts` | 骨骼组树构建 → 立方体几何 → mesh 合并 → 骨骼列表/可见性 → 射线拾取 |
| **工具/辅助层** | `quaternion.ts` / `debug-render.ts` / `keymap.ts` / `model3d-spec.ts` | 四元数工具 / debug 叠加 / 键位偏好 / 历史 JS spec 兜底（已废弃） |
| **加载/桥接层** | `model3d-loader.ts` / `spec-builder.ts` | 纹理 + spec 预加载（Go binding 桥接） / spec 构建工具 |

> **ADR-072 前瞻**：当前内容适配器（ysm/vrm/litematic/mmd）混在 `app-preview/` 目录。ADR-072 已拍板下沉到 `utils/3d/adapters/`，落地后本卡将拆分适配器子卡，`app-preview.md` 同步瘦身。

几何数据（顶点/法线/UV/骨骼四元数）全部由 Go 端 [go_threejs](./go-threejs.md) 预计算，本层只渲染、不做几何计算。

## 快速导航

| 你想找什么 | 跳到 |
|-----------|------|
| RenderSession 架构 / 多实例隔离 | [§ 场景/会话层](#场景会话层-adr-052) + [§ 多实例隔离](#多实例隔离-adr-052-核心收益) |
| 渲染循环 / 相机 / 灯光 / 材质 | [§ 渲染管线层](#渲染管线层) + [§ 渲染循环与交互](#渲染循环与交互) |
| 骨骼组树 / mesh 合并 / 拾取 | [§ 骨骼/几何层](#骨骼几何层) |
| 坐标口径 / X 轴翻转 / trap #11 | [§ 坐标口径工具](#坐标口径工具) + [不变量](#不变量) |
| 对外 API / 加载入口 | [§ 加载/桥接层](#加载桥接层) + [对外 API / 入口](#对外-api--入口) |
| 废弃兜底 spec | [§ 工具/辅助层](#工具辅助层) |

### RenderSession 类

```typescript
class RenderSession {
  // 场景对象（实例字段，替代原模块级 _scene3d/_camera3d 等）
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  readonly container: HTMLElement;
  readonly rootGroup: THREE.Group;
  
  // 会话状态（11 个可变状态收敛进实例）
  readonly state: RenderSessionState;
  
  // 生命周期
  dispose(): void;        // 完整资源释放
  cleanup(): void;        // 兼容别名
  screenshot(): string | null;  // 截图功能
  
  // 控制接口
  resetCamera(): void;
  setSpeed(v: number): void;
  setRotationMode(orbit: boolean): void;
  setBoneVisible(name: string, visible: boolean): void;
  getBoneList(): Array<{...}>;
  toggleBone(name: string): void;
  showModelGroup(idx: number): void;
  getModelGroupCount(): number;
  setDebugMode(mode: "normal" | "pivot" | "bone"): void;
}
```

### 坐标口径工具

```typescript
// cube-mesh.ts 导出，统一骨骼位置计算（ADR-052 P3）
export function computeBoneLocalPos(
  bonePivot: Vec3,
  parentPivot: Vec3 | null
): [number, number, number]
```

公式（对齐 YSMViewer/C# ConvertBones）：
- 有父骨骼：`[parent.x - bone.x, bone.y - parent.y, bone.z - parent.z]`
- 无父骨骼：`[-bone.x, bone.y, bone.z]`

**X 轴翻转是 ysmview 口径关键特征**（trap #11 反复修的根源）。

## 渲染管线层

**职责**：从场景初始化到渲染循环的完整执行链。`renderer-setup.ts` 创建 `WebGLRenderer` + `Scene` + `PerspectiveCamera`（45° FOV）→ `camera-setup.ts` 定位相机到 Z 负侧（`camera.position.set(0, 80, -120)`，`controls.target(0, 80, 0)`，模型脸朝 Z-）→ `scene-lights.ts` 配置环境光 + 双方向光（`addStandardSceneLights`，快消批收敛自 3D 灯光样板）→ `render-loop.ts` 启动 `requestAnimationFrame` 主循环。

**渲染循环与交互**：
- 默认 OrbitControls 轨道模式，`setRotationMode(false)` 切自由相机（WASD 平移 + 空格/Shift 升降）
- **3D 操作键位 / 相机偏好持久化**（localStorage）：键位存 `KeyboardEvent.code` 物理键，相机速度 `td-cam-speed`（2–200，默认 20），旋转模式 `td-rot-mode`（orbit/free）
- **材质为 ysmview 风格**：`FrontSide + transparent + alphaTest:0.1 + depthWrite:true`
- **debug 叠加层**（`debug-render.ts`）：`setDebugMode("normal"|"pivot"|"bone")` 循环切换，`rebuildDebug()` 重建叠加层
- **cleanup**（`cleanup-helper.ts`）：资源释放工具，遍历子对象并调用 `geometry/material/texture` 的 `dispose()`，确保 WebGL 资源完全释放

## 骨骼/几何层

**职责**：骨骼层级组树构建 + 立方体几何生成 + mesh 合并 + 骨骼交互。

- **骨骼组树**：`model-group-builder.ts` 的 `buildModelGroup` 递归构建骨骼 Group 树，`mesh.ts` 的 `buildSceneMesh` 组装完整场景；同一骨骼下按 `boneId + ":" + texIdx` 分组，同组多个 MeshGroup 合并顶点/法线/UV/索引减少 draw call
- **立方体几何**：`cube-mesh.ts` 的 `computeBoneLocalPos` + `buildCubeGeometry` 生成单个 cube 顶点/法线/UV（**坐标口径见上方坐标口径工具**）
- **单个 mesh**：`mesh-builder.ts` 的 `addMeshToBoneGroup` 构造单个 Mesh 并挂到骨骼 Group
- **骨骼交互**：`bone-raycast.ts` 用 `Raycaster.setFromCamera` + `intersectObjects` 做骨骼拾取，命中时组装 `BoneSelectInfo` 调 `handle.onBoneSelect`；`bone-list.ts` / `bone-visibility.ts` 分别维护骨骼列表与可见性切换（`setBoneVisible` / `toggleBone` / `showModelGroup`）
- **四元数**（`quaternion.ts`）：骨骼旋转的 `localRotation` 四元数 `[x,y,z,w]` 工具函数

## 工具/辅助层

- `keymap.ts` — 键位/相机偏好持久化（`loadTdKeymap` / `loadTdCamSpeed` / `loadTdRotMode`）
- `debug-render.ts` — debug 叠加层渲染（pivot 标记 / 骨骼线框）
- `model3d-spec.ts` — **历史 JS 兜底 spec 构建（已废弃不消费）**：与 Go `threejs.Build()` 口径不一致（cubePivot/cubeOrigin 不做 X 取反），保留仅作测试参考。`fetchSpec` 在桌面通道空 models throw，`buildSpecFromModel` 全项目无调用方

## 加载/桥接层

**`model3d-loader.ts`**：
- `loadTextures(urls?): Promise<(THREE.Texture | null)[]>` — 并行加载，`flipY=false` + `NearestFilter` + `SRGB`；**null 占位不压缩索引**（全失败时返回 null 占位数组而非空数组）
- `preloadModel(model): Promise<{ texArr, spec }>` — 纹理 + spec 并行预加载；内部 `fetchSpec` 走 Go `GetModel3DSpec` binding（模块级 `specCache` LRU 缓存上限 20）；Android/网页 viewer 模式降级 WASM 解码兜底（`fetchSpecViaWasmFallback` + `buildSpecFromModel`）
- `spec-builder.ts` — spec 构建工具（WASM 兜底通道，含 `thicknessEpsilon` 零厚度面修正）

**桥接方向**：Go `GetModel3DSpec` ← [go_threejs](./go-threejs.md) `threejs.Build()` → `model3d-loader.ts` `fetchSpec` → `RenderSession` 渲染。纹理/模型对象来自 [go_geometry](./go-geometry.md)。

## 对外 API / 入口

`model3d.ts`：
- 类型：`Spec3D` / `SpecModelGroup3D` / `SpecBone3D`（localPosition/localRotation 四元数 [x,y,z,w]/parentId）/ `SpecMeshGroup3D`（positions/normals/uvs/indices/texIdx）/ `BoneSelectInfo` / `RenderModel3DHandle`（类型别名 → RenderSessionHandle）
- `renderModel3D(container, texArr, spec, texIdx=0): Promise<RenderSessionHandle>` — 渲染主入口（薄壳，实际创建 RenderSession 实例）
- `screenshotPreview(): string | null` — 截取当前画面（兼容层，多实例场景需传 session 引用）

`RenderSession` 实例方法：
- `dispose()` / `cleanup()` — 完整资源释放（cancelAnimationFrame、移除监听器、dispose renderer/controls/geometry/material）
- `screenshot()` — 返回 PNG base64（无 data: 前缀）
- `resetCamera()` / `setSpeed()` / `setRotationMode()` — 相机控制
- `setBoneVisible()` / `getBoneList()` / `toggleBone()` / `showModelGroup()` — 骨骼/组件控制
- `setDebugMode()` — 调试模式切换（normal/pivot/bone）
- `onBoneSelect` — 骨骼选中回调（getter/setter）

`model3d-loader.ts`：
- `loadTextures(urls?): Promise<(THREE.Texture | null)[]>` — 并行加载，`flipY=false` + `NearestFilter` + `SRGB`；**null 占位不压缩索引**
- `preloadModel(model): Promise<{ texArr, spec }>` — 纹理 + spec 并行预加载；内部 `fetchSpec` 走 Go `GetModel3DSpec` binding（模块级 `specCache` LRU 缓存上限 20）；Android/网页 viewer 模式降级 WASM 解码兜底

## 多实例隔离（ADR-052 核心收益）

| 维度 | Before（模块级） | After（RenderSession） |
|------|-----------------|----------------------|
| 场景对象 | `_scene3d` 全局覆盖 | `this.scene` 实例字段 |
| 相机 | `_camera3d` 全局覆盖 | `this.camera` 实例字段 |
| 渲染器 | `_renderer3d` 全局覆盖 | `this.renderer` 实例字段 |
| 状态 | `_rafIdGuard` 共享 | `state.rafId` 独立 |
| 监听器 | `_sessionCleanups` 共享 | `this.cleanups` 独立 |
| 截图 | `screenshotPreview()` 用全局 | `session.screenshot()` 用实例 |

**关键场景**：同时打开 2-3 个模型预览面板，各面板相机/渲染状态互不干扰。

## 与其他子系统关系

- 消费方：`app-preview/skeleton.ts`（调用 renderModel3D 创建 session）、`utils/screenshot-renderer.ts`（复用 buildSceneMesh + loadTextures 做离屏多角度截图）
- 上游数据：Go `GetModel3DSpec` binding ← [go_threejs](./go-threejs.md) `threejs.Build()`；纹理/模型对象来自 [go_geometry](./go-geometry.md)

## 不变量

- **致命陷阱 #11**：3D 坐标变换是全项目 fix 次数最多的区域（model3d.ts 历史 fix 第一）。坐标口径必须对齐 YSMViewer：pivot X 取反、`from.x = origin.x - size.x`（Go go/threejs 实现）。**消费侧（buildSceneMesh/renderModel3D）直接透传 Go 坐标，不再二次翻转**；JS 兜底 model3d-spec.ts 的 cubePivot/cubeOrigin **不做 X 取反、与 Go 口径不一致**（已废弃无运行时影响）。改 model2d/model3d/threejs spec 前先 grep `docs/archive/bug-chronicle.md`，改完用自由相机近距验证
- `dispose()` 必须完整执行：cancelAnimationFrame、移除 keydown/keyup/pointer/resize/fullscreenchange 全部监听（Pointer Events 迁移，ADR-047）、dispose controls/renderer/geometry/material、清空容器 —— 缺一即泄漏
- **Three.js 资源 dispose 模式**：移除 `Object3D` 时，`Object3D.remove()` 只从场景图移除引用，**不释放底层 WebGL 资源**。必须遍历子对象并调用 `geometry?.dispose()`、`material?.dispose()`、`texture?.dispose()`
- 几何计算（顶点/UV/四元数）在 Go 端完成，前端不得私改几何口径；JS 兜底算法（model3d-spec.ts）已废弃，不再承担降级职责
- 治理红线 R1：模块级状态不挂 `window.__*`（ADR-052 已消除模块级场景状态）

## 相关

- [ADR-052](../adr/ADR-052-render-session-objectification.md) — RenderSession 对象化决策
- [ADR-040](../adr/ADR-040-architecture-scale-governance.md) — 架构治理（拆分基准）
- [ADR-047](../adr/ADR-047-android-usability-plan.md) — Pointer Events 统一
- [go-threejs](./go-threejs.md) — spec 生成（Go 端）
- [model2d](./model2d.md) — 2D 预览（同一坐标口径约束）
- [app_preview](./app-preview.md) — 预览面板消费方
- `frontend/src/utils/3d/render-session.ts` — RenderSession 实现
- `frontend/src/utils/3d/cube-mesh.ts` — computeBoneLocalPos 工具
