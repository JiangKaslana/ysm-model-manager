//go:build !android

// 边界/攻击面探察：ResolveSavePath 的畸形输入。
// 只读源码 (go/download/download.go)，发现问题用 t.Log 标记，不修改源码。
package download

import (
	"strings"
	"testing"
	"unicode"
)

// 辅助：构造超长路径字符串
func strN(s string, n int) string {
	var b strings.Builder
	for i := 0; i < n; i++ {
		b.WriteString(s)
	}
	return b.String()
}

// ---------- 1. URL 带 query string ----------
func TestResolveSavePath_QueryString(t *testing.T) {
	url := "https://raw.githubusercontent.com/user/repo/main/file.ysm?token=abc123&x=1"
	savePath, jsd, api := ResolveSavePath(url, t.TempDir())
	if savePath == "" {
		t.Fatal("expected non-empty savePath")
	}
	// FIXED(BUG-1): query string 必须被剥离
	if strings.Contains(savePath, "?") {
		t.Fatalf("query string 未被剥离，savePath 含 '?': %s", savePath)
	}
	if strings.Contains(jsd, "?") || strings.Contains(api, "?") {
		t.Fatalf("jsdURL/apiURL 保留了 query 字符: %s / %s", jsd, api)
	}
	t.Logf("FIXED(BUG-1): query stripped OK: savePath=%q", savePath)
}

// ---------- 2. URL 带 fragment ----------
func TestResolveSavePath_Fragment(t *testing.T) {
	url := "https://raw.githubusercontent.com/user/repo/main/file.ysm#section-2"
	savePath, _, _ := ResolveSavePath(url, t.TempDir())
	if savePath == "" {
		t.Fatal("expected non-empty savePath")
	}
	// FIXED(BUG-2): fragment '#' 必须被剥离
	if strings.Contains(savePath, "#") {
		t.Fatalf("fragment '#' 未被剥离，savePath 含 '#': %s", savePath)
	}
	t.Logf("FIXED(BUG-2): fragment stripped OK: savePath=%q", savePath)
}

// ---------- 3. URL 无 main/master 分支 ----------
func TestResolveSavePath_NoMainMaster(t *testing.T) {
	url := "https://raw.githubusercontent.com/user/repo/release/1.0/file.ysm"
	savePath, jsd, api := ResolveSavePath(url, t.TempDir())
	if savePath == "" {
		t.Fatal("expected non-empty savePath")
	}
	if !strings.HasSuffix(savePath, "file.ysm") && !strings.HasSuffix(savePath, "1.0/file.ysm") {
		t.Fatalf("unexpected savePath: %s", savePath)
	}
	// 无分支时，jsd/api 构造失败 —— 当前行为就是空
	if jsd != "" || api != "" {
		t.Log("INFO(3): 无分支 URL 意外得到 jsd/api URL，可能绕过默认分支策略", jsd, api)
	} else {
		t.Log("INFO(3): 无 main/master 分支的 URL 只能拿到 savePath，jsd/api 为空（当前行为），无法回退下载")
	}
}

// ---------- 4. 非 raw.githubusercontent.com 来源 ----------
func TestResolveSavePath_NonGitHub(t *testing.T) {
	url := "https://cdn.example.com/path/to/file.ysm"
	savePath, jsd, api := ResolveSavePath(url, t.TempDir())
	if savePath == "" {
		t.Fatal("expected non-empty savePath")
	}
	if !strings.HasSuffix(savePath, "file.ysm") {
		t.Fatalf("unexpected savePath: %s", savePath)
	}
	if jsd != "" || api != "" {
		t.Log("INFO(4): 非 GitHub 来源意外得到 jsd/api URL", jsd, api)
	} else {
		t.Log("INFO(4): 非 GitHub 来源，jsd/api 为空（当前行为），无回退源")
	}
}

// ---------- 5. URL 含 %2f 混合编码的伪穿越 ----------
func TestResolveSavePath_PctEncodedTraversal(t *testing.T) {
	// neturl.Parse 会解码 %2f → /，filepath.Clean 随后解析 .. 上溯目录，
	// prefix 检查拦截越界——跨平台一致。
	url := "https://raw.githubusercontent.com/user/repo/main/a/..%2f..%2fetc/passwd"
	savePath, _, _ := ResolveSavePath(url, t.TempDir())
	if savePath != "" {
		t.Fatalf("FIXED(跨平台): %%2f 编码穿越应被拒绝，实际 savePath=%q", savePath)
	}
	t.Log("FIXED(跨平台): 编码穿越被 neturl.Parse+prefix 检查拦截")
}

// ---------- 6. URL 含 NUL 字节 (%00) ----------
func TestResolveSavePath_NUL(t *testing.T) {
	// 跨平台差异：Windows filepath.Abs 遇 NUL 报错（攻击失效）；
	// Linux/macOS filepath.Abs 放行，但 os.Create("file.ysm\x00.exe") 创建的是 "file.ysm"
	// （C 字符串以 NUL 截断），攻击者剥离任意后缀绕过前端扩展名校验。
	// ResolveSavePath 主动剔除 NUL，跨平台一致拒绝。
	url := "https://raw.githubusercontent.com/user/repo/main/file.ysm%00.exe"
	savePath, _, _ := ResolveSavePath(url, t.TempDir())
	if savePath != "" {
		t.Fatalf("FIXED(BUG-6, 跨平台): NUL 字节 URL 应返回空，实际 savePath=%q", savePath)
	}
	t.Log("FIXED(BUG-6, 跨平台): NUL 注入被拒绝（跨平台一致行为）")
}

