# MmdAdapter 三路线选型评估（ADR-066 P2 预研）

> 只调研不改代码。结论均以来源标注。2026-08-16。
> 关联：ADR-066 §3（P2 风险）、ADR-052（RenderSession 对象化，ysm3d 收敛立项）。

---

## 0. 结论先行（TL;DR）

| 路线 | 运行时直载 | 坐标口径 | 包体积 | 工程成本 | 判定 |
|------|-----------|---------|--------|---------|------|
| A · three-mmd 直桥 | ✅ | 🔴 未稳定（beta 期仍在翻轴） | 🟢 176.7KB、0 deps | 🟡 适配器 + 摆向 + parse 改造 | **唯一运行时可行路线，但排期在 ysm3d 收敛之后** |
| B · babylon-mmd 直桥 | ✅ | 🟢 成熟 | 🔴 22.7MB + Babylon 引擎全家桶 | 🔴 双引擎共存 | ❌ 否决（本项目是 Three.js 栈） |
| C · MMD→GLB 离线烘焙 | ❌ | 🟢 glTF Y-up 标准 | 🟢 资产侧 | 🟡 Blender/在线工具链 | ⚠️ 不符合「拖入即预览」，仅作降级通道 |

**推荐**：P2 采用路线 A（`@moeru/three-mmd`），但**不在本轮启动**——三个前置条件齐了再动：① 隔壁 ysm3d 收敛（P3-E / ADR-052）落地，`mountPreview` 契约稳定；② three-mmd 出 1.0 稳定版（现 0.1.0-beta.3，坐标仍在修）；③ 验证其字节级 parse 入口可喂 `ReadFileBytes` 的 ArrayBuffer（参照 VRM 的 `GLTFLoader.parse` 先例）。

---

## 1. 路线 A · `@moeru/three-mmd` 直桥

### 1.1 成熟度（实锤数据）

- 版本：最新 **0.1.0-beta.3**（2026-02-15 发布，prerelease）；整个 0.1.0-beta 系列仅 3 个版本（Dec 2025 – Feb 2026）。
- 生态：**26 stars**、周下载 158、**0 dependents**、7 个版本总历史（npm registry 数据）。
- 性质：**基于 babylon-mmd 代码移植**到 Three.js（r171）+ three-ts-types（GitHub README 自述）。
- 结论：实验态实锤，与 ADR-066 §3 的 🔴 标注一致，**未受战场检验**。

### 1.2 坐标口径（陷阱 #11 高危区）

- 2025-11-19 commit `95df864`（three-mmd-b）：「Flip Z axis + 翻转面绕序 + morph 翻转」——chirality 修正。
- 2025-11-20 commit `b0805bd`：「build-animation 位置/旋转翻转」——**动画轴也在翻**，且注释自陈「this part may need to be tested」。
- 2025-11-30 `babc2e0` 重构：物理（MMDAmmoPhysics）从 core 移出成插件。
- 结论：**beta 期仍在持续翻轴修坐标**，这正是 ADR-066 §3 警告的「坐标口径」风险——不是「已验证稳定」的库。

### 1.3 本项目适配可行性

- **字节喂入**：`MMDLoader.load(url)` 内部走 `FileLoader` → `arraybuffer` → `PmxReader/PmdReader.ParseAsync(buffer)`（`mmd-mesh-loader.ts` 源码可见）。本项目所有文件经 Go `ReadFileBytes` 取 base64（`internal/app/app_model.go:86`），**需验证/改造成直接调 parse 入口**，参照 VRM 先例（`vrm-adapter.ts:40-42` 用 `GLTFLoader.parse(buffer)`）。
- **朝向**：MMD 模型默认朝向需摆正（three.js MMDLoader 惯例 `mesh.rotation.set(0, Math.PI/2, 0)`），且 three-mmd 已翻 Z——加载后朝向需实测，适配器内做摆正（对齐 `rotateVRM0` 模式），**不动核心相机**。
- **贴图**：PMX 贴图是外部文件（blender_mmd_tools issue #124：PMX 不内嵌贴图），本项目 mmd-skin 是 `isDir: true` 目录型资源——需要 ReadFileBytes 逐个取贴图喂材质（参考 wasm.ts 的 texFiles 循环模式）。
- **物理/动画**：ADR-066「不纳入本次范围」——默认静态预览，物理（ammo）与动画（VMD）后续独立立项，正好规避 three-mmd 最不稳的部分。

---

## 2. 路线 B · babylon-mmd 直桥

