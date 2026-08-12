// ===== app_scan.go 薄壳级单测（零测试层补测）=====
// 覆盖：isPathInRoot 路径守卫边界 / 守卫入口（ListFileNames/CheckFileExists 根外拒绝）/
// 扫描缓存命中语义 / ListModelAuthors 作者前缀提取。避开 Wails runtime 与真实用户配置目录。
package app

import (
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/logs"
	"ysm-model-manager/go/types"
)

// scanApp 构造注入 configCache + logger 的 App（AddOpLog 依赖 logger）
func scanApp(t *testing.T, cfg types.AppConfig) *App {
	t.Helper()
	a := repoApp(t, cfg)
	a.logger = logs.NewLogger(t.TempDir())
	return a
}

func TestIsPathInRoot_Boundaries(t *testing.T) {
	base := t.TempDir()
	a := scanApp(t, types.AppConfig{FilesRoot: base})
	// ysm 子目录：FilesRoot/ysm
	root := filepath.Join(base, types.StorageSubDir("ysm"))
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		name string
		path string
		want bool
	}{
		{"根内文件", filepath.Join(root, "a.ysm"), true},
		{"根内子目录", filepath.Join(root, "sub", "b.ysm"), true},
		{"根本身（rel==. 拒绝）", root, false},
		{"兄弟目录（.. 越权）", filepath.Join(base, "other", "c.ysm"), false},
		{"..foo 合法目录（精确段比较不误拒）", filepath.Join(root, "..foo", "d.ysm"), true},
		{"空串", "", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := a.isPathInRoot(c.path); got != c.want {
				t.Errorf("isPathInRoot(%q) = %v, 期望 %v", c.path, got, c.want)
			}
		})
	}
}

func TestIsPathInRoot_NoRootConfigured(t *testing.T) {
	// FilesRoot 未配置 → GetRepoRoot 返回空 → 守卫一律拒绝（不静默放行）
	a := scanApp(t, types.AppConfig{})
	if a.isPathInRoot("/anything") {
		t.Error("未配置 FilesRoot 时 isPathInRoot 应恒 false")
	}
}

func TestListFileNames_Guard(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, types.StorageSubDir("ysm"))
	if err := os.MkdirAll(filepath.Join(root, "sub"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "a.ysm"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "sub", "b.ysm"), []byte("y"), 0o644); err != nil {
		t.Fatal(err)
	}
	a := scanApp(t, types.AppConfig{FilesRoot: base})

	t.Run("根内子目录递归列名", func(t *testing.T) {
		got := a.ListFileNames(filepath.Join(root, "sub"))
		if len(got) != 1 || got[0] != "b.ysm" {
			t.Fatalf("ListFileNames(sub) 应列出 b.ysm, got %v", got)
		}
	})

	t.Run("仓库根本身被守卫拒绝（rel==. 防整删）", func(t *testing.T) {
		if got := a.ListFileNames(root); got != nil {
			t.Errorf("仓库根本身应返回 nil（守卫拒绝）, got %v", got)
		}
	})

	t.Run("根外拒绝返回 nil", func(t *testing.T) {
		if got := a.ListFileNames(base); got != nil {
			t.Errorf("根外目录应返回 nil, got %v", got)
		}
	})
}

func TestCheckFileExists_Guard(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, types.StorageSubDir("ysm"))
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	inside := filepath.Join(root, "a.ysm")
	if err := os.WriteFile(inside, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(base, "secret.ysm")
	if err := os.WriteFile(outside, []byte("s"), 0o644); err != nil {
		t.Fatal(err)
	}
	a := scanApp(t, types.AppConfig{FilesRoot: base})

	if !a.CheckFileExists(inside) {
		t.Error("根内存在的文件应返回 true")
	}
	if a.CheckFileExists(outside) {
		t.Error("根外文件应被守卫拒绝（false）")
	}
	if a.CheckFileExists(filepath.Join(root, "不存在.ysm")) {
		t.Error("不存在的文件应返回 false")
	}
}

func TestScanModelEntries_CacheHit(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, types.StorageSubDir("ysm"))
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	// 最小合法 .ysm 文件（扫描器按扩展名识别，不做深度解析）
	if err := os.WriteFile(filepath.Join(root, "a.ysm"), []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	a := scanApp(t, types.AppConfig{FilesRoot: base})

	first := a.ScanModelEntries(root)
	if len(first) != 1 {
		t.Fatalf("首次扫描应发现 1 个文件, got %d", len(first))
	}
	// 30s 内二次扫描命中缓存，结果一致
	second := a.ScanModelEntries(root)
	if len(second) != 1 {
		t.Fatalf("缓存命中扫描应仍返回 1 个文件, got %d", len(second))
	}
}

