// ===== 扩展名定义 =====
// 所有扩展名和子目录信息均通过 resource_types.json 注册表驱动，
// 新增类型只需在 JSON 中添加条目，无需修改此文件。
package types

import (
	"path"
	"path/filepath"
	"strings"
)

// mmdSubdirNames MC-MMD 资源树的按用途子目录（ADR-092 路线 B / ADR-096）。
// 单一事实来源：sync_dirlevel（同步保留层级）与 instance.BuildSyncItems（展示分组）
// 均引用本集合。含 DefaultAnim/DefaultMorph 模组系统内置目录——用户不导入，
// 但已存在时同步需识别保留、展示需归属分组。
var mmdSubdirNames = map[string]bool{
	"entityplayer": true,
	"scenemodel":   true,
	"defaultanim":  true,
	"customanim":   true,
	"stageanim":    true,
	"defaultmorph": true,
	"custommorph":  true,
	"shader":       true,
}

// IsMMDSubDir 判断目录名是否为 MC-MMD 用途子目录（大小写不敏感）
func IsMMDSubDir(name string) bool {
	return mmdSubdirNames[strings.ToLower(name)]
}

// IsSubDirGrouping 判断 rtype 是否支持子目录分组（ADR-096）：
// storage 按用途子目录组织（如 mmd-skin 的 EntityPlayer/SceneModel/CustomAnim），
// 同步保留层级、前端展示分批。消费注册表 subDirGrouping 字段，不硬编码 rtype。
func IsSubDirGrouping(rtype string) bool {
	if rt := RegistryType(rtype); rt != nil {
		return rt.SubDirGrouping
	}
	return false
}

// IsNestedModelDir 判断 rtype 是否有嵌套模型目录结构（ADR-095）：
// 模型入口文件在 assets/<namespace>/ 下（如 maid-model 的 maid_model.json）。
// 消费注册表 nestedModelDir 字段，不硬编码 rtype。
func IsNestedModelDir(rtype string) bool {
	if rt := RegistryType(rtype); rt != nil {
		return rt.NestedModelDir
	}
	return false
}

// MaxImportSize 导入文件最大体积限制（500MB）
// MMD/VRC 模型文件可达数十 MB，但超过 500MB 的文件可能是异常数据
const MaxImportSize = 500 * 1024 * 1024

// MaxImportSizeMB MaxImportSize 的 MB 整数表示（错误文案格式化用，防 500MB 字面量漂移）
const MaxImportSizeMB = MaxImportSize / (1024 * 1024)

// MaxReadLimit 单文件/条目读取上限（50MB）——共享常量（索引 6.7+5.2）：
// 收敛 geometry maxExtractSize（ZIP/7z 条目防炸弹）、fileops maxPreviewRead（预览整读）、
// ysm maxReadSize/maxYsmJSON/maxTexGeo/maxTexJSON（解析整读）三包 9 处独立声明的
// `50 << 20` 为单一事实来源，任一包调整上限只改本常量。
const MaxReadLimit = 50 << 20

// AllExts 返回所有支持的扩展名（去重后）
func AllExts() []string {
	reg := LoadRegistry()
	seen := map[string]bool{}
	var result []string
	for _, rt := range reg.ResourceTypes {
		for _, e := range rt.Extensions {
			if !seen[e] {
				seen[e] = true
				result = append(result, e)
			}
		}
	}
	return result
}

// IsSupportedExt 检查扩展名是否被任何资源类型支持
func IsSupportedExt(ext string) bool {
	ext = strings.ToLower(ext)
	reg := LoadRegistry()
	for _, rt := range reg.ResourceTypes {
		for _, e := range rt.Extensions {
			if strings.ToLower(e) == ext {
				return true
			}
		}
	}
	return false
}

// IsYsmEntryJSON 判断是否为 YSM 解压目录的唯一清单入口 ysm.json（大小写不敏感）
// ADR-038 D2：.json 仅放行 ysm.json；包内 geometry/animation/语言 json 不得作为独立条目
// 扫描（scanner）、导入（importer/app_install）统一走此判定，口径单点维护。
func IsYsmEntryJSON(baseName string) bool {
	return strings.EqualFold(strings.TrimSpace(baseName), "ysm.json")
}

// NormalizeResourceName 归一化资源文件名用于同步匹配（ADR-064 收敛）：
// 小写 + 去除 .disabled/.ban 禁用后缀。原 sync.isSyncAllowed/syncNameKey/
// instance.extMatch/scanner.stripDisableSuffix 四处内联同义实现收敛于此。
func NormalizeResourceName(name string) string {
	low := strings.ToLower(name)
	low = strings.TrimSuffix(low, ".disabled")
	low = strings.TrimSuffix(low, ".ban")
	return low
}

