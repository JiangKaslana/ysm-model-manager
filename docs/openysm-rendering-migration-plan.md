# OpenYSM Rendering Comparison And Migration Plan

> 状态：对照文档阶段。本文只记录 OpenYSM/OpenYSM 渲染实现与当前 ysm-model-manager 的差异和迁移路线，不代表已经开始迁移核心渲染算法。

## Scope

本轮只读取了 OpenYSM 中和渲染直接相关的源码，刻意避开 `libs`、模型资源包、图片、音频和无关模组文件：

- `refs/OpenYSM/src/main/java/com/elfmcys/yesstevemodel/resource/YSMFolderDeserializer.java`
- `refs/OpenYSM/src/main/java/com/elfmcys/yesstevemodel/resource/YSMClientMapper.java`
- `refs/OpenYSM/src/main/java/com/elfmcys/yesstevemodel/geckolib3/geo/NativeModelRenderer.java`
- `refs/OpenYSM/src/main/java/com/elfmcys/yesstevemodel/geckolib3/geo/IGeoRenderer.java`
- `refs/OpenYSM/src/main/java/com/elfmcys/yesstevemodel/geckolib3/geo/render/built/GeoModel.java`
- `refs/OpenYSM/src/main/java/com/elfmcys/yesstevemodel/geckolib3/geo/render/built/GeoBone.java`
- `refs/OpenYSM/src/main/java/com/elfmcys/yesstevemodel/geckolib3/geo/animated/AnimatedGeoModel.java`
- `refs/OpenYSM/src/main/java/com/elfmcys/yesstevemodel/geckolib3/geo/animated/AnimatedGeoBone.java`
- `refs/OpenYSM/src/main/java/com/elfmcys/yesstevemodel/geckolib3/util/RenderUtils.java`
- `refs/OpenYSM/src/main/native/render.cpp`

当前项目对照范围：

- `go/geometry/parse.go`
- `go/threejs/spec.go`
- `app_model.go`
- `frontend/js/utils/model3d.js`
- `frontend/js/utils/model3d-spec.js`
- `frontend/js/utils/animation.js`
- `frontend/js/utils/animation-player.js`

## OpenYSM Rendering Pipeline

OpenYSM 的渲染分为三层：

1. `YSMFolderDeserializer` 把 Bedrock geometry 解析成 OpenYSM 的 raw geometry，并在解析阶段完成坐标系转换、cube rotation 烘焙、UV 展开。
2. `YSMClientMapper.buildMesh` 把 raw geometry 转成 `GeoModel.BakedBone/BakedCube/BakedQuad`，同时建立 `parentIdx`、`partMask`、`glow`、`cullable`。
3. `NativeModelRenderer.renderModel` 或 native `render.cpp` 按骨骼父子顺序计算骨骼矩阵，再把 baked quad 顶点变换后写入 Minecraft `VertexConsumer`。

关键结论：OpenYSM 不是在渲染端临时拼 cube，它在解析/映射阶段已经把 cube 面烘焙成四边形顶点，渲染阶段只负责骨骼矩阵、可见性、裁切、光照和材质层。

## Current ysm-model-manager Pipeline

当前项目的 3D 预览是：

1. `AnalyzeBedrockModel` 解析 `.ysm/.zip/.7z/.json`，返回 `types.BedrockModel`。
2. `GetModel3DSpec` 调用 `threejs.Build` 生成 Three.js spec。
3. `model3d.js` 加载纹理、创建 bone group、创建 mesh，并用 Three.js `OrbitControls` 显示。
4. JS 兜底 `model3d-spec.js` 与 Go `threejs.Build` 逻辑相似，但不是 OpenYSM 的 baked quad 管线。

当前优点：

- 已经有 Go spec 缓存，避免重复解析。
- 已有按需预览入口，文件夹不会进入 3D 渲染。
- 已有纹理 `flipY=false`、`NearestFilter`、`SRGBColorSpace`。
- 已经有骨骼父子 group 和 mesh local transform。

当前问题：

- `go/threejs/spec.go` 主要继承 YSMViewer/Three.js payload 思路，不等价于 OpenYSM 的 baked quad。
- cube rotation 仍用 mesh local quaternion 表示，而 OpenYSM 在解析阶段把 rotated cube 烘焙到 quad 顶点和法线。
- UV 展开和 face order 与 OpenYSM 不完全一致，尤其 `uv_size` 负值、mirror、up/down 面。
- 动画求值是 JS 角度/位置的粗略传播，没有复刻 OpenYSM 的 12-float per bone `matrixData` 和初始 rotation 混合。
- 透明/裁切目前用 `texIdx > 0` 粗略判断覆盖层；OpenYSM 根据 `isTranslucentTexture(textureIndex)` 选择 translucent 或 cutout render type。
- 相机 framing 主要基于原始 Bedrock cube 高度，和 OpenYSM 的 preview scale、visible bounds、预览动画设置还没有对齐。

## Coordinate System

OpenYSM 在 `YSMFolderDeserializer.parseGeometry` 中做了明确转换：

