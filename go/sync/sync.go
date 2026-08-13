package sync

import (
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"syscall"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/installer"
	"ysm-model-manager/go/types"
	"ysm-model-manager/go/ysm"
)

// 锁统一（ADR-056 共享单锁）：同步与安装并发操作同一 custom 目录文件（Rename 竞态），
// 原两包各自定义 installLock/syncLock 互不感知——现统一复用 installer.InstallLock

// ScanFunc 扫描模型（函数类型，由 app.go 注入）
type ScanFunc func(dir string) []types.ModelEntry

// GetInstanceStatus 获取整合包状态（使用真实 ListVersions）
func GetInstanceStatus(mcRoot, repoDir string, scanFn ScanFunc) []types.InstanceStatus {
	return GetInstanceStatusWith(mcRoot, repoDir, scanFn, ListVersions)
}

// GetInstanceStatusWith 可注入的整合包状态获取（测试用）
func GetInstanceStatusWith(mcRoot, repoDir string, scanFn ScanFunc, listFn ListVersionsFunc) []types.InstanceStatus {
	if mcRoot == "" || repoDir == "" {
		return []types.InstanceStatus{}
	}
	if scanFn == nil || listFn == nil {
		return []types.InstanceStatus{}
	}

	repoEntries := scanFn(repoDir)
	repoByHash := make(map[string][]types.ModelEntry)
	for _, e := range repoEntries {
		if e.Hash == "" {
			continue
		}
		// 跳过禁用的模型（.ban），它们不应出现在缺失列表中
		if strings.HasSuffix(strings.ToLower(e.Name), ".ban") {
			continue
		}
		repoByHash[e.Hash] = append(repoByHash[e.Hash], e)
	}

	instances := listFn(mcRoot)
	var results []types.InstanceStatus

	for _, ins := range instances {
		customEntries := scanFn(ins.CustomDir)
		customByHash := make(map[string]bool)
		for _, c := range customEntries {
			if c.Hash != "" {
				customByHash[c.Hash] = true
			}
		}

		status := types.InstanceStatus{
			Name:      ins.Name,
			CustomDir: ins.CustomDir,
			Missing:   []string{},
			Extra:     []string{},
			Disabled:  []string{},
			HasYSM:    ysm.HasYSMMod(filepath.Join(ins.VersionDir, "mods")),
		}

		for hash, entries := range repoByHash {
			if !customByHash[hash] {
				for _, e := range entries {
					status.Missing = append(status.Missing, e.Path)
				}
			}
		}
		// 预构建禁用哈希集合
		bannedHashes := make(map[string]bool)
		for _, re := range repoEntries {
			if strings.HasSuffix(strings.ToLower(re.Name), ".ban") && re.Hash != "" {
				bannedHashes[re.Hash] = true
			}
		}

		for _, c := range customEntries {
			if c.Hash == "" {
				continue
			}
			if bannedHashes[c.Hash] {
				// 仓库已禁用此模型 → 标记为已禁用，不入额外
				name := c.Name
				if strings.HasSuffix(strings.ToLower(name), ".ban") {
					name = name[:len(name)-4]
				}
				status.Disabled = append(status.Disabled, name)
			} else if _, found := repoByHash[c.Hash]; !found {
				// 仓库中没有此哈希 → 额外
				name := c.Name
				if strings.HasSuffix(strings.ToLower(name), ".ban") {
					name = name[:len(name)-4]
				}
				status.Extra = append(status.Extra, name)
			}
		}

		// 收集 custom 目录下每个文件的链接类型
		for _, c := range customEntries {
			linkType := GetLinkType(c.Path)
			fileName := c.Name
			// 去掉 .ban 后缀，方便前端匹配
			if strings.HasSuffix(strings.ToLower(fileName), ".ban") {
				fileName = fileName[:len(fileName)-4]
			}
			status.Files = append(status.Files, types.CustomFileInfo{
				Name:     fileName,
				LinkType: linkType,
			})
		}
		// 统一口径：Synced = custom 目录中命中仓库哈希的文件数
		// （与 CompareGlobalInstanceHashes 的 matchedCount 一致，不再用 len(Files) 的存量口径）
		syncedCount := 0
		for _, c := range customEntries {
			if c.Hash != "" {
				if _, found := repoByHash[c.Hash]; found {
					syncedCount++
				}
			}
		}
		status.Synced = syncedCount

		if len(status.Missing) == 0 && len(status.Extra) == 0 {
			status.Status = "complete"
		} else if len(status.Extra) > 0 {
			status.Status = "extra"
		} else {
			status.Status = "missing"
		}
		results = append(results, status)
	}
	return results
}

