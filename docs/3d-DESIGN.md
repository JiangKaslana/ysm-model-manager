# YSM — 🥉 ui-helpers 组件库迁移与设计集成

> **本文档定位**：记录从 MikuMikuAR 迁移 🥉 层（ui-helpers 原生 DOM 组件库 + `app.css` 类）到 ysm 的**工程事实与集成约定**。
> - 视觉/品牌真值源：`docs/3d-ui-DESIGN.md`（MikuMikuAR 源规范）。
> - ysm 唯一 UI 规范：`docs/Design.md`（设计系统 §1–§13 + 组件架构 §14–§20）。
> - 本文档不重复视觉规范，只讲「代码落哪儿、样式怎么接、耦合怎么解、面板怎么用」。
>
> **状态**：已落地 `frontend/src/ui/`，`npm run typecheck` 与 `npx vite build` 均通过；**尚未被任何面板接入（待采用）**。

---

## 1. 迁移范围与边界

| 项 | 说明 |
|----|------|
| 来源 | MikuMikuAR `frontend/src/core/` 下 `ui-helpers` / `ui-rows` / `ui-slide-row` / `ui-header-toggle` / `ui-advanced-rows` / `ui-collapsible` / `ui-preset` / `ui-card` / `ui-loading` 等模块 + `frontend/src/app.css` |
| 目标 | `ysm/frontend/src/ui/`（16 文件，见 §2） |
| 不在本批 | `ui-resource-panel` / `ui-fullscreen-overlay` / `ui-virtual-grid`（virtual-grid 已按 🥈 单独迁入 `utils/core`） |
| 去桶化 | 未照搬 MikuMikuAR 的巨型 `ui-helpers` barrel，改为分层小模块 + 精简 barrel（`ui-helpers.ts`），符合 ADR-191 去桶化 |

---

## 2. 文件清单（16）

| 文件 | 职责 | 关键耦合解除 |
|------|------|--------------|
| `control-registry.ts` | 控件自更新注册表（替代 `render-context`） | 见 §5 |
| `dom-contract.ts` | DOM 契约单源：`ROLE` / `ARIA_ATTR` / `COLLAPSIBLE` / `SLIDER_BAR_CLASS` | 零依赖叶子 |
| `icons.ts` | `createIcon` 图标工厂（替代 iconify） | 见 §5 |
| `ui-constants.ts` | 滑块步进常量 | 仅保留 `SLIDER_QUARTER_LARGE_STEP=0.15` / `SLIDER_QUARTER_SMALL_STEP=0.05` |
| `ui-slider-controller.ts` | `DragSliderController` 拖拽滑块 | 依赖 `utils/core/disposable` + `utils/core/clamp` |
| `ui-header-toggle.ts` | `createHeaderToggle` 开关头 | 经 `control-registry` 自更新 |
| `ui-slide-row.ts` | `slideRow` / `createTrailingBtn` / `createLeadingBtn` | 图标走 `createIcon` |
| `ui-rows.ts` | `addToggleRow` / `addSliderRow` / `addModeRow` / `addDangerRow` / `addFieldRow` / `addInfoGrid` / `addInfoCard` / `addBoneSelectRow` / `isIkBone` / `buildBoneGroups` 等 | i18n→字面量 |
| `ui-advanced-rows.ts` | `addColorSliderRow` / `addVector3SliderRow` / `addModeSlider` | Babylon `Color3`→内联纯函数 |
| `ui-collapsible.ts` | `addCollapsible` / `addSectionTitle` / `addPresetChip` | 见 §5 |
| `ui-preset.ts` | `buildPresetChipGroup` / `addClearRow` | 依赖 `ui-collapsible` |
| `ui-card.ts` | `cardContainer` 卡片容器 | 零依赖 |
| `ui-loading.ts` | `withLoadingIndicator` 加载遮罩 | 自包含 `loading-overlay` |
| `ui-types.ts` | `ControlOptions<T>` 接口 | — |
| `ui-helpers.ts` | **精简 barrel（对外 API 表面）** | 见 §3 |
| `ui-components-styles.ts` | 自动生成的 CSS 模块（见 §4） | — |

---

## 3. 公共 API 表面（barrel `ui-helpers.ts`）

组件侧统一从 barrel 导入，禁止跨模块直引内部文件：

```ts
import {
  slideRow, addToggleRow, addSliderRow, addModeRow, addDangerRow,
  addFieldRow, addInfoGrid, addInfoCard, addEmptyRow, addCardTitle,
  addWatchDirRow, addActionRow, addDisabledRow, addInlineToggleRow,
  addBoneSelectRow, isIkBone, buildBoneGroups, initControl,
  createHeaderToggle, addColorSliderRow, addVector3SliderRow, addModeSlider,
  addCollapsible, addSectionTitle, addPresetChip,
  buildPresetChipGroup, addClearRow, cardContainer, withLoadingIndicator,
} from '../ui/ui-helpers.ts';

// 常用类型
import type {
  ControlOptions, SlideRowExtra, TrailingAction,
  BoneSelectOptions, HeaderToggleConfig, PresetChipItem,
} from '../ui/ui-helpers.ts';
```

> 注意：ysm 采用 **`.ts` 后缀相对导入**（Wails 绑定契约，无 `-ts` 会回归红线）；barrel 为精简版，未含未迁入模块（`ui-resource-panel` 等）。

---

## 4. CSS 迁移策略

### 4.1 规模与提取

