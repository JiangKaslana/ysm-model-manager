package scanner

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

// BenchmarkScanEntriesCold measures the complete production scan path. Running
// it with -tags rust_backend exercises the embedded Rust bridge; without the
// tag it provides the Go baseline against the same generated model tree.
func BenchmarkScanEntriesCold(b *testing.B) {
	const (
		fileCount = 2000
		dirCount  = 20
	)

	root := b.TempDir()
	payload := bytes.Repeat([]byte("YSM scanner benchmark payload\n"), 128)
	for i := 0; i < fileCount; i++ {
		dir := filepath.Join(root, fmt.Sprintf("group-%02d", i%dirCount))
		if err := os.MkdirAll(dir, 0o755); err != nil {
			b.Fatal(err)
		}
		path := filepath.Join(dir, fmt.Sprintf("model-%04d.ysm", i))
		if err := os.WriteFile(path, payload, 0o644); err != nil {
			b.Fatal(err)
		}
	}

	b.ReportAllocs()
	b.SetBytes(int64(fileCount * len(payload)))
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		b.StopTimer()
		InvalidateCache()
		b.StartTimer()

		entries := ScanEntries(root)
		if len(entries) != fileCount {
			b.Fatalf("ScanEntries returned %d entries, want %d", len(entries), fileCount)
		}
	}
}
