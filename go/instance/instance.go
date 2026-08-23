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
// subtype 指定子类型目录名（如 EntityPlayer/SceneModel），仅 MMD 分组类型有效；
// 非空时路径限定到 subtype 子目录，避免扫全目录（清单式扫路径限定目录，与仓库侧同构）。
func BuildSyncItems(ins *types.VersionInstance, rtypes []ResourceTypeInfo, filesRoots map[string]string, subtype string) []types.ResourceSyncItem {
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
		isDirLevel := types.IsDirLevelSync(rt.ID)

		// buildChildrenForDir 为 dirLevelSync 类型的文件夹构建子条目列表
		// 通过 DiffFolderContents 获取文件夹内容级差异
		buildChildrenForDir := func(globalPath, instPath string) []types.ResourceSyncItem {
			// 只在两侧路径都存在时才做内容级 diff
			if _, err1 := os.Stat(globalPath); err1 != nil {
				return nil
			}
			if _, err2 := os.Stat(instPath); err2 != nil {
				return nil
			}
			diffs := ysmsync.DiffFolderContents(globalPath, instPath, rt.ID)
			if len(diffs) == 0 {
				return nil
			}
			children := make([]types.ResourceSyncItem, 0, len(diffs))
			for _, d := range diffs {
				childStatus := d.Status
				childIcon := rt.Icon
				// 子文件禁用检测
				lowName := strings.ToLower(filepath.Base(d.AbsPath))
				if types.IsDisableSuffix(lowName) {
					childStatus = types.SyncStatusDisabled
					childIcon = "⛔"
				}
				children = append(children, types.ResourceSyncItem{
					Path:   d.AbsPath,
					Name:   d.RelPath, // 使用相对路径作为名称，便于前端展示
					Status: childStatus,
					Type:   rt.ID,
					Icon:   childIcon,
					Size:   d.Size,
				})
			}
			return children
		}

		appendItem := func(p string, defaultStatus types.SyncStatus, isLegacy func(string) bool) {
			// 目录级类型：SyncResourcesDirLevel 返回的文件夹条目（如 hello_new_generation_core）
			// 无扩展名，需按目录放行——展示粒度与操作粒度一致
			isDirEntry := false
			if isDirLevel {
				if fi, err := os.Stat(p); err == nil && fi.IsDir() {
					isDirEntry = true
				}
			}
			if !types.IsTypeModelFile(p, rt.ID) &&
				!fsutil.IsResourcePackFolder(p) && !isDirEntry {
				return
			}
			// 三分支口径一致：先识别 .disabled/.ban 禁用标记（实例侧遗留的禁用文件不应显示
			// 为可推送的 Optional/普通 missing），再检测硬链接（旧仓库遗留，Extra 专用）
			lowName := strings.ToLower(filepath.Base(p))
			isDisabled := types.IsDisableSuffix(lowName)
			status := defaultStatus
			icon := rt.Icon
			if isDisabled {
				status = types.SyncStatusDisabled
				icon = "⛔"
			} else if isLegacy != nil && isLegacy(p) {
				status = types.SyncStatusLegacy
				icon = "🔗"
			}

			// 为 dirLevelSync 的文件夹构建子条目列表 + diverged 聚合状态
			var children []types.ResourceSyncItem
			isDir := isDirEntry
			if isDirLevel && isDirEntry {
				// 计算实例侧对应的文件夹路径
				instPath := p
				if strings.HasPrefix(p, globalDir) {
					rel := strings.TrimPrefix(p, globalDir)
					instPath = filepath.Join(instDir, rel)
				}
				children = buildChildrenForDir(p, instPath)
				// 有内容差异 → 聚合为 diverged（继承 missing 的可操作属性）
				if len(children) > 0 {
					hasDiff := false
					for _, c := range children {
						if c.Status != types.SyncStatusSynced {
							hasDiff = true
							break
						}
					}
					if hasDiff {
						status = types.SyncStatusDiverged
						icon = "🗂️"
					}
				}
			}

			items = append(items, types.ResourceSyncItem{
				Path: p, Name: filepath.Base(p),
				Status: status, Type: rt.ID, Icon: icon, Size: sizeOf(p),
				IsDir: isDir, Children: children,
			})
		}

		for _, p := range result.Synced {
			appendItem(p, types.SyncStatusSynced, nil)
		}
		for _, p := range result.Missing {
			// Missing 分支补 disabled 检测——原仅 Synced 分支
			// 识别 .disabled/.ban，全局仓库禁用模型（m.ysm.ban）在实例缺失时显示为
			// 普通 missing（可推送外观）而非 disabled，三分支口径已统一
			appendItem(p, types.SyncStatusMissing, nil)
		}
		for _, p := range result.Extra {
			appendItem(p, types.SyncStatusOptional, func(p string) bool {
				return ysmsync.GetLinkType(p) == types.LinkHard
			})
		}
		// 兜底 Walk（IsScanInstance）已移除——ADR-064 阶段二：SyncResources 相对路径
		// 对比全树递归收集所有受支持文件（含嵌套），同名不同目录不再 map 去重丢失，
		// 原兜底（SyncResources 丢同名文件时补全）已无新增条目可补，删除防重复列示。
	}
	return items
}

// isResourcePackFolder 检查目录是否是资源包文件夹（内含 pack.mcmeta）——统一走 fsutil 收敛实现
