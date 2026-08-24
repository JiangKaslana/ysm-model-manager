// ===== 整合包实例同步状态组装（ADR-003 补充下沉）=====
// 从 internal/app/app_install.go 的 GetInstanceSyncStatus 提取组装逻辑；
// 纯 Go 逻辑，无 Wails runtime 依赖；McRoot/注册表/仓库根目录由薄壳注入。
package instance

import (
	"os"
	"path/filepath"
	"sort"
	"strings"

	"ysm-model-manager/go/fsutil"
	ysmsync "ysm-model-manager/go/sync"
	"ysm-model-manager/go/scanner"
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
			// 注入 scanner.ScanEntriesWithHit 复用刷新已缓存的扫描结果，
			// 消除 8 个 MMD 子类型 ×(1+N 整合包) 对同一仓库树的重复 Walk
			result = ysmsync.SyncResourcesDirLevelScan(globalDir, instDir, rt.ID, scanner.ScanEntriesWithHit)
		} else {
			result = ysmsync.SyncResources(globalDir, instDir, rt.ID)
		}

		// appendItem 组装同步条目：类型/资源包文件夹过滤 + .disabled/.ban 禁用判定 +
		// icon 选择，收敛 Synced/Missing/Extra 三分支逐字重复（索引 6.8c）。
		// defaultStatus 为分支默认状态；isLegacy 仅 Extra 分支传（旧仓库硬链接检测），其余传 nil。
		isDirLevel := types.IsDirLevelSync(rt.ID)

		// per-type 收集 扁平单元；dirLevel 类型在循环末尾树化（nestDirLevelTree），
		// 中间目录重建为容器节点——仓库怎么来，整合包就怎么来（镜像磁盘层级）
		var typeItems []types.ResourceSyncItem

		// buildChildrenForDir 为 dirLevelSync 类型的文件夹构建子条目列表
		// 通过 DiffFolderContents 获取文件夹内容级差异
		buildChildrenForDir := func(globalPath, instPath string) []types.ResourceSyncItem {
			// 仓库是权威源：只要仓库侧文件夹存在即可构建子项（供 missing 夹预览
			// 待推送文件）。实例侧缺失时 DiffFolderContents 对其扫描为空 → 全局文件全标
			// missing——仓库怎么来，整合包就怎么来。
			if _, err1 := os.Stat(globalPath); err1 != nil {
				return nil
			}
			// DiffFolderContents 返回全局侧文件清单（synced 条目含在结果中——前端
			// 子文件列表需全量展示）；实例侧目录不存在时自然降级为全部 missing
			diffs := ysmsync.DiffFolderContents(globalPath, instPath, rt.ID)
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
			// 文件夹用 📁，扁平文件才用类型图标（💎）——避免「真模型夹/容器」误显示为
			// 独立模型图标。disabled/legacy 仍各自覆盖
			if isDirEntry {
				icon = "📁"
			}
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
				// 仅「两侧都在但内容有差异」的夹聚合为 diverged（继承 missing 可操作）：
				// 对 synced 夹，子项有非 synced → diverged；missing/optional 夹保持自身状态——
				// 整体缺失/整体多余不降级成「部分差异」，但子项清单照常展示（仓库是权威源）
				if len(children) > 0 {
					hasDiff := false
					for _, c := range children {
						if c.Status != types.SyncStatusSynced {
							hasDiff = true
							break
						}
					}
					// code review P2：diverged 提升不覆盖 Disabled/Legacy（status 仍为默认才
					// 提升）；且仅 synced 夹提升——missing 夹（子项全 missing）与 optional 夹
					// 保持自身状态，避免「整体缺失」误标成「部分差异」
					if hasDiff && defaultStatus == types.SyncStatusSynced && status == defaultStatus {
						status = types.SyncStatusDiverged
						icon = "🗂️"
					}
				}
			}

			typeItems = append(typeItems, types.ResourceSyncItem{
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

		// dirLevel 类型：重建展示树，中间目录变容器节点，镜像磁盘层级
		if isDirLevel {
			typeItems = nestDirLevelTree(typeItems, globalDir, instDir, rt.ID)
		}
		items = append(items, typeItems...)
	}
	return items
}