// IsResourceAllowed 判断文件名是否属于受支持的同步资源（ADR-064 收敛）：
// 扩展名命中注册表全扩展集（AllExts），.json 仅放行 ysm.json（统一走
// IsYsmEntryJSON，含 TrimSpace/大小写不敏感）。
// 原 sync.isSyncAllowed 收敛于此；scanner 内联过滤语义一致（scanner 另有
// .ban 目录跳过等展示层逻辑，保持独立）。
func IsResourceAllowed(name string) bool {
	base := NormalizeResourceName(name)
	// .json 只允许 ysm.json（其余为动作/动画/模型引用文件，不应单独同步）
	if strings.HasSuffix(base, ".json") {
		return IsYsmEntryJSON(base)
	}
	for _, ext := range AllExts() {
		if strings.HasSuffix(base, ext) {
			return true
		}
	}
	return false
}

// IsTypeModelFile 判断文件名是否为指定资源类型的模型文件（ADR-064 收敛）：
// 扩展名命中该类型注册表扩展集（SupportedExtsForType），.json 仅放行 ysm.json。
// 原 sync.isModelFile 与 instance.extMatch 收敛于此（差异：空扩展集返回 false，
// 与 isModelFile 严格语义一致；extMatch 的空集放行分支在 BuildSyncItems 中
// 不会触发——未知类型早被 SubDirMap 空拦截跳过）。
func IsTypeModelFile(name, rtype string) bool {
	base := NormalizeResourceName(name)
	// ysm.json 特判（.json 扩展名在注册表中但只有 ysm.json 算模型文件）：
	// 仅当该类型扩展集含 .json（ysm）时放行——resourcepack/shaderpack 扩展集
	// 只有 .zip，整合包目录散落的 ysm.json 不得作为其独立同步条目（P3 修复：
	// 整合包推送/拉取列表被 ysm.json 刷屏）。
	if IsYsmEntryJSON(base) {
		for _, e := range SupportedExtsForType(rtype) {
			if strings.EqualFold(e, ".json") {
				return true
			}
		}
		return false
	}
	ext := strings.ToLower(filepath.Ext(base))
	for _, e := range SupportedExtsForType(rtype) {
		if ext == strings.ToLower(e) && !strings.EqualFold(e, ".json") {
			return true
		}
	}
	return false
}

// ShouldHashExt 判断扩展名是否需要计算 SHA256 哈希（用于同步系统文件匹配）
// 注册表驱动：任何声明 hashable 的资源类型的扩展名均计入哈希。
// 跳过非 YSM 类型的大文件（MMD/VRC 文件可达数十 MB，哈希全量太慢）；
// 蓝图/投影文件（.nbt/.schematic/.litematic）通常较小，计入哈希以支持同步对比。
// 新增类型只需在 resource_types.json 标 hashable:true，无需改本函数。
func ShouldHashExt(ext string) bool {
	ext = strings.ToLower(ext)
	reg := LoadRegistry()
	for _, rt := range reg.ResourceTypes {
		if !rt.Hashable {
			continue
		}
		for _, e := range rt.Extensions {
			if strings.ToLower(e) == ext {
				return true
			}
		}
	}
	return false
}

// IsDirLevelSync 判断 rtype 是否为文件夹级资源同步类型
// （sync.SyncResourcesDirLevel 按文件夹名对比；注册表 dirLevelSync 驱动，新增类型只需改 JSON）
func IsDirLevelSync(rtype string) bool {
	if rt := RegistryType(rtype); rt != nil {
		return rt.DirLevelSync
	}
	return false
}

// IsScanInstance 判断 rtype 是否需要 instance 视图额外扫描整合包目录。
// 已废弃（ADR-064 阶段二）：SyncResources 相对路径对比全树递归收集所有受支持
// 文件（含嵌套），同名不同目录不再 map 去重丢失，原兜底 Walk 无新增条目可补，
// 本函数无调用方（2026-08-15 审核确认），保留定义仅为兼容资源类型注册表
// scanInstance 字段解析；新增代码禁止使用。
// Deprecated: 无消费方，计划随 scanInstance 字段一并移除。
func IsScanInstance(rtype string) bool {
	if rt := RegistryType(rtype); rt != nil {
		return rt.ScanInstance
	}
	return false
}

// InstallExtsFor 返回 rtype 的安装白名单扩展名（空=全部放行，仅可执行文件黑名单除外）
// installer.installDirRecursive 的 isAllowed 注册表驱动；新增类型只需改 JSON。
func InstallExtsFor(rtype string) []string {
	if rt := RegistryType(rtype); rt != nil {
		return append([]string(nil), rt.InstallExts...)
	}
	return nil
}

