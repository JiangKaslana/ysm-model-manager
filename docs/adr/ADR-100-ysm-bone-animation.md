# ADR-100：YSM 骨骼动画播放——L1 基础播放

- **状态**：✅ 已采纳
- **日期**：2026-08-18
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`ADR-066`（统一预览外壳）、`ADR-052`（RenderSession 对象化）、`ADR-076`（声明式根菜单）、`ADR-081`（语义骨骼层）、`ADR-083`（感知层）

---

## 1. 背景（Context）

### 1.1 现状

YSM 模型可附带 `.animation.json` 文件（基岩版动画格式），包含骨骼旋转/位移/缩放关键帧。项目已有完整解析引擎 `parseBedrockAnimationJSON` + `evaluateClip`（`utils/animation/animation.ts`，263 行，全量测试通过），但**没有任何适配器调用它**——动画数据解析完即丢弃。

对比 VRM 已有 VRMA 动画播放（同目录 `.vrma` 自动发现 → `THREE.AnimationMixer` 驱动），YSM 缺少同等能力。

### 1.2 数据链路

```
ysm-folder/
├── main.json          ← Go spec 解析出骨骼层级（spec.bones: [{id, name, parentId, localRotation...}])
└── run.animation.json ← parseBedrockAnimationJSON 解析出 AnimationClip[{name, loop, length, bones}]
```

- `SpecBone3D.id` = `"0"`, `"1"`, ...（数字字符串）
- `.animation.json` 的 `bones` key = 骨骼**名**（如 `"root"`, `"spine"`, `"head"`）
- 需按 **name 匹配**把 clip 绑定到 THREE.Bone

### 1.3 目标范围（L1）

- YSM 适配器 build 时扫描同目录 `*.animation.json`，解析 clips
- 按骨骼 name 匹配绑定到 `obj.boneGroupMap` 中的 THREE.Bone
- 播放面板：选片 / 播放 / 暂停（复用 `fillMmdPlayPanel` 同款 UI）
- 动画播放期间**暂停**后续 L2 的呼吸/眨眼（与 VRM 口径一致）
- 单 clip 播放（L1 不做多clip列表；若有多个 clip 只显示第一个）

### 1.4 不纳入 L1

- 语义骨骼映射（L2，YSM 骨骼无标准命名，候选表维护成本高）
- 感知层（呼吸/眨眼/注视，L2）
- 多 clip 切换（L2，复用 MMD play bridge 接口即可扩展）
- VMD/VPD 物理动画（不在 YSM 格式范围内）

---

## 2. 决策（Decision）

### 2.1 架构：复用 `parseBedrockAnimationJSON` + 新建 `YsmAnimationPlayer`

**不做**：复制 `animation.ts` 逻辑、引入新依赖。

**做法**：在 `utils/3d/` 下新增 `ysm-animation-player.ts`（纯 Three.js 逻辑，0 backend import，ADR-072 纯净边界），封装：

```ts
// 核心接口
export interface YsmAnimPlayer {
  /** 应用一帧变换到骨骼（由 adapter update 每帧调用） */
  apply(dt: number): void;
  /** 释放内部状态（dispose 时调用） */
  dispose(): void;
}

/** 构建播放器：解析 animation.json → 绑定骨骼 → 返回 player */
export function createYsmAnimPlayer(
  boneByName: Map<string, THREE.Bone>,   // spec.bones 名→THREE.Bone
  clip: AnimationClip,                    // parseBedrockAnimationJSON 产出
  boneHierarchy: BoneHierarchyNode[],     // [{name, parent}] 供 evaluateClip 传播
): YsmAnimPlayer;
```

**时间驱动**：`player.apply(dt)` 内部维护 `elapsed` 累加器，调 `evaluateClip(clip, elapsed, hierarchy, true)` 取局部变换，再应用到对应 `THREE.Bone.rotation/position/scale`。循环动画自动取模。

