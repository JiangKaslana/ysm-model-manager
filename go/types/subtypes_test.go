package types

import (
	"sort"
	"strings"
	"testing"
)

// ===== Subtypes 注册表子类层（ADR-104：大类→小类→防御检验三层架构）=====

func TestSubtypesFor_MmdSkin(t *testing.T) {
	rt := RegistryType("mmd-skin")
	if rt == nil {
		t.Fatal("RegistryType(mmd-skin) = nil，注册表缺条目")
	}
	subs := SubtypesFor("mmd-skin")
	if len(subs) == 0 {
		t.Fatal("SubtypesFor(mmd-skin) = 空，注册表缺 subtypes 数据")
	}
	if len(subs) != len(rt.SubTypes) {
		t.Fatalf("SubtypesFor(mmd-skin) 共 %d 项，期望 %d 项（来自 JSON）：%v", len(subs), len(rt.SubTypes), subs)
	}
	want := []string{
		"EntityPlayer", "SceneModel", "CustomAnim", "CustomMorph",
		"StageAnim", "shader", "DefaultAnim", "DefaultMorph", "vrchat-avatar",
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

func TestSubtypes_MmdVrmParasite(t *testing.T) {
	// ADR-105 续（VRM 寄生）：vrchat-avatar 是 mmd-skin 的 subtype——
	// 整合包侧 installDir=3d-skin/EntityPlayer/（MC-MMD 加载 VRM），
	// 仓库侧独立 rtype 保留（vrchat 目录/VrcRoot 配置不变），group 归 mmd。
	rt := RegistryType("mmd-skin")
	if rt == nil {
		t.Fatal("mmd-skin 条目缺失")
	}
	vrm := SubtypeByDir("mmd-skin", "vrchat-avatar")
	if vrm == nil {
		t.Fatal("vrchat-avatar 应为 mmd-skin 的 subtype（寄生 EntityPlayer）")
	}
	// 零继承自描述
	if len(vrm.Extensions) == 0 || vrm.Detector == "" || len(vrm.ZipEntries) == 0 || vrm.Preview == "" {
		t.Errorf("vrchat-avatar subtype 自描述不完整：%+v", vrm)
	}
	// 整合包侧寄生目录：3d-skin/EntityPlayer/（与 EntityPlayer 同目录，靠扩展名区分）
	if vrm.InstallDir != "3d-skin/EntityPlayer/" || vrm.ScanDir != "3d-skin/EntityPlayer" {
		t.Errorf("vrchat-avatar installDir/scanDir 应指向 3d-skin/EntityPlayer/：%+v", vrm)
	}
	// 指纹：认 .vrm/.vrca，不认 .pmx（与 EntityPlayer 靠扩展名区分）
	if !vrm.AcceptsExt(".vrm") || !vrm.AcceptsExt(".vrca") || !vrm.MatchZipEntry("hero.vrm") {
		t.Errorf("vrchat-avatar 应认 .vrm/.vrca 指纹：%+v", vrm)
	}
	if vrm.AcceptsExt(".pmx") {
		t.Error("vrchat-avatar 不应认 .pmx（EntityPlayer 专属）")
	}
	// 仓库侧独立 rtype 保留
	rtVrc := RegistryType("vrchat-avatar")
	if rtVrc == nil {
		t.Fatal("vrchat-avatar 独立 rtype 应保留（软合并）")
	}
	if rtVrc.Group != "mmd" {
		t.Errorf("vrchat-avatar group = %q，期望 mmd（vrm 组归并）", rtVrc.Group)
	}
	// 非默认槽（EntityPlayer 仍是默认）
	if vrm.Default {
		t.Error("vrchat-avatar 不应为 default 槽")
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
	rt := RegistryType("mmd-skin")
	if rt == nil {
		t.Fatal("mmd-skin 条目缺失")
	}
	if len(names) != len(rt.SubTypes) {
		t.Fatalf("SubtypeNames(mmd-skin) = %d 项，期望 %d 项（来自 JSON）：%v", len(names), len(rt.SubTypes), names)
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
	rt := RegistryType("mmd-skin")
	if rt == nil {
		t.Fatal("mmd-skin 条目缺失")
	}
	if len(subs) != len(rt.SubTypes) {
		t.Fatalf("SubtypesFor(mmd-skin) = %d 项，期望 %d 项（来自 JSON）：%v", len(subs), len(rt.SubTypes), subs)
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
	rt := RegistryType("create-blueprint")
	if rt == nil {
		t.Fatal("create-blueprint 条目缺失")
	}
	if len(subs) != len(rt.SubTypes) {
		t.Fatalf("SubtypesFor(create-blueprint) = %d 项，期望 %d 项（来自 JSON）：%v", len(subs), len(rt.SubTypes), subs)
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
	rt := RegistryType("mod-model")
	if rt == nil {
		t.Fatal("mod-model 条目缺失")
	}
	if len(subs) != len(rt.SubTypes) {
		t.Fatalf("SubtypesFor(mod-model) = %d 项，期望 %d 项（来自 JSON）：%v", len(subs), len(rt.SubTypes), subs)
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

// ===== vanilla-assets 原版资源合集软合并（2026-08-20：resourcepack/shaderpack 收合集壳）=====
// vanilla-assets 挂 subtypes [resourcepack, shaderpack]（各自 installDir 不同、
// detector 不同——零继承自描述），resourcepack/shaderpack 独立 rtype 保留。

func TestSubtypesFor_VanillaAssets(t *testing.T) {
	subs := SubtypesFor("vanilla-assets")
	rt := RegistryType("vanilla-assets")
	if rt == nil {
		t.Fatal("vanilla-assets 条目缺失")
	}
	if len(subs) != len(rt.SubTypes) {
		t.Fatalf("SubtypesFor(vanilla-assets) = %d 项，期望 %d 项（来自 JSON）：%v", len(subs), len(rt.SubTypes), subs)
	}
	want := []string{"resourcepack", "shaderpack"}
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
		if s.InstallDir == "" || s.ScanDir == "" {
			t.Errorf("subtype %s 缺 installDir/scanDir（各自声明）", s.Name)
		}
	}
	// resourcepack 认 pack.mcmeta（mcmeta detector）；shaderpack 认 shaders/（shader detector）
	rp := SubtypeByDir("vanilla-assets", "resourcepack")
	if rp == nil || !rp.MatchZipEntry("pack.mcmeta") || rp.Detector != "mcmeta" {
		t.Errorf("resourcepack subtype 应认 pack.mcmeta 指纹 + mcmeta detector：%+v", rp)
	}
	if rp.InstallDir != "resourcepacks/" || rp.ScanDir != "resourcepacks" {
		t.Errorf("resourcepack subtype 目录应各自声明（resourcepacks/）：%+v", rp)
	}
	sp := SubtypeByDir("vanilla-assets", "shaderpack")
	if sp == nil || !sp.MatchZipEntry("shaders/foo.fsh") || sp.Detector != "shader" {
		t.Errorf("shaderpack subtype 应认 shaders/ 指纹 + shader detector：%+v", sp)
	}
	if sp.InstallDir != "shaderpacks/" || sp.ScanDir != "shaderpacks" {
		t.Errorf("shaderpack subtype 目录应各自声明（shaderpacks/）：%+v", sp)
	}
	// 软合并：独立 rtype 保留
	for _, id := range []string{"resourcepack", "shaderpack"} {
		if rt := RegistryType(id); rt == nil {
			t.Errorf("软合并后独立 rtype %s 应保留", id)
		}
	}
	// default 槽：resourcepack（在前）
	if !rp.Default {
		t.Error("resourcepack 应为 default 槽")
	}
}

// ===== 软合并字段一致性（ADR-105 审核 P1#3）=====
// 对每个 subtype，若其 name 匹配独立 rtype id，断言两者关键字段一致。
// 字段差异可记录：subtype 无 storageSubDir/configField（各司其职）。

func TestSubtypes_SoftMergedFieldConsistency(t *testing.T) {
	// 待检查的字段：这些字段在 subtype 和独立 rtype 中语义应一致
	type fieldCheck struct {
		subName  string                    // subtype 字段名
		rtField  func(*ResourceType) any   // 独立 rtype 取值
		subField func(ResourceSubType) any // subtype 取值
		label    string
	}
	checks := []fieldCheck{
		{"detector", func(rt *ResourceType) any { return rt.Detector }, func(s ResourceSubType) any { return s.Detector }, "detector"},
		{"preview", func(rt *ResourceType) any { return rt.Preview }, func(s ResourceSubType) any { return s.Preview }, "preview"},
		{"installDir", func(rt *ResourceType) any { return rt.InstallDir }, func(s ResourceSubType) any { return s.InstallDir }, "installDir"},
		{"scanDir", func(rt *ResourceType) any { return rt.ScanDir }, func(s ResourceSubType) any { return s.ScanDir }, "scanDir"},
	}
	reg := LoadRegistry()
	for _, parent := range reg.ResourceTypes {
		if len(parent.SubTypes) == 0 {
			continue
		}
		for _, sub := range parent.SubTypes {
			rt := RegistryType(sub.Name)
			if rt == nil {
				continue // name 不匹配任何独立 rtype，跳过
			}
			t.Run(parent.ID+"→"+sub.Name, func(t *testing.T) {
				// 扩展名一致性（排序后逐元素比较）
				subExts := make([]string, len(sub.Extensions))
				copy(subExts, sub.Extensions)
				sort.Strings(subExts)
				rtExts := make([]string, len(rt.Extensions))
				copy(rtExts, rt.Extensions)
				sort.Strings(rtExts)
				if len(subExts) != len(rtExts) {
					t.Errorf("extensions 长度不一致：subtype=%v, rtype=%v", subExts, rtExts)
				} else {
					for i := range subExts {
						if !strings.EqualFold(subExts[i], rtExts[i]) {
							t.Errorf("extensions[%d] 不一致：subtype=%q, rtype=%q", i, subExts[i], rtExts[i])
						}
					}
				}
				// zipEntries 一致性（按 Name 匹配后比对）
				subZip := make(map[string]string, len(sub.ZipEntries))
				for _, z := range sub.ZipEntries {
					subZip[strings.ToLower(z.Name)] = z.Match
				}
				rtZip := make(map[string]string, len(rt.ZipEntries))
				for _, z := range rt.ZipEntries {
					rtZip[strings.ToLower(z.Name)] = z.Match
				}
				for k, v := range subZip {
					if rv, ok := rtZip[k]; !ok {
						t.Errorf("zipEntries subtype 有 %q=%q，rtype 无", k, v)
					} else if !strings.EqualFold(v, rv) {
						t.Errorf("zipEntries %q match 不一致：subtype=%q, rtype=%q", k, v, rv)
					}
				}
				for k, v := range rtZip {
					if _, ok := subZip[k]; !ok {
						t.Errorf("zipEntries rtype 有 %q=%q，subtype 无（注意：这可能是独立 rtype 特有的条目，需确认）", k, v)
					}
				}
				// 标量字段一致性
				for _, c := range checks {
					rv := c.rtField(rt)
					sv := c.subField(sub)
					if rv != sv {
						// installDir/scanDir 允许 subtype 有而 rtype 无（子类型重写整合包路径）
						if sv == "" {
							continue
						}
						// VRM 寄生（vrchat-avatar→mmd-skin）：subtype 的 installDir/scanDir 指向
						// 3d-skin/EntityPlayer/（MC-MMD 加载路径），独立 rtype 的指向 vrchat-avatars/
						// （仓库侧存储路径）——设计意图不同，允许差异。
						if sub.Name == "vrchat-avatar" && (c.label == "installDir" || c.label == "scanDir") {
							continue
						}
						t.Errorf("%s 不一致：subtype=%v, rtype=%v", c.label, sv, rv)
					}
				}
			})
		}
	}
}
