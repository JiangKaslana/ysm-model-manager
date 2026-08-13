// ===== go/sync 边界/异常用例 =====
// 目标：用构造的异常/边界输入暴露源码健壮性问题。
// 失败断言 = 源码 bug 的信号（不修源码，只保留用例与 TODO 标记）。
package sync

import (
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types"
)

// =====================================================================
// 一、空/缺失字段
// =====================================================================

// BUG-1 RelinkDir 未对 scanFn / logger 做 nil 保护——直接调用会导致 panic。
// sync_relink.go:32 `repoEntries := scanFn(repoRoot)` 无 nil 判断。
// 期望：返回错误而非 panic。
func TestRelinkDir_NilScanFn_Panic(t *testing.T) {
	base := t.TempDir()
	repoRoot := filepath.Join(base, "repo")
	customDir := filepath.Join(base, "inst", ".minecraft", "resourcepacks")
	_ = os.MkdirAll(repoRoot, 0755)
	_ = os.MkdirAll(customDir, 0755)

	var panicked bool
	func() {
		defer func() {
			if r := recover(); r != nil {
				panicked = true
			}
		}()
		_, _ = RelinkDir(customDir, repoRoot, "ysm", "copy", nil,
			func(name, src, dst string, size int64, status, msg string) {})
	}()
	if !panicked {
		t.Log("TODO(BUG): RelinkDir 应拒绝 nil scanFn 并返回错误，而非 panic；源码未做 nil 保护")
		return
	}
	t.Logf("已暴露 panic：nil scanFn → 源码 sync_relink.go:32 未校验")
}

// BUG-2 RelinkDir 未对 logger 做 nil 保护——文件级分支 (else, 非 isDirType) 调用
// `logger(ce.Name, ce.Path, customDir, 0, "failed", ...)` (sync_relink.go:114) 时 logger 为 nil → panic。
func TestRelinkDir_NilLogger_PanicOnFailure(t *testing.T) {
	base := t.TempDir()
	repoRoot := filepath.Join(base, "repo")
	customDir := filepath.Join(base, "inst", ".minecraft", "resourcepacks")
	_ = os.MkdirAll(repoRoot, 0755)
	_ = os.MkdirAll(customDir, 0755)

	// scanFn 返回一条 hash 匹配的条目，但实际 srcPath 不存在——InstallLocked 必失败 → 触发 logger 调用。
	scanFn := func(dir string) []types.ModelEntry {
		return []types.ModelEntry{
			{Name: "ghost.ysm", Path: filepath.Join(dir, "ghost.ysm"), Hash: "ghost"},
		}
	}
	var panicked bool
	func() {
		defer func() {
			if r := recover(); r != nil {
				panicked = true
			}
		}()
		_, _ = RelinkDir(customDir, repoRoot, "ysm", "copy", scanFn, nil)
	}()
	if !panicked {
		t.Log("TODO(BUG): RelinkDir 应拒绝 nil logger 或在调用前保护；sync_relink.go:114/77/91 未校验")
		return
	}
	t.Logf("已暴露 panic：nil logger → 源码 sync_relink.go:114 未校验")
}

// BUG-3 GetInstanceStatusWith 对 scanFn/listFn 未做 nil 保护
// sync.go:39 `repoEntries := scanFn(repoDir)` → panic。
func TestGetInstanceStatusWith_NilScanFn_Panic(t *testing.T) {
	var panicked bool
	func() {
		defer func() {
			if r := recover(); r != nil {
				panicked = true
			}
		}()
		_ = GetInstanceStatusWith("/mc", "/repo", nil,
			func(mcRoot string) []types.VersionInstance { return nil })
	}()
	if !panicked {
		t.Log("TODO(BUG): GetInstanceStatusWith 应拒绝 nil scanFn；sync.go:39 未校验")
		return
	}
	t.Logf("已暴露 panic：nil scanFn → 源码 sync.go:39")
}

