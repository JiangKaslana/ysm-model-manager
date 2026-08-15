// ===== 哈希/名称对比（ADR-040 拆分；对比归并 ADR-064 收敛至 sync_diff.go）=====
package sync

import (
	"path/filepath"
	"sort"

	"ysm-model-manager/go/scanner"
	"ysm-model-manager/go/types"
)

func computeHash(path string) string {
	// 与 scanner.ComputeFileHash 同口径（>500MB 返回空、全量哈希、读错误返回空），
	// 否则 >100MB 文件的哈希与仓库侧不一致，哈希匹配静默失效
	return scanner.ComputeFileHash(path)
}

// HasModInDirFn 判断 mods 目录是否含有指定类型 mod 的函数类型。
type HasModInDirFn func(modsDir string) bool

// CompareGlobalInstanceHashes 对比全局目录和整合包实例子目录，返回每个实例的
// Missing / Extra / Synced 状态。
// 匹配口径与右侧同步管理器统一（ADR-064：均收敛到 relKey 相对路径 + ResourceDiff，
// 消除手工对齐漂移）：「相对路径（小写、去 .disabled/.ban）+ 大小」。
// 修复 MMD（.pmx/.pmd 不计算 SHA256，旧哈希比对恒 0）与蓝图（实例目录非标准
// 路径）在侧栏不显示的问题。
// subDir 是资源类型在实例版本目录中的扫描子目录（如 "resourcepacks"）；
// 实例目录经 types.FindInstDir 解析（标准目录不存在时兜底扫描，与同步管理器一致）。
func CompareGlobalInstanceHashes(mcRoot, globalDir, subDir, rtype string,
	scanFn ScanFunc, listFn ListVersionsFunc, hasModFn HasModInDirFn,
) []types.InstanceStatus {
	if mcRoot == "" || globalDir == "" || subDir == "" {
		return []types.InstanceStatus{}
	}
	if scanFn == nil || listFn == nil {
		return []types.InstanceStatus{}
	}

	globalEntries := scanFn(globalDir)

	// collect 由 scanFn 条目收集「相对路径 key → 条目」map（ADR-064 阶段二：
	// 与 SyncResources 同口径 rel key，过滤统一走 types.IsResourceAllowed）
	collect := func(entries []types.ModelEntry, root string) map[string]DiffEntry {
		m := make(map[string]DiffEntry)
		for _, e := range entries {
			if !types.IsResourceAllowed(e.Name) {
				continue
			}
			key := relKey(root, e.Path)
			if key == "" {
				continue
			}
			m[key] = DiffEntry{Path: e.Path, Size: e.Size}
		}
		return m
	}
	globalByName := collect(globalEntries, globalDir)

	instances := listFn(mcRoot)
	var results []types.InstanceStatus

	for _, ins := range instances {
		instDir := types.FindInstDir(ins.VersionDir, subDir, rtype)
		instByName := collect(scanFn(instDir), instDir)

		status := types.InstanceStatus{
			Name:      ins.Name,
			CustomDir: instDir,
			Missing:   []string{},
			Extra:     []string{},
		}
		if hasModFn != nil {
			status.HasMod = hasModFn(filepath.Join(ins.VersionDir, "mods"))
		}

		diff := ResourceDiff(globalByName, instByName)
		status.Missing = diff.Missing
		status.Extra = diff.Extra
		status.Synced = len(diff.Synced)

		// Missing/Extra 由 map 归并产生（迭代序随机）——排序保证输出确定性，
		// 否则同输入不同输出（flaky 测试/UI 展示不稳定，scanner 同款修复）
		sort.Strings(status.Missing)
		sort.Strings(status.Extra)
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
