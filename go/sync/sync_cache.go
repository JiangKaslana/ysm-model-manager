// ===== 同步目录扫描结果缓存（30s TTL）=====
// 背景：BuildSyncItems 结果缓存能挡住“重复刷新”，但首次重算仍有多条路径直接 Walk：
//   - SyncResources（resourcepack/shaderpack 文件级）
//   - SyncResourcesDirLevel 含嵌套类型（maid-model）回退 Walk
//   - DiffFolderContents 的实例侧 collectFolderFiles Walk
//
// 这里给这些“同步专用扫盘结果”再加一层短 TTL 缓存，使一次失效后的重算在 30s 内
// 对同一目录/rtype 只真正 Walk 一次（与 scanner.ScanEntries 的去重效果对齐）。
package sync

import (
	"sync"
	"time"

	"ysm-model-manager/go/scanner"
)

const syncDirectoryScanCacheTTL = 30 * time.Second

// syncDirectoryScanKey 标识一次同步扫描结果。
// kind 用于区分三类结果：
//   - "resources":  map[string]DiffEntry（SyncResources 全树文件 + 资源包文件夹）
//   - "dirlevel":   map[string]string（SyncResourcesDirLevel 的同步单元集合）
//   - "folder":     map[string]string（DiffFolderContents 的文件夹内文件集合）
type syncDirectoryScanKey struct {
	kind  string
	root  string
	rtype string
}

type syncDirectoryScanEntry struct {
	value     any
	expiresAt time.Time
}

var (
	syncResourcesScanCache sync.Map // syncDirectoryScanKey -> *syncDirectoryScanEntry (map[string]DiffEntry)
	syncDirLevelScanCache  sync.Map // syncDirectoryScanKey -> *syncDirectoryScanEntry (map[string]string)
	syncFolderScanCache    sync.Map // syncDirectoryScanKey -> *syncDirectoryScanEntry (map[string]string)
)

func init() {
	scanner.OnCacheInvalidated(InvalidateSyncScanCaches)
}

// InvalidateSyncScanCaches 清空全部同步目录扫描结果缓存。
// scanner.InvalidateCache/InvalidatePath 会自动调用；不走 scanner 失效的 push/pull/toggle
// 等入口需显式调（见 internal/app 的 mutation 收口）。
func InvalidateSyncScanCaches() {
	syncResourcesScanCache.Range(func(k, _ interface{}) bool {
		syncResourcesScanCache.Delete(k)
		return true
	})
	syncDirLevelScanCache.Range(func(k, _ interface{}) bool {
		syncDirLevelScanCache.Delete(k)
		return true
	})
	syncFolderScanCache.Range(func(k, _ interface{}) bool {
		syncFolderScanCache.Delete(k)
		return true
	})
}

func loadSyncScanCache[T any](cache *sync.Map, key any) (T, bool) {
	v, ok := cache.Load(key)
	if !ok {
		var zero T
		return zero, false
	}
	entry := v.(*syncDirectoryScanEntry)
	if time.Now().Before(entry.expiresAt) {
		value, ok := entry.value.(T)
		if !ok {
			cache.Delete(key)
			var zero T
			return zero, false
		}
		return value, true
	}
	cache.Delete(key)
	var zero T
	return zero, false
}

func storeSyncScanCache[T any](cache *sync.Map, key any, value T) {
	cache.Store(key, &syncDirectoryScanEntry{
		value:     value,
		expiresAt: time.Now().Add(syncDirectoryScanCacheTTL),
	})
}
