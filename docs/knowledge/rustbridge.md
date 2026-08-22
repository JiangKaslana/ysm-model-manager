---
kind: rustbridge
name: Rust 桥 rustbridge
tier: architecture
category: go
source_files:
  - go/rustbridge/bridge_windows.go
  - go/rustbridge/doc.go
  - go/rustbridge/embedded_windows.go
  - go/rustbridge/types_windows.go
  - rust-core/src/model.rs
  - rust-core/src/policy.rs
  - rust-core/src/scan.rs
  - rust-wails-bridge/
tests:
  - rust-core/src/tests.rs
use_when:
  - Rust 扫描器
  - rust_backend
  - 桥 DLL
  - Wails 后端迁移 Rust
---

# Rust 桥 rustbridge

> 窄原生适配器：Wails 后端迁移 Rust 期的临时桥——Windows 生产构建（`rust_backend` tag）下用 Rust 扫描器替代 Go scanner 的窄接口。

## 范围与构建

- **包**：`go/rustbridge/`——全部文件带 `//go:build windows && rust_backend`，非 Windows 或无 tag 编译时被排除
- **桥 DLL**：`rust-wails-bridge/`（Rust crate）编译产出 `ysm_model_manager_wails_bridge.dll`，由 `build/windows/Taskfile.yml` 的 `build:rust-bridge` 构建并拷贝到 `go/rustbridge/bin/`（`platforms: [windows]` 守卫——非 Windows 交叉构建不产 .dll）
- **embed**：`embedded_windows.go` 用 `go:embed` 嵌入桥 DLL + sha256 校验 + 落盘；生产前端不直接 import 本包（doc.go 契约）

## 契约

- **types_windows.go**：`ScanError{Path, Message}` / `ScanResponse{Entries: []types.ModelEntry, Errors}`——对齐 `rust-core`（`ModelEntry` 含 `rtype`，见 `rust-core/src/model.rs`）+ Go `types.ModelEntry`
- **bridge_windows.go**：syscall/unsafe 直调 DLL（JSON 序列化），扫描结果经 `ScanResponse` 返回

## 与 Go scanner 的契约对齐（红线）

Rust 扫描路径必须与 Go scanner 单点口径一致（code review 反复核实的教训）：

| 契约点 | Rust 口径 | Go 单点 |
|--------|----------|---------|
| `.json` 条目门禁 | 仅 `ysm.json`（`is_model_json_name`） | `types.IsYsmEntryJSON`（ADR-038 D2：.json 仅放行 ysm.json；legacy 几何是 FileInventory 分类非扫描条目） |
| 条目名 | ysm.json → 父目录名 | `scanner.go` 同口径重命名 |
| 类型字段 | `ModelEntry.rtype`（registry 首声明优先） | `e.Type`（`SupportedExtsForSubtype` 白名单） |

- **CI 覆盖**（`.github/workflows/test.yml`）：cargo test（rust-core + rust-wails-bridge）+ 构建桥 DLL + `go test -tags rust_backend`——rust_backend 路径不再零覆盖
- **测试**：`rust-core/src/tests.rs` 的 `scan_preserves_go_filter_contract` 锁条目门禁（main/info.json 不入条目 + rtype 传播）

## 相关

- ADR：ADR-115（红线范式——跨类型/跨实现不得绕过单点契约）
- 源码：`rust-core/`（Rust 扫描器核心）、`rust-wails-bridge/`（桥 crate）、`go/rustbridge/`（Go 侧窄适配器）