// isResourcePackFolder 检查目录是否是资源包文件夹（内含 pack.mcmeta）——统一走 fsutil 收敛实现

// nestTreeNode 展示树节点：中间目录（容器）或叶子单元
type nestTreeNode struct {
	// 容器字段
	isDir   bool
	relPath string // 相对仓库/实例根，段连接符 "/"
	// 叶子字段（isDir=false 或叶子模型夹）
	leaf *types.ResourceSyncItem
	// 容器 children：key = 下一路径段（目录段，不含扩展名判断——直接用段名）
	children map[string]*nestTreeNode
}

// nestDirLevelTree 把扁平 dirLevel 同步单元按相对路径段重建为嵌套展示树。
// 设计：模型文件夹/文件是叶子单元（保留现有 children——文件级 diff）；
// 仅含子模型的中间目录（如 wine_fox_json）自动生成容器节点（isDir=true + 聚合状态）。
// 顶层只返回根下直接子项（children 深度嵌套），镜像磁盘真实层级。
// 路径基准：Synced/Missing 是全局路径（globalDir 下），Extra 是实例路径（instDir 下）——
// 逐条按命中 root 剥离出相对路径段。
func nestDirLevelTree(flat []types.ResourceSyncItem, globalDir, instDir, rtype string) []types.ResourceSyncItem {
	root := &nestTreeNode{children: map[string]*nestTreeNode{}}
	relOf := func(p string) (string, bool) {
		for _, basedir := range []string{globalDir, instDir} {
			// 分隔符守卫：避免两根呈前缀嵌套时误归属（如 D:\repo 与 D:\repo-instance）
			if basedir == "" {
				continue
			}
			sep := string(filepath.Separator)
			if p != basedir && !strings.HasPrefix(p, basedir+sep) {
				continue
			}
			rel, err := filepath.Rel(basedir, p)
			if err != nil || rel == "." || strings.HasPrefix(rel, "..") {
				return "", false
			}
			return filepath.ToSlash(rel), true
		}
		return "", false
	}
	// 为每个条目计算相对 root 的路径段，并挂入树
	for i := range flat {
		it := &flat[i]
		rel, ok := relOf(it.Path)
		if !ok {
			// 路径无法归属任一 root（防御）——保持扁平顶层
			root.children[it.Path] = &nestTreeNode{leaf: it}
			continue
		}
		segs := strings.Split(rel, "/")
		insert := func(leaf *types.ResourceSyncItem, segs []string) {
			cur := root
			for _, s := range segs[:len(segs)-1] {
				nxt, ok := cur.children[s]
				if !ok || nxt == nil {
					nxt = &nestTreeNode{isDir: true, children: map[string]*nestTreeNode{}}
					cur.children[s] = nxt
				} else if nxt.leaf != nil {
					// 同段名已是叶子（如全局侧平铺模型夹），又作为容器段下钻（实例侧同级更深嵌套）：
					// 防御——保留原叶子作为其下 `__self` 子项，避免覆盖/ nil map 写入 panic。
					// 现实中 SyncResourcesDirLevel 对模型夹 SkipDir 极少触发，属防御性降级。
					carry := nxt.leaf
					nxt.leaf = nil
					if nxt.children == nil {
						nxt.children = map[string]*nestTreeNode{}
					}
					nxt.children["__self"] = &nestTreeNode{leaf: carry}
				}
				cur = nxt
			}
			last := segs[len(segs)-1]
			if existing, ok := cur.children[last]; ok && existing != nil && existing.isDir {
				// 同段名既是叶子又是中间容器：把叶子收进 __self，防覆盖容器
				if existing.children == nil {
					existing.children = map[string]*nestTreeNode{}
				}
				existing.children["__self"] = &nestTreeNode{leaf: leaf}
				return
			}
			cur.children[last] = &nestTreeNode{leaf: leaf}
		}
		insert(it, segs)
	}
	return treeChildren(root, "", globalDir, instDir, rtype)
}

