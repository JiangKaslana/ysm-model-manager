package recycle

import (
	"os"
	"path/filepath"
	"testing"
)

// TestRemoveRepoDuplicates_NilLoggerBackwardCompat logger 允许 nil（向后兼容），
// 正常清理路径不 panic 且计数正确。
func TestRemoveRepoDuplicates_NilLoggerBackwardCompat(t *testing.T) {
	base := t.TempDir()
	dir := filepath.Join(base, "inst")
	filesRoot := filepath.Join(base, "repo")
	for _, root := range []string{dir, filesRoot} {
		if err := os.MkdirAll(root, 0755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(dir, "a.bin"), []byte("c"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(filesRoot, "a.bin"), []byte("c"), 0644); err != nil {
		t.Fatal(err)
	}
	removed := RemoveRepoDuplicates(dir, filesRoot, "", nil)
	if removed != 1 {
		t.Fatalf("expected 1 removed, got %d", removed)
	}
}