### 2.2 适配器集成点：`ysm-adapter.ts` `buildYsmScene`

在现有 `buildYsmScene` 中：
1. `loader` 已加载 model → 取 `model._modelPath` 的同目录
2. 枚举 `*.animation.json`（调用 `listAllFilePaths` 同款端口注入，或直接用 `opts.loader` 路径反推目录后 Go `ListAllFilePaths`）
3. 读第一个 `.animation.json` → `parseBedrockAnimationJSON` → 取第一个 clip
4. 构建 `boneByName` Map（从 `spec.models[].bones[]` 的 `name` 字段建索引）
5. 实例化 `createYsmAnimPlayer`，接入 `PreviewScene.update`

### 2.3 播放桥接口：`MmdPlayBridge` 复用

`MmdPlayBridge` 接口已定义（`mmd-controls.ts:85-91`）：

```ts
interface MmdPlayBridge {
  clips: Array<{ label: string }>;
  isPlaying(): boolean;
  toggle(): void;
  currentIndex(): number;
  select(index: number): void;
}
```

YSM L1 只有 1 个 clip，`clips.length === 1`，下拉框不渲染（与 MMD 同口径）。面板复用 `fillMmdPlayPanel(list, bridge)`。

### 2.4 菜单项：新增 `ysm-anim` 项到 `ysmMenuItems`

在 `ysmMenuItems` 里增加 `play` 项（与 VRM 同款模式）：有 clip 时注入 `dockGroup: "motion"`，无 clip 时省略。

---

## 3. 后果（Consequences）

### 正面

- **零新增依赖**：复用已有 `parseBedrockAnimationJSON` / `evaluateClip`
- **0 backend import**：`ysm-animation-player.ts` 纯 Three.js 逻辑，ADR-072 边界纯净
- **渐进扩展**：L2（语义骨骼 + 感知层）可直接在 `YsmAnimPlayer` 上加，不破坏 L1 契约
- **播放桥标准化**：YSM/MMD/VRM 共用同一 `MmdPlayBridge` 接口，UI 一致

### 负面

- **名称匹配局限**：`.animation.json` 的骨骼名必须与 `spec.bones[].name` 完全一致，大小写敏感。不匹配的骨骼静默跳过（不报错）
- **Group vs Bone**：YSM 骨骼是 `THREE.Group` 层级树（`mesh.ts` 构建），非 `THREE.Bone`。播放器操作 `Object3D.position/quaternion/scale`，不涉及 SkinnedMesh 骨骼蒙皮——静态网格随 Group 变换整体移动，无蒙皮变形效果。对于方块人模型足够，但对精细模型（如有弯折手臂）动画可能看起来僵硬
- **语义骨骼命中率依赖作者命名**：YSM 无标准命名规范，`YSM_SEMANTIC_CANDIDATES` 覆盖 Blockbench/MC 常见导出名，但自由命名模型命中率低。感知层（呼吸/眨眼）优雅降级（缺省骨骼静默跳过），不影响渲染
- ~~**多 clip 只取每文件首 clip**~~ → **L3 已修复（2026-08-21）**：同一 `.animation.json` 内全部 clip 收录，标签策略 `ysmAnimClipLabels`（单 clip 保持文件名口径；多 clip 以「文件名 · clip 名」区分）
- ~~**切 clip 首帧旋转跳变**~~ → **L3 已修复（2026-08-21）**：三通道（rotation/position/scale）统一 alpha 累加混合模型——`selectClip` 清空混合状态，下一帧从**当前姿态**重新采集 rest 淡入新 clip（对齐 YSMViewer「从不硬切」口径）；构造期捕获 base 姿态，新 clip 未触及的骨骼渐回 base（停播骨骼渐回零位，YSMViewer Aura3DRenderer 同款收尾）

### 已知遗留

