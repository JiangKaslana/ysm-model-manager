// ===== 模型扫描 + 作者提取 + 仓库索引（ADR-003 P2 Logic Sinking）=====
// 从 internal/app/app_scan.go 下沉：目录扫描、SHA256 哈希、扫描缓存、
// 作者提取、index.json 生成。纯 Go 逻辑，无 Wails runtime 依赖；
// tagsStore 填充与 AddOpLog 日志由薄壳处理。
package scanner

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/types"
)

// ========== 扫描缓存（30s TTL）==========

var scanCache sync.Map

// cacheGen 缓存代际：InvalidateCache（全量失效）递增。
// 在途扫描 Store 前比对代际，若扫描期间缓存已被全量失效则丢弃本次结果，
// 防止「刚失效又被旧扫描结果重新 Store」导致失效白做（P2 竞态修复）。
// 用 atomic 保护：watcher 后台 goroutine 与 Wails 绑定线程并发读写，普通 uint64 存在数据竞争（code_review P3）。
var cacheGen atomic.Uint64

// keyVersions per-key 版本戳（P1 修复：InvalidatePath 只递增目标目录版本——
// 原实现递增全局 cacheGen，单目录失效会丢弃其它任意目录的在途扫描结果，
// 安全但浪费，等同全量失效；per-key 隔离后仅本目录在途扫描受影响。
// 值类型为 *atomic.Uint64，支持原子 Load/Store/Add 操作，消除竞态窗口。）
var keyVersions sync.Map // string → *atomic.Uint64

type scanCacheEntry struct {
	entries   []types.ModelEntry
	expiresAt time.Time
}

const scanCacheTTL = 30 * time.Second

// configFunc 运行阈值配置注入（ADR-062：薄壳 internal/app 传入 AppConfig；
// nil 或字段 0 时回退包级默认常量，行为零漂移）
var configFunc func() types.AppConfig

// errorSink 扫描错误回调（ADR-082 续：GUI 下 stdout 不可见，log.Printf 等于静默——
// 薄壳注入 AddOpLog 让 walk/文件信息/哈希错误进环形日志面板，用户可查）
var errorSink func(msg string)

// scanErrorDedup 错误去重窗口：同一 msg 在窗口期内只上报一次。
// 背景：扫描缓存 30s TTL，缓存过期后同目录反复重扫；若目录持续出错（如权限拒绝），
// 每次扫描都会触发同一条错误 → 环形日志面板刷屏（日志面板本身无去重，只按条数截尾）。
// 窗口与 scanCacheTTL 对齐（30s）：重扫前该错误已入面板，去重不影响可查性。
const scanErrorDedupWindow = 30 * time.Second

// dedupMu + dedupSeen 记录 msg → 上次上报时间
var (
	dedupMu   sync.Mutex
	dedupSeen = map[string]time.Time{}
)

// SetErrorSink 注入扫描错误回调（薄壳 internal/app 启动时调用，如 AddOpLog 包装）
func SetErrorSink(fn func(msg string)) {
	errorSink = fn
}

// emitScanError 上报扫描错误：注入 sink 时走 sink（进日志面板），否则 log.Printf 兜底。
// 同 msg 在 scanErrorDedupWindow 窗口内去重（防重复扫描刷屏），窗口外重新上报。
func emitScanError(format string, args ...any) {
	msg := fmt.Sprintf(format, args...)
	now := time.Now()
	dedupMu.Lock()
	last, seen := dedupSeen[msg]
	if seen && now.Sub(last) < scanErrorDedupWindow {
		dedupMu.Unlock()
		return // 窗口内同错误已上报过，去重
	}
	dedupSeen[msg] = now
	// 顺手清理过期条目（窗口外不会再匹配，防止长期运行会话内存缓慢增长）
	for k, t := range dedupSeen {
		if now.Sub(t) >= scanErrorDedupWindow {
			delete(dedupSeen, k)
		}
	}
	dedupMu.Unlock()
	if errorSink != nil {
		errorSink(msg)
		return
	}
	log.Printf("%s", msg)
}

// SetConfigFunc 注入运行阈值配置源（ADR-062：薄壳 internal/app 启动时调用）
func SetConfigFunc(fn func() types.AppConfig) {
	configFunc = fn
}

