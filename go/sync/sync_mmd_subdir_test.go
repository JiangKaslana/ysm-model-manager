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
