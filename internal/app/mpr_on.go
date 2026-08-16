//go:build mpr

package app

// coopCoepEnabled 控制 COOP/COEP 响应头注入（ADR-079 M2）。
// mpr build tag 开启：桌面 WebView2 解锁 SharedArrayBuffer → 支持 pthread WASM 多线程解码。
const coopCoepEnabled = true
