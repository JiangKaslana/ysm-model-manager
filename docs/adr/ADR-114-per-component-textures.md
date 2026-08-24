# ADR-114：每组件独立纹理（perComponent Textures）

- **状态**：✅ 已采纳
- **日期**：2026-08-22
- **决策人**：鲸鱼架构师 deepseek

| 字段 | 值 |
|------|-----|
| 状态 | ✅ 已采纳 |
| 日期 | 2026-08-22 |
| 决策者 | 鲸鱼架构师 deepseek |
| 关联 | ADR-004 §2.4（texSlot 分配）、ADR-042（cube 变换链） |
| 取代 | ADR-004 §2.4 "texSlot 按声明纹理查 texOrder 位置分配"中的全局 texArr 槽位假设 |

## 背景

### 问题现象

01_taisho_maid 的 minecart 组件显示橙色（木色调），实际 minecart.png 是灰色。
组件选择器切到 minecart，"当前组件绑定"显示 skin 而非 minecart。

### 根因链

本项目用"全局 texArr + texSlot 索引"模拟"每组件一纹理"：

```
Go: buildComponents 给每个 cube 打 TexSlot = texOrder 声明序位置
Go: BedrockModel.Textures = 全量 PNG base64 数组（按 texOrder 排序）
前端: preloadModel 把 model.textures 全量加载成 texArr[]
前端: addMeshToBoneGroup 用 texArr[md.texIdx] 全局索引查纹理
```

**错位根因**：texOrder 收集顺序（声明序）必须跟 texArr 槽位顺序完全一致。
任何 texOrder 收集变动都会导致 texSlot 跟 texArr 错位：

1. **foxcar 重复**（2026-08-22 修复 `2501d55e`）：
   vehicles 段 horse+mule 都指向 foxcar.png，
   旧逻辑重复追加 foxcar 到 texOrder，
   导致 minecart texSlot 从 5 偏移到 6，
   采样到 boat.png → 显示橙色（木色调）而非灰色。

2. **texSlot 索引脆弱**：
   texOrder 顺序 = 声明序（player.texture → projectiles → vehicles → arrow）
   texArr 槽位 = pngs 排序后（= texOrder 声明序）
   两者必须完全一致，任何变动（新纹理类型、声明顺序变化）都会错位。

### Modern YSM 的做法

读 `upstream/ModernYSM-1.20.1-forge` 源码确认：

**每个子实体（载具/投射物）独立绑定纹理，不存在全局 texArr 共享槽位。**

| 层 | 纹理绑定方式 |
|----|------------|
| `RawSubEntity` | `sub.textures.put("base_texture_0", rt)` — 自己的 map |
| `VehicleModelFiles` | `vehicleFiles.getTexture()` — 单张 `OuterFileTexture` |
| `VehicleModelBundle` | 持有 `vehicleFiles.getTexture()` — 渲染时直接用 |
| `ModelAssemblyFactory` | `textureList.add(vehicleFiles.getTexture())` — 独立添加 |

**关键对比**：

| | Modern YSM | 本项目（改之前） |
|---|---|---|
| 起步阶段 | 每组件独立纹理对象 | 全局 `texArr[texSlot]` 共享槽位 |
| minecart 渲染 | 直接用 `minecart.png` | `texArr[5]` = ???（取决于 texOrder 顺序） |
| horse+mule 共享 foxcar | 各自绑定 foxcar.png | 共享 texArr[4] |

## 决策

**改成每组件独立纹理（perComponent Textures），对齐 Modern YSM 架构。**

### Go 端

**`BedrockModel`** 加字段：

```go
ComponentTextures map[string][]string `json:"componentTextures,omitempty"`
// key = 组件源模型名（main/arm/arrow/minecart/boat/foxcar/trident）
// value = 该组件声明的纹理 base64 数组（通常 1 张）
```

**`buildComponents`**（archive.go L1487）：
- 现状：cube.TexSlot = texOrder 声明序位置（全局槽位）
- 改后：cube.TexSlot = 0（每组件用自己的第 0 张）
- 填充 `ComponentTextures[componentName] = [declaredTexBase64]`

**`collectArchiveFiles`**（archive.go L108）：
- 现状：texOrder 收集所有声明纹理名（有重复 bug）
- 改后：texOrder 保留（给 2D 预览全量用），但 `buildComponents` 不再依赖 texOrder 位置分配 texSlot

### 前端

**`preloadModel`**（model3d-loader.ts L151）：
- 现状：`texArr = loadTextures(model.textures)` 全量
- 改后：`componentTexArr: Map<string, Texture[]>` perComponent

**`addMeshToBoneGroup`**（mesh-builder.ts L27）：
- 现状：`texArr[md.texIdx]` 全局索引
- 改后：`componentTexArr[componentName][0]` perComponent 查

**`maid-3d.ts`**：
- 现状：`texArr` 全量传递
- 改后：`componentTexArr` perComponent 传递

### 兼容性

- `BedrockModel.Textures` 保留（2D 预览全量用）
- `BedrockModel.ComponentTextures` 新增（3D 渲染 perComponent 用）
- 旧模型（单组件）`ComponentTextures` 为空 → fallback 到 `Textures[0]`

## 后果

### 正面

- **根治错位**：每组件独立纹理对象，不再依赖 texOrder 顺序
- **对齐权威**：Modern YSM 架构，减少口径分歧
- **扩展性**：新组件类型（新载具/投射物）自动正确绑定

### 负面

- **改动范围**：6-8 文件（Go archive.go + bedrock.go + 前端 model3d-loader.ts + mesh-builder.ts + maid-3d.ts）
- **契约变动**：ADR-004 §2.4 texSlot 分配逻辑需同步更新
- **测试更新**：texSlot 相关测试需调整

## 验证

- `go build ./go/...` + `go test ./go/...` 全绿
- `cd frontend && npm run typecheck` + `npx vite build` 全绿
- 01_taisho_maid minecart 显示灰色（✅）
- 22 套模型 texSlot 越界对拍全绿（✅）