### 2.1 成熟度（比 A 成熟一个量级）

- 版本：**1.3.0**（2026-07-23 更新，活跃维护）；105 个版本（2023-06 起）。
- 生态：**245 stars**、周下载 595、持续发布（1.0.0 于 2025-10，1.1.0/1.2.0 跟进）。
- 能力：PMX/PMD + VMD/VPD + 物理/IK/morph 全套 runtime。

### 2.2 否决理由（不是不好，是不匹配本项目栈）

- **它是 Babylon.js 的 loader/runtime，不是 Three.js 的**。本项目渲染栈是 Three.js（`mount-preview-core.ts` 单一核心）。直桥 = 引入 Babylon 引擎全家桶（@babylonjs/core + loaders + materials + havok…，babylon-mmd unpacked 22.7MB），与现有 Three.js 栈**双引擎共存**——渲染核心分裂，直接违背「单一渲染核心」的 ADR-066 D2 决策。
- 「只借 parser、自写 Three.js 构建层」= **重新造 three-mmd**——而路线 A 的 three-mmd 就是干这件事的成品（其 parser 直接借 babylon-mmd）。工程上等价于「选 A 但自己再实现一遍 A」。

---

## 3. 路线 C · MMD→GLB 离线烘焙

### 3.1 工具链（成熟，但都是资产管线）

| 工具 | 类型 | 说明 |
|------|------|------|
| Blender + MMD-Tools | 本地 | 高精度，材质/骨骼/动画可完整保留；但材质转换坑多（MMD 半透明→Principled BSDF 需手动调），导出 GLB 需勾选嵌入贴图 |
| MikuMikuConvert | 在线 | PMX/PMD→GLB/FBX，纹理/动画烘焙，浏览器内操作 |
| modelconv（binzume） | Go CLI | pmx→glb/vrm 支持，但 vmd 动画为「暂定实现」 |

### 3.2 优点

- GLB 是 glTF Y-up 标准，进 Three.js 走现成 `GLTFLoader`（vrm-adapter 已有），天然满足 `PreviewScene { root }` 契约，**坐标口径零风险**。

### 3.3 否决理由（产品形态不符）

- **不是运行时方案**：用户拖一个 `.pmx` 进管理器，必须**先离线转换**才能预览——与「预览器」即时呈现的产品定位冲突。
- MToon 材质、刚体/JOINT 物理、表情 morph 在 GLB 中需烘焙或直接丢失；烘焙依赖外部工具链（Blender/在线服务），用户侧不可控。
- 定位只能是**降级通道**：若某资产恰好有 GLB 变体可走既有 GLTF 路径，不值得为此立项。

---

## 4. 与「隔壁 ysm3d 收敛」的排期关系

- ysm3d 收敛（ADR-052 RenderSession 对象化 / P3-E YSM 入 `mountPreview`）与 MmdAdapter **同属核心契约的消费方**：前者扩展契约（YSM 骨骼/动画挂钩），后者消费契约（MMD 场景 + update）。
- 并行开发 → `mount-preview-core.ts` / `index.ts` 共享文件撞车 + 契约变动返工（陷阱 #11 同类风险）。
- **顺序执行**：ysm3d 收敛落地 → 契约稳定 → `MmdAdapter` 一次做对。这符合项目「长治久安」偏好：新增格式 = 加适配器 + 注册表一条目，不污染既有渲染逻辑（ADR-066 D1/D2）。

---

## 5. 数据溯源

- three-mmd 版本/star/下载：npm registry `@moeru/three-mmd`（2026-02-15 beta.3，26 stars，158/week，0 dependents）。
- three-mmd 坐标修复：GitHub moeru-ai/three-mmd commits `95df864`（z-flip）、`b0805bd`（动画轴翻转）、`babc2e0`（物理插件化）。
- three-mmd 内部结构：`mmd-mesh-loader.ts`（FileLoader→arraybuffer→PmxReader.ParseAsync）。
- babylon-mmd：npm registry `babylon-mmd` 1.3.0（245 stars，595/week，105 版本）；GitHub noname0310/babylon-mmd。
- GLB 烘焙：blender_mmd_tools issue #124（PMX 贴图外部文件坑）；MikuMikuConvert；binzume/modelconv（vmd 暂定实现）。
- 项目现状：`internal/app/app_model.go:86`（ReadFileBytes base64）；`vrm-adapter.ts:40-42`（GLTFLoader.parse 字节喂入先例）；`mount-preview-core.ts`（PreviewAdapter 契约，be237aa0 落地）。
