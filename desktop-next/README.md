# YSM Model Manager Next

这是 Rust/Tauri 重构线的桌面壳，不替换现有 Wails 应用，直到迁移门槛满足。

## 当前目标

- 首屏只走快速文件发现与元数据索引，不同步做完整内容哈希。
- `rust-index` 保存上一次扫描状态，完整刷新时只报告 added / updated / removed 差量。
- 选定模型库后由 `notify` 递归监听文件变化：普通文件事件局部重扫所在目录并精确更新 path，目录级结构变化才回退完整刷新。
- watcher 产生的差量通过 Tauri `library-delta` 事件直接推给 UI，不要求用户手动刷新。
- UI 使用固定行高虚拟列表，只渲染可视区域附近的资源行。
- 不引入 React/Vue 和额外前端运行时；Tauri 直接托管静态 HTML/CSS/JS。
- 继续把仓库根目录的 `resource_types.json` 编译进桌面壳，避免资源类型规则出现第二份事实来源。

## 目录

- `src-tauri/`：Tauri 2 应用壳、IPC commands 与文件 watcher。
- `ui/`：高密度桌面 UI，浏览器直接打开也能进入演示数据预览。
- `../rust-index/`：保存扫描快照、计算全量差分，并消费 watcher 的局部路径事件。
- `../rust-core/`：并行扫描与延迟 SHA-256 核心。

## 本阶段已接通的 IPC / Events

- `scan_library(root)`：首次扫描指定目录，并启动递归 watcher。
- `refresh_library()`：手动执行一次完整扫描校验并计算差量。
- `library_snapshot()`：读取内存中的当前索引快照。
- `library-delta`：文件变化后的 added / updated / removed 差量。
- `library-watch-error`：底层文件监听错误。

## 运行

安装 Tauri 2 所需平台依赖后：

```bash
cargo run --manifest-path desktop-next/src-tauri/Cargo.toml
```

单独看 UI 可以直接用任意静态文件服务器打开 `desktop-next/ui/`。不在 Tauri 中运行时会自动生成演示数据，以便检查布局、虚拟滚动和筛选交互。

## 还没迁移

后台 hash hydration / hash cache、导入/删除/启停、实例同步、3D 预览、标签数据库、设置和更新器仍由现有应用负责。它们会按“读路径优先、写路径后迁移”的顺序逐步进入 Rust，不做一次性大爆炸重写。
