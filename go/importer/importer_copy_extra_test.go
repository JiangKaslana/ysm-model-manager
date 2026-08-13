// ===== go/importer 复制链错误分支补充单测 =====
// 覆盖 importer.go 中 copyDirContents / copyDir / copyFile 的失败分支：
// 源不可读（ReadDir/Open 失败）、目标路径被目录/文件占位（MkdirAll/Create/Symlink 失败）、
// 子目录递归错误上抛、复制源为目录时 io.Copy 失败与半截文件清理。
// 需要 Windows 共享锁触发的分支见 importer_copy_lock_windows_test.go。
package importer

import (
	"os"
	"path/filepath"
	"testing"
)

// ===== copyDirContents =====

func TestCopyDirContents_ReadDirError(t *testing.T) {
	base := t.TempDir()
	srcFile := filepath.Join(base, "afile")
	_ = os.WriteFile(srcFile, []byte("x"), 0644)
	if err := copyDirContents(srcFile, filepath.Join(base, "out")); err == nil {
		t.Fatal("源为文件时 ReadDir 应失败")
	}
}

func TestCopyDirContents_MkdirAllError(t *testing.T) {
	// 源子目录在目标侧被文件占位 → MkdirAll 失败
	base := t.TempDir()
	src := filepath.Join(base, "src")
	_ = os.MkdirAll(filepath.Join(src, "d"), 0755)
	_ = os.WriteFile(filepath.Join(src, "a.txt"), []byte("a"), 0644)
	dst := filepath.Join(base, "out")
	_ = os.MkdirAll(dst, 0755)
	_ = os.WriteFile(filepath.Join(dst, "d"), []byte("blocker"), 0644)
	if err := copyDirContents(src, dst); err == nil {
		t.Fatal("dst/d 被文件占位时 MkdirAll 应失败")
	}
}

func TestCopyDirContents_RecursionError(t *testing.T) {
	// 子目录递归中 copyFile 失败（dst/d/f 被目录占位 → os.Create 失败）→ 递归错误上抛
	base := t.TempDir()
	src := filepath.Join(base, "src")
	_ = os.MkdirAll(filepath.Join(src, "d"), 0755)
	_ = os.WriteFile(filepath.Join(src, "a.txt"), []byte("a"), 0644)
	_ = os.WriteFile(filepath.Join(src, "d", "f"), []byte("f"), 0644)
	dst := filepath.Join(base, "out")
	_ = os.MkdirAll(filepath.Join(dst, "d", "f"), 0755)
	if err := copyDirContents(src, dst); err == nil {
		t.Fatal("递归复制应失败")
	}
	// 顶层文件应已复制（递归失败前的部分成果）
	if _, err := os.Stat(filepath.Join(dst, "a.txt")); err != nil {
		t.Fatalf("递归失败前复制的文件应存在: %v", err)
	}
}

func TestCopyDirContents_CopyFileError(t *testing.T) {
	// 顶层文件在目标侧被目录占位 → copyFile 的 os.Create 失败
	base := t.TempDir()
	src := filepath.Join(base, "src")
	_ = os.MkdirAll(src, 0755)
	_ = os.WriteFile(filepath.Join(src, "f"), []byte("f"), 0644)
	dst := filepath.Join(base, "out")
	_ = os.MkdirAll(dst, 0755)
	_ = os.MkdirAll(filepath.Join(dst, "f"), 0755)
	if err := copyDirContents(src, dst); err == nil {
		t.Fatal("copyFile 应失败")
	}
}

func TestCopyDirContents_SymlinkDirCollision(t *testing.T) {
	// 目录链接在目标侧被文件占位 → os.Symlink 失败（EEXIST）
	base := t.TempDir()
	src := filepath.Join(base, "src")
	_ = os.MkdirAll(filepath.Join(src, "sub"), 0755)
	_ = os.WriteFile(filepath.Join(src, "sub", "real.txt"), []byte("r"), 0644)
	if err := os.Symlink(filepath.Join(src, "sub"), filepath.Join(src, "dir-link")); err != nil {
		t.Skipf("环境不支持创建符号链接: %v", err)
	}
	dst := filepath.Join(base, "out")
	_ = os.MkdirAll(dst, 0755)
	_ = os.WriteFile(filepath.Join(dst, "dir-link"), []byte("blocker"), 0644)
	if err := copyDirContents(src, dst); err == nil {
		t.Fatal("链接目标被占位时 os.Symlink 应失败")
	}
}

func TestCopyDirContents_SymlinkFileCollision(t *testing.T) {
	// 文件链接在目标侧被目录占位 → os.Symlink 失败
	base := t.TempDir()
	src := filepath.Join(base, "src")
	_ = os.MkdirAll(src, 0755)
	_ = os.WriteFile(filepath.Join(src, "file.txt"), []byte("f"), 0644)
	if err := os.Symlink(filepath.Join(src, "file.txt"), filepath.Join(src, "file-link")); err != nil {
		t.Skipf("环境不支持创建符号链接: %v", err)
	}
	dst := filepath.Join(base, "out")
	_ = os.MkdirAll(dst, 0755)
	_ = os.MkdirAll(filepath.Join(dst, "file-link"), 0755)
	if err := copyDirContents(src, dst); err == nil {
		t.Fatal("链接目标被占位时 os.Symlink 应失败")
	}
}

// ===== copyDir =====

func TestCopyDir_MkdirTempError(t *testing.T) {
	// dst 父级是文件 → MkdirTemp 失败
	base := t.TempDir()
	src := filepath.Join(base, "src")
	_ = os.MkdirAll(src, 0755)
	blocker := filepath.Join(base, "afile")
	_ = os.WriteFile(blocker, []byte("x"), 0644)
	if err := copyDir(src, filepath.Join(blocker, "sub", "out")); err == nil {
		t.Fatal("dst 父级为文件时 MkdirTemp 应失败")
	}
}

func TestCopyDir_CopyErrorKeepsDst(t *testing.T) {
	// 源为文件 → ReadDir 失败；临时目录应被清理，既有目标不受影响
	base := t.TempDir()
	srcFile := filepath.Join(base, "afile")
	_ = os.WriteFile(srcFile, []byte("x"), 0644)
	dst := filepath.Join(base, "out")
	_ = os.MkdirAll(dst, 0755)
	_ = os.WriteFile(filepath.Join(dst, "keep.txt"), []byte("keep"), 0644)
	if err := copyDir(srcFile, dst); err == nil {
		t.Fatal("源为文件时 copyDir 应失败")
	}
	if _, err := os.Stat(filepath.Join(dst, "keep.txt")); err != nil {
		t.Fatalf("既有目标不应被影响: %v", err)
	}
	if n := globCount(t, base, ".tmp_import_*"); n != 0 {
		t.Fatalf("失败后不应残留临时目录，实际 %d 个", n)
	}
}

// ===== copyFile =====

func TestCopyFile_IOCopyErrorCleanup(t *testing.T) {
	// 源为目录：os.Open 成功但 io.Copy 失败（Windows: Incorrect function；Unix: EISDIR）
	// → 半截目标文件应被清理，不留损坏文件
	base := t.TempDir()
	srcDir := filepath.Join(base, "srcdir")
	_ = os.MkdirAll(srcDir, 0755)
	dst := filepath.Join(base, "out", "f.txt")
	if err := copyFile(srcDir, dst); err == nil {
		t.Fatal("复制目录句柄应报错")
	}
	if _, err := os.Stat(dst); !os.IsNotExist(err) {
		t.Fatalf("失败后半截目标文件应被清理: %v", err)
	}
}
