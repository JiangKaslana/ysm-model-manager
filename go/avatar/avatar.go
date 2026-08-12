// Package avatar 创作者头像提取与缓存，不依赖 Wails runtime。
package avatar

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strings"
	"time"

	"ysm-model-manager/go/fsutil"
)

// WASM 解码子进程超时上限
const decodeTimeout = 60 * time.Second

// CacheDir 返回头像缓存目录。
// 默认走 os.UserConfigDir()/YSM-Model-Manager/creators_cache（与 configDir() 桌面根同口径，ADR-046 P2）：
// avatar 包为叶包、不依赖 Wails runtime，无法复用 pathMgr，故直接取系统配置根。
// 平台配置根缺失时返回空串 fail-fast（与 configDir() 一致），不降级写 exe 旁或 CWD——
// exe 旁在安卓只读 APK 路径下会静默失败；NewApp() 运行期以 pathMgr 沙盒覆盖此默认值（app.go）。
// 外部可覆盖此函数（测试时可设置临时目录）。
var CacheDir = func() string {
	base, err := os.UserConfigDir()
	if err != nil || base == "" {
		return "" // 平台配置根不可用：no-op，不降级写 exe 旁/CWD
	}
	return filepath.Join(base, "YSM-Model-Manager", "creators_cache")
}

type authorEntry struct {
	Name   string `json:"name"`
	Role   string `json:"role,omitempty"`
	Avatar string `json:"avatar,omitempty"`
}

// SafeName 将非法文件名字符替换为下划线。
func SafeName(name string) string {
	r := strings.NewReplacer(
		"/", "_", "\\", "_", ":", "_", "*", "_",
		"?", "_", "\"", "_", "<", "_", ">", "_", "|", "_",
	)
	safe := r.Replace(name)
	// Windows 保留设备名（CON/PRN/AUX/NUL/COM1-9/LPT1-9）与尾部点/空格
	// 会导致缓存写失败（"CON.png" 被系统拒绝）；去尾后与保留名比对则加下划线前缀
	safe = strings.TrimRight(safe, " .")
	base := safe
	// 按 '.' 与 '_' 均分割——Windows 保留设备名
	// 无论带什么扩展名/后缀都被系统拒绝（CON.png / COM1.config / CON.Doe），
	// 原实现只按 '_' 分割导致点号变体逃逸
	if idx := strings.IndexAny(base, "._"); idx >= 0 {
		base = base[:idx]
	}
	switch strings.ToUpper(base) {
	case "CON", "PRN", "AUX", "NUL",
		"COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
		"LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9":
		return "_" + safe
	}
	return safe
}

// isSafeAvatarPath 强校验头像相对路径：
// Clean 规范化后必须位于 "avatar" 目录下（严格前缀），且不含 ".." 逃逸段。
// 原 HasPrefix("avatar") 弱校验放行 "avatar/../../x" 逃出模型目录，
// 且 "avatars/.."、"avatarx/.." 等非精确目录也会误放行。
// 接受裸文件名（"alice.png" → avatar/alice.png 归一化），
// 兼容 ysm.json 中不带 avatar/ 前缀的旧式声明——安全目标（拒绝 .. 逃逸）不牺牲兼容。
func isSafeAvatarPath(ap string) bool {
	// 先把反斜杠归一化为正斜杠再校验——原新增守卫
	// `strings.Contains(ap, "\\") → return false` 会把 Windows 上合法的 `avatar\alice.png`
	// 分隔写法也拒绝（filepath.Join 在 Windows 上解析到 avatar/ 内，改动前正常工作）；
	// 归一化后合法反斜杠路径放行，逃逸形态 `avatar\..\x` 折叠为 `avatar/../x` 被既有
	// `..` 段检查拒绝（顺带封住 Windows 反斜杠逃逸）
	ap = strings.ReplaceAll(ap, "\\", "/")
	clean := path.Clean(strings.ToLower(strings.TrimSpace(ap)))
	if clean == "avatar" {
		return true
	}
	if !strings.HasPrefix(clean, "avatar/") {
		// 裸文件名：归一化为 avatar/ 前缀再校验（旧式 ysm.json 声明兼容）。
		// 仅当原始串不含 `/`（确为纯文件名）时才归一化——原实现对任意
		// 非 avatar/ 前缀路径归一化，`avatar/../x` 先被 path.Clean 折叠为 `x`
		// 再归一化为 `avatar/x` 放行，而调用方 filepath.Join(dir, 原始路径)
		// 实际读到 avatar/ 之外、模型目录内的任意文件（违反「严格 avatar/ 前缀」）
		if strings.Contains(ap, "/") {
			return false
		}
		clean = path.Clean("avatar/" + clean)
	}
	// 拒绝任何 ".." 段（Clean 后仍含则说明原路径有逃逸意图）
	for _, seg := range strings.Split(clean, "/") {
		if seg == ".." {
			return false
		}
	}
	return strings.HasPrefix(clean, "avatar/")
}