// MatchZipEntry 按注册表 zipEntries 特征匹配 ZIP 条目名，返回命中的资源类型 ID。
// importer.DetectZipType 注册表驱动（Top 2）：新增类型只需在 JSON 中声明
// zipEntries（exact/prefix/suffix），无需修改检测器代码。
// 按注册表顺序优先匹配（resourcepack → shaderpack → ysm → …），无命中返回空串。
func MatchZipEntry(name string) string {
	reg := LoadRegistry()
	for _, rt := range reg.ResourceTypes {
		if len(rt.ZipEntries) == 0 {
			continue
		}
		if rt.MatchZipEntry(name) {
			return rt.ID
		}
	}
	return ""
}

// ExtBelongsTo 返回扩展名所属的资源类型 ID 列表（可能多个）
func ExtBelongsTo(ext string) []string {
	ext = strings.ToLower(ext)
	reg := LoadRegistry()
	var result []string
	for _, rt := range reg.ResourceTypes {
		for _, e := range rt.Extensions {
			if strings.ToLower(e) == ext {
				result = append(result, rt.ID)
			}
		}
	}
	return result
}

// SupportedExtsForType 返回指定资源类型的所有扩展名
func SupportedExtsForType(rtype string) []string {
	if rt := RegistryType(rtype); rt != nil {
		return append([]string(nil), rt.Extensions...)
	}
	// 小写兜底（向后兼容）
	if rt := RegistryType(strings.ToLower(rtype)); rt != nil {
		return append([]string(nil), rt.Extensions...)
	}
	return nil
}

// StorageSubDir 每种资源类型在 FilesRoot 下的存储子目录
// 从 resource_types.json 注册表读取，无匹配时返回 rtype 自身
func StorageSubDir(rtype string) string {
	if rt := RegistryType(rtype); rt != nil && rt.StorageSubDir != "" {
		return rt.StorageSubDir
	}
	return rtype
}

// GroupOf 返回资源类型所属分组 id（ADR-092）
// 从注册表 group 字段读取；无 group 字段时返回空串（表示单级平铺、不参与分组）。
func GroupOf(rtype string) string {
	if rt := RegistryType(rtype); rt != nil && rt.Group != "" {
		return rt.Group
	}
	return ""
}

// GroupStorageRoot 返回资源类型在 FilesRoot 下的分组存储根目录（ADR-092 两层路由）：
//   - 有 group：FilesRoot/{group}/{storageSubDir}
//   - 无 group（向后兼容）：FilesRoot/{storageSubDir}（单级平铺，不强制迁移旧目录）
//
// 返回的是相对于 FilesRoot 的子路径（不含 FilesRoot 本身），调用方自行 Join。
func GroupStorageRoot(rtype string) string {
	rt := RegistryType(rtype)
	if rt == nil {
		return rtype
	}
	sub := rt.StorageSubDir
	if sub == "" {
		sub = rtype
	}
	if rt.Group != "" {
		return path.Join(rt.Group, sub)
	}
	return sub
}

// GroupLabel 返回分组显示名（ADR-092 resourceGroups 元数据）；未知分组返回空串。
func GroupLabel(group string) string {
	if group == "" {
		return ""
	}
	reg := LoadRegistry()
	for _, g := range reg.ResourceGroups {
		if g.ID == group {
			return g.Name
		}
	}
	return ""
}

// SubDirEntry 资源类型的版本子目录信息
type SubDirEntry struct {
	SubDir string
	RType  string
}

// SubDirMap 返回指定资源类型在整合包实例版本目录中的扫描子目录
func SubDirMap(rtype string) string {
	if rt := RegistryType(rtype); rt != nil && rt.ScanDir != "" {
		return rt.ScanDir
	}
	// 小写兜底（向后兼容）
	if rt := RegistryType(strings.ToLower(rtype)); rt != nil && rt.ScanDir != "" {
		return rt.ScanDir
	}
	return ""
}

// SubDirAll 返回所有资源类型在整合包实例中的版本扫描子目录映射
func SubDirAll() map[string]string {
	reg := LoadRegistry()
	m := make(map[string]string, len(reg.ResourceTypes))
	for _, rt := range reg.ResourceTypes {
		if rt.ScanDir != "" {
			m[rt.ID] = rt.ScanDir
		}
	}
	return m
}

// AllSubDirs 返回所有资源类型的版本子目录信息（遍历用）
func AllSubDirs() []SubDirEntry {
	reg := LoadRegistry()
	result := make([]SubDirEntry, 0, len(reg.ResourceTypes))
	for _, rt := range reg.ResourceTypes {
		if rt.ScanDir != "" {
			result = append(result, SubDirEntry{SubDir: rt.ScanDir, RType: rt.ID})
		}
	}
	return result
}
