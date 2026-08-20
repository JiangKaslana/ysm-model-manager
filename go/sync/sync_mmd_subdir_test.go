package sync

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types"
)

func TestZZMmdSubdirMapping(t *testing.T) {
	base := t.TempDir()
	globalDir := filepath.Join(base, "mmd")
	targetDir := filepath.Join(base, "inst", ".minecraft", "3d-skin")
	_ = os.MkdirAll(targetDir, 0755)

	// 仓库按 MC-MMD 子目录组织
	ep := filepath.Join(globalDir, "EntityPlayer", "角色A")
	_ = os.MkdirAll(ep, 0755)
	_ = os.WriteFile(filepath.Join(ep, "model.pmx"), []byte("pmx"), 0644)
	_ = os.WriteFile(filepath.Join(ep, "anims", "walk.vmd"), []byte("vmd"), 0644)
	sc := filepath.Join(globalDir, "SceneModel", "场景1")
	_ = os.MkdirAll(sc, 0755)
	_ = os.WriteFile(filepath.Join(sc, "model.pmx"), []byte("pmx"), 0644)
	ca := filepath.Join(globalDir, "CustomAnim")
	_ = os.MkdirAll(ca, 0755)
	_ = os.WriteFile(filepath.Join(ca, "walk.vmd"), []byte("vmd"), 0644)

	// Debug: check what SyncResourcesDirLevel returns
	t.Logf("IsSubDirGrouping(mmd-skin) = %v", types.IsSubDirGrouping("mmd-skin"))
	t.Logf("IsMMDSubDir(EntityPlayer) = %v", types.IsMMDSubDir("EntityPlayer"))
	t.Logf("IsMMDSubDir(entityplayer) = %v", types.IsMMDSubDir("entityplayer"))
	t.Logf("IsMMDSubDir(CustomAnim) = %v", types.IsMMDSubDir("CustomAnim"))
	dirResult := SyncResourcesDirLevel(globalDir, targetDir, "mmd-skin")
	t.Logf("Missing: %v", dirResult.Missing)
	t.Logf("Synced: %v", dirResult.Synced)
	t.Logf("Extra: %v", dirResult.Extra)

	// Debug: list files in globalDir
	filepath.Walk(globalDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		t.Logf("globalDir walk: %s (dir=%v)", path, info.IsDir())
		return nil
	})

	count, err := PushResources("mmd-skin", globalDir, targetDir, "copy",
		func(name, src, dst string, size int64, status, msg string) { t.Logf("logger: %s | %s", name, msg) })
	t.Logf("count=%d err=%v", count, err)

	// Debug: list files in targetDir
	filepath.Walk(targetDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		t.Logf("targetDir walk: %s (dir=%v)", path, info.IsDir())
		return nil
	})

	if err != nil {
		t.Fatalf("Push failed: %v", err)
	}
	// 落位断言：保留 EntityPlayer/SceneModel/CustomAnim 层级
	checks := map[string]string{
		"EntityPlayer": "EntityPlayer/角色A/model.pmx",
		"SceneModel":   "SceneModel/场景1/model.pmx",
		"CustomAnim":   "CustomAnim/walk.vmd",
	}
	for name, rel := range checks {
		fullPath := filepath.Join(targetDir, rel)
		if _, err := os.Stat(fullPath); err != nil {
			t.Errorf("%s 未正确落位到 %s: %v", name, rel, err)
		}
	}
	// 确认没有展平到 3d-skin/角色A（丢 EntityPlayer 层）
	flattenedPath := filepath.Join(targetDir, "角色A", "model.pmx")
	if _, err := os.Stat(flattenedPath); err == nil {
		t.Error(fmt.Sprintf("不应展平到 3d-skin/角色A（丢 EntityPlayer 层），但文件存在于: %s", flattenedPath))
	}
}

