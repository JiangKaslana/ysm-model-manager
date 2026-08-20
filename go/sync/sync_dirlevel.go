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

	// collectUnits 收集一个目录下的同步单元（顶层平铺模型文件 + 含模型文件的子文件夹）。
	// 返回 key → 绝对路径（key 为小写文件名/文件夹名）。
	collectUnits := func(rootDir string) map[string]string {
		units := make(map[string]string)
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
					units[key] = filepath.Join(rootDir, e.Name())
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
			// 子类目录由 collectEntries 单独处理（带前缀），此处不下钻
			if types.IsSubDirGrouping(rtype) && types.IsSubDirName(rtype, info.Name()) {
				return filepath.SkipDir
			}
			if isDirTypeModelFolder(path, rtype) {
				name := strings.ToLower(info.Name())
				// 文件夹优先于平铺文件（同名时覆盖）
				units[name] = path
				return filepath.SkipDir
			}
			return nil
		})
		return units
	}

	// collectEntries 收集整棵仓库树的同步单元：
	// - 顶层单元（平铺模型文件 + 模型文件夹）
	// - subDirGrouping 类型（mmd-skin）：MC-MMD 子类目录（EntityPlayer/SceneModel/CustomAnim 等）
	//   内部的模型文件夹/平铺文件作为同步单元，key 带子类前缀保留层级（entityplayer/角色a），
	//   与仓库树（app-tree）的 group 根回溯口径对齐（ADR-092/ADR-094/ADR-096）；
	//   子类目录本身不作为单元，避免「目录存在即已同步」假象，也避免 push 整目录与
	//   内部模型重复。消费注册表 subDirGrouping 字段 + subtypes 子目录集合（ADR-104），
	//   不硬编码 rtype / 不硬编码子目录名。
	collectEntries := func(rootDir string) map[string]string {
		entries := collectUnits(rootDir)
		filepath.Walk(rootDir, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				log.Printf("[sync] Walk 错误 %s: %v", path, err)
				return nil
			}
			if !info.IsDir() || path == rootDir {
				return nil
			}
			if fsutil.IsRecycleDir(path) {
				return filepath.SkipDir
			}
			if types.IsSubDirGrouping(rtype) && types.IsSubDirName(rtype, info.Name()) {
				name := strings.ToLower(info.Name())
				for k, v := range collectUnits(path) {
					entries[name+"/"+k] = v
				}
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