// avatarCandidates 由 ysm.json 的 avatar 引用生成候选路径列表，用于在前端 WASM 解码产物
// 或 ZIP 内定位真实头像文件。兼容裸文件名（"sdf"）与带 avatar/ 前缀/扩展名的形式
// （"avatar/sdf.png"），覆盖 ysm.json 旧式声明——与 .json 分支 isSafeAvatarPath 口径一致。
func avatarCandidates(ref string) []string {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return nil
	}
	low := strings.ToLower(ref)
	base := filepath.Base(ref)
	ext := strings.ToLower(filepath.Ext(base))
	stem := base
	if ext != "" {
		stem = strings.TrimSuffix(base, ext)
	}
	cands := []string{ref}
	// 裸文件名（无 avatar/ 前缀）→ 补前缀
	if !strings.HasPrefix(low, "avatar/") && !strings.HasPrefix(low, "avatar\\") {
		cands = append(cands, "avatar/"+ref)
	}
	// 补充标准扩展名变体（避免裸 "sdf" 找不到实际 "sdf.png"）
	for _, e := range []string{".png", ".jpg", ".jpeg"} {
		cands = append(cands, "avatar/"+stem+e)
		if !strings.HasPrefix(low, "avatar/") && !strings.HasPrefix(low, "avatar\\") {
			cands = append(cands, stem+e)
		}
	}
	return cands
}

// ReadCachedAvatar 读取缓存中的头像，返回 data URI。
// 缓存未命中时返回 ("", nil)，IO 错误时返回 ("", err)。
func ReadCachedAvatar(authorName string) (string, error) {
	if CacheDir() == "" {
		return "", nil // 平台数据根缺失：no-op（不降级为 CWD 读）
	}
	safe := SafeName(authorName)
	cachedPath := filepath.Join(CacheDir(), safe+".png")
	// 缓存读取套上限（头像数据通常 < 1MB）——防损坏/超大
	// 缓存文件整读内存膨胀（与模型读取同口径）
	data, err := readLimitedAvatar(cachedPath)
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil // 缓存未命中，非错误
		}
		return "", err // IO 错误（权限/磁盘故障等）
	}
	// 按文件头嗅探 mime——原硬编码 `data:image/png`，JPEG 头像以 .png 落盘
	// （SaveAvatarData 恒用 safeName+".png"）读回时 MIME 错误（前端 <img> 仍可显示，
	// 但导出/复制 data URI 给其他工具时 type 不匹配）
	mime := "image/png"
	if len(data) >= 3 && data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF {
		mime = "image/jpeg"
	}
	return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data), nil
}

// SaveAvatarData 将头像数据写入缓存。
func SaveAvatarData(safeName string, data []byte, mime string) string {
	dir := CacheDir()
	if dir == "" {
		// 平台数据根缺失：不写磁盘（no-op），仍返回 data URI（即时显示依赖内存）
		return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data)
	}
	if err := os.MkdirAll(dir, 0755); err != nil {
		log.Printf("[avatar] 缓存目录创建失败: %v", err)
	}
	// 缓存写收敛 fsutil.WriteFileAtomic（CreateTemp + rename
	// 原子替换）——原 os.WriteFile 并发 SaveAvatarData 同作者时互相截断写坏（半写文件
	// 落盘，下次 ReadCachedAvatar 读到损坏 PNG）；失败不返回错误（有 log，仍返回
	// data URI 即时显示，属有意降级）
	if err := fsutil.WriteFileAtomic(filepath.Join(dir, safeName+".png"), data); err != nil {
		log.Printf("[avatar] 缓存写入失败: %v", err)
	}
	return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data)
}

