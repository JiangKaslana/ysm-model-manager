// ===== maid-model L0 清单（maid_model.json model[]）测试 =====
// 目标：验证 L0 清单优先于 L1 文件枚举——
//
//	当 maid_model.json 含合法 model[] 数组时，geoFiles 只收集清单内条目，
//	且只绑定清单指定的纹理；L0 缺失/非法时回退 L1 全量枚举。
package geometry

import (
	"strconv"
	"strings"
	"testing"
)

// maidMiniGeo 返回最小合法 geometry（1 骨骼 1 方块），cube.texture=i 可区分 subModel texSlot
func maidMiniGeo(id string, cubeTex int) string {
	tpl := `{"format_version":"1.16.0","minecraft:geometry":[{"description":{"identifier":"__ID__","texture_width":64,"texture_height":32},"bones":[{"name":"body","pivot":[0,0,0],"cubes":[{"origin":[0,0,0],"size":[8,8,8],"uv":[0,0],"texture":__TEX__}]}]}]}`
	s := strings.ReplaceAll(tpl, "__ID__", id)
	s = strings.ReplaceAll(s, "__TEX__", strconv.Itoa(cubeTex))
	return s
}

// maidEntriesMixed 构造：L0 清单列了 2 个模型（reimu + marisa），
// 但 zip 里还有 1 个"多余"的 junk_geo.json —— L0 生效时 junk 应被排除。
func maidEntriesMixed() []rawZipEntry {
	maidModelJSON := `{
		"pack_name": "双角色测试包",
		"model": [
			{"name": "reimu",  "model": "models/reimu.geo.json",  "texture": "textures/reimu.png"},
			{"name": "marisa", "model": "models/marisa.geo.json", "texture": "textures/marisa.png"}
		]
	}`
	return []rawZipEntry{
		{name: "assets/touhou/maid_model.json", method: 0, data: maidModelJSON},
		{name: "assets/touhou/models/reimu.geo.json", method: 0, data: maidMiniGeo("reimu", 0)},
		{name: "assets/touhou/models/marisa.geo.json", method: 0, data: maidMiniGeo("marisa", 1)},
		// junk：不在 L0 清单里 → L0 生效时应被排除
		{name: "assets/touhou/models/junk_geo.json", method: 0, data: maidMiniGeo("junk", 2)},
		// 清单声明的纹理
		{name: "assets/touhou/textures/reimu.png", method: 0, data: "REIMU-PNG"},
		{name: "assets/touhou/textures/marisa.png", method: 0, data: "MARISA-PNG"},
		// junk 纹理 → L0 生效时应被排除
		{name: "assets/touhou/textures/junk.png", method: 0, data: "JUNK-PNG"},
		// 其他命名空间（应整体跳过）
		{name: "assets/other/maid_model.json", method: 0, data: `{"model":[{"name":"alien","model":"a.geo.json","texture":"a.png"}]}`},
		{name: "assets/other/a.geo.json", method: 0, data: maidMiniGeo("alien", 0)},
		{name: "assets/other/a.png", method: 0, data: "ALIEN"},
	}
}

func TestMaidL0_ManifestPriority(t *testing.T) {
	data := makeZipRaw(t, maidEntriesMixed())
	model, pngs, _ := ParseFromZip(data, int64(len(data)))
	if model == nil {
		t.Fatal("L0 清单合法时模型不应为 nil")
	}
	// 断言 1：只收了 2 个 geometry（reimu + marisa），junk 被排除
	// → Bones 聚合：reimu 1 bone + marisa 1 bone = 2
	if model.BoneCount != 2 {
		t.Errorf("BoneCount = %d, 期望 2（L0 清单只列 reimu+marisa，junk 应排除）", model.BoneCount)
	}
	// 断言 2：只绑定了 2 张纹理（reimu + marisa），junk 纹理被排除
	if len(pngs) != 2 {
		t.Errorf("pngs = %d, 期望 2（L0 清单只列 2 张纹理）", len(pngs))
	}
	// 断言 3：SubModels 与 L0 清单同序同命名
	if len(model.SubModels) != 2 {
		t.Fatalf("SubModels = %d, 期望 2", len(model.SubModels))
	}
	if model.SubModels[0].Name != "reimu" {
		t.Errorf("SubModels[0].Name = %q, 期望 reimu", model.SubModels[0].Name)
	}
	if model.SubModels[1].Name != "marisa" {
		t.Errorf("SubModels[1].Name = %q, 期望 marisa", model.SubModels[1].Name)
	}
	if model.SubModels[0].SourcePath != "assets/touhou/models/reimu.geo.json" {
		t.Errorf("SubModels[0].SourcePath = %q", model.SubModels[0].SourcePath)
	}
}

