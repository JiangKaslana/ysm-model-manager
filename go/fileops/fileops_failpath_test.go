// ===== go/fileops 失败路径补测（ADR-003 P3 补充）=====
package fileops

import (
	"os"
	"path/filepath"
	"testing"
)

// TestCopyModelFile_SourceNotFound：src 不存在时应报错（非 nil）。
func TestCopyModelFile_SourceNotFound(t *testing.T) {
	root := t.TempDir()
	src := filepath.Join(root, "no-such-file.ysm")
	dst := filepath.Join(root, "sub")
	if err := CopyModelFile(root, src, dst); err == nil {
		t.Fatalf("源文件不存在应报错，实际: %v", err)
	}
}

// TestCopyModelFile_SourceIsDir：src 是目录时的行为验证。
// 注：源码支持目录递归复制（copyDirRecursive），此测试验证不会 panic 且行为确定。
func TestCopyModelFile_SourceIsDir(t *testing.T) {
	root := t.TempDir()
	srcDir := filepath.Join(root, "model_dir")
	if err := os.Mkdir(srcDir, 0755); err != nil {
		t.Fatal(err)
	}
	dst := filepath.Join(root, "sub")
	// 目录复制：应成功（copyDirRecursive）而非报错
	if err := CopyModelFile(root, srcDir, dst); err != nil {
		t.Fatalf("目录复制应支持（copyDirRecursive）: %v", err)
	}
	dstFile := filepath.Join(dst, "model_dir")
	if _, err := os.Stat(dstFile); err != nil {
		t.Fatalf("目标目录应已创建: %v", err)
	}
}

// TestCopyModelFile_TargetExists：目标路径已存在时应报错（不覆盖）。
func TestCopyModelFile_TargetExists(t *testing.T) {
	root := t.TempDir()
	src := filepath.Join(root, "a.ysm")
	if err := os.WriteFile(src, []byte("hello"), 0644); err != nil {
		t.Fatal(err)
	}
	dstDir := filepath.Join(root, "sub")
	// 先成功复制一次
	if err := CopyModelFile(root, src, dstDir); err != nil {
		t.Fatalf("首次复制应成功: %v", err)
	}
	// 再次复制同一源到同一目标 → 应报错（目标已存在）
	if err := CopyModelFile(root, src, dstDir); err == nil {
		t.Fatal("目标已存在应报错")
	}
}

// TestCopyModelFile_DstDirCreated：dstDir 不存在时自动创建并成功复制。
func TestCopyModelFile_DstDirCreated(t *testing.T) {
	root := t.TempDir()
	src := filepath.Join(root, "a.ysm")
	if err := os.WriteFile(src, []byte("content"), 0644); err != nil {
		t.Fatal(err)
	}
	dstDir := filepath.Join(root, "new_sub")
	// dstDir 不存在，应自动创建
	if err := CopyModelFile(root, src, dstDir); err != nil {
		t.Fatalf("dstDir 不存在时应自动创建并成功: %v", err)
	}
	dst := filepath.Join(dstDir, "a.ysm")
	data, err := os.ReadFile(dst)
	if err != nil {
		t.Fatalf("目标文件应存在: %v", err)
	}
	if string(data) != "content" {
		t.Fatalf("内容不匹配: got %q, want %q", data, "content")
	}
}

// TestReadLimitedFile_Normal：小文件正常读取，返回非 nil。
func TestReadLimitedFile_Normal(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "small.txt")
	payload := []byte("hello world")
	if err := os.WriteFile(path, payload, 0644); err != nil {
		t.Fatal(err)
	}
	data := readLimitedFile(path)
	if data == nil {
		t.Fatal("正常小文件应返回非 nil")
	}
	if string(data) != string(payload) {
		t.Fatalf("内容不匹配: got %q, want %q", data, payload)
	}
}

// TestReadLimitedFile_Empty：空文件读取不 panic，允许返回 nil 或空 slice。
func TestReadLimitedFile_Empty(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "empty.txt")
	if err := os.WriteFile(path, []byte{}, 0644); err != nil {
		t.Fatal(err)
	}
	data := readLimitedFile(path)
	// 只要不 panic 即通过；空文件结果视 fsutil.ReadLimitedEntry 实现
	_ = data
}

// TestReadLimitedFile_NonExistent：不存在的文件返回 nil，不 panic。
func TestReadLimitedFile_NonExistent(t *testing.T) {
	data := readLimitedFile("/nonexistent/path/does/not/exist.txt")
	if data != nil {
		t.Fatalf("不存在文件应返回 nil，实际: %v", data)
	}
}
