// ===== 扩展名定义 =====
// 所有扩展名和子目录信息均通过 resource_types.json 注册表驱动，
// 新增类型只需在 JSON 中添加条目，无需修改此文件。
package types

import (
	"errors"
	"log"
	"os"
	"path/filepath"
	"strings"
)

// MaxImportSize 导入文件最大体积限制（500MB）
// MMD/VRC 模型文件可达数十 MB，但超过 500MB 的文件可能是异常数据
const MaxImportSize = 500 * 1024 * 1024

// MaxImportSizeMB MaxImportSize 的 MB 整数表示（错误文案格式化用，防 500MB 字面量漂移）
const MaxImportSizeMB = MaxImportSize / (1024 * 1024)

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

// IsScanInstance 判断 rtype 是否需要 instance 视图额外扫描整合包目录
// （非模型类型兜底：SyncResources 的 map 去重会丢失同名文件，注册表 scanInstance 驱动）
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

// FindInstDir 查找整合包中指定资源类型的子目录：
// 1. 优先使用标准子目录名（如 schematics）
// 2. 如果标准目录不存在，扫描整合包版本目录下所有子目录，找包含该类型文件的目录
func FindInstDir(versionDir, subDir, rtype string) string {
	standard := filepath.Join(versionDir, subDir)
	if info, err := os.Stat(standard); err == nil && info.IsDir() {
		return standard
	}
	// 标准目录不存在，兜底扫描
	exts := SupportedExtsForType(rtype)
	if len(exts) == 0 {
		return standard // 没有扩展名信息，返回标准路径
	}
	entries, err := os.ReadDir(versionDir)
	if err != nil {
		return standard
	}
	extSet := make(map[string]bool)
	for _, e := range exts {
		extSet[strings.ToLower(e)] = true
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		sub := filepath.Join(versionDir, e.Name())
		found := false
		if werr := filepath.WalkDir(sub, func(p string, d os.DirEntry, err error) error {
			if err != nil || found {
				return err
			}
			if !d.IsDir() && extSet[strings.ToLower(filepath.Ext(p))] {
				found = true
				return filepath.SkipAll
			}
			return nil
		}); werr != nil && !errors.Is(werr, filepath.SkipAll) {
			log.Printf("[types] FindInstDir 兜底扫描失败 %s: %v", sub, werr)
		}
		if found {
			return sub
		}
	}
	return standard // 没找到，返回标准路径（SyncResources 会找到空目录返回空结果）
}

// StorageSubDir 每种资源类型在 FilesRoot 下的存储子目录
// 从 resource_types.json 注册表读取，无匹配时返回 rtype 自身
func StorageSubDir(rtype string) string {
	if rt := RegistryType(rtype); rt != nil && rt.StorageSubDir != "" {
		return rt.StorageSubDir
	}
	return rtype
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
