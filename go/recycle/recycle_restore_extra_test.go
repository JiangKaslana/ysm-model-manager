// ===== Restore 守卫与错误分支补测 =====
// 覆盖：src 不在回收站内（越权）、src == 回收站根（根级守卫）、
// 源缺失时 os.Rename 非跨设备错误直接返回（不尝试复制）。
// 跨设备（EXDEV）复制回退分支依赖真实跨卷 rename 失败，无注入点（Restore
// 硬编码 os.Rename，未复用 TrashManager.renameForMove 测试注入字段），
// 见 moveEx 的注入式测试；此处仅覆盖单机可复现的分支。
package recycle

import (
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/internal/testutil"
)

// Restore 越权：src 在回收站目录之外应被拒绝
func TestRestore_OutOfRecycleDir(t *testing.T) {
	dir := t.TempDir()
	tm := New(dir)
	outside := filepath.Join(t.TempDir(), "x.ysm")
	if err := tm.Restore(outside); err == nil {
		t.Fatal("回收站外路径恢复应被拒绝")
	}
}

// Restore 根级守卫：src == 回收站目录自身应被拒绝（IsInside 相等放行 → 走显式 Clean 相等拒绝）
func TestRestore_RecycleRootRejected(t *testing.T) {
	dir := t.TempDir()
	tm := New(dir)
	// 先移入一个文件确保 .recycle 目录已存在
	src := testutil.CreateTestFile(t, dir, "test.ysm", "x")
	if err := tm.Move(src); err != nil {
		t.Fatal(err)
	}
	if err := tm.Restore(tm.RecycleDir()); err == nil {
		t.Fatal("恢复回收站根目录应被拒绝")
	}
	// 回收站内容不应受影响
	if len(tm.List()) != 1 {
		t.Fatal("回收站内容不应受影响")
	}
}

// Restore 源缺失：os.Rename 返回 ENOENT（非跨设备错误）→ 直接返回，不静默成功
func TestRestore_SourceMissing(t *testing.T) {
	dir := t.TempDir()
	tm := New(dir)
	err := tm.Restore(filepath.Join(tm.RecycleDir(), "missing.ysm"))
	if err == nil {
		t.Fatal("源不存在恢复应报错")
	}
	// 目标位置不应有残留
	if _, statErr := os.Stat(filepath.Join(dir, "missing.ysm")); !os.IsNotExist(statErr) {
		t.Fatalf("目标位置不应有残留文件: %v", statErr)
	}
}
