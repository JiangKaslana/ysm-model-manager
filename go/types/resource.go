package types

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// bundledRegistryJSON 是编译期内嵌的 resource_types.json（单一事实来源）。
// 由根包 main 在 init() 中经 embed.go 读取并注入（types.SetBundledRegistryJSON），
// 与 internal/app 共用同一份 root embed，彻底取代旧的手工副本 resource_types_embed.go
// （曾因不同步导致分类被回退弹平）。测试/未注入场景下由 loadRegistryBytes 回退读取仓库根 resource_types.json。
var bundledRegistryJSON []byte

// SetBundledRegistryJSON 由根包 main 注入编译期内嵌的注册表字节（单源：仓库根 resource_types.json）。
func SetBundledRegistryJSON(b []byte) {
	bundledRegistryJSON = b
}

// ResourceTypeRegistry 资源类型注册表
type ResourceTypeRegistry struct {
	ResourceTypes []ResourceType `json:"resourceTypes"`
}

// ResourceType 一种受支持的资源类型定义
type ResourceType struct {
	ID             string            `json:"id"`
	Name           string            `json:"name"`
	Icon           string            `json:"icon"`
	Group          string            `json:"group"`                // 所属分组（ADR-092）：minecraft / minecraft-mod / mmd / vrm / other
	GroupLabel     string            `json:"groupLabel,omitempty"` // 分组显示名，仅该组首个类型携带（消除双写）
	GroupIcon      string            `json:"groupIcon,omitempty"`  // 分组图标，同上
	Extensions     []string          `json:"extensions"`
	StorageSubDir  string            `json:"storageSubDir"`
	InstallDir     string            `json:"installDir"`
	ScanDir        string            `json:"scanDir"`
	InstanceLevel  bool              `json:"instanceLevel"`
	Preview        string            `json:"preview"`            // "3d" / "thumbnail" / "none"
	Detector       string            `json:"detector"`           // "ysm" / "mcmeta" / "shader" / "zipentry" / "extension"
	ConfigField    string            `json:"configField"`        // AppConfig 字段名（如 YsmRoot）
	ConfigFallback string            `json:"configFallback"`     // AppConfig 回退字段名（如 VrcRoot→MmdRoot）
	IsDir          bool              `json:"isDir"`              // 目录型资源（删除/同步整目录）
	Hashable       bool              `json:"hashable"`           // 扩展名参与 SHA256 哈希（ShouldHashExt 注册表驱动）
	DirLevelSync   bool              `json:"dirLevelSync"`       // 文件夹级资源同步（sync.SyncResourcesDirLevel）
	ScanInstance   bool              `json:"scanInstance"`       // instance 视图额外扫描整合包目录（非模型类型兜底）
	InstallExts    []string          `json:"installExts"`        // 安装白名单扩展名（空=全部放行，仅可执行文件黑名单除外）
	ZipEntries     []ZipEntryMatch   `json:"zipEntries"`         // ZIP 内容特征条目（importer.DetectZipType 注册表驱动）
	SubDirGrouping bool              `json:"subDirGrouping"`     // 子目录分组（ADR-096）：storage 按用途子目录组织（如 mmd-skin 的 EntityPlayer/SceneModel），同步保留层级、展示分批
	SubTypes       []ResourceSubType `json:"subtypes,omitempty"` // 子类层（ADR-104）：小类映射整合包路径的注册表声明；subDirGrouping 类型必填
	NestedModelDir bool              `json:"nestedModelDir"`     // 嵌套模型目录（ADR-095）：模型入口在 assets/<namespace>/ 下（如 maid-model 的 maid_model.json）
}

