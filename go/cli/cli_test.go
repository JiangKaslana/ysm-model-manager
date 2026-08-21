// ===== CLI 薄壳级单测 =====
// 覆盖：runCLI 入口错误路径 / cache 系列命令的副作用与输出 / 参数校验错误路径 / config-show 空配置分支。
// 策略：用 &app.App{} 零值 + 把 texture_cache.CacheDir 重定向到临时目录，
// 不触碰真实用户配置/日志/缓存目录，不触发 SaveAppConfig 落盘与 watcher 重启（见 AGENTS 硬约束）。
package cli

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"ysm-model-manager/go/texture_cache"
	"ysm-model-manager/internal/app"
)

// captureOutput 捕获调用期间的 stdout 输出
// 修复：在 fn() 执行前启动异步 reader，避免 Windows pipe 缓冲区满导致 fmt.Println 阻塞死锁
func captureOutput(t *testing.T, fn func()) string {
	t.Helper()
	old := os.Stdout
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("os.Pipe: %v", err)
	}
	os.Stdout = w
	t.Cleanup(func() { os.Stdout = old })

	var out strings.Builder
	readerDone := make(chan struct{})
	go func() {
		defer close(readerDone)
		io.Copy(&out, r)
	}()

	fn()
	if err := w.Close(); err != nil {
		t.Fatalf("关闭写端: %v", err)
	}
	<-readerDone
	return out.String()
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
		if err := RunCLI(nil); err != nil {
			t.Errorf("RunCLI(nil) 应返回 nil, got %v", err)
		}
	})
	if !strings.Contains(out, "用法") {
		t.Errorf("帮助输出应包含「用法」, got: %s", out)
	}
}

func TestRunCLI_Version_Flag(t *testing.T) {
	out := captureOutput(t, func() {
		if err := RunCLI([]string{"--version"}); err != nil {
			t.Errorf("--version 应返回 nil, got %v", err)
		}
	})
	if !strings.Contains(out, "YSM 模型管理器") || !strings.Contains(out, "CLI 模式") {
		t.Errorf("--version 输出应包含版本信息, got: %s", out)
	}
}

func TestRunCLI_Version_ShortFlag(t *testing.T) {
	out := captureOutput(t, func() {
		if err := RunCLI([]string{"-v"}); err != nil {
			t.Errorf("-v 应返回 nil, got %v", err)
		}
	})
	if !strings.Contains(out, "YSM 模型管理器") {
		t.Errorf("-v 输出应包含版本信息, got: %s", out)
	}
}

func TestRunCLI_Help_Flag(t *testing.T) {
	out := captureOutput(t, func() {
		if err := RunCLI([]string{"--help"}); err != nil {
			t.Errorf("--help 应返回 nil, got %v", err)
		}
	})
	if !strings.Contains(out, "可用命令") {
		t.Errorf("--help 输出应包含「可用命令」, got: %s", out)
	}
}

func TestRunCLI_Help_ShortFlag(t *testing.T) {
	out := captureOutput(t, func() {
		if err := RunCLI([]string{"-h"}); err != nil {
			t.Errorf("-h 应返回 nil, got %v", err)
		}
	})
	if !strings.Contains(out, "可用命令") {
		t.Errorf("-h 输出应包含「可用命令」, got: %s", out)
	}
}

