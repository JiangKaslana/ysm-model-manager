//go:build !windows

package executil

import "os/exec"

// HideWindow 非 Windows no-op（Unix 无控制台窗口概念）。
func HideWindow(cmd *exec.Cmd) {}
