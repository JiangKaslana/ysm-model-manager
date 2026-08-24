//go:build windows && rust_backend

package scanner

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"testing"

	"ysm-model-manager/go/rustbridge"
	"ysm-model-manager/go/types"
)

// TestScanEntriesWithRust_ManifestPathMatchesJwalk 锁定 ADR-120 核心契约：
// 缓存命中时 scanEntriesWithRust 走 manifest 路径（Go 预枚举 → Rust 跳过 jwalk），
// 产出必须与 jwalk 基准（rustbridge.Scan）逐字段一致。
func TestScanEntriesWithRust_ManifestPathMatchesJwalk(t *testing.T) {
	base := t.TempDir()
	// registry 仅放行 .ysm + ysm.json（对齐 Rust is_model_json_name 白名单）
	registryJSON, err := json.Marshal(types.LoadRegistry())
	if err != nil {
		t.Fatalf("marshal registry: %v", err)
	}

	// 构造测试树（与 Rust tests.rs manifest_scan_matches_jwalk_scan 同构）
	heroYsm := filepath.Join(base, "hero.ysm")
	if err := os.WriteFile(heroYsm, []byte("hero-content"), 0644); err != nil {
		t.Fatal(err)
	}
	modelDir := filepath.Join(base, "official-winefox")
	if err := os.MkdirAll(modelDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(modelDir, "ysm.json"), []byte("{}"), 0644); err != nil {
		t.Fatal(err)
	}

	// jwalk 基准
	jwalkResp, err := rustbridge.Scan(base, registryJSON)
	if err != nil {
		t.Fatalf("jwalk Scan failed: %v", err)
	}

	// 暖缓存（模拟刷新后 Go 已扫描）
	if _, hit := ScanEntriesWithHit(base); !hit {
		// 首次扫描，再取一次确保命中
		ScanEntriesWithHit(base)
	}
	entries, _, ok := scanEntriesWithRust(base)
	if !ok {
		t.Fatal("scanEntriesWithRust returned not-ok")
	}

	if len(entries) != len(jwalkResp.Entries) {
		t.Fatalf("manifest 路径产出 %d 条，jwalk 基准 %d 条", len(entries), len(jwalkResp.Entries))
	}

	byPath := func(s []types.ModelEntry) map[string]types.ModelEntry {
		m := make(map[string]types.ModelEntry, len(s))
		for _, e := range s {
			m[filepath.ToSlash(e.Path)] = e
		}
		return m
	}
	manifestMap := byPath(entries)
	jwalkMap := byPath(jwalkResp.Entries)

	paths := make([]string, 0, len(manifestMap))
	for p := range manifestMap {
		paths = append(paths, p)
	}
	sort.Strings(paths)

	for _, p := range paths {
		m := manifestMap[p]
		j, ok := jwalkMap[p]
		if !ok {
			t.Fatalf("manifest 路径 %s 在 jwalk 基准中缺失", p)
		}
		if m.Ext != j.Ext {
			t.Errorf("Path %s: Ext manifest=%q jwalk=%q", p, m.Ext, j.Ext)
		}
		if m.Name != j.Name {
			t.Errorf("Path %s: Name manifest=%q jwalk=%q", p, m.Name, j.Name)
		}
		if m.Size != j.Size {
			t.Errorf("Path %s: Size manifest=%d jwalk=%d", p, m.Size, j.Size)
		}
		if m.Hash != j.Hash {
			t.Errorf("Path %s: Hash manifest=%q jwalk=%q", p, m.Hash, j.Hash)
		}
		if m.ModTime != j.ModTime {
			t.Errorf("Path %s: ModTime manifest=%d jwalk=%d", p, m.ModTime, j.ModTime)
		}
	}
}

// TestScanEntriesWithRust_CacheMissFallsBackToJwalk 锁定回退契约：
// 缓存未命中（dir 从未被 Go 扫描）时，scanEntriesWithRust 必须回退 jwalk，不报错。
func TestScanEntriesWithRust_CacheMissFallsBackToJwalk(t *testing.T) {
	base := t.TempDir()
	heroYsm := filepath.Join(base, "hero.ysm")
	if err := os.WriteFile(heroYsm, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	// 不暖缓存，直接调 —— 应回退 jwalk 成功
	entries, _, ok := scanEntriesWithRust(base)
	if !ok {
		t.Fatal("cache miss 应回退 jwalk 且 ok=true")
	}
	if len(entries) != 1 {
		t.Fatalf("回退 jwalk 应产出 1 条，实际 %d", len(entries))
	}
}