// ResourceSubType 资源类型的用途子类（ADR-104/105：大类→小类→防御检验三层架构）。
// 小类是映射整合包路径的单元（如 mmd-skin 的 3d-skin/SceneModel），
// userImportable=false 表示系统内置目录（DefaultAnim/DefaultMorph 模组自动生成，
// 同步需识别保留但前端导入下拉不列出）；default=true 表示默认槽（EntityPlayer）。
//
// ADR-105 零继承自描述：每个 subtype 自带 icon/extensions/detector/zipEntries/preview，
// 识别链路 = 物理路径定位 subtype + subtype 自声明内容校验，绝不回溯父类型补全。
// 缺字段 = 无该能力（如 shader preview="none" 表示不可 3D 预览）。
type ResourceSubType struct {
	Name           string          `json:"name"`                 // 子目录名（PascalCase 规范名，如 SceneModel/shader）
	Label          string          `json:"label"`                // 显示名（前端下拉/分组用）
	Icon           string          `json:"icon"`                 // 图标（ADR-105 自声明，如 🧍/🎬）
	UserImportable bool            `json:"userImportable"`       // 用户可导入（false=系统内置目录）
	Default        bool            `json:"default"`              // 默认槽（根下文件归属，如 EntityPlayer）
	Extensions     []string        `json:"extensions"`           // 该子类接受的扩展名（ADR-105 自声明）
	Detector       string          `json:"detector"`             // 识别器（ysm/mcmeta/shader/zipentry/extension，ADR-105 自声明）
	ZipEntries     []ZipEntryMatch `json:"zipEntries"`           // 内容指纹（导入校验用，ADR-105 自声明）
	Preview        string          `json:"preview"`              // 预览能力（"3d"/"thumbnail"/"none"，ADR-105 自声明）
	InstallDir     string          `json:"installDir,omitempty"` // 小类整合包存储目录模板（如 3d-skin/SceneModel/；空=无独立目录）
	ScanDir        string          `json:"scanDir,omitempty"`    // 小类整合包扫描目录（如 3d-skin/SceneModel；空=无独立目录）
}

// AcceptsExt 判断文件扩展名（含点、大小写不敏感）是否被本子类接受。
// ADR-105 零继承内容校验：仅本子类自声明 extensions 参与判定——
// CustomAnim.AcceptsExt(".pmx") = false（角色模型不该进动画目录），
// 与父类型 mmd-skin 的扩展集无关。
func (st *ResourceSubType) AcceptsExt(ext string) bool {
	ext = strings.ToLower(ext)
	for _, e := range st.Extensions {
		if strings.ToLower(e) == ext {
			return true
		}
	}
	return false
}

// MatchZipEntry 检测 ZIP 条目名是否命中本子类的特征条目（小写不敏感）。
// ADR-105 零继承：仅本子类自声明 zipEntries 参与匹配，不合并父类型指纹——
// CustomAnim 命中 walk.vmd 不命中 hero.pmx（父 mmd-skin 的 .pmx 指纹不继承）。
func (st *ResourceSubType) MatchZipEntry(name string) bool {
	low := strings.ToLower(name)
	segs := strings.Split(strings.ReplaceAll(low, "\\", "/"), "/")
	for i := range segs {
		seg := strings.Join(segs[i:], "/")
		for _, m := range st.ZipEntries {
			mlow := strings.ToLower(m.Name)
			switch m.Match {
			case "prefix":
				if strings.HasPrefix(seg, mlow) {
					return true
				}
			case "suffix":
				if strings.HasSuffix(seg, mlow) {
					return true
				}
			default: // "exact"
				if seg == mlow {
					return true
				}
			}
		}
	}
	return false
}

// ZipEntryMatch ZIP 内容特征条目：检测 ZIP 内是否存在命中条目名
type ZipEntryMatch struct {
	Name  string `json:"name"`  // 条目名（小写比较）
	Match string `json:"match"` // "exact" / "prefix" / "suffix"
}

// MatchZipEntry 检测 ZIP 条目名是否命中本类型的特征条目（小写不敏感）
// ADR-082 S1：任意层级段后缀匹配——对路径按 / 分段，每个段后缀都参与指纹匹配，
// 解决「zip 套一层目录」（MyPack/pack.mcmeta 命中 pack.mcmeta exact）。
// suffix 幂等（原 HasSuffix 已覆盖任意层级），exact/prefix 从「根目录限定」放宽为「任意层级」。
func (rt *ResourceType) MatchZipEntry(name string) bool {
	low := strings.ToLower(name)
	// 段后缀：a/b/c → [a/b/c, b/c, c]（zip 条目名标准为 /，反斜杠归一）
	segs := strings.Split(strings.ReplaceAll(low, "\\", "/"), "/")
	for i := range segs {
		seg := strings.Join(segs[i:], "/")
		for _, m := range rt.ZipEntries {
			mlow := strings.ToLower(m.Name)
			switch m.Match {
			case "prefix":
				if strings.HasPrefix(seg, mlow) {
					return true
				}
			case "suffix":
				if strings.HasSuffix(seg, mlow) {
					return true
				}
			default: // "exact"
				if seg == mlow {
					return true
				}
			}
		}
	}
	return false
}