- **slerp 已完成（L2）**：`restQuaternions` + `multiplyQuaternions` 实现四元数路径插值，避免欧拉角 gimbal lock
- **局部变换直接应用**：`evaluateClip(localOnly=true)` 返回的变换不含父级累积，直接设到 Group 上——正确，因为 Group 层级已包含位置偏移（`spec.bones[].localPosition` 在 `mesh.ts` 构建时已 apply）
- **非 loop 动画末帧暂停后呼吸恢复**：`isAnimActive()` 在 `elapsed >= length && !loop` 时返回 false，呼吸恢复——与 VRM 口径一致
- **P1 bug 已修复（6312b358）**：初始实现错误地取 `group.children[0] as THREE.Bone`，实际应为 `group` 本身（boneGroupMap 值为 Group 节点）

---

## 4. 实施计划

| 步骤 | 文件 | 内容 |
|------|------|------|
| 1 | `frontend/src/utils/3d/ysm-animation-player.ts`（新建） | `createYsmAnimPlayer` + `YsmAnimPlayer` 接口 | ✅ L1 (0ee55eaa) + L2 (4d92eac9) |
| 2 | `frontend/src/utils/3d/ysm-animation-player.test.ts`（新建） | 单元测试：apply/loop/暂停/多clip/slerp/骨骼缺失降级 | ✅ 13 项全过 |
| 3 | `frontend/src/utils/3d/adapters/ysm-adapter.ts` | buildYsmScene 加 animation 扫描 + player 接入 update + 语义骨骼 + 呼吸 | ✅ L1+L2 (4d92eac9) |
| 3-fix | 同文件 P1 bug 修复 | boneByName 改为直接取 boneGroupMap 的 Group（非 children[0] as Bone） | ✅ (6312b358) |
| 4 | `frontend/src/views/app-preview/ysm-3d.ts` | 注入 `listAllFilePaths` + `readTextFile` 端口 | ✅ |
| 5 | `frontend/src/utils/3d/semantic-bones.ts` | 新增 `YSM_SEMANTIC_CANDIDATES` + `ysmSemanticBoneMap` | ✅ L2 (4d92eac9) |
| 6 | ADR-100 本文档 | 决策记录 | ✅ |
| 7 | L3 平滑过渡：`ysm-animation-player.ts` 三通道 alpha 混合 + base 姿态回落；`animation.ts` 新增 `ysmAnimClipLabels`；`ysm-adapter.ts` 全 clip 收录 | 切 clip 淡入 + 未触及骨骼渐回 + 多 clip 列表 | ✅ (2026-08-21) |

---

## 5. 数据溯源

- `parseBedrockAnimationJSON`：`frontend/src/utils/animation/animation.ts:207-296`，263 行，26 项测试全过
- `evaluateClip`：同上 `animation.ts:350-474`，支持层级传播 + loop 取模
- `MmdPlayBridge`：`frontend/src/views/app-preview/mmd-controls.ts:85-91`
- `fillMmdPlayPanel`：`frontend/src/views/app-preview/mmd-controls.ts:94-124`
- VRM VRMA 模式参照：`frontend/src/utils/3d/adapters/vrm-adapter.ts:197-232`（动画扫描 + mixer 驱动）
- SpecBone3D 旋转格式：`frontend/src/utils/3d/model3d.ts:11-17`，`localRotation: number[]`（弧度，XYZ 欧拉）
- boneGroupMap 结构：`frontend/src/utils/3d/mesh.ts:68-83`，值为 `THREE.Group`（非 Bone），层级为 modelGroup → parentGroup → childGroup
- 播放器接口变更（L2）：`createYsmAnimPlayer(boneByName: Map<string, Object3D>, ...)` 第 2 参数从单 clip 改为 clips 数组
- P1 bug 修复：`frontend/src/utils/3d/adapters/ysm-adapter.ts:207-214`（6312b358）

<!-- 文件名: ysm-bone-animation.md → 实际文件 ADR-100-ysm-bone-animation.md -->
