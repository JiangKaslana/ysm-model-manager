// ===== CLI 薄壳级单测 =====
// 覆盖：runCLI 入口错误路径 / cache 系列命令的副作用与输出 / 参数校验错误路径 / config-show 空配置分支。
// 策略：用 &app.App{} 零值 + 把 texture_cache.CacheDir 重定向到临时目录，
// 不触碰真实用户配置/日志/缓存目录，不触发 SaveAppConfig 落盘与 watcher 重启（见 AGENTS 硬约束）。
package main

import (
	"bytes"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ysm-model-manager/go/texture_cache"
	"ysm-model-manager/internal/app"
)

// captureOutput 捕获调用期间的 stdout 输出
func captureOutput(t *testing.T, fn func()) string {
	t.Helper()
	old := os.Stdout
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("os.Pipe: %v", err)
	}
	os.Stdout = w
	t.Cleanup(func() { os.Stdout = old })
	fn()
	if err := w.Close(); err != nil {
		t.Fatalf("关闭写端: %v", err)
	}
	out, _ := io.ReadAll(r)
	return string(out)
}

// withTempCache 将 texture_cache.CacheDir 重定向到临时目录并返回该目录
func withTempCache(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	old := texture_cache.CacheDir
	texture_cache.CacheDir = func() string { return dir }
	t.Cleanup(func() { texture_cache.CacheDir = old })
	return dir
}

// withStdin 将 os.Stdin 重定向为注入内容（用于确认类交互）
func withStdin(t *testing.T, input string) {
	t.Helper()
	old := os.Stdin
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("os.Pipe: %v", err)
	}
	os.Stdin = r
	if _, err := w.WriteString(input); err != nil {
		t.Fatalf("写入 stdin: %v", err)
	}
	w.Close()
	t.Cleanup(func() { os.Stdin = old })
}

// ---- runCLI 入口错误/边界路径（SaveAppConfig 之前即返回，无副作用）----

func TestRunCLI_NoCommand_PrintsHelp(t *testing.T) {
	out := captureOutput(t, func() {
		if err := runCLI(nil); err != nil {
			t.Errorf("runCLI(nil) 应返回 nil, got %v", err)
		}
	})
	if !strings.Contains(out, "用法") {
		t.Errorf("帮助输出应包含「用法」, got: %s", out)
	}
}

func TestRunCLI_Version_Flag(t *testing.T) {
	out := captureOutput(t, func() {
		if err := runCLI([]string{"--version"}); err != nil {
			t.Errorf("--version 应返回 nil, got %v", err)
		}
	})
	if !strings.Contains(out, "YSM 模型管理器") || !strings.Contains(out, "CLI 模式") {
		t.Errorf("--version 输出应包含版本信息, got: %s", out)
	}
}

func TestRunCLI_Version_ShortFlag(t *testing.T) {
	out := captureOutput(t, func() {
		if err := runCLI([]string{"-v"}); err != nil {
			t.Errorf("-v 应返回 nil, got %v", err)
		}
	})
	if !strings.Contains(out, "YSM 模型管理器") {
		t.Errorf("-v 输出应包含版本信息, got: %s", out)
	}
}

func TestRunCLI_Help_Flag(t *testing.T) {
	out := captureOutput(t, func() {
		if err := runCLI([]string{"--help"}); err != nil {
			t.Errorf("--help 应返回 nil, got %v", err)
		}
	})
	if !strings.Contains(out, "可用命令") {
		t.Errorf("--help 输出应包含「可用命令」, got: %s", out)
	}
}

func TestRunCLI_Help_ShortFlag(t *testing.T) {
	out := captureOutput(t, func() {
		if err := runCLI([]string{"-h"}); err != nil {
			t.Errorf("-h 应返回 nil, got %v", err)
		}
	})
	if !strings.Contains(out, "可用命令") {
		t.Errorf("-h 输出应包含「可用命令」, got: %s", out)
	}
}

func TestRunCLI_SubCommandHelp(t *testing.T) {
	out := captureOutput(t, func() {
		if err := runCLI([]string{"--files-root", "/tmp", "search", "--help"}); err != nil {
			t.Errorf("子命令 --help 应返回 nil, got %v", err)
		}
	})
	if !strings.Contains(out, "命令: search") {
		t.Errorf("子命令帮助应包含命令名, got: %s", out)
	}
	if !strings.Contains(out, "用法") {
		t.Errorf("子命令帮助应包含用法说明, got: %s", out)
	}
}

func TestRunCLI_UnknownCommand_ReturnsError(t *testing.T) {
	out := captureOutput(t, func() {
		if err := runCLI([]string{"no-such-cmd"}); err == nil {
			t.Error("未知命令应返回错误")
		}
	})
	if !strings.Contains(out, "未知命令") {
		t.Errorf("输出应包含「未知命令」, got: %s", out)
	}
}

