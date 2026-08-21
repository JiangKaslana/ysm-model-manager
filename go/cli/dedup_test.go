// ===== dedup 命令薄壳测试 =====
// 覆盖：父子命令分发 / scan 输出 / count 统计 / clean dry-run 与 --yes 移入回收站。
// 策略：与 cli_test.go 一致——零值 &app.App{} + 临时目录 FilesRoot，不触碰真实用户配置。
package cli

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ysm-model-manager/internal/app"
)

// ---- 父命令分发 ----

func TestDedup_NoSubcommand_PrintsUsage(t *testing.T) {
	out := captureOutput(t, func() {
		if err := runDedup(&CmdContext{App: &app.App{}, Args: nil}); err != nil {
			t.Fatalf("runDedup 无子命令应成功, got %v", err)
		}
	})
	if !strings.Contains(out, "dedup") || !strings.Contains(out, "子命令") {
		t.Errorf("无子命令应打印用法, got: %s", out)
	}
}

func TestDedup_UnknownSubcommand_Errors(t *testing.T) {
	err := runDedup(&CmdContext{App: &app.App{}, Args: []string{"nope"}})
	if err == nil || !strings.Contains(err.Error(), "未知子命令") {
		t.Errorf("未知子命令应报错, got: %v", err)
	}
}

// ---- dedup scan ----

func TestDedupScan_RequiresDir(t *testing.T) {
	err := runDedupScan(&CmdContext{App: &app.App{}, Args: nil})
	if err == nil || !strings.Contains(err.Error(), "--dir") {
		t.Errorf("scan 无 --dir/FilesRoot 应报错, got: %v", err)
	}
}

func TestDedupScan_EmptyDir(t *testing.T) {
	dir := t.TempDir()
	out := captureOutput(t, func() {
		if err := runDedupScan(&CmdContext{App: &app.App{}, FilesRoot: dir, Args: nil}); err != nil {
			t.Fatalf("scan 空目录应成功, got %v", err)
		}
	})
	if !strings.Contains(out, "未发现重复") {
		t.Errorf("空目录应提示「未发现重复」, got: %s", out)
	}
}

func TestDedupScan_Duplicates(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "a.ysm"), []byte("same content"))
	mustWrite(t, filepath.Join(dir, "b.ysm"), []byte("same content"))
	mustWrite(t, filepath.Join(dir, "c.ysm"), []byte("different"))

	out := captureOutput(t, func() {
		if err := runDedupScan(&CmdContext{App: &app.App{}, FilesRoot: dir, Args: []string{"--dir", dir}}); err != nil {
			t.Fatalf("scan 应成功, got %v", err)
		}
	})
	if !strings.Contains(out, "重复组: 1") {
		t.Errorf("应有 1 个重复组, got: %s", out)
	}
	if !strings.Contains(out, "a.ysm") || !strings.Contains(out, "b.ysm") {
		t.Errorf("重复组应列出两个文件, got: %s", out)
	}
	if strings.Contains(out, "c.ysm") {
		t.Errorf("非重复文件不应出现在结果里, got: %s", out)
	}
}

// ---- dedup count ----

func TestDedupCount_EmptyDir(t *testing.T) {
	dir := t.TempDir()
	out := captureOutput(t, func() {
		if err := runDedupCount(&CmdContext{App: &app.App{}, FilesRoot: dir, Args: []string{"--dir", dir}}); err != nil {
			t.Fatalf("count 应成功, got %v", err)
		}
	})
	if !strings.Contains(out, "重复组 0") || !strings.Contains(out, "多余文件 0") {
		t.Errorf("空目录应 0 组 0 多余, got: %s", out)
	}
}

func TestDedupCount_Duplicates(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "a.ysm"), []byte("dup"))
	mustWrite(t, filepath.Join(dir, "b.ysm"), []byte("dup"))
	mustWrite(t, filepath.Join(dir, "c.ysm"), []byte("solo")) // 非重复不应计数

	out := captureOutput(t, func() {
		if err := runDedupCount(&CmdContext{App: &app.App{}, FilesRoot: dir, Args: []string{"--dir", dir}}); err != nil {
			t.Fatalf("count 应成功, got %v", err)
		}
	})
	if !strings.Contains(out, "重复组 1") || !strings.Contains(out, "多余文件 1") {
		t.Errorf("应有 1 组 1 多余文件, got: %s", out)
	}
}

// ---- dedup clean ----

func TestDedupClean_RequiresFilesRoot(t *testing.T) {
	err := runDedupClean(&CmdContext{App: &app.App{}, Args: nil})
	if err == nil || !strings.Contains(err.Error(), "--files-root") {
		t.Errorf("clean 无 FilesRoot 应报错, got: %v", err)
	}
}

// 默认（无 --yes）= dry-run：打印计划，文件必须保留
func TestDedupClean_DryRun_KeepsFiles(t *testing.T) {
	dir := t.TempDir()
	a := filepath.Join(dir, "a.ysm")
	b := filepath.Join(dir, "b.ysm")
	mustWrite(t, a, []byte("dup content"))
	mustWrite(t, b, []byte("dup content"))

	out := captureOutput(t, func() {
		if err := runDedupClean(&CmdContext{App: &app.App{}, FilesRoot: dir, Args: nil}); err != nil {
			t.Fatalf("clean dry-run 应成功, got %v", err)
		}
	})
	if !strings.Contains(out, "dry-run") || !strings.Contains(out, "将移入回收站") {
		t.Errorf("dry-run 应打印计划, got: %s", out)
	}
	// 文件必须原封不动
	if _, err := os.Stat(a); err != nil {
		t.Errorf("dry-run 后文件应保留: %v", err)
	}
	if _, err := os.Stat(b); err != nil {
		t.Errorf("dry-run 后文件应保留: %v", err)
	}
}

// --yes：保留每组第一个（按路径序），其余移入 filesRoot/.recycle
func TestDedupClean_Yes_MovesToRecycle(t *testing.T) {
	dir := t.TempDir()
	a := filepath.Join(dir, "a.ysm")
	b := filepath.Join(dir, "b.ysm")
	mustWrite(t, a, []byte("dup content"))
	mustWrite(t, b, []byte("dup content"))

	out := captureOutput(t, func() {
		if err := runDedupClean(&CmdContext{App: &app.App{}, FilesRoot: dir, Args: []string{"--yes"}}); err != nil {
			t.Fatalf("clean --yes 应成功, got %v", err)
		}
	})
	if !strings.Contains(out, "已移入回收站: 1") {
		t.Errorf("应报告移入回收站 1 个, got: %s", out)
	}
	// 保留 a（路径序第一），b 移入回收站
	if _, err := os.Stat(a); err != nil {
		t.Errorf("保留文件 a.ysm 应存在: %v", err)
	}
	if _, err := os.Stat(b); err == nil {
		t.Error("重复文件 b.ysm 应已被移走")
	}
	if _, err := os.Stat(filepath.Join(dir, ".recycle")); err != nil {
		t.Errorf("回收站目录应存在: %v", err)
	}
}
