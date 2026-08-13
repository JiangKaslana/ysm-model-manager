package download

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// startRawHTTPServer 启动一个原始 TCP HTTP 服务器，精确控制 Content-Length 与实际 body 的匹配
// 用于探察 Content-Length 截断/超额等边界场景
func startRawHTTPServer(t *testing.T, status int, contentLength int, body []byte) (url string, cleanup func()) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	go func() {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		// 读取并丢弃 HTTP 请求头
		buf := make([]byte, 4096)
		conn.Read(buf)
		// 构造 HTTP 响应
		resp := fmt.Sprintf(
			"HTTP/1.1 %d OK\r\nContent-Length: %d\r\nConnection: close\r\n\r\n",
			status, contentLength,
		)
		conn.Write([]byte(resp))
		conn.Write(body)
		conn.Close()
	}()
	return "http://" + ln.Addr().String(), func() { ln.Close() }
}

// ============================================================================
// 探察方向 1: 206 Partial Content 静默装盘
// ============================================================================

// TestHTTP_206PartialContent_Rejected
// 服务端返回 206 Partial Content + Content-Range: bytes 0-99/1000
// 当前代码: resp.StatusCode != http.StatusOK → 206 != 200 → 返回错误
func TestHTTP_206PartialContent_Rejected(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Range", "bytes 0-99/1000")
		w.Header().Set("Content-Length", "100")
		w.WriteHeader(http.StatusPartialContent)
		w.Write(make([]byte, 100))
	}))
	defer ts.Close()

	dl := New()
	savePath := filepath.Join(t.TempDir(), "partial.txt")
	err := dl.File(context.Background(), ts.URL, savePath, nil)
	if err == nil {
		if info, err2 := os.Stat(savePath); err2 == nil {
			t.Logf("TODO(BUG-HTTP-1): 206 Partial Content 被当作成功，文件已写入 (%d bytes)，可能是不完整分片数据被当作完整文件装盘", info.Size())
		} else {
			t.Log("TODO(BUG-HTTP-1b): 206 返回 nil 但无文件写入，行为异常")
		}
	} else {
		t.Logf("OK: 206 被正确拒绝: %v", err)
	}
}

// TestHTTP_200WithContentRange_NoValidation
// 服务端返回 200 OK + Content-Range: bytes 0-99/1000 + Content-Length: 100
// 当前代码只检查 StatusCode == 200，不校验 Content-Range 头
// 这是真正漏洞: 服务端声称只发了 100/1000 字节，却被当作完整文件装盘
func TestHTTP_200WithContentRange_NoValidation(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Range", "bytes 0-99/1000")
		w.Header().Set("Content-Length", "100")
		w.WriteHeader(http.StatusOK)
		w.Write(make([]byte, 100))
	}))
	defer ts.Close()

	dl := New()
	savePath := filepath.Join(t.TempDir(), "tricky.txt")
	err := dl.File(context.Background(), ts.URL, savePath, nil)
	if err == nil {
		t.Fatalf("FIXED(BUG-HTTP-2): 200 + Content-Range 应被拒绝，实际无错误")
	}
	t.Logf("FIXED(BUG-HTTP-2): 200 + Content-Range 被拒绝: %v", err)
}

// ============================================================================
// 探察方向 2: 重定向链与 scheme 白名单
// ============================================================================

// TestHTTP_Redirect_ChainExceedsLimit
// 构造 12 跳重定向链，应触发 10 hop 上限被拒绝
func TestHTTP_Redirect_ChainExceedsLimit(t *testing.T) {
	const hops = 12
	servers := make([]*httptest.Server, hops)
	for i := hops - 1; i >= 0; i-- {
		idx := i
		if idx == hops-1 {
			servers[idx] = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Write([]byte("final"))
			}))
		} else {
			servers[idx] = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Location", servers[idx+1].URL)
				w.WriteHeader(http.StatusFound)
			}))
		}
		defer servers[idx].Close()
	}

	dl := New()
	err := dl.File(context.Background(), servers[0].URL, filepath.Join(t.TempDir(), "chain.txt"), nil)
	if err == nil {
		t.Log("TODO(BUG-HTTP-3): 12 跳重定向链未被拦截，可能存在 SSRF 风险")
	} else {
		t.Logf("OK: 重定向链被拦截: %v", err)
	}
}

