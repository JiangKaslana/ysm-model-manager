// ===== 文件夹级资源同步（ADR-040 拆分，多层物理路径支持）=====
// 从 sync.go 拆出：YSM（ysm.json 文件夹）/ MMD（.pmx/.pmd 文件夹）按文件夹名对比
//
// ═══════════════════════════════════════════════════════════════════════════════
// 多层物理路径支持（2026-09 重构）
// ───────────────────────────────────────────────────────────────────────────────
// 原实现使用文件夹/文件名的 basename 作为同步 key，且仅收集 rootDir 顶层单元：
//   - 平铺模型文件仅收集 "直接位于 rootDir 下" 的（filepath.Dir(path)==rootDir）
//   - 模型文件夹仅收集 rootDir 的直接一级子目录（Walk 找到模型文件夹后 SkipDir，
//     不再深入兄弟目录间的深层嵌套）
//
// 后果：仓库多级子目录（如 maid-model/vendor/character/pack.zip）被扁平化，
// 同步时丢失层级信息，实质上阻碍模型仓库多层物理路径推广。
//
// 重构方案：
//  1. key 从 basename 升级为相对路径（relKeyDirLevel），天然保留目录层级
//  2. 平铺模型文件在任意深度收集——仅当父目录不含模型文件（未被整体收编 SkipDir）时可达，
//     属于边界路径：主路径（目录含模型文件 → isDirTypeModelFolder 检测为模型文件夹 →
//     SkipDir 整树收编）覆盖绝大多数场景
//  3. 模型文件夹在任意深度收集，不再限定一级子目录
//  4. 非模型子目录中不包含任何模型文件/文件夹时，SkipDir 优化遍历
//
// 已知限制（非本次回归，待治理）：
//   - 同级目录 `模型包/` 与文件 `模型包.zip` 的 key 都归一为 `<parent>/模型包` → 静默丢失一个
//     （relKeyDirLevel 去扩展名 vs 目录 basename 冲突）
//   - patternFind 对每个 Walk 访问的目录做子树递归搜索，祖先层搜索与子孙层重复；
//     超大仓库可加「basename 不等于 entryDir 则不下钻」剪枝，但当前 maxDepth 设计
//     支持 EntryDir 嵌套在非 EntryDir 目录名下，剪枝需谨慎验证
//
// ═══════════════════════════════════════════════════════════════════════════════
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
// 支持多层嵌套结构检测（通过 NestedPatterns 配置）
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
	// 基于 NestedPatterns 配置的多层嵌套检测
	// 支持任意深度的嵌套结构，不再硬编码 maid-model 特定逻辑
	// 只在当前目录是真正的模型目录（包含入口文件的目录）时返回 true
	if patterns := types.NestedPatternsFor(rtype); len(patterns) > 0 {
		if foundDir := findNestedModelDir(path, patterns); foundDir != "" {
			// 只有当找到的模型目录就是当前路径时才返回 true
			// 如果找到的是更深层的目录，说明当前目录只是中间目录
			if filepath.Clean(foundDir) == filepath.Clean(path) {
				return true
			}
		}
	}
	return false
}

// containsModelSubfolder 判断目录是否直接含子模型文件夹（即它是「容器」而非「叶子模型夹」）。
// 用于 collectEntries：容器目录即使含直接平铺 .ysm/.zip 也不整体收编，避免吞掉子夹层级。
// 只查直接子目录一次（子目录自身是否是模型文件夹），不递归——更深层由 Walk 逐级处理。
func containsModelSubfolder(path string, rtype string) bool {
	entries, err := os.ReadDir(path)
	if err != nil {
		return false
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		if isDirTypeModelFolder(filepath.Join(path, e.Name()), rtype) {
			return true
		}
	}
	return false
}

// findNestedModelDir 在指定目录下递归查找嵌套模型目录
// 返回第一个符合模式的模型目录路径，找不到返回空字符串
// 关键设计：返回实际的模型目录路径（包含入口文件的目录），
// 而不是中间目录的路径。这样 Walk 能正确识别嵌套结构。
func findNestedModelDir(path string, patterns []types.NestedPattern) string {
	for _, pattern := range patterns {
		if found := patternFind(path, pattern, 0); found != "" {
			return found
		}
	}
	return ""
}

