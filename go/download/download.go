// Package download 纯下载逻辑，不依赖 Wails runtime。
package download

import (
	"context"
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

// fileLocks 按目标路径互斥，防止并发（DownloadFromGitHub 与队列）下载同一 savePath
// 时交错截断；配合临时文件 + rename 保证最终文件来自单次完整下载。
// 锁条目常驻不删除：条目数 = 下载过的目标路径数（仓库内文件集合，有自然上限），
// 删除会引入 Unlock→Delete 竞态窗口——等待者持旧锁与新锁并发下载同一路径，互斥承诺失效。
var fileLocks sync.Map

// ProgressFn 下载进度回调。downloaded / total 为字节数。
type ProgressFn func(downloaded, total int64)

// Downloader 文件下载器。
type Downloader struct {
	client  *http.Client
	timeout time.Duration
}

// New 创建 Downloader，默认 5 分钟超时。
func New() *Downloader {
	return &Downloader{timeout: defaultTimeout}
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

// downloadTo 下载到 savePath，支持 Accept 头与进度回调；失败/中断时清理半截临时文件
func (d *Downloader) downloadTo(ctx context.Context, url, savePath, accept string, onProgress ProgressFn) error {
	// P2-2：URL scheme 校验——仅允许 http/https，拒绝 file/ftp 等本地读取源
	u, err := neturl.Parse(url)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") {
		return fmt.Errorf("不支持的 URL scheme: %q（仅支持 http/https）", url)
	}

	// P2-1：同目标路径互斥，防并发下载同一 savePath 交错截断
	mu, _ := fileLocks.LoadOrStore(savePath, &sync.Mutex{})
	m := mu.(*sync.Mutex)
	m.Lock()
	defer m.Unlock()

	if err := os.MkdirAll(filepath.Dir(savePath), 0755); err != nil {
		return err
	}

	client := d.httpClient()
	// P2-2：浅拷贝挂重定向约束，防 https 被 302 到内网 http（SSRF）
	c := *client
	c.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if req.URL.Scheme != "https" && req.URL.Scheme != "http" {
			return fmt.Errorf("禁止重定向到非 http(s): %s", req.URL)
		}
		if len(via) >= 10 {
			return fmt.Errorf("重定向次数过多")
		}
		return nil
	}
	client = &c
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	if accept != "" {
		req.Header.Set("Accept", accept)
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	// BUG-HTTP-2 修复：Content-Range 头存在 = 服务端返回的是 partial 响应（206 或 200+Range 变体），
	// 即使 StatusCode=200 也属数据不完整——不能装盘。
	// 服务端可能用 200 OK + Content-Range 头伪装完整响应（SSRF 中间人场景），此处强制拒绝。
	if cr := resp.Header.Get("Content-Range"); cr != "" {
		return fmt.Errorf("拒绝 partial 响应 Content-Range: %q", cr)
	}
	// BUG-HTTP-5 修复：二进制文件下载时校验 Content-Type，避免服务端返回 HTML 错误页当文件装盘。
	// HTML/text/JSON 错误页常见于反向代理 502/503 或 GitHub 404 页面。
	if ct := resp.Header.Get("Content-Type"); ct != "" && !isBinaryContentType(ct) {
		return fmt.Errorf("拒绝非二进制响应 Content-Type: %q", ct)
	}

	// P1：原子写入——同目录临时文件 + Sync/Close/Rename，失败清理与崩溃残留只影响
	// 临时文件，不再触碰最终路径上的旧完好文件
	tmp, err := os.CreateTemp(filepath.Dir(savePath), filepath.Base(savePath)+".part-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	ok := false
	defer func() {
		if !ok {
			// 下载中断/失败时清理半截临时文件，避免残留损坏文件被扫描/预览
			if err := os.Remove(tmpName); err != nil {
				// 删除失败（权限/占用）时记录日志，避免半截文件残留无痕迹
				log.Printf("[download] 清理半截临时文件失败 %s: %v", tmpName, err)
			}
			tmp.Close()
		}
	}()

	total := resp.ContentLength
	var downloaded int64
	buf := make([]byte, readBufferSize)
	lastEmit := time.Now()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		n, rErr := resp.Body.Read(buf)
		if n > 0 {
			if _, wErr := tmp.Write(buf[:n]); wErr != nil {
				return wErr
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
			return rErr
		}
	}
	// 截断检测——服务端声明 Content-Length 但提前断流（EOF）
	// 时，半截文件不得被当作完整文件装盘（ADR-033 截断静默反模式同类）
	if total > 0 && downloaded < total {
		return fmt.Errorf("下载截断: 期望 %d 字节, 实际 %d 字节", total, downloaded)
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
	return d.downloadTo(ctx, url, savePath, "", onProgress)
}

// FromGitHubAPI 从 GitHub API 下载（设置 Accept 头）。ctx 取消/超时即中断下载。
func (d *Downloader) FromGitHubAPI(ctx context.Context, apiURL, savePath string, onProgress ProgressFn) error {
	return d.downloadTo(ctx, apiURL, savePath, "application/vnd.github.v3.raw", onProgress)
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
	relPath = strings.TrimPrefix(relPath, ".recycle"+string(filepath.Separator))
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
