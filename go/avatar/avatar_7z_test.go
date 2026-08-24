package avatar

import (
	"archive/zip"
	"bytes"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// writePNG creates a minimal 1×1 PNG for avatar test fixtures.
func writePNG(c color.RGBA) []byte {
	img := image.NewRGBA(image.Rect(0, 0, 1, 1))
	img.Set(0, 0, c)
	var buf bytes.Buffer
	_ = png.Encode(&buf, img)
	return buf.Bytes()
}

// TestExtractAvatarURI_From7zFallback verifies .7z avatar/ directory fallback.
// Uses go/geometry/testdata/7z_full.7z which contains avatar\face.png.
func TestExtractAvatarURI_From7zFallback(t *testing.T) {
	src := filepath.Join("..", "geometry", "testdata", "7z_full.7z")
	if _, err := os.Stat(src); err != nil {
		t.Skipf("testdata 7z_full.7z not available: %v", err)
	}

	// 7z_full.7z has avatar\face.png and ysm.json (no authors field)
	// Fallback should find avatar/face.png
	result := ExtractAvatarURI(src, SafeName("unknown"))
	if result == "" {
		t.Fatal("ExtractAvatarURI returned empty for .7z with avatar/ fallback")
	}
	if !strings.HasPrefix(result, "data:image/") {
		t.Fatalf("Expected data:image/ URI, got %s", result[:min(50, len(result))])
	}
}

// TestExtractAvatarURI_FromZipFallback verifies .zip avatar/ directory
// fallback when no author matches.
func TestExtractAvatarURI_FromZipFallback(t *testing.T) {
	pngData := writePNG(color.RGBA{R: 0, G: 0, B: 255, A: 255})
	ysmJSON := `{"metadata":{"authors":[]}}`

	buf := new(bytes.Buffer)
	w := zip.NewWriter(buf)
	for name, data := range map[string][]byte{
		"ysm.json":        []byte(ysmJSON),
		"avatar/face.png": pngData,
		"main.geo.json":   []byte("{}"),
	} {
		f, err := w.Create(name)
		if err != nil {
			t.Fatalf("zip Create %s: %v", name, err)
		}
		if _, err := f.Write(data); err != nil {
			t.Fatalf("zip Write %s: %v", name, err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatalf("zip Close: %v", err)
	}

	dir := t.TempDir()
	path := filepath.Join(dir, "test.zip")
	if err := os.WriteFile(path, buf.Bytes(), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	result := ExtractAvatarURI(path, SafeName("unknown"))
	if result == "" {
		t.Fatal("ExtractAvatarURI returned empty for .zip with avatar/ fallback")
	}
	if !strings.HasPrefix(result, "data:image/") {
		t.Fatalf("Expected data:image/ URI, got %s", result[:min(50, len(result))])
	}
}

// TestExtractAvatarURI_FromZipNoAvatar verifies .zip without avatar returns empty.
func TestExtractAvatarURI_FromZipNoAvatar(t *testing.T) {
	ysmJSON := `{"metadata":{"authors":[]}}`
	data := makeZip(t, map[string]string{
		"ysm.json":      ysmJSON,
		"main.geo.json": "{}",
		"tex_a.png":     "not-an-avatar",
	})
	dir := t.TempDir()
	path := filepath.Join(dir, "noavatar.zip")
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	result := ExtractAvatarURI(path, SafeName("unknown"))
	if result != "" {
		t.Fatalf("ExtractAvatarURI should return empty for zip without avatar, got %s", result[:min(50, len(result))])
	}
}
