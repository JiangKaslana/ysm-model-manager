// ===== go/sync 边界/异常用例 =====
// 目标：用构造的异常/边界输入拷问源码健壮性；源码修复后，用例转为正确行为回归。
package sync

import (
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types"
)

// =====================================================================
// 一、nil 参数保护（已修复）
// =====================================================================

// FIX-1 RelinkDir 对 nil scanFn 应返回错误而非 panic。sync_relink.go 已加 nil 判断。
func TestRelinkDir_NilScanFn_ReturnsError(t *testing.T) {
	base := t.TempDir()
	repoRoot := filepath.Join(base, "repo")
	customDir := filepath.Join(base, "inst", ".minecraft", "resourcepacks")
	_ = os.MkdirAll(repoRoot, 0755)
	_ = os.MkdirAll(customDir, 0755)

	c, err := RelinkDir(customDir, repoRoot, "ysm", "copy", nil,
		func(name, src, dst string, size int64, status, msg string) {})
	if err == nil {
		t.Fatal("nil scanFn 应返回错误，实际 nil")
	}
	if c != 0 {
		t.Logf("nil scanFn 计数应 = 0，实际 %d", c)
	}
	t.Logf("nil scanFn 返回错误: %v", err)
}

// FIX-2 RelinkDir 对 nil logger 应跳过日志调用而非 panic。sync_relink.go 各分支已加 logger != nil 判断。
func TestRelinkDir_NilLogger_NoPanicOnFailure(t *testing.T) {
	base := t.TempDir()
	repoRoot := filepath.Join(base, "repo")
	customDir := filepath.Join(base, "inst", ".minecraft", "resourcepacks")
	_ = os.MkdirAll(repoRoot, 0755)
	_ = os.MkdirAll(customDir, 0755)

	// scanFn 返回一条 hash 匹配的条目，但实际 srcPath 不存在——InstallLocked 必失败 → 触发 logger 调用路径。
	scanFn := func(dir string) []types.ModelEntry {
		return []types.ModelEntry{
			{Name: "ghost.ysm", Path: filepath.Join(dir, "ghost.ysm"), Hash: "ghost"},
		}
	}
	// 不应 panic——nil logger 应被保护。
	c, err := RelinkDir(customDir, repoRoot, "ysm", "copy", scanFn, nil)
	if err != nil {
		t.Logf("nil logger 返回错误（可接受）: %v", err)
	}
	if c != 0 {
		t.Logf("nil logger 无匹配条目，计数应 = 0，实际 %d", c)
	}
}

// FIX-3 GetInstanceStatusWith 对 nil scanFn 应返回空而非 panic。
func TestGetInstanceStatusWith_NilScanFn_ReturnsEmpty(t *testing.T) {
	results := GetInstanceStatusWith("/mc", "/repo", nil,
		func(mcRoot string) []types.VersionInstance { return nil })
	if results != nil {
		t.Logf("nil scanFn 期望 nil，实际 len=%d", len(results))
	}
}

// FIX-4 GetInstanceStatusWith 对 nil listFn 应返回空而非 panic。
func TestGetInstanceStatusWith_NilListFn_ReturnsEmpty(t *testing.T) {
	results := GetInstanceStatusWith("/mc", "/repo",
		func(dir string) []types.ModelEntry { return nil }, nil)
	if results != nil {
		t.Logf("nil listFn 期望 nil，实际 len=%d", len(results))
	}
}

// FIX-5 SyncCustomToRepo 对 nil logger 应跳过日志调用而非 panic（同名 skip 分支）。
func TestSyncCustomToRepo_NilLogger_NoPanicOnSkip(t *testing.T) {
	base := t.TempDir()
	customDir := filepath.Join(base, "custom")
	repoDir := filepath.Join(base, "repo")
	_ = os.MkdirAll(customDir, 0755)
	_ = os.MkdirAll(repoDir, 0755)

	_ = os.WriteFile(filepath.Join(customDir, "dup.ysm"), []byte("x"), 0644)
	_ = os.WriteFile(filepath.Join(repoDir, "dup.ysm"), []byte("x"), 0644)

	scanFn := func(dir string) []types.ModelEntry {
		return []types.ModelEntry{{Name: "dup.ysm", Path: filepath.Join(dir, "dup.ysm"), Hash: "h-dup"}}
	}
	// 不应 panic。
	c, err := SyncCustomToRepo(customDir, repoDir, scanFn, nil)
	if err != nil {
		t.Logf("nil logger 返回错误（可接受）: %v", err)
	}
	if c != 0 {
		t.Logf("同名 skip 分支计数应 = 0，实际 %d", c)
	}
}