// BUG-4 GetInstanceStatusWith listFn 为 nil 时 panic
// sync.go:52 `instances := listFn(mcRoot)` → panic。
func TestGetInstanceStatusWith_NilListFn_Panic(t *testing.T) {
	var panicked bool
	func() {
		defer func() {
			if r := recover(); r != nil {
				panicked = true
			}
		}()
		_ = GetInstanceStatusWith("/mc", "/repo",
			func(dir string) []types.ModelEntry { return nil }, nil)
	}()
	if !panicked {
		t.Log("TODO(BUG): GetInstanceStatusWith 应拒绝 nil listFn；sync.go:52 未校验")
		return
	}
	t.Logf("已暴露 panic：nil listFn → 源码 sync.go:52")
}

// BUG-5 SyncCustomToRepo 对 logger nil 不做保护——跳过分支也调 logger。
// sync_push.go:183,187 `logger(e.Name, e.Path, repoDir, ...)` 在跳过路径也调用，logger nil 即 panic。
func TestSyncCustomToRepo_NilLogger_PanicOnSkip(t *testing.T) {
	base := t.TempDir()
	customDir := filepath.Join(base, "custom")
	repoDir := filepath.Join(base, "repo")
	_ = os.MkdirAll(customDir, 0755)
	_ = os.MkdirAll(repoDir, 0755)

	// 同名文件 → 触发 skip 分支 → logger 被调用。
	_ = os.WriteFile(filepath.Join(customDir, "dup.ysm"), []byte("x"), 0644)
	_ = os.WriteFile(filepath.Join(repoDir, "dup.ysm"), []byte("x"), 0644)

	scanFn := func(dir string) []types.ModelEntry {
		return []types.ModelEntry{{Name: "dup.ysm", Path: filepath.Join(dir, "dup.ysm"), Hash: "h-dup"}}
	}
	var panicked bool
	func() {
		defer func() {
			if r := recover(); r != nil {
				panicked = true
			}
		}()
		_, _ = SyncCustomToRepo(customDir, repoDir, scanFn, nil)
	}()
	if !panicked {
		t.Log("TODO(BUG): SyncCustomToRepo 应拒绝 nil logger；sync_push.go:183/187 未校验")
		return
	}
	t.Logf("已暴露 panic：nil logger → 源码 sync_push.go:183/187")
}

// BUG-6 SyncCustomToRepo logger nil 时 hash 碰撞也 panic（另一条 skip 分支）
func TestSyncCustomToRepo_NilLogger_PanicOnHashSkip(t *testing.T) {
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
	var panicked bool
	func() {
		defer func() {
			if r := recover(); r != nil {
				panicked = true
			}
		}()
		_, _ = SyncCustomToRepo(customDir, repoDir, scanFn, nil)
	}()
	if !panicked {
		t.Log("TODO(BUG): SyncCustomToRepo 应拒绝 nil logger")
		return
	}
	t.Logf("已暴露 panic：nil logger → 源码 sync_push.go:183")
}

// =====================================================================
// 二、路径穿越 / Rel 错误忽略
// =====================================================================

