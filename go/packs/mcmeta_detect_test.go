// ===== go/packs detector 分支补测（覆盖率 41.1% → 提升）=====
package packs

import (
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/internal/testutil"
	"ysm-model-manager/go/types"
)

func TestDetectResourceType_McmetaDetector(t *testing.T) {
	reg := &types.ResourceTypeRegistry{
		ResourceTypes: []types.ResourceType{
			{ID: "resourcepack", Extensions: []string{".zip"}, Detector: "mcmeta"},
		},
	}
	// 含 pack.mcmeta → 识别
	zipPath := testutil.WriteZipFile(t, "pack.zip", map[string]string{"pack.mcmeta": `{"pack":{"pack_format":15}}`})
	if got := DetectResourceType(zipPath, reg); got != "resourcepack" {
		t.Fatalf("mcmeta detector 应识别 resourcepack: %s", got)
	}
	// 无 pack.mcmeta → 不识别
	zipPath2 := testutil.WriteZipFile(t, "pack.zip", map[string]string{"other.txt": "x"})
	if got := DetectResourceType(zipPath2, reg); got != "" {
		t.Fatalf("无 mcmeta 不应识别: %s", got)
	}
	// 扩展名不匹配 → 跳过
	if got := DetectResourceType(filepath.Join(t.TempDir(), "x.txt"), reg); got != "" {
		t.Fatalf("扩展名不匹配不应识别: %s", got)
	}
}

func TestDetectResourceType_ShaderDetector(t *testing.T) {
	reg := &types.ResourceTypeRegistry{
		ResourceTypes: []types.ResourceType{
			{ID: "shaderpack", Extensions: []string{".zip"}, Detector: "shader"},
		},
	}
	// 含 shaders/ 条目 → 识别
	zipPath := testutil.WriteZipFile(t, "pack.zip", map[string]string{"shaders/foo.fsh": "x"})
	if got := DetectResourceType(zipPath, reg); got != "shaderpack" {
		t.Fatalf("shader detector 应识别 shaderpack: %s", got)
	}
	// 无 shaders → 不识别
	zipPath2 := testutil.WriteZipFile(t, "pack.zip", map[string]string{"pack.mcmeta": "x"})
	if got := DetectResourceType(zipPath2, reg); got != "" {
		t.Fatalf("无 shaders 不应识别: %s", got)
	}
}

// ===== zipentry detector 补测（ADR-067 S2：zip 化资源内容指纹识别）=====

// zipentryReg 构造 zipentry 场景注册表。顺序即优先级（ADR-067 S3）：
// ysm 的根标记（ysm.json/models/）最具体，须排最前——同时含 ysm.json 与 model.pmx
// 的 .zip 应判 ysm（更具体者优先），而非 mmd。
func zipentryReg() *types.ResourceTypeRegistry {
	return &types.ResourceTypeRegistry{
		ResourceTypes: []types.ResourceType{
			{ID: "ysm", Extensions: []string{".ysm", ".zip", ".7z", ".json"}, Detector: "ysm",
				ZipEntries: []types.ZipEntryMatch{{Name: "ysm.json", Match: "suffix"}, {Name: "models/", Match: "prefix"}}},
			{ID: "mmd-skin", Extensions: []string{".pmx", ".pmd", ".zip"}, Detector: "zipentry",
				ZipEntries: []types.ZipEntryMatch{{Name: ".pmx", Match: "suffix"}, {Name: ".pmd", Match: "suffix"}}},
			{ID: "vrchat-avatar", Extensions: []string{".vrca", ".vrm", ".zip"}, Detector: "zipentry",
				ZipEntries: []types.ZipEntryMatch{{Name: ".vrca", Match: "suffix"}, {Name: ".vrm", Match: "suffix"}}},
			{ID: "create-blueprint", Extensions: []string{".nbt", ".schematic", ".zip"}, Detector: "zipentry",
				ZipEntries: []types.ZipEntryMatch{{Name: ".nbt", Match: "suffix"}, {Name: ".schematic", Match: "suffix"}}},
			{ID: "litematic", Extensions: []string{".litematic", ".zip"}, Detector: "zipentry",
				ZipEntries: []types.ZipEntryMatch{{Name: ".litematic", Match: "suffix"}}},
		},
	}
}

