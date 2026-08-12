// ===== app_install.go 薄壳级单测（零测试层补测）=====
// 覆盖：ClearCustomDir 清理语义（根外拒绝/同名删除/非同名保留/.ban 处理/.recycle 跳过）/
// countMatchingInDir 同名计数 / isResourcePackFolder 检测 / findRecycleRoot 多类型根命中 /
// MoveToRecycleEx 未命中。避开 Wails runtime 与真实用户配置目录。
package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ysm-model-manager/go/types"
)

// installApp 构造注入 configCache + logger 的 App（AddOpLog/ClearCustomDir 依赖 logger）
func installApp(t *testing.T, cfg types.AppConfig) *App {
	t.Helper()
	a := scanApp(t, cfg)
	return a
}

func TestClearCustomDir_Guard(t *testing.T) {
	base := t.TempDir()
	a := installApp(t, types.AppConfig{FilesRoot: base})

	t.Run("空目录报错", func(t *testing.T) {
		if _, err := a.ClearCustomDir("  "); err == nil {
			t.Error("空目录应报错")
		}
	})

	t.Run("根外路径拒绝", func(t *testing.T) {
		outside := filepath.Join(base, "..", "outside")
		if err := os.MkdirAll(outside, 0o755); err != nil {
			t.Fatal(err)
		}
		if _, err := a.ClearCustomDir(outside); err == nil {
			t.Error("根外路径应被守卫拒绝")
		}
	})

	t.Run("仓库根本身拒绝（rel==. 防整删）", func(t *testing.T) {
		root := filepath.Join(base, types.StorageSubDir("ysm"))
		if err := os.MkdirAll(root, 0o755); err != nil {
			t.Fatal(err)
		}
		if _, err := a.ClearCustomDir(root); err == nil {
			t.Error("仓库根本身应被守卫拒绝")
		}
	})
}

func TestClearCustomDir_RemovalSemantics(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, types.StorageSubDir("ysm"))
	if err := os.MkdirAll(filepath.Join(root, ".recycle"), 0o755); err != nil {
		t.Fatal(err)
	}
	// 仓库文件（供 repoByName 匹配）——ClearCustomDir 守卫基准是 ysmRoot()，
	// 整合包自定义目录须位于 ysmRoot 内（真实场景：整合包的 ysm 子目录）；
	// 注：仓库表由 ScanModelEntries(ysmRoot) 递归构建，custom 内文件也在扫描范围，
	// 故「独有保留」分支（仓库无此文件）在该布局下不可达——只验证删除/跳过语义
	if err := os.WriteFile(filepath.Join(root, "共享.ysm"), []byte("r"), 0o644); err != nil {
		t.Fatal(err)
	}
	// 整合包目录（位于 ysmRoot 内，符合守卫契约）
	custom := filepath.Join(root, "instances", "TestPack")
	if err := os.MkdirAll(custom, 0o755); err != nil {
		t.Fatal(err)
	}
	files := map[string]string{
		"共享.ysm":       "c",  // 仓库同名 → 删除
		"共享.ysm.ban":   "cb", // .ban 后缀 → 截取后同名 → 删除
		"textures.txt": "t",  // 非 .ysm/.zip/.7z → 跳过
		"隐藏.ysm":       "h",  // 放入 .recycle → SkipDir 不处理
	}
	for name, content := range files {
		dir := custom
		if name == "隐藏.ysm" {
			dir = filepath.Join(custom, ".recycle")
		}
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	a := installApp(t, types.AppConfig{FilesRoot: base})

	n, err := a.ClearCustomDir(custom)
	if err != nil {
		t.Fatal(err)
	}
	if n != 2 {
		t.Fatalf("应删除 2 个仓库同名文件, got %d", n)
	}
	// txt 保留、.recycle 内文件保留
	if _, err := os.Stat(filepath.Join(custom, "textures.txt")); err != nil {
		t.Error("非模型扩展名应保留")
	}
	if _, err := os.Stat(filepath.Join(custom, ".recycle", "隐藏.ysm")); err != nil {
		t.Error(".recycle 目录内文件应跳过")
	}
}

