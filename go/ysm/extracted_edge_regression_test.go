// 边角回归：texture 声明规范化口径 + pngNameMap 收集范围的黑盒守护。
// 现状两个消费方对 player.texture 的规范化各有一套（extracted.go 重复解析）：
//   - Geometry 版带扩展名（orderMap 键）、Components 版去扩展名（前端 R1 校验）——
//     两者自洽，抽公共函数时不得强改任一。
//
// commit A：抽 parsePlayerModel 后照样各留规范化（反斜杠裸路径守卫在本文件）。
// commit B：pngNameMap 由单层只认 .png 扩为公共递归 collectTextureFiles（含 gui 排除、
// .png/.jpg/.tga），子目录同名纹理 / .tga 同名纹理两红 case 在下方锁定后修复。
package ysm

import (
	"os"
	"path/filepath"
	"testing"
)

// TestFindComponents_BackslashTexDecl 反斜杠裸字符串纹理声明应正确取 basename（切 '\\'）。
// 现状 Components 用 LastIndexAny("/\\")，已正确；本测试锁住，防抽公共函数时误退化为只切 '/'
// （Geometry 裸分支曾有该缺陷）。
func TestFindComponents_BackslashTexDecl(t *testing.T) {
	dir := t.TempDir()
	modelsDir := filepath.Join(dir, "models")
	texDir := filepath.Join(dir, "textures")
	for _, d := range []string{modelsDir, texDir} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	// 裸字符串 + 反斜杠路径：textures\skin.png
	ysmJSON := `{"files":{"player":{"model":"models/main.json","texture":["textures\\skin.png"]}}}`
	if err := os.WriteFile(filepath.Join(dir, "ysm.json"), []byte(ysmJSON), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(modelsDir, "main.json"), []byte(geoWithBone("mainBone")), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "textures", "skin.png"), []byte{1, 2, 3}, 0o644); err != nil {
		t.Fatal(err)
	}

	comps, texNames := FindComponentsInExtractedYSM(filepath.Join(dir, "ysm.json"))
	if len(comps) != 1 {
		t.Fatalf("组件数 = %d, 期望 1", len(comps))
	}
	// 反斜杠裸声明 → 声明纹理槽 0 → texNames[0] 应为去扩展名 basename "skin"
	if len(texNames) != 1 || texNames[0] != "skin" {
		t.Fatalf("texNames = %v, 期望 [skin]（反斜杠裸路径应切 basename）", texNames)
	}
}
