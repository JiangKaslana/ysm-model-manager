package app

import "net/http"

// CoopCoepMiddleware 注入 COOP/COEP 响应头（ADR-079 M2：桌面 Wails 解锁 SharedArrayBuffer
// → 支持 pthread WASM 多线程解码）。mpr build tag 门控（mpr_off.go 默认关 / mpr_on.go 开）：
// 桌面默认不注入（无需多线程 WASM 时保持零额外语义）；需要时 `-tags mpr` 构建启用。
// 借鉴 MikuMikuAR CoopCoepMiddleware（ADR-099）。COEP 用 require-corp：桌面本地服务
// 无第三方跨源资源依赖，可严格隔离；网页版才需要 credentialless（见 coi-sw.ts 注释）。
func CoopCoepMiddleware(next http.Handler) http.Handler {
	if !coopCoepEnabled {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cross-Origin-Opener-Policy", "same-origin")
		w.Header().Set("Cross-Origin-Embedder-Policy", "require-corp")
		next.ServeHTTP(w, r)
	})
}
