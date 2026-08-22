//go:build windows && rust_backend

package rustbridge

import "ysm-model-manager/go/types"

type ScanError struct {
	Path    string `json:"path"`
	Message string `json:"message"`
}

type ScanResponse struct {
	Entries   []types.ModelEntry `json:"entries"`
	Errors    []ScanError        `json:"errors"`
	Cacheable bool               `json:"cacheable"`
	Error     string             `json:"error"`
}

type nativeBuffer struct {
	ptr *byte
	len uintptr
	cap uintptr
}
