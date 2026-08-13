package executil

import (
	"os/exec"
	"runtime"
	"testing"
)

// TestHideWindow_NonWindows_IsNoop 非 Windows 平台验证 HideWindow 不 panic、cmd 仍可执行。
func TestHideWindow_NonWindows_IsNoop(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("仅 Unix/Linux/macOS 平台")
	}
	cmd := exec.Command("echo", "ok")
	// 调用应为 no-op，不应 panic
	HideWindow(cmd)
	if cmd == nil {
		t.Fatal("cmd 不应为 nil")
	}
	// 实际执行验证 cmd 仍然可用
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("执行 echo 失败: %v", err)
	}
	got := string(out)
	if got != "ok\n" {
		t.Fatalf("输出 %q，期望 %q", got, "ok\n")
	}
}

// TestHideWindow_Windows_SetsSysProcAttr Windows 平台验证 SysProcAttr.HideWindow 被设为 true。
func TestHideWindow_Windows_SetsSysProcAttr(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("仅 Windows 平台")
	}
	cmd := exec.Command("echo", "test")
	HideWindow(cmd)
	if cmd.SysProcAttr == nil {
		t.Fatal("SysProcAttr 应为非 nil")
	}
	if !cmd.SysProcAttr.HideWindow {
		t.Fatal("SysProcAttr.HideWindow 应为 true")
	}
}

// TestHideWindow_PanicsNilCmd 验证传入 nil cmd 时是否 panic（Windows 源码会 panic，Unix 不会）。
func TestHideWindow_PanicsNilCmd(t *testing.T) {
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		// Windows 平台：访问 nil cmd 的字段会 panic，这是已知行为
		defer func() {
			if r := recover(); r == nil {
				t.Fatal("Windows 平台：HideWindow(nil) 应 panic")
			}
		}()
	}
	HideWindow(cmd)
	// Unix 平台不 panic，执行到此即通过
}
