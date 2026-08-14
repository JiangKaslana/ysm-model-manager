---
kind: backend-idb
name: 浏览器后端 IndexedDB 封装
tier: architecture
adr:
  - ADR-177
category: core
source_files:
  - frontend/src/backend/idb.ts
  - frontend/src/backend/types.ts
  - frontend/src/backend/app.ts
  - frontend/src/backend/browser-adapter.ts
  - frontend/src/backend/web-common.ts
  - frontend/src/backend/web-fs.ts
  - frontend/src/backend/web-store.ts
  - frontend/src/backend/web-community.ts
  - frontend/src/backend/platform.ts
tests:
  - frontend/src/app-modules.test.ts
  - frontend/src/backend/app.test.ts
  - frontend/src/backend/browser-adapter.contract-b1.test.ts
  - frontend/src/backend/browser-adapter.contract-b2.test.ts
  - frontend/src/backend/browser-adapter.contract-b3.test.ts
  - frontend/src/backend/browser-adapter.test.ts
  - frontend/src/backend/idb.test.ts
  - frontend/src/backend/platform.test.ts
  - frontend/src/utils/resource/types.test.ts
  - frontend/src/views/app-content/app-content.component.test.ts
  - frontend/src/views/app-content/app-content.methods.test.ts
  - frontend/src/views/app-preview/app-preview.component.test.ts
  - frontend/src/views/app-preview/app-preview.methods.test.ts
  - frontend/src/views/app-sidebar/app-sidebar.component.test.ts
  - frontend/src/views/app-sidebar/app-sidebar.sync.test.ts
  - frontend/src/views/app-tree/app-tree.component.test.ts
  - frontend/src/views/app-tree/app-tree.state.test.ts
use_when:
  - IndexedDB
  - 网页版
  - backend
  - 模型库
  - browser adapter
  - web mode
invariant_anchors:
  - frontend/src/backend/idb.ts|openDB
  - frontend/src/backend/browser-adapter.ts|browserAdapter
---

# 浏览器后端 IndexedDB 封装

## 概览

`backend/` 目录是 YSM 网页版的后端抽象层（ADR-049 Phase 1-2），在桌面/Android 走 Wails Go 绑定、网页版走 `browser-adapter.ts` + `idb.ts` 的同一接口。`idb.ts` 是 IndexedDB 轻量封装，内置内存降级（隐私模式/非浏览器环境自动切换，OOM 保护）。`app.ts` 提供统一的 `getApp()` 入口，屏蔽平台差异。

## 核心职责

### idb.ts — IndexedDB 封装
- **双存储策略**: IndexedDB（生产） + 内存 Map（降级），由 `forcedMemory` 标志切换
- **OOM 保护**: 内存降级模式有双上限——条目数 200 条 + 字节估算 64MB，超限按 FIFO 驱逐（近似 LRU：已存在 key 重写时移到队尾）
- **多标签页互锁防护**: `db.onversionchange` 关闭旧连接并置空 `dbPromise`；`onblocked` 明确 reject 而非永久挂起
- **统一 CRUD**: `idbGet` / `idbSet` / `idbDel` / `idbKeys(prefix)` — 全链路 Promise 化，`idbSet`/`idbDel` 监听 `tx.onabort` 防永不 settle

### app.ts — Wails 绑定访问
- **统一入口**: `getApp()` 返回 `AppBindings`，缓存避免重复动态 import
- **平台路由**: `resolveWebMode()` 为真时返回 `browserAdapter`（Proxy），否则走 Wails 原生绑定
- **并发保护**: `_appPromise` 复用，多个并发调用不会重复 import
- **Mock bridge 兼容**: 检测 `window.go.main.App`（E2E/dev 注入点），空对象不缓存（防类型造假穿透）

