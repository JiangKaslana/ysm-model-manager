package app

import (
	"encoding/json"
	"strings"
	"testing"
)

// TestExecuteCLI_CommandNotAllowed 测试命令不在白名单中
func TestExecuteCLI_CommandNotAllowed(t *testing.T) {
	a := NewApp()
	result := a.ExecuteCLI("unknown-command", nil)

	var resp map[string]interface{}
	if err := json.Unmarshal([]byte(result), &resp); err != nil {
		t.Fatalf("JSON 解析失败: %v", err)
	}

	if resp["status"] != "not_supported" {
		t.Errorf("期望 status=not_supported, 实际=%v", resp["status"])
	}

	if resp["command"] != "unknown-command" {
		t.Errorf("期望 command=unknown-command, 实际=%v", resp["command"])
	}
}

// TestExecuteCLI_CommandAllowed 测试白名单中的命令（不需要真实文件系统）
func TestExecuteCLI_CommandAllowed(t *testing.T) {
	a := NewApp()

	// 测试 config-show 命令（不需要文件系统操作）
	result := a.ExecuteCLI("config-show", map[string]interface{}{})

	var resp map[string]interface{}
	if err := json.Unmarshal([]byte(result), &resp); err != nil {
		t.Fatalf("JSON 解析失败: %v", err)
	}

	// 应该有 status 字段
	if _, ok := resp["status"]; !ok {
		t.Error("响应缺少 status 字段")
	}

	// 应该有 command 字段
	if resp["command"] != "config-show" {
		t.Errorf("期望 command=config-show, 实际=%v", resp["command"])
	}
}

// TestExecuteCLI_AllAllowedCommands 测试所有白名单命令都能通过验证
func TestExecuteCLI_AllAllowedCommands(t *testing.T) {
	a := NewApp()
	commands := []string{
		"search", "analyze", "list", "verify", "benchmark", "export",
		"file-bench", "single-bench", "concurrent-bench",
		"scan-dir", "analyze-mmd", "perf-log",
		"cache-status", "cache-verify", "cache-clear", "cache-diag",
		"config-show", "gui-flow",
	}

	for _, cmd := range commands {
		result := a.ExecuteCLI(cmd, map[string]interface{}{})
		var resp map[string]interface{}
		if err := json.Unmarshal([]byte(result), &resp); err != nil {
			t.Errorf("命令 %s JSON 解析失败: %v", cmd, err)
			continue
		}
		// 应该返回 success 或 error（不是 not_supported）
		status := resp["status"]
		if status == "not_supported" {
			t.Errorf("命令 %s 不应返回 not_supported", cmd)
		}
	}
}

// TestExecuteCLI_ArgsBuilding 测试参数构建逻辑
func TestExecuteCLI_ArgsBuilding(t *testing.T) {
	a := NewApp()

	// 测试带参数的命令
	result := a.ExecuteCLI("search", map[string]interface{}{
		"keyword": "test",
		"format":  "json",
	})

	var resp map[string]interface{}
	if err := json.Unmarshal([]byte(result), &resp); err != nil {
		t.Fatalf("JSON 解析失败: %v", err)
	}

	// 验证响应结构
	if _, ok := resp["timing"]; !ok {
		t.Error("响应缺少 timing 字段")
	}

	if _, ok := resp["meta"]; !ok {
		t.Error("响应缺少 meta 字段")
	}
}

