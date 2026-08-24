//go:build windows && rust_backend

package scanner

import (
	"encoding/json"

	"ysm-model-manager/go/rustbridge"
	"ysm-model-manager/go/types"
)

func scanEntriesWithRust(dir string) ([]types.ModelEntry, bool, bool) {
	registryJSON, err := json.Marshal(types.LoadRegistry())
	if err != nil {
		emitScanError("[scanner] serialize registry for Rust backend: %v", err)
		return nil, false, false
	}
	// scanCache 是 30s TTL 的进程内存缓存（scanner.go），且 ScanEntriesWithHit 命中即返回、不进本函数。
	// 故「能进本函数」与「scanCache 持有未过期条目」在时间上互斥——此处无法复用 Go 缓存作为 manifest。
	// Rust 深加工入口 rustbridge.ScanManifest 保留为显式独立 API（见 ADR-120）：仅当业务代码主动持有
	// 一份 Go entries 并想让 Rust 在其上深加工时，由调用方显式调用，绝不走本函数的隐式分支。
	response, err := rustbridge.Scan(dir, registryJSON)
	if err != nil {
		emitScanError("[scanner] Rust backend unavailable, falling back to Go: %v", err)
		return nil, false, false
	}
	for _, scanError := range response.Errors {
		emitScanError("[scanner] Rust scan error: %s: %s", scanError.Path, scanError.Message)
	}
	if response.Entries == nil {
		response.Entries = []types.ModelEntry{}
	}
	return response.Entries, response.Cacheable, true
}
