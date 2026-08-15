package container

import (
	"archive/zip"
	"bytes"
	"os"
	"testing"
)

// makeTestZip 构造含条目的 zip 内存字节。
func makeTestZip(t *testing.T, entries map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	for name, content := range entries {
		fw, err := w.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := fw.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestOpenZipBytes_EntriesAndRead(t *testing.T) {
	data := makeTestZip(t, map[string]string{
		"ysm.json":         `{"metadata":{"authors":[]}}`,
		"models/main.json": `{"format_version":"1.12.0"}`,
		"textures/a.png":   "PNG",
	})
	r, err := OpenZipBytes(data, int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()

	entries := r.Entries()
	if len(entries) != 3 {
		t.Fatalf("期望 3 条目, 实际 %d", len(entries))
	}
	// 名称与读取
	found := map[string]bool{}
	for _, e := range entries {
		found[e.Name()] = true
		if e.IsDir() {
			t.Errorf("测试 zip 无目录条目: %s", e.Name())
		}
		rc, err := e.Open()
		if err != nil {
			t.Fatalf("打开 %s: %v", e.Name(), err)
		}
		buf := make([]byte, 32)
		n, _ := rc.Read(buf)
		rc.Close()
		if n == 0 {
			t.Errorf("读取 %s 为空", e.Name())
		}
	}
	for _, want := range []string{"ysm.json", "models/main.json", "textures/a.png"} {
		if !found[want] {
			t.Errorf("缺失条目 %s", want)
		}
	}
}

func TestOpenBytes_UnknownFormat(t *testing.T) {
	// 非 zip/7z 魔数 → Open 按扩展名拒绝；OpenZipBytes 应报错
	if _, err := OpenZipBytes([]byte("not a zip"), 8); err == nil {
		t.Error("非 zip 字节应报错")
	}
}

func TestOpen_UnsupportedExt(t *testing.T) {
	// 临时 .txt 文件：Open 应拒绝（仅 zip/7z/目录）
	dir := t.TempDir()
	p := dir + "/x.txt"
	if err := writeFile(p, "x"); err != nil {
		t.Fatal(err)
	}
	if _, err := Open(p); err == nil {
		t.Error(".txt 不应作为容器打开")
	}
}

func TestOpenDir_Entries(t *testing.T) {
	dir := t.TempDir()
	if err := writeFile(dir+"/a.json", "{}"); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(dir+"/sub", 0755); err != nil {
		t.Fatal(err)
	}
	if err := writeFile(dir+"/sub/b.json", "{}"); err != nil {
		t.Fatal(err)
	}
	r, err := OpenDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	names := map[string]bool{}
	for _, e := range r.Entries() {
		names[e.Name()] = true
	}
	if !names["a.json"] || !names["sub/b.json"] {
		t.Errorf("目录条目缺失: %v", names)
	}
}

func writeFile(p, content string) error {
	return os.WriteFile(p, []byte(content), 0644)
}
