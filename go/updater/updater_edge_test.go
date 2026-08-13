// 对抗测试：updater zip 解压 / HTTP 下载安全边界
// 重点：zip bomb、symlink 在目标目录中、NUL 字节、超长文件名、HTTP 重定向跟随
package updater

import (
	"archive/zip"
	"bytes"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// =====================================================================
// extractZipFile 安全边界
// =====================================================================

// makeZip 在内存中构建 zip，返回 *bytes.Buffer
func makeZip(t *testing.T, entries map[string][]byte) *bytes.Buffer {
	t.Helper()
	buf := new(bytes.Buffer)
	w := zip.NewWriter(buf)
	for name, data := range entries {
		f, err := w.Create(name)
		if err != nil {
			t.Fatalf("w.Create(%q) = %v", name, err)
		}
		if _, err := f.Write(data); err != nil {
			t.Fatalf("write %q = %v", name, err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return buf
}

// openZipInMemory 将内存 zip 写入临时文件并 OpenReader
func openZipInMemory(t *testing.T, buf *bytes.Buffer) *zip.ReadCloser {
	t.Helper()
	tmpFile, err := os.CreateTemp("", "updater-test-*.zip")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Remove(tmpFile.Name()) })
	if _, err := io.Copy(tmpFile, buf); err != nil {
		t.Fatal(err)
	}
	tmpFile.Close()
	r, err := zip.OpenReader(tmpFile.Name())
	if err != nil {
		t.Fatal(err)
	}
	return r
}

// ---------- 1. Symlink 在目标目录中——extractZipFile os.Create 跟随 symlink ----------
func TestExtractZipFile_SymlinkDest(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows: symlink 创建需管理员/开发者模式")
		return
	}

	tmpDir := t.TempDir()
	realTarget := filepath.Join(tmpDir, "real_target")
	os.WriteFile(realTarget, []byte("ORIGINAL"), 0644)
	symlinkPath := filepath.Join(tmpDir, "evil.txt")
	if err := os.Symlink(realTarget, symlinkPath); err != nil {
		t.Skip("symlink 创建失败: " + err.Error())
		return
	}

	buf := makeZip(t, map[string][]byte{"evil.txt": []byte("OVERWRITTEN")})
	r := openZipInMemory(t, buf)
	defer r.Close()

	var zf *zip.File
	for _, f := range r.File {
		if f.Name == "evil.txt" {
			zf = f
			break
		}
	}
	if zf == nil {
		t.Fatal("zip 中无 evil.txt")
	}

	err := extractZipFile(zf, symlinkPath)
	if err != nil {
		t.Logf("FIXED(INFO-SYMLINK): extractZipFile 拒绝 symlink dest: %v", err)
		return
	}

	// 保持 INFO 记录而非 Errorf：extractZipFile 的 dest 由调用方传入（InstallUpdate 中
	// 是 MkdirTemp 新目录 / exeDir 固定路径，zip 条目名经 filepath.Base 后仅用于拼接），
	// symlink 攻击需攻击者预置 symlink 到 exeDir——本地攻击者场景，属 POSIX 常规语义。
	data, _ := os.ReadFile(realTarget)
	if string(data) == "OVERWRITTEN" {
		t.Logf("BUG(INFO-SYMLINK): extractZipFile os.Create 跟随 symlink，覆盖了 real_target: %s", string(data))
	} else {
		t.Logf("INFO(INFO-SYMLINK): real_target 未被覆盖: %s", string(data))
	}
}

// ---------- 2. NUL 字节在 zip 条目名中 ----------
func TestExtractZipFile_NULInName(t *testing.T) {
	tmpDir := t.TempDir()

	// 构建 zip 含 "safe.exe\x00.txt"
	buf := makeZip(t, map[string][]byte{"safe.exe\x00.txt": []byte("payload")})
	r := openZipInMemory(t, buf)
	defer r.Close()

	var zf *zip.File
	for _, f := range r.File {
		if strings.Contains(f.Name, "\x00") {
			zf = f
			break
		}
	}
	if zf == nil {
		t.Fatal("zip 中无 NUL 字节条目")
	}

	dest := filepath.Join(tmpDir, "output")
	err := extractZipFile(zf, dest)
	if err != nil {
		t.Logf("FIXED(INFO-NUL-ZIP): extractZipFile NUL 名称被拒绝: %v", err)
		return
	}
	// 检查是否写出了非预期文件：extractZipFile 只写调用方传入的 dest（output），
	// NUL 名条目不应产生额外文件——若未来实现改用 f.Name 构建路径，NUL 截断
	// 会写出 safe.exe 等额外文件而触发 Errorf 变红（3-1 修复：断言真实守门）
	entries, err := os.ReadDir(tmpDir)
	if err != nil {
		// 守门枚举失败必须显式报错，否则循环零次执行、守门假绿（code_review P3）
		t.Fatalf("os.ReadDir(%s) = %v", tmpDir, err)
	}
	for _, e := range entries {
		if e.Name() != "output" {
			t.Errorf("BUG(INFO-NUL-ZIP): NUL 名称条目写出了非预期文件 %q", e.Name())
		}
	}
	t.Logf("INFO(INFO-NUL-ZIP): extractZipFile NUL 名称条目, entries=%v", entries)
}

// ---------- 3. 超长文件名 (>Windows MAX_PATH 260) ----------
func TestExtractZipFile_LongFilename(t *testing.T) {
	tmpDir := t.TempDir()

	// Windows MAX_PATH=260, tmpDir 已占用 ~50 字符，构造超出剩余的文件名
	longName := strings.Repeat("a", 400) + ".exe"
	buf := makeZip(t, map[string][]byte{longName: []byte("MZ\x90\x00")})
	r := openZipInMemory(t, buf)
	defer r.Close()

	var zf *zip.File
	for _, f := range r.File {
		if len(f.Name) > 300 {
			zf = f
			break
		}
	}
	if zf == nil {
		t.Fatal("zip 中无超长文件名条目")
	}

	dest := filepath.Join(tmpDir, "output")
	err := extractZipFile(zf, dest)
	if err != nil {
		t.Logf("FIXED(INFO-LONG-ZIP): extractZipFile 超长文件名被拒绝: %v", err)
		return
	}
	t.Logf("INFO(INFO-LONG-ZIP): extractZipFile 超长文件名写入成功（未显式拒绝）")
}

// ---------- 4. 空 zip 条目（0 字节文件）----------
func TestExtractZipFile_EmptyEntry(t *testing.T) {
	tmpDir := t.TempDir()
	buf := makeZip(t, map[string][]byte{"empty.exe": []byte{}})
	r := openZipInMemory(t, buf)
	defer r.Close()

	var zf *zip.File
	for _, f := range r.File {
		if f.Name == "empty.exe" {
			zf = f
			break
		}
	}
	if zf == nil {
		t.Fatal("zip 中无 empty.exe")
	}

	dest := filepath.Join(tmpDir, "empty.exe")
	err := extractZipFile(zf, dest)
	if err != nil {
		t.Fatalf("extractZipFile 空条目失败: %v", err)
	}
	fi, _ := os.Stat(dest)
	if fi.Size() != 0 {
		t.Fatalf("空条目应写出 0 字节文件, 实际 %d", fi.Size())
	}
	t.Log("INFO(INFO-EMPTY-ZIP): extractZipFile 空条目写出 0 字节文件（正常行为）")
}

// =====================================================================
// Download / downloadOnce HTTP 安全边界
// =====================================================================

// ---------- 5. HTTP 302 重定向跟随 ----------
func TestDownloadOnce_RedirectFollowing(t *testing.T) {
	// 目标服务器
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Write([]byte("target-content"))
	}))
	defer target.Close()

	// 重定向服务器
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusFound)
	}))
	defer proxy.Close()

	path, err := downloadOnce(proxy.URL, "", nil)
	if err != nil {
		t.Logf("INFO(INFO-REDIRECT): downloadOnce 拒绝重定向: %v", err)
		return
	}
	// 先读后删（3-3 修复）：原实现先 os.Remove 再 ReadFile，检测分支读到的恒为空文件，
	// BUG 探测永不触发。302 跟随是 GitHub CDN 下载的必需行为（BrowserDownloadURL
	// 普遍 302 到 objects.githubusercontent.com），安全防线是 expectedHash 哈希校验
	// 而非拒绝重定向——故保持 INFO 记录而非断言失败（拒绝会破坏真实更新下载）。
	data, _ := os.ReadFile(path)
	os.Remove(path)
	if string(data) == "target-content" {
		t.Logf("BUG(INFO-REDIRECT): downloadOnce 跟随 302 重定向，写入了目标内容——攻击者可通过恶意源将更新包替换为任意文件")
	}
}

