// ===== 整合包实例同步状态组装（ADR-003 补充下沉）=====
// 从 internal/app/app_install.go 的 GetInstanceSyncStatus 提取组装逻辑；
// 纯 Go 逻辑，无 Wails runtime 依赖；McRoot/注册表/仓库根目录由薄壳注入。
package instance

import (
	"os"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/fsutil"
	ysmsync "ysm-model-manager/go/sync"
	"ysm-model-manager/go/types"
)

// ResourceTypeInfo 资源类型注册表条目（BuildSyncItems 需要的字段）
type ResourceTypeInfo struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Icon string `json:"icon"`
}

// BuildSyncItems 组装整合包内各资源类型的同步状态项（纯逻辑，root 由调用方注入）
func BuildSyncItems(ins *types.VersionInstance, rtypes []ResourceTypeInfo, filesRoots map[string]string) []types.ResourceSyncItem {
	// 导出函数无 nil 守卫——直接解引用 ins.VersionDir 会 panic。
	// 当前唯一调用方保证非 nil，但防御范式（ADR-044②）要求导出入口自守卫
	if ins == nil {
		return nil
	}
	// 各资源类型允许的扩展名过滤统一走 types.IsTypeModelFile（ADR-064 收敛：
	// 原 extMatch 内联同义实现；差异仅空扩展集分支——BuildSyncItems 的类型均有
	// ScanDir 与扩展名，不会触发，语义等价）
	sizeOf := func(path string) int64 {
		fi, err := os.Stat(path)
		if err != nil {
			return 0
		}
		return fi.Size()
	}

	var items []types.ResourceSyncItem

	for _, rt := range rtypes {
		subDir := types.SubDirMap(rt.ID)
		if subDir == "" {
			continue
		}
		// 全局目录
		globalDir := filesRoots[rt.ID]
		if globalDir == "" {
			continue
		}
		// 整合包子目录——先试标准目录，再兜底扫描
		instDir := types.FindInstDir(ins.VersionDir, subDir, rt.ID)
		// ADR-064 审核修复：dir-level 类型（ysm/MMD/蓝图）展示与操作同走
		// SyncResourcesDirLevel（文件夹粒度），否则展示文件条目、操作却是整个文件夹，
		// UI 粒度不一致误导；file-level 类型走 SyncResources（相对路径对比）
		var result types.ResourceSyncResult
		if types.IsDirLevelSync(rt.ID) {
			result = ysmsync.SyncResourcesDirLevel(globalDir, instDir, rt.ID)
		} else {
			result = ysmsync.SyncResources(globalDir, instDir, rt.ID)
		}

		// appendItem 组装同步条目：类型/资源包文件夹过滤 + .disabled/.ban 禁用判定 +
		// icon 选择，收敛 Synced/Missing/Extra 三分支逐字重复（索引 6.8c）。
		// defaultStatus 为分支默认状态；isLegacy 仅 Extra 分支传（旧仓库硬链接检测），其余传 nil。
		// relRoot 为条目所属侧的根（Synced/Missing 传 globalDir，Extra 传 instDir），
		// 用于子类分组判定——同一路径跨仓库/整合包两侧须各按自己的根算相对路径。
		isDirLevel := types.IsDirLevelSync(rt.ID)
		appendItem := func(p string, defaultStatus types.SyncStatus, isLegacy func(string) bool, relRoot string) {
			// 目录级类型：SyncResourcesDirLevel 返回的文件夹条目（如 hello_new_generation_core）
			// 无扩展名，需按目录放行——展示粒度与操作粒度一致
			isDirEntry := false
			if isDirLevel {
				if fi, err := os.Stat(p); err == nil && fi.IsDir() {
					isDirEntry = true
				}
			}
			if !types.IsTypeModelFile(filepath.Base(p), rt.ID) &&
				!fsutil.IsResourcePackFolder(p) && !isDirEntry {
				return
			}
			// 三分支口径一致：先识别 .disabled/.ban 禁用标记（实例侧遗留的禁用文件不应显示
			// 为可推送的 Optional/普通 missing），再检测硬链接（旧仓库遗留，Extra 专用）
			lowName := strings.ToLower(filepath.Base(p))
			isDisabled := strings.HasSuffix(lowName, ".disabled") || strings.HasSuffix(lowName, ".ban")
			status := defaultStatus
			icon := rt.Icon
			if isDisabled {
				status = types.SyncStatusDisabled
				icon = "⛔"
			} else if isLegacy != nil && isLegacy(p) {
				status = types.SyncStatusLegacy
				icon = "🔗"
			}
			// ADR-096：MMD 展示分组——dirLevel 条目按所属侧根（relRoot）算相对路径，
			// 首个路径段为用途子类目录（EntityPlayer/SceneModel/CustomAnim 等）时填
			// SubDir，前端按组分批展示；根下条目 SubDir=""（= EntityPlayer 默认）。
			subDir := ""
			if types.IsSubDirGrouping(rt.ID) {
				if rel, err := filepath.Rel(relRoot, p); err == nil && rel != "." {
					// ADR-104：rtype 感知子目录判定（替代旧 IsMMDSubDir 全局判定）
					if seg := strings.Split(rel, string(filepath.Separator))[0]; types.IsSubDirName(rt.ID, seg) {
						subDir = seg
					}
				}
			}
			items = append(items, types.ResourceSyncItem{
				Path: p, Name: filepath.Base(p),
				Status: status, Type: rt.ID, Icon: icon, Size: sizeOf(p), SubDir: subDir,
			})
		}

		for _, p := range result.Synced {
			appendItem(p, types.SyncStatusSynced, nil, globalDir)
		}
		for _, p := range result.Missing {
			// Missing 分支补 disabled 检测——原仅 Synced 分支
			// 识别 .disabled/.ban，全局仓库禁用模型（m.ysm.ban）在实例缺失时显示为
			// 普通 missing（可推送外观）而非 disabled，三分支口径已统一
			appendItem(p, types.SyncStatusMissing, nil, globalDir)
		}
		for _, p := range result.Extra {
			appendItem(p, types.SyncStatusOptional, func(p string) bool {
				return ysmsync.GetLinkType(p) == types.LinkHard
			}, instDir)
		}
		// 兜底 Walk（IsScanInstance）已移除——ADR-064 阶段二：SyncResources 相对路径
		// 对比全树递归收集所有受支持文件（含嵌套），同名不同目录不再 map 去重丢失，
		// 原兜底（SyncResources 丢同名文件时补全）已无新增条目可补，删除防重复列示。
	}
	return items
}

// isResourcePackFolder 检查目录是否是资源包文件夹（内含 pack.mcmeta）——统一走 fsutil 收敛实现