var (
	registryMu   sync.Mutex
	registry     *ResourceTypeRegistry
	registryPath = "resource_types.json" // 可被 tests 替换
)

// SetRegistryPath 设置注册表文件路径（仅测试用）
// 加锁保护：并发调用 LoadRegistry + SetRegistryPath 触发数据竞争（审计 P1 #2）。
func SetRegistryPath(path string) {
	registryMu.Lock()
	defer registryMu.Unlock()
	registryPath = path
	registry = nil
}

// LoadRegistry 加载资源类型注册表（单一事实来源 = 编译期嵌入的 resource_types.json）。
// 仅当 SetRegistryPath 显式指定外部绝对路径时才读取外部文件（测试/显式覆盖）；
// 默认回退到编译时嵌入数据，不再扫描 exe 旁目录，杜绝旧快照遮蔽导致的漂移。
// 加锁替代 sync.Once：避免 SetRegistryPath 重置 once 与 Do 之间的竞争。
func LoadRegistry() *ResourceTypeRegistry {
	registryMu.Lock()
	defer registryMu.Unlock()
	if registry != nil {
		return registry
	}
	data := loadRegistryBytes()
	var reg ResourceTypeRegistry
	if err := json.Unmarshal(data, &reg); err != nil {
		// 解析失败回退嵌入基线而不是缓存空注册表——
		// 原实现 `registry = &ResourceTypeRegistry{}` 会让空注册表
		// 在进程生命周期内永久缓存（无重试、不回退），所有扩展名查询静默失效
		log.Printf("[types] 解析注册表失败，回退嵌入基线: %v", err)
		// 回退解码必须用全新零值变量——
		// encoding/json 对字段类型错误是「跳过该字段继续解码」，失败后 reg 可能已部分填充，
		// 复用 reg 解码基线会得到「基线 + 损坏文件残留字段」的混合注册表
		// （baseline 缺 configFallback 等字段时残留值存活），违反「回退=干净基线」契约
		var baseline ResourceTypeRegistry
		if err := json.Unmarshal(bundledRegistryJSON, &baseline); err != nil {
			// 嵌入基线本身损坏（生成文件被破坏）时仍不 panic，但标记空表避免二次解析
			log.Printf("[types] 嵌入基线解析也失败: %v", err)
			registry = &ResourceTypeRegistry{}
			return registry
		}
		reg = baseline
	}
	// BUG-1/4 修复：外部文件合法但语义为空（`resourceTypes: []` 或 `null`）→
	// 视为与解析失败同等级，回退嵌入基线。
	// 否则 IsSupportedExt / StorageSubDir 等下游全线静默失效，用户只能重启进程。
	if len(reg.ResourceTypes) == 0 {
		log.Printf("[types] 外部注册表为空（%d 条目），回退嵌入基线", len(reg.ResourceTypes))
		var baseline ResourceTypeRegistry
		if err := json.Unmarshal(bundledRegistryJSON, &baseline); err != nil {
			registry = &ResourceTypeRegistry{}
			return registry
		}
		reg = baseline
	}
	// BUG-3 修复：重复 id 去重，保留最后一次出现的条目（last-wins），
	// 避免 RegistryType 与 ExtBelongsTo 对同一 id 语义不一致（前者 first-wins、后者 all-wins）。
	if len(reg.ResourceTypes) > 1 {
		seen := make(map[string]int, len(reg.ResourceTypes))
		deduped := make([]ResourceType, 0, len(reg.ResourceTypes))
		dupCount := 0
		for i, rt := range reg.ResourceTypes {
			if j, ok := seen[rt.ID]; ok {
				deduped[j] = rt
				dupCount++
			} else {
				seen[rt.ID] = i
				deduped = append(deduped, rt)
			}
		}
		if dupCount > 0 {
			log.Printf("[types] 注册表含 %d 个重复 id，已去重（保留最后出现条目）", dupCount)
			reg.ResourceTypes = deduped
		}
	}
	registry = &reg
	return registry
}

