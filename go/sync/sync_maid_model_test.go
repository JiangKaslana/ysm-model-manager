package sync

import (
	"os"
	"path/filepath"
	"testing"
)

func TestZZMaidModelSync(t *testing.T) {
	base := t.TempDir()
	globalDir := filepath.Join(base, "maid-model")
	targetDir := filepath.Join(base, "inst", ".minecraft", "tlm_custom_pack")
	_ = os.MkdirAll(targetDir, 0755)
	pk := filepath.Join(globalDir, "my_pack", "assets", "mypack")
	_ = os.MkdirAll(filepath.Join(pk, "models", "entity"), 0755)
	_ = os.WriteFile(filepath.Join(pk, "maid_model.json"), []byte(`{"pack_name":"x","model_list":[]}`), 0644)
	_ = os.WriteFile(filepath.Join(pk, "models", "entity", "cirno.json"), []byte("{}"), 0644)
	_ = os.WriteFile(filepath.Join(pk, "textures", "entity", "cirno.png"), []byte("png"), 0644)
	count, err := PushResources("maid-model", globalDir, targetDir, "copy",
		func(name, src, dst string, size int64, status, msg string) { t.Logf("logger: %s | %s", name, msg) })
	t.Logf("count=%d err=%v", count, err)
	// 列出 targetDir 实际落盘
	filepath.Walk(targetDir, func(p string, info os.FileInfo, err error) error {
		if !info.IsDir() {
			rel, _ := filepath.Rel(targetDir, p)
			t.Logf("FILE: %s", rel)
		}
		return nil
	})
}
