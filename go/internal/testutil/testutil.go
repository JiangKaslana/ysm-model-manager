// Package testutil 提供跨包复用的 Go 单元测试辅助函数。
package testutil

import (
	"archive/zip"
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

// CreateTestFile 在 dir 下创建 name 文件（自动建父目录），返回完整路径。
// 统一 3 个包各自实现的同名 helper（dedup/fsutil/recycle）。
func CreateTestFile(t *testing.T, dir, name, content string) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
	return path
}

// MakeZipBytes 构造内存 ZIP（entries: 条目名→内容），返回字节。
// 统一 geometry/packs/ysm 五个包各自的 makeZipBytes/makeJar/writeZip 变体。
func MakeZipBytes(t *testing.T, entries map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, content := range entries {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// WriteZipFile 构造 ZIP 并写入 t.TempDir()/name，返回文件路径。
func WriteZipFile(t *testing.T, name string, entries map[string]string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, MakeZipBytes(t, entries), 0644); err != nil {
		t.Fatal(err)
	}
	return path
}