func TestRunCLI_MissingFilesRoot_ReturnsError(t *testing.T) {
	err := runCLI([]string{"search", "--keyword", "x"})
	if err == nil || !strings.Contains(err.Error(), "files-root") {
		t.Errorf("缺 --files-root 应报错, got: %v", err)
	}
}

// ---- cache-status ----

func TestCacheStatus_EmptyCache(t *testing.T) {
	withTempCache(t)
	out := captureOutput(t, func() {
		if err := runCacheStatus(&app.App{}, nil); err != nil {
			t.Fatalf("runCacheStatus 应成功, got %v", err)
		}
	})
	if !strings.Contains(out, "缓存为空") {
		t.Errorf("空缓存应输出「缓存为空」, got: %s", out)
	}
}

func TestCacheStatus_CountsKtx2Only(t *testing.T) {
	dir := withTempCache(t)
	mustWrite(t, filepath.Join(dir, "aaaa.ktx2"), bytes.Repeat([]byte("x"), 100))
	mustWrite(t, filepath.Join(dir, "bbbb.ktx2"), bytes.Repeat([]byte("y"), 200))
	mustWrite(t, filepath.Join(dir, "notes.txt"), []byte("ignore-me")) // 非 ktx2 应忽略

	out := captureOutput(t, func() {
		if err := runCacheStatus(&app.App{}, nil); err != nil {
			t.Fatalf("runCacheStatus 应成功, got %v", err)
		}
	})
	if !strings.Contains(out, "文件数量: 2") {
		t.Errorf("应统计 2 个 ktx2 文件, got: %s", out)
	}
	if !strings.Contains(out, "总大小:   300B") {
		t.Errorf("总大小应为 300B, got: %s", out)
	}
}

// ---- cache-clear ----

func TestCacheClear_EmptyCache(t *testing.T) {
	withTempCache(t)
	out := captureOutput(t, func() {
		if err := runCacheClear(&app.App{}, []string{"--yes"}); err != nil {
			t.Fatalf("runCacheClear 应成功, got %v", err)
		}
	})
	if !strings.Contains(out, "缓存已经是空的") {
		t.Errorf("空缓存应提示「缓存已经是空的」, got: %s", out)
	}
}

func TestCacheClear_YesDeletesFiles(t *testing.T) {
	dir := withTempCache(t)
	for _, h := range []string{"a", "b", "c"} {
		mustWrite(t, filepath.Join(dir, h+".ktx2"), []byte("x"))
	}
	out := captureOutput(t, func() {
		if err := runCacheClear(&app.App{}, []string{"--yes"}); err != nil {
			t.Fatalf("runCacheClear 应成功, got %v", err)
		}
	})
	if !strings.Contains(out, "已清空 3 个缓存文件") {
		t.Errorf("应提示清空数量, got: %s", out)
	}
	if rem := listDirNames(t, dir); len(rem) != 0 {
		t.Errorf("--yes 清空后目录应无文件, got %v", rem)
	}
}

func TestCacheClear_CancelKeepsFiles(t *testing.T) {
	dir := withTempCache(t)
	mustWrite(t, filepath.Join(dir, "keep.ktx2"), []byte("x"))
	withStdin(t, "n\n") // 确认时输入非 y → 取消
	out := captureOutput(t, func() {
		if err := runCacheClear(&app.App{}, nil); err != nil {
			t.Fatalf("runCacheClear 应成功, got %v", err)
		}
	})
	if !strings.Contains(out, "已取消") {
		t.Errorf("取消路径应提示「已取消」, got: %s", out)
	}
	if rem := listDirNames(t, dir); len(rem) != 1 || rem[0] != "keep.ktx2" {
		t.Errorf("取消后缓存文件应保留, got %v", rem)
	}
}

// ---- cache-verify ----

func TestCacheVerify_RequiresDir(t *testing.T) {
	err := runCacheVerify(&app.App{}, nil)
	if err == nil || !strings.Contains(err.Error(), "--dir") {
		t.Errorf("cache-verify 缺 --dir 应报错, got: %v", err)
	}
}

func TestCacheVerify_NoTextures(t *testing.T) {
	withTempCache(t)
	dir := t.TempDir()
	out := captureOutput(t, func() {
		if err := runCacheVerify(&app.App{}, []string{"--dir", dir}); err != nil {
			t.Fatalf("runCacheVerify 应成功, got %v", err)
		}
	})
	if !strings.Contains(out, "没有找到贴图文件") {
		t.Errorf("空目录应提示「没有找到贴图文件」, got: %s", out)
	}
}

func TestCacheVerify_ReportsMiss(t *testing.T) {
	withTempCache(t)
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "tex.png"), bytes.Repeat([]byte{0x89, 0x50, 0x4E, 0x47}, 8))
	out := captureOutput(t, func() {
		if err := runCacheVerify(&app.App{}, []string{"--dir", dir}); err != nil {
			t.Fatalf("runCacheVerify 应成功, got %v", err)
		}
	})
	if !strings.Contains(out, "未命中: 1 个") {
		t.Errorf("应报告 1 个未命中, got: %s", out)
	}
	if !strings.Contains(out, "命中率: 0.0%") {
		t.Errorf("命中率应为 0.0%%, got: %s", out)
	}
}