// scanTTL 扫描缓存 TTL：AppConfig.ScanCacheTTLMs > 0 用之，否则默认 30s
func scanTTL() time.Duration {
	if configFunc != nil {
		if ms := configFunc().ScanCacheTTLMs; ms > 0 {
			return time.Duration(ms) * time.Millisecond
		}
	}
	return scanCacheTTL
}

// normalizeScanKey 统一缓存 key：TrimSpace + filepath.Clean（去尾部分隔符/相对路径归一）。
// ScanEntries 与 InvalidatePath 必须共用同一规整，否则失效 key 与扫描 key 字节级不一致会脱靶（P2 修复）。
func normalizeScanKey(dir string) string {
	dir = strings.TrimSpace(dir)
	if dir == "" {
		return ""
	}
	return filepath.Clean(dir)
}

// InvalidateCache 清空全部扫描缓存（下载/导入/同步后调用）
func InvalidateCache() {
	cacheGen.Add(1)
	scanCache.Range(func(key, _ interface{}) bool {
		scanCache.Delete(key)
		return true
	})
}

// invalidateKeyVersion 原子递增指定 key 的版本戳（P1 修复：原子操作防竞态）
func invalidateKeyVersion(key string) {
	v, _ := keyVersions.LoadOrStore(key, &atomic.Uint64{})
	v.(*atomic.Uint64).Add(1)
}

// InvalidatePath 删除指定目录的扫描缓存（启用/禁用 .ban 后调用）
func InvalidatePath(dir string) {
	key := normalizeScanKey(dir)
	if key == "" {
		return
	}
	sep := string(filepath.Separator)
	// 遍历 keyVersions（含在途扫描的 key）：递增所有相关 key 版本，拦截在途 Store
	keyVersions.Range(func(k, v interface{}) bool {
		kstr := k.(string)
		if kstr == key || strings.HasPrefix(key, kstr+sep) || strings.HasPrefix(kstr, key+sep) {
			kv := v.(*atomic.Uint64)
			kv.Add(1)
		}
		return true
	})
	// 自身 key 版本兜底递增（可能从未被扫描过）
	kv, _ := keyVersions.LoadOrStore(key, &atomic.Uint64{})
	kv.(*atomic.Uint64).Add(1)
	// 遍历 scanCache 删除相关条目
	scanCache.Range(func(k, _ interface{}) bool {
		kstr := k.(string)
		if kstr == key || strings.HasPrefix(key, kstr+sep) || strings.HasPrefix(kstr, key+sep) {
			scanCache.Delete(kstr)
		}
		return true
	})
}

// ========== 模型扫描 ==========

// ScanEntries 扫描目录下的模型文件（含 .recycle 排除、扩展名过滤、SHA256 哈希、30s TTL 缓存）
func ScanEntries(dir string) []types.ModelEntry {
	entries, _ := ScanEntriesWithHit(dir)
	return entries
}

