# ADR-076：3D 预览通用底部导航与弹窗脚手架收敛契约

- **状态**：🔄 部分采纳（方向已定，编码待立项——等 ADR-073 天空/地面后续迭代稳定后动工，避免 UI 外壳契约变更与并行施工冲突）
- **日期**：2026-08-16
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/utils/3d/adapters/mount-preview-core.ts`、`frontend/src/views/app-preview/ysm-controls.ts`、`frontend/src/views/app-preview/mmd-controls.ts`、`frontend/src/ui/ui-slide-menu.ts`、`ADR-075`、`ADR-073`、`ADR-072`、`ADR-066`

---

## 1. 背景（Context）

### 1.1 环境菜单已收敛（ADR-075），弹窗脚手架却仍各写一套

ADR-075 已把**环境类控件**（地面/时间-of-day/云量/IBL）收进 `mount-preview-core.ts` 的统一「🌍 环境菜单」（slide-menu 版，commit `7d425a10`），四种模型零改动继承——环境「共用设置」的判断已兑现。

但**底部导航 + 分类弹窗的脚手架**仍由各适配器各写一套，与 ADR-066 §1.3 警告的「格式散装 / 各写一套」同构：

| 重复 | 证据（file:line） |
|------|------------------|
| `mkNavBtn`（底部导航按钮工厂） | `ysm-controls.ts:62` 与 `mmd-controls.ts:255` 两份逐字拷贝 |
| nav + popup + `togglePopup` + `closePopup` 同构脚手架 | `ysm-controls.ts:147/156/240-241` 与 `mmd-controls.ts:68/82`（`buildYsmBottomNav`/`buildMmdBottomNav` 各自 ~150 行） |
| 相机控件 `buildCameraControls` | core topBar 一份（`mount-preview-core.ts`）+ `ysm-controls.ts:192` + `mmd-controls.ts:221` 各一份 |

### 1.2 根因：能力/环境已收敛，但「菜单外壳」未收敛

- **能力层**（sky/ground）已下沉 core（ADR-073 caps/ 套路）；
- **环境 UI** 已收进 core（ADR-075 slide-menu）；
- **菜单外壳**（底部导航 + 弹窗 toggle/close）仍是「各适配器各写一套」——这是最后一块未收敛的 UI 脚手架。

---

## 2. 决策（Decision）

### D1 · 通用底部导航 + 分类弹窗外壳收归 core

`mount-preview-core.ts` 提供统一契约与外壳，适配器**只声明菜单项、不碰脚手架**：

```ts
export interface BottomNavMenu {
  id: string;                          // "model" / "view" / "env"
  icon: string;                        // "🧍" / "🎥" / "🌍"
  label: string;                       // 由 i18n 键派生（tr 兜底，对齐 ADR-075）
  fill: (list: HTMLElement) => void;   // 只填弹窗内容，外壳管 nav/popup/toggle/close
}
export function buildBottomNav(overlay: HTMLElement, menus: BottomNavMenu[]): void;
```

`mkNavBtn` / nav 容器 / popup / `togglePopup` / `closePopup` / 弹窗容器 id（`ysm-3d-panel` 兼容 `fill3DPanel` 选择器）全部收归外壳单一实现，删除 `ysm-controls.ts`/`mmd-controls.ts` 的两份拷贝。

### D2 · 环境菜单并入统一导航（复用 ADR-075 已落地项）

ADR-075 已落地的「🌍 环境菜单」（slide-menu + 地面/时间/云量/IBL）作为统一导航的**固定 `env` 菜单项**并入 `buildBottomNav`，由 core 自动注入，适配器不感知、零改动。环境是「场景级共用设置」，天然不属于任何单一适配器的 `model` 菜单。

### D3 · 相机控件下沉「视图」菜单

`buildCameraControls`（旋转/速度/重置）作为统一「视图」菜单项，由 core 提供。适配器的 `view` 菜单复用 core 的 `camBridge`，消灭 core topBar + ysm + mmd 三份重复。topBar 仅保留：关闭、3D 内切换下拉、底部导航入口。

### D4 · 落地时机：编码待立项（等天空/地面稳定）

**本期只记决策，不动代码。** 落地排期在 ADR-073 后续迭代（天空/地面能力收口）稳定之后。期间新增格式仍按现有 `PreviewAdapter` + `extraControls` 契约先落地，不阻塞本 ADR。

---

## 3. 后果（Consequences）

**正面**：
- 弹窗脚手架只在 core 一份，`ysm-controls.ts`/`mmd-controls.ts` 各删 ~150 行，回归「只声明内容」；
- 环境作为 core 固定菜单（ADR-075 已落地）自动并入，四种模型零改动；
- 相机控件单点，适配器不再各写一份；
- 新增格式 = 声明 `model` 菜单 + 一个 adapter，脚手架/环境/视图自动继承。

**负面 / 风险**：
- 🟡 UI 外壳契约变更（`buildBottomNav` 取代 `buildYsmBottomNav`/`buildMmdBottomNav`），需迁移两处控件 + 对应测试断言；
- 🔴 与 ADR-073 天空/地面并行施工有冲突风险——故 D4 明确等能力层稳定后动工；
- 🟡 弹窗容器 id（`ysm-3d-panel`）被 `fill3DPanel` 内部选择器依赖，外壳收敛时须保留该 id 兼容，防骨骼面板断链；
- 🟡 `mmd-controls.ts` 已用 `createSlideMenu` + 两级层级（视图集），`ysm-controls.ts` 仍是内联 popup——收敛时以 slide-menu 为统一外壳，ysm 需对齐迁移。

**已知遗留**：
- `ysm-controls.ts` 的 `formatBoneInfo`/`popupSection`/`popupRow`/`makeShotGuard` 是 YSM 专属内容辅助，非脚手架，收敛时保留在适配器侧；
- 截图（`saveScreenshot`）在 `ysm-controls.ts` 视图菜单内，属 YSM 专属，不进 core 通用 `view` 菜单（或后续独立立项）；
- `mmd-controls.ts` 的「切换模型区」（`resolveMmdSiblings` 注入）与 ADR-066 §5.6 `switchTo` 切换下拉的边界，收敛时按「模型菜单内切换」与「topBar 下拉」双入口维持现状，不在本 ADR 动。

---

## 4. 数据溯源

- **来源**：用户对话（2026-08-16）：「继续审核看看，感觉共享架构还得优化，看看怎么设计通用弹窗按钮，比如环境是共用设置的？」+ 代码审计 + 用户拍板（方案 A：先出 ADR，编码待立项）。
- **审计证据（file:line）**：
  - `frontend/src/views/app-preview/ysm-controls.ts:62/147/156/192` — `mkNavBtn`/`closePopup`/`togglePopup`/`buildCameraControls`（脚手架）；
  - `frontend/src/views/app-preview/mmd-controls.ts:68/82/221/255` — 同构脚手架（`createSlideMenu` 版）；
  - `frontend/src/utils/3d/adapters/mount-preview-core.ts` — core topBar 的 `buildCameraControls`（与两控件视图菜单重复）；
  - `frontend/src/utils/3d/adapters/mount-preview-core.ts:293-403` — ADR-075 已落地的「🌍 环境菜单」（slide-menu，本 ADR D2 的复用对象）。
- **关联 ADR**：ADR-075（环境菜单已收敛，本 ADR 的环境项复用其落地）、ADR-073（能力层 caps 共享，UI 层配套）、ADR-072（3D 归置，本 ADR 的 UI 外壳收敛）、ADR-066（统一预览契约 + 单一渲染核心）。
- **决策**：方案 A——通用底部导航 + 弹窗脚手架收敛契约已定；D4 编码待立项（等 ADR-073 天空/地面稳定）。
