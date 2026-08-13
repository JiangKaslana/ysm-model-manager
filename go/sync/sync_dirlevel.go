// ===== 文件夹级资源同步（ADR-040 拆分）=====
// 从 sync.go 拆出：YSM（ysm.json 文件夹）/ MMD（.pmx/.pmd 文件夹）按文件夹名对比
package sync

import (
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/types"
)

// isDirTypeModelFolder 检查一个子目录是否包含 YSM/MMD 模型文件（即文件夹级资源）
// 用于 YSM（.ysm / ysm.json）和 MMD（.pmx/.pmd）类型的文件夹级同步
func isDirTypeModelFolder(path string, rtype string) bool {
	entries, err := os.ReadDir(path)
	if err != nil {
		return false
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		low := strings.ToLower(e.Name())
		base := strings.TrimSuffix(low, ".ban")
		if isModelFile(base, rtype) {
			return true
		}
	}
	return false
}

// isModelFile 检查文件名（已 lowercase，去 .ban）是否为对应类型的模型文件
func isModelFile(base string, rtype string) bool {
	switch rtype {
	case "ysm":
		ext := filepath.Ext(base)
		return base == "ysm.json" || ext == ".ysm" || ext == ".zip" || ext == ".7z"
	case "mmd-skin":
		ext := filepath.Ext(base)
		return ext == ".pmx" || ext == ".pmd"
	}
	return false
}

// SyncResourcesDirLevel 按文件夹名对比资源（用于 YSM 的 ysm.json 文件夹和 MMD 的 .pmx/.pmd 文件夹）
// 以文件夹名为单位，一个文件夹包含模型文件 + 纹理文件 = 一个整体
// 同时也会收集顶层平铺的模型文件（如 .ysm），以文件名（去扩展名）作为 key
// 路径存储：全局侧存全局路径，实例侧存实例路径；missing/extra 都是路径
func SyncResourcesDirLevel(globalDir, instanceDir, rtype string) types.ResourceSyncResult {
	result := types.ResourceSyncResult{}

	// 收集一个目录下的资源单元（子文件夹 + 顶层平铺模型文件）
	collectEntries := func(rootDir string) map[string]string {
		entries := make(map[string]string)
		// 先扫描顶层平铺模型文件
		if topEntries, err := os.ReadDir(rootDir); err == nil {
			for _, e := range topEntries {
				if e.IsDir() {
					continue
				}
				low := strings.ToLower(e.Name())
				base := strings.TrimSuffix(low, ".ban")
				if isModelFile(base, rtype) {
					key := strings.TrimSuffix(low, filepath.Ext(low))
					entries[key] = filepath.Join(rootDir, e.Name())
				}
			}
		}
		// 再扫描子文件夹
		filepath.Walk(rootDir, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				log.Printf("[sync] Walk 错误 %s: %v", path, err)
				return nil
			}
			if !info.IsDir() || path == rootDir {
				return nil
			}
			// 跳过回收站目录（与 scanner.ScanEntries 对齐）
			if fsutil.IsRecycleDir(path) {
				return filepath.SkipDir
			}
			if isDirTypeModelFolder(path, rtype) {
				name := strings.ToLower(info.Name())
				// 文件夹优先于平铺文件（同名时覆盖）
				entries[name] = path
				return filepath.SkipDir
			}
			return nil
		})
		return entries
	}

	globalDirs := collectEntries(globalDir)
	instanceDirs := collectEntries(instanceDir)

	// 找出 synced / missing / extra
	seen := make(map[string]bool)
	for name, gPath := range globalDirs {
		seen[name] = true
		if _, exists := instanceDirs[name]; exists {
			result.Synced = append(result.Synced, gPath)
		} else {
			result.Missing = append(result.Missing, gPath)
		}
	}
	for name, iPath := range instanceDirs {
		if !seen[name] {
			result.Extra = append(result.Extra, iPath)
		}
	}

	sort.Strings(result.Synced)
	sort.Strings(result.Missing)
	sort.Strings(result.Extra)
	return result
}
