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
