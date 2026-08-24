//go:build windows && rust_backend

package scanner

import (
	"encoding/json"
	"time"

	"ysm-model-manager/go/rustbridge"
	"ysm-model-manager/go/types"
)

func scanEntriesWithRust(dir string) ([]types.ModelEntry, bool, bool) {
	registryJSON, err := json.Marshal(types.LoadRegistry())
	if err != nil {
		emitScanError("[scanner] serialize registry for Rust backend: %v", err)
		return nil, false, false
	}
	// ADR-120：优先复用 Go 已缓存的扫描结果作为 manifest 传给 Rust，跳过 jwalk 全树发现。
	// 注意：此处用**非回源**的缓存只读（直接读 scanCache），不可调 ScanEntriesWithHit——
	// 后者在缓存未命中时会回源到本函数（scanEntriesWithRust），造成 single-flight 递归死锁。
	key := normalizeScanKey(dir)
	if v, ok := scanCache.Load(key); ok {
		entry := v.(scanCacheEntry)
		if time.Now().Before(entry.expiresAt) && len(entry.entries) > 0 {
			if manifestJSON, mErr := json.Marshal(entry.entries); mErr == nil {
				response, rErr := rustbridge.ScanManifest(dir, registryJSON, manifestJSON)
				if rErr == nil {
					for _, scanError := range response.Errors {
						emitScanError("[scanner] Rust manifest scan error: %s: %s", scanError.Path, scanError.Message)
					}
					if response.Entries == nil {
						response.Entries = []types.ModelEntry{}
					}
					return response.Entries, response.Cacheable, true
				}
				emitScanError("[scanner] Rust manifest scan failed, falling back to jwalk: %v", rErr)
			}
		}
	}
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
