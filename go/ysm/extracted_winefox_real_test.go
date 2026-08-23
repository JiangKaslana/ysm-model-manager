package ysm

import (
	"path/filepath"
	"strings"
	"testing"
)

// TestFindComponentsInExtractedYSM_WineFoxReal 用 upstream 真实 wine_fox 目录验证：
// 7 个组件各绑定正确纹理，未声明组件走 perComponent（TexSlot=0 + ComponentTextures 有条目）。
func TestFindComponentsInExtractedYSM_WineFoxReal(t *testing.T) {
	dir := filepath.Join("..", "..", "upstream", "[YSM模型]官方开源wine_fox_json", "01_taisho_maid")
	ysmPath := filepath.Join(dir, "ysm.json")
	comps, texNames := FindComponentsInExtractedYSM(ysmPath)

	if len(comps) != 7 {
		t.Fatalf("组件数 = %d, 期望 7", len(comps))
	}

	// 声明组件：main(0)→skin, arm(1)→skin_white
	// 注意 arm 的 texSlot=1 对应 skin_white（声明序位置），不是共享 skin
	wantDecl := map[string]bool{"main": true, "arm": true}
	wantDeclTex := map[string]int{"main": 0, "arm": 1}
	for i, c := range comps {
		isDecl := wantDecl[c.SourceName]
		var texSlot int
		for _, b := range c.Bones {
			if len(b.Cubes) > 0 {
				texSlot = b.Cubes[0].TexSlot
				break
			}
		}
		cubeCount := 0
		for _, b := range c.Bones {
			cubeCount += len(b.Cubes)
		}
		hasCompTex := len(c.ComponentTextures) > 0

		if isDecl {
			// 已声明：全局 texArr 模式，texSlot = 声明序位置
			if cubeCount > 0 && texSlot != wantDeclTex[c.SourceName] {
				t.Errorf("[%d] %s: texSlot=%d, 期望 %d", i, c.SourceName, texSlot, wantDeclTex[c.SourceName])
			}
			if hasCompTex {
				t.Errorf("[%d] %s: 已声明组件不应有 ComponentTextures", i, c.SourceName)
			}
			if texNames[i] == "" {
				t.Errorf("[%d] %s: texNames 不应为空", i, c.SourceName)
			}
		} else {
			// 未声明：perComponent，TexSlot=0，ComponentTextures 有条目，texNames 为空
			if texSlot != 0 {
				t.Errorf("[%d] %s: TexSlot=%d, 期望 0", i, c.SourceName, texSlot)
			}
			if !hasCompTex {
				t.Errorf("[%d] %s: 未声明组件应有 ComponentTextures", i, c.SourceName)
			}
			if texNames[i] != "" {
				t.Errorf("[%d] %s: texNames 应为空，实际 %q", i, c.SourceName, texNames[i])
			}
			// 验证 ComponentTextures 的 key 与 SourceName 一致
			if _, ok := c.ComponentTextures[c.SourceName]; !ok {
				t.Errorf("[%d] %s: ComponentTextures 缺少 key %q，实际 keys=%v",
					i, c.SourceName, c.SourceName, func() []string {
						var ks []string
						for k := range c.ComponentTextures {
							ks = append(ks, k)
						}
						return ks
					}())
			}
		}
	}

	// 汇总：日志只打 main（第一次匹配），其余 6 个在补扫段通过同名兜底
	var declCount, undeclCount int
	for _, c := range comps {
		if wantDecl[c.SourceName] {
			declCount++
		} else {
			undeclCount++
		}
	}
	if declCount != 2 {
		t.Errorf("已声明组件数 = %d, 期望 2", declCount)
	}
	if undeclCount != 5 {
		t.Errorf("未声明组件数 = %d, 期望 5", undeclCount)
	}
	t.Logf("组件分布: 已声明=%d(main/arm), 未声明=%d(arrow/trident/foxcar/minecart/boat)", declCount, undeclCount)
	// 打印组件名序列（调试用，不阻断）
	var names []string
	for _, c := range comps {
		names = append(names, c.SourceName)
	}
	t.Logf("组件序: %s", strings.Join(names, ", "))
}
