// Package download 纯下载逻辑，不依赖 Wails runtime。
package download

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	neturl "net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"ysm-model-manager/go/types"
)

// 下载参数常量
const (
	// readBufferSize 读取缓冲区大小（256KB）
	readBufferSize = 256 << 10
	// progressEmitInterval 进度上报节流间隔（200ms）
	progressEmitInterval = 200 * time.Millisecond
	// defaultTimeout 默认下载超时（5分钟）
	defaultTimeout = 300 * time.Second
)

// configFunc 运行阈值配置注入（ADR-062：薄壳 internal/app 传入 AppConfig；
// nil 或字段 0 时回退包级默认常量，行为零漂移）
var configFunc func() types.AppConfig

// SetConfigFunc 注入运行阈值配置源（ADR-062：薄壳 internal/app 启动时调用）
func SetConfigFunc(fn func() types.AppConfig) {
	configFunc = fn
}

// downloadTimeout 下载超时：AppConfig.DownloadTimeoutSec > 0 用之，否则默认 300s
func downloadTimeout() time.Duration {
	if configFunc != nil {
		if sec := configFunc().DownloadTimeoutSec; sec > 0 {
			return time.Duration(sec) * time.Second
		}
	}
	return defaultTimeout
}

// fileLocks 按目标路径互斥，防止并发（DownloadFromGitHub 与队列）下载同一 savePath
// 时交错截断；配合临时文件 + rename 保证最终文件来自单次完整下载。
// 锁条目常驻不删除：条目数 = 下载过的目标路径数（仓库内文件集合，有自然上限），
// 删除会引入 Unlock→Delete 竞态窗口——等待者持旧锁与新锁并发下载同一路径，互斥承诺失效。
var fileLocks sync.Map

// ============================================================================
// #11 错误分类——sentinel + 类型化错误，替代脆弱的英文子串 contains 匹配。
// 调用方应使用 errors.Is(err, ErrTruncated) / errors.As(err, &httpErr) 分类，
// 不要靠 strings.Contains(err.Error(), "truncated") 这种跨平台/跨版本失效的文本匹配。
// ============================================================================

// 下载错误类别——调用方用 errors.Is 判断，避免依赖错误消息文本（#11 文本匹配反模式）。
var (
	// ErrUnsupportedScheme URL scheme 非 http/https。
	ErrUnsupportedScheme = errors.New("不支持的 URL scheme")
	// ErrRedirectChainTooLong 重定向链超过 10 跳。
	ErrRedirectChainTooLong = errors.New("重定向次数过多")
	// ErrRedirectToUnsafeScheme 重定向到非 http(s) scheme（file/ftp 等，SSRF 风险）。
	ErrRedirectToUnsafeScheme = errors.New("禁止重定向到非 http(s)")
	// ErrPartialResponse 服务端返回 partial 响应（Content-Range 头存在），数据不完整。
	ErrPartialResponse = errors.New("拒绝 partial 响应")
	// ErrNonBinaryContentType 服务端返回 HTML/text 错误页（非二进制 Content-Type）。
	ErrNonBinaryContentType = errors.New("拒绝非二进制响应 Content-Type")
	// ErrTruncated 下载截断——服务端声明 Content-Length 但实际字节数不足（#11 截断静默反模式）。
	ErrTruncated = errors.New("下载截断")
	// ErrChecksumMismatch 下载内容 SHA256 与期望值不符（P2 预留：可选校验，
	// 调用方通过 FileWithChecksum / FromGitHubAPIWithChecksum 传入，不传即跳过，行为零漂移）。
	ErrChecksumMismatch = errors.New("校验和不匹配")
)

// HTTPStatusError 携带 HTTP 状态码的类型化错误，调用方用 errors.As 提取码值，
// 替代 strings.Contains(err.Error(), "404") 等脆弱匹配。
type HTTPStatusError struct {
	Code int
}

func (e *HTTPStatusError) Error() string { return fmt.Sprintf("HTTP %d", e.Code) }

// TruncationError 携带期望/实际字节数的截断错误，调用方用 errors.As 提取数值做诊断上报。
type TruncationError struct {
	Expected int64
	Actual   int64
}

func (e *TruncationError) Error() string {
	return fmt.Sprintf("%s: 期望 %d 字节, 实际 %d 字节", ErrTruncated, e.Expected, e.Actual)
}