// ScanEntriesWithHit 同 ScanEntries，但额外返回是否命中 30s 缓存。
// 调用方据此决定是否记录扫描日志，避免 30s 内重复访问同一目录时刷屏操作日志面板。
func ScanEntriesWithHit(dir string) ([]types.ModelEntry, bool) {
	dir = normalizeScanKey(dir)
	if dir == "" {
		return []types.ModelEntry{}, false
	}
	// 记录扫描开始时间（进入时），TTL 从此时刻算，不被扫描耗时侵蚀
	startTime := time.Now()
	// 记录进入时代际：扫描期间若缓存被失效，Store 前比对并丢弃结果
	gen := cacheGen.Load()
	// 记录进入时 per-key 版本——InvalidatePath 只递增本 key，
	// Store 前比对 keyVersion 防止「刚失效又被本目录在途扫描重新 Store」
	// P1 修复：keyVersions 值类型改为 *atomic.Uint64，用 Load() 读取原子值
	kv, _ := keyVersions.LoadOrStore(dir, &atomic.Uint64{})
	keyVersion := kv.(*atomic.Uint64).Load()
	// 检查缓存
	if v, ok := scanCache.Load(dir); ok {
		entry := v.(scanCacheEntry)
		if time.Now().Before(entry.expiresAt) {
			// 命中路径克隆后返回，避免调用方（app_scan.go HasTags 填充）写回内部切片，
			// 污染缓存后备数组 + 并发扫描数据竞争
			// 空结果保持非 nil——`append([]types.ModelEntry(nil), ...)`
			// 对空 entry 返回 nil，经 Wails 序列化为 JSON `null`，与首次扫描/空 key 的
			// `[]` 不一致（前端若区分 null/[] 会出差异）；用空切片做基底保证一致性
			cloned := append([]types.ModelEntry{}, entry.entries...)
			return cloned, true
		}
		// 过期条目惰性淘汰——原实现过期条目仅在「同目录重扫」
		// 或 InvalidateCache 时被替换/清除，长期运行扫描过大量目录后过期 entry（各含
		// 一整个 []ModelEntry）持续滞留，内存增长；Load 命中过期时顺手 Delete
		scanCache.Delete(dir)
	}
	entries := []types.ModelEntry{}
	// 根目录级 walk 失败标记——目录不存在/无权限时 WalkDir
	// 仅回调一次 err 后结束，原实现打印后返回空列表并照常 Store 进缓存 30s，
	// 用户无法区分「目录真空」与「目录不可读」（失败结果被当成功缓存）
	walkFailed := false
	filepath.WalkDir(dir, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			// 统一走错误回调（GUI 下 stdout 不可见，fmt.Printf 等于静默）——
			// 薄壳注入后进环形日志面板（ADR-082 续）
			emitScanError("[scanner] walk error: %s: %v", p, err)
			if p == dir {
				walkFailed = true // 根目录本身打不开：整目录失败
			}
			return nil
		}
		if d.IsDir() {
			// ADR-044 策略 A：回收站排除统一走 fsutil.IsRecycleDir（EqualFold 大小写不敏感、
			// 精确匹配基名，避免子串误杀 foo.recycle.ysm 等合法文件——与 go/sync/dedup 同口径）
			if fsutil.IsRecycleDir(p) {
				return filepath.SkipDir
			}
			// .github 目录跳过——内嵌 CI 脚本（generateIndexWorkflow
			// genindex.go:381 `strings.Contains(p, "/.github")`）显式跳过 .github，而
			// GenerateRepoIndex 经 ScanEntries 扫描时未过滤：若 .github 内出现受支持
			// 扩展名文件，Go 侧 index 与 CI 重生成的 index 会漂移；两处口径统一
			if d.Name() == ".github" {
				return filepath.SkipDir
			}
			// 目录级 .ban（fileops.ToggleModelEnable 对文件夹模型整组禁用时
			// 把父目录改名 modelA.ban，ADR-038 D3.7）不得被扫描为活跃条目——
			// 原实现只过滤文件级 .ban，目录级禁用模型会以活跃身份进入 sync 的
			// repoHash/repoName，被 GetInstanceStatus 列为 Missing 或 SyncToggleStatus 重新启用
			if strings.HasSuffix(strings.ToLower(d.Name()), ".ban") {
				return filepath.SkipDir
			}
			return nil
		}
		ext := strings.ToLower(filepath.Ext(p))
		originalExt := ext
		// 目录级 .ban 已在上方 SkipDir；文件级 .ban/.disabled 恢复原扩展名判断
		// （stripDisableSuffix 与作者提取共用同口径）
		restored := stripDisableSuffix(p)
		if restored != p {
			originalExt = strings.ToLower(filepath.Ext(restored))
		}
		if !types.IsSupportedExt(originalExt) {
			return nil
		}
		// .json 只允许 ysm.json（动作/动画文件不应单独扫描推送）
		if originalExt == ".json" {
			baseName := strings.ToLower(filepath.Base(p))
			baseName = strings.TrimSuffix(baseName, ".ban")
			baseName = strings.TrimSuffix(baseName, ".disabled")
			if !types.IsYsmEntryJSON(baseName) {
				return nil
			}
		}
		info, err := d.Info()
		if err != nil {
			// d.Info 失败跳过该文件——原实现 log 后仍以
			// Size=0/ModTime=0 条目混入（前端展示大小 0 的幽灵文件，同步哈希基于
			// 错误元数据）；权限/IO 错误下该文件不可读，跳过比假条目更诚实。
			// 错误进环形日志面板（ADR-082 续），用户可查而非静默
			emitScanError("[scanner] 获取文件信息失败 %s: %v，跳过该文件", p, err)
			return nil
		}
		e := types.ModelEntry{Name: filepath.Base(p), Path: p, Ext: originalExt}
		e.Size = info.Size()
		e.ModTime = info.ModTime().UnixMilli()
		// 计算 SHA256 供同步系统使用（GetInstanceStatus 依赖哈希匹配）
		// 跳过非 YSM 类型的大文件（MMD/VRC 文件可达数十 MB，哈希全量太慢）
		// 蓝图文件（.nbt/.schematic/.litematic）通常较小，计入哈希以支持同步对比
		if types.ShouldHashExt(originalExt) {
			e.Hash = ComputeFileHash(p)
			// 哈希失败留痕——ComputeFileHash 返回空串可能
			// 是读错误或超上限，静默置空会让同步把该文件当「无哈希」跳过（用户
			// 不知为何不同步）；进环形日志面板（ADR-082 续）不阻断扫描
			if e.Hash == "" {
				emitScanError("[scanner] 哈希计算失败/跳过 %s（读错误或超 %d 字节上限）", p, types.MaxImportSize)
			}
		}
		entries = append(entries, e)
		return nil
	})
	// 克隆 slice 后 Store，避免 sync.Map.Load 读到 WalkDir 中途
	// append 的部分写入（单线程 Wails 场景安全，但并发扫描无 race）
	stored := append([]types.ModelEntry(nil), entries...)
	// 整目录失败（walkFailed）不写缓存——失败结果带 30s TTL 缓存会
	// 让「目录不可读」持续显示为空（用户修好权限后 30s 内仍假空）；
	// 仅缓存完整扫描结果
	// Store 前比对 per-key 版本——InvalidatePath 递增本 key 版本后，
	// 在途扫描（keyVersion 已过期）不得重新 Store（防止刚失效又被旧结果覆盖）
	// P1 修复：keyVersions 值类型改为 *atomic.Uint64
	kvNow, _ := keyVersions.LoadOrStore(dir, &atomic.Uint64{})
	if !walkFailed && cacheGen.Load() == gen && kvNow.(*atomic.Uint64).Load() == keyVersion {
		scanCache.Store(dir, scanCacheEntry{entries: stored, expiresAt: startTime.Add(scanTTL())})
	}
	return entries, false
}

