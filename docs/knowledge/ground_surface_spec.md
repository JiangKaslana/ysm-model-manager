---
kind: ground_surface_spec
name: 地面材质 spec 单一事实源 ground-surface-spec
tier: leaf
category: utils
source_files:
  - frontend/src/utils/3d/caps/ground-surface-spec.ts
  - frontend/src/utils/3d/caps/ground-capability.ts
use_when:
  - 地面材质 / 地面贴图 / 地板 / surface
  - 材质重建与原地更新的判别（needsRebuild）
  - 程序化纹理生成（grid/checker/solid 像素）
  - 自定义图片上传到地面（TextureLoader）
  - GroundMaterialSpec / specKey / textureToken
---
# 地面材质 spec 单一事实源 ground-surface-spec

## 概览

ADR-117：GroundCapability 的表面材质层（`ysm-ground-surface`，y=0.005 介于网格 y=0 与水面 y=0.01）。架构移植自 MikuMikuAR ADR-226「GroundMaterialSpec 单一事实源」精髓——**spec 是唯一数据源**，所有下游（重建判别、材质落地、纹理密度）只从 `buildGroundSurfaceSpec()` 的产物取值，杜绝双路径手写平行逻辑。

扁平 mode 枚举 `"none"|"solid"|"plain"|"grid"|"checker"|"texture"`：单字段表达来源+样式组合，避免双字段耦合守卫坑。CPU 像素生成（Uint8Array→DataTexture）对齐既有 generateNormalMap 口径，node 可测。

## 核心职责

- **buildGroundSurfaceSpec(params, textureToken)** → `{ structural:{mode,color,lineColor,gridSize,textureToken}, appearance:{opacity,textureScale,rotationRad,roughness,metalness} }`
- **surfaceSpecKey(spec)**：structural 子集 JSON.stringify 固定字段序确定性序列化；新增结构性字段在此补一行即自动纳入重建判别
- **groundSurfaceNeedsRebuild(prev,next)**：specKey 比较，重建/原地唯一判据
- **applyGroundSurfaceStructural(mat,st,tex)**：重建路径材质组装（有贴图→map+白乘色；无贴图→color 直出）
- **applyGroundSurfaceAppearance(mat,spec,meshSize)**：外观参数**唯一**落地入口（opacity/transparent/depthWrite/PBR/map.center+rotation+repeat）
- **generateSurfacePixels(st,sizePx)**：纯函数像素生成（solid/none 均匀、checker 奇偶交替、grid 首行首列画线）
- GroundCapability 侧：`refreshSurface()` 唯一变更入口（needsRebuild→rebuild 否则 applyAppearance）；自定义贴图照抄 EnvironmentCapability customHdrTex 模式（缓存独立于材质、不随 dispose、不持久化二进制、loadState 无缓存回退 plain）

## 对外 API / 入口

见上「核心职责」；消费入口 = `GroundCapability.setMat*()` 九组 setter/getter + 菜单控件（group `preview.groundGroupMaterial`，11 控件）。

## 与其他子系统关系

- 挂在场景能力注册表（scene_capability_registry 卡）的 GroundCapability 内，复用其显隐/持久化/菜单框架，无独立 registry 条目
- i18n key `preview.groundMat*` ×3 语言包
- 参考项目 MikuMikuAR ADR-089/226/231（演进线调研结论）

## 不变量

1. **单路径原则**：外观参数只经 `applyGroundSurfaceAppearance` 落地，capability 里禁止散落 mutate（合约测试锁死 rebuild==in-place 等价）
2. **纹理密度单点**：`textureRepeat(meshSize,scale)=meshSize/TILE_WORLD_SIZE(10)/scale` 只在 spec 模块算一次
3. **customTex 缓存生命周期**：独立于当前 surfaceTex，dispose 只释放自建纹理；clearCustomTexture 时 wasAttached 才清 surfaceTex 防误判归属
4. **持久化白名单**：loadState 校验 matSource ∈ GROUND_SURFACE_MODES（非法回退 none）；texture 模式无 customTex 缓存回退 plain

## 相关

- `docs/adr/ADR-117-ground-material-spec.md`
- 知识卡 scene_capability_registry.md（能力注册表框架）