// Unwrap 让 errors.Is(err, ErrTruncated) 成立——调用方既可判断类别（errors.Is），
// 又可提取数值（errors.As），无需文本匹配（#11 错误分类）。
func (e *TruncationError) Unwrap() error { return ErrTruncated }

// ProgressFn 下载进度回调。downloaded / total 为字节数。
type ProgressFn func(downloaded, total int64)

// Downloader 文件下载器。
type Downloader struct {
	client  *http.Client
	timeout time.Duration
}

// New 创建 Downloader，默认 5 分钟超时（可被 AppConfig.DownloadTimeoutSec 覆盖，ADR-062）。
func New() *Downloader {
	return &Downloader{timeout: downloadTimeout()}
}

// NewWithClient 使用指定 HTTP client。
func NewWithClient(client *http.Client) *Downloader {
	return &Downloader{client: client}
}

func (d *Downloader) httpClient() *http.Client {
	if d.client != nil {
		return d.client
	}
	return &http.Client{Timeout: d.timeout}
}

// downloadTo 下载到 savePath，支持 Accept 头与进度回调；失败/中断时清理半截临时文件。
// expectedSHA256 非空时校验下载内容 SHA256 一致才装盘（P2 预留）；为空则跳过校验，
// 行为零漂移。
// 错误分类用 sentinel（ErrTruncated 等）+ 类型化（HTTPStatusError / TruncationError），
// 调用方用 errors.Is / errors.As 判断类别，不要靠英文子串 contains 匹配（#11 反模式）。
func (d *Downloader) downloadTo(ctx context.Context, url, savePath, accept string, onProgress ProgressFn, expectedSHA256 []byte) error {
	// P2-2：URL scheme 校验——仅允许 http/https，拒绝 file/ftp 等本地读取源
	u, err := neturl.Parse(url)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") {
		return fmt.Errorf("%w: %q（仅支持 http/https）", ErrUnsupportedScheme, url)
	}

	// P2-1：同目标路径互斥，防并发下载同一 savePath 交错截断
	mu, _ := fileLocks.LoadOrStore(savePath, &sync.Mutex{})
	m := mu.(*sync.Mutex)
	m.Lock()
	defer m.Unlock()

	if err := os.MkdirAll(filepath.Dir(savePath), 0755); err != nil {
		return fmt.Errorf("创建目录失败 %s: %w", filepath.Dir(savePath), err)
	}

	client := d.httpClient()
	// P2-2：浅拷贝挂重定向约束，防 https 被 302 到内网 http（SSRF）
	c := *client
	c.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if req.URL.Scheme != "https" && req.URL.Scheme != "http" {
			return fmt.Errorf("%w: %s", ErrRedirectToUnsafeScheme, req.URL)
		}
		if len(via) >= 10 {
			return ErrRedirectChainTooLong
		}
		return nil
	}
	client = &c
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("构造请求失败 %s: %w", url, err)
	}
	if accept != "" {
		req.Header.Set("Accept", accept)
	}
	resp, err := client.Do(req)
	if err != nil {
		// 区分 ctx 取消与网络错误，供调用方分类（#11 错误分类）
		if ctxErr := ctx.Err(); ctxErr != nil {
			return fmt.Errorf("下载被取消 %s: %w", url, ctxErr)
		}
		return fmt.Errorf("请求失败 %s: %w", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return &HTTPStatusError{Code: resp.StatusCode}
	}
	// BUG-HTTP-2 修复：Content-Range 头存在 = 服务端返回的是 partial 响应（206 或 200+Range 变体），
	// 即使 StatusCode=200 也属数据不完整——不能装盘。
	// 服务端可能用 200 OK + Content-Range 头伪装完整响应（SSRF 中间人场景），此处强制拒绝。
	if cr := resp.Header.Get("Content-Range"); cr != "" {
		return fmt.Errorf("%w: Content-Range: %q", ErrPartialResponse, cr)
	}
	// BUG-HTTP-5 修复：二进制文件下载时校验 Content-Type，避免服务端返回 HTML 错误页当文件装盘。
	// HTML/text/JSON 错误页常见于反向代理 502/503 或 GitHub 404 页面。
	if ct := resp.Header.Get("Content-Type"); ct != "" && !isBinaryContentType(ct) {
		return fmt.Errorf("%w: %q", ErrNonBinaryContentType, ct)
	}

	// P1：原子写入——同目录临时文件 + Sync/Close/Rename，失败清理与崩溃残留只影响
	// 临时文件，不再触碰最终路径上的旧完好文件
	tmp, err := os.CreateTemp(filepath.Dir(savePath), filepath.Base(savePath)+".part-*")
	if err != nil {
		return fmt.Errorf("创建临时文件失败: %w", err)
	}
	tmpName := tmp.Name()
	ok := false
	defer func() {
		if !ok {
			// 下载中断/失败时清理半截临时文件，避免残留损坏文件被扫描/预览。
			// 必须先 Close 再 Remove：Windows 无法删除仍被打开的句柄（POSIX 可 unlink
			// 已打开文件）——原顺序 Remove→Close 在 Windows 上必然失败，残留 .part 文件。
			// Close 对已关闭文件返回 error 但无害（成功路径 ok=true 短路本分支，不重复 Close）。
			tmp.Close()
			if err := os.Remove(tmpName); err != nil {
				// 删除失败（权限/占用）时记录日志，避免半截文件残留无痕迹
				log.Printf("[download] 清理半截临时文件失败 %s: %v", tmpName, err)
			}
		}
	}()

	total := resp.ContentLength
	// contentLengthKnown 标记服务端是否声明了 Content-Length。
	// 声明了就必须严格校验；未声明（chunked / HTTP/1.0）时只能信任 io.EOF 语义。
	contentLengthKnown := total >= 0
	var downloaded int64
	buf := make([]byte, readBufferSize)
	lastEmit := time.Now()

	for {
		select {
		case <-ctx.Done():
			return fmt.Errorf("下载被取消: %w", ctx.Err())
		default:
		}
		n, rErr := resp.Body.Read(buf)
		if n > 0 {
			if _, wErr := tmp.Write(buf[:n]); wErr != nil {
				return fmt.Errorf("写入临时文件失败 %s: %w", tmpName, wErr)
			}
			downloaded += int64(n)
			if onProgress != nil && time.Since(lastEmit) > progressEmitInterval {
				onProgress(downloaded, total)
				lastEmit = time.Now()
			}
		}
		if rErr == io.EOF {
			break
		}
		if rErr != nil {
			// 区分 ctx 取消与底层 IO 错误（#11 错误分类）
			if ctxErr := ctx.Err(); ctxErr != nil {
				return fmt.Errorf("下载被取消: %w", ctxErr)
			}
			return fmt.Errorf("读取响应体失败 %s: %w", url, rErr)
		}
	}
	// 截断检测——服务端声明 Content-Length 但提前断流（EOF）
	// 时，半截文件不得被当作完整文件装盘（ADR-033 截断静默反模式同类）。
	// 返回 TruncationError 携带期望/实际字节数，调用方用 errors.As 提取做诊断（#11 错误分类）。
	if contentLengthKnown {
		if downloaded < total {
			return &TruncationError{Expected: total, Actual: downloaded}
		}
		if downloaded > total {
			// 服务端发了比声明更多的字节——异常，拒绝装盘
			return &TruncationError{Expected: total, Actual: downloaded}
		}
	}
	// P2 预留：可选 checksum 校验——下载内容 SHA256 与期望值一致才装盘。
	// expectedSHA256 为空跳过（行为零漂移）；不匹配返回 ErrChecksumMismatch，
	// temp 由外层 defer 清理，最终路径旧文件不受影响（原子性保持）。
	if len(expectedSHA256) > 0 {
		if _, err := tmp.Seek(0, io.SeekStart); err != nil {
			return fmt.Errorf("定位临时文件失败: %w", err)
		}
		h := sha256.New()
		if _, err := io.Copy(h, tmp); err != nil {
			return fmt.Errorf("计算 SHA256 失败: %w", err)
		}
		if actual := h.Sum(nil); !bytes.Equal(actual, expectedSHA256) {
			return fmt.Errorf("%w: 期望 %x, 实际 %x", ErrChecksumMismatch, expectedSHA256, actual)
		}
	}
	if total <= 0 {
		total = downloaded
	}
	// P1：成功路径——Sync 确保落盘，Close 检查错误，再原子 Rename 覆盖旧文件
	if err := tmp.Sync(); err != nil {
		return fmt.Errorf("同步下载文件失败 %s: %w", tmpName, err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("关闭下载文件失败 %s: %w", savePath, err)
	}
	if err := os.Rename(tmpName, savePath); err != nil {
		return fmt.Errorf("移动临时文件失败 %s -> %s: %w", tmpName, savePath, err)
	}
	ok = true
	if onProgress != nil {
		onProgress(downloaded, total)
	}
	return nil
}

// File 从 URL 下载文件到 savePath，支持进度回调。ctx 取消/超时即中断下载。
func (d *Downloader) File(ctx context.Context, url, savePath string, onProgress ProgressFn) error {
	return d.downloadTo(ctx, url, savePath, "", onProgress, nil)
}

// FileWithChecksum 与 File 相同，额外校验下载内容 SHA256 与期望值一致。
// expectedSHA256 为空（nil/零长）时跳过校验，行为与 File 完全一致（P2 预留）。
func (d *Downloader) FileWithChecksum(ctx context.Context, url, savePath string, onProgress ProgressFn, expectedSHA256 []byte) error {
	return d.downloadTo(ctx, url, savePath, "", onProgress, expectedSHA256)
}

// FromGitHubAPI 从 GitHub API 下载（设置 Accept 头）。ctx 取消/超时即中断下载。
func (d *Downloader) FromGitHubAPI(ctx context.Context, apiURL, savePath string, onProgress ProgressFn) error {
	return d.downloadTo(ctx, apiURL, savePath, "application/vnd.github.v3.raw", onProgress, nil)
}

// FromGitHubAPIWithChecksum 与 FromGitHubAPI 相同，额外校验 SHA256（P2 预留，语义同 FileWithChecksum）。
func (d *Downloader) FromGitHubAPIWithChecksum(ctx context.Context, apiURL, savePath string, onProgress ProgressFn, expectedSHA256 []byte) error {
	return d.downloadTo(ctx, apiURL, savePath, "application/vnd.github.v3.raw", onProgress, expectedSHA256)
}

// isBinaryContentType 判断 Content-Type 是否非"HTML 错误页"。
// 真实风险：服务端 502/503/404 返回 `text/html` 错误页被当文件装盘。
// 策略：仅明确拒绝 HTML 类型，其余全部放行——避免误伤文本文件（.json / .ysm 配置等）与未知类型。
// 空 Content-Type（HTTP/1.0 常见）放行。
func isBinaryContentType(ct string) bool {
	if ct == "" {
		return true
	}
	ct = strings.ToLower(strings.TrimSpace(strings.SplitN(ct, ";", 2)[0]))
	// 仅拒绝 HTML/XHTML 错误页——这是唯一会伪装成"完整响应"的危险文本类型
	nonFileTypes := map[string]bool{
		"text/html":             true,
		"application/xhtml+xml": true,
		"application/xml":       true, // 纯 XML 错误页常见于反向代理
		"text/xml":              true,
	}
	return !nonFileTypes[ct]
}

// ResolveSavePath 从 GitHub raw URL 解析存储路径和回退源。
func ResolveSavePath(rawURL, saveDir string) (savePath string, jsdURL, apiURL string) {
	if err := os.MkdirAll(saveDir, 0755); err != nil {
		log.Printf("[download] 创建保存目录失败 %s: %v", saveDir, err)
		return "", "", ""
	}
	// BUG-B-1/2/13 修复：用 neturl.Parse 分离 path/query/fragment，
	// 分支标记（/main/ /master/）只在 URL path 段查找，避免 query 中的 "/main/" 误识别为分支；
	// 提取的 relPath 不携带 query/fragment，避免 savePath/jsdURL/apiURL 污染。
	u, err := neturl.Parse(rawURL)
	if err != nil {
		log.Printf("[download] URL 解析失败 %s: %v", rawURL, err)
		return "", "", ""
	}
	urlPath := u.Path
	if urlPath == "" {
		urlPath = rawURL // 降级：无法解析时使用原始 URL
	}

	relPath := ""
	repoPath := ""
	branch := ""
	// 支持 main 与 master 默认分支（默认分支非 main 的仓库不再解析失败）
	for _, b := range []string{"/main/", "/master/"} {
		if idx := strings.Index(urlPath, b); idx > 0 {
			relPath = urlPath[idx+len(b):]
			branch = b[1 : len(b)-1]
			break
		}
	}
	if relPath != "" && strings.HasPrefix(rawURL, "https://raw.githubusercontent.com/") {
		parts := strings.SplitN(rawURL[len("https://raw.githubusercontent.com/"):], "/", 3)
		if len(parts) >= 2 {
			repoPath = parts[0] + "/" + parts[1]
		}
	}
	if relPath == "" {
		relPath = filepath.Base(u.Path)
		if relPath == "" {
			relPath = filepath.Base(rawURL)
		}
	}
	relPath = strings.ReplaceAll(relPath, "/", string(filepath.Separator))
	// BUG-B-8 修复：剔除 .git/ 前缀，防止下载 .git/config 泄露仓库 token/远端配置。
	relPath = strings.TrimPrefix(relPath, ".git"+string(filepath.Separator))
	// #8 回收站目录隔离：剔除 relPath 中所有名为 .recycle 的目录段（大小写不敏感，
	// 对齐 fsutil.IsRecycleDir 的 EqualFold 口径——dedup/scanner/sync 把任意层级的 .recycle
	// 视为回收站）。若下载落到 saveDir 下任意 .recycle 子树：扫描器会跳过该文件（不可见）、
	// 回收站 Empty() 会 RemoveAll 整目录（下载文件被静默清除），Windows 大小写不敏感下
	// .Recycle/.RECYCLE 亦指向同一目录。逐段剔除保证下载不落入任何回收站目录。
	relPath = stripRecycleSegments(relPath)
	if relPath == "" {
		log.Printf("[download] 拒绝空路径（URL 路径仅含 .recycle/.git 段）: %s", rawURL)
		return "", "", ""
	}
	// NUL 字节跨平台差异修复——Windows filepath.Abs 遇到 NUL 直接报错（攻击失效），
	// Linux/macOS filepath.Abs 放行，但 os.Create("file.ysm\x00.exe") 实际创建的是 "file.ysm"
	// （C 字符串以 NUL 截断，后缀被剥离），攻击者可绕过前端扩展名校验。
	// 主动剔除，跨平台一致行为。
	if strings.Contains(relPath, "\x00") {
		log.Printf("[download] 拒绝含 NUL 字节的路径: %s", rawURL)
		return "", "", ""
	}
	savePath = filepath.Join(saveDir, relPath)

	// 路径遍历防护——确保 savePath 经 Clean 后仍在 saveDir 下
	savePath = filepath.Clean(savePath)
	absSaveDir, err := filepath.Abs(saveDir)
	if err != nil {
		log.Printf("[download] saveDir 路径异常 %s: %v", saveDir, err)
		return "", "", ""
	}
	absSavePath, err := filepath.Abs(savePath)
	if err != nil {
		log.Printf("[download] savePath 路径异常 %s: %v", savePath, err)
		return "", "", ""
	}
	if !strings.HasPrefix(absSavePath, absSaveDir+string(filepath.Separator)) && absSavePath != absSaveDir {
		log.Printf("[download] 拒绝路径越界: %s (期望在 %s 内)", absSavePath, absSaveDir)
		return "", "", ""
	}

	if repoPath != "" {
		normalized := strings.ReplaceAll(relPath, "\\", "/")
		if branch == "" {
			branch = "main"
		}
		jsdURL = "https://cdn.jsdelivr.net/gh/" + repoPath + "@" + branch + "/" + normalized
		apiURL = "https://api.github.com/repos/" + repoPath + "/contents/" + normalized
	}
	return
}

// stripRecycleSegments 移除 relPath 中所有名为 .recycle 的目录段（大小写不敏感，
// 与 fsutil.IsRecycleDir 的 EqualFold 语义一致）。返回空串时由调用方拒绝该 URL
// （见 ResolveSavePath 的 relPath=="" 守卫），不会落盘到回收站目录。
func stripRecycleSegments(relPath string) string {
	sep := string(filepath.Separator)
	segs := strings.Split(relPath, sep)
	out := make([]string, 0, len(segs))
	for _, seg := range segs {
		if strings.EqualFold(seg, ".recycle") {
			continue
		}
		out = append(out, seg)
	}
	return strings.Join(out, sep)
}