// ---------- 7. Unicode 同形字符 (Cyrillic 'і' 代替 'i') ----------
func TestResolveSavePath_UnicodeLookalike(t *testing.T) {
	// 使用 Cyrillic 小写 i (U+0456) —— 与 ASCII 'i' 视觉相同
	url := "https://raw.githubusercontent.com/user/repo/main/f\u0456le.ysm"
	savePath, _, _ := ResolveSavePath(url, t.TempDir())
	if savePath == "" {
		t.Fatal("expected non-empty savePath")
	}
	t.Logf("INFO(7): savePath 含同形 Unicode 字符: %q", savePath)
	// 验证 savePath 中是否含有非 ASCII 字符
	for _, r := range savePath {
		if r > unicode.MaxASCII {
			t.Log("TODO(BUG-7): savePath 包含非 ASCII 同形字符，可能绕过前端/文件系统过滤:", savePath)
			break
		}
	}
}

// ---------- 8. URL 路径含 .git 目录 ----------
func TestResolveSavePath_GitDotdir(t *testing.T) {
	url := "https://raw.githubusercontent.com/user/repo/main/.git/config"
	savePath, _, _ := ResolveSavePath(url, t.TempDir())
	if savePath == "" {
		t.Fatal("expected non-empty savePath for .git/config")
	}
	// FIXED(BUG-8): .git/ 前缀必须被剔除，不能下载仓库配置
	if strings.Contains(savePath, ".git") {
		t.Fatalf("FIXED(BUG-8): .git/ 子路径未被 strip，保存路径含 .git: %s", savePath)
	}
	t.Logf("FIXED(BUG-8): .git/ stripped OK: savePath=%q", savePath)
}

// ---------- 9. URL 含 %00 + 路径穿越组合 ----------
func TestResolveSavePath_Pct00Traversal(t *testing.T) {
	url := "https://raw.githubusercontent.com/user/repo/main/../../etc/%00passwd"
	savePath, _, _ := ResolveSavePath(url, t.TempDir())
	if savePath == "" {
		t.Log("INFO(9): %00 + 穿越返回空")
		return
	}
	t.Logf("INFO(9): savePath=%q", savePath)
}

// ---------- 10. 超长 URL (>>32k) ----------
func TestResolveSavePath_SuperLong(t *testing.T) {
	// 32000+ 字符的 path 片段，逼近/超过 Windows MAX_PATH
	longSegment := strN("a/", 4000) // 8000 chars
	url := "https://raw.githubusercontent.com/user/repo/main/" + longSegment + "file.ysm"
	t.Logf("INFO(10): URL len=%d", len(url))
	savePath, _, _ := ResolveSavePath(url, t.TempDir())
	if savePath != "" {
		t.Logf("INFO(10): 超长 URL 成功返回 savePath len=%d（可能超过 MAX_PATH 但 Windows 接受 UTF-8 转义路径）", len(savePath))
	} else {
		t.Log("INFO(10): 超长 URL 返回空（可能被 filepath.Abs 拒绝）")
	}
}

// ---------- 11. 连续多斜杠 ----------
func TestResolveSavePath_MultipleSlashes(t *testing.T) {
	url := "https://raw.githubusercontent.com/user/repo/main///a//b///file.ysm"
	savePath, _, _ := ResolveSavePath(url, t.TempDir())
	if savePath == "" {
		t.Fatal("expected non-empty savePath")
	}
	// 检查是否被 Clean 归一化
	if strings.Contains(savePath, "//") {
		t.Log("TODO(BUG-11): 连续多斜杠未被归一化", savePath)
		return
	}
	t.Logf("INFO(11): Clean 归一化 OK: %q", savePath)
}

// ---------- 12. saveDir 越界 ----------
func TestResolveSavePath_SaveDirOutside(t *testing.T) {
	// saveDir 本身越界到 /tmp/outside 时，savePath 自然落在该目录下，prefix 检查会通过
	saveDir := t.TempDir()
	// 用正常 URL + 正常 saveDir 验证边界：saveDir 与 savePath 严格前缀匹配
	url := "https://raw.githubusercontent.com/user/repo/main/a.ysm"
	savePath, _, _ := ResolveSavePath(url, saveDir)
	if savePath == "" {
		t.Fatal("expected non-empty savePath")
	}
	if savePath == saveDir {
		t.Fatal("savePath must not equal saveDir (only possible when relPath empty)")
	}
	t.Logf("INFO(12): prefix 检查允许 savePath 在 saveDir 内: %q", savePath)
}

// ---------- 13. 边界：main 出现在 query 中 ----------
func TestResolveSavePath_MainInQuery(t *testing.T) {
	// "/main/" 出现在 query string 而非 path —— 不应被当作分支标记
	url := "https://raw.githubusercontent.com/user/repo/stable/file.ysm?/main/x"
	savePath, jsd, api := ResolveSavePath(url, t.TempDir())
	if savePath == "" {
		t.Fatal("expected non-empty savePath")
	}
	// FIXED(BUG-13): query 中的 "/main/" 不能被误判为分支
	if jsd != "" && strings.Contains(jsd, "@main/") {
		t.Fatalf("FIXED(BUG-13): query 中的 '/main/' 被误当作分支，jsdURL 异常: %s", jsd)
	}
	if api != "" && strings.Contains(api, "main") {
		t.Fatalf("FIXED(BUG-13): query 中的 '/main/' 被误当作分支，apiURL 异常: %s", api)
	}
	// relPath 必须来自 URL path（file.ysm），不含 query
	if strings.Contains(savePath, "/main/") || strings.Contains(savePath, "/main") {
		t.Fatalf("relPath 含 query 片段: %s", savePath)
	}
	t.Logf("FIXED(BUG-13): query 中 '/main/' 未误判分支: savePath=%q", savePath)
}
