//go:build windows

// ===== go/sync 复制中途失败回滚（Windows 共享锁触发）=====
// 以独占方式（share=0）打开源子目录，使 filepath.WalkDir 枚举该目录失败，
// 确定性触发复制中途失败，验证 copyDirRecursive 的两种回滚口径：
//   - dst 为本次新建 → 整树清理（防止半截目录被扫成「截断模型」）
//   - dst 已存在 → 保留旧内容（防误删用户既有模型文件夹）
//
// 非 Windows 平台无共享锁机制，直接跳过。
package sync

import (
	"os"
	"path/filepath"
	"syscall"
	"testing"
)

// lockDirExclusive 以独占方式打开目录（FILE_FLAG_BACKUP_SEMANTICS + share=0），
// 令后续对该目录的枚举（ReadDir）/重命名失败（ERROR_SHARING_VIOLATION）。
// 若环境不执行共享锁语义（ReadDir 仍成功）则 Skip，避免误判。
func lockDirExclusive(t *testing.T, dir string) {
	t.Helper()
	p, err := syscall.UTF16PtrFromString(dir)
	if err != nil {
		t.Skipf("UTF16 转换失败: %v", err)
	}
	h, err := syscall.CreateFile(p, syscall.GENERIC_READ, 0, nil,
		syscall.OPEN_EXISTING, syscall.FILE_FLAG_BACKUP_SEMANTICS, 0)
	if err != nil {
		t.Skipf("独占打开目录失败: %v", err)
	}
	// 探针：锁应令 ReadDir 失败，否则该环境不执行共享锁语义，跳过测试
	if _, err := os.ReadDir(dir); err == nil {
		syscall.CloseHandle(h)
		t.Skip("环境未执行共享锁（ReadDir 仍成功），跳过")
	}
	t.Cleanup(func() { syscall.CloseHandle(h) })
}

// TestCopyDirRecursive_RollbackOnPartialCopy 复制中途失败且 dst 为本次新建
// → 整树回滚清理（a.txt 已复制部分一并删除）
func TestCopyDirRecursive_RollbackOnPartialCopy(t *testing.T) {
	base := t.TempDir()
	src := filepath.Join(base, "src")
	_ = os.MkdirAll(filepath.Join(src, "d"), 0755)
	_ = os.WriteFile(filepath.Join(src, "a.txt"), []byte("a"), 0644)
	_ = os.WriteFile(filepath.Join(src, "d", "inner.txt"), []byte("i"), 0644)
	lockDirExclusive(t, filepath.Join(src, "d"))

	dst := filepath.Join(base, "dst")
	if err := copyDirRecursive(src, dst); err == nil {
		t.Fatal("枚举被锁子目录应失败")
	}
	if _, serr := os.Stat(dst); !os.IsNotExist(serr) {
		t.Fatalf("新建目录整树回滚应删除 dst: %v", serr)
	}
}

// TestCopyDirRecursive_NoRollbackWhenDstExisted 复制中途失败且 dst 已存在
// → 不回滚，既有内容保留（重拉/刷新场景防误删）
func TestCopyDirRecursive_NoRollbackWhenDstExisted(t *testing.T) {
	base := t.TempDir()
	src := filepath.Join(base, "src")
	_ = os.MkdirAll(filepath.Join(src, "d"), 0755)
	_ = os.WriteFile(filepath.Join(src, "a.txt"), []byte("a"), 0644)
	_ = os.WriteFile(filepath.Join(src, "d", "inner.txt"), []byte("i"), 0644)
	lockDirExclusive(t, filepath.Join(src, "d"))

	dst := filepath.Join(base, "dst")
	_ = os.MkdirAll(dst, 0755)
	_ = os.WriteFile(filepath.Join(dst, "keep.txt"), []byte("keep"), 0644)
	if err := copyDirRecursive(src, dst); err == nil {
		t.Fatal("枚举被锁子目录应失败")
	}
	if _, err := os.Stat(filepath.Join(dst, "keep.txt")); err != nil {
		t.Fatalf("既有目录不应被回滚清理: %v", err)
	}
}