- 源：`MikuMikuAR/app.css` 共 **3987 行**。
- 提取：脚本切分 top-level 规则，仅抽取 🥉 组件实际使用的 **~138 条规则**（按类名匹配，非整文件复制）。
- 产出：`frontend/src/ui/ui-components-styles.ts`，导出三件套：

```ts
export const uiComponentsCss = "...";                 // CSS 字符串（唯一真相源，勿手改）
export const uiComponentsStyleSheet = _sheet;        // new CSSStyleSheet() + replaceSync
export function installUiComponentsStyles(doc?: Document): void;  // 幂等注入 <style data-ui-helpers>
```

### 4.2 Token 命名空间（防冲突）

- MikuMikuAR 专属 token 全部加 `--uih-` 前缀（共 68 个，如 `--uih-slide-item-pad-y`），避免与 ysm 全局 `:root` 主题 token（`--bg` / `--surf` / `--card` / `--hover` / `--act` / `--accent` / `--txt` / `--muted` / `--bd` / `--status-success` / `--status-error`）冲突。
- 验证：`var(--text)` 零残留、`--uih-` 命名空间生效、`color-mix` 改写到位。

### 4.3 撞色 Token 映射（对齐 ysm 设计系统）

| MikuMikuAR 原 token | 映射为 ysm | 说明 |
|---------------------|-----------|------|
| `--text` / `--text-dim` / `--text-bright` / `--text-muted` | `--txt` / `--muted` | 分层灰阶统一到 ysm 双级灰 |
| `--danger` / `--danger-hover` | `--status-error` | 语义危险色 |
| `--accent` | 保留为 ysm 主题色 | 唯一交互强调 |
| `rgba(var(--accent-rgb), a)` | `color-mix(in srgb, var(--accent) a%, transparent)` | 移除 `--accent-rgb` 依赖 |

> 由此库视觉与 `docs/Design.md` 设计系统保持一致（彩色仅表状态、灰阶表结构）。

---

## 5. 解耦决策（4 处硬耦合 → 自包含等价物）

| 原耦合 | 风险 | 解除方案 |
|--------|------|----------|
| `render-context.getCurrentRenderingContext` | 跨项目运行时依赖 | `control-registry` 可选注入：`setControlRegistry(fn)` / `registerControl(fn)`；默认 no-op。`initControl` 先 `registerControl(update)` 再**立即 `update()` 一次**（保留 bind-on-init；连续自更新按需 opt-in） |
| iconify 图标运行时 | 引入大型图标库 | `createIcon(icon)`：含 `':'` 视为 iconify 名 → 返回 `null`（不引运行时）；字面量 → 渲染 `.cs-icon` 文本节点 |
| `i18n/t` 文案 | 跨项目 i18n 依赖 | 改字面量（`'监听已停止'` / `'选择监听目录'` / `'搜索骨骼'` / IK 标签 `' (IK)'`） |
| Babylon `Color3`（`color-helpers`） | 3D 引擎耦合 | 内联纯函数 `col3FromTriple` / `rgbString`；轴色用 `['var(--accent)','var(--status-success)','var(--warning,#e6b800)']` |
| 全局 `dom.loadingEl` 遮罩 | 全局单例耦合 | `withLoadingIndicator` 自包含 `loading-overlay` 元素，追加到 `document.body`（`color-mix` 引用 ysm `--bg/--card/--txt/--bd` 并带 fallback） |

---

## 6. 集成约定（面板如何消费）

### 6.1 全局 / light-DOM（非 Shadow 区域）

应用启动处调用一次（幂等，重复调用无副作用）：

```ts
import { installUiComponentsStyles } from '../ui/ui-components-styles.ts';
installUiComponentsStyles();
```

组件直接用 className（`.slide-item` / `.toggle` / `.preset-chip` / `.collapsible-header` / `.cs-bar` …），样式由全局 `<style data-ui-helpers>` 提供。

### 6.2 Shadow DOM（Web Components）

ysm 的 Web Components 用 `adoptedStyleSheets`，**全局 class 不穿透 shadowRoot**。在 shadow 内使用本库组件时，必须把样式表 adopt 进去：

```ts
import { uiComponentsStyleSheet } from '../ui/ui-components-styles.ts';

// 在自定义元素构造/connectedCallback 中
this.shadowRoot!.adoptedStyleSheets = [uiComponentsStyleSheet, ...existingSheets];
```

> 组件本身用 className 而非内联 style，因此 **shadow 内必须 adopt 该 sheet 才能生效**；light-DOM 则依赖 §6.1 的全局注入。

### 6.3 模块导入

统一从 barrel 导入（见 §3）。内部叶子模块（`dom-contract` / `control-registry` / `icons` / `ui-constants` / `ui-types`）亦可作为类型/常量单独引用。

---

## 7. 已知约束 / 待办

- **待接入**：`frontend/src` 当前无任何面板 import 本库；接入时按 `docs/Design.md` §19 验收清单核对一致性与无障碍。
- **勿手改样式字符串**：`ui-components-styles.ts` 的 `uiComponentsCss` 为生成产物。若 MikuMikuAR `app.css` 变更需重同步，按 §4 三步重生成（提取→`--uih-` 命名空间→撞色映射），不要直接编辑字符串。
- **未搬模块**：`ui-resource-panel` / `ui-fullscreen-overlay` / `ui-virtual-grid` 不在本批；如需再搬，复用同一解耦范式。
- **引用真值**：视觉值以 `docs/3d-ui-DESIGN.md` 为准；ysm UI 规范以 `docs/Design.md` 为准。
