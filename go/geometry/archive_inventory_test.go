package geometry

import (
	"strings"
	"testing"

	"ysm-model-manager/go/types"
)

// ===== 文件归属识别（parseGlobalResources 轻量版：只识别不解析）=====

// zip 内文件归属分类端到端验证：ParseFromZip 后 geo.FileInventory 分类正确
func TestFileInventory_Classified(t *testing.T) {
	data := makeZipWithFiles(t, map[string]string{
		"ysm.json":                                 `{"files":{"player":{"model":{"main":"models/main.json"},"texture":["textures/skin.png"]}}}`,
		"models/main.json":                         minimalMainJSON,
		"textures/skin.png":                        tinyPNG(),
		"animations/main.animation.json":           `{"animations":{}}`,
		"animations/arm.animation_controller.json": `{"format_version":"1.10.0"}`,
		"lang/zh_CN.lang":                          `model.name=测试`,
		"include/head.inc":                         `{ "head" }`,
		"avatar/wmdj.jpg":                          `fake-jpg`,
	})
	geo, _, _ := ParseFromZip(data, int64(len(data)))
	if geo == nil {
		t.Fatal("ParseFromZip 返回 nil")
	}
	inv := geo.FileInventory
	if inv == nil {
		t.Fatal("期望 geo.FileInventory 非 nil（parseModelFromEntries 挂载）")
	}
	checkInv(t, inv)
}

// 组件路径：ParseComponentsFromZip 每个组件模型都应挂同一 zip 清单
func TestFileInventory_ComponentsPath(t *testing.T) {
	data := makeZipWithFiles(t, map[string]string{
		"ysm.json":                       `{"files":{"player":{"model":{"main":"models/main.json","arm":"models/arm.json"},"texture":["textures/skin.png"]}}}`,
		"models/main.json":               minimalMainJSON,
		"models/arm.json":                `{"minecraft:geometry":[{"description":{"texture_width":64,"texture_height":64},"bones":[{"name":"arm","pivot":[0,0,0],"cubes":[{"origin":[0,0,0],"size":[2,2,2],"uv":[0,0]}]}]}]}`,
		"textures/skin.png":              tinyPNG(),
		"animations/main.animation.json": `{"animations":{}}`,
	})
	models, _, err := ParseComponentsFromZip(data, int64(len(data)))
	if err != nil {
		t.Fatalf("ParseComponentsFromZip: %v", err)
	}
	if len(models) < 2 {
		t.Fatalf("期望至少 2 个组件, 实际 %d", len(models))
	}
	for _, m := range models {
		if m.FileInventory == nil {
			t.Errorf("组件 %s: 期望 FileInventory 非 nil", m.SourceName)
		} else if len(m.FileInventory.Animations) != 1 {
			t.Errorf("组件 %s: Animations = %d, 期望 1", m.SourceName, len(m.FileInventory.Animations))
		}
	}
}

// 直接测 classifyFileInventory：无 ysm.json 声明的文件归属（含旧格式几何识别）
func TestClassifyFileInventory_Direct(t *testing.T) {
	inv := classifyFileInventory(nil)
	if inv == nil {
		t.Fatal("classifyFileInventory 不应返回 nil")
	}
	// 空 entries → 全空
	if len(inv.Animations) != 0 || len(inv.Controllers) != 0 || len(inv.LangFiles) != 0 {
		t.Errorf("空 entries 应全空: %+v", inv)
	}
}

// checkInv 断言 FileInventory 分类（与 fixture 文件对应）
func checkInv(t *testing.T, inv *types.FileInventory) {
	t.Helper()
	has := func(list []string, sub string) bool {
		for _, s := range list {
			if strings.Contains(strings.ToLower(s), sub) {
				return true
			}
		}
		return false
	}
	if !has(inv.Animations, "main.animation.json") {
		t.Errorf("Animations 应含 main.animation.json, 实际 %v", inv.Animations)
	}
	if !has(inv.Controllers, "animation_controller.json") {
		t.Errorf("Controllers 应含 arm.animation_controller.json, 实际 %v", inv.Controllers)
	}
	if !has(inv.LangFiles, ".lang") {
		t.Errorf("LangFiles 应含 zh_CN.lang, 实际 %v", inv.LangFiles)
	}
	if !has(inv.IncFiles, ".inc") {
		t.Errorf("IncFiles 应含 head.inc, 实际 %v", inv.IncFiles)
	}
	if !has(inv.Avatars, "avatar/") {
		t.Errorf("Avatars 应含 avatar/wmdj.jpg, 实际 %v", inv.Avatars)
	}
	if !has(inv.LegacyModels, "main.json") {
		t.Errorf("LegacyModels 应含 main.json, 实际 %v", inv.LegacyModels)
	}
	// ysm.json 不得进任何类
	for _, list := range [][]string{inv.Animations, inv.Controllers, inv.LangFiles, inv.IncFiles, inv.Avatars, inv.LegacyModels} {
		for _, s := range list {
			if strings.Contains(strings.ToLower(s), "ysm.json") {
				t.Errorf("ysm.json 不应进任何分类: %s ∈ %v", s, list)
			}
		}
	}
}
