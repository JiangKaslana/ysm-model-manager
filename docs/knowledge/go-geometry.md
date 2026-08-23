---
kind: go-geometry
name: Geometry 存档 go/geometry
tier: architecture
category: go
source_files:
  - go/geometry/parse.go
  - go/geometry/archive.go
  - go/geometry/ysm_parser.go
use_when:
  - geometry
  - 基岩版
  - bedrock
  - 模型解析
  - zip
  - 7z
  - 纹理
  - 动画
invariant_anchors:
  - go/geometry/archive.go|fsutil.ReadLimitedEntry
  - go/geometry/ysm_parser.go|json.Decoder
---

# Geometry 存档 go/geometry

## 概览

`go/geometry/` 包解析 Bedrock（基岩版）`minecraft:geometry` 模型：既支持单个 geometry JSON，也支持从 ZIP/7z 存档中按 `ysm.json` 清单合并多个模型文件、提取纹理与动画，产出 `types.BedrockModel` 供 2D 线条图与 3D 预览流水线使用。

## 核心职责

- `parse.go` — 标准 geometry JSON 解析（骨骼/立方体/UV/旋转/纹理槽）
- `ysm_parser.go` — ysm.json 清单解析共享函数（`parseYsmArchive`）：结构解码返回原文，口径后处理留调用点（见不变量）
- `archive.go` — ZIP/7z 存档解包：ysm.json 清单（model/texture 顺序）、多 geometry 文件合并、cube→texSlot 绑定、PNG 纹理与动画 JSON 收集、首张 PNG 快速缩略；**容器打开统一走 `go/container`（ADR-068）**——`ExtractFirstPNGFromZip/7z` 入口经 `OpenZipBytes/Open7zBytes` + 格式无关 `extractFirstPNG`，`collectArchiveFiles` 消费 `container.Entry`，删除原 ParseFrom7z/ParseFromZip 对称外壳 ~294 行（公开签名不变）；**zip/7z 六入口（ParseFrom*/ParseFrom*Entry/ParseComponentsFrom*）已收敛**为 `openArchiveBytes` 单一打开点 + 共享实现（`parseModelFromArchive` / `parseFromArchiveEntry` / `parseComponentsFromArchive`），六导出函数变薄包装，改解析逻辑只改共享实现

## 对外 API / 入口

- `ParseBedrockGeometry(data []byte) *types.BedrockModel` — 解析单个 geometry JSON；输入上限 100MB；UV 兼容数组与 per-face 对象两种形态；失败返回 nil
- `ParseFromZip(data []byte, size int64) (*types.BedrockModel, [][]byte, []string)` — 从 ZIP 解析，返回（合并模型、纹理 PNG 列表、动画 JSON 字符串列表）；模型文件与纹理均按 ysm.json 声明顺序稳定排序
- `ParseFrom7z(data []byte, size int64) (*types.BedrockModel, [][]byte)` — 7z 版（`github.com/bodgit/sevenzip`），返回模型与纹理；不单独分流动画 JSON（动画文件当 geometry 解析失败后自然跳过）
- `ParseFromZipEntry(data []byte, size int64, subPath string)` / `ParseFrom7zEntry(...)` — 按 subPath（L0 SubModel.SourcePath 口径）解析单个 geometry 文件；三层降级命中（精确→命名空间相对→basename 模糊），命中失败返回 nil
- `ParseComponentsFromZip(data []byte, size int64)` / `ParseComponentsFrom7z(...)` — 多组件解析（YSMViewer 式）：每个模型文件独立组件（含 arm/载具，不合并不排除），main 优先排序 + perComponent 独立纹理；返回（组件数组、纹理名数组、error）
- `ExtractFirstPNGFromZip(data []byte, size int64) []byte` / `ExtractFirstPNGFrom7z(data []byte, size int64) []byte` — 提取第一张 PNG 做快速预览

## 与其他子系统关系

- 被 `internal/app/app_model.go` 调用（3D 预览前置解析）、`internal/app/app_files.go`（缩略图）、`internal/app/wasm_decoder.go`（解码后解析）
- 被 [go_ysm_parser](./go-ysm-parser.md) 的 `extracted.go` 调用（解压产物解析）
- 下游产物交给 [go_threejs](./go-threejs.md) 生成渲染 spec；依赖 `go/types`（BedrockModel/Bone2D/Cube2D）

## 不变量