// ComputeFileHash 计算文件的 SHA256 哈希（用于同步系统文件匹配）
func ComputeFileHash(path string) string {
	// 大文件哈希上限——.zip 资源包可达数百 MB，全量 io.Copy
	// 会整线程卡死扫描/同步（bug-chronicle #36「全量哈希拖慢非 YSM」）；超 MaxImportSize
	// 跳过哈希返回空（同步匹配对空哈希跳过该文件，与「读失败返回空」语义一致）
	if fi, err := os.Stat(path); err == nil && fi.Size() > types.MaxImportSize {
		return ""
	}
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	h := sha256.New()
	// 检查 io.Copy 读错误，读失败返回空哈希（与 open 失败一致），
	// 避免截断哈希静默进入同步匹配（截断哈希与完整哈希无法区分）
	if _, err := io.Copy(h, f); err != nil {
		return ""
	}
	return fmt.Sprintf("%x", h.Sum(nil))
}

// ========== 作者提取 ==========

// stripDisableSuffix 剥离 .ban/.disabled 禁用后缀（口径与 ScanEntries 一致，三处共用防漂移）
// .ban 剥离委托 types.StripBanSuffix（单一事实来源）。
func stripDisableSuffix(name string) string {
	lower := strings.ToLower(name)
	if strings.HasSuffix(lower, ".ban") {
		return types.StripBanSuffix(name)
	}
	if strings.HasSuffix(lower, ".disabled") {
		return name[:len(name)-len(".disabled")]
	}
	return name
}

// extractAuthor 从文件名提取 [作者] 前缀（无前缀或格式非法返回空串）
func extractAuthor(name string) string {
	name = stripDisableSuffix(name)
	if !strings.HasPrefix(name, "[") {
		return ""
	}
	idx := strings.Index(name, "]")
	if idx <= 0 {
		return ""
	}
	author := name[1:idx]
	if author == "" {
		return ""
	}
	return author
}

