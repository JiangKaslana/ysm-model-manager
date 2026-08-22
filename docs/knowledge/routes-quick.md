# AI 急速版路由表（高频场景）

> **用途**：AI 遇到高频交互问题时，秒级定位知识卡，无需遍历完整路由表。
> **设计原则**：按用户意图分组，每组 ≤5 个高频场景，标注首选卡 + 红线警告。
> **生成**：手工维护（非自动生成），随高频场景演化更新。
> **完整路由**：见 [`routes.md`](./routes.md)（全量自动生成）。

---

## 🎯 3D 预览与模型追加（最高频）

| 用户意图 | 首选卡 | 红线警告 | 关联 ADR |
|----------|--------|----------|----------|
| 追加模型、同台加载、多模型同框 | [preview_core](./preview_core.md) | **跨类型必须走 `switchExternal`，禁止直接调 `adapter.build`** | ADR-115 |
| 模型切换、会话内替换 | [preview_core](./preview_core.md) | `switchTo` 仅同类型；跨类型用 `switchExternal` | ADR-093 |
| 3D 预览菜单、根菜单、dock 按钮 | [preview_core](./preview_core.md) | 适配器项经 `setAdapterItems` 注入，禁止内联 | ADR-076 |
| VRM 动画播放、VRMA | [preview_core](./preview_core.md) | 必须 `mixer.update(dt)` → `vrm.update(dt)`，禁止手动 `vrm.humanoid.update()` | - |
| 相机控制、OrbitControls | [model3d](./model3d.md) | 相机定位公式固定：`position(0, 80, -120)`, `target(0, 80, 0)` | - |

**快速决策树**：
```
用户问「追加模型」
  ├─ 同类型（如 YSM→YSM）→ switchTo(path, { keepInScene: true })
  └─ 跨类型（如 YSM→VRM）→ switchExternal(path, siblings, { keepInScene: true })
       └─ 禁止：ctx.adapter.build(path) ← 必崩
```

**实现链路**：
```
preview-menu.ts:1085-1088（➕ 点击）
  → ctx.switchExternal(path, siblings, { keepInScene: true })
  → preview-library.ts:119-120（withPreviewExtras 注入）
  → openModel3DFullscreen(path, { cooperate: true })
  → switchPreview(path, { keepInScene: true })
  → switchToSession(path, { keep: true })
  → adapter.build() 复用当前会话
```

---

## 🔍 模型扫描与仓库管理

| 用户意图 | 首选卡 | 红线警告 | 关联 ADR |
|----------|--------|----------|----------|
| 扫描模型、ScanModelEntries | [go-scanner](./go-scanner.md) | 容器指纹缓存失效需调 `ClearScanCache` | ADR-082 |
| 资源类型识别、rtype 判定 | [resource-registry](./resource-registry.md) | `resource_types.json` 是唯一事实来源 | ADR-065 |
| 去重检测、dedup | [go-dedup](./go-dedup.md) | 按 `path + modtime + size` 指纹 | - |
| 整合包同步、sync | [go-sync](./go-sync.md) | 同步项按 `VersionInstance` 实例隔离 | ADR-064 |
| 仓库审计、健康分 | [go_repoaudit](./go_repoaudit.md) | 健康分 = 完整性 × 缓存命中率 | - |

---

## 📦 导入与安装

| 用户意图 | 首选卡 | 红线警告 | 关联 ADR |
|----------|--------|----------|----------|
| 导入模型、import | [go-importer](./go-importer.md) | 按 rtype 路由到注册策略 | ADR-058 |
| 下载模型、workshop | [go-download](./go-download.md) | 进度回调必须处理 ctx 取消 | - |
| 安装到整合包 | [go-installer](./go-installer.md) | `LinkMode` 决定 copy/hardlink/symlink | ADR-038 |
| 导入队列、批量导入 | [import-queue](./import-queue.md) | 全局执行器 `import-executor.ts` 是唯一入口 | - |
| 文件操作、移动/复制/删除 | [go-fileops](./go-fileops.md) | 整组操作（ysm.json）原子写 | - |

---

## 🧩 后端桥接与数据存储

