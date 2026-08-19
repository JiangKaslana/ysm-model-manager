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

// SetAllowedCommands 注入可用 CLI 命令列表（由 main.go 调用 cli.GetAllowedCommands() 提供）
// 避免 app→cli 循环依赖：命令注册表单一事实来源在 go/cli，前端可见列表经此注入
func (a *App) SetAllowedCommands(cmds []string) {
	a.allowedCommandsOnce.Do(func() {
		a.allowedCommands = append([]string(nil), cmds...)
		a.allowedCommandSet = make(map[string]bool, len(cmds))
		for _, c := range cmds {
			a.allowedCommandSet[c] = true
		}
	})
}

// isCommandAllowed 检查命令是否在注入的可用列表中
func (a *App) isCommandAllowed(command string) bool {
	return a.allowedCommandSet[command]
}

// ExecuteCLI 执行 CLI 命令并返回 JSON 响应（Wails 绑定）
func (a *App) ExecuteCLI(command string, args map[string]interface{}) string {
	start := time.Now()

	// 1. 检查命令是否在可用列表中
	if !a.isCommandAllowed(command) {
		elapsed := float64(time.Since(start).Milliseconds())
		resp, _ := makeJsonResponse("not_supported", command, nil, map[string]string{
			"code":    "platform_not_supported",
			"message": fmt.Sprintf("当前平台不支持命令 [%s]: 该命令未开放给前端调用", command),
		}, elapsed)
		return resp
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
		default:
			// 不支持的类型（nil, int, map 等）静默跳过，防止前端参数丢失
			fmt.Fprintf(os.Stderr, "[WARN] ExecuteCLI: 跳过不支持的参数类型 %T (key=%s)\n", v, k)
		}
	}

	// 3. 执行命令并捕获输出
	// 子进程加 --json：RunCLI 的 jsonMode 分支输出统一 JsonResponse 协议（成功/失败均为 JSON）
	cmdArgs = append(cmdArgs, "--json")
	output, execErr := executeCLICommand(cmdArgs)

	// 4. 透传子进程 JSON 响应（协议由 go/cli/json.go 定义，前端统一消费）
	if output != "" {
		return output
	}

	// 兜底：子进程无 stdout 输出（异常路径），构造错误响应
	elapsed := float64(time.Since(start).Milliseconds())
	errCode := "unknown_error"
	errMsg := "命令执行失败"
	if execErr != nil {
		errMsg = execErr.Error()
		// 根据退出码判断错误类型
		exitCode := getExitCode(execErr)
		if exitCode == 2 {
			errCode = "param_error"
		} else if exitCode == 1 {
			errCode = "runtime_error"
		}
	}
	resp, err := makeJsonResponse("error", command, nil, map[string]string{
		"code":    errCode,
		"message": errMsg,
	}, elapsed)
	if err != nil {
		return fmt.Sprintf(`{"status":"error","command":%q,"error":{"code":"json_failed","message":%q}}`, command, err.Error())
	}
	return resp
}

// GetAllowedCLICommands 返回可用 CLI 命令列表
// 列表由 main.go 从 cli 注册表注入（SetAllowedCommands），新增命令自动可见
func (a *App) GetAllowedCLICommands() string {
	if a.allowedCommands == nil {
		a.allowedCommands = []string{}
	}
	result, _ := json.Marshal(a.allowedCommands)
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

// makeJsonResponse 创建 JSON 响应（返回 error 而非静默吞错）
func makeJsonResponse(status, command string, data interface{}, errResp interface{}, elapsed float64) (string, error) {
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
	result, err := json.Marshal(resp)
	if err != nil {
		return "", fmt.Errorf("JSON 序列化失败: %w", err)
	}
	return string(result), nil
}
