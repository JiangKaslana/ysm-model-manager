//go:build windows && rust_backend

package rustbridge

import (
	"encoding/json"
	"errors"
	"fmt"
	"runtime"
	"sync"
	"syscall"
	"unsafe"

	"ysm-model-manager/go/types"
)

var (
	loadOnce sync.Once
	loadErr  error
	scanProc *syscall.LazyProc
	freeProc *syscall.LazyProc
)

func Scan(root string, registryJSON []byte) (ScanResponse, error) {
	if err := load(); err != nil {
		return ScanResponse{}, err
	}
	if len(registryJSON) == 0 {
		return ScanResponse{}, errors.New("Rust scanner registry is empty")
	}

	var rootPtr *byte
	if len(root) > 0 {
		rootPtr = unsafe.StringData(root)
	}
	registryPtr := unsafe.SliceData(registryJSON)
	var output nativeBuffer
	status, _, callErr := scanProc.Call(
		uintptr(unsafe.Pointer(rootPtr)), uintptr(len(root)),
		uintptr(unsafe.Pointer(registryPtr)), uintptr(len(registryJSON)),
		uintptr(unsafe.Pointer(&output)),
	)
	runtime.KeepAlive(root)
	runtime.KeepAlive(registryJSON)
	if status != 0 {
		return ScanResponse{}, fmt.Errorf("Rust scanner ABI status %d: %w", status, callErr)
	}
	if output.ptr == nil || output.len == 0 || output.len > uintptr(^uint(0)>>1) {
		return ScanResponse{}, errors.New("Rust scanner returned an invalid buffer")
	}
	defer freeProc.Call(uintptr(unsafe.Pointer(output.ptr)), output.len, output.cap) //nolint:errcheck

	data := append([]byte(nil), unsafe.Slice(output.ptr, int(output.len))...)
	var response ScanResponse
	if err := json.Unmarshal(data, &response); err != nil {
		return ScanResponse{}, fmt.Errorf("decode Rust scanner response: %w", err)
	}
	if response.Error != "" {
		return ScanResponse{}, errors.New(response.Error)
	}
	if response.Entries == nil {
		response.Entries = []types.ModelEntry{}
	}
	return response, nil
}

func load() error {
	loadOnce.Do(func() {
		path, err := materializeDLL()
		if err != nil {
			loadErr = err
			return
		}
		dll := syscall.NewLazyDLL(path)
		scanProc = dll.NewProc("ysm_scan_json")
		freeProc = dll.NewProc("ysm_buffer_free")
		if err := scanProc.Find(); err != nil {
			loadErr = fmt.Errorf("load Rust scanner entry point: %w", err)
			return
		}
		if err := freeProc.Find(); err != nil {
			loadErr = fmt.Errorf("load Rust scanner free entry point: %w", err)
		}
	})
	return loadErr
}