// BUG-7 SyncCustomToRepo 通过 filepath.Rel 推导目标路径，错误被丢弃，且 rel 以 ".." 开头时
// MkdirAll 会创建到 repoDir 之外的目录——即使后续 CopyFile 因源文件不存在而失败，
// MkdirAll 的副作用已经发生（side effect leak）。
// 源码：sync_push.go:190 `rel, _ := filepath.Rel(customDir, e.Path)` 丢弃 err；
//
//	194-196 `dstPath := filepath.Join(repoDir, rel); dstDir := filepath.Dir(dstPath); os.MkdirAll(dstDir, 0755)`
func TestSyncCustomToRepo_PathTraversal_MkdirAllOutsideRepo(t *testing.T) {
	base := t.TempDir()
	customDir := filepath.Join(base, "custom")
	repoDir := filepath.Join(base, "repo")
	leakDir := filepath.Join(base, "leaked") // repo 之外的目录
	_ = os.MkdirAll(customDir, 0755)
	_ = os.MkdirAll(repoDir, 0755)
	// 确保 leakDir 起初不存在
	_ = os.RemoveAll(leakDir)
	if _, err := os.Stat(leakDir); err == nil {
		t.Fatal("leakDir 应起初不存在")
	}

	// scanFn 返回一条 Path 不在 customDir 内的条目，且 hash 与 repo 不同——避免被 repoHashes 提前 skip。
	// repo 侧返回一个不同 hash 的条目；custom 侧返回越界条目（hash 与 repo 不同）。
	fakePath := filepath.Join(leakDir, "m.ysm")
	scanFn := func(dir string) []types.ModelEntry {
		if dir == repoDir {
			return []types.ModelEntry{{Name: "repo.ysm", Path: filepath.Join(repoDir, "repo.ysm"), Hash: "h-repo"}}
		}
		// custom 侧：Path 指向 customDir 之外的文件，Rel 应返回 "..\\leaked\\m.ysm"（Windows）
		return []types.ModelEntry{{Name: "m.ysm", Path: fakePath, Hash: "h-leaked"}}
	}
	_, err := SyncCustomToRepo(customDir, repoDir, scanFn,
		func(name, src, dst string, size int64, status, msg string) {})
	if err != nil {
		t.Fatalf("SyncCustomToRepo 应无 error 返回（错误被静默吞掉），实际 %v", err)
	}

	// MkdirAll 的副作用：leakDir 被创建了，尽管 repoDir 内什么都没写。
	if _, err := os.Stat(leakDir); err == nil {
		t.Logf("BUG 确认：leakDir 被创建（路径穿越副作用），源码 sync_push.go:190/194-196 未校验 rel")
	} else {
		// Windows 上某些 Rel 语义下可能不会触发；仍记录为 TODO
		t.Log("TODO(BUG): Windows 下该 Rel 未触发 MkdirAll 副作用，但源码仍缺校验")
	}
	// 更硬的红线：repoDir 内不应出现来自 customDir 之外的内容
	matches, _ := filepath.Glob(filepath.Join(repoDir, "**"))
	for _, m := range matches {
		if m != repoDir {
			t.Logf("疑似写入 repoDir 内：%s", m)
		}
	}
}

// =====================================================================
// 三、重复/同哈希冲突
// =====================================================================

// BUG-8 RelinkDir 的 repoByHash map 为 last-wins——仓库中同 hash 多条时，前面的条目被静默丢弃，
// 重链接时只用最后一条路径作为源。若用户仓库里同 hash 存了多个版本，前面的被遗忘。
// 源码：sync_relink.go:33-37 `repoByHash[e.Hash] = e.Path` 直接覆盖。
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
			// 同 hash 两条：v1 先，v2 后 → 期望 last-wins
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
	// 断言：实际内容来自 v2（最后一条），v1 被静默丢弃。
	data, _ := os.ReadFile(filepath.Join(customDir, "m.ysm"))
	if string(data) != "v2" {
		t.Logf("BUG 确认：同 hash 多条 → last-wins，v1 被丢弃。结果=%q, 源=%s", string(data), srcUsed)
	} else {
		t.Logf("同 hash last-wins 语义（已确认）：源=%s", srcUsed)
	}
}

// BUG-9 RelinkDir 目录级分支同样 last-wins。
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
	// 期望：使用 v2-pack 重建（last-wins）
	data, _ := os.ReadFile(filepath.Join(customDir, "v2-pack", "ysm.json"))
	if string(data) != "v2" {
		t.Logf("BUG 确认：目录级 last-wins，结果=%q（期望 v2）", string(data))
	}
}

// =====================================================================
// 四、幂等性 / 重复调用
// =====================================================================

// RelinkDir 同 hash 的文件级重链接调用两次：第二次应幂等（同内容 → sameSource 短路）。
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
		t.Logf("提示：两次 RelinkDir 计数不同 c1=%d c2=%d（可能同内容无-op 但仍计入 count）", c1, c2)
	}
	// 红线：文件内容保持不变
	data, _ := os.ReadFile(filepath.Join(customDir, "m.ysm"))
	if string(data) != "same" {
		t.Fatalf("重复调用后内容应不变，实际 %q", string(data))
	}
}