### browser-adapter.ts — 网页版后端实现（编排壳，ADR-040 按职责拆分）
- **虚拟根 `/web`**: 路径语义与桌面一致（`/web/<type>/<name>/<rel>`），业务调用零改动
- **fail-fast Proxy**: 未实现的 binding 一律抛 `WebUnsupportedError`，杜绝 undefined 静默穿透
- **能力门控**: `'Foo' in browserAdapter` 探测，Phase 3 隐藏未实现功能的 UI
- **拆分子模块**（实现函数/状态迁移，browser-adapter 仅 import 组装 `webImpls`）:
  - `web-common.ts`: 共享原语（`WebUnsupportedError` / `WEB_ROOT` / `MAX_IMPORT_BYTES` / `arrayBufferToBase64`）
  - `web-fs.ts`: 文件系统——`importWebFiles`（File 拖拽 → 两阶段分组：首段粗分组 + 主文件目录收敛 → IDB 落库；多段目录组名（如 `分类1/狐狸`）+ 组内 rel 保留子目录（`tex/face.png`）；主文件优先级 `.ysm > ysm.json > 其他`；超 100MB 跳过）、`scanWebModels`（IDB `dir:` 前缀 → `ModelEntry[]`，自动推导主文件，主文件限组根层、嵌套 rel 不参与竞争）、`readWebFile`/`parseWebModelPath`（多段路径直达 `file:type/rest` / dir key 反向最长前缀匹配，R1 文件层级读取）、`listWebModelDirFiles`（R1 递归列目录下全部文件，对齐桌面 `ListAllFilePaths`，含组内子目录，网页版删除目录移回收站联动依赖）、`selectLocalRepo`（FSA 授权本地仓库）、**FSA 句柄持久化（R2，参照 MikuMikuAR ADR-180/183）**：`saveFsaRootHandle`（句柄结构化克隆落 config store `fsaRootHandle`）、`restoreFsaRootHandle`（仅 queryPermission 恢复，绝不 requestPermission——启动期无手势会被拦截）、`getFsaAuthState`（权限三态 unsupported/none/granted/revoked，供 UI 引导）、`reauthorizeFsaRoot`（须手势内 requestPermission）、`rescanFsaRoot`（启动自愈恢复句柄 + 重扫入库）、删除/重命名/子目录映射
  - `web-store.ts`: 配置（localStorage）、日志环（500 条导入 / 300 条运行时，替代 Go 侧日志）、标签/ban（config store `tags:<path>` / `ban:<path>`）
  - `web-community.ts`: 社区/工坊数据（bundled JSON 默认 + localStorage 覆盖层）、头像批量提取、作者扫描/仓库索引

### platform.ts — 平台环境判定
- **Tier 0**: `globalThis.__YSM_BACKEND__`（入口 HTML 显式声明，权威）
- **Tier 1**: `__YSM_WEB__ === true` 或 `import.meta.env.MODE === 'web'`
- **Tier 2**: 运行时探测 `window.go` / `window.wails`（Phase 3 引入）

## 对外 API / 入口

- `idb.ts`: `openDB()`, `idbGet<T>(store, key)`, `idbSet(store, key, value)`, `idbDel(store, key)`, `idbKeys(store, prefix)`, `_resetDBForTest()`
- `app.ts`: `getApp()` 返回 `Promise<AppBindings>`，`AppBindings` 类型定义
- `browser-adapter.ts`: `browserAdapter` (AppBindings), `importWebFiles(files, type)`, `selectLocalRepo()`, `arrayBufferToBase64(buf)`, `WebUnsupportedError`
- `platform.ts`: `resolveWebMode()`, `isWebEntryMode()`, `readDeclaredBackend()`
- `types.ts`: `AppBindings` 类型定义

## 与其他子系统关系

- `wasm/ysm-parser.ts`: 头像提取、模型解码复用前端 WASM 能力
- `utils/dom/storage.ts`: 配置持久化用 `safeGet`/`safeSet` 包装 `localStorage`
- `resource_types.json`: 资源类型注册表驱动扫描目录映射
- `bindings/`: Wails v3 生成的 Go 绑定（桌面/Android 路径）
- `frontend/src/`: 业务代码统一调 `getApp()` 取得绑定，不感知平台差异

## 不变量

- 网页版无 Go 进程，所有"后端"能力由前端自给（IDB + localStorage + WASM）
- 未实现 binding 必须 fail-fast（`WebUnsupportedError`），不允许 undefined 穿透（治理红线陷阱 #5）
- 内存降级 OOM 保护必须生效（隐私模式无界写入会撑爆堆）
- `browserAdapter` 的 Proxy `then` 陷阱：返回 `undefined` 避免被误判为 thenable
- 原型成员（toString/constructor 等）不走 fail-fast，走默认 Object.prototype 行为
