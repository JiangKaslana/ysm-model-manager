// ===== go/updater InstallUpdate 安全错误路径补测 =====
// 只测「在触碰真实 exe 前返回错误」的路径：
// 1. zip 内无 YSM-Model-Manager.exe
// 2. exe 条目内容不是 PE 魔数（非 "MZ" 开头）
// 3. exe 条目超过 200MB 解压上限（截断拒绝，不写盘半成品）
// 绝不执行到真实替换 / helper 启动 / os.Exit 路径。
// 附加覆盖：zip 循环内的异常路径跳过、alwaysOverwrite 提取失败告警、
// createIfMissing 已存在跳过。
package updater

import (
	"archive/zip"
	"bytes"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// makeZipFile 构造包含指定条目的临时 zip（条目名 → 内容），返回 zip 路径
func makeZipFile(t *testing.T, entries map[string]string) string {
	t.Helper()
	zipPath := filepath.Join(t.TempDir(), "update.zip")
	f, err := os.Create(zipPath)
	if err != nil {
		t.Fatal(err)
	}
	zw := zip.NewWriter(f)
	for name, content := range entries {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	return zipPath
}

// TestInstallUpdate_NoExeInZip 覆盖 zip 打开成功但无 YSM-Model-Manager.exe：
// 循环内普通文件跳过、异常路径（..）跳过、exeInZip==nil 报错
func TestInstallUpdate_NoExeInZip(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("仅 Windows")
	}
	zipPath := makeZipFile(t, map[string]string{
		"random.txt": "not special",
		"..":         "path traversal attempt",
	})
	err := InstallUpdate(zipPath)
	if err == nil {
		t.Fatal("zip 内无 exe 应报错")
	}
	if !strings.Contains(err.Error(), "YSM-Model-Manager.exe") {
		t.Errorf("错误信息应指明缺失的 exe 名, got %v", err)
	}
}

// TestInstallUpdate_InvalidExeContent 覆盖 exe 条目存在但内容非 PE 魔数：
// 解压到临时目录 → 校验失败 → 清理临时目录（不触碰真实 exe）
func TestInstallUpdate_InvalidExeContent(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("仅 Windows")
	}
	// 在测试二进制同目录（exeDir）预置碰撞：
	// - ysm-cli.exe 以目录存在 → alwaysOverwrite 提取失败（写不入盘）→ 告警日志
	exe, err := os.Executable()
	if err != nil {
		t.Skip("无法获取可执行路径")
	}
	exeDir := filepath.Dir(exe)
	collideDir := filepath.Join(exeDir, "ysm-cli.exe")
	if err := os.MkdirAll(collideDir, 0755); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Remove(collideDir) })

	zipPath := makeZipFile(t, map[string]string{
		"YSM-Model-Manager.exe": "this is not a PE binary",
		"ysm-cli.exe":           "fake cli",
		"workshop_sites.json":   `[]`,
		"..":                    "path traversal attempt",
	})
	err = InstallUpdate(zipPath)
	if err == nil {
		t.Fatal("非 PE 内容的 exe 应报错")
	}
	if !strings.Contains(err.Error(), "有效 Windows 程序") {
		t.Errorf("错误信息应提示 PE 校验失败, got %v", err)
	}
	// 纯 exe 语义：zip 内 JSON 数据文件不应被提取到 exe 旁
	if _, err := os.Stat(filepath.Join(exeDir, "workshop_sites.json")); err == nil {
		t.Error("数据 JSON 不应再被提取到 exe 旁（纯 exe 发布）")
	}
}

// TestInstallUpdate_CliAlwaysOverwrite 覆盖 alwaysOverwrite 的提取成功分支：
// ysm-cli.exe 在 exeDir 缺失 → 从 zip 解压覆盖（写入测试二进制同目录，随即清理），
// 随后 PE 校验失败提前返回，不触碰真实 exe
func TestInstallUpdate_CliAlwaysOverwrite(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("仅 Windows")
	}
	exe, err := os.Executable()
	if err != nil {
		t.Skip("无法获取可执行路径")
	}
	exeDir := filepath.Dir(exe)
	dest := filepath.Join(exeDir, "ysm-cli.exe")
	t.Cleanup(func() { os.Remove(dest) })

	zipPath := makeZipFile(t, map[string]string{
		"YSM-Model-Manager.exe": "not a PE binary",
		"ysm-cli.exe":           "fake cli binary",
	})
	err = InstallUpdate(zipPath)
	if err == nil {
		t.Fatal("非 PE 内容的 exe 应报错")
	}
	data, err := os.ReadFile(dest)
	if err != nil {
		t.Fatalf("ysm-cli.exe 应已解压覆盖: %v", err)
	}
	if !strings.Contains(string(data), "fake cli") {
		t.Errorf("覆盖内容不符: %s", data)
	}
}

// TestInstallUpdate_OversizedExe 覆盖 exe 条目超过 200MB 解压上限：
// extractZipFile 截断检测拒绝 → 「解压 exe 失败」→ 清理临时目录
// 全零数据压缩后 zip 本体很小，仅解压阶段写约 200MB 到临时目录（本地回环秒级）
func TestInstallUpdate_OversizedExe(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("仅 Windows")
	}
	zipPath := filepath.Join(t.TempDir(), "update.zip")
	f, err := os.Create(zipPath)
	if err != nil {
		t.Fatal(err)
	}
	zw := zip.NewWriter(f)
	w, err := zw.Create("YSM-Model-Manager.exe")
	if err != nil {
		t.Fatal(err)
	}
	// 一次性写入 (200MB+1) 零字节：zip 层压缩后极小，解压时触发截断
	over := (200 << 20) + 1
	chunk := bytes.Repeat([]byte{0}, 256<<10)
	for written := 0; written < over; written += len(chunk) {
		n := len(chunk)
		if remaining := over - written; remaining < n {
			n = remaining
		}
		if _, err := w.Write(chunk[:n]); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}

	err = InstallUpdate(zipPath)
	if err == nil {
		t.Fatal("超大 exe 条目应报错")
	}
	if !strings.Contains(err.Error(), "解压 exe 失败") {
		t.Errorf("错误信息应指向解压失败, got %v", err)
	}
}
