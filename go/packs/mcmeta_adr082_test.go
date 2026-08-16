// ===== ADR-082 材质包识别长治久安：任意层级指纹 + detector 容器统一 =====
// 覆盖两个复现实景：zip 套一层目录（MyPack/pack.mcmeta）、.7z 材质包（扩展名兜底抢走）。
// 转正自临时复现测试（repro_temp_test.go），用例与 ADR-082 S1/S2/S3 一一对应。
package packs

import (
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/internal/testutil"
	"ysm-model-manager/go/types"
)

// 套目录材质包 zip（ADR-082 S1）：pack.mcmeta exact 指纹升级为任意层级段后缀匹配
func TestDetectResourceType_NestedDirResourcepack(t *testing.T) {
	reg := types.LoadRegistry()
	// 真实世界常见：材质包 zip 外层套一层目录 MyPack/pack.mcmeta
	zipPath := testutil.WriteZipFile(t, "mypack.zip", map[string]string{
		"MyPack/pack.mcmeta": `{"pack":{"pack_format":15}}`,
	})
	if got := DetectResourceType(zipPath, reg); got != "resourcepack" {
		t.Fatalf("套目录材质包应识别 resourcepack，实际 %q", got)
	}
	// 更深层级也命中：a/b/pack.mcmeta
	deepZip := testutil.WriteZipFile(t, "deep.zip", map[string]string{
		"a/b/pack.mcmeta": `{"pack":{"pack_format":15}}`,
	})
	if got := DetectResourceType(deepZip, reg); got != "resourcepack" {
		t.Fatalf("深层套目录材质包应识别 resourcepack，实际 %q", got)
	}
}

// 套目录光影包 zip（ADR-082 S1）：shaders/ prefix 指纹升级为任意层级
func TestDetectResourceType_NestedDirShaderpack(t *testing.T) {
	reg := types.LoadRegistry()
	zipPath := testutil.WriteZipFile(t, "shader.zip", map[string]string{
		"MyShader/shaders/foo.fsh": "x",
	})
	if got := DetectResourceType(zipPath, reg); got != "shaderpack" {
		t.Fatalf("套目录光影包应识别 shaderpack，实际 %q", got)
	}
}

// 套目录 ysm zip（ADR-082 S1）：models/ prefix 升级为任意层级
func TestDetectResourceType_NestedDirYsm(t *testing.T) {
	reg := types.LoadRegistry()
	zipPath := testutil.WriteZipFile(t, "model.zip", map[string]string{
		"MyModel/models/thing/body.json": `{"format_version":"1.12.0"}`,
	})
	if got := DetectResourceType(zipPath, reg); got != "ysm" {
		t.Fatalf("套目录 ysm 应识别 ysm，实际 %q", got)
	}
}

// .7z 材质包（ADR-082 S2/S3）：extensions 补 .7z 后走 container 指纹，不再被 ysm 兜底抢走。
// fixture 由 7-Zip CLI 预生成（testdata/pack.7z，内含 pack.mcmeta，见 ADR-067 §4.3 同款做法）。
func TestDetectResourceType_SevenZipResourcepack(t *testing.T) {
	reg := types.LoadRegistry()
	sevenPath := filepath.Join("testdata", "pack.7z")
	if got := DetectResourceType(sevenPath, reg); got != "resourcepack" {
		t.Fatalf(".7z 材质包应识别 resourcepack，实际 %q", got)
	}
}

// 坏 .7z 兜底不变量（ADR-082 S3 声明）：资源包/光影包打开失败后 ysm 兜底仍生效
func TestDetectResourceType_SevenZipFallbackStillYsm(t *testing.T) {
	reg := types.LoadRegistry()
	dir := t.TempDir()
	sevenPath := filepath.Join(dir, "pkg.7z")
	if err := os.WriteFile(sevenPath, []byte("not really 7z"), 0644); err != nil {
		t.Fatal(err)
	}
	if got := DetectResourceType(sevenPath, reg); got != "ysm" {
		t.Fatalf("坏 .7z 应靠 ysm 扩展名兜底判 ysm，实际 %q", got)
	}
}