// 裸文件（非容器）：zipentry 按扩展名直判（isContainer=false 分支）
func TestDetectResourceType_ZipEntry_BareFile(t *testing.T) {
	reg := zipentryReg()
	for _, tc := range []struct {
		path string
		want string
	}{
		{"model.pmx", "mmd-skin"},
		{"model.pmd", "mmd-skin"},
		{"avatar.vrca", "vrchat-avatar"},
		{"avatar.vrm", "vrchat-avatar"},
		{"build.nbt", "create-blueprint"},
		{"build.schematic", "create-blueprint"},
		{"proj.litematic", "litematic"},
		{"model.xyz", ""}, // 未知扩展名
	} {
		if got := DetectResourceType(tc.path, reg); got != tc.want {
			t.Errorf("DetectResourceType(%s) = %q, 期望 %q", tc.path, got, tc.want)
		}
	}
}

// 容器 .zip：按 zipEntries 内容指纹识别（ADR-067 S2 核心分支）
func TestDetectResourceType_ZipEntry_ZipFingerprint(t *testing.T) {
	reg := zipentryReg()
	for _, tc := range []struct {
		name string
		zip  map[string]string
		want string
	}{
		// 注意：.pmx 不能放 models/ 目录下——models/ 前缀是 ysm 特有根标记，
		// 会先命中 ysm（S3 更具体者优先），此处模拟普通 zip 包裹（非 ysm 结构）
		{"含 .pmx → mmd-skin", map[string]string{"mmd/steve.pmx": "x"}, "mmd-skin"},
		{"含 .pmd → mmd-skin", map[string]string{"rig/char.pmd": "x"}, "mmd-skin"},
		{"含 .vrca → vrchat-avatar", map[string]string{"avatar.vrca": "x"}, "vrchat-avatar"},
		{"含 .nbt → create-blueprint", map[string]string{"build/floor.nbt": "x"}, "create-blueprint"},
		{"含 .schematic → create-blueprint", map[string]string{"house.schematic": "x"}, "create-blueprint"},
		{"含 .litematic → litematic", map[string]string{"base.litematic": "x"}, "litematic"},
		{"条目名大小写不敏感（MatchZipEntry 小写归一）", map[string]string{"MODEL.PMX": "x"}, "mmd-skin"},
	} {
		zipPath := testutil.WriteZipFile(t, "pkg.zip", tc.zip)
		if got := DetectResourceType(zipPath, reg); got != tc.want {
			t.Errorf("%s: DetectResourceType = %q, 期望 %q", tc.name, got, tc.want)
		}
	}
}

// 冲突优先级：注册表顺序即优先级（ADR-067 S3）——同时含 ysm.json 与 model.pmx 判 ysm
func TestDetectResourceType_ZipEntry_Priority(t *testing.T) {
	reg := zipentryReg()
	zipPath := testutil.WriteZipFile(t, "pkg.zip", map[string]string{
		"ysm.json":  `{"format_version":"1.12.0"}`,
		"model.pmx": "x",
	})
	if got := DetectResourceType(zipPath, reg); got != "ysm" {
		t.Fatalf("同时含 ysm.json+model.pmx 应判 ysm（S3 注册表顺序优先级），实际 %q", got)
	}
}

// 无匹配：空 zip / 无关条目 zip → 不识别（返回 ""）
func TestDetectResourceType_ZipEntry_NoMatch(t *testing.T) {
	reg := zipentryReg()
	empty := testutil.WriteZipFile(t, "empty.zip", map[string]string{})
	if got := DetectResourceType(empty, reg); got != "" {
		t.Fatalf("空 zip 不应识别: %q", got)
	}
	noMatch := testutil.WriteZipFile(t, "pkg.zip", map[string]string{"readme.txt": "hello"})
	if got := DetectResourceType(noMatch, reg); got != "" {
		t.Fatalf("无关条目 zip 不应识别: %q", got)
	}
}

// .7z 内容指纹已接入（ADR-068 后 container.Open7zPath 可枚举 7z 条目）：坏/伪造 .7z
// 打开失败 → zipentry 指纹不命中 → ysm 扩展名兜底（与改动前一致）。合法 .7z 含
// 匹配条目时走内容指纹（正向构造需 7-Zip CLI 预生成 fixture，见 geometry testdata）。
func TestDetectResourceType_ZipEntry_SevenZipFallbackToYsm(t *testing.T) {
	reg := zipentryReg()
	dir := t.TempDir()
	sevenPath := filepath.Join(dir, "pkg.7z")
	if err := os.WriteFile(sevenPath, []byte("not really 7z"), 0644); err != nil {
		t.Fatal(err)
	}
	if got := DetectResourceType(sevenPath, reg); got != "ysm" {
		t.Fatalf("坏 .7z 应靠 ysm 扩展名兜底判 ysm，实际 %q", got)
	}
}
