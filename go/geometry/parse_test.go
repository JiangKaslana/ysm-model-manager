// ===== go/geometry 单测（零覆盖包补测）=====
// ParseBedrockGeometry：标准 minecraft:geometry JSON 解析
// （format/description/bones/cubes/UV 数组与对象双形态/rotation/防炸弹上限）
package geometry

import (
	"strings"
	"testing"
)

const validGeom = `{
  "format_version": "1.16.0",
  "minecraft:geometry": [
    {
      "description": { "identifier": "test", "texture_width": 64, "texture_height": 32 },
      "bones": [
        {
          "name": "head", "parent": "body", "pivot": [0, 0, 0], "rotation": [0, 10, 0],
          "cubes": [
            { "origin": [0, 0, 0], "size": [8, 8, 8], "uv": [0, 0], "texture": 0 },
            {
              "origin": [0, 8, 0], "size": [4, 4, 4],
              "uv": {"north": {"uv": [0, 0], "texture_size": [16, 16]}},
              "rotation": [0, 0, 90], "texture": 1
            }
          ]
        },
        { "name": "arm", "cubes": [] }
      ]
    }
  ]
}`

func TestParseBedrockGeometry_Valid(t *testing.T) {
	m := ParseBedrockGeometry([]byte(validGeom))
	if m == nil {
		t.Fatal("期望非 nil")
	}
	if m.Format != "1.16.0" {
		t.Errorf("Format = %q, 期望 1.16.0", m.Format)
	}
	if m.TexWidth != 64 || m.TexHeight != 32 {
		t.Errorf("TexWidth/TexHeight = %d/%d, 期望 64/32", m.TexWidth, m.TexHeight)
	}
	if m.BoneCount != 2 || m.CubeCount != 2 {
		t.Errorf("BoneCount/CubeCount = %d/%d, 期望 2/2", m.BoneCount, m.CubeCount)
	}

	head := m.Bones[0]
	if head.Name != "head" || head.Parent != "body" {
		t.Errorf("head.Name/Parent = %q/%q", head.Name, head.Parent)
	}
	if head.Rotation != [3]float64{0, 10, 0} {
		t.Errorf("head.Rotation = %v", head.Rotation)
	}
	// cube UV 数组形态 → UV 解析、FaceUV 空
	if head.Cubes[0].UV != [2]float64{0, 0} {
		t.Errorf("cubes[0].UV = %v", head.Cubes[0].UV)
	}
	if head.Cubes[0].FaceUV != "" {
		t.Errorf("cubes[0].FaceUV 应为空（数组形态）, got %q", head.Cubes[0].FaceUV)
	}
	// cube UV 对象形态 → FaceUV 保留原文
	if !strings.Contains(head.Cubes[1].FaceUV, "north") {
		t.Errorf("cubes[1].FaceUV 应保留对象原文, got %q", head.Cubes[1].FaceUV)
	}
	// cube rotation
	if head.Cubes[1].Rotation != [3]float64{0, 0, 90} {
		t.Errorf("cubes[1].Rotation = %v", head.Cubes[1].Rotation)
	}
	// 空 cubes 的骨（arm）也被登记
	if m.Bones[1].Name != "arm" || len(m.Bones[1].Cubes) != 0 {
		t.Errorf("arm bone 解析异常: %+v", m.Bones[1])
	}
}

func TestParseBedrockGeometry_EmptyGeometry(t *testing.T) {
	m := ParseBedrockGeometry([]byte(`{"format_version":"1.0","minecraft:geometry":[]}`))
	if m != nil {
		t.Fatalf("空 geometry 应返回 nil, got %+v", m)
	}
}

func TestParseBedrockGeometry_InvalidJSON(t *testing.T) {
	if m := ParseBedrockGeometry([]byte("{not json")); m != nil {
		t.Fatalf("非法 JSON 应返回 nil, got %+v", m)
	}
}

func TestParseBedrockGeometry_TooLarge(t *testing.T) {
	big := make([]byte, maxParseSize+1) // 100MB+1：防炸弹上限
	if m := ParseBedrockGeometry(big); m != nil {
		t.Fatalf("超过 100MB 上限应返回 nil")
	}
}

// ====== ParseBedrockGeometry 边界 / 畸形输入补测 ======

