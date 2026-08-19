package main

import (
	"flag"
	"fmt"
	"strings"
)

// parseFlags 解析 flag 参数（跳过已知的公共参数）
func parseFlags(fs *flag.FlagSet, args []string) {
	var filtered []string
	skipNext := false
	for i, arg := range args {
		if skipNext {
			skipNext = false
			continue
		}
		if arg == "--files-root" {
			if i+1 < len(args) {
				skipNext = true
			}
			continue
		}
		if strings.HasPrefix(arg, "--files-root=") {
			continue
		}
		filtered = append(filtered, arg)
	}
	_ = fs.Parse(filtered)
}

// isPowerOf2 检查是否为 2 的幂
func isPowerOf2(n int) bool {
	return n > 0 && (n&(n-1)) == 0
}

// formatSize 格式化文件大小
func formatSize(bytes int64) string {
	if bytes < 1024 {
		return fmt.Sprintf("%dB", bytes)
	}
	if bytes < 1024*1024 {
		return fmt.Sprintf("%.1fKB", float64(bytes)/1024)
	}
	if bytes < 1024*1024*1024 {
		return fmt.Sprintf("%.1fMB", float64(bytes)/(1024*1024))
	}
	return fmt.Sprintf("%.1fGB", float64(bytes)/(1024*1024*1024))
}

// min 返回两个整数中的较小值
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// max 返回两个整数中的较大值
func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