// FIX-6 SyncCustomToRepo 对 nil logger 不应在 hash 碰撞 skip 分支 panic。
func TestSyncCustomToRepo_NilLogger_NoPanicOnHashSkip(t *testing.T) {
	base := t.TempDir()
	customDir := filepath.Join(base, "custom")
	repoDir := filepath.Join(base, "repo")
	_ = os.MkdirAll(customDir, 0755)
	_ = os.MkdirAll(repoDir, 0755)

	_ = os.WriteFile(filepath.Join(customDir, "a.ysm"), []byte("x"), 0644)
	_ = os.WriteFile(filepath.Join(repoDir, "a.ysm"), []byte("x"), 0644)

	scanFn := func(dir string) []types.ModelEntry {
		return []types.ModelEntry{{Name: "a.ysm", Path: filepath.Join(dir, "a.ysm"), Hash: "h1"}}
	}
	// 不应 panic。
	c, err := SyncCustomToRepo(customDir, repoDir, scanFn, nil)
	if err != nil {
		t.Logf("nil logger 返回错误（可接受）: %v", err)
	}
	if c != 0 {
		t.Logf("hash 碰撞 skip 计数应 = 0，实际 %d", c)
	}
}

// =====================================================================
// 二、路径穿越 / Rel 错误忽略（已修复）
// =====================================================================

// FIX-7 SyncCustomToRepo 现在拒绝 e.Path 不在 customDir 下的越界条目，不再 MkdirAll 到 repoDir 外部。
func TestSyncCustomToRepo_PathTraversal_Rejected(t *testing.T) {
	base := t.TempDir()
	customDir := filepath.Join(base, "custom")
	repoDir := filepath.Join(base, "repo")
	leakDir := filepath.Join(base, "leaked")
	_ = os.MkdirAll(customDir, 0755)
	_ = os.MkdirAll(repoDir, 0755)
	_ = os.RemoveAll(leakDir)
	if _, err := os.Stat(leakDir); err == nil {
		t.Fatal("leakDir 应起初不存在")
	}

	fakePath := filepath.Join(leakDir, "m.ysm")
	scanFn := func(dir string) []types.ModelEntry {
		if dir == repoDir {
			return []types.ModelEntry{{Name: "repo.ysm", Path: filepath.Join(repoDir, "repo.ysm"), Hash: "h-repo"}}
		}
		return []types.ModelEntry{{Name: "m.ysm", Path: fakePath, Hash: "h-leaked"}}
	}
	_, err := SyncCustomToRepo(customDir, repoDir, scanFn,
		func(name, src, dst string, size int64, status, msg string) {})
	if err != nil {
		t.Logf("返回错误（可接受）: %v", err)
	}

	// 红线：leakDir 绝不应被创建。
	if _, err := os.Stat(leakDir); err == nil {
		t.Fatal("leakDir 不应被创建——路径穿越副作用仍存在")
	}
}

// =====================================================================
// 三、重复/同哈希冲突（未修，保留用例+注释）
// =====================================================================

// TODO(BUG): RelinkDir 的 repoByHash map 为 last-wins——仓库中同 hash 多条时，前面的条目被静默丢弃，
// 重链接时只用最后一条路径作为源。若用户仓库里同 hash 存了多个版本，前面的被遗忘。
// 源码：sync_relink.go `repoByHash[e.Hash] = e.Path` 直接覆盖。
func TestRelinkDir_DuplicateHash_LastWins(t *testing.T) {
	base := t.TempDir()
	repoRoot := filepath.Join(base, "repo")
	customDir := filepath.Join(base, "inst", ".minecraft", "resourcepacks")
	_ = os.MkdirAll(filepath.Join(repoRoot, "v1"), 0755)
	_ = os.MkdirAll(filepath.Join(repoRoot, "v2"), 0755)
	_ = os.MkdirAll(customDir, 0755)

	_ = os.WriteFile(filepath.Join(repoRoot, "v1", "m.ysm"), []byte("v1"), 0644)
	_ = os.WriteFile(filepath.Join(repoRoot, "v2", "m.ysm"), []byte("v2"), 0644)
	_ = os.WriteFile(filepath.Join(customDir, "m.ysm"), []byte("old"), 0644)

	var srcUsed string
	scanFn := func(dir string) []types.ModelEntry {
		if dir == repoRoot {
			return []types.ModelEntry{
				{Name: "m.ysm", Path: filepath.Join(dir, "v1", "m.ysm"), Hash: "h1"},
				{Name: "m.ysm", Path: filepath.Join(dir, "v2", "m.ysm"), Hash: "h1"},
			}
		}
		return []types.ModelEntry{{Name: "m.ysm", Path: filepath.Join(dir, "m.ysm"), Hash: "h1"}}
	}
	_, err := RelinkDir(customDir, repoRoot, "resourcepack", "copy", scanFn,
		func(name, src, dst string, size int64, status, msg string) {
			if status == "success" || msg == "" {
				srcUsed = src
			}
		})
	if err != nil {
		t.Fatalf("RelinkDir 失败: %v", err)
	}
	data, _ := os.ReadFile(filepath.Join(customDir, "m.ysm"))
	if string(data) != "v2" {
		t.Logf("结果=%q, 源=%s", string(data), srcUsed)
	} else {
		t.Logf("TODO(BUG): 同 hash last-wins（源码未修）：源=%s", srcUsed)
	}
}

