package dedup

import (
	"errors"
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"ysm-model-manager/go/internal/testutil"
)

// pathsOf 取组内文件路径列表（断言排序用）
func pathsOf(files []FileEntry) []string {
	paths := make([]string, len(files))
	for i, f := range files {
		paths[i] = f.Path
	}
	return paths
}

// buildParallelFixture 构造越过并行管道的大文件集：
// 200 个唯一文件 + 3 组重复（每组 3 副本，内容不同）。
// 遍历按文件名词法序：dupA_* < dupB_* < dupC_* < unique_*，
// 故组顺序应为 A → B → C（hash 首次出现顺序，ADR-119 确定性）。
func buildParallelFixture(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	for i := 0; i < 200; i++ {
		testutil.CreateTestFile(t, dir, fmt.Sprintf("unique_%04d.txt", i), fmt.Sprintf("unique-content-%d", i))
	}
	dups := []struct{ name, content string }{
		{"dupA_1.txt", "AAA"}, {"dupA_2.txt", "AAA"}, {"dupA_3.txt", "AAA"},
		{"dupB_1.txt", "BBB"}, {"dupB_2.txt", "BBB"}, {"dupB_3.txt", "BBB"},
		{"dupC_1.txt", "CCC"}, {"dupC_2.txt", "CCC"}, {"dupC_3.txt", "CCC"},
	}
	for _, d := range dups {
		testutil.CreateTestFile(t, dir, d.name, d.content)
	}
	return dir
}

// 并行管道正确性 + 确定性：大文件集下组顺序=首次出现序、组内路径有序（ADR-119）
func TestFindDuplicateFiles_ParallelLarge(t *testing.T) {
	dir := buildParallelFixture(t)
	groups, err := FindDuplicateFiles(dir, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(groups) != 3 {
		t.Fatalf("期望 3 组重复，got %d", len(groups))
	}
	// 组顺序 = 首次出现序：A → B → C；组内按 Path 排序（确定性）
	wantFirsts := []string{"dupA_1.txt", "dupB_1.txt", "dupC_1.txt"}
	for i, g := range groups {
		if len(g.Files) != 3 {
			t.Fatalf("组 %d 应 3 副本，got %d", i, len(g.Files))
		}
		if got := filepath.Base(g.Files[0].Name); got != wantFirsts[i] {
			t.Fatalf("组 %d 首文件应为 %s，got %s（组顺序=首次出现序被破坏）", i, wantFirsts[i], got)
		}
		if !sort.StringsAreSorted(pathsOf(g.Files)) {
			t.Fatalf("组 %d 内路径未排序: %v", i, pathsOf(g.Files))
		}
	}
}

// P1 共享管道：CountDuplicates 与 FindDuplicateFiles 必须消费同一批结果，
// 计数与分组推导完全一致（禁止双实现漂移）。
func TestCountDuplicates_ParallelConsistency(t *testing.T) {
	dir := buildParallelFixture(t)
	groups, err := FindDuplicateFiles(dir, true)
	if err != nil {
		t.Fatal(err)
	}
	gCount, extra, err := CountDuplicates(dir, true)
	if err != nil {
		t.Fatal(err)
	}
	if gCount != len(groups) {
		t.Fatalf("CountDuplicates 组数=%d 应等于 FindDuplicateFiles 组数=%d", gCount, len(groups))
	}
	var wantExtra int
	for _, g := range groups {
		wantExtra += len(g.Files) - 1
	}
	if extra != wantExtra {
		t.Fatalf("extra=%d 应等于 ∑(副本-1)=%d", extra, wantExtra)
	}
}

// P3 并行模式下部分文件读失败：该文件 log-and-skip（不进入任何组），
// 其余同内容文件仍正确成组（与串行 log-and-skip 语义一致）。
func TestFindDuplicateFiles_ReadFailureSkipped(t *testing.T) {
	dir := t.TempDir()
	testutil.CreateTestFile(t, dir, "a.txt", "same")
	testutil.CreateTestFile(t, dir, "b.txt", "same")
	testutil.CreateTestFile(t, dir, "c.txt", "same")

	old := computeHash
	t.Cleanup(func() { computeHash = old })
	computeHash = func(path string) (string, error) {
		if strings.HasSuffix(path, "c.txt") {
			return "", errors.New("injected read failure")
		}
		return realComputeHash(path)
	}

	groups, err := FindDuplicateFiles(dir, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(groups) != 1 {
		t.Fatalf("期望 1 组（a/b 成组，c 读失败跳过），got %d", len(groups))
	}
	if len(groups[0].Files) != 2 {
		t.Fatalf("组内应 2 副本（c 被跳过），got %d", len(groups[0].Files))
	}
	for _, f := range groups[0].Files {
		if strings.HasSuffix(f.Path, "c.txt") {
			t.Fatal("读失败的文件不应出现在结果中")
		}
	}
	// 并行管道不留幽灵槽：CountDuplicates 同样跳过读失败文件
	gCount, extra, err := CountDuplicates(dir, true)
	if err != nil {
		t.Fatal(err)
	}
	if gCount != 1 || extra != 1 {
		t.Fatalf("CountDuplicates 应 1 组 1 多余（c 跳过），got groups=%d extra=%d", gCount, extra)
	}
}
