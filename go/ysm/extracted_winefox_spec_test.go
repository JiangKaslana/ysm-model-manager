package ysm

import (
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types"
)

// TestWineFoxBoatTextureSpec 用真实 wine_fox 验证 FindComponentsInExtractedYSM 输出：
// boat 组件的 ComponentTextures 有 data URI，texNames 置空（perComponent 跳过 R1）。
func TestWineFoxBoatTextureSpec(t *testing.T) {
	dir := filepath.Join("..", "..", "upstream", "[YSM模型]官方开源wine_fox_json", "01_taisho_maid")
	ysmPath := filepath.Join(dir, "ysm.json")
	comps, texNames := FindComponentsInExtractedYSM(ysmPath)

	var boatComp *types.BedrockModel
	for i := range comps {
		if comps[i].SourceName == "boat" {
			boatComp = &comps[i]
			t.Logf("boat component found at index %d", i)
		}
	}
	if boatComp == nil {
		t.Fatal("未找到 boat 组件")
	}
	if len(boatComp.ComponentTextures) == 0 {
		t.Fatal("boat ComponentTextures 应为非空（perComponent 兜底纹理）")
	}
	boatTex, ok := boatComp.ComponentTextures["boat"]
	if !ok || len(boatTex) == 0 {
		t.Fatalf("boat ComponentTextures[boat] 缺失，实际 keys=%v", func() []string {
			var ks []string
			for k := range boatComp.ComponentTextures {
				ks = append(ks, k)
			}
			return ks
		}())
	}
	if len(boatTex[0]) < 20 || boatTex[0][:20] != "data:image/png;base6" {
		t.Errorf("boat 纹理应为首部 data URI，实际前 40 字符: %.40q", boatTex[0])
	}
	t.Logf("✓ boat ComponentTextures[boat] 命中，长度=%d bytes", len(boatTex[0]))

	// 验证 texNames 为空（perComponent 跳过 R1）
	for i := range comps {
		if comps[i].SourceName == "boat" {
			if texNames[i] != "" {
				t.Errorf("boat texNames[%d] = %q, 期望空串", i, texNames[i])
			}
			break
		}
	}
}

// TestWineFoxAllComponents_ComponentTextures 验证所有未声明组件均有 perComponent 纹理。
func TestWineFoxAllComponents_ComponentTextures(t *testing.T) {
	dir := filepath.Join("..", "..", "upstream", "[YSM模型]官方开源wine_fox_json", "01_taisho_maid")
	ysmPath := filepath.Join(dir, "ysm.json")
	comps, _ := FindComponentsInExtractedYSM(ysmPath)

	undeclared := map[string]bool{"arrow": true, "trident": true, "foxcar": true, "minecart": true, "boat": true}
	for _, c := range comps {
		if !undeclared[c.SourceName] {
			continue
		}
		if len(c.ComponentTextures) == 0 {
			t.Errorf("未声明组件 %s 应有 ComponentTextures", c.SourceName)
			continue
		}
		key := c.SourceName
		if _, ok := c.ComponentTextures[key]; !ok {
			t.Errorf("未声明组件 %s: ComponentTextures 缺少 key %q，实际 keys=%v",
				key, key, func() []string {
					var ks []string
					for k := range c.ComponentTextures {
						ks = append(ks, k)
					}
					return ks
				}())
		}
		if c.Bones[0].Cubes[0].TexSlot != 0 {
			t.Errorf("未声明组件 %s: TexSlot=%d, 期望 0", key, c.Bones[0].Cubes[0].TexSlot)
		}
	}
}