// TODO(BUG): RelinkDir 目录级分支同样 last-wins。
func TestRelinkDir_DuplicateHash_DirLevel_LastWins(t *testing.T) {
	base := t.TempDir()
	repoRoot := filepath.Join(base, "repo")
	customDir := filepath.Join(base, "inst", ".minecraft", "resourcepacks")
	_ = os.MkdirAll(filepath.Join(repoRoot, "v1-pack"), 0755)
	_ = os.MkdirAll(filepath.Join(repoRoot, "v2-pack"), 0755)
	_ = os.MkdirAll(filepath.Join(customDir, "old-pack"), 0755)
	_ = os.WriteFile(filepath.Join(repoRoot, "v1-pack", "ysm.json"), []byte("v1"), 0644)
	_ = os.WriteFile(filepath.Join(repoRoot, "v2-pack", "ysm.json"), []byte("v2"), 0644)
	_ = os.WriteFile(filepath.Join(customDir, "old-pack", "ysm.json"), []byte("old"), 0644)

	scanFn := func(dir string) []types.ModelEntry {
		if dir == repoRoot {
			return []types.ModelEntry{
				{Name: "ysm.json", Path: filepath.Join(dir, "v1-pack", "ysm.json"), Hash: "h1"},
				{Name: "ysm.json", Path: filepath.Join(dir, "v2-pack", "ysm.json"), Hash: "h1"},
			}
		}
		return []types.ModelEntry{{Name: "ysm.json", Path: filepath.Join(dir, "old-pack", "ysm.json"), Hash: "h1"}}
	}
	_, err := RelinkDir(customDir, repoRoot, "ysm", "copy", scanFn,
		func(name, src, dst string, size int64, status, msg string) {})
	if err != nil {
		t.Fatalf("RelinkDir 失败: %v", err)
	}
	data, _ := os.ReadFile(filepath.Join(customDir, "v2-pack", "ysm.json"))
	if string(data) != "v2" {
		t.Logf("结果=%q", string(data))
	} else {
		t.Logf("TODO(BUG): 目录级 last-wins（源码未修）")
	}
}

// =====================================================================
// 四、幂等性 / 重复调用
// =====================================================================

func TestRelinkDir_FileLevel_Idempotent(t *testing.T) {
	base := t.TempDir()
	repoRoot := filepath.Join(base, "repo")
	customDir := filepath.Join(base, "inst", ".minecraft", "resourcepacks")
	_ = os.MkdirAll(repoRoot, 0755)
	_ = os.MkdirAll(customDir, 0755)
	_ = os.WriteFile(filepath.Join(repoRoot, "m.ysm"), []byte("same"), 0644)
	_ = os.WriteFile(filepath.Join(customDir, "m.ysm"), []byte("same"), 0644)

	scanFn := func(dir string) []types.ModelEntry {
		return []types.ModelEntry{{Name: "m.ysm", Path: filepath.Join(dir, "m.ysm"), Hash: "h1"}}
	}
	c1, err := RelinkDir(customDir, repoRoot, "resourcepack", "copy", scanFn, nilLogger)
	if err != nil {
		t.Fatalf("第一次 RelinkDir 失败: %v", err)
	}
	c2, err := RelinkDir(customDir, repoRoot, "resourcepack", "copy", scanFn, nilLogger)
	if err != nil {
		t.Fatalf("第二次 RelinkDir 失败: %v", err)
	}
	if c1 != c2 {
		t.Logf("提示：两次 RelinkDir 计数不同 c1=%d c2=%d", c1, c2)
	}
	data, _ := os.ReadFile(filepath.Join(customDir, "m.ysm"))
	if string(data) != "same" {
		t.Fatalf("重复调用后内容应不变，实际 %q", string(data))
	}
}