| 用户意图 | 首选卡 | 红线警告 | 关联 ADR |
|----------|--------|----------|----------|
| Wails 绑定、Go 调用 | [wails-bridge](./wails-bridge.md) | 前端必须经 `getApp()` 访问，禁止直调 `window.go` | ADR-049 |
| IndexedDB、网页版存储 | [backend-idb](./backend-idb.md) | 事务必须接线 `complete/error/abort` 三事件 | ADR-249 |
| 网页版后端、browser adapter | [backend_web](./backend_web.md) | COI 隔离头必须注入 | ADR-071 |
| Android 桥接、SAF | [android-bridge](./android-bridge.md) | 桌面端无 Java 桥，返回 null 不崩 | ADR-046 |
| WASM 内存、YSM 解码 | [wasm-memory-pitfalls](./wasm-memory-pitfalls.md) | `_malloc` 后 HEAPU8 视图可能失效 | ADR-066 |

---

## 🎨 UI 组件与交互

| 用户意图 | 首选卡 | 红线警告 | 关联 ADR |
|----------|--------|----------|----------|
| 预览面板、2D 骨骼 | [app-preview](./app-preview.md) | `model:select` 回调必须比对 `_previewGen` 防覆盖 | ADR-072 |
| 悬浮按钮、FAB | [dom-fab](./dom-fab.md) | 挂载 `document.body`（light DOM），样式全局生效 | ADR-057 |
| 弹窗、modal | [dialog-modal](./dialog-modal.md) | Promise 化，单例管理活动弹窗 | - |
| 右键菜单 | [context-menu](./context-menu.md) | 声明与行为分离：`menu-defs.ts` 是唯一事实源 | - |
| 指针事件、触屏交互 | [pointer-events](./pointer-events.md) | 统一 `pointerdown/move/up`，弃用 mouse 事件 | ADR-047 |

---

## 🧪 测试与治理

| 用户意图 | 首选卡 | 红线警告 | 关联 ADR |
|----------|--------|----------|----------|
| Vitest 环境、node vs happy-dom | [vitest-env-switch](./vitest-env-switch.md) | 无 DOM 依赖测试切 `node` 环境降墙钟 | ADR-255 |
| 代码审核、checklist | [cli_quality_audit](./cli_quality_audit.md) | 关注绑定层覆盖率、红线 violation | ADR-109 |
| 知识漂移、drift scan | [drift-scan](./drift-scan.md) | 代码变更后必须更新知识卡 | ADR-087 |
| ADR 编写、决策记录 | [adr/index](../adr/index.md) | 新 ADR 走 `scripts/new-adr.mjs`，禁止手写编号 | ADR-232 |
| 脚本规范、.mjs | [gen-routes.mjs](../../scripts/gen-routes.mjs) | 零依赖、退出码 1 表示失败 | ADR-241 |

---

## 🚨 高频陷阱速查

| 陷阱 | 位置 | 正确做法 |
|------|------|----------|
| 跨类型追加走错适配器 | `preview-menu.ts:1085` | 必须经 `switchExternal` → `openModel3DFullscreen(cooperate)` |
| 异步回调写入已卸载 DOM | `skeleton.ts:82` | 每个 `await` 后检查 `container.isConnected` |
| IndexedDB 事务未接 abort | `backend-idb.md` | `tx.onabort` 必须接线，否则 Promise 永不等 settle |
| `vrm.humanoid.update()` 手动调用 | `preview_core.md` | 禁止！会导致 T-pose 回归，只用 `vrm.update(dt)` |
| 知识卡与 ADR 不同步 | `check-knowledge-drift.mjs` | 提交 ADR 后必须同步更新对应知识卡 |

---

## 📝 更新纪律

1. **新增高频场景** → 补充到对应分组，≤5 行/场景
2. **发现新红线** → 立即添加到「高频陷阱速查」
3. **月度审计** → 运行 `node scripts/check-knowledge-drift.mjs` 验证时效性
4. **禁止** → 手动编辑此文件后不 commit；必须走 `git commit --docs`

---

## 🔗 与完整路由表的关系

| 文件 | 用途 | 生成方式 |
|------|------|----------|
| `routes-quick.md`（本文件） | 高频场景速查，AI 优先读 | 手工维护 |
| `routes.md` | 全量意图路由，覆盖所有 use_when 关键词 | 自动 `gen-routes.mjs` |
| `index.md` | 知识卡索引，按分类组织 | 自动 `gen-knowledge-index.mjs` |

**AI 查询流程**：
```
用户问题
  ↓
1. 命中 routes-quick.md 高频场景？
   ├─ 是 → 直接读首选卡（秒级）
   └─ 否 → 查 routes.md 全量路由
  ↓
2. 打开首选知识卡
  ↓
3. 需要源码细节 → 按 source_files 路径跳转
```

<!-- 最后更新：2026-08-23 | 覆盖：5 大域 25 高频场景 | ADR-115 三态语义已固化 -->
