//go:build android && rust_backend

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