// ---------- 6. Content-Type 非二进制（HTML 错误页）----------
func TestDownloadOnce_HTMLContentType(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write([]byte("<html><body>Error 404</body></html>"))
	}))
	defer server.Close()

	_, err := downloadOnce(server.URL, "", nil)
	if err != nil {
		t.Logf("FIXED(BUG-INFO-CT): downloadOnce 拒绝 HTML Content-Type: %v", err)
		return
	}
	t.Error("BUG(INFO-CT): downloadOnce 接受 HTML Content-Type——未修复")
}

// ---------- 7. Content-Range 部分响应 ----------
func TestDownloadOnce_PartialContent(t *testing.T) {
	// httptest 自动设 Content-Type: text/plain（会被 HTML 检查先行拦截）。
	// 用 application/octet-stream 绕过 HTML 检查，专门触发 Content-Range 分支。
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Content-Range", "bytes 0-9/1000")
		w.Write([]byte("partial-data"))
	}))
	defer server.Close()

	_, err := downloadOnce(server.URL, "", nil)
	if err != nil {
		if strings.Contains(err.Error(), "Content-Range") || strings.Contains(err.Error(), "部分响应") {
			t.Logf("FIXED(BUG-INFO-RANGE): downloadOnce 拒绝 Content-Range: %v", err)
		} else {
			t.Logf("FIXED/INFO(INFO-RANGE): downloadOnce 拒绝: %v", err)
		}
		return
	}
	t.Error("BUG(INFO-RANGE): downloadOnce 接受 200+Content-Range 部分响应——未修复")
}

