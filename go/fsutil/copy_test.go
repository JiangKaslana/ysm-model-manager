// ===== fsutil.CopyFile / CopyDirRecursive / relJoin 直测（ADR-044 策略 A 收敛后补测：
// 原子复制为数据安全不变量，失败分支清理必须可检测，防残留回归）=====
package fsutil

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestCopyFile_Success(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src.txt")
	dst := filepath.Join(dir, "sub", "dst.txt")
	if err := os.WriteFile(src, []byte("hello world"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := CopyFile(src, dst); err != nil {
		t.Fatalf("CopyFile 失败: %v", err)
	}
	data, err := os.ReadFile(dst)
	if err != nil || string(data) != "hello world" {
		t.Fatalf("内容不符: %q %v", string(data), err)
	}
	// 父目录自动创建
	fi, err := os.Stat(filepath.Join(dir, "sub"))
	if err != nil || !fi.IsDir() {
		t.Fatal("父目录未创建")
	}
	// 权限：Windows 映射 0666，其他平台 0644
	want := os.FileMode(0644)
	if runtime.GOOS == "windows" {
		want = 0666
	}
	got, err := os.Stat(dst)
	if err != nil {
		t.Fatal(err)
	}
	if got.Mode().Perm() != want {
		t.Errorf("权限应为 %o，实际 %o", want, got.Mode().Perm())
	}
	// 成功路径不得残留 .copy-*.tmp
	matches, _ := filepath.Glob(filepath.Join(dir, "sub", ".copy-*.tmp"))
	if len(matches) != 0 {
		t.Fatalf("成功路径不应残留临时文件: %v", matches)
	}
}

func TestCopyFile_SrcNotFound(t *testing.T) {
	dir := t.TempDir()
	err := CopyFile(filepath.Join(dir, "nope.txt"), filepath.Join(dir, "dst.txt"))
	if err == nil {
		t.Fatal("源文件不存在应报错")
	}
}

func TestCopyFile_DstDirIsFile(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src.txt")
	blocker := filepath.Join(dir, "blocker")
	if err := os.WriteFile(src, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(blocker, []byte("block"), 0644); err != nil {
		t.Fatal(err)
	}
	err := CopyFile(src, filepath.Join(blocker, "dst.txt"))
	if err == nil {
		t.Fatal("目标父目录为文件时应报错")
	}
}

func TestCopyDirRecursive_Success(t *testing.T) {
	src := t.TempDir()
	if err := os.WriteFile(filepath.Join(src, "a.txt"), []byte("AAA"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(src, "sub"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "sub", "b.txt"), []byte("BBB"), 0644); err != nil {
		t.Fatal(err)
	}

	dst := filepath.Join(t.TempDir(), "dst")
	err := CopyDirRecursive(src, dst, CopyDirOptions{Overwrite: true, Rollback: true})
	if err != nil {
		t.Fatalf("CopyDirRecursive 失败: %v", err)
	}
	// 验证文件
	data, err := os.ReadFile(filepath.Join(dst, "a.txt"))
	if err != nil || string(data) != "AAA" {
		t.Fatalf("a.txt 内容不符: %q", string(data))
	}
	data, err = os.ReadFile(filepath.Join(dst, "sub", "b.txt"))
	if err != nil || string(data) != "BBB" {
		t.Fatalf("sub/b.txt 内容不符: %q", string(data))
	}
}

func TestCopyDirRecursive_RejectSymlink(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows 下创建 symlink 需要管理员权限")
	}
	src := t.TempDir()
	if err := os.WriteFile(filepath.Join(src, "target.txt"), []byte("target"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("target.txt", filepath.Join(src, "link.txt")); err != nil {
		t.Fatal(err)
	}

	dst := filepath.Join(t.TempDir(), "dst")
	err := CopyDirRecursive(src, dst, CopyDirOptions{RejectSymlink: true, Overwrite: true})
	if err == nil {
		t.Fatal("RejectSymlink=true 时应拒绝 symlink")
	}
	if !strings.Contains(err.Error(), "拒绝复制符号链接") {
		t.Errorf("错误信息应包含拒绝提示: %v", err)
	}
}

func TestCopyDirRecursive_CopySymlink(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows 下创建 symlink 需要管理员权限")
	}
	src := t.TempDir()
	if err := os.WriteFile(filepath.Join(src, "target.txt"), []byte("target"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("target.txt", filepath.Join(src, "link.txt")); err != nil {
		t.Fatal(err)
	}

	dst := filepath.Join(t.TempDir(), "dst")
	err := CopyDirRecursive(src, dst, CopyDirOptions{RejectSymlink: false, Overwrite: true})
	if err != nil {
		t.Fatalf("复制 symlink 本身应成功: %v", err)
	}
	// 验证 symlink 被复制（保留链接语义）
	fi, err := os.Lstat(filepath.Join(dst, "link.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if fi.Mode()&os.ModeSymlink == 0 {
		t.Error("symlink 应被复制为 symlink，而非普通文件")
	}
}

func TestCopyDirRecursive_OverwriteFalse(t *testing.T) {
	src := t.TempDir()
	if err := os.WriteFile(filepath.Join(src, "a.txt"), []byte("AAA"), 0644); err != nil {
		t.Fatal(err)
	}

	dst := filepath.Join(t.TempDir(), "dst")
	if err := os.MkdirAll(dst, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dst, "a.txt"), []byte("OLD"), 0644); err != nil {
		t.Fatal(err)
	}

	err := CopyDirRecursive(src, dst, CopyDirOptions{Overwrite: false, Rollback: false})
	if err == nil {
		t.Fatal("Overwrite=false 且目标存在时应报错")
	}
	if !strings.Contains(err.Error(), "目标已存在") {
		t.Errorf("错误信息应包含存在提示: %v", err)
	}
}

func TestCopyDirRecursive_RollbackOnFailure(t *testing.T) {
	src := t.TempDir()
	if err := os.WriteFile(filepath.Join(src, "a.txt"), []byte("AAA"), 0644); err != nil {
		t.Fatal(err)
	}
	// 制造第二个文件，其父目录为文件 → CopyFile 失败
	if err := os.WriteFile(filepath.Join(src, "blocker"), []byte("block"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "blocker", "b.txt"), []byte("BBB"), 0644); err == nil {
		// blocker 是文件，WriteFile 到其子路径应失败——但 t.TempDir 下 blocker 是文件
		// 所以这里直接跳过，用另一种方式制造失败
	}

	// 用 Overwrite=false + 预置目标文件来制造失败
	dst := filepath.Join(t.TempDir(), "dst")
	if err := os.MkdirAll(dst, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dst, "a.txt"), []byte("OLD"), 0644); err != nil {
		t.Fatal(err)
	}

	err := CopyDirRecursive(src, dst, CopyDirOptions{Overwrite: false, Rollback: true})
	if err == nil {
		t.Fatal("应报错")
	}
	// Rollback=true 时应清理 dst 目录
	_, err = os.Stat(dst)
	if err == nil {
		t.Error("Rollback=true 时失败后 dst 应被清理")
	}
}

func TestRelJoin(t *testing.T) {
	tests := []struct {
		dst, src, p    string
		expected       string
		expectErr      bool
	}{
		{"/dst", "/src", "/src/a.txt", "/dst/a.txt", false},
		{"/dst", "/src", "/src/sub/b.txt", "/dst/sub/b.txt", false},
		{"/dst", "/src", "/other/x.txt", "", true}, // 不在 src 下
	}
	for _, tt := range tests {
		t.Run("", func(t *testing.T) {
			got, err := relJoin(tt.dst, tt.src, tt.p)
			if tt.expectErr {
				if err == nil {
					t.Error("应报错")
				}
				return
			}
			if err != nil {
				t.Fatalf("不应报错: %v", err)
			}
			if got != tt.expected {
				t.Errorf("relJoin(%q,%q,%q) = %q, 期望 %q", tt.dst, tt.src, tt.p, got, tt.expected)
			}
		})
	}
}