- Bone pivot: `[-pivot.x, pivot.y, pivot.z]`
- Bone rotation: `[-rad(x), -rad(y), rad(z)]`
- Cube origin:
  - `cx = -origin.x - size.x - inflate`
  - `cy = origin.y - inflate`
  - `cz = origin.z - inflate`
  - `cw/ch/cd = size + inflate * 2`
- 最终 cube 顶点以 Minecraft 单位输出：坐标除以 `16f`。

当前 `threejs.Build` 也有 X 取反和除 16 的意图，但处理时机不同：当前把 cube 作为 mesh local geometry + localPosition + localRotation；OpenYSM 则更早把 cube 位置和旋转一起 baked 到 face vertices。

迁移要求：

- 不再只修某个轴的正负号，先建立与 OpenYSM 一致的 raw-to-baked 坐标转换函数。
- Go 端 spec 应优先输出 baked quad 风格数据，Three.js 只消费顶点、UV、法线、骨骼索引/父子关系。

## Bone Matrices

OpenYSM 骨骼矩阵核心来自 `NativeModelRenderer.calculateBoneMatrix` 和 `RenderUtils.prepMatrixForBone`：

```text
parentMatrix
  translate((pivotX - animTx) / 16, (pivotY + animTy) / 16, (pivotZ + animTz) / 16)
  rotateZ(animRz)
  rotateY(animRy)
  rotateX(animRx)
  scale(animSx, animSy, animSz)
  translate(-pivotX / 16, -pivotY / 16, -pivotZ / 16)
```

注意点：

- rotation 顺序是 Z -> Y -> X。
- animation position X 是减号，Y/Z 是加号。
- scale 全为 0 时会被当作不可见。
- 父骨骼不可见时子骨骼也不可见。
- `GeoBone` 初始 rotation 会写入 `AnimatedGeoBone.matrixData`。

当前项目差异：

- `go/threejs/spec.go` 把骨骼 local position 预计算为 `bonePivot - parentPivot`，再交给 Three.js group。
- Three.js group 的 parent transform 与 OpenYSM 的 per-bone pivot matrix 不完全同构。
- JS 动画传播把父子 rotation/position 粗略相加，不是矩阵求值。

## Static Geometry

OpenYSM 静态几何目标结构是：

- `BakedBone`
  - `parentIdx`
  - `pivotX/Y/Z`
  - `rotX/Y/Z`
  - `partMask`
  - `glow`
  - `cubes[]`
- `BakedCube`
  - `cullable`
  - `quads[]`
- `BakedQuad`
  - `positions[4]`
  - `uvs[4]`
  - `normal`

当前 `MeshData` 是：

- `boneId`
- `localPosition`
- `localRotation`
- flat `positions/normals/uvs/indices`

迁移方向：

- Go 端新增 OpenYSM-style baked spec，不立刻删除旧 spec。
- 第一阶段只让静态模型使用 baked quad positions/normals/uvs，保留当前 Three.js 渲染入口。
- 若静态几何结果稳定，再逐步替换旧 `buildCubeMeshData`。

## UV And Texture Layers

OpenYSM UV 规则：

- 支持 object face UV：`north/south/east/west/up/down`。
- 支持 array box UV，并展开为 face UV。
- `uv_size` 可为负，OpenYSM 不简单取绝对值后完事，而是通过 face 顶点顺序和 mirror 规则影响方向。
- `mirror` 时 east/west 的 UV face name 会互换。
- `face.u = [u0, u1, u1, u0]`，`face.v = [v0, v0, v1, v1]`。
- 纹理坐标除以 geometry `texture_width/texture_height`。

当前项目差异：

- `parseFaceUV` 直接对负 `uv_size` 取绝对值，可能丢失方向信息。
- `expandBoxUV` face order 和 OpenYSM `YSMFolderDeserializer` 的 fake face UV 有差异风险，尤其 `up/down`。
- 贴图层只按纹理数组顺序和 `texIdx` 粗略管理，尚未完整表达 OpenYSM 的 main texture、sub texture、shader suffix texture、extra texture。

## Alpha/Cutout/Translucent

OpenYSM 渲染类型：

- 正常可见实体：
  - translucent texture: `CustomEntityTranslucentRenderType.get(resourceLocation)`
  - otherwise: `RenderType.entityCutoutNoCull(resourceLocation)`
- outline/glow 路径另走 outline。
- `GeoModel.isTranslucentTexture(textureIndex)` 决定某贴图索引是否透明。
- `ysmGlow` 前缀骨骼会强制高亮 light，且 culling 策略有特殊处理。

当前项目：

- `MeshBasicMaterial`。
- main texture: `alphaTest: 0.02`, `DoubleSide`。
- overlay texture: `alphaTest: 0.5`, `BackSide`。

迁移方向：

- 在 spec 中表达 `renderMode: "cutout" | "translucent"`、`glow`、`cullable`、`textureIndex`。
- Three.js 材质按 renderMode 创建，不再只依赖 `texIdx > 0`。
- `ysmGlow` 先以 emissive/高亮材质模拟，避免混入骨骼矩阵迁移。

## Animation Pose

OpenYSM：

