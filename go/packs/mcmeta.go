package packs

import (
	"archive/zip"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/container"
	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/types"
)

// 资源包文件大小上限
const (
	maxMcmetaSize = 1 << 20  // pack.mcmeta 1MB（合法文件通常 < 1KB）
	maxPackPng    = 10 << 20 // pack.png 10MB
	maxLangSize   = 1 << 20  // lang 文件 1MB（合法文件通常 < 10KB）
)

// sentinel 错误——调用方用 errors.Is 判断，禁止 strings.Contains(err.Error()) 文本匹配
var (
	// ErrPackMetaNotFound 资源包内没有 pack.mcmeta
	ErrPackMetaNotFound = errors.New("未找到 pack.mcmeta")
	// ErrPackMetaTooLarge pack.mcmeta 超过 1MB 上限
	ErrPackMetaTooLarge = errors.New("pack.mcmeta 超过 1MB 上限")
)

// ReadPackMeta 从资源包文件（.zip 或目录）中读取 pack.mcmeta，返回名称和 base64 缩略图
func ReadPackMeta(path string) (*types.PackMeta, string, error) {
	var data []byte
	var packPng []byte
	var metaTooLarge bool // zip 分支超限 pack.mcmeta 标记（与 dir 分支一致报 ErrPackMetaTooLarge）

	info, err := os.Stat(path)
	if err != nil {
		return nil, "", fmt.Errorf("stat 资源包 %s: %w", path, err)
	}

	if info.IsDir() {
		// 目录格式资源包
		metaPath := filepath.Join(path, "pack.mcmeta")
		// FIFO/设备文件 os.Open 会阻塞挂起——Stat 预检强制常规文件
		if st, err := os.Stat(metaPath); err == nil && st.Mode().IsRegular() {
			if meta, err := os.Open(metaPath); err == nil {
				// 限制 pack.mcmeta 大小（1MB，合法文件通常 < 1KB），防畸形大文件读入内存
				// +1 探测截断（ADR-033）——原 io.ReadAll(io.LimitReader)
				// 恰 1MB 被截断后静默继续，与 pack.png/lang 的 LimitReader+1 口径不一致
				// （对齐 lang 分支 mcmeta.go:235 的写法：Open + LimitReader + 长度判断）
				data, _ = io.ReadAll(io.LimitReader(meta, maxMcmetaSize+1))
				meta.Close()
				if len(data) > maxMcmetaSize {
					return nil, "", fmt.Errorf("%w（实际 %d 字节）", ErrPackMetaTooLarge, len(data))
				}
			}
		}
		pngPath := filepath.Join(path, "pack.png")
		// 目录形态 pack.png 与 ZIP 分支对齐 10MB 上限（stat 预检防超大图整读内存）
		// FIFO/设备文件 Stat size==0 会放行后 os.ReadFile 阻塞挂起——
		// 与 lang 分支同款坑（mcmeta.go:235 已专门处理），此处同样改为 Open+LimitReader+1
		if st, err := os.Stat(pngPath); err == nil && st.Size() <= maxPackPng && st.Mode().IsRegular() {
			if png, err := os.Open(pngPath); err == nil {
				packPng, _ = io.ReadAll(io.LimitReader(png, maxPackPng+1))
				png.Close()
				if len(packPng) > maxPackPng {
					packPng = nil // 超限视为无效，缩略图可选
				}
			}
		}
	} else if strings.HasSuffix(strings.ToLower(path), ".zip") {
		// ZIP 格式资源包
		r, err := zip.OpenReader(path)
		if err != nil {
			return nil, "", fmt.Errorf("打开资源包 %s: %w", path, err)
		}
		defer r.Close()
		for _, f := range r.File {
			low := strings.ToLower(f.Name)
			if low == "pack.mcmeta" {
				rc, err := f.Open()
				if err != nil {
					continue
				}
				// 限制 pack.mcmeta 大小（1MB），与 pack.png 的 LimitReader 保护对齐
				// +1 截断探测（ADR-033）——恰 1MB 被截断后静默继续
				readData, readErr := io.ReadAll(io.LimitReader(rc, maxMcmetaSize+1))
				rc.Close()
				if readErr == nil && len(readData) <= maxMcmetaSize {
					data = readData
				} else if readErr == nil {
					metaTooLarge = true // 超限（截断探测到 >1MB），文件存在但不可用
				}
			}
			if low == "pack.png" {
				rc, err := f.Open()
				if err != nil {
					continue
				}
				// limit+1 探测截断（ADR-033 陷阱）——超 10MB 的 pack.png 被截断后
				// readErr==nil，损坏 PNG 会被 base64 包装展示。超限时置空跳过
				readData, readErr := io.ReadAll(io.LimitReader(rc, maxPackPng+1))
				rc.Close()
				if readErr == nil && len(readData) <= maxPackPng {
					packPng = readData
				}
			}
		}
	}

	if metaTooLarge && len(data) == 0 {
		return nil, "", fmt.Errorf("%w（zip 内 pack.mcmeta 超过 1MB）", ErrPackMetaTooLarge)
	}
	if len(data) == 0 {
		return nil, "", ErrPackMetaNotFound
	}

	var meta types.PackMeta
	// 去除 UTF-8 BOM（PowerShell 写入的 JSON 可能带 EF BB BF 前缀）
	data = fsutil.StripBOM(data)
	if err := json.Unmarshal(data, &meta); err != nil {
		return nil, "", fmt.Errorf("pack.mcmeta 解析失败: %w", err)
	}

	// base64 缩略图
	var thumb string
	if len(packPng) > 0 {
		thumb = "data:image/png;base64," + base64.StdEncoding.EncodeToString(packPng)
	}

	return &meta, thumb, nil
}

