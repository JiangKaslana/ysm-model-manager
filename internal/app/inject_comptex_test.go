// ===== injectComponentTextures 单测（ADR-114 perComponent spec 注入）=====
package app

import (
	"encoding/json"
	"testing"

	"ysm-model-manager/go/types"
)

// TestInjectComponentTextures 验证：comps 的 ComponentTextures 合并注入 spec JSON；
// 全部为空时不注入键；非 data URI 噪声不进。
func TestInjectComponentTextures(t *testing.T) {
	comps := []types.BedrockModel{
		{SourceName: "main"}, // 已声明组件：无 ComponentTextures
		{SourceName: "arrow", Bones: []types.Bone2D{{Name: "arrow"}}, ComponentTextures: map[string][]string{
			"arrow": {"data:image/png;base64,QUJD"},
		}},
	}

	got := injectComponentTextures(`{"models":[{"id":"comp_0","name":"main"},{"id":"comp_1","name":"arrow"}]}`, comps)
	var m struct {
		Models            []map[string]any    `json:"models"`
		ComponentTextures map[string][]string `json:"componentTextures"`
	}
	if err := json.Unmarshal([]byte(got), &m); err != nil {
		t.Fatalf("注入后应为合法 JSON: %v", err)
	}
	// 键 = SourceName（对齐 spec.models[i].name，前端 mg.name 查表命中）
	if len(m.ComponentTextures) != 1 {
		t.Fatalf("应注入 1 个组件纹理，实际 %v", m.ComponentTextures)
	}
	if m.ComponentTextures["arrow"][0] != "data:image/png;base64,QUJD" {
		t.Errorf("arrow 纹理内容不符: %v", m.ComponentTextures["arrow"])
	}
	if len(m.Models) != 2 {
		t.Errorf("原有 spec 键不应被破坏")
	}

	// 无 perComponent 数据：原样返回，不注入空对象
	unchanged := injectComponentTextures(`{"models":[{"id":"comp_0","name":"main"}]}`, []types.BedrockModel{{SourceName: "main"}})
	if unchanged != `{"models":[{"id":"comp_0","name":"main"}]}` {
		t.Errorf("无数据时应原样返回，实际 %s", unchanged)
	}

	// SourceName 为空时 fallback 到 comp_<i>
	compsFallback := []types.BedrockModel{
		{SourceName: "", Bones: []types.Bone2D{{Name: "x"}}, ComponentTextures: map[string][]string{"x": {"data:image/png;base64,FALL"}}},
	}
	gotFb := injectComponentTextures(`{"models":[{"id":"comp_0","name":""}]}`, compsFallback)
	var mFb struct {
		ComponentTextures map[string][]string `json:"componentTextures"`
	}
	if err := json.Unmarshal([]byte(gotFb), &mFb); err != nil {
		t.Fatalf("fallback 注入后应为合法 JSON: %v", err)
	}
	if len(mFb.ComponentTextures) != 1 {
		t.Fatalf("fallback 应注入 1 个，实际 %v", mFb.ComponentTextures)
	}
	if mFb.ComponentTextures["comp_0"][0] != "data:image/png;base64,FALL" {
		t.Errorf("fallback 键应为 comp_0，实际 %v", mFb.ComponentTextures)
	}
}
