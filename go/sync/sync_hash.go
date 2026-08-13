// ===== 哈希/名称对比（ADR-040 拆分）=====
// 从 sync.go 拆出：哈希口径统一（computeHash）与全局↔实例「文件名+大小」对比（CompareGlobalInstanceHashes）
package sync

import (
	"path/filepath"
	"sort"
	"strings"

	"ysm-model-manager/go/scanner"
	"ysm-model-manager/go/types"
)

func computeHash(path string) string {
	// 与 scanner.ComputeFileHash 同口径（>500MB 返回空、全量哈希、读错误返回空），
	// 否则 >100MB 文件的哈希与仓库侧不一致，哈希匹配静默失效
	return scanner.ComputeFileHash(path)
}

func isSyncAllowed(name string) bool {
	low := strings.ToLower(name)
	base := strings.TrimSuffix(low, ".disabled")
	base = strings.TrimSuffix(base, ".ban")
	// .json 只允许 ysm.json（syncAllowedExts 不含 .json，故单独处理）
	// 其他 .json（如动画/控制器/模型引用文件）不应单独推送
	if strings.HasSuffix(base, ".json") {
		return base == "ysm.json"
	}
	for _, ext := range types.AllExts() {
		if strings.HasSuffix(base, ext) {
			return true
		}
	}
	return false
}

// HasModInDirFn 判断 mods 目录是否含有指定类型 mod 的函数类型。
type HasModInDirFn func(modsDir string) bool

// CompareGlobalInstanceHashes 对比全局目录和整合包实例子目录，返回每个实例的
// Missing / Extra / Synced 状态。
// 匹配口径与右侧同步管理器（go/instance.BuildSyncItems → SyncResources）统一为
// 「文件名（去 .disabled/.ban，小写）+ 大小」：修复 MMD（.pmx/.pmd 不计算 SHA256，
// 旧哈希比对恒 0）与蓝图（实例目录非标准路径）在侧栏不显示的问题。
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

	instances := listFn(mcRoot)
	var results []types.InstanceStatus

	for _, ins := range instances {
		instDir := types.FindInstDir(ins.VersionDir, subDir, rtype)
		instEntries := scanFn(instDir)

		status := types.InstanceStatus{
			Name:      ins.Name,
			CustomDir: instDir,
			Missing:   []string{},
			Extra:     []string{},
		}
		if hasModFn != nil {
			status.HasMod = hasModFn(filepath.Join(ins.VersionDir, "mods"))
		}

		// 同名条目按「名字 → 条目」归并（与 SyncResources 一致，最后写入者胜）
		type nameEntry struct {
			path string
			size int64
		}
		globalByName := make(map[string]nameEntry)
		for _, e := range globalEntries {
			if !isSyncAllowed(e.Name) {
				continue
			}
			key := syncNameKey(e.Name)
			if key == "" {
				continue
			}
			globalByName[key] = nameEntry{path: e.Path, size: e.Size}
		}
		instByName := make(map[string]nameEntry)
		for _, c := range instEntries {
			if !isSyncAllowed(c.Name) {
				continue
			}
			key := syncNameKey(c.Name)
			if key == "" {
				continue
			}
			instByName[key] = nameEntry{path: c.Path, size: c.Size}
		}

		for key, g := range globalByName {
			if i, exists := instByName[key]; exists {
				if g.size != i.size {
					// 同名大小不同（内容已变化）→ 待推送更新
					status.Missing = append(status.Missing, g.path)
				} else {
					status.Synced++
				}
			} else {
				status.Missing = append(status.Missing, g.path)
			}
		}
		for key, i := range instByName {
			if _, exists := globalByName[key]; !exists {
				status.Extra = append(status.Extra, i.path)
			}
		}
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

// syncNameKey 归一化文件名用于同名匹配（与 SyncResources 口径一致：
// 小写 + 去除 .disabled/.ban 禁用后缀）。
func syncNameKey(name string) string {
	low := strings.ToLower(name)
	low = strings.TrimSuffix(low, ".disabled")
	low = strings.TrimSuffix(low, ".ban")
	return low
}