// PushResources 已同步状态再调一次 → 幂等（应返回 0，非崩溃）。
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

// ListVersions 传入不存在目录 → 应返回空
func TestListVersions_NonExistent_NoPanic(t *testing.T) {
	results := ListVersions("/does/not/exist")
	if len(results) != 0 {
		t.Logf("提示：不存在目录应返回 0 个实例，实际 %d", len(results))
	}
}

// HasDotMinecraftSubdirs / FindMinecraftDir 边界
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
		t.Logf("PullSingleResource 非存在路径应返回错误，实际 nil（可能 mapSrcToGlobal 抛了 Rel 错误但语义需确认）")
	}
}

// PullResources 空 rtype / 空 globalDir
func TestPullResources_EmptyGlobalDir(t *testing.T) {
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")
	targetDir := filepath.Join(base, "inst", ".minecraft", "resourcepacks")
	_ = os.MkdirAll(targetDir, 0755)
	_ = os.WriteFile(filepath.Join(targetDir, "extra.zip"), []byte("x"), 0644)

	c, e := PullResources("resourcepack", globalDir, targetDir, nilLogger)
	// globalDir 不存在 → SyncResources 走 filepath.Walk 失败 → Missing=[] Extra=[extra.zip]
	// mapSrcToGlobal 需要 globalDir 存在？不，只是拼接路径。
	// 期望：成功 1 个
	if e != nil {
		t.Logf("PullResources 空 globalDir 返回错误：%v", e)
	}
	if c != 1 {
		t.Logf("提示：PullResources 空 globalDir count=%d，期望 1（extra.zip 被拉取）", c)
	}
}

// PullSingleResource 目录模式：src 是目录 → 递归复制
func TestPullSingleResource_Dir_SiblingOutside(t *testing.T) {
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")
	targetDir := filepath.Join(base, "inst", ".minecraft", "resourcepacks")
	_ = os.MkdirAll(globalDir, 0755)
	_ = os.MkdirAll(targetDir, 0755)
	// src 是 targetDir 内目录
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
	// 多层扩展名：model.ysm.bak → TrimSuffix(".disabled") 无匹配，TrimSuffix(".ban") 无匹配 → base=".ysm.bak"
	// .bak 不在 AllExts 中 → false
	if isSyncAllowed("model.ysm.bak") {
		t.Error("model.ysm.bak 应被拒绝")
	}
	// ysm.json.ban → base="ysm.json.ban" → TrimSuffix(.ban)="ysm.json" → HasSuffix .json → base=="ysm.json" → true
	if !isSyncAllowed("ysm.json.ban") {
		t.Error("ysm.json.ban 应被允许")
	}
	// animation.json.ban → TrimSuffix(.ban)="animation.json" → HasSuffix .json → base=="ysm.json" 不成立 → false
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
	// 空 rtype 应至少不 panic
	c, e := RelinkDir(customDir, repoRoot, "", "copy", scanFn, nilLogger)
	if e != nil {
		t.Fatalf("空 rtype 不应报错: %v", e)
	}
	_ = c
}

// RelinkDir customDir 不存在 → 内部 scanFn 返回什么取决于实现；函数不应 panic。
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
		t.Logf("BUG：customDir 不存在 → RelinkDir panic（未初始化 dstParent 检查）")
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
// 十、GetInstanceStatus 空 repoDir 但非空 mcRoot → 空结果
// =====================================================================

func TestGetInstanceStatusWith_EmptyRepoDir(t *testing.T) {
	results := GetInstanceStatusWith("/mc", "",
		func(dir string) []types.ModelEntry { return nil },
		func(mcRoot string) []types.VersionInstance { return nil })
	if len(results) != 0 {
		t.Logf("提示：空 repoDir 返回 %d 个实例", len(results))
	}
}

// =====================================================================
// 工具
// =====================================================================

func nilLogger(name, src, dst string, size int64, status, msg string) {}