func TestScanModelEntries_SiblingTypeRootAllowed(t *testing.T) {
	// code_review 修复：扫描入口是跨类型通用绑定，守卫边界必须是全部合法根
	// （FilesRoot 公共祖先），而非仅 ysmRoot——resourcepack 等兄弟类型根相对
	// ysmRoot 是 ../，旧守卫会误拒（got 0 回归）
	base := t.TempDir()
	rpRoot := filepath.Join(base, types.StorageSubDir("resourcepack"))
	if err := os.MkdirAll(rpRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(rpRoot, "rp.zip"), []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	a := scanApp(t, types.AppConfig{FilesRoot: base})

	entries := a.ScanModelEntries(rpRoot)
	if len(entries) != 1 {
		t.Fatalf("兄弟类型根（resourcepack）应可扫描 1 个文件, got %d", len(entries))
	}
	// 越权路径仍拒绝
	if got := a.ScanModelEntries(filepath.Join(base, "..", "outside")); got != nil {
		t.Errorf("根外路径应返回 nil, got %v", got)
	}
}

func TestScanModelEntriesWithLabel_Guard(t *testing.T) {
	// code_review 修复：WithLabel 是前端主扫描入口，须与 ScanModelEntries 共用守卫
	base := t.TempDir()
	root := filepath.Join(base, types.StorageSubDir("ysm"))
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "a.ysm"), []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	a := scanApp(t, types.AppConfig{FilesRoot: base})

	if got := a.ScanModelEntriesWithLabel(root, "模型"); len(got) != 1 {
		t.Fatalf("根内扫描应返回 1 个文件, got %d", len(got))
	}
	if got := a.ScanModelEntriesWithLabel(filepath.Join(base, "..", "outside"), "模型"); got != nil {
		t.Errorf("根外路径应返回 nil, got %v", got)
	}
}

func TestScanModelEntriesWithHit_CacheSemantics(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, types.StorageSubDir("ysm"))
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	a := scanApp(t, types.AppConfig{FilesRoot: base})

	// 空目录：首次未命中缓存（hit=false），结果为空不报错
	entries, hit := a.scanModelEntriesWithHit(root)
	if hit {
		t.Error("首次扫描不应命中缓存")
	}
	if len(entries) != 0 {
		t.Errorf("空目录扫描应为空, got %d", len(entries))
	}
	// 二次扫描命中缓存
	_, hit2 := a.scanModelEntriesWithHit(root)
	if !hit2 {
		t.Error("二次扫描应命中 30s 缓存")
	}
	// 清缓存后再次未命中
	a.ClearScanCache()
	_, hit3 := a.scanModelEntriesWithHit(root)
	if hit3 {
		t.Error("ClearScanCache 后不应命中缓存")
	}
}

func TestListModelAuthors_PrefixExtraction(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, types.StorageSubDir("ysm"))
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	files := []string{
		"[作者A] 角色一.ysm",
		"[作者A] 角色二.ysm",
		"[作者B] 角色三.ysm",
		"无前缀.ysm",
	}
	for _, f := range files {
		if err := os.WriteFile(filepath.Join(root, f), []byte("{}"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	a := scanApp(t, types.AppConfig{FilesRoot: base})

	got := a.ListModelAuthors()
	if len(got) != 2 {
		t.Fatalf("应提取 2 个作者, got %v", got)
	}
	for _, author := range got {
		if author.Name == "作者A" && author.Count != 2 {
			t.Errorf("作者A 应计数 2, got %d", author.Count)
		}
		if author.Name == "作者B" && author.Count != 1 {
			t.Errorf("作者B 应计数 1, got %d", author.Count)
		}
	}
}

// TestIsPathInRootOrSelf_Boundaries 表驱动：多根守卫核心边界。
// isPathInRootOrSelf 是 Wails binding 层（ScanModelEntries / ScanModelEntriesWithLabel /
// GenerateRepoIndex / FindDuplicateFiles / CountDuplicateFiles）共用的路径守卫，
// 语义与 isPathInRoot 的关键差异：放行根本身（rel==.）、支持兄弟类型根（resourcepack 等）。
func TestIsPathInRootOrSelf_Boundaries(t *testing.T) {
	base := t.TempDir()
	ysmRoot := filepath.Join(base, types.StorageSubDir("ysm"))
	rpRoot := filepath.Join(base, types.StorageSubDir("resourcepack"))
	if err := os.MkdirAll(ysmRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(rpRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	a := scanApp(t, types.AppConfig{
		FilesRoot:        base,
		ResourcepackRoot: rpRoot,
	})

	cases := []struct {
		name string
		path string
		want bool
	}{
		{"ysm 根内文件", filepath.Join(ysmRoot, "a.ysm"), true},
		{"ysm 根本身（rel==. 放行——整仓扫描合法）", ysmRoot, true},
		{"resourcepack 根内文件（兄弟类型根放行）", filepath.Join(rpRoot, "rp.zip"), true},
		{"resourcepack 根本身", rpRoot, true},
		{"FilesRoot 根本身", base, true},
		{".. 越权", filepath.Join(base, "..", "outside"), false},
		{"根外子目录", filepath.Join(base, "..", "other"), false},
		{"空串", "", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := a.isPathInRootOrSelf(c.path)
			if got != c.want {
				t.Errorf("isPathInRootOrSelf(%q) = %v, 期望 %v", c.path, got, c.want)
			}
		})
	}
}

// TestIsPathInRootOrSelf_NoRootConfigured 多根均空 → 一律拒绝
func TestIsPathInRootOrSelf_NoRootConfigured(t *testing.T) {
	a := scanApp(t, types.AppConfig{})
	if a.isPathInRootOrSelf("/anything") {
		t.Error("无配置根时 isPathInRootOrSelf 应恒 false")
	}
}

// TestIsPathInRootOrSelf_RootItselfAllowed 对比：isPathInRoot 拒绝根本身，
// isPathInRootOrSelf 放行根本身（这是两函数语义差异的核心，直接影响整仓扫描合法与否）
func TestIsPathInRootOrSelf_RootItselfAllowed(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, types.StorageSubDir("ysm"))
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	a := scanApp(t, types.AppConfig{FilesRoot: base})

	if !a.isPathInRootOrSelf(root) {
		t.Error("isPathInRootOrSelf 应放行根本身（整仓扫描）")
	}
	if a.isPathInRoot(root) {
		t.Error("isPathInRoot 应拒绝根本身（防整删）")
	}
}
