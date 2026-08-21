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
// rtype: 资源类型 ID（如 "ysm"），用于解析特定子目录；为空时使用 ins.CustomDir（向后兼容）
func GetInstanceStatus(mcRoot, repoDir, rtype string, scanFn ScanFunc) []types.InstanceStatus {
	return GetInstanceStatusWith(mcRoot, repoDir, rtype, scanFn, ListVersions)
}

// GetInstanceStatusWith 可注入的整合包状态获取（测试用）
// rtype: 资源类型 ID（如 "ysm"），用于解析特定子目录；为空时使用 ins.CustomDir（向后兼容）
func GetInstanceStatusWith(mcRoot, repoDir, rtype string, scanFn ScanFunc, listFn ListVersionsFunc) []types.InstanceStatus {
	if mcRoot == "" || repoDir == "" {
		return []types.InstanceStatus{}
	}
	if scanFn == nil || listFn == nil {
		return []types.InstanceStatus{}
	}

	// 预解析子目录（rtype 不为空时使用 FindInstDir 限定路径）
	var subDir string
	if rtype != "" {
		subDir = types.SubDirMap(rtype)
	}

	repoEntries := scanFn(repoDir)
	repoByHash := make(map[string][]types.ModelEntry)
	// 预构建禁用哈希集合（循环不变量：一次遍历，后续每个 instance 复用）
	bannedHashes := make(map[string]bool)
	// 预构建 relKey 映射（非哈希类型回退：MMD/VRC 等 ShouldHashExt 为 false 的类型用路径+大小比对）
	repoByRelKey := make(map[string][]types.ModelEntry)
	for _, e := range repoEntries {
		// 禁用的模型（.ban）不应出现在缺失列表，同时归入 bannedHashes
		if strings.HasSuffix(strings.ToLower(e.Name), ".ban") {
			if e.Hash != "" {
				bannedHashes[e.Hash] = true
			}
			continue
		}
		if e.Hash != "" {
			repoByHash[e.Hash] = append(repoByHash[e.Hash], e)
		}
		// relKey 始终构建（哈希命中优先，哈希空时回退 relKey）
		if rel := relKey(repoDir, e.Path); rel != "" {
			repoByRelKey[rel] = append(repoByRelKey[rel], e)
		}
	}

	// 决定对比模式：有哈希条目走哈希对比，否则走 relKey 回退
	useHash := len(repoByHash) > 0

	instances := listFn(mcRoot)
	var results []types.InstanceStatus

	for _, ins := range instances {
		// 按资源类型限定扫描路径：rtype 不为空时使用 FindInstDir 解析子目录
		scanDir := ins.CustomDir
		if rtype != "" && subDir != "" {
			scanDir = types.FindInstDir(ins.VersionDir, subDir, rtype)
		}
		customEntries := scanFn(scanDir)

		customByHash := make(map[string]bool)
		customByRelKey := make(map[string]bool)
		for _, c := range customEntries {
			if c.Hash != "" {
				customByHash[c.Hash] = true
			}
			if rel := relKey(scanDir, c.Path); rel != "" {
				customByRelKey[rel] = true
			}
		}

		status := types.InstanceStatus{
			Name:      ins.Name,
			CustomDir: scanDir,
			Missing:   []string{},
			Extra:     []string{},
			Disabled:  []string{},
			HasYSM:    ysm.HasYSMMod(filepath.Join(ins.VersionDir, "mods")),
		}

		if useHash {
			// 哈希对比路径（YSM/蓝图等有哈希的类型）
			for hash, entries := range repoByHash {
				if !customByHash[hash] {
					for _, e := range entries {
						status.Missing = append(status.Missing, e.Path)
					}
				}
			}

			for _, c := range customEntries {
				if c.Hash == "" {
					continue
				}
				if bannedHashes[c.Hash] {
					status.Disabled = append(status.Disabled, types.StripBanSuffix(c.Name))
				} else if _, found := repoByHash[c.Hash]; !found {
					status.Extra = append(status.Extra, types.StripBanSuffix(c.Name))
				}
			}

			// Synced 口径：custom 中命中仓库哈希的文件数
			syncedCount := 0
			for _, c := range customEntries {
				if c.Hash != "" {
					if _, found := repoByHash[c.Hash]; found {
						syncedCount++
					}
				}
			}
			status.Synced = syncedCount
		} else {
			// relKey 回退路径（MMD/VRC 等无哈希类型）
			// Missing: 仓库有但实例没有的 relKey
			for rel, entries := range repoByRelKey {
				if !customByRelKey[rel] {
					for _, e := range entries {
						status.Missing = append(status.Missing, e.Path)
					}
				}
			}

			// Extra + Disabled: 实例有但仓库没有的 relKey
			for _, c := range customEntries {
				if rel := relKey(scanDir, c.Path); rel != "" {
					if _, found := repoByRelKey[rel]; !found {
						status.Extra = append(status.Extra, c.Name)
					}
				}
			}

			// Synced: 实例中 relKey 命中仓库的文件数
			syncedCount := 0
			for _, c := range customEntries {
				if rel := relKey(scanDir, c.Path); rel != "" {
					if _, found := repoByRelKey[rel]; found {
						syncedCount++
					}
				}
			}
			status.Synced = syncedCount
		}

		// 收集 custom 目录下每个文件的链接类型
		for _, c := range customEntries {
			linkType := GetLinkType(c.Path)
			// 去掉 .ban 后缀，方便前端匹配
			status.Files = append(status.Files, types.CustomFileInfo{
				Name:     types.StripBanSuffix(c.Name),
				LinkType: linkType,
			})
		}

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
	if scanFn == nil {
		return 0, 0, fmt.Errorf("scanFn 为空")
	}
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
			actualPath = types.StripBanSuffix(p)
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

// 文件级同步深度上限：SyncResources 仅收集 scanDir 顶层文件，不递归进入嵌套子目录。
// 文件夹级类型（YSM/MMD 等）仍全树递归，由 SyncResourcesDirLevel 按文件夹名对比。
// SyncResources 对比两个目录的资源文件差异，按文件名匹配
// 用于资源库（资源包/光影包等）的全局 ↔ 整合包同步
// 只统计模型/资源相关扩展名的文件，忽略无关文件
// rtype 指定资源类型 ID：文件级类型（!dirLevelSync）仅在目标目录顶层收集文件（depth 1），
// 不递归进嵌套子目录；文件夹级类型仍全树递归。空 rtype 保持旧的全树递归行为（测试/兼容）。
// P3 修复：原实现无论类型一律全递归——Sable Schematics 等生成 .nbt 于嵌套子目录时，
// mapSrcToGlobal（顶层语义）算出相对路径以 ".." 开头误判越界 → 拉取报"不在目标目录内"。
// isMcmetaDetectorType 判断资源类型是否为资源包文件夹型（detector=mcmeta）。
// SyncResources 的 pack.mcmeta 文件夹收集仅对此类（及空 rtype 兼容）生效，
// 避免蓝图/YSM 等类型的仓库中误放的资源包文件夹被当成本类型同步单元。
func isMcmetaDetectorType(rtype string) bool {
	rt := types.RegistryType(rtype)
	return rt != nil && rt.Detector == "mcmeta"
}

// relKey 计算文件相对 root 的规范化同步 key（小写、正斜杠、去 .disabled/.ban 尾部）。
// ADR-064 阶段二：文件级对比从「文件名」升级为「相对路径」——嵌套文件天然区分、
// 无同名冲突、与仓库树树状语义一致（原"只扫顶层"深度守卫随之取消）。
func relKey(root, path string) string {
	rel, err := filepath.Rel(root, path)
	if err != nil {
		return ""
	}
	rel = filepath.ToSlash(rel)
	rel = strings.ToLower(rel)
	rel = strings.TrimSuffix(rel, ".disabled")
	rel = strings.TrimSuffix(rel, ".ban")
	return rel
}

func SyncResources(globalDir, instanceDir string, rtype ...string) types.ResourceSyncResult {
	rtypeID := ""
	if len(rtype) > 0 {
		rtypeID = rtype[0]
	}
	// 资源包文件夹（含 pack.mcmeta）作为同步单元——仅资源包类型（detector=mcmeta）
	// 或空 rtype（旧行为兼容）收集。P5 修复：原实现不分类型一律收集，蓝图仓库
	// （blueprint）里误放的资源包文件夹被当成蓝图 missing 显示"推送"，
	// 而该目录实际没有任何 .nbt/.schematic（识别错文件）。
	isPackFolderType := rtypeID == "" || isMcmetaDetectorType(rtypeID)

	// collect 全树递归扫描一侧目录：文件条目 + 资源包文件夹条目。
	// key 为相对路径（relKey），过滤与归一化统一走 types，对比归并统一走
	// ResourceDiff（ADR-064：scanner 口径 + 单点对比，消除手工对齐漂移）。
	collect := func(rootDir string) map[string]DiffEntry {
		entries := make(map[string]DiffEntry)
		filepath.Walk(rootDir, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				log.Printf("[sync] Walk 错误 %s: %v", path, err)
				return nil
			}
			if info.IsDir() {
				// 跳过回收站目录（与 scanner.ScanEntries 对齐）：回收站内模型不是仓库活跃模型
				if path != rootDir && fsutil.IsRecycleDir(path) {
					return filepath.SkipDir
				}
				// 资源包文件夹：扫描其本身但不递归（仅资源包类型收集）
				if path != rootDir && isPackFolderType && fsutil.IsResourcePackFolder(path) {
					if key := relKey(rootDir, path); key != "" {
						entries[key] = DiffEntry{Path: path, IsDir: true}
					}
				}
				return nil
			}
			if !types.IsResourceAllowed(info.Name()) {
				return nil
			}
			if key := relKey(rootDir, path); key != "" {
				entries[key] = DiffEntry{Path: path, Size: info.Size()}
			}
			return nil
		})
		return entries
	}

	globalFiles := collect(globalDir)
	instanceFiles := collect(instanceDir)
	return ResourceDiff(globalFiles, instanceFiles)
}

// SortEntries 按名称排序模型条目
func SortEntries(entries []types.ModelEntry) {
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Name < entries[j].Name
	})
}

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
