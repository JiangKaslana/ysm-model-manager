// ===== resource_bindings.go 薄壳级单测（零测试层补测）=====
// 覆盖：specificRoot 专属路径优先级 / voxelMaxBlocks 配置回退 / repoDirAccessible
// 目录可读判定 / GetDefaultRepoRoot 平台默认根。避开 Wails runtime 与真实配置目录。
package app

import (
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types"
)

func TestSpecificRoot_Priority(t *testing.T) {
	base := t.TempDir()

	t.Run("ConfigField 专属路径优先", func(t *testing.T) {
		cfg := types.AppConfig{
			FilesRoot:        base,
			ResourcepackRoot: filepath.Join(base, "rp-override"),
		}
		got := specificRoot(cfg, "resourcepack")
		if got != cfg.ResourcepackRoot {
			t.Errorf("ConfigField 专属路径应优先, got %q want %q", got, cfg.ResourcepackRoot)
		}
	})

	t.Run("无 ConfigField 时返回空", func(t *testing.T) {
		cfg := types.AppConfig{FilesRoot: base}
		if got := specificRoot(cfg, "ysm"); got != "" {
			t.Errorf("ysm 类型无专属字段应返回空, got %q", got)
		}
	})

	t.Run("未知类型返回空", func(t *testing.T) {
		cfg := types.AppConfig{FilesRoot: base}
		if got := specificRoot(cfg, "not-a-type"); got != "" {
			t.Errorf("未知类型应返回空, got %q", got)
		}
	})
}

func TestVoxelMaxBlocks_Fallback(t *testing.T) {
	t.Run("配置值为 0 → 默认 200000", func(t *testing.T) {
		a := repoApp(t, types.AppConfig{})
		if got := a.voxelMaxBlocks(); got != 200000 {
			t.Errorf("默认体素上限应为 200000, got %d", got)
		}
	})

	t.Run("配置值 >0 → 使用配置值", func(t *testing.T) {
		a := repoApp(t, types.AppConfig{VoxelMaxBlocks: 42})
		if got := a.voxelMaxBlocks(); got != 42 {
			t.Errorf("配置体素上限应为 42, got %d", got)
		}
	})
}

func TestRepoDirAccessible_File(t *testing.T) {
	// 目录存在/不存在判定已在 pathmgr_test.go 覆盖，这里只补「文件路径不算目录」边界
	dir := t.TempDir()
	p := filepath.Join(dir, "a.txt")
	if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if repoDirAccessible(p) {
		t.Error("文件路径不应判定为可读目录")
	}
}

func TestGetDefaultRepoRoot(t *testing.T) {
	orig := pathMgr
	defer func() { pathMgr = orig }()

	t.Run("平台默认根为空 → 返回空", func(t *testing.T) {
		pathMgr = fakePathMgr{repo: ""}
		a := repoApp(t, types.AppConfig{})
		if got := a.GetDefaultRepoRoot(); got != "" {
			t.Errorf("默认根为空应返回空, got %q", got)
		}
	})

	t.Run("平台默认根可读 → 返回并创建", func(t *testing.T) {
		root := filepath.Join(t.TempDir(), "repo")
		pathMgr = fakePathMgr{repo: root}
		a := repoApp(t, types.AppConfig{})
		got := a.GetDefaultRepoRoot()
		if got != root {
			t.Errorf("应返回平台默认根, got %q want %q", got, root)
		}
		if _, err := os.Stat(root); err != nil {
			t.Errorf("默认根应被创建, err=%v", err)
		}
	})
}

// TestFindDuplicateErrorJSON 契约测试：绑定层错误响应为 {error: string} JSON，
// 前端社区诊断按此双形态（DedupGroup[] | {error}）解析，需保证转义正确。
func TestFindDuplicateErrorJSON(t *testing.T) {
	t.Run("普通消息", func(t *testing.T) {
		got := findDuplicateErrorJSON("路径超出仓库目录")
		if got != `{"error":"路径超出仓库目录"}` {
			t.Errorf("普通消息: got %q", got)
		}
	})

	t.Run("含双引号的消息（转义）", func(t *testing.T) {
		got := findDuplicateErrorJSON(`open "C:\foo": access denied`)
		if got != `{"error":"open \"C:\\foo\": access denied"}` {
			t.Errorf("含引号消息转义: got %q", got)
		}
	})

	t.Run("含反斜杠的消息（Windows 路径）", func(t *testing.T) {
		got := findDuplicateErrorJSON(`C:\Users\a\b`)
		if got != `{"error":"C:\\Users\\a\\b"}` {
			t.Errorf("Windows 路径转义: got %q", got)
		}
	})

	t.Run("含换行符的消息", func(t *testing.T) {
		got := findDuplicateErrorJSON("line1\nline2")
		if got != `{"error":"line1\nline2"}` {
			t.Errorf("换行符转义: got %q", got)
		}
	})

	t.Run("空消息（边界）", func(t *testing.T) {
		got := findDuplicateErrorJSON("")
		if got != `{"error":""}` {
			t.Errorf("空消息: got %q", got)
		}
	})
}