// DetectResourceType 检测文件属于哪种资源类型
// Phase 1（路径消歧）：检查文件父目录是否匹配某类型的 InstanceDir，
// 解决 MMD 子类型共享扩展名（EntityPlayer/SceneModel 都 .pmx）的歧义。
// Phase 2（扩展名兜底）：按现有逻辑遍历，路径消歧未命中时使用。
// 禁用后缀文件（.disabled/.ban）：扩展名推导前剥离后缀（c08c62bc P3 回归——
// 否则 ToggleEnable 改名后的 xxx.zip.disabled 判不出容器类型，跨 tab 泄漏；
// 打开文件仍用真实路径，剥离只影响扩展名判定）。
func DetectResourceType(path string, registry *types.ResourceTypeRegistry) string {
	if registry == nil || len(registry.ResourceTypes) == 0 {
		return ""
	}
	ext := strings.ToLower(filepath.Ext(types.StripDisableSuffix(path)))
	isContainer := types.IsContainerExt(ext)

	// Phase 1：路径消歧——当类型共享扩展名时，用 InstanceDir 区分
	if id := detectByPathDisambiguation(path, ext, isContainer, registry); id != "" {
		return id
	}

	// Phase 2：扩展名兜底——指纹 pass/fail 竞争，通过者按 Priority 裁决
	// （专用指纹类型 > 通用指纹类型），同 Priority 取注册表顺序在前者。
	// 容器只打开一次：所有容器指纹类型共享同一份条目列表（发现3 P3），
	// 跨类型不比较匹配条目数——模式宽窄不可比（shaderpack 的 shaders/ 前缀可匹配
	// 多条目，resourcepack 的 pack.mcmeta 至多 1 条，比数会把资源包误判为光影包，发现1 P2）。
	var bestID string
	bestPriority := 0
	var containerEntries []container.Entry
	var containerOpened bool
	for _, rt := range registry.ResourceTypes {
		if !hasExt(ext, rt.EffectiveExtensions()) {
			continue
		}
		pass := false
		if isContainer && (rt.Detector == "ysm" || rt.Detector == "zipentry" || rt.Detector == "mcmeta" || rt.Detector == "shader") {
			// 容器指纹类型共享一次打开：ysm 走段后缀指纹，其余走 ZipEntries 匹配
			if !containerOpened {
				containerOpened = true
				if r, err := container.Open(path); err == nil {
					containerEntries = r.Entries()
					r.Close()
				}
			}
			if rt.Detector == "ysm" {
				pass = matchYsmEntries(containerEntries)
			} else {
				pass = countZipEntryMatches(containerEntries, &rt) > 0
			}
		} else if detectorPasses(path, ext, isContainer, &rt) {
			pass = true
		}
		if !pass {
			continue
		}
		if bestID == "" || rt.Priority > bestPriority {
			bestID = rt.ID
			bestPriority = rt.Priority
		}
	}
	return bestID
}

