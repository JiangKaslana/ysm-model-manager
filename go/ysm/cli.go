// ===== .ysm 解码能力 =====
// 2026-08-08 架构决策（docs/architecture.md §4.1）：YSMParser 统一为内嵌 WASM，
// 取代 exe sidecar——本文件原为 YSMParser.exe 查找（FindCLI），已停用删除，
// 解码入口见 decode_inject.go（SetDecoder 注入，internal/app 以 Node+WASM 实现）。
package ysm