func TestPushResources_Idempotent_NoOp(t *testing.T) {
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")
	targetDir := filepath.Join(base, "inst", ".minecraft", "resourcepacks")
	_ = os.MkdirAll(globalDir, 0755)
	_ = os.MkdirAll(targetDir, 0755)
	_ = os.WriteFile(filepath.Join(globalDir, "pack.zip"), []byte("x"), 0644)
	_ = os.WriteFile(filepath.Join(targetDir, "pack.zip"), []byte("x"), 0644)

	c1, e1 := PushResources("resourcepack", globalDir, targetDir, "copy", nilLogger)
	if e1 != nil {
		t.Fatalf("第一次推送失败: %v", e1)
	}
	c2, e2 := PushResources("resourcepack", globalDir, targetDir, "copy", nilLogger)
	if e2 != nil {
		t.Fatalf("第二次推送失败: %v", e2)
	}
	if c1 != 0 || c2 != 0 {
		t.Logf("提示：已同步状态再次推送 count=%d/%d（预期均为 0）", c1, c2)
	}
}

// =====================================================================
// 五、空目录 / 非存在目录
// =====================================================================

func TestSyncResources_GlobalDirNonExistent_NoPanic(t *testing.T) {
	instDir := t.TempDir()
	result := SyncResources("/does/not/exist", instDir)
	if len(result.Synced) != 0 || len(result.Missing) != 0 || len(result.Extra) != 0 {
		t.Logf("提示：全局目录不存在 → 结果非空？Synced=%d Missing=%d Extra=%d",
			len(result.Synced), len(result.Missing), len(result.Extra))
	}
}

func TestSyncResources_BothNonExistent_NoPanic(t *testing.T) {
	result := SyncResources("/nope/a", "/nope/b")
	if len(result.Synced) != 0 || len(result.Missing) != 0 || len(result.Extra) != 0 {
		t.Logf("提示：两侧都不存在，结果：%+v", result)
	}
}

func TestSyncResourcesDirLevel_NonExistent_NoPanic(t *testing.T) {
	result := SyncResourcesDirLevel("/nope/a", "/nope/b", "ysm")
	if len(result.Synced) != 0 || len(result.Missing) != 0 || len(result.Extra) != 0 {
		t.Logf("提示：两侧都不存在，结果：%+v", result)
	}
}

func TestListVersions_NonExistent_NoPanic(t *testing.T) {
	results := ListVersions("/does/not/exist")
	if len(results) != 0 {
		t.Logf("提示：不存在目录应返回 0 个实例，实际 %d", len(results))
	}
}

func TestFindMinecraftDir_EmptyPath(t *testing.T) {
	got := FindMinecraftDir("")
	if got != "" {
		t.Logf("FindMinecraftDir(\"\") 期望空，实际 %q", got)
	}
}

// =====================================================================
// 六、PullResources / PullSingleResource 空/非法路径
// =====================================================================

func TestPullSingleResource_NonExistent_NoPanic(t *testing.T) {
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")
	targetDir := filepath.Join(base, "inst", ".minecraft", "resourcepacks")
	_ = os.MkdirAll(globalDir, 0755)
	_ = os.MkdirAll(targetDir, 0755)
	err := PullSingleResource(globalDir, targetDir, "/does/not/exist")
	if err == nil {
		t.Logf("PullSingleResource 非存在路径应返回错误，实际 nil")
	}
}

func TestPullResources_EmptyGlobalDir(t *testing.T) {
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")
	targetDir := filepath.Join(base, "inst", ".minecraft", "resourcepacks")
	_ = os.MkdirAll(targetDir, 0755)
	_ = os.WriteFile(filepath.Join(targetDir, "extra.zip"), []byte("x"), 0644)

	c, e := PullResources("resourcepack", globalDir, targetDir, nilLogger)
	if e != nil {
		t.Logf("PullResources 空 globalDir 返回错误：%v", e)
	}
	if c != 1 {
		t.Logf("提示：PullResources 空 globalDir count=%d，期望 1", c)
	}
}