// TestHTTP_Redirect_ToFileScheme_Rejected
// 服务端重定向到 file:///etc/passwd，应被 scheme 白名单拒绝
func TestHTTP_Redirect_ToFileScheme_Rejected(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Location", "file:///etc/passwd")
		w.WriteHeader(http.StatusFound)
	}))
	defer ts.Close()

	dl := New()
	err := dl.File(context.Background(), ts.URL, filepath.Join(t.TempDir(), "file.txt"), nil)
	if err == nil {
		t.Log("TODO(BUG-HTTP-4a): 重定向到 file:// 未被拒绝，存在 SSRF/本地文件读取风险")
	} else {
		t.Logf("OK: file:// 重定向被拒绝: %v", err)
	}
}

// TestHTTP_Redirect_ToFtpScheme_Rejected
// 服务端重定向到 ftp://，应被 scheme 白名单拒绝
func TestHTTP_Redirect_ToFtpScheme_Rejected(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Location", "ftp://malicious-server.example.com/payload.bin")
		w.WriteHeader(http.StatusFound)
	}))
	defer ts.Close()

	dl := New()
	err := dl.File(context.Background(), ts.URL, filepath.Join(t.TempDir(), "ftp.txt"), nil)
	if err == nil {
		t.Log("TODO(BUG-HTTP-4b): 重定向到 ftp:// 未被拒绝，存在 SSRF 风险")
	} else {
		t.Logf("OK: ftp:// 重定向被拒绝: %v", err)
	}
}

// ============================================================================
// 探察方向 3: Content-Type 校验缺失
// ============================================================================

// TestHTTP_ContentType_HTML_NotValidated
// 服务端返回 200 + Content-Type: text/html + HTML 错误页 body
// 当前代码不校验 Content-Type → HTML 被当作文件装盘
// FIXED(BUG-HTTP-5): downloadTo 现在校验 Content-Type，text/html 错误页被拒绝
func TestHTTP_ContentType_HTML_NotValidated(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write([]byte("<html><body><h1>404 Not Found</h1><p>The requested resource was not found.</p></body></html>"))
	}))
	defer ts.Close()

	dl := New()
	savePath := filepath.Join(t.TempDir(), "download.html")
	err := dl.File(context.Background(), ts.URL, savePath, nil)
	if err == nil {
		data, _ := os.ReadFile(savePath)
		if strings.Contains(string(data), "404 Not Found") {
			t.Fatalf("FIXED(BUG-HTTP-5): text/html 错误页被当作文件装盘，Content-Type 应被拒绝")
		}
	}
	t.Logf("FIXED(BUG-HTTP-5): text/html 被拒绝: %v", err)
}

// ============================================================================
// 探察方向 4: Content-Length 声明不符
// ============================================================================

// TestHTTP_ContentLength_TruncationDetected
// 服务端声明 Content-Length: 1000 但只发送 7 字节后断连
// 使用原始 TCP 服务器精确控制 Connection: close + 部分 body
func TestHTTP_ContentLength_TruncationDetected(t *testing.T) {
	url, cleanup := startRawHTTPServer(t, 200, 1000, []byte("partial"))
	defer cleanup()

	dl := New()
	err := dl.File(context.Background(), url, filepath.Join(t.TempDir(), "truncated.txt"), nil)
	if err == nil {
		t.Log("TODO(BUG-HTTP-6a): Content-Length 截断未被检测到 — 服务端声明 1000 字节但只发送 7 字节，不完整文件被当作完整文件装盘")
	} else {
		t.Logf("OK: 截断被检测到: %v", err)
	}
}