// detectByPathDisambiguation 路径消歧：遍历文件所有祖先目录（深→浅），检查是否匹配某类型的
// InstanceDir/StorageSubDir。祖先目录外层优先——最深匹配的子类型（如 DefaultMorph）无论注册表
// 顺序如何都能打赢外层父类型（如 EntityPlayer）。仅在扩展名也匹配时才返回——确保路径消歧
// 不会跨组误判（如 .pmx 只在 MMD 组内消歧）。
func detectByPathDisambiguation(path string, ext string, isContainer bool, registry *types.ResourceTypeRegistry) string {
	dir := filepath.Dir(path)
	if dir == "." {
		return ""
	}

	// 收集所有祖先目录（深→浅，与 TypeByLocation 对齐）
	// Windows 盘符根（如 "D:"）filepath.Dir 返回自身，需显式终止
	var ancestors []string
	d := dir
	for d != "." && d != string(filepath.Separator) {
		ancestors = append(ancestors, d)
		parent := filepath.Dir(d)
		if parent == d {
			break
		}
		d = parent
	}

	// 预过滤：只保留有候选目录且扩展名匹配的类型（避免对每个祖先重复检查）
	type disambCandidate struct {
		rt         *types.ResourceType
		candidates []string // 非空的 InstanceDir/StorageSubDir
	}
	var filtered []disambCandidate
	for i := range registry.ResourceTypes {
		rt := &registry.ResourceTypes[i]
		cands := make([]string, 0, 2)
		if rt.InstanceDir != "" {
			cands = append(cands, rt.InstanceDir)
		}
		if rt.StorageSubDir != "" {
			cands = append(cands, rt.StorageSubDir)
		}
		if len(cands) == 0 {
			continue
		}
		if !hasExt(ext, rt.EffectiveExtensions()) {
			continue
		}
		filtered = append(filtered, disambCandidate{rt: rt, candidates: cands})
	}
	if len(filtered) == 0 {
		return ""
	}

	// 深度优先：外层遍历祖先（深→浅），内层遍历类型
	// 最深匹配的祖先无论类型注册顺序如何都优先命中——修复 mmd/PMX/DefaultMorph/x.zip
	// 被外层 EntityPlayer 抢走的子类型化场景（2026-08-23 修复）
	for _, anc := range ancestors {
		ancNorm := filepath.ToSlash(strings.ToLower(anc))
		for _, dc := range filtered {
			for _, c := range dc.candidates {
				cNorm := filepath.ToSlash(strings.ToLower(c))
				if strings.HasSuffix(ancNorm, "/"+cNorm) || ancNorm == cNorm {
					if detectorPasses(path, ext, isContainer, dc.rt) {
						return dc.rt.ID
					}
				}
			}
		}
	}
	return ""
}

// detectorPasses 检查文件是否通过指定类型的 detector 判定（抽公共逻辑供两条路径复用）
func detectorPasses(path string, ext string, isContainer bool, rt *types.ResourceType) bool {
	switch strings.ToLower(rt.Detector) {
	case "ysm":
		return isYsmFile(path)
	case "mcmeta", "shader":
		return isContainer && matchZipArchive(path, rt)
	case "zipentry":
		if isContainer {
			return matchZipArchive(path, rt)
		}
		return hasExt(ext, rt.EffectiveExtensions())
	case "", "extension":
		return hasExt(ext, rt.EffectiveExtensions())
	default:
		return hasExt(ext, rt.EffectiveExtensions())
	}
}

