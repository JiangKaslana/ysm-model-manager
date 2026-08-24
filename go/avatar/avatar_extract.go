// Package avatar 创作者头像提取与缓存，不依赖 Wails runtime。
//
// 本文件（avatar_extract.go）：头像提取编排——从模型文件（.ysm/.zip/.json）
// 提取作者头像（ExtractAvatarURI）、批量缓存（CacheAvatarsFromJSON/CacheAvatarsFromModel）、
// 作者名清单（modelAuthorNames）与模型受限读取（readLimitedModel）。拆分自原 avatar.go
// （ADR-040 文件行数治理）。
package avatar

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/container"
	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/types"
)

// ExtractAvatarURI 从模型文件中提取指定所有者的头像 data URI。
// modelPath 支持 .ysm / .zip / .json（解压目录）。
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
			if isYSMJSONPath(f.Path) {
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
			// 扩展名口径与 avatarCandidates 对齐：.png/.jpg/.jpeg 均认（原漏 .jpeg
			// 使 avatar/face.jpeg 声明的头像在不走作者匹配的降级路径下被跳过）
			for _, f := range files {
				low := strings.ToLower(f.Path)
				if !strings.HasSuffix(low, ".png") && !strings.HasSuffix(low, ".jpg") && !strings.HasSuffix(low, ".jpeg") {
					continue
				}
				if !strings.HasPrefix(low, "avatar/") && !strings.Contains(low, "/avatar/") {
					continue
				}
				mime := "image/png"
				if strings.HasSuffix(low, ".jpg") || strings.HasSuffix(low, ".jpeg") {
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

	case ".zip", ".7z":
		data, err := readLimitedModel(modelPath)
		if err != nil {
			if !os.IsNotExist(err) {
				log.Printf("[avatar] 读取 %s 模型失败 %s: %v", ext, modelPath, err)
			}
			return ""
		}

		var r container.Reader
		switch ext {
		case ".zip":
			r, err = container.OpenZipBytes(data, int64(len(data)))
		case ".7z":
			r, err = container.Open7zBytes(data, int64(len(data)))
		}
		if err != nil {
			log.Printf("[avatar] %s 解析失败 %s: %v", ext, modelPath, err)
			return ""
		}
		defer r.Close()

		if avatar := extractAvatarFromContainer(r, safeName); avatar != "" {
			return avatar
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
				// 候选列表（含裸文件名补 avatar/ 前缀与标准扩展名变体）逐个尝试——
				// 原实现直接 Join(dir, au.Avatar) 使裸文件名声明（"sdf"）读 dir/sdf 而非
				// dir/avatar/sdf.png，与 .ysm/.zip 分支 avatarCandidates 口径不一致（修复）
				for _, c := range avatarCandidates(au.Avatar) {
					avatarPath := filepath.Join(dir, c)
					// 落盘前 Rel 复查：Join 后必须仍在模型目录内
					if rel, err := filepath.Rel(dir, avatarPath); err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
						continue
					}
					if avatarData, _ := readLimitedAvatar(avatarPath); avatarData != nil {
						mime := "image/png"
						if strings.HasSuffix(strings.ToLower(c), ".jpg") {
							mime = "image/jpeg"
						}
						return SaveAvatarData(safeName, avatarData, mime)
					}
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
	if err := os.MkdirAll(cacheDir, fsutil.DirPerms); err != nil {
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
		// 候选列表逐个尝试（同 ExtractAvatarURI .json 分支口径）：裸文件名声明
		// （"sdf"）解析到 dir/avatar/sdf.png 而非 dir/sdf（修复）
		for _, c := range avatarCandidates(ap) {
			avatarPath := filepath.Join(dir, c)
			// Rel 复查：Join 后必须仍在模型目录内
			if rel, err := filepath.Rel(dir, avatarPath); err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
				continue
			}
			if avatarData, _ := readLimitedAvatar(avatarPath); avatarData != nil {
				if err := fsutil.WriteFileAtomic(cachedPath, avatarData); err != nil {
					log.Printf("[avatar] 缓存写入失败 %s: %v", cachedPath, err)
				}
				break // 一个作者只落一张头像
			}
		}
	}
}

// CacheAvatarsFromModel 从 .ysm/.zip/.json 模型缓存所有作者头像。
// 覆盖 CacheAvatarsFromJSON 仅处理解压目录（.json）的局限，使创作者视图头像
// 对压缩包/二进制模型（.ysm/.zip）同样生效。
func CacheAvatarsFromModel(modelPath string) {
	ext := strings.ToLower(filepath.Ext(modelPath))
	switch ext {
	case ".json":
		CacheAvatarsFromJSON(modelPath)
	case ".ysm", ".zip":
		names := modelAuthorNames(modelPath)
		cacheDir := CacheDir()
		if cacheDir == "" {
			return // 平台数据根缺失：no-op
		}
		// MkdirAll 错误不再忽略（同上方 CacheAvatarsFromModel）
		if err := os.MkdirAll(cacheDir, fsutil.DirPerms); err != nil {
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
		zr, err := container.OpenZipBytes(data, int64(len(data)))
		if err != nil {
			log.Printf("[avatar] modelAuthorNames zip 解析失败 %s: %v", modelPath, err)
			return nil
		}
		defer zr.Close()
		raw = ReadFileFromContainer(zr, "ysm.json")
	case ".ysm":
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
			if isYSMJSONPath(f.Path) {
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

// readLimitedModel 受限读取模型文件（.ysm/.zip/.json 可达数百 MB——头像/作者
// 提取只需扫描内容，全量整读内存膨胀；50MB 上限对齐 geometry maxExtractSize 口径，
// 超限返回 error 由调用方按读取失败处理）。
func readLimitedModel(path string) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	data := fsutil.ReadLimitedEntry(f, types.MaxReadLimit)
	if data == nil {
		return nil, fmt.Errorf("模型文件读取失败或超过上限: %s", path)
	}
	return data, nil
}

// extractAvatarFromContainer 处理压缩包（zip/7z）头像提取的通用逻辑
// 包括：解析作者列表、按作者名匹配、以及 avatar/ 目录降级逻辑
func extractAvatarFromContainer(r container.Reader, safeName string) string {
	// 1. 解析作者列表
	var authors []authorEntry
	ysmData := ReadFileFromContainer(r, "ysm.json")
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

	// 2. 按作者名匹配头像
	for _, au := range authors {
		if SafeName(au.Name) == safeName && au.Avatar != "" {
			ap := strings.ToLower(au.Avatar)
			if !isSafeAvatarPath(ap) {
				continue
			}
			for _, c := range avatarCandidates(ap) {
				if avatarData := ReadFileFromContainer(r, c); avatarData != nil {
					mime := "image/png"
					if strings.HasSuffix(strings.ToLower(c), ".jpg") || strings.HasSuffix(strings.ToLower(c), ".jpeg") {
						mime = "image/jpeg"
					}
					return SaveAvatarData(safeName, avatarData, mime)
				}
			}
		}
	}

	// 3. 降级：avatar/ 目录第一张 .png/.jpg/.jpeg
	for _, e := range r.Entries() {
		if e.IsDir() {
			continue
		}
		low := strings.ToLower(e.Name())
		if !strings.HasSuffix(low, ".png") && !strings.HasSuffix(low, ".jpg") && !strings.HasSuffix(low, ".jpeg") {
			continue
		}
		if !strings.HasPrefix(low, "avatar/") && !strings.Contains(low, "/avatar/") {
			continue
		}
		rc, oerr := e.Open()
		if oerr != nil {
			continue
		}
		avatarData, rerr := io.ReadAll(io.LimitReader(rc, types.MaxReadLimit+1))
		rc.Close()
		if rerr != nil || int64(len(avatarData)) > types.MaxReadLimit {
			continue
		}
		mime := "image/png"
		if strings.HasSuffix(low, ".jpg") || strings.HasSuffix(low, ".jpeg") {
			mime = "image/jpeg"
		}
		return SaveAvatarData(safeName, avatarData, mime)
	}

	return ""
}
