package types

import (
	"strings"
	"testing"
)

// ===== Subtypes 注册表子类层（ADR-104：大类→小类→防御检验三层架构）=====

func TestSubtypesFor_MmdSkin(t *testing.T) {
	// mmd-skin 挂 8 个用途子目录（含 DefaultAnim/DefaultMorph 系统内置）
	rt := RegistryType("mmd-skin")
	if rt == nil {
		t.Fatal("RegistryType(mmd-skin) = nil，注册表缺条目")
	}
	subs := SubtypesFor("mmd-skin")
	if len(subs) == 0 {
		t.Fatal("SubtypesFor(mmd-skin) = 空，注册表缺 subtypes 数据")
	}
	want := []string{
		"EntityPlayer", "SceneModel", "CustomAnim", "CustomMorph",
		"StageAnim", "shader", "DefaultAnim", "DefaultMorph",
	}
	if len(subs) != len(want) {
		t.Fatalf("SubtypesFor(mmd-skin) 共 %d 项，期望 %d 项：%v", len(subs), len(want), subs)
	}
	// 顺序 = 注册表声明顺序（前端组序依赖，EntityPlayer 默认槽在前）
	for i, w := range want {
		if subs[i].Name != w {
			t.Errorf("subtypes[%d].Name = %q，期望 %q", i, subs[i].Name, w)
		}
	}
	// DefaultAnim/DefaultMorph 系统内置目录 userImportable=false（前端下拉不列出）
	for _, s := range subs {
		if (s.Name == "DefaultAnim" || s.Name == "DefaultMorph") && s.UserImportable {
			t.Errorf("%s 系统内置目录不应 userImportable", s.Name)
		}
	}
	// EntityPlayer 为默认槽
	if !subs[0].Default || subs[0].Name != "EntityPlayer" {
		t.Errorf("subtypes[0] 应为默认槽 EntityPlayer，got %+v", subs[0])
	}
}

func TestSubtypesFor_NonGroupingEmpty(t *testing.T) {
	// 非 subDirGrouping 类型（ysm/resourcepack 等）→ 空切片，无子类
	for _, rtype := range []string{"ysm", "resourcepack", "shaderpack"} {
		if subs := SubtypesFor(rtype); len(subs) != 0 {
			t.Errorf("SubtypesFor(%s) = %v，期望空", rtype, subs)
		}
	}
}

func TestSubtypesFor_UnknownTypeEmpty(t *testing.T) {
	if subs := SubtypesFor("no-such-type"); len(subs) != 0 {
		t.Errorf("SubtypesFor(unknown) = %v，期望空", subs)
	}
}

func TestIsSubDirName(t *testing.T) {
	// 大小写不敏感命中；非子目录名 / 非 grouping 类型 / 未知类型均 false
	cases := []struct {
		rtype string
		name  string
		want  bool
	}{
		{"mmd-skin", "SceneModel", true},
		{"mmd-skin", "scenemodel", true},  // 小写命中
		{"mmd-skin", "SCENEMODEL", true},  // 大写命中
		{"mmd-skin", "DefaultAnim", true}, // 系统内置目录也识别
		{"mmd-skin", "NotASubdir", false},
		{"ysm", "SceneModel", false}, // 非 grouping 类型无子类
		{"no-such-type", "SceneModel", false},
	}
	for _, c := range cases {
		if got := IsSubDirName(c.rtype, c.name); got != c.want {
			t.Errorf("IsSubDirName(%q, %q) = %v，期望 %v", c.rtype, c.name, got, c.want)
		}
	}
}

func TestSubtypeNames_MatchesSubdirNames(t *testing.T) {
	// 子目录名集合（小写）与 MMDSubDirs 同源：任何子目录名小写化后都在集合中
	names := SubtypeNames("mmd-skin")
	if len(names) != 8 {
		t.Fatalf("SubtypeNames(mmd-skin) = %d 项，期望 8 项：%v", len(names), names)
	}
	set := make(map[string]bool, len(names))
	for _, n := range names {
		set[strings.ToLower(n)] = true
	}
	for _, d := range MMDSubDirs() {
		if !set[strings.ToLower(d)] {
			t.Errorf("SubtypeNames 缺少 MMDSubDirs 中的 %q", d)
		}
	}
}

