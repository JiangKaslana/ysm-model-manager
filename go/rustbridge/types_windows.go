//go:build windows && rust_backend

package rustbridge

type nativeBuffer struct {
	ptr *byte
	len uintptr
	cap uintptr
}
