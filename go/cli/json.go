package cli

import (
	"encoding/json"
	"errors"
	"fmt"
	"runtime"
)

// JsonResponse 统一 JSON 输出协议
type JsonResponse struct {
	Status  string      `json:"status"`          // success / error / not_supported
	Command string      `json:"command"`         // 命令名
	Data    interface{} `json:"data,omitempty"`  // 业务数据
	Error   *JsonError  `json:"error,omitempty"` // 错误信息
	Timing  *TimingInfo `json:"timing,omitempty"`
	Meta    *MetaInfo   `json:"meta,omitempty"`
}

// JsonError 错误详情
type JsonError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Details string `json:"details,omitempty"`
}

// TimingInfo 耗时统计
type TimingInfo struct {
	TotalMs float64 `json:"total_ms"`
}

// MetaInfo 元信息
type MetaInfo struct {
	Platform string `json:"platform"`
}

// NewJsonSuccess 创建成功响应
func NewJsonSuccess(command string, data interface{}, durationMs float64) *JsonResponse {
	return &JsonResponse{
		Status:  "success",
		Command: command,
		Data:    data,
		Timing:  &TimingInfo{TotalMs: durationMs},
		Meta:    &MetaInfo{Platform: runtime.GOOS},
	}
}

// NewJsonError 创建错误响应
func NewJsonError(command string, err error, durationMs float64) *JsonResponse {
	resp := &JsonResponse{
		Status:  "error",
		Command: command,
		Timing:  &TimingInfo{TotalMs: durationMs},
		Meta:    &MetaInfo{Platform: runtime.GOOS},
	}

	var errParam *ErrParam
	var errRuntime *ErrRuntime
	switch {
	case errors.As(err, &errParam):
		resp.Error = &JsonError{
			Code:    "param_error",
			Message: errParam.Error(),
		}
	case errors.As(err, &errRuntime):
		resp.Error = &JsonError{
			Code:    "runtime_error",
			Message: errRuntime.Error(),
		}
	default:
		resp.Error = &JsonError{
			Code:    "unknown_error",
			Message: err.Error(),
		}
	}
	return resp
}

// NewJsonNotSupported 创建平台不支持响应
func NewJsonNotSupported(command string, reason string) *JsonResponse {
	return &JsonResponse{
		Status:  "not_supported",
		Command: command,
		Error: &JsonError{
			Code:    "platform_not_supported",
			Message: fmt.Sprintf("当前平台不支持命令 [%s]: %s", command, reason),
		},
		Meta: &MetaInfo{Platform: runtime.GOOS},
	}
}

// ToJson 将响应序列化为 JSON 字符串
func (r *JsonResponse) ToJson() string {
	data, err := json.MarshalIndent(r, "", "  ")
	if err != nil {
		return fmt.Sprintf(`{"status":"error","error":{"code":"marshal_error","message":"%s"}}`, err.Error())
	}
	return string(data)
}

// jsonAllowedCommands 允许通过 Wails Bridge 调用的命令白名单
// 与 cliCommands 保持同步（RegisterCommand 注册的命令需在此显式授权）
var jsonAllowedCommands = map[string]bool{
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
}

// IsCommandAllowed 检查命令是否在白名单中
func IsCommandAllowed(command string) bool {
	return jsonAllowedCommands[command]
}

// GetAllowedCommands 返回允许的命令列表
func GetAllowedCommands() []string {
	var cmds []string
	for cmd := range jsonAllowedCommands {
		cmds = append(cmds, cmd)
	}
	return cmds
}
