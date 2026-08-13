// ===== Empty 边界分支补测 =====
// 覆盖：recycleDir 未设置（空字符串）、回收站目录尚不存在（未创建过）。
// RemoveAll/MkdirAll 失败分支依赖系统级删除失败（Windows 上 stdlib 无法
// 稳定构造——只读属性不阻止删除、文件句柄带 FILE_SHARE_DELETE），记为不可测。
package recycle

import "testing"

// Empty 在 recycleDir 未设置时应返回 (0, nil)（不 panic）
func TestEmpty_RecycleDirUnset(t *testing.T) {
	tm := &TrashManager{}
	count, err := tm.Empty()
	if err != nil {
		t.Fatalf("recycleDir 未设置应返回 nil 错误: %v", err)
	}
	if count != 0 {
		t.Fatalf("应返回 0，得到 %d", count)
	}
}

// Empty 在回收站目录不存在时应返回 (0, nil)
func TestEmpty_RecycleDirNotExist(t *testing.T) {
	dir := t.TempDir()
	tm := New(dir)
	count, err := tm.Empty()
	if err != nil {
		t.Fatalf("回收站不存在应返回 nil 错误: %v", err)
	}
	if count != 0 {
		t.Fatalf("应返回 0，得到 %d", count)
	}
}