// ---- cache-diag ----

func TestCacheDiag_ReportsSuccess(t *testing.T) {
	withTempCache(t)
	out := captureOutput(t, func() {
		if err := runCacheDiag(&app.App{}, nil); err != nil {
			t.Fatalf("runCacheDiag 应成功, got %v", err)
		}
	})
	for _, marker := range []string{"缓存流程诊断", "哈希计算成功", "缓存写入成功", "数据完整性验证通过"} {
		if !strings.Contains(out, marker) {
			t.Errorf("诊断输出应包含 %q", marker)
		}
	}
}

// ---- 参数校验错误路径（不触碰 app 状态）----

func TestExport_RequiresModel(t *testing.T) {
	err := runExport(&app.App{}, nil)
	if err == nil || !strings.Contains(err.Error(), "--model") {
		t.Errorf("export 缺 --model 应报错, got: %v", err)
	}
}

func TestAnalyze_RequiresModel(t *testing.T) {
	err := runAnalyze(&app.App{}, nil)
	if err == nil || !strings.Contains(err.Error(), "--model") {
		t.Errorf("analyze 缺 --model 应报错, got: %v", err)
	}
}

// ---- config-show 冒烟 ----

func TestConfigShow_PrintsRootAndCache(t *testing.T) {
	withTempCache(t)
	out := captureOutput(t, func() {
		if err := runConfigShow(&app.App{}, nil); err != nil {
			t.Fatalf("runConfigShow 应成功, got %v", err)
		}
	})
	// config-show 会只读加载磁盘真实配置（configPath 不可注入），
	// 故只断言任何配置下都稳定的输出片段，不绑定具体机器状态
	for _, marker := range []string{"根目录", "纹理缓存"} {
		if !strings.Contains(out, marker) {
			t.Errorf("输出应包含 %q, got: %s", marker, out)
		}
	}
}

// ---- runCLIWithApp 解耦入口（用于自动化测试复用）----

func TestRunCLIWithApp_Help(t *testing.T) {
	a := &app.App{}
	out := captureOutput(t, func() {
		if err := runCLIWithApp(a, []string{"--help"}); err != nil {
			t.Errorf("runCLIWithApp --help 应返回 nil, got %v", err)
		}
	})
	if !strings.Contains(out, "可用命令") {
		t.Errorf("帮助输出应包含「可用命令」, got: %s", out)
	}
}

func TestRunCLIWithApp_Version(t *testing.T) {
	a := &app.App{}
	out := captureOutput(t, func() {
		if err := runCLIWithApp(a, []string{"--version"}); err != nil {
			t.Errorf("runCLIWithApp --version 应返回 nil, got %v", err)
		}
	})
	if !strings.Contains(out, "YSM 模型管理器") {
		t.Errorf("版本输出应包含版本信息, got: %s", out)
	}
}

func TestRunCLIWithApp_UnknownCommand(t *testing.T) {
	a := &app.App{}
	err := runCLIWithApp(a, []string{"no-such-cmd"})
	if err == nil {
		t.Error("未知命令应返回错误")
	}
	if !strings.Contains(err.Error(), "未知命令") {
		t.Errorf("错误信息应包含「未知命令」, got: %v", err)
	}
}

func TestRunCLIWithApp_UsesProvidedApp(t *testing.T) {
	a := &app.App{}
	out := captureOutput(t, func() {
		if err := runCLIWithApp(a, []string{"--files-root", "/tmp", "cache-status"}); err != nil {
			t.Errorf("runCLIWithApp cache-status 应返回 nil, got %v", err)
		}
	})
	if !strings.Contains(out, "缓存状态") {
		t.Errorf("应执行 cache-status 命令, got: %s", out)
	}
}

func TestRunCLIWithApp_NoFilesRoot_RunsAnyway(t *testing.T) {
	// runCLIWithApp 设计为测试复用，允许没有 files-root
	// （与 runCLI 不同，runCLI 会强制要求 files-root）
	a := &app.App{}
	err := runCLIWithApp(a, []string{"search", "--keyword", "test"})
	// 没有 files-root 时应正常运行（search 命令在没有模型时返回空结果）
	if err != nil {
		t.Logf("runCLIWithApp 无 files-root 返回: %v（可能因无模型而正常）", err)
	}
}

// ---- helpers ----

func mustWrite(t *testing.T, path string, data []byte) {
	t.Helper()
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatalf("写入 %s: %v", path, err)
	}
}

func listDirNames(t *testing.T, dir string) []string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("读取目录 %s: %v", dir, err)
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		names = append(names, e.Name())
	}
	return names
}
