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

// buildSyncErrorJSON 必须产出合法 JSON：错误消息可含 Windows 路径反斜杠、引号、
// 换行（os 错误串常见），手拼 fmt.Sprintf 会产出非法 JSON 导致前端 JSON.parse 抛错
// （code_review P2：63ce1a18 原实现 fmt.Sprintf 不转义）。
func TestBuildSyncErrorJSON_EscapesUnsafeMessage(t *testing.T) {
	cases := []string{
		`open C:\Users\abc: 系统找不到指定的路径`,
		`包含 "引号" 与 \反斜杠\`,
		"多行\n错误",
	}
	for _, msg := range cases {
		got := buildSyncErrorJSON(msg)
		if !json.Valid([]byte(got)) {
			t.Fatalf("buildSyncErrorJSON(%q) 输出非法 JSON: %s", msg, got)
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

func TestBuildResolveErrorJSON_EscapesUnsafeMessage(t *testing.T) {
	msg := `解析冲突列表失败: invalid character '\\' in string`
	got := buildResolveErrorJSON(msg)
	if !json.Valid([]byte(got)) {
		t.Fatalf("buildResolveErrorJSON 输出非法 JSON: %s", got)
	}
	var parsed struct {
		Error    string `json:"error"`
		Resolved int    `json:"resolved"`
		Failed   int    `json:"failed"`
		Manual   int    `json:"manual"`
	}
	if err := json.Unmarshal([]byte(got), &parsed); err != nil {
		t.Fatalf("解析失败: %v (json=%s)", err, got)
	}
	if parsed.Error != msg {
		t.Errorf("error 字段应原样保留, got %q", parsed.Error)
	}
}

// 未配置游戏根目录 → 必须返回带 error 字段的 JSON，而非「空冲突报告」——
// 否则前端把「无法扫描」当「✅ 未检测到同步冲突」假阴性（code_review P2）。
func TestDetectConflicts_NoMcRoot_ReturnsError(t *testing.T) {
	a := scanApp(t, types.AppConfig{}) // McRoot 空
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
		t.Fatalf("McRoot 缺失必须返回 error 字段（防假阴性），got: %s", got)
	}
}

// 配置了 McRoot 但 FilesRoot 缺失（全局仓库目录不可解析）→ error 字段必须存在。
func TestDetectConflicts_NoFilesRoot_ReturnsError(t *testing.T) {
	a := scanApp(t, types.AppConfig{
		McRoot: t.TempDir(),
		// FilesRoot 留空 → GetRepoRoot 报错 → filesRootForSync 失败
	})
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
		t.Fatalf("全局目录不可解析必须返回 error 字段（防假阴性），got: %s", got)
	}
}

// 整合包实例不存在 → error 字段必须存在（与 ResolveConflicts 同款守卫）。
func TestDetectConflicts_NoInstance_ReturnsError(t *testing.T) {
	base := t.TempDir()
	a := scanApp(t, types.AppConfig{
		FilesRoot: base,
		McRoot:    t.TempDir(),
	})
	got := a.DetectConflicts("ysm", "不存在的实例")
	if !json.Valid([]byte(got)) {
		t.Fatalf("返回非法 JSON: %s", got)
	}
	var parsed struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal([]byte(got), &parsed); err != nil {
		t.Fatalf("解析失败: %v", err)
	}
	if parsed.Error == "" || !strings.Contains(parsed.Error, "未找到整合包") {
		t.Fatalf("实例不存在必须返回带原因 error，got: %s", got)
	}
}
