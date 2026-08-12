//go:build !windows

package fsutil

import (
	"os"
	"syscall"
)

// IsHardLink 判断路径是否为硬链接（nlink > 1）。
// Unix/macOS 通过 os.FileInfo.Sys().(*syscall.Stat_t).Nlink 字段获取。
// 目录不参与硬链接判断：目录 nlink = 2 + 子目录数恒 > 1（. / .. / 每子目录 1 链接），
// 误判会导致文件夹模型 Move 被当硬链接直接删除（ADR-038 D3.4）。
// 统一收敛自 sync/checkHardLink 与 recycle/isHardLink 两份复制（sync 侧曾缺目录排除）。
func IsHardLink(path string) bool {
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return false
	}
	if stat, ok := info.Sys().(*syscall.Stat_t); ok && stat.Nlink > 1 {
		return true
	}
	return false
}
