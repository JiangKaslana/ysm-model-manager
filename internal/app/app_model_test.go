package app

import (
	"encoding/json"
	"testing"
)

// Build3DSpecFromGeometryJSON：Android 等无 Node 环境的 .ysm 3D 兜底通道
// （前端 WASM 解码出 geometry JSON → 本 binding 复用 threejs.BuildMulti 构建 spec）
func TestBuild3DSpecFromGeometryJSON(t *testing.T) {
	a := &App{}
	if got := a.Build3DSpecFromGeometryJSON(""); got != "{}" {
		t.Fatalf("空输入应返回 {}，got %q", got)
	}
	if got := a.Build3DSpecFromGeometryJSON("not json"); got != "{}" {
		t.Fatalf("非法 JSON 应返回 {}，got %q", got)
	}

	const geo = `{
  "format_version": "1.12.0",
  "minecraft:geometry": [{
    "description": { "identifier": "geometry.test", "texture_width": 64, "texture_height": 32 },
    "bones": [{ "name": "bone1", "pivot": [0, 0, 0], "cubes": [{ "origin": [-4, 0, -4], "size": [8, 8, 8] }] }]
  }]
}`
	got := a.Build3DSpecFromGeometryJSON(geo)
	if got == "{}" {
		t.Fatal("合法 geometry 应构建出 spec，got {}")
	}
	var spec struct {
		Models []struct {
			MeshGroups []any `json:"meshGroups"`
		} `json:"models"`
	}
	if err := json.Unmarshal([]byte(got), &spec); err != nil {
		t.Fatalf("spec 非合法 JSON: %v", err)
	}
	if len(spec.Models) == 0 {
		t.Fatalf("spec.models 为空: %s", got)
	}
	if len(spec.Models[0].MeshGroups) == 0 {
		t.Fatalf("spec.models[0].meshGroups 为空（cube 未生成顶点）: %s", got)
	}
}