func TestParseBedrockGeometry_TexSizeClamp(t *testing.T) {
	// texture_width/height 无有限性校验（ADR-011 修复）：溢出/负数/超上限钳到 0，
	// 合法上限 65536 保留（防止 1e100 → int 溢出为负 → UV 归一化除垃圾值）
	cases := []struct {
		name       string
		texW, texH string
		wantW      int
		wantH      int
	}{
		{"巨大数字溢出", "1e100", "64", 0, 64},
		{"负数", "-5", "32", 0, 32},
		{"超上限 1", "65537", "32", 0, 32},
		{"上限边界", "65536", "65536", 65536, 65536},
		{"宽合法高溢出", "64", "1e100", 64, 0},
		{"宽合法高负数", "64", "-3", 64, 0},
		{"宽合法高超上限", "64", "70000", 64, 0},
	}
	for _, c := range cases {
		desc := `{"identifier":"t","texture_width":` + c.texW + `,"texture_height":` + c.texH + `}`
		geom := `{"format_version":"1.16.0","minecraft:geometry":[{"description":` + desc + `,"bones":[]}]}`
		m := ParseBedrockGeometry([]byte(geom))
		if m == nil {
			t.Fatalf("[%s] 应解析成功", c.name)
		}
		if m.TexWidth != c.wantW || m.TexHeight != c.wantH {
			t.Errorf("[%s] TexWidth/TexHeight = %d/%d, 期望 %d/%d（钳制到 [0,65536]）",
				c.name, m.TexWidth, m.TexHeight, c.wantW, c.wantH)
		}
	}
	// 缺失（description 无 texture 字段）→ 零值
	m := ParseBedrockGeometry([]byte(`{"format_version":"1.16.0","minecraft:geometry":[{"description":{"identifier":"t"},"bones":[]}]}`))
	if m == nil {
		t.Fatal("[缺失] 应解析成功")
	}
	if m.TexWidth != 0 || m.TexHeight != 0 {
		t.Errorf("[缺失] TexWidth/TexHeight = %d/%d, 期望 0/0", m.TexWidth, m.TexHeight)
	}
}

func TestParseBedrockGeometry_InvalidCubeUV(t *testing.T) {
	// cube uv 无法解析（非数组形态）→ 记日志、UV 归零，cube 仍保留
	geom := `{"format_version":"1.16.0","minecraft:geometry":[{"description":{"identifier":"t"},"bones":[{"name":"b","cubes":[{"origin":[0,0,0],"size":[1,1,1],"uv":"oops"}]}]}]}`
	m := ParseBedrockGeometry([]byte(geom))
	if m == nil {
		t.Fatal("应解析成功（UV 失败不丢弃 cube）")
	}
	if m.CubeCount != 1 || len(m.Bones[0].Cubes) != 1 {
		t.Fatalf("CubeCount = %d, 期望 1", m.CubeCount)
	}
	if m.Bones[0].Cubes[0].UV != [2]float64{} {
		t.Errorf("UV = %v, 期望零值", m.Bones[0].Cubes[0].UV)
	}
}

func TestParseBedrockGeometry_InvalidRotations(t *testing.T) {
	// cube/bone rotation 无法解析 → 记日志、归零，不 panic
	geom := `{"format_version":"1.16.0","minecraft:geometry":[{"description":{"identifier":"t"},"bones":[{"name":"b","rotation":"bad","cubes":[{"origin":[0,0,0],"size":[1,1,1],"rotation":"oops"}]}]}]}`
	m := ParseBedrockGeometry([]byte(geom))
	if m == nil {
		t.Fatal("应解析成功（rotation 失败不丢弃）")
	}
	if m.Bones[0].Rotation != [3]float64{} {
		t.Errorf("bone Rotation = %v, 期望零值", m.Bones[0].Rotation)
	}
	if m.Bones[0].Cubes[0].Rotation != [3]float64{} {
		t.Errorf("cube Rotation = %v, 期望零值", m.Bones[0].Cubes[0].Rotation)
	}
}

func TestParseBedrockGeometry_PivotAbsentVsExplicit(t *testing.T) {
	// pivot 缺席（nil）→ PivotSet=false 且 Pivot 零值；显式 [0,0,0] → PivotSet=true
	geom := `{"format_version":"1.16.0","minecraft:geometry":[{"description":{"identifier":"t"},"bones":[{"name":"b","cubes":[{"origin":[0,0,0],"size":[1,1,1],"pivot":[0,0,0]},{"origin":[1,1,1],"size":[1,1,1]}]}]}]}`
	m := ParseBedrockGeometry([]byte(geom))
	if m == nil {
		t.Fatal("应解析成功")
	}
	c0, c1 := m.Bones[0].Cubes[0], m.Bones[0].Cubes[1]
	if !c0.PivotSet || c0.Pivot != [3]float64{} {
		t.Errorf("显式 [0,0,0] pivot: PivotSet=%v Pivot=%v, 期望 true/[0,0,0]", c0.PivotSet, c0.Pivot)
	}
	if c1.PivotSet {
		t.Errorf("缺席 pivot 的 PivotSet = %v, 期望 false", c1.PivotSet)
	}
	if c1.Pivot != [3]float64{} {
		t.Errorf("缺席 pivot = %v, 期望零值", c1.Pivot)
	}
}