// ExtractAvatarURI 从模型文件中提取指定所有者的头像 data URI。
// modelPath 支持 .ysm / .zip / .7z / .json（解压目录）。
func ExtractAvatarURI(modelPath, safeName string) string {
	ext := strings.ToLower(filepath.Ext(modelPath))
	var authors []authorEntry

	switch ext {
	case ".ysm":
		ysmData, err := readLimitedModel(modelPath)
		if err != nil {
			// 缓存 miss 静默，但真 IO 错误（权限/磁盘）补日志便于排障
			if !os.IsNotExist(err) {
				log.Printf("[avatar] 读取 .ysm 模型失败 %s: %v", modelPath, err)
			}
			return ""
		}
		files := DecodeYSMFiles(ysmData)
		if len(files) == 0 {
			return ""
		}
		// 找 ysm.json
		for _, f := range files {
			if strings.HasSuffix(strings.ToLower(f.Path), "ysm.json") {
				data := toBytes(f.Data)
				var root struct {
					Meta struct {
						Authors []authorEntry `json:"authors"`
					} `json:"metadata"`
				}
				if json.Unmarshal(data, &root) == nil {
					authors = root.Meta.Authors
				}
				break
			}
		}
		if len(authors) == 0 {
			// 降级：取 avatar/ 目录第一张
			for _, f := range files {
				low := strings.ToLower(f.Path)
				if !strings.HasSuffix(low, ".png") && !strings.HasSuffix(low, ".jpg") {
					continue
				}
				if !strings.HasPrefix(low, "avatar/") && !strings.Contains(low, "/avatar/") {
					continue
				}
				mime := "image/png"
				if strings.HasSuffix(low, ".jpg") {
					mime = "image/jpeg"
				}
				return SaveAvatarData(safeName, toBytes(f.Data), mime)
			}
		}
		// 按作者名匹配（avatar 引用兼容裸文件名，与 .json 分支口径一致）
		for _, f := range files {
			for _, au := range authors {
				if SafeName(au.Name) == safeName && au.Avatar != "" {
					ap := strings.ToLower(au.Avatar)
					if !isSafeAvatarPath(ap) {
						continue
					}
					fp := strings.ToLower(f.Path)
					matched := false
					for _, c := range avatarCandidates(ap) {
						if fp == c || strings.HasSuffix(fp, "/"+c) || strings.HasSuffix(fp, "\\"+c) {
							matched = true
							break
						}
					}
					if matched {
						mime := "image/png"
						if strings.HasSuffix(fp, ".jpg") || strings.HasSuffix(fp, ".jpeg") {
							mime = "image/jpeg"
						}
						return SaveAvatarData(safeName, toBytes(f.Data), mime)
					}
				}
			}
		}

	case ".zip":
		data, err := readLimitedModel(modelPath)
		if err != nil {
			// 真 IO 错误补日志（IsNotExist 静默）
			if !os.IsNotExist(err) {
				log.Printf("[avatar] 读取 .zip 模型失败 %s: %v", modelPath, err)
			}
			return ""
		}
		zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
		if err != nil {
			log.Printf("[avatar] zip 解析失败 %s: %v", modelPath, err)
			return ""
		}
		ysmData := ReadFileFromZip(zr, "ysm.json")
		if ysmData != nil {
			var root struct {
				Meta struct {
					Authors []authorEntry `json:"authors"`
				} `json:"metadata"`
			}
			if json.Unmarshal(ysmData, &root) == nil {
				authors = root.Meta.Authors
			}
		}
		for _, au := range authors {
			if SafeName(au.Name) == safeName && au.Avatar != "" {
				ap := strings.ToLower(au.Avatar)
				if !isSafeAvatarPath(ap) {
					continue
				}
				for _, c := range avatarCandidates(ap) {
					if avatarData := ReadFileFromZip(zr, c); avatarData != nil {
						mime := "image/png"
						if strings.HasSuffix(strings.ToLower(c), ".jpg") || strings.HasSuffix(strings.ToLower(c), ".jpeg") {
							mime = "image/jpeg"
						}
						return SaveAvatarData(safeName, avatarData, mime)
					}
				}
			}
		}

	case ".json":
		data, err := readLimitedModel(modelPath)
		if err != nil {
			// 真 IO 错误补日志（IsNotExist 静默）
			if !os.IsNotExist(err) {
				log.Printf("[avatar] 读取 .json 模型失败 %s: %v", modelPath, err)
			}
			return ""
		}
		var root struct {
			Meta struct {
				Authors []authorEntry `json:"authors"`
			} `json:"metadata"`
		}
		if json.Unmarshal(data, &root) == nil {
			authors = root.Meta.Authors
		}
		dir := filepath.Dir(modelPath)
		for _, au := range authors {
			if SafeName(au.Name) == safeName && au.Avatar != "" {
				ap := strings.ToLower(au.Avatar)
				// 强校验（Clean + avatar/ 前缀 + 拒绝 ..），防 avatar/../../x 逃逸读任意文件
				if !isSafeAvatarPath(ap) {
					continue
				}
				avatarPath := filepath.Join(dir, au.Avatar)
				// 落盘前 Rel 复查：Join 后必须仍在模型目录内
				if rel, err := filepath.Rel(dir, avatarPath); err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
					continue
				}
				if avatarData, _ := readLimitedAvatar(avatarPath); avatarData != nil {
					mime := "image/png"
					if strings.HasSuffix(strings.ToLower(au.Avatar), ".jpg") {
						mime = "image/jpeg"
					}
					return SaveAvatarData(safeName, avatarData, mime)
				}
			}
		}
	}
	return ""
}