// ===== Subtype 完整自描述（ADR-105：零继承识别单元）=====
// 每个 subtype 自带 extensions/detector/zipEntries/preview/icon，
// 识别链路 = 物理路径定位 subtype + subtype 自声明内容校验，零回溯父级。

func TestSubtypes_SelfDescribingFields(t *testing.T) {
	subs := SubtypesFor("mmd-skin")
	if len(subs) != 8 {
		t.Fatalf("SubtypesFor(mmd-skin) = %d 项，期望 8 项", len(subs))
	}
	// 全部 subtype 必须完整自描述：icon/extensions/detector/preview 非空
	for _, s := range subs {
		if s.Icon == "" {
			t.Errorf("subtype %s icon 为空（ADR-105 零继承，必须自声明）", s.Name)
		}
		if len(s.Extensions) == 0 {
			t.Errorf("subtype %s extensions 为空（ADR-105 零继承，必须自声明）", s.Name)
		}
		if s.Detector == "" {
			t.Errorf("subtype %s detector 为空（ADR-105 零继承，必须自声明）", s.Name)
		}
		if len(s.ZipEntries) == 0 {
			t.Errorf("subtype %s zipEntries 为空（ADR-105 零继承，必须自声明）", s.Name)
		}
		if s.Preview == "" {
			t.Errorf("subtype %s preview 为空（ADR-105 零继承，必须自声明）", s.Name)
		}
	}
}

func TestSubtypes_ExtensionFingerprints(t *testing.T) {
	// 各 subtype 指纹与用途匹配：EntityPlayer/SceneModel 认 .pmx/.pmd，
	// CustomAnim/StageAnim/DefaultAnim 认 .vmd，CustomMorph/DefaultMorph 认 .vpd，
	// shader 认 .glsl/.vsh/.fsh（内容自声明，不继承父 mmd-skin 的 .pmx 指纹）
	subs := SubtypesFor("mmd-skin")
	byName := make(map[string]ResourceSubType, len(subs))
	for _, s := range subs {
		byName[s.Name] = s
	}
	hasExt := func(sub, ext string) bool {
		for _, e := range byName[sub].Extensions {
			if strings.EqualFold(e, ext) {
				return true
			}
		}
		return false
	}
	hasEntry := func(sub, name string) bool {
		for _, z := range byName[sub].ZipEntries {
			if strings.EqualFold(z.Name, name) {
				return true
			}
		}
		return false
	}
	for _, sub := range []string{"EntityPlayer", "SceneModel"} {
		if !hasExt(sub, ".pmx") || !hasEntry(sub, ".pmx") {
			t.Errorf("%s 应自声明 .pmx 扩展名与指纹", sub)
		}
	}
	for _, sub := range []string{"CustomAnim", "StageAnim", "DefaultAnim"} {
		if !hasExt(sub, ".vmd") || !hasEntry(sub, ".vmd") {
			t.Errorf("%s 应自声明 .vmd 扩展名与指纹", sub)
		}
	}
	for _, sub := range []string{"CustomMorph", "DefaultMorph"} {
		if !hasExt(sub, ".vpd") || !hasEntry(sub, ".vpd") {
			t.Errorf("%s 应自声明 .vpd 扩展名与指纹", sub)
		}
	}
	if !hasExt("shader", ".glsl") || !hasEntry("shader", ".glsl") {
		t.Error("shader 应自声明 .glsl 扩展名与指纹")
	}
	// shader 不可 3D 预览；其余可
	if byName["shader"].Preview != "none" {
		t.Errorf("shader preview = %q，期望 none", byName["shader"].Preview)
	}
	for _, sub := range []string{"EntityPlayer", "SceneModel", "CustomAnim", "CustomMorph", "StageAnim", "DefaultAnim", "DefaultMorph"} {
		if byName[sub].Preview != "3d" {
			t.Errorf("%s preview = %q，期望 3d", sub, byName[sub].Preview)
		}
	}
}