// patternFind 递归查找符合单个嵌套模式的模型目录
// 返回找到的模型目录路径，找不到返回空字符串
// 与 patternMatches 不同：此函数返回具体路径而非布尔值，
// 让调用方能区分"当前目录是模型文件夹"和"子目录中有模型文件夹"两种情况
//
// 返回值说明：
// - 当在 EntryDir 下（或其子目录）找到入口文件时，返回 EntryDir 的父目录
// - 这样能正确识别模型包的根目录（如 my_pack/assets/ns/maid_model.json -> my_pack）
// - 当 EntryDir 为空且入口文件直接在当前目录时，返回当前目录
func patternFind(path string, pattern types.NestedPattern, depth int) string {
	// 深度限制，防止无限递归
	maxDepth := pattern.MaxDepth
	if maxDepth <= 0 {
		maxDepth = 10
	}
	if depth > maxDepth {
		return ""
	}

	// 如果 EntryDir 为空，直接在当前目录检查 EntryFiles
	if pattern.EntryDir == "" {
		if checkEntryFiles(path, pattern.EntryFiles) {
			return path
		}
		return ""
	}

	// 检查当前目录名是否匹配 EntryDir
	dirName := filepath.Base(path)
	if strings.EqualFold(dirName, pattern.EntryDir) {
		// 找到 EntryDir 目录，检查其中是否有入口文件
		// 注意：这里检查子目录是因为 maid_model.json 在 assets/<namespace>/ 下
		// 而不是直接在 assets/ 下
		entries, err := os.ReadDir(path)
		if err == nil {
			for _, e := range entries {
				if e.IsDir() {
					subPath := filepath.Join(path, e.Name())
					if checkEntryFiles(subPath, pattern.EntryFiles) {
						// 找到入口文件，返回 EntryDir 的父目录（模型包根目录）
						// 对于 my_pack/assets/ns/maid_model.json，返回 my_pack
						// 而不是 ns 或 assets
						return filepath.Dir(path)
					}
				}
			}
			// 也检查入口文件是否直接在 EntryDir 下
			if checkEntryFiles(path, pattern.EntryFiles) {
				return filepath.Dir(path)
			}
		}
		return ""
	}

	// 未找到 EntryDir，继续向下子目录递归查找
	entries, err := os.ReadDir(path)
	if err != nil {
		return ""
	}
	for _, e := range entries {
		if e.IsDir() {
			subPath := filepath.Join(path, e.Name())
			if found := patternFind(subPath, pattern, depth+1); found != "" {
				return found
			}
		}
	}
	return ""
}

// checkEntryFiles 检查目录中是否存在入口文件列表中的任一文件
func checkEntryFiles(path string, entryFiles []string) bool {
	for _, entryFile := range entryFiles {
		// 支持不带路径的文件名（如 "maid_model.json"）
		fileName := filepath.Base(entryFile)
		if info, err := os.Stat(filepath.Join(path, fileName)); err == nil && !info.IsDir() {
			return true
		}
	}
	return false
}

// relKeyDirLevel 计算目录级同步条目的规范化 key：相对路径 + 小写 + 去禁用后缀。
// 与 relKey 的区别：relKey 保留扩展名（供 ResourceDiff 按大小对比），
// 而目录级同步的 key 按「模型身份」去扩展名（模型 A 的 zip 无论版本为何，
// 身份相同；扩展名不是模型身份的一部分）。
// 多层物理路径支持：返回的 key 包含完整相对路径层级，如 "vendor/character/pack"
// 而非扁平化的 "pack"。
func relKeyDirLevel(root, path string, isDir bool) string {
	rel, err := filepath.Rel(root, path)
	if err != nil {
		return ""
	}
	rel = filepath.ToSlash(rel)
	rel = strings.ToLower(rel)
	rel = types.StripDisableSuffix(rel)
	// 剥离扩展名——模型身份不以扩展名区分
	if ext := filepath.Ext(rel); ext != "" {
		rel = strings.TrimSuffix(rel, ext)
	}
	// code review P3：目录键加尾随 "/"——与兄弟平铺文件（同名剥扩展名）区分——
	// 文件"嵌套1/动力臂.ysm"与目录"嵌套1/动力臂/"不再同键（map last-write-wins
	// 曾让文件覆盖目录——模型包静默丢失）
	if isDir {
		rel += "/"
	}
	return rel
}

