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
		if types.IsTypeModelFile(filepath.Join(path, e.Name()), rtype) {
			return true
		}
	}
	// ADR-095 maid-model（车万女仆）：模型包结构 assets/<namespace>/maid_model.json
	// （CustomPackLoader 源码核实），入口文件在深层，需检查 assets 子目录。
	// 消费注册表 nestedModelDir 字段（ADR-065 合规），不硬编码 rtype。
	if types.IsNestedModelDir(rtype) {
		assetsDir := filepath.Join(path, "assets")
		nsDirs, err := os.ReadDir(assetsDir)
		if err != nil {
			return false
		}
		for _, ns := range nsDirs {
			if !ns.IsDir() {
				continue
			}
			for _, entry := range []string{"maid_model.json", "chair_model.json"} {
				if info, err := os.Stat(filepath.Join(assetsDir, ns.Name(), entry)); err == nil && !info.IsDir() {
					return true
				}
			}
		}
	}
	return false
}

// SyncResourcesDirLevel 按文件夹名对比资源（用于 YSM 的 ysm.json 文件夹和 MMD 的 .pmx/.pmd 文件夹）
// 以文件夹名为单位，一个文件夹包含模型文件 + 纹理文件 = 一个整体
// 同时也会收集顶层平铺的模型文件（如 .ysm），以文件名（去扩展名）作为 key
// 路径存储：全局侧存全局路径，实例侧存实例路径；missing/extra 都是路径
func SyncResourcesDirLevel(globalDir, instanceDir, rtype string) types.ResourceSyncResult {
	result := types.ResourceSyncResult{}

	// collectEntries 单次 Walk 收集整棵树的同步单元：
	// - 顶层单元（平铺模型文件 + 模型文件夹）
	collectEntries := func(rootDir string) map[string]string {
		entries := make(map[string]string)
		filepath.Walk(rootDir, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				log.Printf("[sync] Walk 错误 %s: %v", path, err)
				return nil
			}
			if !info.IsDir() {
				// 顶层平铺模型文件（path 直接在 rootDir 下）
				if filepath.Clean(filepath.Dir(path)) == filepath.Clean(rootDir) {
					low := strings.ToLower(info.Name())
					if types.IsTypeModelFile(path, rtype) {
						key := strings.TrimSuffix(low, filepath.Ext(low))
						entries[key] = path
					}
				}
				return nil
			}
			if path == rootDir {
				return nil
			}
			// 跳过回收站目录（与 scanner.ScanEntries 对齐）
			if fsutil.IsRecycleDir(path) {
				return filepath.SkipDir
			}
			if isDirTypeModelFolder(path, rtype) {
				name := strings.ToLower(info.Name())
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