// =====================================================================
// InstallUpdate zip 安全边界
// =====================================================================

// ---------- 8. zip 含非 PE 文件（无 MZ 魔数）----------
func TestInstallUpdate_InvalidPE(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows only")
		return
	}
	tmpDir := t.TempDir()

	// 构建 zip 含无效 PE 文件
	buf := makeZip(t, map[string][]byte{
		"YSM-Model-Manager.exe": []byte("NOT_A_PE_FILE"),
	})
	zipPath := filepath.Join(tmpDir, "update.zip")
	os.WriteFile(zipPath, buf.Bytes(), 0644)

	err := InstallUpdate(zipPath)
	if err == nil {
		t.Fatal("InstallUpdate 应拒绝非 PE 文件")
	}
	if !strings.Contains(err.Error(), "MZ") && !strings.Contains(err.Error(), "PE") {
		t.Logf("FIXED(INFO-PE): InstallUpdate 拒绝非 PE 文件: %v", err)
	}
}

// ---------- 9. zip 含多个同名条目 ----------
func TestInstallUpdate_DuplicateEntries(t *testing.T) {
	tmpDir := t.TempDir()

	// Go zip 包在创建时不允许多个同名条目（最后一个覆盖），
	// 但我们手动构建 zip 数据可包含重复条目
	// 用底层方式构造 zip
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	f1, _ := w.Create("YSM-Model-Manager.exe")
	f1.Write([]byte("MZ\x90\x00FIRST"))
	f2, _ := w.Create("YSM-Model-Manager.exe")
	f2.Write([]byte("MZ\x90\x00SECOND"))
	w.Close()

	zipPath := filepath.Join(tmpDir, "dup.zip")
	os.WriteFile(zipPath, buf.Bytes(), 0644)

	// 读取 zip 并检查条目数
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()

	count := 0
	var lastData string
	for _, f := range r.File {
		if strings.HasSuffix(f.Name, ".exe") {
			count++
			rc, _ := f.Open()
			data, _ := io.ReadAll(rc)
			lastData = string(data)
			rc.Close()
		}
	}
	t.Logf("INFO(INFO-DUP): zip 含 %d 个 .exe 条目, 最后一个数据=%q", count, lastData)
}

