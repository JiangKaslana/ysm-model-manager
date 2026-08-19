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

// ===== create-blueprint 软合并（2026-08-20：蓝图+投影共享 schematics/ 目录）=====
// create-blueprint 挂 subtypes [blueprint, litematic]（整合包侧共享 schematics/），
// litematic 独立 rtype 保留（仓库侧 storageSubDir=litematics、LitematicRoot 不变）。

func TestSubtypesFor_CreateBlueprint(t *testing.T) {
	subs := SubtypesFor("create-blueprint")
	if len(subs) != 2 {
		t.Fatalf("SubtypesFor(create-blueprint) = %d 项，期望 2 项（blueprint/litematic）：%v", len(subs), subs)
	}
	want := []string{"blueprint", "litematic"}
	for i, w := range want {
		if subs[i].Name != w {
			t.Errorf("subtypes[%d].Name = %q，期望 %q", i, subs[i].Name, w)
		}
	}
	// 零继承自描述：extensions/detector/zipEntries/preview 必须完整
	for _, s := range subs {
		if len(s.Extensions) == 0 || s.Detector == "" || len(s.ZipEntries) == 0 || s.Preview == "" {
			t.Errorf("subtype %s 自描述不完整（ADR-105 零继承）：%+v", s.Name, s)
		}
	}
	// blueprint 认 .nbt/.schematic；litematic 认 .litematic（扩展名互不歧义）
	bp := SubtypeByDir("create-blueprint", "blueprint")
	if bp == nil || !bp.AcceptsExt(".nbt") || !bp.AcceptsExt(".schematic") || bp.AcceptsExt(".litematic") {
		t.Errorf("blueprint 应认 .nbt/.schematic 不认 .litematic：%+v", bp)
	}
	lt := SubtypeByDir("create-blueprint", "litematic")
	if lt == nil || !lt.AcceptsExt(".litematic") || lt.AcceptsExt(".nbt") {
		t.Errorf("litematic 应认 .litematic 不认 .nbt：%+v", lt)
	}
	// 软合并：litematic 仍是独立 rtype（仓库侧目录/配置保留）
	if rt := RegistryType("litematic"); rt == nil {
		t.Error("软合并后 litematic 独立 rtype 应保留（storageSubDir=litematics、LitematicRoot）")
	}
	// 默认槽：blueprint 为 default（.nbt/.schematic 主证据在前）
	if !bp.Default {
		t.Error("blueprint 应为 default 槽")
	}
}

func TestSubtypes_CreateBlueprintFingerprint(t *testing.T) {
	// 指纹自声明（零继承）：blueprint 命中 floor.nbt 不命中 walk.litematic
	bp := SubtypeByDir("create-blueprint", "blueprint")
	if bp == nil {
		t.Fatal("blueprint subtype 不存在")
	}
	if !bp.MatchZipEntry("hello_new_generation_core/floor.nbt") {
		t.Error("blueprint.MatchZipEntry(.../floor.nbt) = false，期望 true（.nbt 指纹）")
	}
	if bp.MatchZipEntry("build.litematic") {
		t.Error("blueprint.MatchZipEntry(build.litematic) = true，期望 false（.litematic 非蓝图指纹）")
	}
}

// ===== mod-model 模型合集软合并（2026-08-20：ysm/maid 内部结构相同、仅入口文件不同）=====
// mod-model 挂 subtypes [ysm, maid]（各自 installDir/scanDir 不同——零继承自描述），
// ysm/maid 独立 rtype 保留（仓库侧 ysm/maid-model 目录、YsmRoot 配置不变）。

func TestSubtypesFor_ModModel(t *testing.T) {
	subs := SubtypesFor("mod-model")
	if len(subs) != 2 {
		t.Fatalf("SubtypesFor(mod-model) = %d 项，期望 2 项（ysm/maid-model）：%v", len(subs), subs)
	}
	// name 直接复用独立 rtype id（ysm/maid-model）——前端 nav 展开后 rtype 零映射路由
	want := []string{"ysm", "maid-model"}
	for i, w := range want {
		if subs[i].Name != w {
			t.Errorf("subtypes[%d].Name = %q，期望 %q", i, subs[i].Name, w)
		}
	}
	// 零继承自描述：extensions/detector/zipEntries/preview/installDir/scanDir 必须完整
	for _, s := range subs {
		if len(s.Extensions) == 0 || s.Detector == "" || len(s.ZipEntries) == 0 || s.Preview == "" {
			t.Errorf("subtype %s 自描述不完整（ADR-105 零继承）：%+v", s.Name, s)
		}
		// 整合包侧目录各自声明（installDir 不同是合并前提，非共享目录）
		if s.InstallDir == "" || s.ScanDir == "" {
			t.Errorf("subtype %s 缺 installDir/scanDir（ysM/maid 物理路径不同，必须各自声明）", s.Name)
		}
	}
	// ysm 认 .ysm/.zip 入口 ysm.json/models/；maid 认 .zip 入口 maid_model.json/chair_model.json
	ysmSub := SubtypeByDir("mod-model", "ysm")
	if ysmSub == nil || !ysmSub.AcceptsExt(".ysm") || !ysmSub.MatchZipEntry("pack/ysm.json") {
		t.Errorf("ysm subtype 应认 .ysm 与 ysm.json 指纹：%+v", ysmSub)
	}
	if ysmSub.InstallDir != "versions/{instance}/ysm/" || ysmSub.ScanDir != "config/yes_steve_model/custom" {
		t.Errorf("ysm subtype 目录应各自声明（versions/{instance}/ysm/ + config 树）：%+v", ysmSub)
	}
	maidSub := SubtypeByDir("mod-model", "maid-model")
	if maidSub == nil || !maidSub.AcceptsExt(".zip") || !maidSub.MatchZipEntry("assets/ns/maid_model.json") {
		t.Errorf("maid subtype 应认 .zip 与 maid_model.json 指纹：%+v", maidSub)
	}
	if maidSub.InstallDir != "tlm_custom_pack/" || maidSub.ScanDir != "tlm_custom_pack" {
		t.Errorf("maid subtype 目录应各自声明（tlm_custom_pack/）：%+v", maidSub)
	}
	// 软合并：ysm/maid 仍是独立 rtype（仓库侧目录/配置保留）
	for _, id := range []string{"ysm", "maid-model"} {
		if rt := RegistryType(id); rt == nil {
			t.Errorf("软合并后独立 rtype %s 应保留（仓库侧目录/配置不变）", id)
		}
	}
	// default 槽：ysm（主证据 .ysm 在前）
	if !ysmSub.Default {
		t.Error("ysm 应为 default 槽")
	}
}
