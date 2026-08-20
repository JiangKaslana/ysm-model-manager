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

// collectSubDirUnits 收集子类目录内的同步单元（无前缀，由调用方加前缀）。
// 与 collectEntries 的单次 Walk 配合：子类目录通过 SkipDir 退出外层 Walk，
// 此处再 ReadDir 一遍子类子树，避免深层嵌套时的重复 stat。
// 只扫描一层（子类目录内直接包含的模型文件夹/平铺文件），不递归更深。
func collectSubDirUnits(dir, prefix string, rtype string) map[string]string {
	units := make(map[string]string)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return units
	}
	for _, e := range entries {
		if !e.IsDir() {
			low := strings.ToLower(e.Name())
			base := types.NormalizeResourceName(low)
			if types.IsTypeModelFile(base, rtype) {
				key := strings.TrimSuffix(low, filepath.Ext(low))
				units[key] = filepath.Join(dir, e.Name())
			}
			continue
		}
		// 递归检查子子目录
		subPath := filepath.Join(dir, e.Name())
		if fsutil.IsRecycleDir(subPath) {
			continue
		}
		if isDirTypeModelFolder(subPath, rtype) {
			name := strings.ToLower(e.Name())
			units[name] = subPath
		}
	}
	return units
}

// SyncResourcesDirLevel 按文件夹名对比资源（用于 YSM 的 ysm.json 文件夹和 MMD 的 .pmx/.pmd 文件夹）
// 以文件夹名为单位，一个文件夹包含模型文件 + 纹理文件 = 一个整体
// 同时也会收集顶层平铺的模型文件（如 .ysm），以文件名（去扩展名）作为 key
// 路径存储：全局侧存全局路径，实例侧存实例路径；missing/extra 都是路径
func SyncResourcesDirLevel(globalDir, instanceDir, rtype string) types.ResourceSyncResult {
	result := types.ResourceSyncResult{}

	// collectEntries 单次 Walk 收集整棵树的同步单元：
	// - 顶层单元（平铺模型文件 + 模型文件夹）
	// - subDirGrouping 类型（mmd-skin）：MC-MMD 子类目录（EntityPlayer/SceneModel/CustomAnim 等）
	//   内部的模型文件夹/平铺文件作为同步单元，key 带子类前缀保留层级（entityplayer/角色a），
	//   与仓库树（app-tree）的 group 根回溯口径对齐（ADR-092/ADR-094/ADR-096）；
	//   子类目录本身不作为单元，避免「目录存在即已同步」假象，也避免 push 整目录与
	//   内部模型重复。消费注册表 subDirGrouping 字段 + subtypes 子目录集合（ADR-104），
	//   不硬编码 rtype / 不硬编码子目录名。
	//
	// 性能优化（子代理审核建议）：原 collectUnits + collectEntries 双重 Walk 合并为单次 Walk，
	// 减少目录 stat 次数和 GC 压力。
	collectEntries := func(rootDir string) map[string]string {
		entries := make(map[string]string)
		filepath.Walk(rootDir, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				log.Printf("[sync] Walk 错误 %s: %v", path, err)
				return nil
			}
			if !info.IsDir() {
				// 顶层平铺模型文件（path 直接在 rootDir 下）
				if filepath.Dir(path) == rootDir {
					low := strings.ToLower(info.Name())
					base := types.NormalizeResourceName(low)
					if types.IsTypeModelFile(base, rtype) {
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
			// subDirGrouping 类型：子类目录递归收集内部单元（带前缀）
			if types.IsSubDirGrouping(rtype) && types.IsSubDirName(rtype, info.Name()) {
				name := strings.ToLower(info.Name())
				// 递归收集子类目录内的顶层单元（不再二次 Walk，直接利用当前 Walk）
				// 注意：由于 Walk 是深度优先，子类目录内的文件会在后续回调中被访问，
				// 但我们需要一次性收集整个子类子树。用 ReadDir + 递归实现。
				subUnits := collectSubDirUnits(path, name, rtype)
				for k, v := range subUnits {
					entries[name+"/"+k] = v
				}
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
