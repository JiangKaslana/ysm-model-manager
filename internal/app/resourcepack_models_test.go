// ===== resourcepack_models_test.go — ADR-080 资源包模型读取绑定测试 =====
package app

import (
	"archive/zip"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// makePackZip 构建临时资源包 zip（assets/minecraft/models/block/stone.json + 纹理占位）
func makePackZip(t *testing.T, files map[string]string) string {
	t.Helper()
	dir := t.TempDir()
	p := filepath.Join(dir, "testpack.zip")
	f, err := os.Create(p)
	if err != nil {
		t.Fatal(err)
	}
	w := zip.NewWriter(f)
	for name, content := range files {
		entry, err := w.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	f.Close()
	return p
}

var packZipFiles = map[string]string{
	"pack.mcmeta": `{"pack":{"pack_format":15,"description":"test"}}`,
	"assets/minecraft/models/block/stone.json":    `{"parent":"minecraft:block/cube_all","textures":{"all":"minecraft:block/stone"}}`,
	"assets/minecraft/models/block/cube_all.json": `{"parent":"block/cube","textures":{"down":"#all","up":"#all","north":"#all","south":"#all","west":"#all","east":"#all"}}`,
	"assets/minecraft/models/item/stone.json":     `{"parent":"minecraft:block/stone"}`,
	"assets/minecraft/textures/block/stone.png":   "PNG-PLACEHOLDER",
	"assets/minecraft/lang/en_us.json":            `{"a":"b"}`,
	"assets/minecraft/models/custom/other.json":   `{}`, // 非 block/item 目录，不应列入
}

func TestListPackModels(t *testing.T) {
	a := &App{}
	p := makePackZip(t, packZipFiles)
	got := a.ListPackModels(p)

	var models []string
	if err := json.Unmarshal([]byte(got), &models); err != nil {
		t.Fatalf("ListPackModels 返回非法 JSON: %v", err)
	}
	if len(models) != 3 {
		t.Fatalf("期望 3 个模型（block/stone + block/cube_all + item/stone），实际 %d: %v", len(models), models)
	}
	// 升序
	want := []string{
		"assets/minecraft/models/block/cube_all.json",
		"assets/minecraft/models/block/stone.json",
		"assets/minecraft/models/item/stone.json",
	}
	for i := range want {
		if models[i] != want[i] {
			t.Errorf("models[%d] = %q，期望 %q", i, models[i], want[i])
		}
	}
}

func TestListPackModels_NonZip(t *testing.T) {
	a := &App{}
	// 非 zip 路径（如 .7z 无模型或不存在文件）→ "[]"
	if got := a.ListPackModels(filepath.Join(t.TempDir(), "notexist.zip")); got != "[]" {
		t.Errorf("不存在文件期望 []，实际 %q", got)
	}
}

func TestReadPackEntry(t *testing.T) {
	a := &App{}
	p := makePackZip(t, packZipFiles)

	got := a.ReadPackEntry(p, "assets/minecraft/models/block/stone.json")
	if got == "" {
		t.Fatal("stone.json 读取为空")
	}
	// 返回值为 base64，解码后应含 cube_all parent 引用
	raw, err := base64.StdEncoding.DecodeString(got)
	if err != nil {
		t.Fatalf("返回值不是合法 base64: %v", err)
	}
	if !strings.Contains(string(raw), "cube_all") {
		t.Errorf("解码内容应含 cube_all 引用，实际 %q", string(raw))
	}
}

func TestReadPackEntry_Guard(t *testing.T) {
	a := &App{}
	p := makePackZip(t, packZipFiles)
	// 路径穿越/非法条目一律拒绝
	for _, entry := range []string{
		"../etc/passwd",
		"pack.mcmeta",       // 非 assets/ 前缀
		"assets/..%2f..%2f", // 含 ..
		"assets\\minecraft", // 反斜杠
		"assets/minecraft/models/block/missing.json", // 不存在
	} {
		if got := a.ReadPackEntry(p, entry); got != "" {
			t.Errorf("非法条目 %q 应返回空，实际非空", entry)
		}
	}
}