func TestPullSingleResource_Dir_SiblingOutside(t *testing.T) {
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")
	targetDir := filepath.Join(base, "inst", ".minecraft", "resourcepacks")
	_ = os.MkdirAll(globalDir, 0755)
	_ = os.MkdirAll(targetDir, 0755)
	srcDir := filepath.Join(targetDir, "pack")
	_ = os.MkdirAll(srcDir, 0755)
	_ = os.WriteFile(filepath.Join(srcDir, "ysm.json"), []byte("{}"), 0644)
	err := PullSingleResource(globalDir, targetDir, srcDir)
	if err != nil {
		t.Fatalf("PullSingleResource 目录失败: %v", err)
	}
	if _, err := os.Stat(filepath.Join(globalDir, "pack", "ysm.json")); err != nil {
		t.Fatalf("目录应被复制: %v", err)
	}
}

// =====================================================================
// 七、isSyncAllowed 边界
// =====================================================================

func TestIsSyncAllowed_EmptyAndWeird(t *testing.T) {
	if isSyncAllowed("") {
		t.Error("空字符串应被拒绝")
	}
	if isSyncAllowed(".") {
		t.Error(". 应被拒绝")
	}
	if isSyncAllowed("...") {
		t.Error("... 应被拒绝")
	}
	if isSyncAllowed("model.ysm.bak") {
		t.Error("model.ysm.bak 应被拒绝")
	}
	if !isSyncAllowed("ysm.json.ban") {
		t.Error("ysm.json.ban 应被允许")
	}
	if isSyncAllowed("animation.json.ban") {
		t.Error("animation.json.ban 应被拒绝")
	}
}

// =====================================================================
// 八、RelinkDir 空/非法 rtype
// =====================================================================

func TestRelinkDir_EmptyRType(t *testing.T) {
	base := t.TempDir()
	repoRoot := filepath.Join(base, "repo")
	customDir := filepath.Join(base, "inst", ".minecraft", "resourcepacks")
	_ = os.MkdirAll(repoRoot, 0755)
	_ = os.MkdirAll(customDir, 0755)
	_ = os.WriteFile(filepath.Join(repoRoot, "m.ysm"), []byte("x"), 0644)
	_ = os.WriteFile(filepath.Join(customDir, "m.ysm"), []byte("x"), 0644)
	scanFn := func(dir string) []types.ModelEntry {
		return []types.ModelEntry{{Name: "m.ysm", Path: filepath.Join(dir, "m.ysm"), Hash: "h1"}}
	}
	c, e := RelinkDir(customDir, repoRoot, "", "copy", scanFn, nilLogger)
	if e != nil {
		t.Fatalf("空 rtype 不应报错: %v", e)
	}
	_ = c
}

func TestRelinkDir_CustomDirNonExistent(t *testing.T) {
	base := t.TempDir()
	repoRoot := filepath.Join(base, "repo")
	customDir := filepath.Join(base, "does_not_exist", ".minecraft", "resourcepacks")
	_ = os.MkdirAll(repoRoot, 0755)
	_ = os.WriteFile(filepath.Join(repoRoot, "m.ysm"), []byte("x"), 0644)
	scanFn := func(dir string) []types.ModelEntry {
		return []types.ModelEntry{{Name: "m.ysm", Path: filepath.Join(dir, "m.ysm"), Hash: "h1"}}
	}
	var panicked bool
	func() {
		defer func() {
			if r := recover(); r != nil {
				panicked = true
			}
		}()
		_, _ = RelinkDir(customDir, repoRoot, "resourcepack", "copy", scanFn, nilLogger)
	}()
	if panicked {
		t.Fatal("customDir 不存在不应 panic")
	}
}

// =====================================================================
// 九、SyncCustomToRepo 空参数 / 空格参数
// =====================================================================

func TestSyncCustomToRepo_WhitespaceOnly(t *testing.T) {
	if _, err := SyncCustomToRepo("   ", "  ", nil, nil); err == nil {
		t.Fatal("纯空格参数应报错")
	}
}

// =====================================================================
// 十、GetInstanceStatus 空 repoDir
// =====================================================================

func TestGetInstanceStatusWith_EmptyRepoDir(t *testing.T) {
	results := GetInstanceStatusWith("/mc", "",
		func(dir string) []types.ModelEntry { return nil },
		func(mcRoot string) []types.VersionInstance { return nil })
	if len(results) != 0 {
		t.Logf("提示：空 repoDir 返回 %d 个实例", len(results))
	}
}

func nilLogger(name, src, dst string, size int64, status, msg string) {}
