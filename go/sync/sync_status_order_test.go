// ===== Missing 列表确定性契约（map 迭代序不得泄漏到输出）=====
// repoByHash / repoByRelKey 为 map，Go 运行时故意随机化迭代序；
// 未排序时 status.Missing 每次调用顺序不同，UI 列表刷新跳动。
package sync

import (
	"fmt"
	"sort"
	"testing"

	"ysm-model-manager/go/types"
)

func TestGetInstanceStatusWith_MissingSortedDeterministic(t *testing.T) {
	const n = 30 // 足够多使 map 桶序与插入序显著偏离
	repoEntries := make([]types.ModelEntry, 0, n)
	for i := n - 1; i >= 0; i-- { // 故意逆序构造
		repoEntries = append(repoEntries, types.ModelEntry{
			Name: fmt.Sprintf("model_%02d.ysm", i),
			Path: fmt.Sprintf("/repo/model_%02d.ysm", i),
			Hash: fmt.Sprintf("hash_%02d", i),
			Size: int64(1000 + i),
		})
	}
	scanFn := mockScanDir("/repo", repoEntries, nil)
	results := GetInstanceStatusWith("/mc", "/repo", "", scanFn, mockListVersions)
	if len(results) != 1 {
		t.Fatalf("expected 1 instance, got %d", len(results))
	}
	got := results[0].Missing
	if len(got) != n {
		t.Fatalf("expected %d missing, got %d", n, len(got))
	}
	if !sort.StringsAreSorted(got) {
		t.Fatalf("Missing 应按字典序确定输出，实际: %v", got)
	}
}

func TestGetInstanceStatusWith_MissingSortedRelKeyPath(t *testing.T) {
	// relKey 回退路径（无哈希）同样受 map 迭代序影响
	repoEntries := []types.ModelEntry{
		{Name: "zeta.mmd", Path: "/repo/zeta.mmd"},
		{Name: "alpha.mmd", Path: "/repo/alpha.mmd"},
		{Name: "mid.mmd", Path: "/repo/mid.mmd"},
	}
	scanFn := mockScanDir("/repo", repoEntries, nil)
	results := GetInstanceStatusWith("/mc", "/repo", "", scanFn, mockListVersions)
	if len(results) != 1 {
		t.Fatalf("expected 1 instance, got %d", len(results))
	}
	if !sort.StringsAreSorted(results[0].Missing) {
		t.Fatalf("relKey 路径 Missing 也应有序，实际: %v", results[0].Missing)
	}
}
