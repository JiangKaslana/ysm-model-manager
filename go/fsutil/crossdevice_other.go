//go:build !windows

package fsutil

import (
	"errors"
	"syscall"
)

// IsCrossDeviceErr 判断 rename/链接失败是否为跨设备（EXDEV）。
// os.Rename 返回的 *LinkError 可被 errors.Is 穿透。
// 统一收敛自 recycle/isCrossDeviceErr 与 installer/errnoIs 的跨设备分支
// （Windows 错误码 17 与 POSIX EXDEV 18 语义不同，见 crossdevice_windows.go）。
func IsCrossDeviceErr(err error) bool {
	return errors.Is(err, syscall.EXDEV)
}