func TestMaidL0_MissingFallback_L1(t *testing.T) {
	// 无 maid_model.json 的场景 → 回退 L1（全量枚举 geometry JSON）
	entries := []rawZipEntry{
		{name: "assets/any/a.geo.json", method: 0, data: maidMiniGeo("a", 0)},
		{name: "assets/any/b.geo.json", method: 0, data: maidMiniGeo("b", 0)},
		{name: "assets/any/a.png", method: 0, data: "A"},
		{name: "assets/any/b.png", method: 0, data: "B"},
	}
	data := makeZipRaw(t, entries)
	model, pngs, _ := ParseFromZip(data, int64(len(data)))
	if model == nil {
		t.Fatal("L1 兜底时模型不应为 nil")
	}
	// L1：所有 geometry 都被收 → 2 bone
	if model.BoneCount != 2 {
		t.Errorf("L1 兜底 BoneCount = %d, 期望 2", model.BoneCount)
	}
	// L1：所有 png 都被收 → 2
	if len(pngs) != 2 {
		t.Errorf("L1 兜底 pngs = %d, 期望 2", len(pngs))
	}
	// L1：SubModels 从 geoFiles 派生（Name = 文件名去后缀）
	if len(model.SubModels) != 2 {
		t.Fatalf("L1 兜底 SubModels = %d, 期望 2", len(model.SubModels))
	}
}

func TestMaidL0_EmptyModelArray_Fallback(t *testing.T) {
	// maid_model.json 存在，但 model[] 为空 → L0 无效，回退 L1
	entries := []rawZipEntry{
		{name: "assets/ns/maid_model.json", method: 0, data: `{"model":[],"pack_name":"空清单"}`},
		{name: "assets/ns/x.geo.json", method: 0, data: maidMiniGeo("x", 0)},
		{name: "assets/ns/x.png", method: 0, data: "X"},
	}
	data := makeZipRaw(t, entries)
	model, _, _ := ParseFromZip(data, int64(len(data)))
	if model == nil {
		t.Fatal("L0 空清单时应回退 L1，模型不应为 nil")
	}
	if model.BoneCount != 1 {
		t.Errorf("L0 空清单回退 BoneCount = %d, 期望 1", model.BoneCount)
	}
	if len(model.SubModels) != 1 || model.SubModels[0].Name != "x" {
		t.Errorf("L0 空清单回退 SubModels = %+v，期望 [{Name:x}]", model.SubModels)
	}
}

func TestMaidL0_MalformedJSON_Fallback(t *testing.T) {
	// maid_model.json JSON 语法损坏 → L0 失效，回退 L1（不崩溃）
	entries := []rawZipEntry{
		{name: "assets/ns/maid_model.json", method: 0, data: `{model:[ this is not json`},
		{name: "assets/ns/good.geo.json", method: 0, data: maidMiniGeo("good", 0)},
		{name: "assets/ns/good.png", method: 0, data: "GOOD"},
	}
	data := makeZipRaw(t, entries)
	model, _, _ := ParseFromZip(data, int64(len(data)))
	if model == nil {
		t.Fatal("L0 畸形 JSON 时应回退 L1，模型不应为 nil")
	}
	if model.BoneCount != 1 {
		t.Errorf("L0 畸形 JSON 回退 BoneCount = %d, 期望 1", model.BoneCount)
	}
}
