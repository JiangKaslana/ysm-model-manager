# ADR-057：3D 预览悬浮触发按钮与双端响应式控制层

- **状态**：✅ 已采纳（方向已定，编码实现按 §2.8 小步快跑落地）
- **日期**：2026-08-13
- **决策人**：Jieling（人类首席架构师）、AI 代理（Riku）
- **相关**：`frontend/src/views/app-preview/skeleton.ts`（`#ysm-overlay-3d` 控制层，L297–L624）；`frontend/src/views/app-preview/css.ts`；`frontend/src/utils/dom/android-bridge.ts`；ADR-004（3D 管线/坐标系）、ADR-036（3D 键位可配置）、ADR-047（安卓触屏可用性）、ADR-049（网页版桥接）、ADR-014（TS 门槛）、ADR-027（Web Component 契约）；MikuMikuAR `frontend/src/core/icons.ts`、`menus/nav-actions.ts`、`app.css @media(pointer:coarse)`

---

## 1. 背景（Context）

3D 预览悬浮层（`#ysm-overlay-3d`）已就绪：全屏 `position:fixed;inset:0` 覆盖，挂 `document.body`（light DOM，规避 Shadow DOM 下 WebGL 上下文丢失——既有正确决策）。但控制层存在三处结构性短板：

1. **样式不可复用**：`skeleton.ts` L314–L624 的顶栏/截图/重置/纹理/旋转/面板按钮**全部内联 `style.cssText`**，与全局设计变量（`--surf/--hover/--accent/--fs-base/--radius-*`）不统一，改一处要动 JS、无法在 CSS 层集中治理。
2. **纯桌面输入模型**：交互依赖 WASD / 鼠标拖拽 / 滚轮 / ESC（ADR-036 已让键位可配置，但**未提供触屏等价物**）。触屏无 hover、无安卓返回键消费、无触控热区放大。
3. **未响应式**：窄屏（手机竖屏）、横屏（手机限高）未适配，控制栏会顶出屏幕或挤压 3D 视口。

**动机**：隔壁 MikuMikuAR 已沉淀成熟悬浮按钮范式——`nav-tab` 图标按钮工具条（`slide-action` 视觉）+ `--ui-scale` 缩放 + `@media (pointer:coarse)` 把触控热区扩到 44px（Apple HIG）+ `handleAndroidBack` 桥消费安卓返回键。YSM 侧已具备 `isViewerMode()` / `android-bridge.ts`（ADR-047/049），双端统一的基础已在。用户诉求：把 3D 预览的触发按钮改为**悬浮 FAB**、控制层**双端（安卓 + 桌面）自适应**。

---

## 2. 决策（Decision）

### 2.1 范式复用，而非代码搬运
"同款"= **视觉/交互范式对齐**，不是 import 组件。两城邦 DOM 策略与 3D 引擎根本不同：

| 维度 | YSM（本城邦） | MikuMikuAR（隔壁） |
|---|---|---|
| 组件模型 | Shadow DOM Web Component + Three.js | light DOM + Babylon.js |
| 3D 解码 | YSMParser WASM（ADR-029/041） | YSMViewer 算法口径 |
| 坐标系 | ADR-004 决策 | YSMViewer C# ThreeJsPayloadBuilder |

故复用其**图标按钮视觉 + `--ui-scale` 缩放 + `pointer:coarse` 热区 + 安卓返回键桥**四件套，不搬运其 Babylon/light-DOM 实现。

### 2.2 抽 `FloatingActionButton` 组件，替换内联按钮
- 新建 `frontend/src/utils/dom/fab.ts`（工厂：创建图标按钮 / FAB 容器）+ 配套 CSS 类，替换 `skeleton.ts` L314–L624 的 `style.cssText` 内联按钮。
- overlay 挂 `document.body`（light DOM），全局 CSS 直接生效，**无障碍**；Shadow DOM 内仅保留触发 FAB 的挂载点。
- 沿用 `skeleton.ts` 既有的生命周期纪律：`close3D` 清理 `_model3d` 渲染器 + `unsubs` 摘除、`_active3DClose` 模块级钩子供切模型前关层（L34–L40、L547–L584），**不破坏**。

### 2.3 触发键改悬浮 FAB
- 预览面板右下角悬浮 🎨 触发按钮（FAB），点击开全屏 overlay；沿用"挂 body"设计，避免 Shadow DOM 下 WebGL 上下文丢失。
- FAB 仅在模型可 3D 化时显示；`_prefer3D` 偏好（L301）保持"切模型自动弹 3D"语义不变。

### 2.4 响应式双端（断点对齐 MikuMikuAR）
- 引入 `--ui-scale`（参考 MikuMikuAR `app.css`），控制栏/按钮整体缩放。
- 断点直接复用隔壁已验证值：
  - `@media (max-width: 480px)`：窄屏缩小控制栏/弹窗，安全边距 `--overlay-bottom`；
  - `@media (orientation: landscape) and (max-height: 500px)`：横屏限高，防面板顶出屏幕（对齐 MikuMikuAR ADR-017 A2-03 补丁思路）；
  - `@media (pointer: coarse)`：触控热区扩到 **44px**（透明 `::after` 叠加层，不改视觉高度）。