func TestParseBedrockGeometry_CubeAttrs(t *testing.T) {
	// texture/inflate/mirror 字段透传
	geom := `{"format_version":"1.16.0","minecraft:geometry":[{"description":{"identifier":"t"},"bones":[{"name":"b","cubes":[{"origin":[0,0,0],"size":[1,1,1],"texture":2,"inflate":0.5,"mirror":true}]}]}]}`
	m := ParseBedrockGeometry([]byte(geom))
	if m == nil {
		t.Fatal("应解析成功")
	}
	c := m.Bones[0].Cubes[0]
	if c.TexSlot != 2 || c.Inflate != 0.5 || !c.Mirror {
		t.Errorf("TexSlot/Inflate/Mirror = %d/%v/%v, 期望 2/0.5/true", c.TexSlot, c.Inflate, c.Mirror)
	}
}

func TestParseBedrockGeometry_NoBones(t *testing.T) {
	// bones 缺失 → 模型非 nil、BoneCount=0
	geom := `{"format_version":"1.16.0","minecraft:geometry":[{"description":{"identifier":"t"}}]}`
	m := ParseBedrockGeometry([]byte(geom))
	if m == nil {
		t.Fatal("无 bones 也应返回非 nil 模型")
	}
	if m.BoneCount != 0 || m.CubeCount != 0 {
		t.Errorf("BoneCount/CubeCount = %d/%d, 期望 0/0", m.BoneCount, m.CubeCount)
	}
}

func TestParseBedrockGeometry_MultipleGeometryFirstOnly(t *testing.T) {
	// 多个 minecraft:geometry 条目 → 仅首个生效（既有一致口径）
	geom := `{"format_version":"1.16.0","minecraft:geometry":[
		{"description":{"identifier":"first","texture_width":16,"texture_height":16},"bones":[{"name":"a","cubes":[]}]},
		{"description":{"identifier":"second","texture_width":128,"texture_height":128},"bones":[{"name":"b","cubes":[]}]}
	]}`
	m := ParseBedrockGeometry([]byte(geom))
	if m == nil {
		t.Fatal("应解析成功")
	}
	if m.BoneCount != 1 || m.Bones[0].Name != "a" {
		t.Errorf("应取首个条目, BoneCount=%d Bones=%+v", m.BoneCount, m.Bones)
	}
	if m.TexWidth != 16 {
		t.Errorf("TexWidth = %d, 期望 16（首个条目）", m.TexWidth)
	}
}

func TestParseBedrockGeometry_NoDescription(t *testing.T) {
	// description 缺失 → TexWidth/Height 零值、骨骼仍解析
	geom := `{"format_version":"1.16.0","minecraft:geometry":[{"bones":[{"name":"b","cubes":[{"origin":[0,0,0],"size":[1,1,1]}]}]}]}`
	m := ParseBedrockGeometry([]byte(geom))
	if m == nil {
		t.Fatal("无 description 也应解析成功")
	}
	if m.TexWidth != 0 || m.TexHeight != 0 {
		t.Errorf("TexWidth/TexHeight = %d/%d, 期望 0/0", m.TexWidth, m.TexHeight)
	}
	if m.BoneCount != 1 {
		t.Errorf("BoneCount = %d, 期望 1", m.BoneCount)
	}
}

// ====== 旧版 geometry.* 格式（车万女仆等 mod 使用）======

const oldFormatGeom = `{
  "format_version": "1.10.0",
  "geometry.model": {
    "texturewidth": 128,
    "textureheight": 128,
    "visible_bounds_width": 3,
    "visible_bounds_height": 2,
    "visible_bounds_offset": [0, 0, 0],
    "bones": [
      {
        "name": "head", "parent": "body", "pivot": [0, 18, 0],
        "cubes": [
          {"origin": [-4, 18, -4], "size": [8, 8, 8], "uv": [0, 12]}
        ]
      },
      {
        "name": "hair", "parent": "head", "pivot": [0, 18, 4],
        "rotation": [10, 0, 0],
        "cubes": [
          {"origin": [3, 8, 3], "size": [1, 10, 1], "uv": [32, 56]}
        ]
      }
    ]
  }
}`

