// ===== go/types 补测（registry_test 未覆盖分支）=====
package types

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestNormalizeResourceName_EdgeCases ADR-064 收敛函数补测：
// 双后缀（.ban.disabled）剥序、大小写、无后缀。
func TestNormalizeResourceName_EdgeCases(t *testing.T) {
	cases := []struct{ in, want string }{
		{"model.ysm", "model.ysm"},
		{"MODEL.YSM", "model.ysm"},
		{"model.ysm.ban", "model.ysm"},
		{"model.ysm.disabled", "model.ysm"},
		{"model.ban.disabled", "model"}, // 先剥 .disabled 再剥 .ban，双后缀均剥（与旧实现一致）
		{"model.ysm.disabled.ban", "model.ysm.disabled"},
		{"", ""},
	}
	for _, c := range cases {
		if got := NormalizeResourceName(c.in); got != c.want {
			t.Errorf("NormalizeResourceName(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

// TestIsResourceAllowed_JsonCase 钉住 .json 特判统一走 IsYsmEntryJSON：
// 大小写不敏感 + 前导空格 TrimSpace（与原 isSyncAllowed 手写 base=="ysm.json" 差异，
// 审核 A 指出，已统一到 IsYsmEntryJSON 口径）。
func TestIsResourceAllowed_JsonCase(t *testing.T) {
	if !IsResourceAllowed("YSM.JSON") {
		t.Error("YSM.JSON 应放行（大小写不敏感）")
	}
	if !IsResourceAllowed("ysm.json") {
		t.Error("ysm.json 应放行")
	}
	if IsResourceAllowed("anim.json") {
		t.Error("anim.json 不应放行")
	}
	if IsResourceAllowed("") {
		t.Error("空串不应放行")
	}
}

// TestIsTypeModelFile_EmptyExts 空扩展集类型应返回 false（与旧 isModelFile
// 严格语义一致；extMatch 的空集放行分支在 BuildSyncItems 不会触发——未知
// 类型早被 SubDirMap 空拦截）。
func TestIsTypeModelFile_EmptyExts(t *testing.T) {
	if IsTypeModelFile("x.xyz", "no-such-type") {
		t.Error("空扩展集类型不应放行任何文件")
	}
	if !IsTypeModelFile("m.ysm", "ysm") {
		t.Error("ysm 类型应放行 .ysm")
	}
}

func TestFindInstDir_StandardDir(t *testing.T) {
	versionDir := t.TempDir()
	standard := filepath.Join(versionDir, "resourcepacks")
	if err := os.MkdirAll(standard, 0755); err != nil {
		t.Fatal(err)
	}
	if got := FindInstDir(versionDir, "resourcepacks", "resourcepack"); got != standard {
		t.Fatalf("标准目录应直接返回: %s vs %s", got, standard)
	}
}

// TestShouldHashExt_PinnedList 钉住 ShouldHashExt 的哈希扩展名清单：
// ShouldHashExt 已注册表驱动（resource_types.json 的 hashable 字段，ysm/
// create-blueprint/litematic 标 true），本测试钉住其行为结果，防注册表
// 扩展名调整时哈希口径意外漂移（大文件跳过哈希是性能决策）。
func TestShouldHashExt_PinnedList(t *testing.T) {
	hashable := []string{".ysm", ".zip", ".7z", ".json", ".nbt", ".schematic", ".litematic"}
	nonHashable := []string{".mmd", ".pmx", ".pmd", ".vrc", ".png", ".txt", ".ban"}
	for _, ext := range hashable {
		if !ShouldHashExt(ext) {
			t.Errorf("ShouldHashExt(%s) = false, want true（清单漂移？）", ext)
		}
	}
	for _, ext := range nonHashable {
		if ShouldHashExt(ext) {
			t.Errorf("ShouldHashExt(%s) = true, want false", ext)
		}
	}
	// 大小写不敏感
	if !ShouldHashExt(".YSM") {
		t.Error("ShouldHashExt(.YSM) = false, want true（大小写不敏感）")
	}
}

func TestFindInstDir_FallbackScan(t *testing.T) {
	versionDir := t.TempDir()
	// 无标准目录；创建含 .zip 文件的子目录（resourcepack 支持 .zip）
	other := filepath.Join(versionDir, "custompacks")
	if err := os.MkdirAll(other, 0755); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(other, "pack.zip"), []byte("x"), 0644)
	got := FindInstDir(versionDir, "resourcepacks", "resourcepack")
	if got != other {
		t.Fatalf("应 fallback 到含 .zip 的子目录: %s vs %s", got, other)
	}
}

func TestFindInstDir_NoMatch(t *testing.T) {
	versionDir := t.TempDir()
	got := FindInstDir(versionDir, "resourcepacks", "resourcepack")
	if got != filepath.Join(versionDir, "resourcepacks") {
		t.Fatalf("无匹配应返回标准路径: %s", got)
	}
}

// TestFindInstDir_StandardEmptyFallback P5 修复：标准目录存在但为空/无该类型文件时，
// 应继续兜底扫描非标准目录（Sable Schematics 把蓝图放 Sable-Schematics/ 的场景——
// 标准 schematics 目录存在但空，原实现直接返回空目录导致蓝图识别不到）
func TestFindInstDir_StandardEmptyFallback(t *testing.T) {
	versionDir := t.TempDir()
	// 标准 schematics 目录存在但为空
	if err := os.MkdirAll(filepath.Join(versionDir, "schematics"), 0755); err != nil {
		t.Fatal(err)
	}
	// Sable-Schematics 目录含嵌套 .nbt（Sable 模组实际存放蓝图的位置）
	sable := filepath.Join(versionDir, "Sable-Schematics", "hello_new_generation_core")
	if err := os.MkdirAll(sable, 0755); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(sable, "c1.nbt"), []byte("nbt"), 0644)
	got := FindInstDir(versionDir, "schematics", "create-blueprint")
	if got != filepath.Join(versionDir, "Sable-Schematics") {
		t.Fatalf("标准目录空时应兜底到 Sable-Schematics: %s", got)
	}
}

// TestFindInstDir_StandardNonEmptyStays 标准目录包含该类型文件 → 仍返回标准目录（标准优先，行为不变）
func TestFindInstDir_StandardNonEmptyStays(t *testing.T) {
	versionDir := t.TempDir()
	std := filepath.Join(versionDir, "schematics")
	if err := os.MkdirAll(std, 0755); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(std, "top.nbt"), []byte("nbt"), 0644)
	got := FindInstDir(versionDir, "schematics", "create-blueprint")
	if got != std {
		t.Fatalf("标准目录含 .nbt 应返回标准目录: %s vs %s", got, std)
	}
}

// ====== IsYsmEntryJSON（ADR-038 D2 白名单）======

func TestIsYsmEntryJSON(t *testing.T) {
	cases := []struct {
		name string
		want bool
	}{
		{"ysm.json", true},
		{"YSM.JSON", true},
		{"Ysm.Json", true},
		{" ysm.json ", true}, // TrimSpace
		{"main.json", false},
		{"arm.json", false},
		{"slashblade.animation.json", false},
		{"zh_cn.json", false},
		{"en_us.json", false},
		{"ysm.json.bak", false},
		{"", false},
	}
	for _, c := range cases {
		if got := IsYsmEntryJSON(c.name); got != c.want {
			t.Errorf("IsYsmEntryJSON(%q) = %v, want %v", c.name, got, c.want)
		}
	}
}

func TestAppError_Error(t *testing.T) {
	e := AppError{Code: ErrorCode("X"), Operation: "导入", SourcePath: "/s", Reason: "失败", Suggestion: "重试"}
	msg := e.Error()
	for _, part := range []string{"失败", "导入", "/s", "重试"} {
		if !strings.Contains(msg, part) {
			t.Fatalf("Error() 缺少 %q: %s", part, msg)
		}
	}
	// 空路径不拼接源路径/目标路径段
	e2 := AppError{Code: ErrorCode("Y"), Reason: "r", Operation: "o", Suggestion: "s"}
	got := e2.Error()
	if strings.Contains(got, "源路径") || strings.Contains(got, "目标路径") {
		t.Fatalf("空路径不应拼接: %s", got)
	}
}

func TestFormatRange_UnmarshalJSON(t *testing.T) {
	cases := []struct {
		in       string
		min, max int
	}{
		{`15`, 15, 15},     // 单 int
		{`[15]`, 15, 15},   // 单元素数组
		{`[1, 15]`, 1, 15}, // 双元素数组
		{`{"min_inclusive": 3, "max_inclusive": 5}`, 3, 5}, // 对象格式
	}
	for _, c := range cases {
		var fr FormatRange
		if err := json.Unmarshal([]byte(c.in), &fr); err != nil {
			t.Fatalf("解析 %s 失败: %v", c.in, err)
		}
		if fr.Min != c.min || fr.Max != c.max {
			t.Fatalf("解析 %s 得 %d/%d，期望 %d/%d", c.in, fr.Min, fr.Max, c.min, c.max)
		}
	}
	// 无效格式 → 报错
	var fr FormatRange
	if err := json.Unmarshal([]byte(`"invalid"`), &fr); err == nil {
		t.Fatal("无效格式应报错")
	}
}

// ====== FormatRange 未覆盖分支 ======

// TestFormatRange_EmptyArray 空数组长度不足应报错（len 0 走 else 分支）
func TestFormatRange_EmptyArray(t *testing.T) {
	var fr FormatRange
	if err := json.Unmarshal([]byte(`[]`), &fr); err == nil {
		t.Fatal("空数组应报错，实际 nil")
	}
}

// TestFormatRange_Null null 走单 int 分支成功（置零值），返回 0/0——钉住现有行为
func TestFormatRange_Null(t *testing.T) {
	var fr FormatRange
	if err := json.Unmarshal([]byte(`null`), &fr); err != nil {
		t.Fatalf("null 不应报错: %v", err)
	}
	if fr.Min != 0 || fr.Max != 0 {
		t.Errorf("null 解析为 %d/%d, 期望 0/0", fr.Min, fr.Max)
	}
}

// TestFormatRange_ObjectMissingFields 对象缺 min_inclusive/max_inclusive 字段 → 零值 0/0
func TestFormatRange_ObjectMissingFields(t *testing.T) {
	var fr FormatRange
	if err := json.Unmarshal([]byte(`{}`), &fr); err != nil {
		t.Fatalf("{} 不应报错: %v", err)
	}
	if fr.Min != 0 || fr.Max != 0 {
		t.Errorf("{} 解析为 %d/%d, 期望 0/0", fr.Min, fr.Max)
	}
}

// ====== descString 未覆盖分支 ======

// TestDescString_ObjectEmptyText 对象缺 text 或 text 为空 → 空字符串
func TestDescString_ObjectEmptyText(t *testing.T) {
	if got := descString(json.RawMessage(`{"color":"red"}`)); got != "" {
		t.Errorf("对象无 text 字段应返回空, 得到 %q", got)
	}
	if got := descString(json.RawMessage(`{"text":""}`)); got != "" {
		t.Errorf("空 text 应返回空, 得到 %q", got)
	}
}

// TestDescString_ArrayEmptyComponents 数组组件无 text 时跳过，仅拼接非空 text/extra.text
func TestDescString_ArrayEmptyComponents(t *testing.T) {
	got := descString(json.RawMessage(`[{"color":"red"},{"text":"B"},{"extra":[{"text":"C"}]}]`))
	if got != "BC" {
		t.Errorf("数组应跳过无 text 组件并拼接 extra, 得到 %q", got)
	}
	if got := descString(json.RawMessage(`[]`)); got != "" {
		t.Errorf("空数组应返回空, 得到 %q", got)
	}
}

// ====== FindInstDir 未覆盖分支 ======

// TestFindInstDir_StandardIsFile 标准路径存在但是文件（非目录）→ 走兜底扫描，无匹配返回标准路径
func TestFindInstDir_StandardIsFile(t *testing.T) {
	versionDir := t.TempDir()
	standard := filepath.Join(versionDir, "resourcepacks")
	if err := os.WriteFile(standard, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	got := FindInstDir(versionDir, "resourcepacks", "resourcepack")
	if got != standard {
		t.Fatalf("标准路径为文件时应兜底后返回标准路径: %s vs %s", got, standard)
	}
}

// TestFindInstDir_UnknownType 未知类型无扩展名信息 → 直接返回标准路径
func TestFindInstDir_UnknownType(t *testing.T) {
	versionDir := t.TempDir()
	got := FindInstDir(versionDir, "resourcepacks", "nonexistent-type")
	if got != filepath.Join(versionDir, "resourcepacks") {
		t.Fatalf("未知类型应返回标准路径: %s", got)
	}
}