// ListModelAuthors 从扫描条目提取 [作者] 前缀统计（按出现次数降序）
func ListModelAuthors(entries []types.ModelEntry) []types.AuthorInfo {
	type authorData struct {
		Count      int
		SampleFile string
	}
	authors := map[string]*authorData{}
	for _, e := range entries {
		if author := extractAuthor(e.Name); author != "" {
			if _, ok := authors[author]; !ok {
				authors[author] = &authorData{SampleFile: e.Path}
			}
			authors[author].Count++
		}
	}
	var result []types.AuthorInfo
	for name, ad := range authors {
		result = append(result, types.AuthorInfo{Name: name, Count: ad.Count, SampleFile: ad.SampleFile})
	}
	// SliceStable + Name 兜底：count 并列时输出顺序确定（与 ScanLocalAuthors 的
	// rtype 字典序遍历口径一致，防同输入不同输出）
	sort.SliceStable(result, func(i, j int) bool {
		if result[i].Count != result[j].Count {
			return result[i].Count > result[j].Count
		}
		return result[i].Name < result[j].Name
	})
	return result
}

// ScanLocalAuthors 扫描各资源类型根目录，从文件名提取 [作者]（roots: rtype→root）
func ScanLocalAuthors(roots map[string]string) []types.WorkshopCreator {
	seen := map[string]bool{}
	var result []types.WorkshopCreator

	// roots 为 map，迭代序随机会导致跨类型合并的 Type 拼接顺序不稳定
	// （同输入不同输出，flaky 测试/缓存/UI 展示均受影响）——按 rtype 字典序遍历保证确定性
	rtypes := make([]string, 0, len(roots))
	for rtype := range roots {
		rtypes = append(rtypes, rtype)
	}
	sort.Strings(rtypes)

	for _, rtype := range rtypes {
		root := roots[rtype]
		if root == "" {
			continue
		}
		entries := ScanEntries(root)
		for _, e := range entries {
			author := extractAuthor(e.Name)
			if author == "" {
				continue
			}
			key := author + "@" + rtype
			if seen[key] {
				continue
			}
			seen[key] = true
			// 合并已有的 type 标签
			existing := -1
			for i, cr := range result {
				if cr.Name == author {
					existing = i
					break
				}
			}
			if existing >= 0 {
				// 追加类型标签（按 ";" 分段精确比较，防 rtype 子串关系误判，防御范式③）
				merged := false
				for _, seg := range strings.Split(result[existing].Type, ";") {
					if seg == rtype {
						merged = true
						break
					}
				}
				if !merged {
					result[existing].Type += ";" + rtype
				}
			} else {
				result = append(result, types.WorkshopCreator{
					Name: author,
					Desc: "来自本地仓库",
					Type: rtype,
				})
			}
		}
	}
	return result
}

// ========== 仓库索引 ==========

// GenerateRepoIndex 扫描仓库目录，生成 index.json（供 GitHub Actions/Linux 消费，正斜杠路径）
func GenerateRepoIndex(repoPath string) (string, error) {
	InvalidatePath(repoPath) // 索引必须最新：绕过 30s 扫描缓存
	entries := ScanEntries(repoPath)
	type indexEntry struct {
		Name string `json:"name"`
		Path string `json:"path"`
		Size int64  `json:"size"`
		Hash string `json:"hash,omitempty"`
	}
	var list []indexEntry
	for _, e := range entries {
		relPath := e.Path
		// 用 filepath.Rel 替代大小写敏感的前缀裁剪，
		// 避免相对/绝对路径拼写差异把绝对路径泄露进 index.json
		if rp, err := filepath.Rel(repoPath, e.Path); err == nil {
			relPath = rp
		} else if strings.HasPrefix(relPath, repoPath) {
			relPath = strings.TrimPrefix(relPath, repoPath)
			relPath = strings.TrimLeft(relPath, `\/`)
		}
		// index.json 供 GitHub Actions（Linux）消费，路径统一正斜杠（ADR-011）
		relPath = filepath.ToSlash(relPath)
		list = append(list, indexEntry{Name: e.Name, Path: relPath, Size: e.Size, Hash: e.Hash})
	}
	data, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return "", fmt.Errorf("序列化 index 条目失败: %w", err)
	}
	indexPath := filepath.Join(repoPath, "index.json")
	// 临时文件 + rename 原子替换，避免崩溃/中断留下半截 index.json（陷阱 #8 变体）
	// 失败路径统一清理 .tmp：WriteFile 半写残留与 rename 失败残留都 Remove，不留孤儿临时文件
	tmpPath := indexPath + ".tmp"
	if err := os.WriteFile(tmpPath, data, fsutil.FilePerms); err != nil {
		_ = os.Remove(tmpPath)
		return "", fmt.Errorf("写入 index.json.tmp 失败: %w", err)
	}
	if err := os.Rename(tmpPath, indexPath); err != nil {
		_ = os.Remove(tmpPath)
		return "", fmt.Errorf("原子替换 index.json 失败: %w", err)
	}

	workflowDir := filepath.Join(repoPath, ".github", "workflows")
	if err := os.MkdirAll(workflowDir, fsutil.DirPerms); err != nil {
		// index.json 已成功生成，workflow 属附带能力：失败留痕不阻断（排障盲区补齐）
		emitScanError("[scanner] 创建 workflow 目录失败 %s: %v", workflowDir, err)
	} else {
		workflowPath := filepath.Join(workflowDir, "generate-index.yml")
		if _, err := os.Stat(workflowPath); os.IsNotExist(err) {
			if err := os.WriteFile(workflowPath, []byte(generateIndexWorkflow), fsutil.FilePerms); err != nil {
				// 与同文件 151/208/223 行纪律一致：写入失败留痕（静默失败会让
				// CI 自动重生成 index 静默失效，用户无感知）
				emitScanError("[scanner] 写入 workflow %s 失败: %v", workflowPath, err)
			}
		}
	}
	return indexPath, nil
}