// loadRegistryBytes 解析注册表字节，单一事实来源为编译期嵌入：
//  1. 显式路径（SetRegistryPath 设置的测试/自定义绝对路径，仅测试与显式覆盖使用）；
//  2. 编译期嵌入的单源字节 bundledRegistryJSON（由根包 main 经 embed.go 注入，等同仓库根 resource_types.json）。
//  3. 测试/未注入场景回退：仓库根 resource_types.json（go/types 包目录的 ../../resource_types.json）。
//
// 注意：不再扫描 exe 同级/上级目录寻找 resource_types.json。
// 旧部署模型（zip 附带数据 JSON、updater 覆盖 exe 旁文件）已于 2026-08 废弃
// （见 internal/app/bundled_data.go：纯 exe 发布），
// 残留的 exe 旁快照会静默遮蔽嵌入单源，导致「改了 root JSON 却不生效」
// （本轮用户主推 6 次分类改动失败的根因）。嵌入单源即权威，杜绝漂移。
func loadRegistryBytes() []byte {
	if registryPath != "" && registryPath != "resource_types.json" {
		if b, err := os.ReadFile(registryPath); err == nil {
			return b
		}
	}
	if len(bundledRegistryJSON) > 0 {
		return bundledRegistryJSON
	}
	// 测试/未注入场景：从 go/types 包目录回退读取仓库根 resource_types.json
	if b, err := os.ReadFile(filepath.Join("..", "..", "resource_types.json")); err == nil {
		return b
	}
	return bundledRegistryJSON
}

// BundledRegistryJSON 返回编译期内嵌的资源类型注册表原始 JSON 字节（单一事实来源）。
// internal/app 复用同一 embed（LoadResourceTypes / DetectResourceType / 同步状态），
// 避免双嵌与副本漂移。
func BundledRegistryJSON() []byte {
	return bundledRegistryJSON
}

// RegistryType 按 id 查找资源类型，不存在时返回 nil
// 返回深拷贝：结构体按值拷贝仅能防标量字段篡改，Extensions 切片仍共享缓存
// 底层数组——调用方修改 rt.Extensions 会污染进程级注册表缓存，因此必须深拷贝切片。
func RegistryType(id string) *ResourceType {
	reg := LoadRegistry()
	for i := range reg.ResourceTypes {
		if reg.ResourceTypes[i].ID == id {
			rt := reg.ResourceTypes[i] // 拷贝，防外部篡改进程级缓存
			rt.Extensions = append([]string(nil), rt.Extensions...)
			rt.InstallExts = append([]string(nil), rt.InstallExts...)
			rt.ZipEntries = append([]ZipEntryMatch(nil), rt.ZipEntries...)
			return &rt
		}
	}
	return nil
}

// FormatRange 资源包 supported_formats 范围（可为 int 或 [int,int]）
type FormatRange struct {
	Min int
	Max int
}

// UnmarshalJSON 实现 json.Unmarshaler，支持 int / [int] / [int,int] 三种格式
func (fr *FormatRange) UnmarshalJSON(b []byte) error {
	// 尝试单 int
	var single int
	if json.Unmarshal(b, &single) == nil {
		fr.Min = single
		fr.Max = single
		return nil
	}
	// 尝试 int 数组（长度 1 或 2）: [min, max] 或 [min]
	var arr []int
	if err := json.Unmarshal(b, &arr); err == nil {
		if len(arr) == 1 {
			fr.Min = arr[0]
			fr.Max = arr[0]
		} else if len(arr) >= 2 {
			fr.Min = arr[0]
			fr.Max = arr[1]
		} else {
			return fmt.Errorf("FormatRange: 数组长度不足")
		}
		return nil
	}
	// 尝试对象格式: {"min_inclusive": N, "max_inclusive": M}
	var obj struct {
		MinInclusive int `json:"min_inclusive"`
		MaxInclusive int `json:"max_inclusive"`
	}
	if err := json.Unmarshal(b, &obj); err != nil {
		return fmt.Errorf("FormatRange: 期望 int / 数组 / 对象: %w", err)
	}
	fr.Min = obj.MinInclusive
	fr.Max = obj.MaxInclusive
	return nil
}

