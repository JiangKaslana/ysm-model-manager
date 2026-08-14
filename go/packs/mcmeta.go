package packs

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

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
	data = bytes.TrimPrefix(data, []byte{0xEF, 0xBB, 0xBF})
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
func DetectResourceType(path string, registry *types.ResourceTypeRegistry) string {
	if registry == nil || len(registry.ResourceTypes) == 0 {
		return ""
	}
	ext := strings.ToLower(filepath.Ext(path))

	for _, rt := range registry.ResourceTypes {
		if !hasExt(ext, rt.Extensions) {
			continue
		}
		// detector 小写归一（外部 registry 可能写 "YSM"），防 #11 误分类
		switch strings.ToLower(rt.Detector) {
		case "ysm":
			if isYsmFile(path) {
				return rt.ID
			}
		case "mcmeta":
			if hasMcmeta(path) {
				return rt.ID
			}
		case "shader":
			if hasShaders(path) {
				return rt.ID
			}
		case "", "extension":
			return rt.ID
		default:
			// 未知 detector 值：按扩展名兜底（保持与旧行为一致，不把文件错误归入内容型）
			return rt.ID
		}
	}
	return ""
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
// .zip → 检查内部是否有 ysm.json 或 models/；
// .7z → zip.OpenReader 会失败，跳过内容检测直接返回 true（靠扩展名兜底）
func isYsmFile(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	if ext == ".ysm" {
		return true
	}
	if ext == ".json" {
		// 注册表声明 .json 为 YSM 扩展，但只有 ysm.json 算独立模型文件
		return strings.EqualFold(filepath.Base(path), "ysm.json")
	}
	if ext != ".zip" && ext != ".7z" {
		return false
	}
	// .7z 不是 ZIP 格式，无法用 zip.OpenReader 打开，但注册表已声明为 YSM 扩展名，直接放行
	if ext == ".7z" {
		return true
	}
	r, err := zip.OpenReader(path)
	if err != nil {
		return false
	}
	defer r.Close()
	for _, f := range r.File {
		low := strings.ToLower(f.Name)
		if strings.HasSuffix(low, "ysm.json") || strings.HasPrefix(low, "models/") {
			return true
		}
	}
	return false
}

// hasMcmeta 检查 zip 内是否有 pack.mcmeta（区分 ZIP 资源包/模型）
func hasMcmeta(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	if ext != ".zip" {
		return false
	}
	r, err := zip.OpenReader(path)
	if err != nil {
		return false
	}
	defer r.Close()
	for _, f := range r.File {
		if strings.ToLower(f.Name) == "pack.mcmeta" {
			return true
		}
	}
	return false
}

// hasShaders 检查 zip 内是否有 shaders/ 目录（光影包特征）
func hasShaders(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	if ext != ".zip" {
		return false
	}
	r, err := zip.OpenReader(path)
	if err != nil {
		return false
	}
	defer r.Close()
	for _, f := range r.File {
		low := strings.ToLower(f.Name)
		if strings.HasPrefix(low, "shaders/") || low == "shaders" {
			return true
		}
	}
	return false
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
		data, _ := json.Marshal(result)
		return string(data)
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
			data, _ := json.Marshal(result)
			return string(data)
		}
		defer r.Close()
		for _, f := range r.File {
			low := strings.ToLower(f.Name)
			if low == "lang/en_us.lang" || low == "lang/en_US.lang" {
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
		data, _ := json.Marshal(result)
		return string(data)
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
	data, _ := json.Marshal(result)
	return string(data)
}