// SyncResourcesDirLevel 按文件夹名对比资源（用于 YSM 的 ysm.json 文件夹和 MMD 的 .pmx/.pmd 文件夹）
// 以文件夹名为单位，一个文件夹包含模型文件 + 纹理文件 = 一个整体
// 同时也会收集各层级的平铺模型文件（如 .ysm），以相对路径（去扩展名）作为 key
// 路径存储：全局侧存全局路径，实例侧存实例路径；missing/extra 都是路径
//
// 多层物理路径支持：
//   - key 为相对路径（relKeyDirLevel），天然保留目录层级
//   - 平铺模型文件在任意深度收集
//   - 模型文件夹在任意深度收集
//   - 非模型空子目录跳过（SkipDir 优化），避免无意义遍历
func SyncResourcesDirLevel(globalDir, instanceDir, rtype string) types.ResourceSyncResult {
	result := types.ResourceSyncResult{}

	// collectEntries 单次 Walk 收集整棵树的同步单元：
	// 以相对路径（relKeyDirLevel）为 key，保留完整目录层级。
	collectEntries := func(rootDir string) map[string]string {
		entries := make(map[string]string)
		filepath.Walk(rootDir, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				log.Printf("[sync] Walk 错误 %s: %v", path, err)
				return nil
			}
			if !info.IsDir() {
				// 平铺模型文件：在任意深度收集（不再限定 rootDir 顶层）
				if types.IsTypeModelFile(path, rtype) {
					if key := relKeyDirLevel(rootDir, path, false); key != "" {
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
			// 模型文件夹：在任意深度收集（不再限定一级子目录）
			if isDirTypeModelFolder(path, rtype) {
				// 容器目录混入直接平铺模型文件（.ysm/.zip）也会被 isDirTypeModelFolder 判真，
				// 但若它同时含子模型文件夹，则是「容器」而非「叶子模型夹」——整体收编 SkipDir
				// 会吞掉子夹层级（如 嵌套1/ 内含平铺 .ysm + 01_taisho_maid/ + 嵌套2/ 深层）。
				// 此时下钻保留各子夹层级，让 nestDirLevelTree 重建容器。
				if containsModelSubfolder(path, rtype) {
					// code review P3：容器下钻时也注册自身键（目录 marker）——与对侧同名
					// 叶子目录（仅平铺文件——pre-fix 安装）键一致，避免键集不相交产生
					// 幻影 Missing+Extra（内容相同却显示分歧）
					if key := relKeyDirLevel(rootDir, path, true); key != "" {
						entries[key] = path
					}
					return nil
				}
				if key := relKeyDirLevel(rootDir, path, true); key != "" {
					entries[key] = path
				}
				return filepath.SkipDir
			}
			// 非模型子目录：继续递归（可能包含深层嵌套的模型文件夹/文件）
			return nil
		})
		return entries
	}

	globalDirs := collectEntries(globalDir)
	instanceDirs := collectEntries(instanceDir)

	// 找出 synced / missing / extra
	seen := make(map[string]bool)
	for key, gPath := range globalDirs {
		seen[key] = true
		if _, exists := instanceDirs[key]; exists {
			result.Synced = append(result.Synced, gPath)
		} else {
			result.Missing = append(result.Missing, gPath)
		}
	}
	for key, iPath := range instanceDirs {
		if !seen[key] {
			result.Extra = append(result.Extra, iPath)
		}
	}

	sort.Strings(result.Synced)
	sort.Strings(result.Missing)
	sort.Strings(result.Extra)
	return result
}

// FileDiffEntry 文件级差异条目（用于文件夹内容级 diff）
type FileDiffEntry struct {
	RelPath string           `json:"relPath"` // 相对于文件夹根的路径
	AbsPath string           `json:"absPath"` // 绝对路径
	Size    int64            `json:"size"`
	Status  types.SyncStatus `json:"status"` // synced/missing/optional
}

// DiffFolderContents 对同名文件夹进行内容级 diff
// 扫描两侧文件夹内的模型文件，比较差异，返回子文件级别的同步状态
// 用于在文件夹级同步单元内恢复单文件粒度的同步信息
//
// 参数：
//
//	globalFolder: 全局仓库侧的文件夹绝对路径
//	instanceFolder: 实例侧的文件夹绝对路径
//	rtype: 资源类型 ID（用于识别模型文件）
//
// 返回：
//
//	[]FileDiffEntry: 子文件级别的同步状态列表
//
// 设计原则：
//   - 只扫描模型文件（通过 IsTypeModelFile 过滤）
//   - 使用相对路径作为 key，保留层级信息
//   - 返回全局侧文件清单（synced 条目含在结果中——前端子文件列表需全量展示；
//     差异判定由调用方按 Status 区分——code review P3 注释对齐实现）
func DiffFolderContents(globalFolder, instanceFolder, rtype string) []FileDiffEntry {
	// 扫描全局文件夹内的模型文件
	globalFiles := collectFolderFiles(globalFolder, rtype)
	// 扫描实例文件夹内的模型文件
	instanceFiles := collectFolderFiles(instanceFolder, rtype)

	var diffs []FileDiffEntry
	seen := make(map[string]bool)

	// 检查全局有但实例没有的文件（missing，可推送）
	for relKey, gEntry := range globalFiles {
		seen[relKey] = true
		if _, exists := instanceFiles[relKey]; exists {
			// 两侧都有，视为 synced（当前不做内容哈希对比）
			diffs = append(diffs, FileDiffEntry{
				RelPath: relKey,
				AbsPath: gEntry,
				Size:    fileSize(gEntry),
				Status:  types.SyncStatusSynced,
			})
		} else {
			// 全局有、实例没有 → missing
			diffs = append(diffs, FileDiffEntry{
				RelPath: relKey,
				AbsPath: gEntry,
				Size:    fileSize(gEntry),
				Status:  types.SyncStatusMissing,
			})
		}
	}

	// 检查实例有但全局没有的文件（optional，可拉取）
	for relKey, iEntry := range instanceFiles {
		if !seen[relKey] {
			diffs = append(diffs, FileDiffEntry{
				RelPath: relKey,
				AbsPath: iEntry,
				Size:    fileSize(iEntry),
				Status:  types.SyncStatusOptional,
			})
		}
	}

	sort.Slice(diffs, func(i, j int) bool {
		return diffs[i].RelPath < diffs[j].RelPath
	})
	return diffs
}

// collectFolderFiles 扫描文件夹内的所有模型文件
// 返回以相对路径为 key 的映射
func collectFolderFiles(folder, rtype string) map[string]string {
	entries := make(map[string]string)
	if folder == "" {
		return entries
	}
	filepath.Walk(folder, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			log.Printf("[sync] collectFolderFiles Walk 错误 %s: %v", path, err)
			return nil
		}
		// 跳过目录
		if info.IsDir() {
			// 跳过回收站目录
			if path != folder && fsutil.IsRecycleDir(path) {
				return filepath.SkipDir
			}
			return nil
		}
		// 只收集模型文件
		if types.IsTypeModelFile(path, rtype) {
			rel, err := filepath.Rel(folder, path)
			if err != nil {
				return nil
			}
			relSlash := filepath.ToSlash(rel)
			entries[relSlash] = path
		}
		return nil
	})
	return entries
}

// fileSize 获取文件大小
func fileSize(path string) int64 {
	fi, err := os.Stat(path)
	if err != nil {
		return 0
	}
	return fi.Size()
}
