package cli

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"

	"ysm-model-manager/internal/app"
)

// exitCode 退出码常量
const (
	ExitSuccess    = 0
	ExitParamErr   = 2
	ExitRuntimeErr = 1
)

// ErrParam 参数错误（exit code 2）
type ErrParam struct {
	CmdName string
	Err     error
}

func (e *ErrParam) Error() string {
	if e.CmdName != "" {
		return fmt.Sprintf("参数错误 [%s]: %v", e.CmdName, e.Err)
	}
	return fmt.Sprintf("参数错误: %v", e.Err)
}

func (e *ErrParam) Unwrap() error { return e.Err }

// ErrRuntime 运行时业务错误（exit code 1）
type ErrRuntime struct {
	CmdName string
	Err     error
}

func (e *ErrRuntime) Error() string {
	if e.CmdName != "" {
		return fmt.Sprintf("运行时错误 [%s]: %v", e.CmdName, e.Err)
	}
	return fmt.Sprintf("运行时错误: %v", e.Err)
}

func (e *ErrRuntime) Unwrap() error { return e.Err }

// ExitCodeOf 根据错误类型返回退出码
func ExitCodeOf(err error) int {
	var pe *ErrParam
	if errors.As(err, &pe) {
		return ExitParamErr
	}
	return ExitRuntimeErr
}

// PrintError 输出错误到 stderr
func PrintError(err error) {
	if err == nil {
		return
	}
	fmt.Fprintf(os.Stderr, "❌ %v\n", err)
}

// ParseCommandArgs 从参数中提取 files-root 和命令参数
// 返回: filesRoot, commandArgs（不含 files-root 的剩余参数）
func ParseCommandArgs(args []string) (filesRoot string, commandArgs []string) {
	for i := 0; i < len(args); i++ {
		if args[i] == "--files-root" && i+1 < len(args) {
			filesRoot = args[i+1]
			i++
		} else if strings.HasPrefix(args[i], "--files-root=") {
			filesRoot = strings.TrimPrefix(args[i], "--files-root=")
		} else {
			commandArgs = append(commandArgs, args[i])
		}
	}
	return
}

// newCmdFlagSet 创建统一配置的 FlagSet（ContinueOnError + 静默输出）
func newCmdFlagSet(name string) *flag.FlagSet {
	fs := flag.NewFlagSet(name, flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	return fs
}

// newParamErrf 创建参数错误（exit code 2）
func newParamErrf(format string, args ...any) error {
	return &ErrParam{Err: fmt.Errorf(format, args...)}
}

// newRuntimeErrf 创建运行时错误（exit code 1）
func newRuntimeErrf(format string, args ...any) error {
	return &ErrRuntime{Err: fmt.Errorf(format, args...)}
}

// parseFlags 解析命令 flags（自动剥离 --files-root 全局参数）
// 返回提取的 filesRoot 和解析错误（*ErrParam）或 nil
func parseFlags(fs *flag.FlagSet, args []string) (filesRoot string, err error) {
	var filtered []string
	skipNext := false
	for i, arg := range args {
		if skipNext {
			skipNext = false
			continue
		}
		if arg == "--files-root" {
			if i+1 < len(args) {
				filesRoot = args[i+1]
				skipNext = true
			}
			continue
		}
		if strings.HasPrefix(arg, "--files-root=") {
			filesRoot = strings.TrimPrefix(arg, "--files-root=")
			continue
		}
		filtered = append(filtered, arg)
	}
	if err2 := fs.Parse(filtered); err2 != nil {
		return filesRoot, &ErrParam{Err: err2}
	}
	return filesRoot, nil
}

// isPowerOf2 检查是否为 2 的幂
func isPowerOf2(n int) bool {
	return n > 0 && (n&(n-1)) == 0
}

// formatSize 格式化文件大小
func formatSize(bytes int64) string {
	if bytes < 1024 {
		return fmt.Sprintf("%dB", bytes)
	}
	if bytes < 1024*1024 {
		return fmt.Sprintf("%.1fKB", float64(bytes)/1024)
	}
	if bytes < 1024*1024*1024 {
		return fmt.Sprintf("%.1fMB", float64(bytes)/(1024*1024))
	}
	return fmt.Sprintf("%.1fGB", float64(bytes)/(1024*1024*1024))
}

// min 返回两个整数中的较小值
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// max 返回两个整数中的较大值
func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

// CmdContext 统一命令执行上下文
type CmdContext struct {
	App       *app.App
	FilesRoot string
	Args      []string
}