// descString 从 json.RawMessage 提取可读的描述文本
func descString(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	// 字符串：直接返回去掉引号
	if raw[0] == '"' {
		var s string
		if json.Unmarshal(raw, &s) == nil {
			return s
		}
		return ""
	}
	// JSON text component 对象 → 取 text 字段
	if raw[0] == '{' {
		var obj struct {
			Text string `json:"text"`
		}
		if json.Unmarshal(raw, &obj) == nil && obj.Text != "" {
			return obj.Text
		}
		return ""
	}
	// JSON text component 数组 → 拼接所有 text 字段
	if raw[0] == '[' {
		var arr []struct {
			Text  string `json:"text"`
			Extra []struct {
				Text string `json:"text"`
			} `json:"extra"`
		}
		if json.Unmarshal(raw, &arr) == nil {
			var out string
			for _, c := range arr {
				if c.Text != "" {
					out += c.Text
				}
				for _, e := range c.Extra {
					if e.Text != "" {
						out += e.Text
					}
				}
			}
			return out
		}
	}
	return ""
}

// PackMeta 资源包信息（来自 pack.mcmeta）
type PackMeta struct {
	Pack struct {
		PackFormat       int             `json:"pack_format"`
		Description      json.RawMessage `json:"description"`
		SupportedFormats *FormatRange    `json:"supported_formats,omitempty"`
		MinFormat        *FormatRange    `json:"min_format,omitempty"`
		MaxFormat        *FormatRange    `json:"max_format,omitempty"`
	} `json:"pack"`
}

// Desc 返回 description 的可读文本（处理 string / JSON text component 对象 / 数组）
func (pm *PackMeta) Desc() string {
	return descString(pm.Pack.Description)
}

// ===== Litematica 投影文件类型 =====

// LitematicMeta 投影文件元数据（对应 .litematic 中 Metadata compound）
type LitematicMeta struct {
	Name                 string               `json:"name"`
	Author               string               `json:"author"`
	Description          string               `json:"description"`
	TimeCreated          int64                `json:"timeCreated"`          // unix 毫秒
	TimeModified         int64                `json:"timeModified"`         // unix 毫秒
	MinecraftDataVersion int                  `json:"minecraftDataVersion"` // MC 数据版本号
	Version              int                  `json:"version"`              // Litematica 格式版本
	TotalBlocks          int                  `json:"totalBlocks"`          // 非空气方块总数
	TotalVolume          int                  `json:"totalVolume"`          // 包围盒总体积（含空气）
	EnclosingSize        [3]int               `json:"enclosingSize"`        // [x, y, z]
	RegionCount          int                  `json:"regionCount"`
	BlockStats           []LitematicBlockStat `json:"blockStats"`   // 按数量降序排列
	PreviewImage         string               `json:"previewImage"` // "data:image/png;base64,..." 或 ""
}

// LitematicBlockStat 方块类型统计
type LitematicBlockStat struct {
	Name  string `json:"name"` // "minecraft:stone"
	Count int    `json:"count"`
}

// LitematicVoxelData 体素渲染数据
type LitematicVoxelData struct {
	Size      [3]int       `json:"size"`      // 包围盒尺寸 [x, y, z]
	Groups    []VoxelGroup `json:"groups"`    // 按颜色分组的方块
	Truncated bool         `json:"truncated"` // 超过上限被截断
	MaxBlocks int          `json:"maxBlocks"` // 生效的渲染上限
}

// VoxelGroup 同一颜色的方块组
type VoxelGroup struct {
	Color     string     `json:"color"`     // 十六进制颜色 "#7F7F7F"
	Positions [][3]int16 `json:"positions"` // [[x,y,z], ...]
}