- `AnimatedGeoModel` 给每个骨骼分配 12 float：
  - 0..2 rotation
  - 3..5 position
  - 6..8 scale
  - 9 hidden
  - 10 hide children
  - 11 track transform
- `AnimatedGeoBone` 初始化时写入静态 bone rotation 和 scale=1。
- 动画处理器把 keyframe/Molang/controller 结果写入这些 buffer。
- 渲染器每帧从 buffer 计算骨骼矩阵。

当前项目：

- `animation.js` 可以解析部分 Bedrock animation JSON。
- Molang 只做有限常量折叠。
- 父子传播是角度/位置/缩放的近似组合，没有按 OpenYSM 矩阵公式计算。
- 3D renderer 目前没有稳定的 per-frame bone matrix 应用层。

迁移方向：

- 动画阶段单独实现 `bonePoseBuffer`，结构对齐 OpenYSM 12-float。
- 先只支持静态初始 rotation + 简单 numeric keyframes。
- Molang/controller/额外动画按钮后置，不能与骨骼矩阵首迁混在一起。

## Camera And Interaction

OpenYSM 预览相关信息来自 model properties：

- `heightScale`
- `widthScale`
- `previewAnimation`
- `disablePreviewRotation`
- `visible_bounds_width/height/offset`

当前项目：

- 基于原始 cube min/maxY 和 meshMax 推 camera distance。
- 有 Orbit/Self rotation 和 WASD。
- 未使用 visible bounds、heightScale、widthScale、disablePreviewRotation。

迁移方向：

- 第一轮只修 framing：使用 baked geometry bounding box 和 visible bounds。
- 后续再接入 preview animation、disablePreviewRotation。
- 保留当前交互，不因渲染迁移破坏用户熟悉的操作。

## Migration Phases

### Phase 0: Safety Rail

目标：

- 保持文件夹轻量显示。
- 保持显式预览，不允许点击文件自动渲染。
- 保留旧 spec fallback。

验证：

- 点击文件夹只显示 pack/icon/cover。
- 模型只有点预览按钮才进入解析/渲染。

### Phase 1: Static Geometry

目标：

- 在 Go 端新增 OpenYSM-style baked geometry builder。
- 输出 baked quads、normals、uvs、bone parent index/name。
- Three.js 只消费 baked mesh，不改动画。

风险：

- 坐标轴、face winding、culling 会影响模型正反面。
- 需要准备若干典型模型做截图对照。

验证：

- `npm run build`
- `go test ./...`
- `wails build`
- 桌面/移动尺寸截图检查：模型非空、比例正常、无明显镜像。

### Phase 2: Texture/UV

目标：

- 对齐 OpenYSM object UV、box UV、mirror、negative uv_size、up/down face。
- spec 表达 textureIndex/renderMode。
- 材质区分 cutout/translucent/glow/overlay。

风险：

- UV 修复可能让以前“凑巧正确”的模型变化。
- 透明排序在 Three.js 中与 Minecraft 不同，需要谨慎。

验证：

- 透明边缘不发黑。
- 纹理方向和上下左右面正确。
- 多贴图模型不串图。

### Phase 3: Bone Pose

目标：

- 实现 OpenYSM 12-float bone pose buffer。
- 按 OpenYSM 公式在 Three.js 更新骨骼 matrix。
- 初始化 bone rotation 与静态 pose 对齐。

风险：

- 这是核心渲染算法变更，必须切高智能模型后做。
- 任何轴向符号错误都会导致全身错位。

验证：

- 静态 T-pose/站姿稳定。
- 子骨骼跟随父骨骼。
- scale=0 隐藏逻辑不破坏可见模型。

### Phase 4: Animation

目标：

- numeric keyframes 写入 pose buffer。
- 对齐 rotation/position/scale 的符号和单位。
- 后续再处理 Molang/controller/previewAnimation。

风险：

- 当前 JS 动画解析缺少 OpenYSM controller 语义。
- Molang 不可一次性补全。

验证：

- 简单挥手/走路动画与 OpenYSM 方向一致。
- 非循环和循环行为正确。

### Phase 5: Camera And Interaction

目标：

- 使用 visible bounds 和 baked bounding box framing。
- 接入 `disable_preview_rotation`、`heightScale`、`widthScale`。
- 保留用户现有 Orbit/Self/WASD 操作。

验证：

- 大小模型进入视窗稳定。
- 宽屏、窄屏、全屏都不裁头/裁脚。

## Required Stop Points

完成本文档后必须停下等确认。

开始迁移 OpenYSM 核心渲染算法前，必须提醒用户切到高智能模型。

准备改骨骼矩阵、UV、动画系统前，必须再次停下确认。

每完成一个可编译阶段，必须运行：

```powershell
npm run build
go test ./...
wails build
```

## Initial Recommendation

下一步建议只做 Phase 1 的准备工作：

- 新增一个 `go/threejs/openysm_baked.go` 或类似文件，先并行输出新 spec。
- `model3d.js` 增加 feature flag 或自动检测 `spec.version === "openysm-baked"`。
- 默认仍使用旧 spec，直到 screenshot/构建验证稳定。

这样可以让旧渲染路径随时兜底，避免一次大改把预览功能打穿。
