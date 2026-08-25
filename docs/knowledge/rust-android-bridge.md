---
kind: architecture
name: Rust Scanner Bridge 全平台支持
tier: architecture
category: core
source_files:
  - go/rustbridge/bridge_android.go
  - go/rustbridge/bridge_linux.go
  - go/rustbridge/bridge_darwin.go
  - go/rustbridge/types.go
  - go/scanner/rust_backend_android.go
  - go/scanner/rust_backend_linux.go
  - go/scanner/rust_backend_darwin.go
  - scripts/compile-android-rust.mjs
  - scripts/compile-rust-static.mjs
use_when:
  - Android
  - Linux
  - macOS
  - rust_backend
  - CGO
invariant_anchors:
  - go/rustbridge/bridge_android.go|Scan
---

# Rust Scanner Bridge 全平台支持

在原有 Windows DLL embed 基础上，新增 Android/Linux/macOS 的 CGO 静态链接支持。

## 架构设计

| 平台 | 方案 | 触发条件 |
|------|------|---------|
| Windows | DLL embed + 动态加载 | windows && rust_backend |
| Android | CGO 静态链接 | android && rust_backend |
| Linux | CGO 静态链接 | linux && rust_backend |
| macOS | CGO 静态链接 | darwin && rust_backend |

## 编译流程

1. Rust 编译（compile-android-rust.mjs）: cargo build --release --target=aarch64-linux-android
2. Go 交叉编译: go build -buildmode=c-shared -extldflags="-L<path> -l:libysm_model_manager_wails_bridge.a"

## 不变量

- ABI 兼容：所有平台使用同一套 C ABI（YsmBuffer 结构体）
- 错误处理：Rust panic 被 catch_unwind 捕获，返回 JSON error
- 内存管理：Go 负责 free，通过 ysm_buffer_free 回调释放
- 回退机制：bridge 不可用时自动回退到 Go scanner
