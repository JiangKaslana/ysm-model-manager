---
kind: import-queue
name: 全局导入执行 import-executor
tier: architecture
category: feature
source_files:
  - frontend/src/features/import-executor.ts
  - frontend/src/features/import-dnd.ts
  - frontend/src/features/dnd-shared.ts
  - frontend/src/features/dnd-collector.ts
tests:
  - frontend/src/features/import-executor.test.ts
  - frontend/src/features/import-dnd.test.ts
  - frontend/src/features/dnd-shared.test.ts
  - frontend/src/features/dnd-collector.test.ts
use_when:
  - 导入
  - 导入队列
  - 拖拽导入
  - 文件夹导入
  - 覆盖导入
  - import
  - 拖拽
invariant_anchors:
  - frontend/src/features/dnd-shared.ts|isImportableFile
  - frontend/src/features/import-executor.ts|executeCollected
---

# 全局导入执行 import-executor

## 概览

**2026-08-05 重构**：原 `import-queue.ts`（导入 tab UI 层）与 `ImportHistory`（内存导入历史）已全部删除。导入改为**全局静默执行**架构——拖拽/选择文件直接走 `import-executor.ts` 执行落盘，不依赖任何 tab 挂载。核心链路：

`拖拽源 → collectFiles 收集 → groupCollected 分组 → executeCollected 执行 → Go binding 落盘 → bus 广播刷新`

## 核心模块

### import-executor.ts（全局执行器）

- `directImport(file)`：`FileReader` 读 base64 → `ImportModelFile(name, base64)` 直导（保留原文件名，类型路由/冲突判定全在 Go 端）→ toast 成功/失败；`ysm.json` 单文件拦截引导拖整个文件夹
- `importFolder(dir, files, rtype)`：按顶层目录名为模型名、`dir` 前缀为 `subpath`，逐个文件转 base64；**上下文路由**（2026-08-24）：`rtype` 非空走 `ImportModelFolderTo(folderName, subpath, rtype, items)` 按页面类型仓库根落盘，空串回退 `ImportModelFolder` 内容推断；逐文件读取失败跳过不拖垮整组
- `executeCollected(collected, rtype)`：`groupCollected` 分组后先整组文件夹、后散落单文件，返回 `{ folders, singles }` 计数
- `importWebFilesWithToast(files, onFinally)`：网页版导入，经 `importWebFiles` 直写 IndexedDB
- `_inFlight: Set<string>`：per-file/folder 在途去重，键含 `name+size+lastModified` 防同名不同源误判

### import-dnd.ts（仓库页拖拽）

- `handleTreeDrop(e, isBusy, setBusy, rtype)`：`<app-tree>` 容器内 drop 处理
  - 网页版：`resolveWebMode()` → `importWebFilesWithToast`
  - 桌面版：`dataTransfer.files` + `webkitGetAsEntry` 补充收集 → `executeCollected`
- `bindTreeDnD(container, rtype)`：注册 `dragover`/`dragleave`/`drop` 到 document 层，通过 `composedPath` 判定是否命中容器；**rtype 支持 getter**（动态切换树根类型，drop 时才取值防闭包残留）
- 含 100MB 超量逐文件过滤 + busy 状态守卫

### dnd-shared.ts（共享判定）

- `isSupportedFile(name)`：扩展名是否在 `ALL_EXTS` 支持列表
- `isImportableFile(name)`：`.json` 仅放行 `ysm.json` 入口清单（包内 `main.json`/`*.animation.json`/`zh_cn.json` 等不得单独导入），与 `go/scanner/scanner.go:80-87` 白名单对齐
- `shouldEnterForm(name)`：**仅 `ysm.json` 返回 true**（当前仅用于表单分流，整组导入不进表单）
- `groupCollected(collected)`：按顶层目录分组，组内至少 1 个支持文件才整组导入，否则整组丢弃
- 类型：`CollectedEntry`、`FolderGroup`

### dnd-collector.ts（文件收集器）

- `collectFiles(items, isEntryArray, basePath, depth)`：递归收集 `DataTransferItem[]` 或 `FileSystemEntry[]`
- `getFileFromEntry(entry)`：`FileSystemFileEntry.file()` Promise 化 + 5s 超时兜底
- `readEntries` 3s 超时防 WebView2 卡死，`MAX_DEPTH=10` 防递归过深
- 错误静默跳过（warn 日志），不拖垮整批

## 对外 API / 入口

- import-executor 导出：`directImport`、`importFolder`、`executeCollected`、`importWebFilesWithToast`、`isImportableFile`
- import-dnd 导出：`handleTreeDrop`、`bindTreeDnD`
- dnd-shared 导出：`isSupportedFile`、`isImportableFile`、`shouldEnterForm`、`getExt`、`groupCollected`、类型 `CollectedEntry`/`FolderGroup`
- dnd-collector 导出：`collectFiles`、类型 `CollectedFile`
- 派发 bus：`toast:show`、`stats:refresh`、`tree:reload`
- getApp() 调用：`ImportModelFile`、`ImportModelFolder`、`ImportModelFolderTo`、`AddOpLog`

## 关键机制

- **静默直导**：完成后 `stats:refresh` + `tree:reload` 双事件联动，无导入 tab 依赖
- **并发/重复守卫**：`_inFlight` 持 per-file 指纹（name+size+lastModified），同名不同源文件不误判；busy 命中 toast 反馈（不静默）
- **逐文件容错**：文件夹导入中单个文件读取失败跳过（warn 日志），不拖垮整组
- **上下文路由守卫**：`ImportModelFolderTo` 不可用时（旧桥/Android 时序）降级为内容推断 + warn toast，不静默错位
- **ysm.json 拦截**：`directImport` 遇 `ysm.json` 单文件 toast 引导拖整个文件夹走整组路径
- **100MB 防线**：逐文件 `MAX_IMPORT_BYTES` 过滤，超限跳过 + toast 提示
- **Shadow DOM 穿透**：`bindTreeDnD` 用 `document.addEventListener` + `composedPath` 判定命中，跨 ShadowRoot 边界正常触发

## 与其他子系统关系

- 由 [app-tree](./app-tree.md) 调用 `bindTreeDnD` 注册仓库页拖拽
- 与 [global-handlers](./global-handlers.md) 分工：全局 DnD 遮罩已删除（ADR-060 收敛至组件级），拖拽全部走 `app-tree` 容器绑定
- 类型判定/归类归 Go（`resource_types.json` + `go/scanner`），前端只透传上下文类型
- 单文件落盘见 [go_importer](./go-importer.md)，文件夹整组写入见 `go/fileops.WriteModelFolder`（[go_fileops](./go-fileops.md)）

## 不变量

- `isImportableFile` 的 `.json` 白名单仅放行 `ysm.json`，与 `go/scanner/scanner.go:80-87` 对齐
- `groupCollected` 组内至少 1 个支持文件才整组导入（与后端 `isSupportedEntryFile` 对齐）
- `_inFlight` 键 = `name:size:lastModified`，防止跨源同名文件误判在途
- `bindTreeDnD` 文档级监听 + `composedPath` 判定，Shadow DOM 穿透红线
- `rtype` getter 支持动态切换，drop 时惰性取值防闭包残留旧类型

## 相关

- [global_handlers](./global-handlers.md) — 全局拖拽入口（历史，已收敛至组件级）
- [app-tree](./app-tree.md) — 仓库页组件，调用方
- [go-importer](./go-importer.md) — Go 端导入实现
- [go-fileops](./go-fileops.md) — Go 端文件操作（WriteModelFolder）