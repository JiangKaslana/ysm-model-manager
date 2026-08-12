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
	// 下载完成即移除锁条目，防无界增长；Unlock 必须在 Delete 之前（同一 defer 内保证顺序）
	defer func() { m.Unlock(); fileLocks.Delete(savePath) }()

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

// ResolveSavePath 从 GitHub raw URL 解析存储路径和回退源。
func ResolveSavePath(rawURL, saveDir string) (savePath string, jsdURL, apiURL string) {
	if err := os.MkdirAll(saveDir, 0755); err != nil {
		log.Printf("[download] 创建保存目录失败 %s: %v", saveDir, err)
		return "", "", ""
	}
	relPath := ""
	repoPath := ""
	branch := ""
	// 支持 main 与 master 默认分支（默认分支非 main 的仓库不再解析失败）
	for _, b := range []string{"/main/", "/master/"} {
		if idx := strings.Index(rawURL, b); idx > 0 {
			relPath = rawURL[idx+len(b):]
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
		relPath = filepath.Base(rawURL)
	}
	relPath = strings.ReplaceAll(relPath, "/", string(filepath.Separator))
	relPath = strings.TrimPrefix(relPath, ".recycle"+string(filepath.Separator))
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
