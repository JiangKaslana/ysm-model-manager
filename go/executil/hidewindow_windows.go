//go:build windows

// Package executil 外部进程执行工具。
package executil

import (
	"os/exec"
	"syscall"
)

// HideWindow 隐藏子进程控制台窗口（Windows 专属）。
// 原为 avatar/fileops/internal/app 三处各自复制的同名函数（ADR-003 下沉遗留），
// 现统一收敛于此，避免跨包重复。
func HideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
}