// CacheAvatarsFromJSON 从解压目录的 ysm.json 缓存所有作者头像。
func CacheAvatarsFromJSON(modelPath string) {
	if !strings.HasSuffix(strings.ToLower(modelPath), ".json") {
		return
	}
	data, err := readLimitedModel(modelPath)
	if err != nil {
		// 真 IO 错误补日志（IsNotExist 静默）
		if !os.IsNotExist(err) {
			log.Printf("[avatar] CacheAvatarsFromJSON 读取失败 %s: %v", modelPath, err)
		}
		return
	}
	var root struct {
		Meta struct {
			Authors []struct {
				Name   string `json:"name"`
				Avatar string `json:"avatar"`
			} `json:"authors"`
		} `json:"metadata"`
	}
	if json.Unmarshal(data, &root) != nil {
		log.Printf("[avatar] CacheAvatarsFromJSON 解析 ysm.json 失败 %s", modelPath)
		return
	}
	dir := filepath.Dir(modelPath)
	cacheDir := CacheDir()
	if cacheDir == "" {
		return // 平台数据根缺失：no-op
	}
	// MkdirAll 错误不再忽略——与 SaveAvatarData 的
	// log 口径一致（原失败静默，后续 WriteFile 报错被 .corrupt 备份掩盖）
	if err := os.MkdirAll(cacheDir, 0755); err != nil {
		log.Printf("[avatar] 创建缓存目录失败: %v", err)
		return
	}
	for _, au := range root.Meta.Authors {
		if au.Name == "" || au.Avatar == "" {
			continue
		}
		safe := SafeName(au.Name)
		cachedPath := filepath.Join(cacheDir, safe+".png")
		if _, err := os.Stat(cachedPath); err == nil {
			continue
		}
		ap := au.Avatar
		// 强校验（Clean + avatar/ 前缀 + 拒绝 ..），防逃逸读模型目录外文件并写入缓存
		if !isSafeAvatarPath(ap) {
			continue
		}
		avatarPath := filepath.Join(dir, ap)
		// Rel 复查：Join 后必须仍在模型目录内
		if rel, err := filepath.Rel(dir, avatarPath); err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			continue
		}
		if avatarData, _ := readLimitedAvatar(avatarPath); avatarData != nil {
			if err := fsutil.WriteFileAtomic(cachedPath, avatarData); err != nil {
				log.Printf("[avatar] 缓存写入失败 %s: %v", cachedPath, err)
			}
		}
	}
}

