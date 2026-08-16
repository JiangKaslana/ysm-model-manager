//go:build !mpr

package app

// coopCoepEnabled 控制 COOP/COEP 响应头注入（ADR-079 M2）。
// 默认关：桌面构建不注入（单线程 WASM 够用，保持零额外语义）；
// `-tags mpr` 构建启用（见 mpr_on.go）。
const coopCoepEnabled = false
