// Package texture_cache 提供纹理缓存目录管理和 KTX2 缓存读写。
// 与 avatar 包同构：缓存目录收敛到平台数据根，SHA256 内容哈希做 key，
// 不受文件路径变动影响（模型重命名/移动后缓存仍然命中）。
//
// 使用方式：
//
//	hash, err := texture_cache.TextureHash(pngPath)
//	data, ok, err := texture_cache.ReadCached(hash)
//	if ok { /* 用 KTX2 data */ }
package texture_cache

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"

	"ysm-model-manager/go/fsutil"
)

// CacheDir 返回纹理缓存目录。
// 默认走 os.UserConfigDir()/YSM-Model-Manager/texture_cache（与 avatar 同根，ADR-046 P2）。
// 外部可覆盖此函数（测试时可设置临时目录）。
var CacheDir = func() string {
	base, err := os.UserConfigDir()
	if err != nil || base == "" {
		return "" // 平台配置根不可用：no-op
	}
	return filepath.Join(base, "YSM-Model-Manager", "texture_cache")
}

// TextureHash 计算文件内容的 SHA256 哈希，用作缓存 key。
// 哈希基于文件内容而非路径，模型重命名/移动后缓存仍然命中。
func TextureHash(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", fmt.Errorf("texture_cache: 打开文件 %s: %w", path, err)
	}
	defer f.Close()

	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", fmt.Errorf("texture_cache: 计算哈希 %s: %w", path, err)
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// CachePath 返回给定哈希对应的缓存文件路径。
func CachePath(hash string) string {
	dir := CacheDir()
	if dir == "" {
		return ""
	}
	return filepath.Join(dir, hash+".ktx2")
}

// ReadCached 读取缓存中的 KTX2 数据。
// ok=false 表示缓存未命中（非错误）。
func ReadCached(hash string) (data []byte, ok bool, err error) {
	path := CachePath(hash)
	if path == "" {
		return nil, false, nil
	}
	if _, statErr := os.Stat(path); statErr != nil {
		if os.IsNotExist(statErr) {
			return nil, false, nil // 缓存未命中，非错误
		}
		return nil, false, fmt.Errorf("texture_cache: 检查缓存 %s: %w", path, statErr)
	}
	data, err = os.ReadFile(path)
	if err != nil {
		return nil, false, fmt.Errorf("texture_cache: 读取缓存 %s: %w", path, err)
	}
	return data, true, nil
}

// WriteCached 写入 KTX2 数据到缓存。
// 自动创建缓存目录（如果不存在）。
func WriteCached(hash string, data []byte) error {
	dir := CacheDir()
	if dir == "" {
		return fmt.Errorf("texture_cache: 缓存目录不可用")
	}
	if err := os.MkdirAll(dir, fsutil.DirPerms); err != nil {
		return fmt.Errorf("texture_cache: 创建缓存目录 %s: %w", dir, err)
	}
	path := filepath.Join(dir, hash+".ktx2")
	// 避免部分写入：先写临时文件再重命名
	tmpPath := path + ".tmp"
	if err := os.WriteFile(tmpPath, data, fsutil.FilePerms); err != nil {
		return fmt.Errorf("texture_cache: 写入缓存 %s: %w", tmpPath, err)
	}
	if err := os.Rename(tmpPath, path); err != nil {
		// 重命名失败（跨设备等），尝试直接覆盖
		os.Remove(tmpPath) // 清理临时文件
		if writeErr := os.WriteFile(path, data, fsutil.FilePerms); writeErr != nil {
			return fmt.Errorf("texture_cache: 写入缓存（重命名降级）%s: %w", path, writeErr)
		}
	}
	return nil
}

// HasCached 检查缓存中是否存在指定哈希的 KTX2 文件。
func HasCached(hash string) (bool, error) {
	path := CachePath(hash)
	if path == "" {
		return false, nil
	}
	_, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

// ClearCache 清空纹理缓存目录（用于测试或用户主动清理）。
func ClearCache() error {
	dir := CacheDir()
	if dir == "" {
		return nil
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		p := filepath.Join(dir, e.Name())
		if err := os.Remove(p); err != nil {
			log.Printf("texture_cache: 清理缓存文件 %s: %v", p, err)
		}
	}
	return nil
}