// CacheAvatarsFromModel 从 .ysm/.zip/.7z/.json 模型缓存所有作者头像。
// 覆盖 CacheAvatarsFromJSON 仅处理解压目录（.json）的局限，使创作者视图头像
// 对压缩包/二进制模型（.ysm/.zip）同样生效。
func CacheAvatarsFromModel(modelPath string) {
	ext := strings.ToLower(filepath.Ext(modelPath))
	switch ext {
	case ".json":
		CacheAvatarsFromJSON(modelPath)
	case ".ysm", ".zip", ".7z":
		names := modelAuthorNames(modelPath)
		cacheDir := CacheDir()
		if cacheDir == "" {
			return // 平台数据根缺失：no-op
		}
		// MkdirAll 错误不再忽略（同上方 CacheAvatarsFromModel）
		if err := os.MkdirAll(cacheDir, 0755); err != nil {
			log.Printf("[avatar] 创建缓存目录失败: %v", err)
			return
		}
		for _, name := range names {
			safe := SafeName(name)
			cachedPath := filepath.Join(cacheDir, safe+".png")
			if _, err := os.Stat(cachedPath); err == nil {
				continue // 已缓存，跳过
			}
			// ExtractAvatarURI 命中即写缓存，未命中返回 ""（不影响其他作者）
			_ = ExtractAvatarURI(modelPath, safe)
		}
	}
}

// modelAuthorNames 读取模型内 ysm.json 的作者名列表（支持 .ysm/.zip/.json）。
func modelAuthorNames(modelPath string) []string {
	ext := strings.ToLower(filepath.Ext(modelPath))
	var raw []byte
	switch ext {
	case ".json":
		data, err := readLimitedModel(modelPath)
		if err != nil {
			// 真 IO 错误补日志（IsNotExist 静默）
			if !os.IsNotExist(err) {
				log.Printf("[avatar] modelAuthorNames 读取 .json 失败 %s: %v", modelPath, err)
			}
			return nil
		}
		raw = data
	case ".zip":
		data, err := readLimitedModel(modelPath)
		if err != nil {
			// 真 IO 错误补日志（IsNotExist 静默）
			if !os.IsNotExist(err) {
				log.Printf("[avatar] modelAuthorNames 读取 .zip 失败 %s: %v", modelPath, err)
			}
			return nil
		}
		zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
		if err != nil {
			log.Printf("[avatar] modelAuthorNames zip 解析失败 %s: %v", modelPath, err)
			return nil
		}
		raw = ReadFileFromZip(zr, "ysm.json")
	case ".ysm", ".7z":
		data, err := readLimitedModel(modelPath)
		if err != nil {
			// 真 IO 错误补日志（IsNotExist 静默）
			if !os.IsNotExist(err) {
				log.Printf("[avatar] modelAuthorNames 读取 %s 失败 %s: %v", ext, modelPath, err)
			}
			return nil
		}
		files := DecodeYSMFiles(data)
		for _, f := range files {
			if strings.HasSuffix(strings.ToLower(f.Path), "ysm.json") {
				raw = toBytes(f.Data)
				break
			}
		}
	}
	if raw == nil {
		return nil
	}
	var root struct {
		Meta struct {
			Authors []struct {
				Name string `json:"name"`
			} `json:"authors"`
		} `json:"metadata"`
	}
	if json.Unmarshal(raw, &root) != nil {
		log.Printf("[avatar] modelAuthorNames 解析 ysm.json 失败 %s", modelPath)
		return nil
	}
	names := make([]string, 0, len(root.Meta.Authors))
	for _, a := range root.Meta.Authors {
		if a.Name != "" {
			names = append(names, a.Name)
		}
	}
	return names
}

