package sync

import (
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"testing"

	"ysm-model-manager/go/scanner"
)

// TestCollectEntriesFromScanEqualsWalk 锁定 collectEntriesFromScan 与 collectEntriesWalk
// 语义等价，覆盖 Walk 的 SkipDir 三种情形：根级平铺文件、叶子模型文件夹、容器模型文件夹
// （直接含模型文件 + 子模型文件夹）。防止「复用扫描缓存」性能修复引入同步条目漂移。
func TestCollectEntriesFromScanEqualsWalk(t *testing.T) {
	root := t.TempDir()
	// 根级平铺模型文件（恒登记）
	mustWrite(t, filepath.Join(root, "solo.pmx"), "x")
	// 非模型文件（应被忽略）
	mustWrite(t, filepath.Join(root, "readme.txt"), "x")
	// 叶子模型文件夹：内含 model.pmx，自身作为整体单元（内部文件不登记）
	mkdir(t, filepath.Join(root, "leaf_pack"))
	mustWrite(t, filepath.Join(root, "leaf_pack", "model.pmx"), "x")
	// 容器模型文件夹：直接含 model.pmx + 子模型文件夹 sub（自身与子夹均登记、内部文件登记）
	mkdir(t, filepath.Join(root, "container"))
	mustWrite(t, filepath.Join(root, "container", "model.pmx"), "x")
	mkdir(t, filepath.Join(root, "container", "sub"))
	mustWrite(t, filepath.Join(root, "container", "sub", "model2.pmx"), "x")

	rtype := "EntityPlayer" // 无嵌套模式，走 scan 反推路径

	walkMap := collectEntriesWalk(root, rtype)
	if len(walkMap) == 0 {
		t.Fatalf("walkMap 为空：测试树未产生任何模型条目，请检查 rtype=%s 的扩展名配置", rtype)
	}
	scanEntries, _ := scanner.ScanEntriesWithHit(root)
	scanMap := collectEntriesFromScan(scanEntries, root, rtype)
	if scanMap == nil {
		t.Fatalf("collectEntriesFromScan 返回 nil（rtype=%s 不应回退 Walk）", rtype)
	}
	if !reflect.DeepEqual(walkMap, scanMap) {
		t.Errorf("collectEntriesFromScan 与 Walk 结果不一致\nWalk: %v\nScan: %v", walkMap, scanMap)
	}
}

// TestSyncResourcesDirLevelScanMatchesWalk 端到端：对同一目录自比（global==instance），
// 注入 scanFn 与 Walk 两种实现应给出相同的 Synced 条目集合。
func TestSyncResourcesDirLevelScanMatchesWalk(t *testing.T) {
	root := t.TempDir()
	mkdir(t, filepath.Join(root, "leaf_pack"))
	mustWrite(t, filepath.Join(root, "leaf_pack", "model.pmx"), "x")
	mkdir(t, filepath.Join(root, "container"))
	mustWrite(t, filepath.Join(root, "container", "model.pmx"), "x")
	mkdir(t, filepath.Join(root, "container", "sub"))
	mustWrite(t, filepath.Join(root, "container", "sub", "model2.pmx"), "x")
	mustWrite(t, filepath.Join(root, "solo.pmx"), "x")

	rtype := "EntityPlayer"
	walkRes := SyncResourcesDirLevel(root, root, rtype)
	scanRes := SyncResourcesDirLevelScan(root, root, rtype, scanner.ScanEntriesWithHit)
	if !equalStringSlice(walkRes.Synced, scanRes.Synced) {
		t.Errorf("Synced 不一致\nWalk: %v\nScan: %v", walkRes.Synced, scanRes.Synced)
	}
}

func mustWrite(t *testing.T, p, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func mkdir(t *testing.T, p string) {
	t.Helper()
	if err := os.MkdirAll(p, 0o755); err != nil {
		t.Fatal(err)
	}
}

func equalStringSlice(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	sa := append([]string(nil), a...)
	sb := append([]string(nil), b...)
	sort.Strings(sa)
	sort.Strings(sb)
	for i := range sa {
		if sa[i] != sb[i] {
			return false
		}
	}
	return true
}
