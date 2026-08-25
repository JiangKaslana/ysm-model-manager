//go:build !rust_backend

package scanner

import "ysm-model-manager/go/types"

func scanEntriesWithRust(string) ([]types.ModelEntry, bool, bool) {
	return nil, false, false
}