- 触屏把 WASD 键盘提示（L904 tip）换成**屏幕手势 + 虚拟控件**（或在触屏下隐藏键盘提示、以手势说明替代），与 ADR-036 键位可配置同源。

### 2.5 安卓返回键桥（补齐缺口）
- YSM `android-bridge.ts` 当前**仅有** `isViewerMode()` 与权限桥，**无返回键钩子**——本 ADR 补此缺口。
- 扩展 `android-bridge.ts`：新增返回键处理器注册表（参考 MikuMikuAR `registerUiAction('handleAndroidBack')`）。3D overlay 打开时**消费**返回键关层（`keepPrefer=false` 清 `_prefer3D`），否则透传上层。
- 原生侧（`MainActivity`）需把系统 back 转发到 JS 注册的处理器（YSM 当前桥缺此通道，需 Android 端补，属跨端联调项）。

### 2.6 图标方案统一
- YSM 现用 emoji（👁/🔍/📷），与 MikuMikuAR 的 `iconify-icon` 不一致，且 emoji 跨平台渲染有差异。
- 决策：抽图标按钮工厂（对齐 MikuMikuAR `core/icons.ts` `createIconButton`），底层用 `iconify-icon` 或自维护 SVG sprite；至少把 `.ysm-btn` 升级为统一图标按钮类（含 `title`/`aria-label` 可达性）。

### 2.7 设计变量对齐
- 复用 YSM 现有 token（`--surf/--hover/--accent/--fs-base/--radius-sm/lg`），新增 `--ui-scale` 做整体缩放；**不另起一套**，避免与 `css.ts` 既有体系冲突。

### 2.8 实施拆分（小步快跑，逐条可验）
1. `utils/dom/fab.ts` + FAB CSS 类（图标按钮工厂 + 44px 热区 + `--ui-scale`）。
2. `skeleton.ts` 内联按钮 → 调工厂（先抽顶栏按钮，保留 `close3D`/`unsubs` 纪律）；`cd frontend && npx vite build && npm run typecheck` 验证。
3. 触发 🎨 改右下角悬浮 FAB（Shadow DOM 挂载点）。
4. 响应式断点 + 触屏手势/虚拟控件（横屏/窄屏验证）。
5. `android-bridge.ts` 返回键注册表 + 原生 `MainActivity` back 转发 + 3D overlay 消费。
6. 图标工厂替换 emoji（iconify 或 SVG sprite）。

---

## 3. 后果（Consequences）

**正面**
- 控制层样式集中治理，复用/统一，回归成本下降。
- 双端体验一致：桌面键盘 + 触屏手势共存，触控热区达 44px（可达性达标）。
- 安卓返回键符合平台习惯（开 3D 时关层，否则透传）。
- 为两城邦"同款"视觉打基础，减少未来分叉。

**负面 / 风险**
- `skeleton.ts` 生命周期（`close3D`/`unsubs`/`_active3DClose`）较脆，抽组件须回归：3D 开关、ESC、切模型清层、组件销毁 WebGL 回收（L546–L576、L624）。
- 引入 `iconify-icon` 增加依赖（或自维护 SVG 增加维护量）。
- 原生补 back 钩子需 Android 端联调，跨端排期依赖。

**已知遗留**
- 跨项目长期"同款"若不复用**共享 design token**，仍可能再次分叉；本次先单城邦（YSM）落地，共享 token 抽离列为后续立项（不在本次范围）。

---

## 4. 数据溯源

| 来源 | 结论 |
|---|---|
| `skeleton.ts` L297–L624（内联 `style.cssText` 按钮） | → 决策 2.2：抽 `fab.ts` 组件替换 |
| `skeleton.ts` L34–L40 / L547–L584（`close3D`/`unsubs`/`_active3DClose`） | → 决策 2.2/2.3：沿用生命周期纪律，不破坏清层 |
| MikuMikuAR `app.css` L250 / L266 / L551（`@media` 480px / 横屏 500px / `pointer:coarse` 44px） | → 决策 2.4：断点直接复用 |
| MikuMikuAR `menus/nav-actions.ts` L289 `handleAndroidBack` | → 决策 2.5：返回键桥范式 |
| MikuMikuAR `core/icons.ts` `createIconButton` | → 决策 2.6：图标按钮工厂 |
| YSM `utils/dom/android-bridge.ts` L24 `isViewerMode`（无 back 钩子） | → 决策 2.5：桥扩展点 + 原生补通道 |
| ADR-047 / ADR-049（触屏 / 网页版桥接基线） | → 决策 2.4/2.5：双端统一基础 |

<!-- 文件名: 3d-preview-fab-responsive.md → 实际文件 ADR-057-3d-preview-fab-responsive.md -->