// SyncToggleStatus 同步启用/禁用状态
func SyncToggleStatus(instanceCustomDir, filesRoot string, scanFn ScanFunc) (int, int, error) {
	installer.InstallLock.Lock()
	defer installer.InstallLock.Unlock()
	repoEntries := scanFn(filesRoot)
	repoHash := make(map[string]bool) // hash → banned
	repoName := make(map[string]bool) // relPath(去.ban) → banned，用于同名不同文件夹的文件
	filesRootClean := strings.ToLower(filepath.Clean(filesRoot)) + string(filepath.Separator)
	for _, e := range repoEntries {
		banned := strings.HasSuffix(strings.ToLower(e.Name), ".ban")
		// 用路径前缀限定：relPath 带至少一级父文件夹，避免跨文件夹撞名
		ePath := strings.ToLower(e.Path)
		if strings.HasPrefix(ePath, filesRootClean) {
			rel := strings.TrimPrefix(ePath, filesRootClean)
			rel = strings.TrimSuffix(rel, ".ban")
			repoName[rel] = banned
		} else {
			// fallback：纯文件名（顶层文件）
			baseName := strings.TrimSuffix(strings.ToLower(e.Name), ".ban")
			repoName[baseName] = banned
		}
		if e.Hash != "" {
			repoHash[e.Hash] = banned
		}
	}
	if len(repoHash) == 0 && len(repoName) == 0 {
		return 0, 0, fmt.Errorf("仓库中未找到模型文件")
	}

	// 阶段 1：收集待 Rename 的文件（不修改目录结构）
	type renameOp struct {
		src string
		dst string
	}
	var ops []renameOp
	customDirClean := strings.ToLower(filepath.Clean(instanceCustomDir)) + string(filepath.Separator)
	filepath.WalkDir(instanceCustomDir, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			log.Printf("[sync] WalkDir 错误 %s: %v", p, err)
			return nil
		}
		if d.IsDir() {
			return nil
		}
		if strings.Contains(strings.ToLower(p), ".recycle") {
			return nil
		}
		actualPath := p
		isCurrentlyBanned := strings.HasSuffix(strings.ToLower(p), ".ban")
		if isCurrentlyBanned {
			actualPath = p[:len(p)-4]
		}
		ext := strings.ToLower(filepath.Ext(actualPath))
		if !types.IsSupportedExt(ext) {
			return nil
		}

		// 先试哈希匹配，再用多级路径匹配，最后 fallback 到纯文件名
		var shouldBeBanned bool
		var matched bool
		hash := computeHash(p)
		if hash != "" {
			shouldBeBanned, matched = repoHash[hash]
		}
		if !matched {
			// 用 relative path 匹配（带文件夹限定）
			pLower := strings.ToLower(p)
			if strings.HasPrefix(pLower, customDirClean) {
				rel := strings.TrimPrefix(pLower, customDirClean)
				rel = strings.TrimSuffix(rel, ".ban")
				shouldBeBanned, matched = repoName[rel]
			}
		}
		if !matched {
			// fallback：纯文件名（旧仓库或同名不同路径的特例）
			baseName := strings.ToLower(filepath.Base(actualPath))
			shouldBeBanned, matched = repoName[baseName]
		}
		if !matched {
			return nil
		}

		if shouldBeBanned && !isCurrentlyBanned {
			newPath := p + ".ban"
			if _, err := os.Stat(newPath); err == nil {
				return nil // 目标已存在，跳过
			}
			ops = append(ops, renameOp{src: p, dst: newPath})
		} else if !shouldBeBanned && isCurrentlyBanned {
			newPath := p[:len(p)-4]
			// 启用分支补目标存在性检查——与禁用分支「存在即跳过」
			// 对称；原 os.Rename 会静默覆盖既有同名文件（内容不同则数据丢失，仅 Windows
			// 目标被占用时失败）；目标已存在且非 .ban 时跳过本次改名
			if _, err := os.Stat(newPath); err == nil {
				return nil
			}
			ops = append(ops, renameOp{src: p, dst: newPath})
		}
		return nil
	})

	// 阶段 2：统一执行 Rename（目录结构已稳定，无竞态）
	disableCount := 0
	enableCount := 0
	var failures []string
	for _, op := range ops {
		if err := os.Rename(op.src, op.dst); err == nil {
			if strings.HasSuffix(strings.ToLower(op.dst), ".ban") {
				disableCount++
			} else {
				enableCount++
			}
		} else if isFileLocked(err) {
			log.Printf("[sync] 文件被占用，跳过: %s → %s: %v", op.src, op.dst, err)
		} else {
			failures = append(failures, fmt.Sprintf("%s→%s: %v", op.src, op.dst, err))
		}
	}
	if len(failures) > 0 {
		return disableCount, enableCount, fmt.Errorf("同步完成: 成功禁用 %d 启用 %d，失败 %d: %s",
			disableCount, enableCount, len(failures), strings.Join(failures, "; "))
	}
	return disableCount, enableCount, nil
}

