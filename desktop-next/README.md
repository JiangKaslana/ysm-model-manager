# YSM Model Manager Next

这是 Rust/Tauri 重构线的桌面壳，不替换现有 Wails 应用，直到迁移门槛满足。

## 当前目标

- 首屏只走快速文件发现与元数据索引，不同步做完整内容哈希。
- `rust-index` 保存上一次扫描状态，刷新时只报告 added / updated / removed 差量。
- UI 使用固定行高虚拟列表，只渲染可视区域附近的资源行。
- 不引入 React/Vue 和额外前端运行时；Tauri 直接托管静态 HTML/CSS/JS。
- 继续把仓库根目录的 `resource_types.json` 编译进桌面壳，避免资源类型规则出现第二份事实来源。

## 目录

- `src-tauri/`：Tauri 2 应用壳和 IPC commands。
- `ui/`：高密度桌面 UI，浏览器直接打开也能进入演示数据预览。
- `../rust-index/`：跨刷新保存扫描快照并计算差量。
- `../rust-core/`：并行扫描与延迟 SHA-256 核心。

## 本阶段已接通的 IPC

- `scan_library(root)`：首次扫描指定目录。
- `refresh_library()`：重新扫描当前目录并计算差量。
- `library_snapshot()`：读取内存中的当前索引快照。

## 运行

安装 Tauri 2 所需平台依赖后：

```bash
cargo run --manifest-path desktop-next/src-tauri/Cargo.toml
```

单独看 UI 可以直接用任意静态文件服务器打开 `desktop-next/ui/`。不在 Tauri 中运行时会自动生成演示数据，以便检查布局、虚拟滚动和筛选交互。

## 还没迁移

文件 watcher、导入/删除/启停、实例同步、3D 预览、标签数据库、设置和更新器仍由现有应用负责。它们会按“读路径优先、写路径后迁移”的顺序逐步进入 Rust，不做一次性大爆炸重写。