// ReadFileFromZip 从 ZIP 读取指定路径的文件。
func ReadFileFromZip(zr *zip.Reader, target string) []byte {
	target = strings.ReplaceAll(target, "\\", "/")
	targetLower := strings.ToLower(target)
	for _, f := range zr.File {
		p := strings.ReplaceAll(f.Name, "\\", "/")
		// 裸 HasSuffix 会让 sub/avatar/alice.png 命中 avatar/alice.png、
		// x/ysm.json 先于根 ysm.json 被取到——改为「精确路径或根下 target/ 前缀」匹配
		if !matchZipEntry(p, targetLower) {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			log.Printf("[avatar] zip 条目打开失败 %s: %v", f.Name, err)
			return nil
		}
		defer rc.Close()
		// zip-bomb 防线：条目解压后大小未限制，ReadAll 全量读入可 OOM——
		// readLimitedModel 限的是压缩体积，解压比无界；对齐 readLimitedAvatar
		// 50MB 上限口径，LimitReader+1 截断探测（ADR-033，防恰 50MB 静默截断）
		const maxEntrySize = 50 << 20
		data, err := io.ReadAll(io.LimitReader(rc, maxEntrySize+1))
		if err != nil {
			log.Printf("[avatar] zip 条目读取失败 %s: %v", f.Name, err)
			return nil
		}
		if len(data) > maxEntrySize {
			log.Printf("[avatar] zip 条目超限跳过 %s（解压超 50MB）", f.Name)
			return nil
		}
		return data
	}
	return nil
}

// matchZipEntry zip 条目路径匹配：
//   - 精确相等（含目标含路径如 "avatar/alice.png" 时，仅同名同路径命中，杜绝
//     sub/avatar/alice.png 误命中——P3-3 收紧点）
//   - 目标以 "/" 结尾（目录级）→ 根下该目录前缀
//   - 裸文件名（无 "/"，如 "test.png"）→ 任意目录下同名文件（既有契约：avatar/test.png
//     命中 test.png，avatarCandidates 兼容裸文件名引用）
func matchZipEntry(p, targetLower string) bool {
	low := strings.ToLower(p)
	if low == targetLower {
		return true
	}
	if strings.HasSuffix(targetLower, "/") {
		return strings.HasPrefix(low, targetLower)
	}
	if !strings.Contains(targetLower, "/") {
		return strings.HasSuffix(low, "/"+targetLower)
	}
	return false
}

// DecodeYSMFiles 通过 Node.js + WASM 解码 YSM 文件。
// nodeJSPath 是 Node.js 可执行文件路径（可全局设置）。
var nodeJSPath string

var getGlueCode func() string
var getWasmBinary func() []byte

// SetNodeJS 设置 Node.js 路径和 WASM/胶水代码加载函数。
func SetNodeJS(nodePath string, glueFn func() string, wasmFn func() []byte) {
	nodeJSPath = nodePath
	getGlueCode = glueFn
	getWasmBinary = wasmFn
}