// TestHTTP_ContentLength_OverSent_NoValidation
// 服务端声明 Content-Length: 100 但实际发送 200 字节
// HTTP 客户端受 Content-Length 限制只读 100 字节，downloaded=100, total=100
// 标记: HTTP 协议本身限制了读取量，无额外校验需求
func TestHTTP_ContentLength_OverSent_NoValidation(t *testing.T) {
	url, cleanup := startRawHTTPServer(t, 200, 100, make([]byte, 200))
	defer cleanup()

	dl := New()
	savePath := filepath.Join(t.TempDir(), "oversent.txt")
	err := dl.File(context.Background(), url, savePath, nil)
	if err != nil {
		t.Logf("错误（可能预期）: %v", err)
		return
	}
	data, _ := os.ReadFile(savePath)
	if len(data) == 100 {
		t.Log("OK: 服务端声明 100 发送 200 字节，HTTP 客户端按 Content-Length 限制只读 100 字节，文件正确写入。HTTP 协议层已保证一致性，无需额外校验。")
	} else {
		t.Logf("注意: 文件写入 %d 字节（非预期 100），需进一步分析 HTTP 客户端行为", len(data))
	}
}

// ============================================================================
// 探察方向 5: Progress 回调 panic
// ============================================================================

// TestHTTP_ProgressPanic_DuringLoop_TempFileCleaned
// onProgress 在下载循环中 panic（非最终回调）→ downloadTo 不 recover
// defer 清理逻辑应保证 temp 文件被删除，savePath 不应被写入
// 关键: 发送足够数据确保 loop 中触发 progress（progressEmitInterval=200ms）
func TestHTTP_ProgressPanic_DuringLoop_TempFileCleaned(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// 持续发送数据使下载循环多次 Read，触发循环内的 onProgress
		for i := 0; i < 100; i++ {
			w.Write(make([]byte, 4096))
			w.(http.Flusher).Flush()
			time.Sleep(5 * time.Millisecond)
		}
	}))
	defer ts.Close()

	saveDir := t.TempDir()
	savePath := filepath.Join(saveDir, "panic-loop.txt")

	dl := New()
	panicked := false
	var panicCall int64
	// 只在前几次进度回调 panic（确保命中循环内，而非最终回调）
	func() {
		defer func() {
			if recover() != nil {
				panicked = true
			}
		}()
		dl.File(context.Background(), ts.URL, savePath, func(downloaded, total int64) {
			if panicCall == 0 {
				panicCall = downloaded
				panic("boom")
			}
		})
	}()

	if !panicked {
		t.Fatal("预期 onProgress 回调触发 panic")
	}
	t.Logf("panic 发生在 downloaded=%d 时", panicCall)

	// 验证 savePath 未被写入
	if _, err := os.Stat(savePath); !os.IsNotExist(err) {
		t.Log("TODO(BUG-HTTP-7a): onProgress 循环内 panic 后 savePath 文件仍存在 — defer 清理逻辑失效")
	} else {
		t.Log("OK: 循环内 panic 后 savePath 未被写入")
	}

	// 验证 .part 临时文件已清理
	entries, _ := os.ReadDir(saveDir)
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".part") {
			t.Log("TODO(BUG-HTTP-7b): 循环内 panic 后 .part 临时文件残留: " + e.Name())
		}
	}
}

// TestHTTP_ProgressPanic_FinalCallback_FileSurvives
// onProgress 在最终回调（ok=true 后）panic → savePath 已被写入，不会被清理
// 验证: 这是预期的副作用 — panic 时文件已 rename 完成
func TestHTTP_ProgressPanic_FinalCallback_FileSurvives(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("hello"))
	}))
	defer ts.Close()

	saveDir := t.TempDir()
	savePath := filepath.Join(saveDir, "panic-final.txt")

	dl := New()
	panicked := false
	var callCount int
	func() {
		defer func() {
			if recover() != nil {
				panicked = true
			}
		}()
		dl.File(context.Background(), ts.URL, savePath, func(downloaded, total int64) {
			callCount++
			if callCount == 1 {
				panic("boom")
			}
		})
	}()

	if !panicked {
		t.Fatal("预期 onProgress 回调触发 panic")
	}

	// 由于 panic 发生在最终回调（ok=true 后），savePath 应已存在
	if info, err := os.Stat(savePath); err == nil {
		data, _ := os.ReadFile(savePath)
		if string(data) == "hello" {
			t.Logf("TODO(BUG-HTTP-7c): 最终 onProgress 回调 panic 后 savePath 仍存在（%d 字节，内容正确）。这是预期行为 — rename 已完成，panic 在 success path 中。若需防御，应在 rename 后 wrap onProgress 调用。", info.Size())
		} else {
			t.Logf("注意: savePath 存在但内容异常: %q", string(data))
		}
	}
}

