// ========== 纹理缓存（薄壳） ==========
// 纯逻辑已下沉到 go/texture_cache/，此处仅做 Wails 绑定适配。
// 前端调用 GetCachedTexture 获取纹理数据（优先返回 KTX2 缓存），
// 调用 SaveCachedTexture 存入前端 WASM 编码后的 KTX2 数据。
package app

import (
	"encoding/base64"
	"os"

	"ysm-model-manager/go/texture_cache"
)

// CachedTextureResult 是 GetCachedTexture 的返回值。
type CachedTextureResult struct {
	Format string `json:"format"` // "ktx2" | "png"
	Data   string `json:"data"`   // base64 编码的纹理数据
	Hash   string `json:"hash"`   // 纹理内容的 SHA256
}

// GetCachedTexture 读取纹理文件，计算内容哈希，检查 KTX2 缓存。
// 缓存命中时 Format="ktx2" Data=KTX2 base64；未命中时 Format="png" Data=PNG base64。
// 前端可根据 Format 决定使用 KTX2Loader 还是 TextureLoader。
func (a *App) GetCachedTexture(path string) (CachedTextureResult, error) {
	// 计算内容哈希（基于文件内容，非路径）
	hash, err := texture_cache.TextureHash(path)
	if err != nil {
		return CachedTextureResult{}, err
	}

	// 检查 KTX2 缓存
	ktxData, ok, err := texture_cache.ReadCached(hash)
	if err != nil {
		// 缓存读取出错不阻断，降级为 PNG
		return readWithHash(path, hash)
	}
	if ok {
		return CachedTextureResult{
			Format: "ktx2",
			Data:   base64.StdEncoding.EncodeToString(ktxData),
			Hash:   hash,
		}, nil
	}

	// 缓存未命中，返回 PNG
	return readWithHash(path, hash)
}

// readWithHash 读取原始纹理文件并以 PNG 格式返回。
func readWithHash(path string, hash string) (CachedTextureResult, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return CachedTextureResult{}, err
	}
	return CachedTextureResult{
		Format: "png",
		Data:   base64.StdEncoding.EncodeToString(data),
		Hash:   hash,
	}, nil
}

// SaveCachedTexture 保存前端 WASM 编码后的 KTX2 数据到缓存。
// hash 是 GetCachedTexture 返回的 Hash 值，data 是 KTX2 字节的 base64。
func (a *App) SaveCachedTexture(hash string, b64Data string) error {
	data, err := base64.StdEncoding.DecodeString(b64Data)
	if err != nil {
		return err
	}
	return texture_cache.WriteCached(hash, data)
}

// ClearTextureCache 清空纹理缓存（用户主动清理用）。
func (a *App) ClearTextureCache() error {
	return texture_cache.ClearCache()
}

// HasCachedTexture 检查指定纹理的内容哈希是否已有 KTX2 缓存。
func (a *App) HasCachedTexture(hash string) (bool, error) {
	return texture_cache.HasCached(hash)
}

// GetCachedTextureByHash 通过哈希直接读取 KTX2 缓存（不读取原始文件，轻量操作）。
// hash 由前端从已读纹理数据计算 SHA256 得到。
// 返回 base64 编码的 KTX2 数据；缓存未命中时返回空字符串。
func (a *App) GetCachedTextureByHash(hash string) (string, error) {
	data, ok, err := texture_cache.ReadCached(hash)
	if err != nil {
		return "", err
	}
	if !ok {
		return "", nil // 缓存未命中，返回空字符串
	}
	return base64.StdEncoding.EncodeToString(data), nil
}
