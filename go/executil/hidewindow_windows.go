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
// 叠加语义：保留调用方已设置的 SysProcAttr 字段，仅追加 HideWindow 标志。
func HideWindow(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.HideWindow = true
}