func TestCountMatchingInDir(t *testing.T) {
	base := t.TempDir()
	repo := filepath.Join(base, "repo")
	inst := filepath.Join(base, "inst")
	for _, d := range []string{repo, inst} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	// 仓库：a.ysm / b.ysm
	if err := os.WriteFile(filepath.Join(repo, "a.ysm"), []byte("1"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repo, "b.ysm"), []byte("2"), 0o644); err != nil {
		t.Fatal(err)
	}
	// 实例：a.ysm（同名）/ c.ysm（独有）/ d.ZIP（大小写不敏感同名）
	if err := os.WriteFile(filepath.Join(inst, "a.ysm"), []byte("3"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(inst, "c.ysm"), []byte("4"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(inst, "d.ZIP"), []byte("5"), 0o644); err != nil {
		t.Fatal(err)
	}
	a := installApp(t, types.AppConfig{})
	if got := a.countMatchingInDir(inst, repo); got != 1 {
		t.Errorf("应计 1 个同名文件（a.ysm）, got %d", got)
	}
}

func TestIsResourcePackFolder(t *testing.T) {
	dir := t.TempDir()
	t.Run("含 pack.mcmeta → true", func(t *testing.T) {
		p := filepath.Join(dir, "rp")
		if err := os.MkdirAll(p, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(p, "pack.mcmeta"), []byte("{}"), 0o644); err != nil {
			t.Fatal(err)
		}
		if !isResourcePackFolder(p) {
			t.Error("含 pack.mcmeta 的目录应判定为资源包")
		}
	})
	t.Run("不含 pack.mcmeta → false", func(t *testing.T) {
		p := filepath.Join(dir, "not-rp")
		if err := os.MkdirAll(p, 0o755); err != nil {
			t.Fatal(err)
		}
		if isResourcePackFolder(p) {
			t.Error("不含 pack.mcmeta 的目录不应判定为资源包")
		}
	})
	t.Run("目录不存在 → false", func(t *testing.T) {
		if isResourcePackFolder(filepath.Join(dir, "missing")) {
			t.Error("不存在的目录应返回 false")
		}
	})
}

func TestFindRecycleRoot_MultiType(t *testing.T) {
	base := t.TempDir()
	rp := filepath.Join(base, "resourcepacks")
	if err := os.MkdirAll(rp, 0o755); err != nil {
		t.Fatal(err)
	}
	a := installApp(t, types.AppConfig{
		FilesRoot:        base,
		ResourcepackRoot: rp,
	})

	t.Run("resourcepack 根内命中", func(t *testing.T) {
		got := a.findRecycleRoot(filepath.Join(rp, "某包.zip"))
		if got != rp {
			t.Fatalf("resourcepack 子目录应命中, got %q", got)
		}
	})

	t.Run("未配置根不参与（空跳过）", func(t *testing.T) {
		// ShaderpackRoot 未配置 → 不参与候选；路径落到 FilesRoot 内 → 命中 ysm 子目录
		ysm := filepath.Join(base, types.StorageSubDir("ysm"))
		if err := os.MkdirAll(ysm, 0o755); err != nil {
			t.Fatal(err)
		}
		got := a.findRecycleRoot(filepath.Join(ysm, "m.ysm"))
		if got != ysm {
			t.Fatalf("ysm 子目录应命中, got %q", got)
		}
	})
}

func TestMoveToRecycleEx_NoRoot(t *testing.T) {
	base := t.TempDir()
	a := installApp(t, types.AppConfig{FilesRoot: base})
	// 仓库根未创建：src 在根内子目录也找不到根（未配置目录不存在）→ error
	outside := filepath.Join(t.TempDir(), "x.ysm")
	if err := os.WriteFile(outside, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	action, reason := a.MoveToRecycleEx(outside)
	if action != "error" || !strings.Contains(reason, "未找到") {
		t.Errorf("外部路径应返回 error, got %q %q", action, reason)
	}
}
