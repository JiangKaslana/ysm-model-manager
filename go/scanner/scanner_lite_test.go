// ===== ScanEntriesLite 轻量扫描测试（作者提取专用路径）=====
// 覆盖：与全量扫描同口径的过滤（扩展名/禁用恢复/recycle/.github/ysm.json）、
// 不读文件信息不计算哈希（Size/Hash 恒零值）、不读不写共享 scanCache（双向隔离）。
package scanner

import (
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types"
)

func TestScanEntriesLite_FilteringParity(t *testing.T) {
	dir := t.TempDir()
	write := func(rel string) {
		p := filepath.Join(dir, rel)
		if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte("x"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	write("[作者C]模型.ysm")
	write("[作者C]禁用.ysm.ban")
	write("[作者D]模型/ysm.json") // ysm.json → Name 取目录基名
	write("notes.txt")        // 不支持扩展名 → 排除
	write(".github/workflow.yml")
	write(".recycle/[旧]模型.ysm") // 回收站目录整树跳过
	write("[禁]目录.disabled/x.ysm")

	got := ScanEntriesLite(dir)
	byName := map[string]types.ModelEntry{}
	for _, e := range got {
		byName[e.Name] = e
	}
	if len(got) != 3 {
		t.Fatalf("应 3 个条目，实际 %d: %+v", len(got), byName)
	}
	if e, ok := byName["[作者C]模型.ysm"]; !ok || e.Hash != "" || e.Size != 0 {
		t.Fatalf("活跃 ysm 应在列且无哈希无 Size: %+v", e)
	}
	if e, ok := byName["[作者C]禁用.ysm.ban"]; !ok || e.Ext != ".ysm" {
		t.Fatalf("禁用文件应恢复扩展名 .ysm: %+v", e)
	}
	if e, ok := byName["[作者D]模型"]; !ok || e.Ext != ".json" {
		t.Fatalf("ysm.json 条目 Name 应取目录基名: %+v", e)
	}
}

func TestScanEntriesLite_BypassesCacheBothWays(t *testing.T) {
	dirA := t.TempDir()
	if err := os.WriteFile(filepath.Join(dirA, "[甲]a.ysm"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	// 全量路径先扫，缓存写入 1 条
	if got := ScanEntries(dirA); len(got) != 1 {
		t.Fatalf("前置全量扫描应 1 条，实际 %d", len(got))
	}
	// 追加文件后全量路径命中 30s 缓存仍返回旧 1 条
	if err := os.WriteFile(filepath.Join(dirA, "[乙]b.ysm"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	if cached, hit := ScanEntriesWithHit(dirA); !hit || len(cached) != 1 {
		t.Fatalf("全量路径应命中缓存返回 1 条, hit=%v n=%d", hit, len(cached))
	}
	// 轻量路径无视缓存看到最新 2 条（读侧隔离）
	if lite := ScanEntriesLite(dirA); len(lite) != 2 {
		t.Fatalf("轻量路径应绕过缓存见 2 条，实际 %d", len(lite))
	}
	// 写侧隔离：轻量先扫的新目录不得污染共享缓存
	dirB := t.TempDir()
	if err := os.WriteFile(filepath.Join(dirB, "[丙]c.ysm"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	_ = ScanEntriesLite(dirB)
	if _, hit := ScanEntriesWithHit(dirB); hit {
		t.Fatal("轻量扫描结果不得写入共享 scanCache（无哈希条目会污染同步系统）")
	}
}

func TestScanLocalAuthors_LitePathFindsAuthors(t *testing.T) {
	dir := t.TempDir()
	_ = os.WriteFile(filepath.Join(dir, "[作者L]模型.ysm"), []byte("x"), 0644)
	creators := ScanLocalAuthors(map[string]string{"ysm": dir})
	if len(creators) != 1 || creators[0].Name != "作者L" || creators[0].Type != "ysm" {
		t.Fatalf("轻量路径下 ScanLocalAuthors 解析失败: %+v", creators)
	}
}
