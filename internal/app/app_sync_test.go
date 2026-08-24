// ===== app_sync.go（同步冲突检测/解决绑定）JSON 契约测试 =====
// 覆盖：错误消息 JSON 转义（含引号/反斜杠仍可解析）、缺失目录时 error 字段
// 必须存在（防假阴性「✅ 无冲突」）、空冲突报告合法 JSON（code_review P2 回归）。
package app

import (
	"encoding/json"
	"strings"
	"testing"

	"ysm-model-manager/go/types"
)

// SyncErrorJSON 必须产出合法 JSON：错误消息可含 Windows 路径反斜杠、引号、
// 换行（os 错误串常见），手拼 fmt.Sprintf 会产出非法 JSON 导致前端 JSON.parse 抛错
// （code_review P2：63ce1a18 原实现 fmt.Sprintf 不转义）。
func TestBuildSyncErrorJSON_EscapesUnsafeMessage(t *testing.T) {
	cases := []string{
		`open C:\Users\abc: 系统找不到指定的路径`,
		`包含 "引号" 与 \反斜杠\`,
		"多行\n错误",
	}
	for _, msg := range cases {
		got := SyncErrorJSON(msg)
		if !json.Valid([]byte(got)) {
			t.Fatalf("SyncErrorJSON(%q) 输出非法 JSON: %s", msg, got)
		}
		var parsed struct {
			Error          string `json:"error"`
			Conflicts      any    `json:"conflicts"`
			TotalConflicts int    `json:"totalConflicts"`
		}
		if err := json.Unmarshal([]byte(got), &parsed); err != nil {
			t.Fatalf("解析失败: %v (json=%s)", err, got)
		}
		if parsed.Error != msg {
			t.Errorf("error 字段应原样保留 %q, got %q", msg, parsed.Error)
		}
		if parsed.TotalConflicts != 0 {
			t.Errorf("错误响应 TotalConflicts 应为 0, got %d", parsed.TotalConflicts)
		}
	}
}

// 未配置游戏根目录 → 必须返回带 error 字段的 JSON，而非「空冲突报告」——
// 否则前端把「无法扫描」当「✅ 未检测到同步冲突」假阴性（code_review P2）。
func TestDetectConflicts_NoMcRoot_ReturnsError(t *testing.T) {
	a := repoApp(t, types.AppConfig{}) // McRoot 空
	got := a.DetectConflicts("ysm", "test-instance")
	if !json.Valid([]byte(got)) {
		t.Fatalf("返回非法 JSON: %s", got)
	}
	var parsed struct {
		Error     string `json:"error"`
		Conflicts any    `json:"conflicts"`
	}
	if err := json.Unmarshal([]byte(got), &parsed); err != nil {
		t.Fatalf("解析失败: %v", err)
	}
	if parsed.Error == "" {
		t.Error("错误响应必须含非空 error 字段，避免假阴性（code_review P2）")
	}
	if parsed.Conflicts == nil {
		t.Error("conflicts 字段必须存在")
	}
}

// 未配置游戏根目录时 ResolveConflicts 也必须带 error 字段。
func TestResolveConflicts_NoMcRoot_ReturnsError(t *testing.T) {
	a := repoApp(t, types.AppConfig{})
	got := a.ResolveConflicts(`[]`, "force_remote", "ysm", "test-instance")
	var parsed struct {
		Error    string `json:"error"`
		Resolved int    `json:"resolved"`
		Failed   int    `json:"failed"`
		Manual   int    `json:"manual"`
	}
	if err := json.Unmarshal([]byte(got), &parsed); err != nil {
		t.Fatalf("非法 JSON: %v / raw: %s", err, got)
	}
	if parsed.Error == "" {
		t.Error("ResolveConflicts 错误响应必须含 error 字段")
	}
}

// 错误消息中的引号/反斜杠必须被 json.Marshal 正确转义。
func TestResolveErrorJSON_EscapesUnsafeMessage(t *testing.T) {
	msg := `解析冲突列表失败: invalid character '\\' in string`
	got := ResolveErrorJSON(msg)
	// 响应同时含数字字段（resolved/failed/manual），须用 interface 反序列化
	var out map[string]interface{}
	if err := json.Unmarshal([]byte(got), &out); err != nil {
		t.Fatalf("非法 JSON: %v\nraw: %s", err, got)
	}
	if out["error"] != msg {
		t.Errorf("quote 未转义: got %q want %q", out["error"], msg)
	}
}

// DedupErrorJSON 必须正确转义引号（与 findDuplicateErrorJSON 行为一致）。
func TestDedupErrorJSON_EscapesQuotes(t *testing.T) {
	got := DedupErrorJSON(`open "C:\foo": access denied`)
	var out map[string]string
	if err := json.Unmarshal([]byte(got), &out); err != nil {
		t.Fatalf("非法 JSON: %v\nraw: %s", err, got)
	}
	if out["error"] != `open "C:\foo": access denied` {
		t.Errorf("quote 未转义: got %q", out["error"])
	}
}

// findDuplicateErrorJSON 是 DedupErrorJSON 的别名，验证其行为一致。
func TestFindDuplicateErrorJSON_Behavior(t *testing.T) {
	got := findDuplicateErrorJSON(`open "C:\foo": access denied`)
	var out map[string]string
	if err := json.Unmarshal([]byte(got), &out); err != nil {
		t.Fatalf("非法 JSON: %v\nraw: %s", err, got)
	}
	if out["error"] != `open "C:\foo": access denied` {
		t.Errorf("quote 未转义: got %q", out["error"])
	}
}

// TestDetectConflicts_NoFilesRoot_ReturnsError 验证全局资源目录缺失时必须返回 error
func TestDetectConflicts_NoFilesRoot_ReturnsError(t *testing.T) {
	// McRoot 必须有效才能走到 filesRootForSync 检查
	base := t.TempDir()
	// FilesRoot 空 → GetRepoRoot 返回空 → filesRootForSync 失败
	a := repoApp(t, types.AppConfig{FilesRoot: "", McRoot: base})
	got := a.DetectConflicts("ysm", "test-instance")

	if !json.Valid([]byte(got)) {
		t.Fatalf("返回非法 JSON: %s", got)
	}
	var parsed struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal([]byte(got), &parsed); err != nil {
		t.Fatalf("解析失败: %v", err)
	}
	if parsed.Error == "" {
		t.Error("错误响应必须含非空 error 字段")
	}
}

// TestDetectConflicts_NoInstance_ReturnsError 验证整合包实例缺失时必须返回 error
func TestDetectConflicts_NoInstance_ReturnsError(t *testing.T) {
	base := t.TempDir()
	// McRoot 有效，FilesRoot 也有效（为了通过前置检查），但 instanceName 不存在
	a := repoApp(t, types.AppConfig{FilesRoot: base, McRoot: base})
	got := a.DetectConflicts("ysm", "non-existent-instance")

	if !json.Valid([]byte(got)) {
		t.Fatalf("返回非法 JSON: %s", got)
	}
	var parsed struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal([]byte(got), &parsed); err != nil {
		t.Fatalf("解析失败: %v", err)
	}
	if parsed.Error == "" {
		t.Error("错误响应必须含非空 error 字段")
	}
	// 进一步断言错误信息内容
	if !strings.Contains(parsed.Error, "未找到整合包") {
		t.Errorf("错误信息应包含 '未找到整合包', got %q", parsed.Error)
	}
}
