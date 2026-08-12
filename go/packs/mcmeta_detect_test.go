// ===== go/packs detector 分支补测（覆盖率 41.1% → 提升）=====
package packs

import (
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
