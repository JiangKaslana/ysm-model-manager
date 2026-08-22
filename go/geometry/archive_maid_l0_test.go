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

// ===== 以下 3 个测试对应实战比对出的 3 个真实世界 bug =====

// ① model_list 键（TLM 真实格式）：当前实现只认 model[] → 忽略；
//
//	修复后 model[] 和 model_list[] 都认，合并取非空。
func TestMaidL0_ModelListKey(t *testing.T) {
	manifest := `{
		"pack_name": "蔚蓝档案-阿露",
		"model_list": [
			{"model_id": "ba_aru:aru", "name": "阿露"},
			{"model_id": "ba_aru:kayoko", "name": "佳代子"}
		]
	}`
	entries := []rawZipEntry{
		{name: "assets/ba_aru/maid_model.json", method: 0, data: manifest},
		// model_id → entity/<name>.json 路径推断
		{name: "assets/ba_aru/models/entity/aru.json", method: 0, data: maidMiniGeo("aru", 0)},
		{name: "assets/ba_aru/models/entity/kayoko.json", method: 0, data: maidMiniGeo("kayoko", 1)},
		// junk
		{name: "assets/ba_aru/models/entity/unused.json", method: 0, data: maidMiniGeo("unused", 2)},
		{name: "assets/ba_aru/textures/entity/aru.png", method: 0, data: "ARU"},
		{name: "assets/ba_aru/textures/entity/kayoko.png", method: 0, data: "KAYOKO"},
		{name: "assets/ba_aru/textures/entity/unused.png", method: 0, data: "UNUSED"},
	}
	data := makeZipRaw(t, entries)
	model, pngs, _ := ParseFromZip(data, int64(len(data)))
	if model == nil {
		t.Fatal("model_list[] 应被识别为 L0 清单，模型不应为 nil")
	}
	// 2 model_list 条目 × 每个 1 bone = 2，unused 被排除
	if model.BoneCount != 2 {
		t.Errorf("BoneCount = %d, 期望 2（aru + kayoko）", model.BoneCount)
	}
	if len(pngs) != 2 {
		t.Errorf("pngs = %d, 期望 2", len(pngs))
	}
	if len(model.SubModels) != 2 {
		t.Fatalf("SubModels = %d, 期望 2", len(model.SubModels))
	}
	if model.SubModels[0].Name != "阿露" || model.SubModels[1].Name != "佳代子" {
		t.Errorf("SubModels = %+v，期望 [阿露 佳代子]", model.SubModels)
	}
}