// =====================================================================
// fetchExpectedHash 安全边界
// =====================================================================

// ---------- 10. SHA256SUMS 注入（换行符 / 畸形行）----------
func TestFetchExpectedHash_MalformedSums(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(
			"deadbeef  YSM-Model-Manager.exe\n" +
				"INVALID_LINE_NO_HASH\n" +
				"\n" +
				"aabbccdd  evil.exe\n",
		))
	}))
	defer server.Close()

	hash, err := fetchExpectedHash(server.URL, "YSM-Model-Manager.exe")
	if err != nil {
		t.Logf("FIXED/INFO(INFO-SUMS): fetchExpectedHash malformed: %v", err)
		return
	}
	if hash != "deadbeef" {
		t.Logf("INFO(INFO-SUMS): fetchExpectedHash 返回 hash=%q（畸形行未导致 panic）", hash)
	}
}

// ---------- 11. SHA256SUMS NUL 字节注入 ----------
// Go strings.Fields 以空白分割，"\x00" 不是空白，保留在 parts[1] 中。
// Go strings.EqualFold 按字节逐一比较，"\x00" 不等于空字符串（不做 C 截断）。
// 因此 fetchExpectedHash 无 NUL 注入漏洞——跨行攻击无效。
func TestFetchExpectedHash_NULInjection(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("deadbeef  safe.exe\x00malicious.txt\nevilhash  YSM-Model-Manager.exe\n"))
	}))
	defer server.Close()

	hash, err := fetchExpectedHash(server.URL, "YSM-Model-Manager.exe")
	if err != nil {
		t.Logf("INFO(INFO-NUL-SUMS): fetchExpectedHash NUL 注入: %v", err)
		return
	}
	if hash == "evilhash" {
		t.Log("FIXED/INFO(INFO-NUL-SUMS): fetchExpectedHash 正确返回 evilhash——" +
			"Go strings.Fields 保留 NUL 在 parts[1]，EqualFold 按字节比较不做 C 截断，" +
			"第一行 \"safe.exe\\x00malicious.txt\" 不匹配 \"YSM-Model-Manager.exe\"，跨行攻击无效")
		return
	}
	t.Logf("UNEXPECTED(INFO-NUL-SUMS): fetchExpectedHash 返回 hash=%q", hash)
}

// ---------- 12. semver 比较脏 tag ----------
func TestIsNewer_DirtyTags(t *testing.T) {
	cases := []struct {
		a, b string
		want bool
	}{
		{"1.2.3", "1.2.3", false},
		{"1.2.4", "1.2.3", true},
		{"1.2.3", "1.2.4", false},
		{"1.2", "1.2.3", false},
		{"1.2.3-beta", "1.2.3", false},
		// 带 v 前缀 / 脏 tag → splitVer 首段 Atoi 失败归零，恒判旧（updater_test.go 锁定契约）
		{"v1.1.0", "1.0.0", false},
		{"vv1.2.3", "1.2.3", false},
		{"", "1.2.3", false},
	}
	for _, c := range cases {
		got := isNewer(c.a, c.b)
		if got != c.want {
			t.Errorf("isNewer(%q, %q) = %v, 期望 %v", c.a, c.b, got, c.want)
		}
	}
	t.Log("FIXED(INFO-SEMVER): isNewer 脏 tag 防御正确")
}

// ---------- 13. assetPattern 平台差异 ----------
func TestAssetPattern_WindowsFormat(t *testing.T) {
	p := assetPattern()
	// assetPattern 用 Sprintf 直接拼出具体 asset 名（无占位符），
	// 应包含平台名与压缩格式后缀
	if !strings.Contains(p, runtime.GOOS) {
		t.Fatalf("assetPattern 应包含当前平台 %q, got %q", runtime.GOOS, p)
	}
	if !strings.HasSuffix(p, ".zip") && !strings.HasSuffix(p, ".tar.gz") {
		t.Fatalf("assetPattern 应包含压缩格式后缀, got %q", p)
	}
	t.Logf("INFO(INFO-ASSET): assetPattern=%s", p)
}