const generateIndexWorkflow = `name: Generate index.json
on:
  push:
    branches: [main]
    paths:
      - "**.ysm"
      - "**.zip"
      - "**.7z"
  workflow_dispatch:
permissions:
  contents: write
jobs:
  generate-index:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: 生成 index.json
        run: |
          cat > genindex.go << 'GOEOF'
          package main
          import (
            "crypto/sha256" "encoding/json" "fmt" "io" "os" "path/filepath" "strings"
          )
          type entry struct {
            Name string ` + "`json:\"name\"`" + `
            Path string ` + "`json:\"path\"`" + `
            Size int64  ` + "`json:\"size\"`" + `
            Hash string ` + "`json:\"hash,omitempty\"`" + `
          }
          func main() {
            var list []entry
            filepath.WalkDir(".", func(p string, d os.DirEntry, err error) error {
              if err != nil || d.IsDir() { return nil }
              // 扩展名口径与 Go 侧 scanner.ScanEntries 对齐（含 .ban/.disabled 恢复、
              // .json 仅收 ysm.json）；扩展清单与 go/types 注册表（resource_types.json）同步
              lower := strings.ToLower(p)
              restored := ""
              if strings.HasSuffix(lower, ".ban") { restored = types.StripBanSuffix(p) } else if strings.HasSuffix(lower, ".disabled") { restored = p[:len(p)-9] }
              ext := strings.ToLower(filepath.Ext(p))
              if restored != "" { ext = strings.ToLower(filepath.Ext(restored)) }
              if ext == ".json" {
                base := strings.ToLower(filepath.Base(restored))
                base = strings.TrimSuffix(base, ".ban")
                base = strings.TrimSuffix(base, ".disabled")
                if base != "ysm.json" { return nil }
              }
              if ext != ".ysm" && ext != ".zip" && ext != ".7z" && ext != ".nbt" && ext != ".schematic" && ext != ".litematic" { return nil }
              if strings.Contains(p, "/.github") { return nil }
              rel, _ := filepath.Rel(".", p)
              rel = filepath.ToSlash(rel)
              fi, _ := d.Info()
              size := int64(0)
              if fi != nil { size = fi.Size() }
              hashStr := ""
              if f, err := os.Open(p); err == nil {
                h := sha256.New(); io.Copy(h, f); hashStr = fmt.Sprintf("%x", h.Sum(nil)); f.Close()
              }
              list = append(list, entry{Name: d.Name(), Path: rel, Size: size, Hash: hashStr})
              return nil
            })
            data, _ := json.MarshalIndent(list, "", "  ")
            os.WriteFile("index.json", data, 0644)
          }
          GOEOF
          go run genindex.go
          rm genindex.go
      - name: 提交更新
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add index.json
          if git diff --cached --quiet; then
            echo "index.json 无变化，跳过提交"
          else
            git commit -m ":arrows_counterclockwise: 自动更新 index.json"
            git push
          fi
`
