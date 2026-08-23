package ysm

import (
	"encoding/json"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/threejs"
)

// TestWineFoxBoatSpecTexIdx 验证 BuildMulti 输出中 boat 组件的 meshGroups[0].texIdx = 0。
func TestWineFoxBoatSpecTexIdx(t *testing.T) {
	dir := filepath.Join("..", "..", "upstream", "[YSM模型]官方开源wine_fox_json", "01_taisho_maid")
	ysmPath := filepath.Join(dir, "ysm.json")
	comps, _ := FindComponentsInExtractedYSM(ysmPath)

	spec, err := threejs.BuildMulti(comps, nil)
	if err != nil {
		t.Fatalf("BuildMulti 失败: %v", err)
	}

	var doc struct {
		Models []struct {
			ID         string                 `json:"id"`
			Name       string                 `json:"name"`
			MeshGroups []struct{ TexIdx int } `json:"meshGroups"`
		} `json:"models"`
	}
	if err := json.Unmarshal([]byte(spec), &doc); err != nil {
		t.Fatalf("spec 解析失败: %v", err)
	}

	for i, mg := range doc.Models {
		var firstTexIdx int
		if len(mg.MeshGroups) > 0 {
			firstTexIdx = mg.MeshGroups[0].TexIdx
		}
		t.Logf("  comp[%d] id=%s name=%-8s meshCount=%d firstTexIdx=%d",
			i, mg.ID, mg.Name, len(mg.MeshGroups), firstTexIdx)
	}

	for i := range doc.Models {
		if doc.Models[i].Name == "boat" {
			for j, mesh := range doc.Models[i].MeshGroups {
				if mesh.TexIdx != 0 {
					t.Errorf("boat mesh[%d].texIdx = %d, 期望 0", j, mesh.TexIdx)
				}
			}
			t.Logf("✓ boat: %d 个 mesh，首项 texIdx=%d", len(doc.Models[i].MeshGroups), doc.Models[i].MeshGroups[0].TexIdx)
			return
		}
	}
	t.Fatal("spec 中未找到 name=boat 的 model group")
}
