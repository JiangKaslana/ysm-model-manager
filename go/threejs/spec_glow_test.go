package threejs

import (
	"encoding/json"
	"testing"

	"ysm-model-manager/go/types"
)

// TestIsGlowBone 验证 ysmGlow 前缀检测（大小写不敏感）。
func TestIsGlowBone(t *testing.T) {
	cases := []struct {
		name string
		want bool
	}{
		{"ysmGlowFrontHeadlights", true},
		{"ysmGlowRearLight", true},
		{"ysmglowlowercase", true},       // 大小写不敏感
		{"YSMGLOWUPPERCASE", true},       // 大小写不敏感
		{"ysmGlow", true},                // 裸前缀
		{"Head", false},                  // 无前缀
		{"Arm", false},                   // 无前缀
		{"Body", false},                  // 无前缀
		{"glowysm", false},               // 前缀在后
		{"", false},                      // 空名
		{"ysmGlowingButNotPrefix", true}, // startsWith 语义：以 ysmGlow 开头即为发光骨骼
	}
	for _, c := range cases {
		got := isGlowBone(c.name)
		if got != c.want {
			t.Errorf("isGlowBone(%q) = %v, want %v", c.name, got, c.want)
		}
	}
}

// TestBuildGlowBone 验证 Build 输出的 BoneData.Glow 字段正确标记发光骨骼。
func TestBuildGlowBone(t *testing.T) {
	model := types.BedrockModel{
		TexWidth:  64,
		TexHeight: 64,
		Bones: []types.Bone2D{
			{Name: "Head", Pivot: [3]float64{0, 24, 0}},
			{Name: "ysmGlowFrontHeadlights", Pivot: [3]float64{0, 24, 0}, Parent: "Head"},
			{Name: "ysmGlowRearLight", Pivot: [3]float64{0, 24, 0}, Parent: "Head"},
			{Name: "Arm", Pivot: [3]float64{0, 24, 0}, Parent: "Head"},
		},
	}

	spec, err := Build(model)
	if err != nil {
		t.Fatalf("Build: %v", err)
	}

	// 解析 spec JSON 验证 Glow 字段
	var parsed struct {
		Models []struct {
			Bones []struct {
				Name string `json:"name"`
				Glow bool   `json:"glow"`
			} `json:"bones"`
		} `json:"models"`
	}
	if err := json.Unmarshal([]byte(spec), &parsed); err != nil {
		t.Fatalf("解析 spec JSON: %v", err)
	}

	if len(parsed.Models) == 0 || len(parsed.Models[0].Bones) != 4 {
		t.Fatalf("期望 4 个骨骼，得到 %+v", parsed)
	}

	glowMap := map[string]bool{}
	for _, b := range parsed.Models[0].Bones {
		glowMap[b.Name] = b.Glow
	}

	if !glowMap["ysmGlowFrontHeadlights"] {
		t.Error("ysmGlowFrontHeadlights 应标记 Glow=true")
	}
	if !glowMap["ysmGlowRearLight"] {
		t.Error("ysmGlowRearLight 应标记 Glow=true")
	}
	if glowMap["Head"] {
		t.Error("Head 不应标记 Glow")
	}
	if glowMap["Arm"] {
		t.Error("Arm 不应标记 Glow")
	}
}

// TestBuildGlowBoneCaseInsensitive 验证大小写不敏感的 ysmGlow 检测。
func TestBuildGlowBoneCaseInsensitive(t *testing.T) {
	model := types.BedrockModel{
		TexWidth:  64,
		TexHeight: 64,
		Bones: []types.Bone2D{
			{Name: "ysmglowheadlight", Pivot: [3]float64{0, 24, 0}},
		},
	}

	spec, err := Build(model)
	if err != nil {
		t.Fatalf("Build: %v", err)
	}

	var parsed struct {
		Models []struct {
			Bones []struct {
				Name string `json:"name"`
				Glow bool   `json:"glow"`
			} `json:"bones"`
		} `json:"models"`
	}
	if err := json.Unmarshal([]byte(spec), &parsed); err != nil {
		t.Fatalf("解析 spec JSON: %v", err)
	}

	if len(parsed.Models) == 0 || len(parsed.Models[0].Bones) != 1 {
		t.Fatalf("期望 1 个骨骼，得到 %+v", parsed)
	}
	if !parsed.Models[0].Bones[0].Glow {
		t.Error("ysmglowheadlight (小写) 应标记 Glow=true")
	}
}
