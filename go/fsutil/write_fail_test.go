// ===== fsutil.WriteFileAtomic 失败分支注入测试（包级函数变量 swap）=====
// OS 级失败（ENOSPC/EIO/Close 报错等）无法低成本真实构造，故经 write.go 的
// 包级函数变量注入故障；失败分支的真实清理（Remove 临时文件）保持执行，
// 断言「无 .atomic-*.tmp 残渣 + 目标未损坏」数据安全不变量。
package fsutil

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// noAtomicResidue 断言目录无 .atomic-*.tmp 残渣（WriteFileAtomic 统一前缀）。
func noAtomicResidue(t *testing.T, dir string) {
	t.Helper()
	matches, _ := filepath.Glob(filepath.Join(dir, ".atomic-*.tmp"))
	if len(matches) != 0 {
		t.Fatalf("失败后不应残留临时文件: %v", matches)
	}
}

func TestWriteFileAtomic_WriteFail(t *testing.T) {
	dir := t.TempDir()
	orig := writeToFile
	writeToFile = func(w io.Writer, data []byte) error {
		if _, err := w.Write(data); err != nil {
			return err
		}
		return errors.New("模拟写入失败 ENOSPC")
	}
	t.Cleanup(func() { writeToFile = orig })

	dst := filepath.Join(dir, "data.json")
	err := WriteFileAtomic(dst, []byte("x"))
	if err == nil || !strings.Contains(err.Error(), "写入失败") {
		t.Fatalf("应报写入失败，实际 %v", err)
	}
	if _, statErr := os.Stat(dst); !os.IsNotExist(statErr) {
		t.Fatalf("写入失败后目标文件不应存在（半截数据装盘）")
	}
	noAtomicResidue(t, dir)
}

func TestWriteFileAtomic_SyncFail(t *testing.T) {
	dir := t.TempDir()
	orig := syncFile
	syncFile = func(f *os.File) error { return errors.New("模拟 Sync 失败 EIO") }
	t.Cleanup(func() { syncFile = orig })

	err := WriteFileAtomic(filepath.Join(dir, "data.json"), []byte("x"))
	if err == nil || !strings.Contains(err.Error(), "落盘失败") {
		t.Fatalf("应报落盘失败，实际 %v", err)
	}
	noAtomicResidue(t, dir)
}

func TestWriteFileAtomic_CloseFail(t *testing.T) {
	dir := t.TempDir()
	orig := closeFile
	// 先真实 Close 再报错：Windows 上未关闭的句柄会锁文件，Remove 将失败
	closeFile = func(f *os.File) error {
		f.Close()
		return errors.New("模拟 Close 失败")
	}
	t.Cleanup(func() { closeFile = orig })

	err := WriteFileAtomic(filepath.Join(dir, "data.json"), []byte("x"))
	if err == nil || !strings.Contains(err.Error(), "关闭临时文件失败") {
		t.Fatalf("应报关闭失败，实际 %v", err)
	}
	noAtomicResidue(t, dir)
}

func TestWriteFileAtomic_ChmodFail(t *testing.T) {
	dir := t.TempDir()
	orig := chmodFile
	chmodFile = func(name string, mode os.FileMode) error {
		return errors.New("模拟 Chmod 失败")
	}
	t.Cleanup(func() { chmodFile = orig })

	err := WriteFileAtomic(filepath.Join(dir, "data.json"), []byte("x"))
	if err == nil || !strings.Contains(err.Error(), "设置权限失败") {
		t.Fatalf("应报设置权限失败，实际 %v", err)
	}
	noAtomicResidue(t, dir)
}

func TestWriteFileAtomic_RenameFail(t *testing.T) {
	dir := t.TempDir()
	orig := renameFile
	renameFile = func(oldpath, newpath string) error {
		return errors.New("模拟 Rename 失败")
	}
	t.Cleanup(func() { renameFile = orig })

	dst := filepath.Join(dir, "data.json")
	err := WriteFileAtomic(dst, []byte("x"))
	if err == nil || !strings.Contains(err.Error(), "落地失败") {
		t.Fatalf("应报落地失败，实际 %v", err)
	}
	if _, statErr := os.Stat(dst); !os.IsNotExist(statErr) {
		t.Fatalf("落地失败后目标文件不应存在")
	}
	noAtomicResidue(t, dir)
}

// TestWriteFileAtomic_InjectRestore 验证注入点恢复：测试替换后回归原实现，
// 正常写入不受影响（防止包级变量污染后续测试）。
func TestWriteFileAtomic_InjectRestore(t *testing.T) {
	dir := t.TempDir()
	dst := filepath.Join(dir, "data.json")
	if err := WriteFileAtomic(dst, []byte("ok")); err != nil {
		t.Fatalf("注入恢复后正常写入失败: %v", err)
	}
	data, err := os.ReadFile(dst)
	if err != nil || string(data) != "ok" {
		t.Fatalf("内容不符: %q %v", string(data), err)
	}
}