// SyncResources 对比两个目录的资源文件差异，按文件名匹配
// 用于资源库（资源包/光影包等）的全局 ↔ 整合包同步
// 只统计模型/资源相关扩展名的文件，忽略无关文件

// isResourcePackFolder 检查目录是否是资源包文件夹（内含 pack.mcmeta）——统一走 fsutil 收敛实现

// SyncResources 对比两个目录的资源文件差异，按文件名匹配
// 用于资源库（资源包/光影包等）的全局 ↔ 整合包同步
// 只统计模型/资源相关扩展名的文件，忽略无关文件
func SyncResources(globalDir, instanceDir string) types.ResourceSyncResult {
	result := types.ResourceSyncResult{}

	// 文件信息：size 用于同名文件的内容差异检测（mtime 因复制会变，不可靠）
	type fileInfo struct {
		path  string
		size  int64
		isDir bool
	}

	// 扫描全局目录，收集文件名
	globalFiles := make(map[string]fileInfo) // name → fileInfo
	filepath.Walk(globalDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			log.Printf("[sync] Walk 错误 %s: %v", path, err)
			return nil
		}
		if info.IsDir() {
			// 跳过回收站目录（与 scanner.ScanEntries 对齐）：回收站内模型不是仓库活跃模型
			if path != globalDir && fsutil.IsRecycleDir(path) {
				return filepath.SkipDir
			}
			// 资源包文件夹：扫描其本身但不递归
			if path != globalDir && fsutil.IsResourcePackFolder(path) {
				name := strings.ToLower(info.Name())
				globalFiles[name] = fileInfo{path: path, isDir: true}
			}
			return nil
		}
		if !isSyncAllowed(info.Name()) {
			return nil
		}
		name := strings.ToLower(info.Name())
		name = strings.TrimSuffix(name, ".disabled")
		name = strings.TrimSuffix(name, ".ban")
		globalFiles[name] = fileInfo{path: path, size: info.Size()}
		return nil
	})

	// 扫描整合包目录
	instanceFiles := make(map[string]fileInfo)
	filepath.Walk(instanceDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			log.Printf("[sync] Walk 错误 %s: %v", path, err)
			return nil
		}
		if info.IsDir() {
			// 跳过回收站目录（防御：整合包路径下历史遗留 .recycle 不应参与同步）
			if path != instanceDir && fsutil.IsRecycleDir(path) {
				return filepath.SkipDir
			}
			// 资源包文件夹：扫描其本身但不递归
			if path != instanceDir && fsutil.IsResourcePackFolder(path) {
				name := strings.ToLower(info.Name())
				instanceFiles[name] = fileInfo{path: path, isDir: true}
			}
			return nil
		}
		if !isSyncAllowed(info.Name()) {
			return nil
		}
		name := strings.ToLower(info.Name())
		name = strings.TrimSuffix(name, ".disabled")
		name = strings.TrimSuffix(name, ".ban")
		instanceFiles[name] = fileInfo{path: path, size: info.Size()}
		return nil
	})

	// 找出 synced / missing / extra
	// 同名文件若大小不同（内容已变化）视为待推送更新，归入 Missing
	for name, g := range globalFiles {
		if i, exists := instanceFiles[name]; exists {
			if !g.isDir && !i.isDir && g.size != i.size {
				result.Missing = append(result.Missing, g.path)
			} else {
				result.Synced = append(result.Synced, g.path)
			}
		} else {
			result.Missing = append(result.Missing, g.path)
		}
	}
	for name, i := range instanceFiles {
		if _, exists := globalFiles[name]; !exists {
			result.Extra = append(result.Extra, i.path)
		}
	}

	sort.Strings(result.Synced)
	sort.Strings(result.Missing)
	sort.Strings(result.Extra)
	return result
}

