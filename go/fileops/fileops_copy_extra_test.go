// ===== copyFile / copyDirRecursive / CopyModelFile 补测 =====
// 覆盖：copyFile 的 Lstat 失败、符号链接源拒绝、MkdirAll 失败、io.Copy 失败
// （源为目录）、Rename 失败（目标为已存在目录）+ 半截 tmp 清理；
// copyDirRecursive 的整树回滚（目标已存在、树内符号链接）；
// CopyModelFile 的 .ban 复制失败回滚（.ban 为符号链接）。
package fileops

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// 断言 dir 下无 .copy-* 临时文件残留（copyFile 失败路径的 defer 清理）
func assertNoCopyTmp(t *testing.T, dir string) {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".copy-") {
			t.Fatalf("失败后应有 .copy-* 临时文件残留: %s", e.Name())
		}
	}
}

// copyFile 源不存在：Lstat 失败直接报错
func TestCopyFile_LstatError(t *testing.T) {
	dir := t.TempDir()
	err := copyFile(filepath.Join(dir, "nope.ysm"), filepath.Join(dir, "dst.ysm"))
	if err == nil {
		t.Fatal("源不存在应报错")
	}
}

// copyFile 源为符号链接：应拒绝（防读取越界）
func TestCopyFile_SymlinkSrcRejected(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "t.txt")
	if err := os.WriteFile(target, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(dir, "l.txt")
	if err := os.Symlink(target, link); err != nil {
		t.Skipf("os.Symlink 不可用（需权限）: %v", err)
	}
	if err := copyFile(link, filepath.Join(dir, "dst.txt")); err == nil {
		t.Fatal("符号链接源应被拒绝")
	}
}

// copyFile 目标父路径组件为文件：MkdirAll 失败应报错
func TestCopyFile_MkdirAllError(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src.txt")
	if err := os.WriteFile(src, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	blocker := filepath.Join(dir, "blocker")
	if err := os.WriteFile(blocker, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := copyFile(src, filepath.Join(blocker, "sub", "dst.txt")); err == nil {
		t.Fatal("目标父路径组件为文件时应报错")
	}
}

// copyFile 源为目录：io.Copy 读目录句柄失败应报错，且无 tmp 残留
func TestCopyFile_SrcIsDir(t *testing.T) {
	dir := t.TempDir()
	sub := filepath.Join(dir, "subdir")
	if err := os.MkdirAll(sub, 0755); err != nil {
		t.Fatal(err)
	}
	if err := copyFile(sub, filepath.Join(dir, "dst.txt")); err == nil {
		t.Fatal("源为目录时应报错（io.Copy 失败）")
	}
	assertNoCopyTmp(t, dir)
}

// copyFile 目标为已存在目录：Rename(tmp, dst) 失败应报错，且 tmp 被清理
func TestCopyFile_RenameOverExistingDir(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src.txt")
	if err := os.WriteFile(src, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	dst := filepath.Join(dir, "dst.txt")
	if err := os.MkdirAll(dst, 0755); err != nil {
		t.Fatal(err)
	}
	if err := copyFile(src, dst); err == nil {
		t.Fatal("目标为已存在目录时应报错（rename 失败）")
	}
	assertNoCopyTmp(t, dir)
	// 目标目录应原样保留
	if fi, err := os.Stat(dst); err != nil || !fi.IsDir() {
		t.Fatalf("目标目录应保留: %v", err)
	}
}

// copyDirRecursive 目标目录内已有同名文件：内层报「目标已存在」→ 整树回滚
func TestCopyDirRecursive_TargetExistsRollsBack(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src")
	if err := os.MkdirAll(src, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "a.ysm"), []byte("A"), 0644); err != nil {
		t.Fatal(err)
	}
	dst := filepath.Join(dir, "dst")
	if err := os.MkdirAll(dst, 0755); err != nil {
		t.Fatal(err)
	}
	// 预置同名目标文件 → 复制应失败
	if err := os.WriteFile(filepath.Join(dst, "a.ysm"), []byte("OLD"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := copyDirRecursive(src, dst); err == nil {
		t.Fatal("目标已存在应报错")
	}
	// 失败后整树回滚：dst 应被完全删除（防半棵树残留卡死重试）
	if _, err := os.Stat(dst); !os.IsNotExist(err) {
		t.Fatalf("复制失败后 dst 应被整树回滚: %v", err)
	}
}

// copyDirRecursive 树内含符号链接：显式拒绝 + 整树回滚
func TestCopyDirRecursive_SymlinkRejected(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src")
	if err := os.MkdirAll(src, 0755); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(dir, "outside.txt")
	if err := os.WriteFile(target, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, filepath.Join(src, "evil.ysm")); err != nil {
		t.Skipf("os.Symlink 不可用（需权限）: %v", err)
	}
	dst := filepath.Join(dir, "dst")
	if err := copyDirRecursive(src, dst); err == nil {
		t.Fatal("树内含符号链接应拒绝")
	}
	if _, err := os.Stat(dst); !os.IsNotExist(err) {
		t.Fatalf("拒绝后 dst 应被整树回滚: %v", err)
	}
}

// CopyModelFile 的 .ban 复制失败（.ban 为符号链接被 copyFile 拒绝）：
// 已复制的 dst 应回滚，错误应透出
func TestCopyModelFile_BanCopySymlinkRejected(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "m.ysm")
	if err := os.WriteFile(src, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	banTarget := filepath.Join(dir, "ban-target.txt")
	if err := os.WriteFile(banTarget, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(banTarget, src+".ban"); err != nil {
		t.Skipf("os.Symlink 不可用（需权限）: %v", err)
	}
	dstDir := filepath.Join(dir, "sub")
	if err := CopyModelFile(dir, src, dstDir); err == nil {
		t.Fatal(".ban 复制失败应透出错误")
	}
	// 已复制的 dst 应被回滚
	if _, err := os.Stat(filepath.Join(dstDir, "m.ysm")); !os.IsNotExist(err) {
		t.Fatalf(".ban 复制失败后 dst 应回滚: %v", err)
	}
}