// TestGetAllowedCLICommands 测试获取允许的命令列表
func TestGetAllowedCLICommands(t *testing.T) {
	a := NewApp()
	result := a.GetAllowedCLICommands()

	var commands []string
	if err := json.Unmarshal([]byte(result), &commands); err != nil {
		t.Fatalf("JSON 解析失败: %v", err)
	}

	expectedCount := 20 // 与 allowedCLICommands 数量一致
	if len(commands) != expectedCount {
		t.Errorf("期望 %d 个命令, 实际 %d 个: %v", expectedCount, len(commands), commands)
	}

	// 检查关键命令是否存在
	expectedCmds := []string{"search", "list", "analyze", "config-show"}
	for _, cmd := range expectedCmds {
		found := false
		for _, c := range commands {
			if c == cmd {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("命令 %s 不在列表中", cmd)
		}
	}
}

// TestMakeJsonResponse 测试 JSON 响应构建
func TestMakeJsonResponse(t *testing.T) {
	t.Run("success response", func(t *testing.T) {
		result := makeJsonResponse("success", "test-cmd", map[string]string{"key": "value"}, nil, 100.0)

		var resp map[string]interface{}
		if err := json.Unmarshal([]byte(result), &resp); err != nil {
			t.Fatalf("JSON 解析失败: %v", err)
		}

		if resp["status"] != "success" {
			t.Errorf("期望 status=success, 实际=%v", resp["status"])
		}
		if resp["command"] != "test-cmd" {
			t.Errorf("期望 command=test-cmd, 实际=%v", resp["command"])
		}

		// data 应该存在
		if resp["data"] == nil {
			t.Error("data 不应为 nil")
		}
	})

	t.Run("error response", func(t *testing.T) {
		errData := map[string]string{"code": "test_error", "message": "test error message"}
		result := makeJsonResponse("error", "test-cmd", nil, errData, 50.0)

		var resp map[string]interface{}
		if err := json.Unmarshal([]byte(result), &resp); err != nil {
			t.Fatalf("JSON 解析失败: %v", err)
		}

		if resp["status"] != "error" {
			t.Errorf("期望 status=error, 实际=%v", resp["status"])
		}
		if resp["data"] != nil {
			t.Error("data 应为 nil")
		}

		// error 应该存在
		if resp["error"] == nil {
			t.Error("error 不应为 nil")
		}
	})

	t.Run("timing info", func(t *testing.T) {
		result := makeJsonResponse("success", "cmd", nil, nil, 123.456)

		var resp map[string]interface{}
		if err := json.Unmarshal([]byte(result), &resp); err != nil {
			t.Fatalf("JSON 解析失败: %v", err)
		}

		timing, ok := resp["timing"].(map[string]interface{})
		if !ok {
			t.Fatal("timing 字段格式错误")
		}

		totalMs, ok := timing["total_ms"].(float64)
		if !ok {
			t.Fatal("timing.total_ms 字段类型错误")
		}
		if totalMs != 123.456 {
			t.Errorf("期望 total_ms=123.456, 实际=%v", totalMs)
		}
	})

	t.Run("meta info", func(t *testing.T) {
		result := makeJsonResponse("success", "cmd", nil, nil, 0.0)

		var resp map[string]interface{}
		if err := json.Unmarshal([]byte(result), &resp); err != nil {
			t.Fatalf("JSON 解析失败: %v", err)
		}

		meta, ok := resp["meta"].(map[string]interface{})
		if !ok {
			t.Fatal("meta 字段格式错误")
		}

		platform, ok := meta["platform"].(string)
		if !ok {
			t.Fatal("meta.platform 字段类型错误")
		}
		if platform == "" {
			t.Error("meta.platform 不应为空")
		}
	})
}

// TestSplitLines 测试字符串分行
func TestSplitLines(t *testing.T) {
	tests := []struct {
		input    string
		expected []string
	}{
		{"", []string{}},
		{"single line", []string{"single line"}},
		{"line1\nline2", []string{"line1", "line2"}},
		{"line1\nline2\nline3", []string{"line1", "line2", "line3"}},
		{"\nline2", []string{"line2"}},
		{"line1\n", []string{"line1"}},
	}

	for _, tt := range tests {
		result := splitLines(tt.input)
		if len(result) != len(tt.expected) {
			t.Errorf("splitLines(%q): 期望 %d 行, 实际 %d 行: %v", tt.input, len(tt.expected), len(result), result)
			continue
		}
		for i, line := range result {
			if line != tt.expected[i] {
				t.Errorf("splitLines(%q)[%d]: 期望 %q, 实际 %q", tt.input, i, tt.expected[i], line)
			}
		}
	}
}

// TestAllowedCommandsCount 测试白名单命令数量与 json.go 保持一致
func TestAllowedCommandsCount(t *testing.T) {
	// cli_bridge.go 中的白名单命令
	bridgeCount := len(allowedCLICommands)

	// json.go 中的白名单命令（从文档/注释推断）
	// 两者应保持同步
	expectedCommands := []string{
		"search", "analyze", "list", "verify", "benchmark", "export",
		"file-bench", "single-bench", "concurrent-bench",
		"scan-dir", "analyze-mmd", "perf-log",
		"cache-status", "cache-verify", "cache-clear", "cache-diag",
		"config-show", "gui-flow",
		"resource-scan", "repo-audit",
	}

	if bridgeCount != len(expectedCommands) {
		t.Errorf("白名单命令数量不匹配: cli_bridge.go=%d, 期望=%d", bridgeCount, len(expectedCommands))
	}

	// 检查所有期望的命令都在白名单中
	for _, cmd := range expectedCommands {
		if !allowedCLICommands[cmd] {
			t.Errorf("命令 %s 不在白名单中", cmd)
		}
	}
}

// TestExecuteCLI_InvalidJSONResponse 测试参数 map 中不同类型值的处理
func TestExecuteCLI_InvalidJSONResponse(t *testing.T) {
	a := NewApp()

	// 测试字符串参数
	result := a.ExecuteCLI("search", map[string]interface{}{
		"keyword": "test keyword",
	})
	if !strings.Contains(result, `"status"`) {
		t.Error("响应应包含 status 字段")
	}

	// 测试数字参数（float64）
	result = a.ExecuteCLI("benchmark", map[string]interface{}{
		"iterations": float64(5),
	})
	if !strings.Contains(result, `"status"`) {
		t.Error("响应应包含 status 字段")
	}

	// 测试布尔参数
	result = a.ExecuteCLI("verify", map[string]interface{}{
		"repair": true,
	})
	if !strings.Contains(result, `"status"`) {
		t.Error("响应应包含 status 字段")
	}
}