func TestSubtypes_MatchZipEntrySelf(t *testing.T) {
	// subtype 自身的 MatchZipEntry（零继承）：CustomAnim 命中 .vmd 条目，
	// 不命中 .pmx（若继承了父级指纹会误命中）
	rt := RegistryType("mmd-skin")
	var customAnim *ResourceSubType
	for i := range rt.SubTypes {
		if rt.SubTypes[i].Name == "CustomAnim" {
			customAnim = &rt.SubTypes[i]
			break
		}
	}
	if customAnim == nil {
		t.Fatal("CustomAnim subtype 不存在")
	}
	if !customAnim.MatchZipEntry("walk.vmd") {
		t.Error("CustomAnim.MatchZipEntry(walk.vmd) = false，期望 true（.vmd 自声明指纹）")
	}
	if customAnim.MatchZipEntry("hero.pmx") {
		t.Error("CustomAnim.MatchZipEntry(hero.pmx) = true，期望 false（.pmx 非动画指纹，零继承）")
	}
}

func TestSubtypeByDir(t *testing.T) {
	// 大小写不敏感按目录名查 subtype（importer 消费入口）
	sub := SubtypeByDir("mmd-skin", "customanim")
	if sub == nil || sub.Name != "CustomAnim" {
		t.Fatalf("SubtypeByDir(mmd-skin, customanim) = %+v，期望 CustomAnim", sub)
	}
	if sub := SubtypeByDir("mmd-skin", "NotASubdir"); sub != nil {
		t.Errorf("SubtypeByDir(不存在) = %+v，期望 nil", sub)
	}
	if sub := SubtypeByDir("ysm", "CustomAnim"); sub != nil {
		t.Errorf("SubtypeByDir(非 grouping 类型) = %+v，期望 nil", sub)
	}
}

func TestResourceSubType_AcceptsExt(t *testing.T) {
	subs := SubtypesFor("mmd-skin")
	byName := make(map[string]ResourceSubType, len(subs))
	for _, s := range subs {
		byName[s.Name] = s
	}
	// EntityPlayer 接受 .pmx/.pmd/.vmd/.vpd/.zip，拒绝 .nbt
	ep := byName["EntityPlayer"]
	for _, ok := range []struct {
		ext  string
		want bool
	}{
		{".pmx", true}, {".PMX", true}, {".pmd", true}, {".vmd", true},
		{".vpd", true}, {".zip", true}, {".nbt", false}, {".txt", false},
	} {
		if got := ep.AcceptsExt(ok.ext); got != ok.want {
			t.Errorf("EntityPlayer.AcceptsExt(%s) = %v，期望 %v", ok.ext, got, ok.want)
		}
	}
	// CustomAnim 只接受 .vmd/.zip——.pmx 导入该子目录应被拒绝（零继承内容校验）
	ca := byName["CustomAnim"]
	if ca.AcceptsExt(".pmx") {
		t.Error("CustomAnim.AcceptsExt(.pmx) = true，期望 false（角色模型不该进动画目录）")
	}
	if !ca.AcceptsExt(".vmd") {
		t.Error("CustomAnim.AcceptsExt(.vmd) = false，期望 true")
	}
	// shader 接受 .glsl/.vsh/.fsh
	sh := byName["shader"]
	if !sh.AcceptsExt(".glsl") || !sh.AcceptsExt(".vsh") || !sh.AcceptsExt(".fsh") {
		t.Error("shader 应接受 .glsl/.vsh/.fsh")
	}
	if sh.AcceptsExt(".pmx") {
		t.Error("shader.AcceptsExt(.pmx) = true，期望 false")
	}
}
