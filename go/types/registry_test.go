package types

import (
	"os"
	"path/filepath"
	"testing"
)

func TestAllExts(t *testing.T) {
	exts := AllExts()
	if len(exts) == 0 {
		t.Fatal("AllExts() = 空")
	}
	// .zip 应只出现一次（去重）
	count := 0
	for _, e := range exts {
		if e == ".zip" {
			count++
		}
	}
	if count != 1 {
		t.Errorf(".zip 出现 %d 次，期望 1 次（去重）", count)
	}
	// 已知扩展名存在于结果中
	known := []string{".ysm", ".vrca", ".nbt"}
	for _, ext := range known {
		found := false
		for _, e := range exts {
			if e == ext {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("AllExts() 缺少 %q", ext)
		}
	}
}

func TestIsSupportedExt(t *testing.T) {
	// 支持的扩展名
	if !IsSupportedExt(".ysm") {
		t.Error("IsSupportedExt('.ysm') = false, 期望 true")
	}
	if !IsSupportedExt(".YSM") {
		t.Error("IsSupportedExt('.YSM') = false, 期望 true（大小写不敏感）")
	}
	if !IsSupportedExt(".zip") {
		t.Error("IsSupportedExt('.zip') = false, 期望 true")
	}
	// 不支持的扩展名
	if IsSupportedExt(".xyz") {
		t.Error("IsSupportedExt('.xyz') = true, 期望 false")
	}
	if IsSupportedExt(".txt") {
		t.Error("IsSupportedExt('.txt') = true, 期望 false")
	}
}

func TestExtBelongsTo(t *testing.T) {
	// .ysm 应属于 ysm
	ids := ExtBelongsTo(".ysm")
	if len(ids) != 1 || ids[0] != "ysm" {
		t.Errorf("ExtBelongsTo('.ysm') = %v, 期望 [ysm]", ids)
	}
	// .zip 应属于全部 9 类（S1 ADR-067：.zip 是通用容器扩展名，
	// mmd/vrc/蓝图/投影/车万女仆 新增 .zip 包裹识别；ADR-105 mod-model 合集壳也声明容器扩展名；
	// 前端 AMBIGUOUS_EXTS 由此派生歧义集）
	ids = ExtBelongsTo(".zip")
	if len(ids) != 9 {
		t.Errorf("ExtBelongsTo('.zip') = %v, 期望 9 类（含 mod-model 合集壳）", ids)
	}
	// 应包含全部类型（顺序不定）
	expectedAll := map[string]bool{
		"ysm": false, "resourcepack": false, "shaderpack": false,
		"create-blueprint": false, "litematic": false,
		"mmd-skin": false, "vrchat-avatar": false, "maid-model": false,
		"mod-model": false,
	}
	for _, id := range ids {
		if _, ok := expectedAll[id]; ok {
			expectedAll[id] = true
		}
	}
	for id, found := range expectedAll {
		if !found {
			t.Errorf("ExtBelongsTo('.zip') 缺少类型 %s，实际 %v", id, ids)
		}
	}
	// 不支持扩展名
	if ids := ExtBelongsTo(".xyz"); len(ids) != 0 {
		t.Errorf("ExtBelongsTo('.xyz') = %v, 期望 []", ids)
	}
}

func TestSupportedExtsForType(t *testing.T) {
	// 已知类型
	exts := SupportedExtsForType("ysm")
	if len(exts) == 0 {
		t.Fatal("SupportedExtsForType('ysm') = 空")
	}
	if !contains(exts, ".ysm") {
		t.Error("SupportedExtsForType('ysm') 缺少 .ysm")
	}
	// 大小写不敏感（向后兼容）
	exts = SupportedExtsForType("YSM")
	if len(exts) == 0 {
		t.Error("SupportedExtsForType('YSM') = 空（大小写不敏感）")
	}
	// 未知类型
	if exts := SupportedExtsForType("unknown"); exts != nil {
		t.Errorf("SupportedExtsForType('unknown') = %v, 期望 nil", exts)
	}
}

func TestStorageSubDir(t *testing.T) {
	// 已知类型
	expectedIDs := []string{"ysm", "mmd-skin", "vrchat-avatar", "resourcepack", "shaderpack", "create-blueprint"}
	for _, id := range expectedIDs {
		dir := StorageSubDir(id)
		if dir == "" {
			t.Errorf("StorageSubDir(%q) = 空字符串", id)
		}
	}
	// StorageSubDir 应返回 JSON 中的 storageSubDir
	if got := StorageSubDir("resourcepack"); got != "resourcepacks" {
		t.Errorf("StorageSubDir('resourcepack') = %q, 期望 'resourcepacks'", got)
	}
	if got := StorageSubDir("ysm"); got != "ysm" {
		t.Errorf("StorageSubDir('ysm') = %q, 期望 'ysm'", got)
	}
	// 未知类型应返回自身
	if got := StorageSubDir("unknown"); got != "unknown" {
		t.Errorf("StorageSubDir('unknown') = %q, 期望 'unknown'", got)
	}
}

func TestGroupOf(t *testing.T) {
	cases := []struct{ rtype, want string }{
		{"resourcepack", "minecraft"},
		{"shaderpack", "minecraft"},
		{"ysm", "minecraft-mod"},
		{"create-blueprint", "minecraft-mod"},
		{"litematic", "minecraft-mod"},
		{"mmd-skin", "mmd"},
		{"vrchat-avatar", "vrm"},
	}
	for _, c := range cases {
		if got := GroupOf(c.rtype); got != c.want {
			t.Errorf("GroupOf(%q) = %q, 期望 %q", c.rtype, got, c.want)
		}
	}
	// 未知类型无 group
	if got := GroupOf("unknown"); got != "" {
		t.Errorf("GroupOf('unknown') = %q, 期望 ''", got)
	}
}

func TestGroupStorageRoot(t *testing.T) {
	// 有 group → 两层路由 {group}/{storageSubDir}
	cases := []struct{ rtype, want string }{
		{"resourcepack", "minecraft/resourcepacks"},
		{"shaderpack", "minecraft/shaderpacks"},
		{"ysm", "minecraft-mod/ysm"},
		{"create-blueprint", "minecraft-mod/create-blueprint"},
		{"litematic", "minecraft-mod/litematics"},
		{"mmd-skin", "mmd/EntityPlayer"}, // storageSubDir 统一整合包同款名（消 mmd/mmd 冗余）
		{"vrchat-avatar", "vrm/vrchat"},
	}
	for _, c := range cases {
		if got := GroupStorageRoot(c.rtype); got != c.want {
			t.Errorf("GroupStorageRoot(%q) = %q, 期望 %q", c.rtype, got, c.want)
		}
	}
	// 未知类型回退自身
	if got := GroupStorageRoot("unknown"); got != "unknown" {
		t.Errorf("GroupStorageRoot('unknown') = %q, 期望 'unknown'", got)
	}
}

func TestGroupLabel(t *testing.T) {
	if got := GroupLabel("minecraft"); got != "Minecraft 原版" {
		t.Errorf("GroupLabel('minecraft') = %q, 期望 'Minecraft 原版'", got)
	}
	if got := GroupLabel("mmd"); got != "MMD" {
		t.Errorf("GroupLabel('mmd') = %q, 期望 'MMD'", got)
	}
	// 未知/空分组返回空串
	if got := GroupLabel("nope"); got != "" {
		t.Errorf("GroupLabel('nope') = %q, 期望 ''", got)
	}
	if got := GroupLabel(""); got != "" {
		t.Errorf("GroupLabel('') = %q, 期望 ''", got)
	}
}

func TestSubDirMap(t *testing.T) {
	// 已知类型
	if got := SubDirMap("resourcepack"); got != "resourcepacks" {
		t.Errorf("SubDirMap('resourcepack') = %q, 期望 'resourcepacks'", got)
	}
	if got := SubDirMap("ysm"); got != "config/yes_steve_model/custom" {
		t.Errorf("SubDirMap('ysm') = %q, 期望 'config/yes_steve_model/custom'", got)
	}
	// 未知类型
	if got := SubDirMap("unknown"); got != "" {
		t.Errorf("SubDirMap('unknown') = %q, 期望 ''", got)
	}
}

func TestSubDirAll(t *testing.T) {
	m := SubDirAll()
	// 应覆盖所有已知类型
	expected := []string{"ysm", "mmd-skin", "vrchat-avatar", "resourcepack", "shaderpack", "create-blueprint"}
	for _, id := range expected {
		if _, ok := m[id]; !ok {
			t.Errorf("SubDirAll 缺少类型 %q", id)
		}
	}
	// scanDir 值应与 JSON 一致
	if m["resourcepack"] != "resourcepacks" {
		t.Errorf("SubDirAll['resourcepack'] = %q, 期望 'resourcepacks'", m["resourcepack"])
	}
	if m["ysm"] != "config/yes_steve_model/custom" {
		t.Errorf("SubDirAll['ysm'] = %q, 期望 'config/yes_steve_model/custom'", m["ysm"])
	}
}

func TestAllSubDirs(t *testing.T) {
	entries := AllSubDirs()
	entryMap := make(map[string]string)
	for _, e := range entries {
		entryMap[e.RType] = e.SubDir
	}
	// 应覆盖所有已知类型
	expected := []string{"ysm", "mmd-skin", "vrchat-avatar", "resourcepack", "shaderpack", "create-blueprint"}
	for _, id := range expected {
		if _, ok := entryMap[id]; !ok {
			t.Errorf("AllSubDirs 缺少类型 %q", id)
		}
	}
	// SubDir 值应与 JSON scanDir 一致
	if entryMap["resourcepack"] != "resourcepacks" {
		t.Errorf("AllSubDirs resourcepack = %q, 期望 'resourcepacks'", entryMap["resourcepack"])
	}
}

func TestSupportedExtsForTypeUnknown(t *testing.T) {
	// 未知类型返回 nil
	if got := SupportedExtsForType("non-existent-type"); got != nil {
		t.Errorf("SupportedExtsForType('non-existent-type') = %v, 期望 nil", got)
	}
}

func contains(slice []string, s string) bool {
	for _, v := range slice {
		if v == s {
			return true
		}
	}
	return false
}

// P3 补测：损坏外部 JSON 必须回退嵌入基线（不缓存空注册表、不 panic）——
// 无测试钉住：原实现解析失败缓存空注册表，
// 进程生命周期内所有扩展名查询静默失效；回退解码用全新零值变量防混合注册表
func TestLoadRegistry_CorruptFallbackToEmbedded(t *testing.T) {
	// 损坏 JSON 写临时文件
	dir := t.TempDir()
	bad := filepath.Join(dir, "resource_types.json")
	if err := os.WriteFile(bad, []byte("{ 这不是合法 JSON !!"), 0644); err != nil {
		t.Fatal(err)
	}
	SetRegistryPath(bad)
	defer SetRegistryPath("") // 恢复默认，避免污染其他测试

	reg := LoadRegistry()
	if reg == nil {
		t.Fatal("损坏 JSON 应回退嵌入基线而非返回 nil")
	}
	// 嵌入基线含 ysm 类型 → 扩展名查询应可用（不回退成空表）
	if !IsSupportedExt(".ysm") {
		t.Error("损坏 JSON 回退嵌入基线后 .ysm 应仍被支持（不能缓存空注册表）")
	}
	if got := StorageSubDir("ysm"); got == "" {
		t.Error("损坏 JSON 回退嵌入基线后 ysm StorageSubDir 应非空")
	}
}