- 存档内单文件读取上限走 `types.MaxReadLimit`（50MB，全仓单点常量）：`geometry/archive.go` 各读取点**直接调 `fsutil.ReadLimitedEntry(rc, int64(maxExtractSize))`**（原包内转发 `readLimitedEntry` 已删除，收敛为直调），`ysm/*` 解析入口同值；`LimitReader(limit+1)` 探测截断，超限/读错拒绝并跳过，ADR-033 修复——不再静默截断装盘
- `ParseBedrockGeometry` 输入上限 100MB（`maxParseSize`），超限拒绝并记日志
- **cube 字段覆盖**：解析 origin/size/pivot/uv（数组或 per-face 对象）/rotation/texture/inflate/mirror。`inflate`（Blockbench 膨胀）与 `mirror`（镜像）2026-08-09 补齐（P2）——此前 .ysm 走 wasm 解码时 YSMParser 已把 inflate 烘焙进几何尺寸，Go 原生解析 zip/7z/json 却丢弃字段导致老模型（1.10+ 导出）尺寸偏小/纹理方向错；现在两条路径口径一致
- `ysm.json` 是清单不是模型文件，不参与 geometry 解析；文件名含 animation/controller 的 JSON 归入动画而非模型（仅 ZIP 路径分流）
- `ysm.json` 的 `files.player.model` 支持 4 种形态：字符串 / 字符串数组 / `{path|name}` 对象数组 / `map[string]string` 对象。**对象形态按声明顺序展开**（P2 修复实际实现为 `json.Decoder` Token 流式保写入序——Go map 遍历随机，若按 key 排序会把 main 排到 arm 后导致 texSlot 绑定错位；知识卡旧文「sort.Strings 键排序对齐」记录的是已废弃方案，机制描述已修正，行为目标确定性一致）
- **zip 路径排除第一人称手臂 arm.json**（`archive.go` `isArmModelName`：arm.json / arm.geo.json，2026-08 提交 63644b40）：arm 与 main 手臂重叠合并会渲染出两对手臂；且 arm.json 占 texIdx 槽位会让 main 纹理错位——收集模型时剔除并移除其占位（解压目录路径同款在 [go_ysm_parser](./go-ysm-parser.md) 的 `extracted.go`）
- 模型文件与纹理排序一律用 `sort.SliceStable`：清单声明过的条目按声明顺序在前，未声明的保持存档内原始顺序排在其后；纹理排序的 orderMap key 与查询 key 同口径（小写 basename 去扩展名，P2 修复——原 key 带扩展名永不命中，排序形同死代码）
- texSlot 映射为「第 i 个模型 → 第 i 个纹理」，索引超出纹理数量时钳到最后一张（`ti >= texCount` → `texCount-1`）；`texOrder` 为空时退化为按模型数量取索引
- 纹理只收 `.png`/`.jpg`；不按尺寸过滤小纹理（64×64 合法贴图可 <4KB，与 .ysm 解压路径口径一致）；头像/预览图仅由 `avatar/` 路径与基名前缀排除
- 解析失败统一返回 nil/空，由调用方决定降级路径，不 panic
- **合并路径 vs 组件化路径是本质差异，禁止用 `excludeArm bool` 之类参数强统一**：`parseModelFromEntries`（ParseFromZip/ParseFromZipEntry 单模型合并）排除 arm 占位（避免两对手臂 + texIdx 错位）；`buildComponents`（ParseComponentsFromZip/7z 组件化）保留 arm 作独立组件（YSMViewer 口径）。两者输出结构不同（单个 `BedrockModel` vs 组件数组），函数签名也随之不同，强行合并只会引入分支复杂度
- **zip/7z 六入口已收敛，禁止退回双份路径**：新增功能/修 bug 只改共享实现（`parseModelFromArchive` / `parseFromArchiveEntry` / `parseComponentsFromArchive`）+ `openArchiveBytes`。若需新增 zip/7z 进入点，加薄包装调共享实现，勿复制 open + 解析循环
- **ysm.json 解析已收敛为 `ysm_parser.go` 的 `parseYsmArchive`（路线 B：纯提取、行为不变）**：共享层只做 JSON 结构解码（list/dict/single、数组/对象/字符串多形态）并返回**原文**（`ysmArchiveData`：ModelOrder / PlayerTexs{path,isUV} / ProjModels / Metadata RawMessage），lower/去扩展名/去目录等口径后处理留回 `collectArchiveFiles`（清单版，player.texture 去扩展名）与 `parseModelFromEntries`（模型版，player.texture 保留扩展名）。两调用点 player.texture 口径本就不同，且有历史不对称（`{uv}` 对象分支剥反斜杠、裸字符串分支不剥，由 `playerTex.isUV` 标记原样复刻）——禁止用参数强统一口径；仅 projectiles/vehicles/arrow 纹理口径两路径完全相同才收敛进 `texBasenameNoExt`（去目录+小写+去扩展名）

## 相关

- [go_threejs](./go-threejs.md) — BedrockModel → Three.js spec
- [go_ysm_parser](./go-ysm-parser.md) — YSM 格式与解压流程
- [go_types](./go-types.md) — BedrockModel 结构
