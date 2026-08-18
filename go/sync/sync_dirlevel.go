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
		if types.IsTypeModelFile(e.Name(), rtype) {
			return true
		}
	}
	// ADR-095 maid-model（车万女仆）：模型包结构 assets/<namespace>/maid_model.json
	// （CustomPackLoader 源码核实），入口文件在深层，需检查 assets 子目录
	if rtype == "maid-model" {
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

// MC-MMD 用途子目录集合已上移 go/types（IsMMDSubDir，单一事实来源 ADR-096）：
// sync_dirlevel（同步保留层级）与 instance.BuildSyncItems（展示分组）共用。
// 仓库 mmd 根下按这些子目录组织时，同步须把它们作为独立同步单元保留层级，
// 而非展平到 3d-skin/ 根（EntityPlayer/角色A 不能变 3d-skin/角色A）。
// 与上游 PathConstants.java 的 SKIN 子目录对齐（含 DefaultAnim/DefaultMorph
// 系统内置目录，虽用户不导入，但已存在时同步需识别）。

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
				// NormalizeResourceName 剥 .disabled/.ban（审核补：原只剥 .ban，
				// .disabled 文件在文件夹级顶层收集时被漏掉）
				base := types.NormalizeResourceName(low)
				if types.IsTypeModelFile(base, rtype) {
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
			// ADR-092 路线 B：MC-MMD 子目录（EntityPlayer/SceneModel/CustomAnim 等）
			// 作为独立同步单元保留层级，不展平——其内部模型文件夹随目录整体走
			// （否则 EntityPlayer/角色A 会被展平为 3d-skin/角色A，丢 EntityPlayer 层）。
			// mmd-skin 专用（其他 rtype 不启用此增强，避免干扰 YSM 等目录型）。
			if rtype == "mmd-skin" && types.IsMMDSubDir(info.Name()) {
				name := strings.ToLower(info.Name())
				entries[name] = path
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
