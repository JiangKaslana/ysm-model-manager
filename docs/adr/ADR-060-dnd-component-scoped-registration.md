# ADR-060：拖拽导入收敛：按组件域注册，去掉全局遮罩

- **状态**：🔄 部分采纳（方向已定，编码待立项落地）
- **日期**：2026-08-14
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/features/import-dnd.ts`、`frontend/src/features/import-queue-data.ts`、`frontend/src/views/app-tree/index.ts`、`frontend/src/app-modules.ts`、`maintenance.md #1`

---

## 1. 背景（Context）

当前拖拽导入存在三组结构性问题：

### 1.1 全局 document 监听 + 页面门控的低效耦合

`import-dnd.ts` 的 `registerDnD` 在 `document` 上注册 5 组事件（dragenter/dragover/dragleave/drop/dragend），靠 `PageStore.currentPage !== "repository" → return` 做页面级门控。结果：

- 全局 DOM 上有 5 个永驻 listener，跨所有页面生命周期；
- 每次拖拽都要遍历 dragDepth 计数 + 遮罩显隐逻辑，即使不在仓库页也触发 `onDragEnter`；
- `app-modules.ts:131-146` 需要额外在 capture 阶段防 `#ws-page`、`#dl-drop` 被浏览器默认行为吃掉，属于打补丁式防御。

### 1.2 两套收集器

- `import-dnd.ts` 的 `collectFiles`（entry.file 5s 超时 + readEntries 3s 超时 + depth > 10 上限 + Set 去重）；
- `import-queue-data.ts` 的 `collectEntry`（无超时、无深度上限）。

同一 DnD 功能两套实现、两套失败语义，维护漂移风险高（`maintenance.md #1` 已记录）。

### 1.3 隐式功能 + 全局遮罩的 UX 问题

用户拖文件到窗口任意位置才出现 `#global-drop-overlay`，引导成本高。而导入页 `#dl-drop` 是显式可见的 drop zone，有明确的视觉提示。两者体验不对称。

---

## 2. 决策（Decision）

### D1 · 按组件域注册拖拽事件

把 DnD 监听从 `document` 级收拢到各组件容器节点：

- **仓库页文件树**：在 `<app-tree>` 容器上绑定 `dragover` / `drop`，显示显式 drop zone 提示（类似 `#dl-drop`），无需全局遮罩；
- **社区/工坊页**：已有 `site/drag.ts` 绑定在 `#cr-drop-zone` 上，保持现状；
- **导入队列页**：已有 `import-queue-events.ts` 绑定在 `#dl-drop` 上，保持现状。

### D2 · 统一收集器

把 `collectFiles`（桌面 webkitGetAsEntry 路径）抽为 `features/dnd-collector.ts` 的公共工具函数，`import-dnd.ts` 和 `import-queue-data.ts` 共用同一实现，删除 `collectEntry`。

### D3 · 删除全局遮罩

`#global-drop-overlay` 及其全部 show/hide 逻辑（`showDropOverlay` / `hideDropOverlay` / `dragDepth` / `_dropBusy`）随 `registerDnD` 废弃一并删除。`app-modules.ts` 中的 capture 阶段拦截（line 131-146）同步移除。

### D4 · 显式提示优于隐式触发

仓库页 drop zone 始终可见（空树区域或文件树容器边缘），用户在仓库页就能感知到可以拖入文件，消除"拖了才提示"的困惑。

---

## 3. 后果（Consequences）

**正面**：

- 事件绑定范围收敛到组件内，不再受 PageStore 门控影响，也不需要 capture 阶段补丁；
- 单一收集器，消除两套实现漂移风险（`maintenance.md #1` 闭环）；
- 无全局遮罩，WebView2 下相关坐标/pointer-events bug 消失；
- 用户引导成本降低：仓库页直接看到 drop zone 提示。

**负面 / 注意**：

- 改动涉及 `import-dnd.ts`（核心 DnD 模块）、`app-tree/index.ts`（绑定新监听）、`app-modules.ts`（删除补丁）、`import-queue-data.ts`（统一收集器）四个文件的结构重组，测试需要同步更新（`import-dnd.test.ts` 大量覆盖 `registerDnD` 全局行为，需重写为组件级测试）；
- 网页版（ADR-049）的 `import-dnd.ts` 走 `resolveWebMode()` 分支，需确认重构后仍正确路由；
- `import-dnd.ts` 被 `app-content/index.ts` 以 `registerDnD(unsubs)` 形式调用，改为组件内部绑定后需调整调用点。

**已知遗留**：

- 本 ADR 仅收敛仓库页的文件拖拽导入；其他页面的 DnD（如资源管理器）暂不纳入。
- 文件关联双击打开（`os.Args[1:]`，`maintenance.md #7`）是另一条独立路径，与本 ADR 无交集，不在此范围。

---

## 4. 数据溯源

- **来源**：用户反馈（2026-08-14）+ `maintenance.md` #1 dnd 两套收集器收敛立项；
- **决策依据**：现有 `site/drag.ts` 与 `import-queue-events.ts` 的组件内绑定模式已被验证为正确的隔离范式；
- **落地计划**：独立立项，暂不在常规轮次 rush；落地时需先写组件级单测再改绑定逻辑，防回归。

<!-- 文件名: dnd-component-scoped-registration.md → 实际文件 ADR-060-dnd-component-scoped-registration.md -->