func TestParseBedrockGeometry_OldFormat(t *testing.T) {
	m := ParseBedrockGeometry([]byte(oldFormatGeom))
	if m == nil {
		t.Fatal("旧版格式应解析成功")
	}
	if m.Format != "1.10.0" {
		t.Errorf("Format = %q, 期望 1.10.0", m.Format)
	}
	if m.TexWidth != 128 || m.TexHeight != 128 {
		t.Errorf("TexWidth/TexHeight = %d/%d, 期望 128/128", m.TexWidth, m.TexHeight)
	}
	if m.BoneCount != 2 || m.CubeCount != 2 {
		t.Errorf("BoneCount/CubeCount = %d/%d, 期望 2/2", m.BoneCount, m.CubeCount)
	}
	head := m.Bones[0]
	if head.Name != "head" || head.Parent != "body" {
		t.Errorf("head.Name/Parent = %q/%q", head.Name, head.Parent)
	}
	if head.Pivot != [3]float64{0, 18, 0} {
		t.Errorf("head.Pivot = %v", head.Pivot)
	}
	hair := m.Bones[1]
	if hair.Name != "hair" || hair.Parent != "head" {
		t.Errorf("hair.Name/Parent = %q/%q", hair.Name, hair.Parent)
	}
	if hair.Rotation != [3]float64{10, 0, 0} {
		t.Errorf("hair.Rotation = %v, 期望 [10,0,0]", hair.Rotation)
	}
}

func TestParseBedrockGeometry_OldFormatNamedKey(t *testing.T) {
	// geometry.<entity_name> 形式（非 geometry.model）
	geom := `{"format_version":"1.10.0","geometry.hakurei_reimu":{"texturewidth":64,"textureheight":64,"bones":[{"name":"body","cubes":[{"origin":[0,0,0],"size":[8,12,4],"uv":[0,0]}]}]}}`
	m := ParseBedrockGeometry([]byte(geom))
	if m == nil {
		t.Fatal("旧版命名 geometry 键应解析成功")
	}
	if m.TexWidth != 64 || m.TexHeight != 64 {
		t.Errorf("TexWidth/TexHeight = %d/%d, 期望 64/64", m.TexWidth, m.TexHeight)
	}
	if m.BoneCount != 1 || m.Bones[0].Name != "body" {
		t.Errorf("骨骼解析异常: BoneCount=%d", m.BoneCount)
	}
}

func TestParseBedrockGeometry_OldFormatTexClamp(t *testing.T) {
	// 旧版格式纹理尺寸溢出也应钳制
	geom := `{"format_version":"1.10.0","geometry.model":{"texturewidth":1e100,"textureheight":-5,"bones":[{"name":"b","cubes":[]}]}}`
	m := ParseBedrockGeometry([]byte(geom))
	if m == nil {
		t.Fatal("旧版格式溢出应仍解析成功")
	}
	if m.TexWidth != 0 || m.TexHeight != 0 {
		t.Errorf("TexWidth/TexHeight = %d/%d, 期望 0/0（钳制）", m.TexWidth, m.TexHeight)
	}
}

func TestParseBedrockGeometry_NonGeometryDescriptor(t *testing.T) {
	// maid_model.json 类描述符文件（无 geometry 键）→ 返回 nil
	desc := `{"pack_name":"test","author":["a"],"model_list":[{"model_id":"test:foo"}]}`
	m := ParseBedrockGeometry([]byte(desc))
	if m != nil {
		t.Fatalf("描述符文件应返回 nil, got %+v", m)
	}
}

func TestParseBedrockGeometry_NewFormatPreferred(t *testing.T) {
	// 同时含 minecraft:geometry 和 geometry.* → 优先新版
	geom := `{
		"format_version": "1.16.0",
		"minecraft:geometry": [{"description":{"texture_width":32,"texture_height":32},"bones":[{"name":"new","cubes":[]}]}],
		"geometry.model": {"texturewidth":128,"textureheight":128,"bones":[{"name":"old","cubes":[]}]}
	}`
	m := ParseBedrockGeometry([]byte(geom))
	if m == nil {
		t.Fatal("应解析成功")
	}
	if m.Bones[0].Name != "new" {
		t.Errorf("应优先新版格式, 首个骨骼 = %q", m.Bones[0].Name)
	}
	if m.TexWidth != 32 {
		t.Errorf("TexWidth = %d, 期望 32（新版）", m.TexWidth)
	}
}