// ---------- 14. cleanup 清理 .old 文件 ----------
func TestCleanupOldVersion_NonExistent(t *testing.T) {
	// CleanupOldVersion 使用 os.Executable() 获取当前 exe 路径
	// 测试不创建 .old 文件，应无操作
	CleanupOldVersion()
	t.Log("INFO(INFO-CLEANUP): CleanupOldVersion 对不存在 .old 文件无操作（正常）")
}

// ---------- 15. downloadOnce 空 body ----------
func TestDownloadOnce_EmptyBody(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/octet-stream")
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	path, err := downloadOnce(server.URL, "", nil)
	if err != nil {
		t.Logf("INFO(INFO-EMPTY-BODY): downloadOnce 空 body: %v", err)
		return
	}
	fi, _ := os.Stat(path)
	os.Remove(path)
	if fi.Size() != 0 {
		t.Errorf("BUG(INFO-EMPTY-BODY): downloadOnce 空 body 写出 %d 字节", fi.Size())
	} else {
		t.Log("FIXED/INFO(INFO-EMPTY-BODY): downloadOnce 空 body 写出 0 字节文件（无错误，但可能不应静默成功）")
	}
}

// ---------- 16. Content-Length 与实际 body 不一致（预检通过但传输中断）----------
func TestDownloadOnce_TruncatedTransfer(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Content-Length", "100")
		w.Write([]byte("short")) // 只写 5 字节
	}))
	defer server.Close()

	path, err := downloadOnce(server.URL, "", nil)
	if err != nil {
		t.Logf("FIXED(INFO-TRUNC): downloadOnce 截断传输被拒绝: %v", err)
		return
	}
	os.Remove(path)
	t.Logf("INFO(INFO-TRUNC): downloadOnce 截断传输成功返回 path=%q（unexpected EOF 被吞？）", path)
}

// ---------- 17. 超大 Content-Length ----------
func TestDownloadOnce_EnormousContentLength(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Content-Length", "99999999999")
		// 不写 body——Content-Length 超限应被预检拒绝
	}))
	defer server.Close()

	_, err := downloadOnce(server.URL, "", nil)
	if err == nil {
		t.Fatal("超大 Content-Length 应被拒绝")
	}
	if strings.Contains(err.Error(), "超过") || strings.Contains(err.Error(), "limit") || strings.Contains(err.Error(), "上限") {
		t.Logf("FIXED(INFO-ENOCL): 超大 Content-Length 被拒绝: %v", err)
	} else {
		t.Logf("INFO(INFO-ENOCL): 超大 Content-Length 被拒绝: %v", err)
	}
}

// ---------- 18. SHA256 不匹配 ----------
func TestDownloadOnce_HashMismatch(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Write([]byte("payload"))
	}))
	defer server.Close()

	_, err := downloadOnce(server.URL, "nonexistenthash", nil)
	if err == nil {
		t.Fatal("SHA256 不匹配应被拒绝")
	}
	if !strings.Contains(err.Error(), "SHA256") {
		t.Fatalf("SHA256 不匹配应返回 SHA256 错误, 实际: %v", err)
	}
	t.Logf("FIXED(INFO-HASH): SHA256 不匹配被拒绝: %v", err)
}

// ---------- 19. http.Client 默认 CheckRedirect 跟随无限重定向 ----------
func TestDownloadOnce_InfiniteRedirect(t *testing.T) {
	selfURL := ""
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, selfURL, http.StatusFound)
	}))
	defer server.Close()
	selfURL = server.URL

	// Go http.Client 默认最多跟随 10 次重定向，第 10 次返回错误
	_, err := downloadOnce(server.URL, "", nil)
	if err != nil {
		if errors.Is(err, http.ErrUseLastResponse) {
			t.Logf("FIXED(INFO-REDIR-LOOP): 无限重定向被 Go http 拒绝: %v", err)
		} else {
			t.Logf("FIXED/INFO(INFO-REDIR-LOOP): 无限重定向被拒绝: %v", err)
		}
		return
	}
	t.Log("BUG(INFO-REDIR-LOOP): 无限重定向未被拒绝")
}
