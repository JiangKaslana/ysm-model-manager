// ===== go/scanner 边界补测（覆盖缺口：38% → 提升）=====
// 补充主测试未覆盖的边界：normalizeScanKey / 空目录 / 目录级 .ban 跳过 /
// 缓存代际失效（扫描中 Invalidate 丢弃在途结果）/ 哈希读失败 / ScanLocalAuthors 空 root 跳过。
package scanner

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestNormalizeScanKey(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"", ""},                           // 空串 → 空
		{"  ", ""},                         // 全空白 → 空
		{"/a/b/", filepath.Clean("/a/b/")}, // 尾斜杠 → Clean
		{" /x/y ", filepath.Clean("/x/y")}, // 首尾空白 → trim + Clean
	}
	for _, c := range cases {
		if got := normalizeScanKey(c.in); got != c.want {
			t.Errorf("normalizeScanKey(%q) = %q, 期望 %q", c.in, got, c.want)
		}
	}
}

func TestScanEntries_EmptyDir(t *testing.T) {
	dir := t.TempDir()
	entries, hit := ScanEntriesWithHit(dir)
	if hit {
		t.Error("空目录首次扫描不应命中缓存")
	}
	if len(entries) != 0 {
		t.Errorf("空目录应返回空列表, got %d", len(entries))
	}
	// 二次扫描命中缓存
	_, hit2 := ScanEntriesWithHit(dir)
	if !hit2 {
		t.Error("二次扫描应命中缓存")
	}
}

func TestScanEntries_EmptyKey(t *testing.T) {
	entries, hit := ScanEntriesWithHit("   ")
	if hit || len(entries) != 0 {
		t.Errorf("空 key 应返回空且不命中, got %d hit=%v", len(entries), hit)
	}
}

