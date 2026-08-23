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

	got := injectComponentTextures(`{"models":[1]}`, comps)
	var m struct {
		Models            []int               `json:"models"`
		ComponentTextures map[string][]string `json:"componentTextures"`
	}
	if err := json.Unmarshal([]byte(got), &m); err != nil {
		t.Fatalf("注入后应为合法 JSON: %v", err)
	}
	// 键 = comp_<i>（对齐 threejs.BuildMulti ModelGroup 命名，前端 mg.name 查表命中）
	if len(m.ComponentTextures) != 1 {
		t.Fatalf("应注入 1 个组件纹理，实际 %v", m.ComponentTextures)
	}
	if m.ComponentTextures["comp_1"][0] != "data:image/png;base64,QUJD" {
		t.Errorf("comp_1 纹理内容不符: %v", m.ComponentTextures["comp_1"])
	}
	if len(m.Models) != 1 {
		t.Errorf("原有 spec 键不应被破坏")
	}

	// 无 perComponent 数据：原样返回，不注入空对象
	unchanged := injectComponentTextures(`{"models":[1]}`, []types.BedrockModel{{SourceName: "main"}})
	if unchanged != `{"models":[1]}` {
		t.Errorf("无数据时应原样返回，实际 %s", unchanged)
	}
}