// matchZipArchive 打开容器（.zip/.7z）并按 rt.ZipEntries 内容指纹匹配（ADR-067/068）：
// 走 container 统一打开——.7z 也参与内容指纹（ADR-067 §3 遗留，原仅 zip；
// sevenzip 只读但可枚举条目）。条目名统一 lowercase（与 MatchZipEntry 内部 ToLower 幂等）。
func matchZipArchive(path string, rt *types.ResourceType) bool {
	return matchZipArchiveCount(path, rt) > 0
}

// matchZipArchiveCount 打开容器并返回匹配的条目数（供 matchZipArchive 使用；
// Phase 2 多类型竞争请用 countZipEntryMatches 共享一次打开）
func matchZipArchiveCount(path string, rt *types.ResourceType) int {
	r, err := container.Open(path)
	if err != nil {
		return 0
	}
	defer r.Close()
	return countZipEntryMatches(r.Entries(), rt)
}

// countZipEntryMatches 对已打开的条目列表统计匹配数（去重：同一文件被多条规则
// 命中只计一次；Phase 2 所有容器类型共享一次打开后逐类型计数）
func countZipEntryMatches(entries []container.Entry, rt *types.ResourceType) int {
	count := 0
	matchedEntries := make(map[string]bool)
	for _, e := range entries {
		entryName := e.Name()
		if rt.MatchZipEntry(entryName) {
			if !matchedEntries[entryName] {
				matchedEntries[entryName] = true
				count++
			}
		}
	}
	return count
}

// matchYsmEntries 对已打开的条目列表做 ysm 指纹判定（ysm.json / models/ 任意层级段后缀），
// 与 isYsmFile 的容器分支同口径（ADR-082 S1）；Phase 2 共享一次打开后复用
func matchYsmEntries(entries []container.Entry) bool {
	for _, e := range entries {
		segs := strings.Split(filepath.ToSlash(strings.ToLower(e.Name())), "/")
		for i := range segs {
			seg := strings.Join(segs[i:], "/")
			if seg == "ysm.json" || strings.HasPrefix(seg, "models/") {
				return true
			}
		}
	}
	return false
}

func hasExt(ext string, exts []string) bool {
	for _, e := range exts {
		// 注册表扩展名大小写归一（与 types.IsSupportedExt 口径一致）
		if ext == strings.ToLower(e) {
			return true
		}
	}
	return false
}

// isYsmFile 检查文件是否为 YSM 模型
// .ysm → 直接返回 true；.json → 仅 ysm.json 入口清单算模型（scanner 同口径，动画/动作 json 不算）；
// .zip/.7z → 统一走 container 打开 + ysm.json/models/ 任意层级指纹（ADR-082 续：
// 不再对 .7z 扩展名直判——坏容器打开失败即 false，识别不出就是识别不出）
func isYsmFile(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	if ext == ".ysm" {
		return true
	}
	if ext == ".json" {
		// 注册表声明 .json 为 YSM 扩展，但只有 ysm.json 算独立模型文件
		return strings.EqualFold(filepath.Base(path), "ysm.json")
	}
	if !types.IsContainerExt(ext) {
		return false
	}
	// .zip/.7z 统一走 container（ADR-068）：任意层级段后缀匹配（ADR-082 S1 与
	// types.MatchZipEntry 同构）——ys m.json / models/ 命中任意层级；坏容器返回 false
	r, err := container.Open(path)
	if err != nil {
		return false
	}
	defer r.Close()
	return matchYsmEntries(r.Entries())
}