// SortEntries 按名称排序模型条目
func SortEntries(entries []types.ModelEntry) {
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Name < entries[j].Name
	})
}

// getLinkType 判断文件的链接类型
// GetLinkType 判断文件的链接类型
func GetLinkType(path string) types.LinkType {
	info, err := os.Lstat(path)
	if err != nil {
		return types.LinkUnknown
	}
	// 符号链接
	if info.Mode()&os.ModeSymlink != 0 {
		return types.LinkSym
	}
	// 在 Windows 上判断硬链接：通过 syscall.GetFileInformationByHandle 获取 nlink
	// 如果 nlink > 1，说明是硬链接（统一走 fsutil.IsHardLink，含目录排除 ADR-038）
	if fsutil.IsHardLink(path) {
		return types.LinkHard
	}
	return types.LinkCopy
}

// isFileLocked 判断错误是否因为文件被其他进程锁定
func isFileLocked(err error) bool {
	if err == nil {
		return false
	}
	// errno 优先：Windows ERROR_SHARING_VIOLATION(32) / Unix EBUSY(16)
	// 两端错误码空间互不重叠，rename 不会命中对方语义，跨平台无副作用
	if errors.Is(err, syscall.Errno(32)) || errors.Is(err, syscall.Errno(16)) {
		return true
	}
	// 兜底：检查嵌套错误的消息内容（Windows 上 os.Rename 可能返回 LinkError/PathError）
	getMsg := func(e error) string {
		if e == nil {
			return ""
		}
		return strings.ToLower(e.Error())
	}

	// 取最内层错误消息（解包 LinkError/PathError）
	msg := getMsg(err)
	if linkErr, ok := err.(*os.LinkError); ok {
		msg = getMsg(linkErr.Err)
	}
	if pathErr, ok := err.(*os.PathError); ok {
		msg = getMsg(pathErr.Err)
	}

	// 文本兜底：避免过宽子串（"access" 会误伤 "accessibility" 等无关错误），
	// 只匹配 Windows 锁定典型文案 "access is denied"
	return strings.Contains(msg, "sharing") ||
		strings.Contains(msg, "access is denied") ||
		strings.Contains(msg, "used by another process")
}