// ② 多命名空间选"清单最长者"为真正的命名空间：
//
//	touhou_little_maid.zip 里 credits 目录的 maid_model.json 比主清单先出现，
//	原"首次匹配"策略会把 maidNs 锁到 credits，主清单被忽略。
//	修复：遍历所有 maid_model.json，选 model/model_list 数最多的那个。
func TestMaidL0_MultiNs_PickLongestManifest(t *testing.T) {
	creditsManifest := `{"pack_name":"鸣谢","model_list":[{"model_id":"credits:sazuki","name":"sazuki dev"}]}`
	mainManifest := `{
		"pack_name": "Touhou Little Maid 主包",
		"model_list": [
			{"model_id": "touhou:reimu",  "name": "灵梦"},
			{"model_id": "touhou:marisa", "name": "魔理沙"},
			{"model_id": "touhou:flandre","name": "芙兰朵露"}
		]
	}`
	entries := []rawZipEntry{
		// credits 的 maid_model.json 先出现（模拟 zip 内按字母序）——原实现会错选它
		{name: "assets/credits_authors/maid_model.json", method: 0, data: creditsManifest},
		{name: "assets/credits_authors/models/entity/sazuki.json", method: 0, data: maidMiniGeo("sazuki", 0)},
		{name: "assets/credits_authors/textures/entity/sazuki.png", method: 0, data: "SAZUKI"},
		// 真正主包（清单更长 → 应被选中）
		{name: "assets/touhou/maid_model.json", method: 0, data: mainManifest},
		{name: "assets/touhou/models/entity/reimu.json", method: 0, data: maidMiniGeo("reimu", 0)},
		{name: "assets/touhou/models/entity/marisa.json", method: 0, data: maidMiniGeo("marisa", 1)},
		{name: "assets/touhou/models/entity/flandre.json", method: 0, data: maidMiniGeo("flandre", 2)},
		{name: "assets/touhou/textures/entity/reimu.png", method: 0, data: "REIMU"},
		{name: "assets/touhou/textures/entity/marisa.png", method: 0, data: "MARISA"},
		{name: "assets/touhou/textures/entity/flandre.png", method: 0, data: "FLANDRE"},
	}
	data := makeZipRaw(t, entries)
	model, pngs, _ := ParseFromZip(data, int64(len(data)))
	if model == nil {
		t.Fatal("主包有 3 条目清单应命中")
	}
	// 选对了主命名空间 → BoneCount=3（reimu+marisa+flandre），不是 1
	if model.BoneCount != 3 {
		t.Errorf("BoneCount = %d, 期望 3（应选清单最长的主命名空间 touhou，不是 credits）", model.BoneCount)
	}
	if len(pngs) != 3 {
		t.Errorf("pngs = %d, 期望 3", len(pngs))
	}
	if len(model.SubModels) != 3 {
		t.Fatalf("SubModels = %d, 期望 3", len(model.SubModels))
	}
	if model.SubModels[0].Name != "灵梦" {
		t.Errorf("SubModels[0].Name = %q，期望 灵梦", model.SubModels[0].Name)
	}
}

// ③ model_id → zip 路径推断：当清单条目的 model/ texture 字段缺席时，
//
//	按"命名空间 + 候选后缀 + model_id 后缀去 namespace:"的方式还原 zip 路径。
//	这里还覆盖 fallback：清单声明了 model_id 但对应路径不存在时，
//	从该命名空间的 geoFiles 集合按 basename 模糊再匹配一次（防止后缀不匹配）。
func TestMaidL0_ModelIdPathInfer(t *testing.T) {
	manifest := `{
		"model_list": [
			{"model_id": "mypack:hero", "name": "勇者"},
			{"model_id": "mypack:heroine", "name": "女主角"}
		]
	}`
	// 故意用非常规路径：models/main/ 而不是 models/entity/ —— 触发 basename 后备匹配
	entries := []rawZipEntry{
		{name: "assets/mypack/maid_model.json", method: 0, data: manifest},
		{name: "assets/mypack/models/main/hero.json", method: 0, data: maidMiniGeo("hero", 0)},
		{name: "assets/mypack/models/main/heroine.json", method: 0, data: maidMiniGeo("heroine", 1)},
		{name: "assets/mypack/textures/hero.png", method: 0, data: "HERO"},
		{name: "assets/mypack/textures/heroine.png", method: 0, data: "HEROINE"},
		{name: "assets/mypack/models/main/junk.json", method: 0, data: maidMiniGeo("junk", 2)}, // 应排除
	}
	data := makeZipRaw(t, entries)
	model, pngs, _ := ParseFromZip(data, int64(len(data)))
	if model == nil {
		t.Fatal("路径推断 + basename 后备应命中")
	}
	if model.BoneCount != 2 {
		t.Errorf("BoneCount = %d, 期望 2（hero + heroine，junk 排除）", model.BoneCount)
	}
	if len(pngs) != 2 {
		t.Errorf("pngs = %d, 期望 2", len(pngs))
	}
	if len(model.SubModels) != 2 {
		t.Fatalf("SubModels = %d, 期望 2", len(model.SubModels))
	}
	if model.SubModels[0].Name != "勇者" || model.SubModels[1].Name != "女主角" {
		t.Errorf("SubModels = %+v", model.SubModels)
	}
}