// DecodeYSMFiles 底层解码，返回完整文件列表。
func DecodeYSMFiles(ysmData []byte) []struct {
	Path string `json:"path"`
	Data []int  `json:"data"`
} {
	if nodeJSPath == "" || getGlueCode == nil || getWasmBinary == nil {
		return nil
	}
	glueRaw := getGlueCode()
	wasmBin := getWasmBinary()
	if len(glueRaw) == 0 || len(wasmBin) == 0 {
		return nil
	}
	gluePatched := strings.ReplaceAll(glueRaw,
		";updateMemoryViews()",
		`;updateMemoryViews();Module["HEAPU8"]=HEAPU8`)

	tmpDir, err := os.MkdirTemp("", "ysm-avatar-*")
	if err != nil {
		log.Printf("[avatar] 创建临时目录失败: %v", err)
		return nil
	}
	defer os.RemoveAll(tmpDir)

	glueFile := filepath.Join(tmpDir, "YSMParser_patched.js")
	if err := os.WriteFile(glueFile, []byte(gluePatched), 0644); err != nil {
		log.Printf("[avatar] 写入 glue 脚本失败: %v", err)
		return nil
	}
	ysmB64 := base64.StdEncoding.EncodeToString(ysmData)
	wasmB64 := base64.StdEncoding.EncodeToString(wasmBin)
	script := fmt.Sprintf(`const YSMParser = require(%q);
const wb64=%q;const wb=Uint8Array.from(atob(wb64),c=>c.charCodeAt(0));
const yb64=%q;const yr=atob(yb64);const ys=new Uint8Array(yr.length);
for(let i=0;i<yr.length;i++)ys[i]=yr.charCodeAt(i);
async function main(){
  const mod=await YSMParser({wasmBinary:wb.buffer,noInitialRun:true});
  const FS=mod.FS;
  try{FS.mkdir('/input')}catch(e){}
  try{FS.mkdir('/output')}catch(e){}
  FS.writeFile('/input/model.ysm',ys);
  try{mod.callMain(['-i','/input','-o','/output'])}catch(e){
    if(!(e&&e.name==='ExitStatus'))throw e}
  function cl(dir){
    const r=[];const es=FS.readdir(dir).filter(f=>f!=='.'&&f!=='..');
    for(const e of es){const p=dir+'/'+e;
      if(FS.isDir(FS.stat(p).mode)){r.push(...cl(p))}
      else{r.push({path:p.substring(8),data:Array.from(FS.readFile(p))})}}
    return r}
  console.log('FILES_JSON:'+JSON.stringify(cl('/output')));
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1)});
`, glueFile, wasmB64, ysmB64)

	scriptPath := filepath.Join(tmpDir, "decode.cjs")
	if err := os.WriteFile(scriptPath, []byte(script), 0644); err != nil {
		log.Printf("[avatar] 写入 decode 脚本失败: %v", err)
		return nil
	}
	// 子进程加超时护栏（WASM 死循环/Node 卡死时防永久挂起冻结 UI 线程）
	ctx, cancel := context.WithTimeout(context.Background(), decodeTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, nodeJSPath, scriptPath)
	hideWindow(cmd)
	cmd.Dir = tmpDir
	output, err := cmd.CombinedOutput()
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			fmt.Fprintf(os.Stderr, "[ysm-avatar] decode timed out after %v\n", decodeTimeout)
			return nil
		}
		fmt.Fprintln(os.Stderr, "[ysm-avatar] decode failed:", string(output))
		return nil
	}
	outStr := string(output)
	idx := strings.Index(outStr, "FILES_JSON:")
	if idx < 0 {
		return nil
	}
	jsonStr := outStr[idx+len("FILES_JSON:"):]
	var files []struct {
		Path string `json:"path"`
		Data []int  `json:"data"`
	}
	if err := json.Unmarshal([]byte(jsonStr), &files); err != nil {
		return nil
	}
	return files
}

// readLimitedAvatar 受限读取头像文件（头像通常 < 1MB，上限 20MB 兜底防损坏/超大
// 缓存整读内存膨胀）。超限/读取失败返回 error（ReadCachedAvatar 需区分 IsNotExist
// 与 IO 错误；其余调用点忽略错误仅判 nil 跳过）。
func readLimitedAvatar(path string) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	const maxAvatarBytes = 20 << 20
	data := fsutil.ReadLimitedEntry(f, maxAvatarBytes)
	if data == nil {
		return nil, fmt.Errorf("头像文件读取失败或超过上限: %s", path)
	}
	return data, nil
}

// readLimitedModel 受限读取模型文件（.ysm/.zip/.7z/.json 可达数百 MB——头像/作者
// 提取只需扫描内容，全量整读内存膨胀；50MB 上限对齐 geometry maxExtractSize 口径，
// 超限返回 error 由调用方按读取失败处理）。
func readLimitedModel(path string) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	const maxModelBytes = 50 << 20
	data := fsutil.ReadLimitedEntry(f, maxModelBytes)
	if data == nil {
		return nil, fmt.Errorf("模型文件读取失败或超过上限: %s", path)
	}
	return data, nil
}

func toBytes(data []int) []byte {
	b := make([]byte, len(data))
	for i, v := range data {
		b[i] = byte(v)
	}
	return b
}