// ReadShaderpackLang 从光影包 ZIP 中读取 lang/en_US.lang，尝试提取显示名
// 返回 {name, entries}，name 为空时前端用文件名兜底
func ReadShaderpackLang(path string) string {
	result := map[string]interface{}{
		"name":    "",
		"entries": map[string]string{},
	}

	info, err := os.Stat(path)
	if err != nil {
		return marshalShaderpackResult(result)
	}

	var langData []byte
	if info.IsDir() {
		// 已解压的目录格式
		langPath := filepath.Join(path, "lang", "en_US.lang")
		// dir 分支与 zip 分支同用「Open + LimitReader + 截断探测」——
		// 原 os.Stat 预检 + os.ReadFile 是 check-then-act TOCTOU：并发修改时 ReadFile 整读
		// 当前文件绕过大小时限；FIFO/设备文件 Stat.Size()==0 通过预检后 ReadFile 阻塞或无限读。
		// LimitReader 的界在「实际读取」上生效，特殊文件也无法挂起读取。
		// FIFO/设备文件 os.Open 会阻塞挂起——Stat 预检强制常规文件
		if st, err := os.Stat(langPath); err == nil && st.Mode().IsRegular() {
			if lf, err := os.Open(langPath); err == nil {
				langData, _ = io.ReadAll(io.LimitReader(lf, maxLangSize+1))
				lf.Close()
				if len(langData) > maxLangSize {
					langData = nil // 超限视为无效，返回空 name（前端用文件名兜底）
				}
			}
		}
	} else if strings.HasSuffix(strings.ToLower(path), ".zip") {
		r, err := zip.OpenReader(path)
		if err != nil {
			return marshalShaderpackResult(result)
		}
		defer r.Close()
		for _, f := range r.File {
			low := strings.ToLower(f.Name)
			// 统一小写比较——原 `low == "lang/en_US.lang"` 永远不成立
			// （low 已 ToLower，不可能含大写 US），属死代码；
			// 与 ReadPackMeta 的 pack.mcmeta/pack.png 比较口径对齐
			if low == "lang/en_us.lang" {
				rc, err := f.Open()
				if err != nil {
					continue
				}
				// lang 文件设大小上限（limit+1 截断探测，对齐 ADR-033）——
				// 原 io.ReadAll 全量读入，畸形/超大 lang 可拖垮内存，与包内其余 LimitReader 防护不统一
				langData, _ = io.ReadAll(io.LimitReader(rc, maxLangSize+1))
				if len(langData) > maxLangSize {
					langData = nil // 超限视为无效，返回空 name（前端用文件名兜底）
				}
				rc.Close()
				break
			}
		}
	}

	if len(langData) == 0 {
		return marshalShaderpackResult(result)
	}

	// 解析 .lang 文件（key=value 格式）
	entries := make(map[string]string)
	var name string
	for _, line := range strings.Split(string(langData), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		eqIdx := strings.Index(line, "=")
		if eqIdx < 0 {
			continue
		}
		key := strings.TrimSpace(line[:eqIdx])
		val := strings.TrimSpace(line[eqIdx+1:])
		if key == "" || val == "" {
			continue
		}
		entries[key] = val
		// 常见的显示名 key（精确匹配，避免误匹配 pack.namespace / subtitle 等；
		// 裸 title 是合法 key，测试钉住）
		lowKey := strings.ToLower(key)
		switch {
		case lowKey == "pack.name" || lowKey == "shaderpack.name" || lowKey == "title" || strings.HasSuffix(lowKey, ".title"):
			if name == "" {
				name = val
			}
		}
	}

	result["name"] = name
	result["entries"] = entries
	return marshalShaderpackResult(result)
}

// marshalShaderpackResult 序列化光影包 lang 读取结果（规律六：不吞错）
// json.Marshal 对 map[string]interface{} 几乎不可能失败，但失败时仍返回
// 带 error 字段的合法 JSON，避免前端拿到空串 → JSON.parse("") 抛异常
func marshalShaderpackResult(result map[string]interface{}) string {
	data, err := json.Marshal(result)
	if err != nil {
		return fmt.Sprintf(`{"name":"","entries":{},"error":%q}`, err.Error())
	}
	return string(data)
}