// TestMmdSubdirInternalModels 子类目录内部模型作为「带前缀同步单元」（ADR-096 完整对齐）：
// globalDir = group 根（mmd），EntityPlayer 内部模型 → key=entityplayer/角色a，
// CustomAnim 内部平铺 vmd → key=customanim/walk；missing/synced 都保留子类层级；
// 子类目录本身不作为单元（避免「目录存在即已同步」假象，也避免 push 整目录与内部模型重复）。
func TestMmdSubdirInternalModels(t *testing.T) {
	base := t.TempDir()
	globalDir := filepath.Join(base, "mmd") // group 根
	targetDir := filepath.Join(base, "inst", ".minecraft", "3d-skin")
	_ = os.MkdirAll(targetDir, 0755)

	// 仓库侧（group 根下平铺子类目录）
	ep := filepath.Join(globalDir, "EntityPlayer")
	_ = os.MkdirAll(filepath.Join(ep, "角色A"), 0755)
	_ = os.WriteFile(filepath.Join(ep, "角色A", "a.pmx"), []byte("a"), 0644)
	_ = os.MkdirAll(filepath.Join(ep, "角色B"), 0755)
	_ = os.WriteFile(filepath.Join(ep, "角色B", "b.pmx"), []byte("b"), 0644)
	ca := filepath.Join(globalDir, "CustomAnim")
	_ = os.MkdirAll(ca, 0755)
	_ = os.WriteFile(filepath.Join(ca, "walk.vmd"), []byte("v"), 0644)

	// 整合包侧：已有 EntityPlayer/角色A（synced），无 角色B / CustomAnim
	tep := filepath.Join(targetDir, "EntityPlayer")
	_ = os.MkdirAll(filepath.Join(tep, "角色A"), 0755)
	_ = os.WriteFile(filepath.Join(tep, "角色A", "a.pmx"), []byte("a"), 0644)

	res := SyncResourcesDirLevel(globalDir, targetDir, "mmd-skin")
	contains := func(list []string, want string) bool {
		for _, p := range list {
			if p == want {
				return true
			}
		}
		return false
	}
	wantSynced := filepath.Join(globalDir, "EntityPlayer", "角色A")
	wantMissing1 := filepath.Join(globalDir, "EntityPlayer", "角色B")
	wantMissing2 := filepath.Join(globalDir, "CustomAnim", "walk.vmd")
	if !contains(res.Synced, wantSynced) {
		t.Fatalf("角色A 应 Synced（带子类前缀）: %v", res.Synced)
	}
	if !contains(res.Missing, wantMissing1) {
		t.Fatalf("角色B 应 Missing（带子类前缀）: %v", res.Missing)
	}
	if !contains(res.Missing, wantMissing2) {
		t.Fatalf("walk.vmd 应 Missing（CustomAnim 前缀）: %v", res.Missing)
	}
	// 子类目录本身（EntityPlayer/CustomAnim）不应作为同步单元
	for _, p := range append(append([]string{}, res.Synced...), res.Missing...) {
		if filepath.Clean(p) == filepath.Clean(ep) || filepath.Clean(p) == filepath.Clean(ca) {
			t.Fatalf("子类目录本身不应作为同步单元: %s", p)
		}
	}
}

// TestMmdSubdirPushPullPreserve 子类内部模型 push/pull 落位保留 EntityPlayer/CustomAnim 层级：
// push 后 3d-skin/EntityPlayer/角色A + 3d-skin/CustomAnim/walk.vmd（不展平）；
// pull 后 mmd/SceneModel/场景2（整合包 extra 带回仓库子类层级）。
func TestMmdSubdirPushPullPreserve(t *testing.T) {
	base := t.TempDir()
	globalDir := filepath.Join(base, "mmd")
	targetDir := filepath.Join(base, "inst", ".minecraft", "3d-skin")
	_ = os.MkdirAll(targetDir, 0755)

	// 仓库：EntityPlayer/角色A + CustomAnim/walk.vmd
	ep := filepath.Join(globalDir, "EntityPlayer")
	_ = os.MkdirAll(filepath.Join(ep, "角色A"), 0755)
	_ = os.WriteFile(filepath.Join(ep, "角色A", "a.pmx"), []byte("a"), 0644)
	ca := filepath.Join(globalDir, "CustomAnim")
	_ = os.MkdirAll(ca, 0755)
	_ = os.WriteFile(filepath.Join(ca, "walk.vmd"), []byte("v"), 0644)

	count, err := PushResources("mmd-skin", globalDir, targetDir, "copy",
		func(name, src, dst string, size int64, status, msg string) {})
	if err != nil {
		t.Fatalf("Push 失败: %v", err)
	}
	if count != 2 {
		t.Fatalf("应推送 2 个单元（角色A 目录 + walk.vmd 文件），实际 %d", count)
	}
	if _, err := os.Stat(filepath.Join(targetDir, "EntityPlayer", "角色A", "a.pmx")); err != nil {
		t.Fatalf("角色A 应落位 3d-skin/EntityPlayer/角色A: %v", err)
	}
	if _, err := os.Stat(filepath.Join(targetDir, "CustomAnim", "walk.vmd")); err != nil {
		t.Fatalf("walk.vmd 应落位 3d-skin/CustomAnim/walk.vmd: %v", err)
	}
	if _, err := os.Stat(filepath.Join(targetDir, "角色A", "a.pmx")); err == nil {
		t.Fatal("角色A 不应展平到 3d-skin/角色A（丢 EntityPlayer 层）")
	}

	// 整合包侧新增 SceneModel/场景2（extra）→ Pull 回仓库 mmd/SceneModel/场景2
	sm := filepath.Join(targetDir, "SceneModel", "场景2")
	_ = os.MkdirAll(sm, 0755)
	_ = os.WriteFile(filepath.Join(sm, "s.pmx"), []byte("s"), 0644)
	count2, err := PullResources("mmd-skin", globalDir, targetDir,
		func(name, src, dst string, size int64, status, msg string) {})
	if err != nil {
		t.Fatalf("Pull 失败: %v", err)
	}
	if count2 != 1 {
		t.Fatalf("应拉取 1 个（SceneModel/场景2），实际 %d", count2)
	}
	if _, err := os.Stat(filepath.Join(globalDir, "SceneModel", "场景2", "s.pmx")); err != nil {
		t.Fatalf("场景2 应落位 mmd/SceneModel/场景2: %v", err)
	}
}