// treeChildren 把容器节点 children 展平为 ResourceSyncItem 列表
// 容器：isDir=true + 聚合状态（若子项有非 synced 差异 → diverged）；叶子原样返回
// baseRel：容器相对 root 的路径（段连接符 "/"）；root 用于还原容器绝对路径供 push/pull
func treeChildren(node *nestTreeNode, baseRel, globalDir, instDir, rtype string) []types.ResourceSyncItem {
	if len(node.children) == 0 {
		return nil
	}
	// 排序保证确定性输出
	keys := make([]string, 0, len(node.children))
	for k := range node.children {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	out := make([]types.ResourceSyncItem, 0, len(keys))
	for _, k := range keys {
		c := node.children[k]
		if c.leaf != nil {
			// 相对路径重建：叶子单元保留自身路径与状态
			out = append(out, *c.leaf)
			continue
		}
		// 容器：递归构建 children，聚合状态
		childRel := joinRel(baseRel, k)
		children := treeChildren(c, childRel, globalDir, instDir, rtype)
		status := aggregateStatus(children)
		icon := "📁"
		// 容器状态只可能是 synced/diverged/optional（aggregateStatus 聚合结果），无 missing；
		// 有差异(含可推/可拉)时用 🗂️ 指示可展开
		if status == types.SyncStatusDiverged || status == types.SyncStatusOptional {
			icon = "🗂️"
		}
		// 容器绝对路径：按聚合 status 选根——optional(可拉取) 源在实例侧，其余(可推送/同步) 源在
		// 全局侧。作为前端展开 key 与容器级 push/pull 的 data-path；避免混合夹锁错源侧
		containerPath := dirLevelContainerPath(status, childRel, globalDir, instDir)
		// Type 必填：前端 applyFilter 按 i.type === 选中类型过滤，容器若缺 Type(=空串)
		// 会被整体丢弃，导致整棵嵌套子树消失（嵌套1→嵌套2→动力臂 不显示的根因）
		out = append(out, types.ResourceSyncItem{
			Path:     containerPath,
			Name:     k,
			Status:   status,
			Type:     rtype,
			Icon:     icon,
			IsDir:    true,
			Children: children,
		})
	}
	return out
}

// dirLevelContainerPath 按容器聚合状态还原目录绝对路径。
// status 为 optional（纯实例独有，可拉取）→ 用实例根；否则（diverged/missing/synced，
// 可推送或同步）→ 用全局根。push 源在仓库侧、pull 源在整合包侧，方向与前端按钮一致。
func dirLevelContainerPath(status types.SyncStatus, rel, globalDir, instDir string) string {
	sep := string(filepath.Separator)
	relPath := strings.ReplaceAll(rel, "/", sep)
	base := globalDir
	if status == types.SyncStatusOptional {
		base = instDir
	}
	if base == "" {
		return rel
	}
	return filepath.Join(base, relPath)
}

// joinRel 拼接相对路径段
func joinRel(parent, seg string) string {
	if parent == "" {
		return seg
	}
	return parent + "/" + seg
}

// aggregateStatus 聚合子项状态：
//   - 全部 synced/disabled → synced（无推送差异；disabled 是用户刻意禁用的内容，不驱动容器推送）
//   - 含可推送差异（missing/diverged，不含 disabled）→ diverged（可推送）
//   - 仅 optional/legacy（实例侧独有）→ optional（可拉取）
//   - 空子项 → synced
//
// disabled 归入「中立」而非 hasPush：与 BuildSyncItems 自身「禁用内容不给推送按钮」语义一致——
// 否则含 .ban 子项的容器会被标 diverged、出现容器级 push 按钮，整夹 InstallDir 会覆盖用户刻意 .ban 的内容。
// 保留 optional 语义：纯可拉取容器应显示 pull 而非误归为 diverged 的 push
func aggregateStatus(children []types.ResourceSyncItem) types.SyncStatus {
	hasPush := false
	hasPull := false
	for _, c := range children {
		switch c.Status {
		case types.SyncStatusSynced, types.SyncStatusDisabled:
			// 同步项与禁用项都不算可推送差异（disabled 中立，防覆盖 .ban）
		case types.SyncStatusOptional, types.SyncStatusLegacy:
			hasPull = true
		default: // missing/diverged
			hasPush = true
		}
	}
	if hasPush {
		return types.SyncStatusDiverged
	}
	if hasPull {
		return types.SyncStatusOptional
	}
	return types.SyncStatusSynced
}