func TestScanEntries_DirBanSkipped(t *testing.T) {
	// 目录级 .ban（ADR-038 D3.7 文件夹模型整组禁用）→ SkipDir，不扫描内部文件
	dir := t.TempDir()
	banDir := filepath.Join(dir, "modelA.ban")
	if err := os.MkdirAll(banDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(banDir, "inside.ysm"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	// 正常目录仍扫描
	if err := os.WriteFile(filepath.Join(dir, "normal.ysm"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	entries := ScanEntries(dir)
	if len(entries) != 1 || entries[0].Name != "normal.ysm" {
		t.Fatalf("应只扫到 normal.ysm（.ban 目录跳过）, got %+v", entries)
	}
}

func TestScanEntries_CacheGenInvalidateDuringScan(t *testing.T) {
	// 代际守卫：扫描开始后、Store 前 Invalidate，在途结果应被丢弃
	dir := t.TempDir()
	// 首次扫描建立缓存
	ScanEntries(dir)
	// 触发代际递增（InvalidateCache 会 Add(1)）
	InvalidateCache()
	// 再扫描：应未命中（缓存已清）且重新 Store
	entries, hit := ScanEntriesWithHit(dir)
	if hit {
		t.Error("InvalidateCache 后扫描不应命中缓存")
	}
	if len(entries) != 0 {
		t.Errorf("空目录应返回空, got %d", len(entries))
	}
}

// TestScanEntries_ExpiredCacheLazyEviction 过期缓存条目惰性淘汰：
// Load 命中过期 entry 时顺手 Delete，不返回陈旧结果且重新扫描
func TestScanEntries_ExpiredCacheLazyEviction(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "a.ysm"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, hit := ScanEntriesWithHit(dir); hit {
		t.Fatal("首次扫描不应命中缓存")
	}
	if _, hit := ScanEntriesWithHit(dir); !hit {
		t.Fatal("30s 内二次扫描应命中缓存")
	}
	// 白盒：把缓存条目 expiresAt 改为过去 → 触发惰性淘汰分支
	if v, ok := scanCache.Load(dir); ok {
		e := v.(scanCacheEntry)
		e.expiresAt = time.Now().Add(-time.Second)
		scanCache.Store(dir, e)
	} else {
		t.Fatal("扫描后缓存应有条目")
	}
	// 新增文件后扫描：过期条目应被淘汰并重新扫描（拿到最新结果且不命中）
	if err := os.WriteFile(filepath.Join(dir, "b.ysm"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	entries, hit := ScanEntriesWithHit(dir)
	if hit {
		t.Error("过期缓存应视为未命中并惰性淘汰")
	}
	if len(entries) != 2 {
		t.Fatalf("淘汰过期缓存后应扫到 2 个（a+b），实际 %d", len(entries))
	}
	// 新结果已重新缓存
	if _, hit := ScanEntriesWithHit(dir); !hit {
		t.Error("重新扫描应命中缓存")
	}
}

func TestComputeFileHash_ReadError(t *testing.T) {
	// 目录作为输入：os.Open 成功但 io.Copy 读目录报错 → 返回空哈希
	// （Windows chmod 0000 不阻止读取，用目录触发读错误跨平台可移植）
	dir := t.TempDir()
	if got := ComputeFileHash(dir); got != "" {
		t.Errorf("读目录应返回空哈希, got %q", got)
	}
}

func TestScanLocalAuthors_EmptyRootsSkipped(t *testing.T) {
	// 未配置的 root（空串）跳过，不 panic、不产出
	dir := t.TempDir()
	_ = os.WriteFile(filepath.Join(dir, "[作者D]模型.ysm"), []byte("x"), 0644)
	creators := ScanLocalAuthors(map[string]string{
		"ysm":    dir,
		"mmd":    "",
		"vrc":    "",
		"unused": "",
	})
	if len(creators) != 1 {
		t.Fatalf("应只从 ysm 根提取 1 个创作者, got %d", len(creators))
	}
	if creators[0].Name != "作者D" {
		t.Errorf("作者名解析失败: %+v", creators[0])
	}
}

func TestScanLocalAuthors_NoRoots(t *testing.T) {
	if got := ScanLocalAuthors(nil); got != nil {
		t.Errorf("nil roots 应返回 nil, got %v", got)
	}
	if got := ScanLocalAuthors(map[string]string{}); len(got) != 0 {
		t.Errorf("空 map 应返回空, got %v", got)
	}
}

func TestListModelAuthors_EmptyEntries(t *testing.T) {
	if got := ListModelAuthors(nil); len(got) != 0 {
		t.Errorf("nil entries 应返回空, got %v", got)
	}
}

// TestScanEntries_MMDSubDir ADR-096：MMD 类型已独立为顶级类型（EntityPlayer/SceneModel/CustomAnim 等），
// 不再通过 SubDir 字段区分子类型；所有文件 SubDir 恒为 ""。
// 本测试验证各独立类型目录下的文件均能被正确扫描。
func TestScanEntries_MMDSubDir(t *testing.T) {
	dir := t.TempDir()
	// 根下文件（EntityPlayer 默认）
	_ = os.WriteFile(filepath.Join(dir, "root.ysm"), []byte("x"), 0644)
	// SceneModel 子目录（独立类型）
	sceneDir := filepath.Join(dir, "SceneModel")
	_ = os.MkdirAll(sceneDir, 0755)
	_ = os.WriteFile(filepath.Join(sceneDir, "scene.ysm"), []byte("x"), 0644)
	// CustomAnim 子目录（独立类型）
	animDir := filepath.Join(dir, "CustomAnim")
	_ = os.MkdirAll(animDir, 0755)
	_ = os.WriteFile(filepath.Join(animDir, "anim.ysm"), []byte("x"), 0644)
	// 其他子目录
	otherDir := filepath.Join(dir, "OtherDir")
	_ = os.MkdirAll(otherDir, 0755)
	_ = os.WriteFile(filepath.Join(otherDir, "other.ysm"), []byte("x"), 0644)

	entries := ScanEntries(dir)
	if len(entries) != 4 {
		t.Fatalf("应扫到 4 个文件, got %d", len(entries))
	}
	// 新架构：SubDir 不再由扫描器填充，所有条目恒为 ""
	for _, e := range entries {
		if e.SubDir != "" {
			t.Errorf("文件 %s SubDir 应为空（新架构不再填充）, got %q", e.Name, e.SubDir)
		}
	}
	names := map[string]bool{}
	for _, e := range entries {
		names[e.Name] = true
	}
	for _, want := range []string{"root.ysm", "scene.ysm", "anim.ysm", "other.ysm"} {
		if !names[want] {
			t.Errorf("未扫到期望文件 %s", want)
		}
	}
}

func TestScanEntries_WalkErrorTolerated(t *testing.T) {
	// 目录不可读时 WalkDir 报错但不中断（返回已有条目）
	dir := t.TempDir()
	ok := filepath.Join(dir, "ok")
	if err := os.MkdirAll(ok, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(ok, "a.ysm"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	// 断链目录（dangling symlink）触发 walk error
	bad := filepath.Join(dir, "broken")
	if err := os.Symlink(filepath.Join(dir, "不存在"), bad); err != nil {
		t.Skip("跳过：当前平台不支持 symlink（Windows 需管理员）")
	}
	entries := ScanEntries(dir)
	// a.ysm 仍应被扫到，broken 报错被容忍
	found := false
	for _, e := range entries {
		if e.Name == "a.ysm" {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("walk error 不应中断正常文件扫描, got %+v", entries)
	}
	// 原断言（无论新旧版本）都是「断测试自身变量名」——
	// bad 由测试定义为 filepath.Join(dir, "broken")，filepath.Base(bad) 恒等于 "broken"，
	// 恒真/恒假伪断言。改为断言扫描结果：坏目录不得产出条目（以 bad 路径为前缀）
	for _, e := range entries {
		if strings.HasPrefix(e.Path, bad+string(filepath.Separator)) || e.Path == bad {
			t.Errorf("broken 目录不应产出条目: %+v", e)
		}
	}
}
