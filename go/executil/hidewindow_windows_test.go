//go:build windows

package executil

import (
	"os/exec"
	"syscall"
	"testing"
)

// TestHideWindow_Windows 验证 Windows 分支设置 HideWindow 标志（ADR-003 下沉收敛）。
func TestHideWindow_Windows(t *testing.T) {
	cmd := exec.Command("cmd", "/c", "exit")
	if cmd.SysProcAttr != nil {
		t.Fatal("前置假设被破坏：新建 Cmd 的 SysProcAttr 应为 nil")
	}
	HideWindow(cmd)
	if cmd.SysProcAttr == nil {
		t.Fatal("HideWindow 后 SysProcAttr 不应为 nil")
	}
	if !cmd.SysProcAttr.HideWindow {
		t.Fatal("HideWindow 后 SysProcAttr.HideWindow 应为 true")
	}
	// 幂等：重复调用不 panic、标志保持
	HideWindow(cmd)
	if !cmd.SysProcAttr.HideWindow {
		t.Fatal("重复调用 HideWindow 后标志应保持 true")
	}
}

// TestHideWindow_ExistingAttr 验证不覆盖调用方已设置的 SysProcAttr 字段。
func TestHideWindow_ExistingAttr(t *testing.T) {
	cmd := exec.Command("cmd", "/c", "exit")
	cmd.SysProcAttr = &syscall.SysProcAttr{CmdLine: "keep"}
	HideWindow(cmd)
	if cmd.SysProcAttr.CmdLine != "keep" {
		t.Fatal("HideWindow 不应覆盖已设置的 CmdLine")
	}
	if !cmd.SysProcAttr.HideWindow {
		t.Fatal("HideWindow 应叠加设置 HideWindow 标志")
	}
}
