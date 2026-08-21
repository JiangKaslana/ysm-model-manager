package fsutil

import "fmt"

// FormatSize 人性化字节大小（B/KB/MB/GB 分级）。
// 单一事实来源——cli/repoaudit 的 formatSize 均委托本函数，防多处实现口径漂移。
func FormatSize(bytes int64) string {
	switch {
	case bytes < 1024:
		return fmt.Sprintf("%dB", bytes)
	case bytes < 1024*1024:
		return fmt.Sprintf("%.1fKB", float64(bytes)/1024)
	case bytes < 1024*1024*1024:
		return fmt.Sprintf("%.1fMB", float64(bytes)/(1024*1024))
	default:
		return fmt.Sprintf("%.1fGB", float64(bytes)/(1024*1024*1024))
	}
}
