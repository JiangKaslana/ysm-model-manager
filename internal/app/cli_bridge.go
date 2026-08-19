package app

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

// allowedCLICommands 允许通过 Wails Bridge 调用的命令白名单
// 与 go/cli/json.go 的 jsonAllowedCommands 保持同步
var allowedCLICommands = map[string]bool{
	"search":           true,
	"analyze":          true,
	"list":             true,
	"verify":           true,
	"benchmark":        true,
	"export":           true,
	"file-bench":       true,
	"single-bench":     true,
	"concurrent-bench": true,
	"scan-dir":         true,
	"analyze-mmd":      true,
	"perf-log":         true,
	"cache-status":     true,
	"cache-verify":     true,
	"cache-clear":      true,
	"cache-diag":       true,
	"config-show":      true,
	"gui-flow":         true,
	"resource-scan":    true,
	"repo-audit":       true,
}

// ExecuteCLI 执行 CLI 命令并返回 JSON 响应（Wails 绑定）
func (a *App) ExecuteCLI(command string, args map[string]interface{}) string {
	start := time.Now()

	// 1. 检查命令是否在白名单中
	if !allowedCLICommands[command] {
		elapsed := float64(time.Since(start).Milliseconds())
		return makeJsonResponse("not_supported", command, nil, map[string]string{
			"code":    "platform_not_supported",
			"message": fmt.Sprintf("当前平台不支持命令 [%s]: 该命令未开放给前端调用", command),
		}, elapsed)
	}

	// 2. 构建参数数组
	var cmdArgs []string

	// 添加 files-root
	filesRoot := ""
	if fr, ok := args["filesRoot"].(string); ok {
		filesRoot = fr
	}
	if filesRoot == "" {
		filesRoot = a.GetYSMRepoRoot()
	}
	if filesRoot != "" {
		cmdArgs = append(cmdArgs, "--files-root", filesRoot)
	}

	cmdArgs = append(cmdArgs, command)

	// 添加命令参数
	for k, v := range args {
		if k == "filesRoot" {
			continue
		}
		switch val := v.(type) {
		case string:
			if val != "" {
				cmdArgs = append(cmdArgs, "--"+k, val)
			}
		case float64:
			if val != 0 {
				if val == float64(int64(val)) {
					cmdArgs = append(cmdArgs, "--"+k, fmt.Sprintf("%d", int64(val)))
				} else {
					cmdArgs = append(cmdArgs, "--"+k, fmt.Sprintf("%g", val))
				}
			}
		case bool:
			if val {
				cmdArgs = append(cmdArgs, "--"+k)
			}
		}
	}

	// 3. 执行命令并捕获输出
	output, execErr := executeCLICommand(cmdArgs)
	elapsed := float64(time.Since(start).Milliseconds())

	// 4. 构建响应
	if execErr != nil {
		errCode := "unknown_error"
		errMsg := execErr.Error()
		// 根据退出码判断错误类型
		exitCode := getExitCode(execErr)
		if exitCode == 2 {
			errCode = "param_error"
		} else if exitCode == 1 {
			errCode = "runtime_error"
		}
		return makeJsonResponse("error", command, nil, map[string]string{
			"code":    errCode,
			"message": errMsg,
		}, elapsed)
	}

	return makeJsonResponse("success", command, map[string]interface{}{
		"output":    output,
		"lines":     splitLines(output),
		"platform":  runtime.GOOS,
		"filesRoot": filesRoot,
	}, nil, elapsed)
}

// GetAllowedCLICommands 返回允许的 CLI 命令列表
func (a *App) GetAllowedCLICommands() string {
	commands := []string{
		"search", "analyze", "list", "verify", "benchmark", "export",
		"file-bench", "single-bench", "concurrent-bench",
		"scan-dir", "analyze-mmd", "perf-log",
		"cache-status", "cache-verify", "cache-clear", "cache-diag",
		"config-show", "gui-flow",
	}
	result, _ := json.Marshal(commands)
	return string(result)
}

// executeCLICommand 执行 CLI 命令
// 通过 os/exec 调用自身二进制的 CLI 模式，避免循环依赖
// 返回 stdout 内容和错误（含退出码）
func executeCLICommand(args []string) (string, error) {
	// 获取当前可执行文件路径
	exePath, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("获取可执行文件路径失败: %w", err)
	}

	// 构建命令：<exe> --cli <args...>
	cliArgs := append([]string{"--cli"}, args...)
	cmd := exec.Command(exePath, cliArgs...)

	// 捕获 stdout 和 stderr
	var stdoutBuf, stderrBuf strings.Builder
	cmd.Stdout = &stdoutBuf
	cmd.Stderr = &stderrBuf

	err = cmd.Run()
	if err != nil {
		// 如果有 stderr，将其附加到错误信息
		if stderr := stderrBuf.String(); stderr != "" {
			return stdoutBuf.String(), fmt.Errorf("%s: %s", err.Error(), strings.TrimSpace(stderr))
		}
		return stdoutBuf.String(), err
	}

	return stdoutBuf.String(), nil
}

// getExitCode 从错误中提取退出码（如果是 ExitError）
func getExitCode(err error) int {
	if exitErr, ok := err.(*exec.ExitError); ok {
		return exitErr.ExitCode()
	}
	return -1
}

// makeJsonResponse 创建 JSON 响应
func makeJsonResponse(status, command string, data interface{}, errResp interface{}, elapsed float64) string {
	resp := map[string]interface{}{
		"status":  status,
		"command": command,
		"timing":  map[string]float64{"total_ms": elapsed},
		"meta":    map[string]string{"platform": runtime.GOOS},
	}
	if data != nil {
		resp["data"] = data
	}
	if errResp != nil {
		resp["error"] = errResp
	}
	result, _ := json.Marshal(resp)
	return string(result)
}

// splitLines 将字符串按行分割
func splitLines(s string) []string {
	var lines []string
	start := 0
	for i := 0; i < len(s); i++ {
		if s[i] == '\n' {
			line := s[start:i]
			if len(line) > 0 {
				lines = append(lines, line)
			}
			start = i + 1
		}
	}
	if start < len(s) {
		lines = append(lines, s[start:])
	}
	return lines
}
