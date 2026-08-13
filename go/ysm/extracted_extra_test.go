// ===== FindGeometryInExtractedYSM 分支补测（extracted.go:50）=====
// 对齐 extracted_test.go（arm 排除）与 extracted_fixture_test.go（目录式 fixture）
// 的构造方式：t.TempDir 内自建 ysm.json + 模型文件。覆盖：缺 ysm.json、
// player.model 三种格式（map/数组/字符串）、纹理声明序、textures/ 与同目录纹理、
// 多层兜底（ysm.json 自带几何 / minecraft.geometry 包裹 / 裸几何元素 / WalkDir 递归）、
// 路径穿越防护、多模型合并 TexSlot 赋值。
package ysm

import (
	"os"
	"path/filepath"
	"testing"
)

// writeExtractedFixture 在 t.TempDir 下按 rel 路径写文件（自动建父目录），
// 返回 ysm.json 完整路径。files 的 key 为相对路径（正斜杠），value 为内容。
func writeExtractedFixture(t *testing.T, files map[string]string) string {
	t.Helper()
	dir := t.TempDir()
	for rel, content := range files {
		p := filepath.Join(dir, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
	}
	return filepath.Join(dir, "ysm.json")
}

// geometryJSON 构造单骨骼有效几何 JSON（ParseBedrockGeometry 可解析）
func geometryJSON(name string) string {
	return `{"format_version":"1.16.0","minecraft:geometry":[{"description":{"identifier":"` +
		name + `","texture_width":64,"texture_height":32},"bones":[{"name":"` + name +
		`","cubes":[{"origin":[0,0,0],"size":[8,8,8],"uv":[0,0]}]}]}]}`
}

func TestFindGeometryInExtractedYSM_MissingYsmJson(t *testing.T) {
	// ysm.json 不存在 → readFileLimited 返回 nil → (nil, nil)
	model, tex := FindGeometryInExtractedYSM(filepath.Join(t.TempDir(), "ysm.json"))
	if model != nil || tex != nil {
		t.Errorf("缺失 ysm.json 应返回 nil,nil, 得到 %v, %v", model, tex)
	}
}

func TestFindGeometryInExtractedYSM_ModelMapExcludesArm(t *testing.T) {
	// player.model map 格式：main 优先 + arm 排除（第一人称手臂不合并）
	ysmPath := writeExtractedFixture(t, map[string]string{
		"ysm.json":             `{"files":{"player":{"model":{"main":"models/main.geo.json","arm":"models/arm.geo.json"}}}}`,
		"models/main.geo.json": geometryJSON("main"),
		"models/arm.geo.json":  geometryJSON("arm"),
	})
	model, _ := FindGeometryInExtractedYSM(ysmPath)
	if model == nil {
		t.Fatal("模型应为非 nil")
	}
	if len(model.Bones) != 1 || model.Bones[0].Name != "main" {
		t.Errorf("应仅合并 main 骨骼, 得到 %d 根", len(model.Bones))
	}
	// 合并时 TexSlot=0、CubeTexW/H 写入（extracted.go:211-215）
	c := model.Bones[0].Cubes[0]
	if c.TexSlot != 0 || c.CubeTexW != 64 || c.CubeTexH != 32 {
		t.Errorf("main cube 应 TexSlot=0 64x32, 得到 slot=%d %dx%d", c.TexSlot, c.CubeTexW, c.CubeTexH)
	}
}

func TestFindGeometryInExtractedYSM_ModelArrayAllLoaded(t *testing.T) {
	// player.model 数组格式：按声明序加载全部模型（arm 排除按名）
	ysmPath := writeExtractedFixture(t, map[string]string{
		"ysm.json":              `{"files":{"player":{"model":["models/main.geo.json","models/extra.geo.json"],"texture":["tex_a.png","tex_b.png"]}}}`,
		"models/main.geo.json":  geometryJSON("main"),
		"models/extra.geo.json": geometryJSON("extra"),
	})
	model, _ := FindGeometryInExtractedYSM(ysmPath)
	if model == nil {
		t.Fatal("模型应为非 nil")
	}
	if len(model.Bones) != 2 {
		t.Fatalf("应合并 2 根骨骼, 得到 %d", len(model.Bones))
	}
	// 纹理声明 2 项 → maxTexIdx=1：main TexSlot=0、extra TexSlot=1
	if c := model.Bones[0].Cubes[0]; c.TexSlot != 0 {
		t.Errorf("main cube TexSlot = %d, 期望 0", c.TexSlot)
	}
	if c := model.Bones[1].Cubes[0]; c.TexSlot != 1 {
		t.Errorf("extra cube TexSlot = %d, 期望 1", c.TexSlot)
	}
}

func TestFindGeometryInExtractedYSM_ModelStringFormat(t *testing.T) {
	// player.model 单字符串格式
	ysmPath := writeExtractedFixture(t, map[string]string{
		"ysm.json":             `{"files":{"player":{"model":"models/main.geo.json"}}}`,
		"models/main.geo.json": geometryJSON("main"),
	})
	model, _ := FindGeometryInExtractedYSM(ysmPath)
	if model == nil || len(model.Bones) != 1 {
		t.Fatalf("字符串格式应加载 main, 得到 %v", model)
	}
}

func TestFindGeometryInExtractedYSM_TextureOrderFromYsm(t *testing.T) {
	// player.texture 数组（字符串 + {"uv":...} 对象混合）：texData 与 TextureNames
	// 按 ysm.json 声明序排序，uv 路径去目录取 basename
	ysmPath := writeExtractedFixture(t, map[string]string{
		"ysm.json":             `{"files":{"player":{"model":["models/main.geo.json"],"texture":[{"uv":"textures/a.png"},"b.jpg"]}}}`,
		"models/main.geo.json": geometryJSON("main"),
		"textures/a.png":       "PNGDATA-A",
		"textures/b.jpg":       "JPEGDATA-B",
	})
	model, texData := FindGeometryInExtractedYSM(ysmPath)
	if model == nil {
		t.Fatal("模型应为非 nil")
	}
	if len(texData) != 2 {
		t.Fatalf("texData = %d, 期望 2", len(texData))
	}
	if string(texData[0]) != "PNGDATA-A" || string(texData[1]) != "JPEGDATA-B" {
		t.Errorf("texData 应按声明序 [a.png, b.jpg]")
	}
	// TextureNames 去扩展名
	if len(model.TextureNames) != 2 || model.TextureNames[0] != "a" || model.TextureNames[1] != "b" {
		t.Errorf("TextureNames = %v, 期望 [a b]", model.TextureNames)
	}
}

func TestFindGeometryInExtractedYSM_TextureTgaInTexturesDir(t *testing.T) {
	// textures/ 递归遍历含 .tga；声明序 [tex_b.png, tex_a.tga] → 排序后 tex_b 在前
	ysmPath := writeExtractedFixture(t, map[string]string{
		"ysm.json":             `{"files":{"player":{"model":["models/main.geo.json"],"texture":["tex_b.png","tex_a.tga"]}}}`,
		"models/main.geo.json": geometryJSON("main"),
		"textures/tex_a.tga":   "TGADATA",
		"textures/tex_b.png":   "PNGDATA-B",
	})
	model, texData := FindGeometryInExtractedYSM(ysmPath)
	if model == nil || len(texData) != 2 {
		t.Fatalf("textures/ 下 png+tga 应读 2 张, 得到 %d", len(texData))
	}
	if string(texData[0]) != "PNGDATA-B" || string(texData[1]) != "TGADATA" {
		t.Errorf("纹理应按声明序 [tex_b.png, tex_a.tga]")
	}
	if len(model.TextureNames) != 2 || model.TextureNames[0] != "tex_b" || model.TextureNames[1] != "tex_a" {
		t.Errorf("TextureNames = %v, 期望 [tex_b tex_a]", model.TextureNames)
	}
}

func TestFindGeometryInExtractedYSM_TextureSameDir(t *testing.T) {
	// 无 textures/ 目录 → 兜底扫描 ysm.json 同目录 png/jpg（.tga 不入同目录段）
	ysmPath := writeExtractedFixture(t, map[string]string{
		"ysm.json":      `{"files":{"player":{"model":"main.geo.json","texture":["tex_b.jpg","tex_a.png"]}}}`,
		"main.geo.json": geometryJSON("main"),
		"tex_a.png":     "PNGDATA-A",
		"tex_b.jpg":     "JPEGDATA-B",
		"ignore.tga":    "TGADATA",
	})
	model, texData := FindGeometryInExtractedYSM(ysmPath)
	if model == nil {
		t.Fatal("模型应为非 nil")
	}
	if len(texData) != 2 {
		t.Fatalf("同目录纹理应读 2 张（tga 不入同目录段）, 得到 %d", len(texData))
	}
	if string(texData[0]) != "JPEGDATA-B" || string(texData[1]) != "PNGDATA-A" {
		t.Errorf("纹理应按声明序 [tex_b.jpg, tex_a.png]")
	}
}

func TestFindGeometryInExtractedYSM_GeometryInYsmJson(t *testing.T) {
	// 模型文件缺失 → 兜底解析 ysm.json 自身（含 minecraft:geometry）
	ysmPath := writeExtractedFixture(t, map[string]string{
		"ysm.json": geometryJSON("embedded"),
	})
	model, _ := FindGeometryInExtractedYSM(ysmPath)
	if model == nil || len(model.Bones) != 1 || model.Bones[0].Name != "embedded" {
		t.Fatalf("应兜底解析 ysm.json 内嵌几何, 得到 %v", model)
	}
}

func TestFindGeometryInExtractedYSM_MinecraftGeometryWrapper(t *testing.T) {
	// 兜底 2：ysm.json 含 minecraft: {geometry:[...]} 包裹 → 包裹后解析
	elem := `{"description":{"identifier":"wrapped","texture_width":32,"texture_height":32},"bones":[{"name":"wbone","cubes":[]}]}`
	ysmPath := writeExtractedFixture(t, map[string]string{
		"ysm.json": `{"minecraft":{"geometry":[` + elem + `]}}`,
	})
	model, _ := FindGeometryInExtractedYSM(ysmPath)
	if model == nil || len(model.Bones) != 1 || model.Bones[0].Name != "wbone" {
		t.Fatalf("minecraft.geometry 包裹兜底应解析出 wbone, 得到 %v", model)
	}
}

func TestFindGeometryInExtractedYSM_BareGeometryFallback(t *testing.T) {
	// 兜底 4：ysm.json 自身为裸几何元素（无 minecraft:geometry 包裹）→ 包裹后解析
	ysmPath := writeExtractedFixture(t, map[string]string{
		"ysm.json": `{"format_version":"1.16.0","description":{"identifier":"bare","texture_width":32,"texture_height":32},"bones":[{"name":"barebone","cubes":[]}]}`,
	})
	model, _ := FindGeometryInExtractedYSM(ysmPath)
	if model == nil || len(model.Bones) != 1 || model.Bones[0].Name != "barebone" {
		t.Fatalf("裸几何兜底应解析出 barebone, 得到 %v", model)
	}
}

func TestFindGeometryInExtractedYSM_WalkDirRecursive(t *testing.T) {
	// 兜底 3：WalkDir 递归子目录（排除 animations/controller/avatar）找几何
	ysmPath := writeExtractedFixture(t, map[string]string{
		"ysm.json":                 `{"files":{}}`,
		"sub/deep/model.geo.json":  geometryJSON("deep"),
		"animations/idle.geo.json": geometryJSON("animBone"),
	})
	model, _ := FindGeometryInExtractedYSM(ysmPath)
	if model == nil || len(model.Bones) != 1 || model.Bones[0].Name != "deep" {
		t.Fatalf("WalkDir 应找到 sub/deep/model.geo.json 的 deep 骨骼, 得到 %v", model)
	}
}

func TestFindGeometryInExtractedYSM_MissingModelFileFallback(t *testing.T) {
	// 声明模型文件不存在 → 模型循环跳过 → 兜底 WalkDir 命中同目录几何
	ysmPath := writeExtractedFixture(t, map[string]string{
		"ysm.json":      `{"files":{"player":{"model":"models/gone.geo.json"}}}`,
		"main.geo.json": geometryJSON("main"),
	})
	model, _ := FindGeometryInExtractedYSM(ysmPath)
	if model == nil || len(model.Bones) != 1 || model.Bones[0].Name != "main" {
		t.Fatalf("缺失声明模型后应兜底找到 main, 得到 %v", model)
	}
}

func TestFindGeometryInExtractedYSM_PathTraversalRejected(t *testing.T) {
	// 模型名路径穿越（../）→ 拒绝加载外部文件（日志 + continue），不 panic
	dir := t.TempDir()
	ysmPath := filepath.Join(dir, "mod", "ysm.json")
	if err := os.MkdirAll(filepath.Dir(ysmPath), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(ysmPath, []byte(`{"files":{"player":{"model":"../evil.geo.json"}}}`), 0644); err != nil {
		t.Fatal(err)
	}
	// 越界文件确实存在于 ysm.json 目录之外
	if err := os.WriteFile(filepath.Join(dir, "evil.geo.json"), []byte(geometryJSON("evil")), 0644); err != nil {
		t.Fatal(err)
	}
	model, tex := FindGeometryInExtractedYSM(ysmPath)
	// 注：裸几何兜底（extracted.go:293-297）会把任意合法 JSON ysm.json 包裹成
	// 零骨骼模型，故此处不断言 nil，只断言越界文件未被加载（无 evil 骨骼）
	if model != nil {
		for _, b := range model.Bones {
			if b.Name == "evil" {
				t.Errorf("路径穿越模型不应被加载, 发现骨骼 %q", b.Name)
			}
		}
	}
	if tex != nil {
		t.Errorf("路径穿越场景 texData 应为 nil, 得到 %v", tex)
	}
}

func TestFindGeometryInExtractedYSM_InvalidYsmJsonWalkDir(t *testing.T) {
	// ysm.json 非法 JSON → 解析跳过 → 兜底 WalkDir 命中几何
	ysmPath := writeExtractedFixture(t, map[string]string{
		"ysm.json":      `{bad json`,
		"main.geo.json": geometryJSON("main"),
	})
	model, _ := FindGeometryInExtractedYSM(ysmPath)
	if model == nil || len(model.Bones) != 1 {
		t.Fatalf("非法 ysm.json 应兜底找到 main, 得到 %v", model)
	}
}

func TestFindGeometryInExtractedYSM_ModelMapExtraKeyMergeAndClamp(t *testing.T) {
	// map 格式非 main 键（extra）排序入列 + 模型数多于纹理声明时 TexSlot 钳制
	// （extracted.go:203-205：ti > maxTexIdx → 钳到最后一张声明纹理）
	ysmPath := writeExtractedFixture(t, map[string]string{
		"ysm.json":              `{"files":{"player":{"model":{"main":"models/main.geo.json","extra":"models/extra.geo.json","arm":"models/arm.geo.json"},"texture":["tex_a.png"]}}}`,
		"models/main.geo.json":  geometryJSON("main"),
		"models/extra.geo.json": geometryJSON("extra"),
		"models/arm.geo.json":   geometryJSON("arm"),
	})
	model, _ := FindGeometryInExtractedYSM(ysmPath)
	if model == nil {
		t.Fatal("模型应为非 nil")
	}
	if len(model.Bones) != 2 {
		t.Fatalf("应合并 main+extra 2 根骨骼（arm 排除）, 得到 %d", len(model.Bones))
	}
	// 纹理声明仅 1 项 → maxTexIdx=0：main 与 extra 的 TexSlot 均钳到 0
	for _, b := range model.Bones {
		if c := b.Cubes[0]; c.TexSlot != 0 {
			t.Errorf("骨骼 %s cube TexSlot = %d, 期望 0（钳制）", b.Name, c.TexSlot)
		}
	}
	if model.BoneCount != 2 || model.CubeCount != 2 {
		t.Errorf("BoneCount/CubeCount = %d/%d, 期望 2/2", model.BoneCount, model.CubeCount)
	}
}

func TestFindGeometryInExtractedYSM_PlayerKeySkipAndParseError(t *testing.T) {
	// files 含非 player 键（跳过）+ player 值非对象（解析失败跳过）——
	// 两分支均走 continue，不 panic；裸几何兜底产出零骨骼模型
	ysmPath := writeExtractedFixture(t, map[string]string{
		"ysm.json": `{"files":{"player":42,"weapon":{"model":"models/w.geo.json"}}}`,
	})
	model, tex := FindGeometryInExtractedYSM(ysmPath)
	if model == nil {
		t.Fatal("裸几何兜底应产出非 nil 模型（零骨骼）")
	}
	if len(model.Bones) != 0 {
		t.Errorf("player/weapon 均不可解析, 应无骨骼, 得到 %d", len(model.Bones))
	}
	if tex != nil {
		t.Errorf("无纹理场景 texData 应为 nil, 得到 %v", tex)
	}
}

func TestFindGeometryInExtractedYSM_ModelMapNonStringValue(t *testing.T) {
	// map 格式 value 非字符串（数字）→ Decode 失败跳过继续（extracted.go:98-99），
	// mm 为空 map → 模型循环不加载 → 兜底 WalkDir 命中
	ysmPath := writeExtractedFixture(t, map[string]string{
		"ysm.json":             `{"files":{"player":{"model":{"main":123,"extra":"models/main.geo.json"}}}}`,
		"models/main.geo.json": geometryJSON("main"),
	})
	model, _ := FindGeometryInExtractedYSM(ysmPath)
	if model == nil || len(model.Bones) != 1 || model.Bones[0].Name != "main" {
		t.Fatalf("非字符串 map value 跳过后应兜底找到 main, 得到 %v", model)
	}
}

func TestFindGeometryInExtractedYSM_TextureBackslashAndPartialOrder(t *testing.T) {
	// uv 反斜杠路径取 basename（extracted.go:135-137）+ 字符串条目正斜杠
	// （144-146）+ 未声明纹理排末尾（sort 比较器 hasI 单边分支, 352 行）
	ysmPath := writeExtractedFixture(t, map[string]string{
		"ysm.json":             `{"files":{"player":{"model":["models/main.geo.json"],"texture":["tex_a.png",{"uv":"tex\\tex_b.png"},"sub/tex_c.png"]}}}`,
		"models/main.geo.json": geometryJSON("main"),
		"textures/tex_a.png":   "PNGDATA-A",
		"textures/tex_b.png":   "PNGDATA-B",
		"textures/tex_c.png":   "PNGDATA-C",
		"textures/stray.png":   "PNGDATA-S",
	})
	model, texData := FindGeometryInExtractedYSM(ysmPath)
	if model == nil {
		t.Fatal("模型应为非 nil")
	}
	if len(texData) != 4 {
		t.Fatalf("应读 4 张纹理, 得到 %d", len(texData))
	}
	// 声明序 [tex_a, tex_b, tex_c]，未声明 stray 落尾
	want := []string{"PNGDATA-A", "PNGDATA-B", "PNGDATA-C", "PNGDATA-S"}
	for i, w := range want {
		if string(texData[i]) != w {
			t.Fatalf("texData[%d] = %q, 期望 %q", i, texData[i], w)
		}
	}
	if len(model.TextureNames) != 4 || model.TextureNames[3] != "stray" {
		t.Errorf("TextureNames = %v, 期望末尾为 stray", model.TextureNames)
	}
}

func TestFindGeometryInExtractedYSM_WalkDirDepthLimit(t *testing.T) {
	// 递归搜索深度上限 10 层（extracted.go:266-268）：第 11 层起 SkipDir，
	// 深度 12 的几何不会被发现 → 裸几何兜底产出零骨骼模型
	files := map[string]string{"ysm.json": `{"files":{}}`}
	deep := "d1/d2/d3/d4/d5/d6/d7/d8/d9/d10/d11/d12/model.geo.json"
	files[deep] = geometryJSON("deep")
	ysmPath := writeExtractedFixture(t, files)
	model, _ := FindGeometryInExtractedYSM(ysmPath)
	if model == nil {
		t.Fatal("裸几何兜底应产出非 nil 模型")
	}
	if len(model.Bones) != 0 {
		t.Errorf("深度 12 的几何应被深度限制跳过, 得到 %d 根骨骼", len(model.Bones))
	}
}