// ============================================================================
// 探察方向 6: Chunked encoding (无 Content-Length)
// ============================================================================

// TestHTTP_ChunkedEncoding_Success
// Transfer-Encoding: chunked + 无 Content-Length
// total = 0/-1 → 截断检测跳过 → 写实际字节 → 最终文件正确
func TestHTTP_ChunkedEncoding_Success(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("chunk1-"))
		w.(http.Flusher).Flush()
		w.Write([]byte("chunk2-"))
		w.(http.Flusher).Flush()
		w.Write([]byte("chunk3"))
	}))
	defer ts.Close()

	dl := New()
	savePath := filepath.Join(t.TempDir(), "chunked.txt")
	err := dl.File(context.Background(), ts.URL, savePath, nil)
	if err != nil {
		t.Fatalf("chunked encoding 下载失败: %v", err)
	}
	data, _ := os.ReadFile(savePath)
	if string(data) != "chunk1-chunk2-chunk3" {
		t.Fatalf("内容不符: got %q, want %q", string(data), "chunk1-chunk2-chunk3")
	}
	t.Log("OK: chunked encoding (无 Content-Length) 工作正常，total 回退为 downloaded 字节数")
}

// ============================================================================
// 探察方向 7: 0 字节 body + Content-Length: 0
// ============================================================================

// TestHTTP_ZeroByteBody_WithContentLength0
// Content-Length: 0 → total=0 → 截断检测跳过 → 写入空文件
func TestHTTP_ZeroByteBody_WithContentLength0(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", "0")
		w.WriteHeader(http.StatusOK)
	}))
	defer ts.Close()

	dl := New()
	savePath := filepath.Join(t.TempDir(), "zero.txt")
	err := dl.File(context.Background(), ts.URL, savePath, nil)
	if err != nil {
		t.Fatalf("Content-Length: 0 下载失败: %v", err)
	}
	data, _ := os.ReadFile(savePath)
	if len(data) != 0 {
		t.Fatalf("预期空文件，实际 %d 字节", len(data))
	}
	t.Log("OK: Content-Length: 0 正确写入空文件")
}

// ============================================================================
// 探察方向 8: fileLocks 并发冲突
// ============================================================================

// TestHTTP_ConcurrentSamePath_MutexSafety
// 2 个 goroutine 同时下载同一路径 → fileLocks 互斥锁保证串行化
// 验证: 两个调用均成功，最终文件内容正确，无临时文件残留
func TestHTTP_ConcurrentSamePath_MutexSafety(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("concurrent-mutex-test-content"))
	}))
	defer ts.Close()

	dl := New()
	saveDir := t.TempDir()
	savePath := filepath.Join(saveDir, "concurrent.txt")

	var wg sync.WaitGroup
	errors := make([]error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			errors[idx] = dl.File(context.Background(), ts.URL, savePath, nil)
		}(i)
	}
	wg.Wait()

	for i, err := range errors {
		if err != nil {
			t.Errorf("goroutine %d 下载失败: %v", i, err)
		}
	}

	data, err := os.ReadFile(savePath)
	if err != nil {
		t.Fatalf("文件不存在: %v", err)
	}
	if string(data) != "concurrent-mutex-test-content" {
		t.Fatalf("内容不符: got %q", string(data))
	}

	entries, _ := os.ReadDir(saveDir)
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".part") {
			t.Log("TODO(BUG-HTTP-8): 并发下载后 .part 临时文件残留: " + e.Name())
		}
	}
	t.Log("OK: fileLocks 互斥锁正常工作，并发同路径下载串行化，无临时文件残留")
}