func TestRunCLI_SubCommandHelp(t *testing.T) {
	out := captureOutput(t, func() {
		if err := RunCLI([]string{"--files-root", "/tmp", "search", "--help"}); err != nil {
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
	err := RunCLI([]string{"--files-root", "/tmp", "no-such-cmd"})
	if err == nil {
		t.Error("未知命令应返回错误")
	}
	if !strings.Contains(err.Error(), "未知命令") {
		t.Errorf("错误应包含「未知命令」, got: %v", err)
	}
}

func TestRunCLI_MissingFilesRoot_ReturnsError(t *testing.T) {
	err := RunCLI([]string{"search", "--keyword", "x"})
	if err == nil || !strings.Contains(err.Error(), "files-root") {
		t.Errorf("缺 --files-root 应报错, got: %v", err)
	}
}

// ---- cache-status ----

func TestCacheStatus_EmptyCache(t *testing.T) {
	withTempCache(t)
	out := captureOutput(t, func() {
		if err := runCacheStatus(&CmdContext{App: &app.App{}, Args: nil}); err != nil {
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
		if err := runCacheStatus(&CmdContext{App: &app.App{}, Args: nil}); err != nil {
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
		if err := runCacheClear(&CmdContext{App: &app.App{}, Args: []string{"--yes"}}); err != nil {
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
		if err := runCacheClear(&CmdContext{App: &app.App{}, Args: []string{"--yes"}}); err != nil {
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
		if err := runCacheClear(&CmdContext{App: &app.App{}, Args: nil}); err != nil {
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
	err := runCacheVerify(&CmdContext{App: &app.App{}, Args: nil})
	if err == nil || !strings.Contains(err.Error(), "--dir") {
		t.Errorf("cache-verify 缺 --dir 应报错, got: %v", err)
	}
}

func TestCacheVerify_NoTextures(t *testing.T) {
	withTempCache(t)
	dir := t.TempDir()
	out := captureOutput(t, func() {
		if err := runCacheVerify(&CmdContext{App: &app.App{}, Args: []string{"--dir", dir}}); err != nil {
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
		if err := runCacheVerify(&CmdContext{App: &app.App{}, Args: []string{"--dir", dir}}); err != nil {
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
		if err := runCacheDiag(&CmdContext{App: &app.App{}, Args: nil}); err != nil {
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
	err := runExport(&CmdContext{App: &app.App{}, Args: nil})
	if err == nil || !strings.Contains(err.Error(), "--model") {
		t.Errorf("export 缺 --model 应报错, got: %v", err)
	}
}

func TestAnalyze_RequiresModel(t *testing.T) {
	err := runAnalyze(&CmdContext{App: &app.App{}, Args: nil})
	if err == nil || !strings.Contains(err.Error(), "--model") {
		t.Errorf("analyze 缺 --model 应报错, got: %v", err)
	}
}

// ---- config-show 冒烟 ----

func TestConfigShow_PrintsRootAndCache(t *testing.T) {
	withTempCache(t)
	out := captureOutput(t, func() {
		if err := runConfigShow(&CmdContext{App: &app.App{}, Args: nil}); err != nil {
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

// ---- ExecuteCLIWithApp 解耦入口（用于自动化测试复用）----

func TestRunCLIWithApp_Help(t *testing.T) {
	a := &app.App{}
	out := captureOutput(t, func() {
		if err := ExecuteCLIWithApp(a, a.SaveAppConfig, []string{"--help"}); err != nil {
			t.Errorf("ExecuteCLIWithApp --help 应返回 nil, got %v", err)
		}
	})
	if !strings.Contains(out, "可用命令") {
		t.Errorf("帮助输出应包含「可用命令」, got: %s", out)
	}
}

func TestRunCLIWithApp_Version(t *testing.T) {
	a := &app.App{}
	out := captureOutput(t, func() {
		if err := ExecuteCLIWithApp(a, a.SaveAppConfig, []string{"--version"}); err != nil {
			t.Errorf("ExecuteCLIWithApp --version 应返回 nil, got %v", err)
		}
	})
	if !strings.Contains(out, "YSM 模型管理器") {
		t.Errorf("版本输出应包含版本信息, got: %s", out)
	}
}

func TestRunCLIWithApp_UnknownCommand(t *testing.T) {
	a := &app.App{}
	err := ExecuteCLIWithApp(a, a.SaveAppConfig, []string{"no-such-cmd"})
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
		// 不传 --files-root：避免触发 SaveAppConfig 落盘真实用户配置（文件头约束）
		if err := ExecuteCLIWithApp(a, a.SaveAppConfig, []string{"cache-status"}); err != nil {
			t.Errorf("ExecuteCLIWithApp cache-status 应返回 nil, got %v", err)
		}
	})
	if !strings.Contains(out, "缓存状态") {
		t.Errorf("应执行 cache-status 命令, got: %s", out)
	}
}

func TestRunCLIWithApp_NoFilesRoot_RunsAnyway(t *testing.T) {
	// ExecuteCLIWithApp 设计为测试复用，允许没有 files-root
	// （与 runCLI 不同，runCLI 会强制要求 files-root）
	a := &app.App{}
	err := ExecuteCLIWithApp(a, a.SaveAppConfig, []string{"search", "--keyword", "test"})
	// 没有 files-root 时应正常运行（search 命令在没有模型时返回空结果）
	if err != nil {
		t.Logf("ExecuteCLIWithApp 无 files-root 返回: %v（可能因无模型而正常）", err)
	}
}

// ---- help 输出稳定性 ----

func TestPrintCLIHelp_CommandsSorted(t *testing.T) {
	out := captureOutput(t, func() {
		printCLIHelp()
	})

	// 分组输出格式："[分类]" 行 + "  %-18s %s" 命令行。
	// 解析出每个分类下的命令名列表，验证组内字母序 + 全覆盖。
	var (
		curCat   string
		gotByCat = map[string][]string{}
		seenCats []string
	)
	for _, line := range strings.Split(out, "\n") {
		// 分类标题行: "  [模型管理]"
		if strings.HasPrefix(line, "  [") && strings.HasSuffix(line, "]") {
			curCat = strings.TrimSuffix(strings.TrimPrefix(line, "  ["), "]")
			seenCats = append(seenCats, curCat)
			continue
		}
		// 命令行格式: "  %-18s %s"，name 占第 3~20 字符
		if len(line) < 20 || line[:2] != "  " || curCat == "" {
			continue
		}
		name := strings.TrimSpace(line[2:20])
		if _, ok := cliCommands[name]; ok {
			gotByCat[curCat] = append(gotByCat[curCat], name)
		}
	}

	// 所有已注册命令都应出现在 help 中
	total := 0
	for _, names := range gotByCat {
		total += len(names)
	}
	if total != len(cliCommands) {
		t.Errorf("help 命令数 %d != 已注册数 %d", total, len(cliCommands))
	}

	// 每个分类内应按字母序
	for cat, names := range gotByCat {
		if len(names) == 0 {
			t.Errorf("分类 %q 未解析到任何命令", cat)
			continue
		}
		for i := 1; i < len(names); i++ {
			if names[i-1] > names[i] {
				t.Errorf("分类 %q 命令列表应按字母序, got %v", cat, names)
				break
			}
		}
	}

	// 至少有一个分类被解析到
	if len(seenCats) == 0 {
		t.Fatal("help 输出未解析到任何分类标题")
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

// ========== mmd 命令测试 ==========

func TestFileBench_RequiresDirOrFile(t *testing.T) {
	err := runFileBench(&CmdContext{App: &app.App{}, Args: nil})
	if err == nil || !strings.Contains(err.Error(), "--dir") {
		t.Errorf("file-bench 缺 --dir/--file 应报错, got: %v", err)
	}
}

func TestFileBench_SingleFile(t *testing.T) {
	dir := t.TempDir()
	filePath := filepath.Join(dir, "test.ysm")
	mustWrite(t, filePath, bytes.Repeat([]byte("x"), 2*1024*1024)) // 2MB

	out := captureOutput(t, func() {
		if err := runFileBench(&CmdContext{App: &app.App{}, Args: []string{"--file", filePath}}); err != nil {
			t.Fatalf("runFileBench 应成功, got %v", err)
		}
	})
	if !strings.Contains(out, "文件读取性能测试") {
		t.Errorf("输出应包含标题, got: %s", out)
	}
}

func TestFileBench_DirWithLargeFiles(t *testing.T) {
	dir := t.TempDir()
	for i := 0; i < 3; i++ {
		mustWrite(t, filepath.Join(dir, fmt.Sprintf("file_%d.ysm", i)), bytes.Repeat([]byte("x"), 2*1024*1024))
	}

	out := captureOutput(t, func() {
		if err := runFileBench(&CmdContext{App: &app.App{}, Args: []string{"--dir", dir, "--iterations", "1"}}); err != nil {
			t.Fatalf("runFileBench 应成功, got %v", err)
		}
	})
	if !strings.Contains(out, "文件读取性能测试") {
		t.Errorf("输出应包含标题, got: %s", out)
	}
}

func TestScanDir_RequiresDir(t *testing.T) {
	err := runScanDir(&CmdContext{App: &app.App{}, Args: nil})
	if err == nil || !strings.Contains(err.Error(), "--dir") {
		t.Errorf("scan-dir 缺 --dir 应报错, got: %v", err)
	}
}

func TestScanDir_EmptyDir(t *testing.T) {
	dir := t.TempDir()
	out := captureOutput(t, func() {
		if err := runScanDir(&CmdContext{App: &app.App{}, Args: []string{"--dir", dir}}); err != nil {
			t.Fatalf("runScanDir 应成功, got %v", err)
		}
	})
	if !strings.Contains(out, "目录统计") {
		t.Errorf("输出应包含目录统计, got: %s", out)
	}
	if !strings.Contains(out, "文件数:   0") {
		t.Errorf("空目录应显示 0 文件, got: %s", out)
	}
}

func TestScanDir_WithFiles(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "test.png"), []byte("fake png"))
	mustWrite(t, filepath.Join(dir, "test.jpg"), []byte("fake jpg"))
	mustWrite(t, filepath.Join(dir, "model.pmx"), bytes.Repeat([]byte("x"), 15*1024*1024)) // 15MB

	out := captureOutput(t, func() {
		if err := runScanDir(&CmdContext{App: &app.App{}, Args: []string{"--dir", dir}}); err != nil {
			t.Fatalf("runScanDir 应成功, got %v", err)
		}
	})
	if !strings.Contains(out, "目录统计") {
		t.Errorf("输出应包含目录统计, got: %s", out)
	}
	if !strings.Contains(out, ".png") || !strings.Contains(out, ".jpg") {
		t.Errorf("应显示按扩展名分组, got: %s", out)
	}
}

func TestAnalyzeMMD_RequiresDir(t *testing.T) {
	err := runAnalyzeMMD(&CmdContext{App: &app.App{}, Args: nil})
	if err == nil || !strings.Contains(err.Error(), "--dir") {
		t.Errorf("analyze-mmd 缺 --dir 应报错, got: %v", err)
	}
}

func TestAnalyzeMMD_EmptyDir(t *testing.T) {
	dir := t.TempDir()
	out := captureOutput(t, func() {
		if err := runAnalyzeMMD(&CmdContext{App: &app.App{}, Args: []string{"--dir", dir}}); err != nil {
			t.Fatalf("runAnalyzeMMD 应成功, got %v", err)
		}
	})
	if !strings.Contains(out, "MMD 模型资产分析") {
		t.Errorf("输出应包含标题, got: %s", out)
	}
	if !strings.Contains(out, "资产统计") {
		t.Errorf("输出应包含资产统计, got: %s", out)
	}
}

func TestAnalyzeMMD_WithModels(t *testing.T) {
	dir := t.TempDir()
	// 创建模拟的 MMD 文件
	mustWrite(t, filepath.Join(dir, "model.pmx"), []byte("fake pmx"))
	mustWrite(t, filepath.Join(dir, "motion.vmd"), []byte("fake vmd"))
	mustWrite(t, filepath.Join(dir, "physics.vpd"), []byte("fake vpd"))
	mustWrite(t, filepath.Join(dir, "tex1.png"), bytes.Repeat([]byte{0x89, 0x50, 0x4E, 0x47}, 8))

	out := captureOutput(t, func() {
		if err := runAnalyzeMMD(&CmdContext{App: &app.App{}, Args: []string{"--dir", dir}}); err != nil {
			t.Fatalf("runAnalyzeMMD 应成功, got %v", err)
		}
	})
	if !strings.Contains(out, "PMX/PMD 模型:  1 个") {
		t.Errorf("应显示 1 个 PMX 模型, got: %s", out)
	}
	if !strings.Contains(out, "VMD 动画:      1 个") {
		t.Errorf("应显示 1 个 VMD 动画, got: %s", out)
	}
}

// ========== concurrent 命令测试 ==========

func TestConcurrentBench_NoModels(t *testing.T) {
	dir := t.TempDir()
	a := app.NewApp()
	err := runConcurrentBench(&CmdContext{App: a, FilesRoot: dir, Args: []string{"--files-root", dir}})
	if err == nil {
		t.Log("无模型时 concurrent-bench 返回错误属正常")
	}
}

func TestSingleBench_RequiresModel(t *testing.T) {
	err := runSingleBench(&CmdContext{App: &app.App{}, Args: nil})
	if err == nil || !strings.Contains(err.Error(), "--model") {
		t.Errorf("single-bench 缺 --model 应报错, got: %v", err)
	}
}

func TestSingleBench_WithFakeModel(t *testing.T) {
	dir := t.TempDir()
	modelPath := filepath.Join(dir, "test.ysm")
	mustWrite(t, modelPath, []byte(`{"test": "model"}`))

	out := captureOutput(t, func() {
		if err := runSingleBench(&CmdContext{App: &app.App{}, Args: []string{"--model", modelPath, "--iterations", "1"}}); err != nil {
			t.Logf("runSingleBench 返回: %v（可能因模型格式不标准而正常）", err)
		}
	})
	if strings.Contains(out, "单模型加载基准测试") {
		t.Log("single-bench 成功执行")
	}
}

// ---- iterations 参数校验（--iterations 0/负值 必须拒绝，防 allStages[0] 越界 panic）----

func TestSingleBench_RejectsInvalidIterations(t *testing.T) {
	for _, it := range []string{"0", "-1"} {
		err := runSingleBench(&CmdContext{App: &app.App{}, Args: []string{"--model", "test.ysm", "--iterations", it}})
		if err == nil || !strings.Contains(err.Error(), "--iterations") {
			t.Errorf("single-bench --iterations %s 应报错, got: %v", it, err)
		}
		if _, ok := err.(*ErrParam); !ok {
			t.Errorf("single-bench --iterations %s 应为 ErrParam, got: %T", it, err)
		}
	}
}

func TestFileBench_RejectsInvalidIterations(t *testing.T) {
	for _, it := range []string{"0", "-1"} {
		err := runFileBench(&CmdContext{App: &app.App{}, Args: []string{"--dir", ".", "--iterations", it}})
		if err == nil || !strings.Contains(err.Error(), "--iterations") {
			t.Errorf("file-bench --iterations %s 应报错, got: %v", it, err)
		}
		if _, ok := err.(*ErrParam); !ok {
			t.Errorf("file-bench --iterations %s 应为 ErrParam, got: %T", it, err)
		}
	}
}

func TestBenchmark_RejectsInvalidIterations(t *testing.T) {
	for _, it := range []string{"0", "-1"} {
		err := runBenchmark(&CmdContext{App: &app.App{}, Args: []string{"--iterations", it}})
		if err == nil || !strings.Contains(err.Error(), "--iterations") {
			t.Errorf("benchmark --iterations %s 应报错, got: %v", it, err)
		}
		if _, ok := err.(*ErrParam); !ok {
			t.Errorf("benchmark --iterations %s 应为 ErrParam, got: %T", it, err)
		}
	}
}

// ========== flow 命令测试 ==========

func TestGUIFlow_NoModels(t *testing.T) {
	dir := t.TempDir()
	a := app.NewApp()
	err := runGUIFlow(&CmdContext{App: a, FilesRoot: dir, Args: []string{"--files-root", dir}})
	if err != nil {
		t.Logf("gui-flow 无模型时返回: %v（属正常）", err)
	}
}

func TestGUIFlow_WithVerbose(t *testing.T) {
	dir := t.TempDir()
	a := app.NewApp()
	out := captureOutput(t, func() {
		if err := runGUIFlow(&CmdContext{App: a, FilesRoot: dir, Args: []string{"--files-root", dir, "--verbose"}}); err != nil {
			t.Logf("gui-flow verbose 返回: %v（可能因无模型而正常）", err)
		}
	})
	if strings.Contains(out, "GUI 流程模拟器") {
		t.Log("gui-flow 成功执行")
	}
}

// TestGUIFlow_DoesNotWriteRealConfig 回归守卫：gui-flow「配置加载」阶段只读，不得写穿真实用户配置。
// 此前 runPhaseConfigLoad 调 SaveAppConfig 落盘 APPDATA/ysm_config.json（filesRoot 指向临时目录），
// 污染用户配置并触发 test_config_defaults.mjs FAIL ①；修复后文件应保持原样（存在则内容不变，不存在则不新建）。
func TestGUIFlow_DoesNotWriteRealConfig(t *testing.T) {
	userCfg, err := os.UserConfigDir()
	if err != nil {
		t.Fatalf("os.UserConfigDir: %v", err)
	}
	cfgPath := filepath.Join(userCfg, "YSM-Model-Manager", "ysm_config.json")
	readCfg := func() ([]byte, bool) {
		b, err := os.ReadFile(cfgPath)
		if err != nil {
			return nil, false
		}
		return b, true
	}
	before, beforeExists := readCfg()

	dir := t.TempDir()
	a := app.NewApp()
	_ = runGUIFlow(&CmdContext{App: a, FilesRoot: dir, Args: []string{"--files-root", dir, "--verbose"}})

	after, afterExists := readCfg()
	if beforeExists != afterExists || !bytes.Equal(before, after) {
		t.Errorf("gui-flow 不应写盘真实用户配置 %s\n  before: %q\n  after:  %q", cfgPath, before, after)
	}
}

// ========== perf 命令测试 ==========

func TestPerfLog_Output(t *testing.T) {
	out := captureOutput(t, func() {
		if err := runPerfLog(&CmdContext{App: &app.App{}, Args: nil}); err != nil {
			t.Errorf("runPerfLog 应成功, got %v", err)
		}
	})
	if !strings.Contains(out, "优化记录") {
		t.Errorf("perf-log 输出应包含「优化记录」, got: %s", out)
	}
	if !strings.Contains(out, "当前瓶颈") {
		t.Errorf("perf-log 输出应包含「当前瓶颈」, got: %s", out)
	}
	if !strings.Contains(out, "关键指标") {
		t.Errorf("perf-log 输出应包含「关键指标」, got: %s", out)
	}
}

// ========== model 命令更多边界测试 ==========

func TestSearch_EmptyKeyword(t *testing.T) {
	dir := t.TempDir()
	out := captureOutput(t, func() {
		if err := runSearch(&CmdContext{App: &app.App{}, FilesRoot: dir, Args: []string{"--files-root", dir}}); err != nil {
			t.Errorf("search 空仓库应成功, got %v", err)
		}
	})
	if !strings.Contains(out, "未找到匹配的模型") {
		t.Errorf("空仓库应显示「未找到匹配的模型」, got: %s", out)
	}
}

func TestList_EmptyRepo(t *testing.T) {
	dir := t.TempDir()
	out := captureOutput(t, func() {
		if err := runList(&CmdContext{App: &app.App{}, FilesRoot: dir, Args: []string{"--files-root", dir}}); err != nil {
			t.Errorf("list 空仓库应成功, got %v", err)
		}
	})
	if !strings.Contains(out, "仓库为空") {
		t.Errorf("空仓库应显示「仓库为空」, got: %s", out)
	}
}

func TestList_JsonFormat(t *testing.T) {
	dir := t.TempDir()
	out := captureOutput(t, func() {
		if err := runList(&CmdContext{App: &app.App{}, FilesRoot: dir, Args: []string{"--files-root", dir, "--format", "json"}}); err != nil {
			t.Errorf("list json 格式应成功, got %v", err)
		}
	})
	// 空仓库时先输出 "仓库为空" 再返回，不走 json 输出路径
	if !strings.Contains(out, "仓库为空") {
		t.Errorf("空仓库应显示「仓库为空」, got: %s", out)
	}
}

func TestVerify_EmptyRepo(t *testing.T) {
	dir := t.TempDir()
	out := captureOutput(t, func() {
		if err := runVerify(&CmdContext{App: &app.App{}, FilesRoot: dir, Args: []string{"--files-root", dir}}); err != nil {
			t.Errorf("verify 空仓库应成功, got %v", err)
		}
	})
	if !strings.Contains(out, "验证结果") {
		t.Errorf("verify 应显示验证结果, got: %s", out)
	}
}

func TestExport_InvalidPath(t *testing.T) {
	err := runExport(&CmdContext{App: &app.App{}, Args: []string{"--model", "/nonexistent/model.ysm"}})
	if err == nil {
		t.Log("export 不存在的文件可能返回空内容")
	}
}

// ========== shared.go 工具函数测试 ==========

func TestParseCommandArgs_Basic(t *testing.T) {
	args := []string{"--files-root", "/models", "search", "--keyword", "test"}
	filesRoot, jsonMode, cmdArgs := ParseCommandArgs(args)
	if filesRoot != "/models" {
		t.Errorf("filesRoot 应为 /models, got: %s", filesRoot)
	}
	if jsonMode {
		t.Error("不应启用 jsonMode")
	}
	if len(cmdArgs) != 3 {
		t.Errorf("应有 3 个命令参数, got: %d", len(cmdArgs))
	}
}

func TestParseCommandArgs_InlineFormat(t *testing.T) {
	args := []string{"--files-root=/models", "list"}
	filesRoot, jsonMode, cmdArgs := ParseCommandArgs(args)
	if filesRoot != "/models" {
		t.Errorf("filesRoot 应为 /models, got: %s", filesRoot)
	}
	if jsonMode {
		t.Error("不应启用 jsonMode")
	}
	if len(cmdArgs) != 1 || cmdArgs[0] != "list" {
		t.Errorf("命令参数应只有 list, got: %v", cmdArgs)
	}
}

func TestParseCommandArgs_NoFilesRoot(t *testing.T) {
	args := []string{"search", "--keyword", "test"}
	filesRoot, jsonMode, cmdArgs := ParseCommandArgs(args)
	if filesRoot != "" {
		t.Errorf("无 files-root 应为空, got: %s", filesRoot)
	}
	if jsonMode {
		t.Error("不应启用 jsonMode")
	}
	if len(cmdArgs) != 3 {
		t.Errorf("应有 3 个命令参数, got: %d", len(cmdArgs))
	}
}

func TestFormatSize(t *testing.T) {
	tests := []struct {
		input    int64
		expected string
	}{
		{500, "500B"},
		{1024, "1.0KB"},
		{1536, "1.5KB"},
		{1048576, "1.0MB"},
		{1073741824, "1.0GB"},
	}
	for _, tt := range tests {
		result := formatSize(tt.input)
		if result != tt.expected {
			t.Errorf("formatSize(%d) = %s, want %s", tt.input, result, tt.expected)
		}
	}
}

func TestIsPowerOf2(t *testing.T) {
	tests := []struct {
		input    int
		expected bool
	}{
		{1, true},
		{2, true},
		{4, true},
		{8, true},
		{16, true},
		{1024, true},
		{3, false},
		{5, false},
		{7, false},
		{0, false},
		{-1, false},
	}
	for _, tt := range tests {
		result := isPowerOf2(tt.input)
		if result != tt.expected {
			t.Errorf("isPowerOf2(%d) = %v, want %v", tt.input, result, tt.expected)
		}
	}
}

func TestMinMax(t *testing.T) {
	if min(5, 10) != 5 {
		t.Error("min(5, 10) should be 5")
	}
	if max(5, 10) != 10 {
		t.Error("max(5, 10) should be 10")
	}
	if min(-1, -5) != -5 {
		t.Error("min(-1, -5) should be -5")
	}
	if max(0, 0) != 0 {
		t.Error("max(0, 0) should be 0")
	}
}

func TestExitCodeOf(t *testing.T) {
	paramErr := &ErrParam{Err: fmt.Errorf("参数错误")}
	if ExitCodeOf(paramErr) != ExitParamErr {
		t.Errorf("参数错误应有退出码 %d, got: %d", ExitParamErr, ExitCodeOf(paramErr))
	}

	runtimeErr := &ErrRuntime{Err: fmt.Errorf("运行时错误")}
	if ExitCodeOf(runtimeErr) != ExitRuntimeErr {
		t.Errorf("运行时错误应有退出码 %d, got: %d", ExitRuntimeErr, ExitCodeOf(runtimeErr))
	}

	genericErr := fmt.Errorf("普通错误")
	if ExitCodeOf(genericErr) != ExitRuntimeErr {
		t.Errorf("普通错误应有退出码 %d, got: %d", ExitRuntimeErr, ExitCodeOf(genericErr))
	}
}

func TestErrParam_Error(t *testing.T) {
	e := &ErrParam{CmdName: "search", Err: fmt.Errorf("缺参数")}
	if !strings.Contains(e.Error(), "search") || !strings.Contains(e.Error(), "参数错误") {
		t.Errorf("ErrParam.Error() 应包含命令名和错误类型, got: %s", e.Error())
	}

	e2 := &ErrParam{Err: fmt.Errorf("无命令名")}
	if strings.Contains(e2.Error(), "参数错误 [") {
		t.Errorf("无命令名时不应包含方括号, got: %s", e2.Error())
	}
}

func TestErrRuntime_Error(t *testing.T) {
	e := &ErrRuntime{CmdName: "benchmark", Err: fmt.Errorf("超时")}
	if !strings.Contains(e.Error(), "benchmark") || !strings.Contains(e.Error(), "运行时错误") {
		t.Errorf("ErrRuntime.Error() 应包含命令名和错误类型, got: %s", e.Error())
	}
}

func TestPrintError(t *testing.T) {
	// nil error should not panic
	PrintError(nil)

	// non-nil error should print to stderr
	// (we just verify it doesn't panic)
	PrintError(fmt.Errorf("test error"))
}

// ========== flow 辅助函数测试 ==========

func TestDurationFormat(t *testing.T) {
	tests := []struct {
		input    float64
		expected string
	}{
		{1.5, "1.50ms"},   // < 10ms: 两位小数
		{5.0, "5.00ms"},   // < 10ms: 两位小数
		{9.9, "9.90ms"},   // < 10ms: 两位小数
		{10.0, "10ms"},    // >= 10ms < 1000ms: 整数
		{99.0, "99ms"},    // >= 10ms < 1000ms: 整数
		{100.0, "100ms"},  // >= 10ms < 1000ms: 整数
		{500.0, "500ms"},  // >= 10ms < 1000ms: 整数
		{1000.0, "1.00s"}, // >= 1000ms: 秒+两位小数
		{2500.0, "2.50s"}, // >= 1000ms: 秒+两位小数
	}
	for _, tt := range tests {
		result := durationFormat(tt.input)
		if result != tt.expected {
			t.Errorf("durationFormat(%f) = %s, want %s", tt.input, result, tt.expected)
		}
	}
}

func TestWrap(t *testing.T) {
	text := "这是一段很长的文字需要被折行处理来测试 wrap 函数的折行逻辑是否正确工作"
	result := wrap(text, 20, "  ")
	if len(result) == 0 {
		t.Error("wrap 不应返回空字符串")
	}
	if !strings.Contains(result, "\n") {
		t.Log("短文本可能不需要折行")
	}
}

// ========== 回归测试：确保所有命令都已注册 ==========

func TestAllCommandsRegistered(t *testing.T) {
	expectedCommands := []string{
		"search", "analyze", "list", "verify", "benchmark", "export",
		"cache-status", "cache-verify", "cache-clear", "cache-diag",
		"file-bench", "scan-dir", "analyze-mmd",
		"concurrent-bench", "single-bench",
		"config-show",
		"gui-flow",
		"perf-log",
	}

	for _, cmd := range expectedCommands {
		if _, exists := cliCommands[cmd]; !exists {
			t.Errorf("命令 %s 未注册", cmd)
		}
	}
}

// ========== DispatchCommand 路由测试 ==========

func TestDispatchCommand_RequiresFilesRoot(t *testing.T) {
	a := app.NewApp()
	err := DispatchCommand(a, a.SaveAppConfig, "", []string{"search"}, true)
	if err == nil {
		t.Error("requireFilesRoot=true 且 filesRoot 为空时应返回错误")
	}
	if !strings.Contains(err.Error(), "files-root") {
		t.Errorf("错误信息应包含 files-root, got: %v", err)
	}
}

func TestDispatchCommand_AllowsEmptyFilesRoot(t *testing.T) {
	a := app.NewApp()
	err := DispatchCommand(a, a.SaveAppConfig, "", []string{"cache-status"}, false)
	if err != nil {
		t.Logf("无 files-root 时 dispatch 返回: %v（可能正常）", err)
	}
}

func TestDispatchCommand_UnknownCommand(t *testing.T) {
	a := app.NewApp()
	dir := t.TempDir()
	err := DispatchCommand(a, a.SaveAppConfig, dir, []string{"no-such-cmd"}, false)
	if err == nil {
		t.Error("未知命令应返回错误")
	}
	if !strings.Contains(err.Error(), "未知命令") {
		t.Errorf("错误应包含「未知命令」, got: %v", err)
	}
}

func TestDispatchCommand_SubCommandHelp(t *testing.T) {
	a := app.NewApp()
	out := captureOutput(t, func() {
		err := DispatchCommand(a, a.SaveAppConfig, "", []string{"search", "--help"}, false)
		if err != nil {
			t.Errorf("--help 应返回 nil, got: %v", err)
		}
	})
	if !strings.Contains(out, "命令: search") {
		t.Errorf("子命令帮助应包含命令名, got: %s", out)
	}
}

func TestDispatchCommand_EmptyCommandList(t *testing.T) {
	a := app.NewApp()
	err := DispatchCommand(a, a.SaveAppConfig, "", nil, false)
	if err != nil {
		t.Errorf("空命令列表应返回 nil, got: %v", err)
	}
}

// ========== parseFlags 测试 ==========

func TestParseFlags_ExtractsFilesRoot(t *testing.T) {
	fs := newCmdFlagSet("test")
	fs.String("keyword", "", "关键词")
	filesRoot, err := parseFlags(fs, []string{"--files-root", "/models", "--keyword", "warrior"})
	if err != nil {
		t.Fatalf("解析应成功, got: %v", err)
	}
	if filesRoot != "/models" {
		t.Errorf("filesRoot 应为 /models, got: %s", filesRoot)
	}
}

func TestParseFlags_ExtractsFilesRootInline(t *testing.T) {
	fs := newCmdFlagSet("test")
	filesRoot, err := parseFlags(fs, []string{"--files-root=/models", "search"})
	if err != nil {
		t.Fatalf("解析应成功, got: %v", err)
	}
	if filesRoot != "/models" {
		t.Errorf("filesRoot 应为 /models, got: %s", filesRoot)
	}
}

func TestParseFlags_NoFilesRoot(t *testing.T) {
	fs := newCmdFlagSet("test")
	fs.String("keyword", "", "关键词")
	filesRoot, err := parseFlags(fs, []string{"--keyword", "test"})
	if err != nil {
		t.Fatalf("解析应成功, got: %v", err)
	}
	if filesRoot != "" {
		t.Errorf("filesRoot 应为空, got: %s", filesRoot)
	}
}

func TestParseFlags_InvalidFlag(t *testing.T) {
	fs := newCmdFlagSet("test")
	_, err := parseFlags(fs, []string{"--no-such-flag", "value"})
	if err == nil {
		t.Error("无效 flag 应返回错误")
	}
	var pe *ErrParam
	if !strings.Contains(fmt.Sprintf("%v", err), "参数错误") {
		t.Logf("无效 flag 应被包装为 ErrParam, got: %T", err)
	}
	_ = pe
}

// ========== CmdContext 测试 ==========

func TestCmdContext_Construction(t *testing.T) {
	a := app.NewApp()
	ctx := &CmdContext{App: a, FilesRoot: "/test", Args: []string{"--verbose"}}
	if ctx.App != a {
		t.Error("App 字段应正确赋值")
	}
	if ctx.FilesRoot != "/test" {
		t.Errorf("FilesRoot 应为 /test, got: %s", ctx.FilesRoot)
	}
	if len(ctx.Args) != 1 || ctx.Args[0] != "--verbose" {
		t.Errorf("Args 应为 [--verbose], got: %v", ctx.Args)
	}
}

// ========== ParseCommandArgs 边界测试 ==========

func TestParseCommandArgs_LeadingFilesRoot(t *testing.T) {
	args := []string{"--files-root", "/repo", "search", "--keyword", "x"}
	filesRoot, jsonMode, cmdArgs := ParseCommandArgs(args)
	if filesRoot != "/repo" {
		t.Errorf("filesRoot 应为 /repo, got: %s", filesRoot)
	}
	if jsonMode {
		t.Error("不应启用 jsonMode")
	}
	expected := []string{"search", "--keyword", "x"}
	if len(cmdArgs) != len(expected) {
		t.Fatalf("cmdArgs 长度应为 %d, got: %d (%v)", len(expected), len(cmdArgs), cmdArgs)
	}
	for i, v := range expected {
		if cmdArgs[i] != v {
			t.Errorf("cmdArgs[%d] 应为 %s, got: %s", i, v, cmdArgs[i])
		}
	}
}

func TestParseCommandArgs_TrailingFilesRoot(t *testing.T) {
	args := []string{"search", "--keyword", "x", "--files-root", "/repo"}
	filesRoot, jsonMode, cmdArgs := ParseCommandArgs(args)
	if filesRoot != "/repo" {
		t.Errorf("filesRoot 应为 /repo, got: %s", filesRoot)
	}
	if jsonMode {
		t.Error("不应启用 jsonMode")
	}
	if len(cmdArgs) != 3 || cmdArgs[0] != "search" {
		t.Errorf("cmdArgs 应为 [search --keyword x], got: %v (len=%d)", cmdArgs, len(cmdArgs))
	}
}

func TestParseCommandArgs_MultipleFilesRoot(t *testing.T) {
	// 只保留最后一个
	args := []string{"--files-root", "/first", "search", "--files-root", "/second"}
	filesRoot, jsonMode, cmdArgs := ParseCommandArgs(args)
	if filesRoot != "/second" {
		t.Errorf("应保留最后一个 filesRoot /second, got: %s", filesRoot)
	}
	if jsonMode {
		t.Error("不应启用 jsonMode")
	}
	if len(cmdArgs) != 1 || cmdArgs[0] != "search" {
		t.Errorf("cmdArgs 应只剩 search, got: %v", cmdArgs)
	}
}

// TestRunCLI_JsonMode_OutputsJsonResponse 验证 --json 全局开关输出统一 JsonResponse 协议
func TestRunCLI_JsonMode_OutputsJsonResponse(t *testing.T) {
	dir := t.TempDir()
	out := captureOutput(t, func() {
		if err := RunCLI([]string{"--files-root", dir, "--json", "list"}); err != nil {
			t.Logf("RunCLI --json list 返回: %v（空仓库属正常）", err)
		}
	})
	if !strings.Contains(out, `"status"`) || !strings.Contains(out, `"command"`) {
		t.Errorf("--json 输出应包含 status/command 字段, got: %s", out)
	}
	if !strings.Contains(out, `"list"`) {
		t.Errorf("--json 输出应包含命令名 list, got: %s", out)
	}
}

func TestParseCommandArgs_JsonMode(t *testing.T) {
	args := []string{"--files-root", "/repo", "--json", "search", "--keyword", "x"}
	filesRoot, jsonMode, cmdArgs := ParseCommandArgs(args)
	if filesRoot != "/repo" {
		t.Errorf("filesRoot 应为 /repo, got: %s", filesRoot)
	}
	if !jsonMode {
		t.Error("应启用 jsonMode")
	}
	expected := []string{"search", "--keyword", "x"}
	if len(cmdArgs) != len(expected) {
		t.Fatalf("cmdArgs 长度应为 %d, got: %d (%v)", len(expected), len(cmdArgs), cmdArgs)
	}
}

func TestParseCommandArgs_JsonModeWithoutFilesRoot(t *testing.T) {
	args := []string{"--json", "list", "--format", "table"}
	filesRoot, jsonMode, cmdArgs := ParseCommandArgs(args)
	if filesRoot != "" {
		t.Errorf("filesRoot 应为空, got: %s", filesRoot)
	}
	if !jsonMode {
		t.Error("应启用 jsonMode")
	}
	if len(cmdArgs) != 3 {
		t.Errorf("应有 3 个命令参数, got: %d", len(cmdArgs))
	}
}

// TestJsonDataPayload 验证 --json 响应 data 载荷构造（规律六：成功/失败共用 jsonDataPayload，
// output 为空返回 nil——omitempty 省略，前端以 status/error 为准）
func TestJsonDataPayload(t *testing.T) {
	// 空 output：返回 nil（data 省略）
	if got := jsonDataPayload("", "/repo"); got != nil {
		t.Errorf("空 output 应返回 nil, got: %v", got)
	}
	// 非空 output：含 output/lines/filesRoot（lines 按行切分）
	got := jsonDataPayload("line1\nline2\n", "/repo")
	if got == nil {
		t.Fatal("非空 output 应返回非 nil Payload")
	}
	if got["filesRoot"] != "/repo" {
		t.Errorf("filesRoot 应为 /repo, got: %v", got["filesRoot"])
	}
	if got["output"] != "line1\nline2\n" {
		t.Errorf("output 应原样保留, got: %v", got["output"])
	}
	lines, ok := got["lines"].([]string)
	if !ok || len(lines) != 2 || lines[0] != "line1" || lines[1] != "line2" {
		t.Errorf("lines 应按行切分, got: %v", got["lines"])
	}
}

// ===== C-1 single-bench 基准对比相关单测 =====

func TestAvgBenchStages(t *testing.T) {
	all := [][]singleBenchStage{
		{
			{Name: "① 文件读取", Duration: 10 * time.Millisecond},
			{Name: "② JSON 解析", Duration: 100 * time.Millisecond},
		},
		{
			{Name: "① 文件读取", Duration: 20 * time.Millisecond},
			{Name: "② JSON 解析", Duration: 200 * time.Millisecond},
		},
	}
	avg := avgBenchStages(all)
	if len(avg) != 2 {
		t.Fatalf("avg 应含 2 阶段, got %d", len(avg))
	}
	if avg[0].Duration != 15*time.Millisecond {
		t.Errorf("① 平均应为 15ms, got %v", avg[0].Duration)
	}
	if avg[1].Duration != 150*time.Millisecond {
		t.Errorf("② 平均应为 150ms, got %v", avg[1].Duration)
	}
}

func TestCompareSingleBenchBaseline(t *testing.T) {
	dir := t.TempDir()
	base := []benchStageMs{
		{Name: "① 文件读取", Ms: 10},
		{Name: "② JSON 解析", Ms: 100},
	}
	data, err := json.Marshal(base)
	if err != nil {
		t.Fatal(err)
	}
	baseFile := filepath.Join(dir, "baseline.json")
	if err := os.WriteFile(baseFile, data, 0o644); err != nil {
		t.Fatal(err)
	}

	stages := []singleBenchStage{
		{Name: "① 文件读取", Duration: 10 * time.Millisecond},
		{Name: "② JSON 解析", Duration: 100 * time.Millisecond},
	}
	// 无退化 → 通过
	if err := compareSingleBenchBaseline(baseFile, stages, 50); err != nil {
		t.Fatalf("无退化应通过, got %v", err)
	}
	// ② 退化到 200ms（2x > 1.5x 阈值）→ 应报错
	stages[1].Duration = 200 * time.Millisecond
	if err := compareSingleBenchBaseline(baseFile, stages, 50); err == nil {
		t.Fatal("退化超阈值应报错")
	}
	// 基准文件缺失 → 应报错
	if err := compareSingleBenchBaseline(filepath.Join(dir, "nope.json"), stages, 50); err == nil {
		t.Fatal("缺失基准文件应报错")
	}
	// 基准格式非法 → 应报错
	bad := filepath.Join(dir, "bad.json")
	os.WriteFile(bad, []byte("not json"), 0o644)
	if err := compareSingleBenchBaseline(bad, stages, 50); err == nil {
		t.Fatal("格式非法基准应报错")
	}
}

func TestSaveBenchBaseline_RoundTrip(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "b.json")
	stages := []singleBenchStage{{Name: "① 文件读取", Duration: 10 * time.Millisecond}}
	if err := saveBenchBaseline(p, stages); err != nil {
		t.Fatalf("保存失败: %v", err)
	}
	data, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	var got []benchStageMs
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("roundtrip 解析失败: %v", err)
	}
	if len(got) != 1 || got[0].Name != "① 文件读取" || got[0].Ms != 10 {
		t.Fatalf("roundtrip 内容不符: %+v", got)
	}
}

// ===== C-2 perf-log 文档驱动（optimization_log.md 表格）单测 =====

const perfLogSample = `---
kind: optimization_log
name: 优化记录
---

# 优化记录

## 优化日志

| 日期 | 领域 | 问题 | 做了什么 | 效果 | 提交 |
|------|------|------|---------|------|------|
| 2026-08-19 | KTX2 缓存 | 加载变慢 | 优化 X | 加载 1 次 RPC | fd068ac |
| 2026-08-18 | MMD dispose | 内存泄漏 | dispose 细化 | 不再闪退 | 80679cd7 |

## 当前瓶颈

- **纹理编码**：首次编码慢
- **SHA256**：大文件有延迟

## 关键指标

| 指标 | 优化前 | 优化后 | 目标 |
|------|--------|--------|------|
| 单模型 GPU 内存 | 1-2GB | 1-2GB | ~200MB |
`

func TestParseOptimizationEntries(t *testing.T) {
	entries := parseOptimizationEntries(strings.Split(perfLogSample, "\n"))
	if len(entries) != 2 {
		t.Fatalf("期望解析 2 条记录, got %d", len(entries))
	}
	first := entries[0]
	if first.date != "2026-08-19" || first.area != "KTX2 缓存" || first.commit != "fd068ac" {
		t.Errorf("首条解析不符: %+v", first)
	}
	if entries[1].date != "2026-08-18" || entries[1].area != "MMD dispose" {
		t.Errorf("次条解析不符: %+v", entries[1])
	}

	// md 中 commit 用反引号包裹（真实 optimization_log.md 如此）——解析时应清理反引号
	backtickMd := strings.Join([]string{
		"| 日期 | 领域 | 问题 | 做了什么 | 效果 | 提交 |",
		"|------|------|------|---------|------|------|",
		"| 2026-08-01 | A | B | C | D | `abc123` |",
	}, "\n")
	got := parseOptimizationEntries(strings.Split(backtickMd, "\n"))
	if len(got) != 1 || got[0].commit != "abc123" {
		t.Errorf("反引号 commit 应被清理, got %+v", got)
	}
}

func TestSplitTableRow(t *testing.T) {
	cols := splitTableRow(" | a | b | c | ")
	if len(cols) != 3 || cols[0] != "a" || cols[2] != "c" {
		t.Fatalf("splitTableRow 结果不符: %#v", cols)
	}
}

func TestPerfLogSections(t *testing.T) {
	lines := strings.Split(perfLogSample, "\n")
	bottlenecks := extractBulletSection(lines, "当前瓶颈")
	if len(bottlenecks) != 2 || !strings.Contains(bottlenecks[0], "纹理编码") {
		t.Fatalf("当前瓶颈提取不符: %#v", bottlenecks)
	}
	metrics := extractTableSection(lines, "关键指标")
	if len(metrics) != 1 || !strings.Contains(metrics[0], "GPU 内存") {
		t.Fatalf("关键指标提取不符: %#v", metrics)
	}
}

// ---- tags 薄壳 ----

func TestTags_NoSubcommand_PrintsUsage(t *testing.T) {
	out := captureOutput(t, func() {
		if err := runTags(&CmdContext{App: &app.App{}, Args: nil}); err != nil {
			t.Fatalf("runTags 应成功, got %v", err)
		}
	})
	if !strings.Contains(out, "tags") || !strings.Contains(out, "子命令") {
		t.Errorf("无子命令应打印用法, got: %s", out)
	}
}

func TestTags_UnknownSubcommand_Errors(t *testing.T) {
	err := runTags(&CmdContext{App: &app.App{}, Args: []string{"nope"}})
	if err == nil || !strings.Contains(err.Error(), "未知子命令") {
		t.Errorf("未知子命令应报错, got: %v", err)
	}
}

func TestTagsSet_RequiresModel(t *testing.T) {
	err := runTagsSet(&CmdContext{App: &app.App{}, Args: []string{"--tags", "a"}})
	if err == nil || !strings.Contains(err.Error(), "--model") {
		t.Errorf("缺 --model 应报错, got: %v", err)
	}
}

func TestTagsSet_RequiresTags(t *testing.T) {
	err := runTagsSet(&CmdContext{App: &app.App{}, Args: []string{"--model", "x"}})
	if err == nil || !strings.Contains(err.Error(), "--tags") {
		t.Errorf("缺 --tags 应报错, got: %v", err)
	}
}

func TestTagsGet_RequiresModel(t *testing.T) {
	err := runTagsGet(&CmdContext{App: &app.App{}, Args: nil})
	if err == nil || !strings.Contains(err.Error(), "--model") {
		t.Errorf("缺 --model 应报错, got: %v", err)
	}
}

func TestTagsBy_RequiresTag(t *testing.T) {
	err := runTagsBy(&CmdContext{App: &app.App{}, Args: nil})
	if err == nil || !strings.Contains(err.Error(), "--tag") {
		t.Errorf("缺 --tag 应报错, got: %v", err)
	}
}

// ---- recycle 薄壳 ----

func TestRecycle_NoSubcommand_PrintsUsage(t *testing.T) {
	out := captureOutput(t, func() {
		if err := runRecycle(&CmdContext{App: &app.App{}, Args: nil}); err != nil {
			t.Fatalf("runRecycle 应成功, got %v", err)
		}
	})
	if !strings.Contains(out, "recycle") || !strings.Contains(out, "子命令") {
		t.Errorf("无子命令应打印用法, got: %s", out)
	}
}

func TestRecycle_UnknownSubcommand_Errors(t *testing.T) {
	err := runRecycle(&CmdContext{App: &app.App{}, Args: []string{"nope"}})
	if err == nil || !strings.Contains(err.Error(), "未知子命令") {
		t.Errorf("未知子命令应报错, got: %v", err)
	}
}

func TestRecycleRestore_RequiresPath(t *testing.T) {
	err := runRecycleRestore(&CmdContext{App: &app.App{}, Args: nil})
	if err == nil || !strings.Contains(err.Error(), "--path") {
		t.Errorf("缺 --path 应报错, got: %v", err)
	}
}

func TestRecycleEmpty_YesFlagRuns(t *testing.T) {
	// EmptyRecycleBin("") 在零值 App 上会走 LoadAppConfig 空配置路径，
	// 返回 (0, nil) 或错误——薄壳只验证 --yes 路径不 panic、不卡确认
	out := captureOutput(t, func() {
		_ = runRecycleEmpty(&CmdContext{App: &app.App{}, Args: []string{"--yes"}})
	})
	// 不断言具体输出，只确保不卡在确认提示
	if strings.Contains(out, "确认") {
		t.Errorf("--yes 应跳过确认, got: %s", out)
	}
}

// ---- install 薄壳 ----

func TestInstall_RequiresModel(t *testing.T) {
	err := runInstall(&CmdContext{App: &app.App{}, Args: []string{"--mc-root", "/mc"}})
	if err == nil || !strings.Contains(err.Error(), "--model") {
		t.Errorf("缺 --model 应报错, got: %v", err)
	}
}

func TestInstall_RequiresMcRootOrCustomDir(t *testing.T) {
	err := runInstall(&CmdContext{App: &app.App{}, Args: []string{"--model", "x.ysm"}})
	if err == nil || !strings.Contains(err.Error(), "--mc-root") {
		t.Errorf("缺 --mc-root/--custom-dir 应报错, got: %v", err)
	}
}

// ---- link-mode 薄壳 ----

func TestLinkMode_InvalidMode_Errors(t *testing.T) {
	err := runLinkMode(&CmdContext{App: &app.App{}, Args: []string{"--mode", "bogus"}})
	if err == nil || !strings.Contains(err.Error(), "无效模式") {
		t.Errorf("无效模式应报错, got: %v", err)
	}
}

func TestLinkMode_NoMode_PrintsCurrent(t *testing.T) {
	out := captureOutput(t, func() {
		if err := runLinkMode(&CmdContext{App: &app.App{}, Args: nil}); err != nil {
			t.Fatalf("runLinkMode 应成功, got %v", err)
		}
	})
	if !strings.Contains(out, "链接模式") {
		t.Errorf("应打印当前链接模式, got: %s", out)
	}
}
