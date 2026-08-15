// Package dedup 提供文件去重检测——纯函数，不绑定回收站或任何 UI
package dedup

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"ysm-model-manager/go/fsutil"
)

// ErrSymlinkRoot 扫描根目录自身是符号链接——去重只处理实际文件，符号链接根
// 会导致「假绿」（静默返回无重复但实际未扫描到目标树）。调用方应以 errors.Is 判定，
// 禁止 strings.Contains(err.Error(), ...) 文本匹配（陷阱 #11 错误分类）。
var ErrSymlinkRoot = errors.New("dedup: 扫描根目录是符号链接")

// FileEntry 文件条目
type FileEntry struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	Size    int64  `json:"size"`
	ModTime int64  `json:"modTime"`
}

// Group 重复文件分组
type Group struct {
	Hash  string      `json:"hash"`  // SHA256
	Size  int64       `json:"size"`  // 单文件大小
	Files []FileEntry `json:"files"` // 文件列表
}

// walkHashedFiles 遍历目录树，对每个非空普通文件计算 SHA256 后回调
// (hash, path, size, modTime)。共用遍历（收敛 FindDuplicateFiles 与 CountDuplicates
// 两份逐字重复的 WalkDir 逻辑，索引 6.8a）：
//   - 跳过符号链接（根本身是符号链接时返回 ErrSymlinkRoot——静默返回「无重复」= 假绿，
//     陷阱 #11：sentinel + errors.Is 判定，禁文本匹配）；
//   - 跳过目录（skipRecycle 时回收站目录 SkipDir，统一走 fsutil.IsRecycleDir）；
//   - 跳过空文件（不同用途的空文件不是重复文件）。
//
// 回调返回 nil 继续遍历，非 nil 中止并透传该错误。
func walkHashedFiles(dir string, skipRecycle bool, fn func(hash, path string, size int64, modTime int64) error) error {
	err := filepath.WalkDir(dir, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			log.Printf("[dedup] 访问 %s 失败: %v", p, err)
			return nil
		}
		// 跳过符号链接（去重只处理实际文件）
		if d.Type()&os.ModeSymlink != 0 {
			if p == dir {
				return fmt.Errorf("%w: %s", ErrSymlinkRoot, dir)
			}
			return nil
		}
		if d.IsDir() {
			// ADR-044 策略 A：回收站排除统一走 fsutil.IsRecycleDir（EqualFold 大小写不敏感）
			if skipRecycle && fsutil.IsRecycleDir(p) {
				return filepath.SkipDir
			}
			return nil
		}

		// 只处理普通文件
		info, err := d.Info()
		if err != nil || info == nil {
			return nil
		}
		if info.Size() == 0 {
			// 跳过空文件——不同用途的空文件（占位符、空 .animation 等）不是重复文件
			return nil
		}

		// 计算 SHA256
		f, err := os.Open(p)
		if err != nil {
			log.Printf("[dedup] 打开文件失败 %s: %v", p, err)
			return nil
		}
		// WalkDir 回调是独立函数作用域，defer 在每次回调返回时执行，不跨文件堆积
		defer f.Close()
		h := sha256.New()
		if _, err := io.Copy(h, f); err != nil {
			log.Printf("[dedup] 读取文件失败 %s: %v", p, err)
			return nil
		}
		hash := fmt.Sprintf("%x", h.Sum(nil))
		return fn(hash, p, info.Size(), info.ModTime().UnixMilli())
	})
	return err
}

// FindDuplicateFiles 扫描目录，按 SHA256 哈希分组，返回包含重复的分组
// skipRecycle 为 true 时跳过 .recycle 子目录
func FindDuplicateFiles(dir string, skipRecycle bool) ([]Group, error) {
	dir = strings.TrimSpace(dir)
	if dir == "" {
		return nil, fmt.Errorf("目录为空")
	}
	// 入口绝对化——原实现保留入参形态，相对路径下 FileEntry.Path
	// 为相对路径，下游 recycle.Move 按 CWD 解析可能移到错误位置（与 CleanEmptyDirs 对齐）
	abs, err := filepath.Abs(dir)
	if err != nil {
		// 不可解析的根（如 Windows 上含 NUL 字节的路径）必须显式报错，不能静默
		// 退回入参形态：WalkDir→Lstat 失败会被 log 吞掉并返回「无重复」= 假绿，
		// 与 ErrSymlinkRoot 同类的静默漏扫。CleanEmptyDirs 已对齐该行为。
		return nil, fmt.Errorf("dedup: 无法解析扫描目录 %q: %w", dir, err)
	}
	dir = abs

	hashGroups := make(map[string]*Group)
	// 使用 map 保持插入顺序
	var orderedKeys []string

	err = walkHashedFiles(dir, skipRecycle, func(hash, path string, size int64, modTime int64) error {
		if g, ok := hashGroups[hash]; ok {
			g.Files = append(g.Files, FileEntry{
				Name:    filepath.Base(path),
				Path:    path,
				Size:    size,
				ModTime: modTime,
			})
		} else {
			hashGroups[hash] = &Group{
				Hash: hash,
				Size: size,
				Files: []FileEntry{{
					Name:    filepath.Base(path),
					Path:    path,
					Size:    size,
					ModTime: modTime,
				}},
			}
			orderedKeys = append(orderedKeys, hash)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	// 只保留有重复的分组，按首次出现顺序
	result := []Group{}
	for _, key := range orderedKeys {
		g := hashGroups[key]
		if len(g.Files) > 1 {
			sort.Slice(g.Files, func(i, j int) bool {
				return g.Files[i].Path < g.Files[j].Path
			})
			result = append(result, *g)
		}
	}
	return result, nil
}

// CountDuplicates 统计重复文件数量（比 FindDuplicateFiles 轻量，只计数）
func CountDuplicates(dir string, skipRecycle bool) (groups int, extraFiles int, err error) {
	groups = 0
	extraFiles = 0
	hashCount := make(map[string]int)

	err = walkHashedFiles(dir, skipRecycle, func(hash string, _ string, _ int64, _ int64) error {
		hashCount[hash]++
		return nil
	})
	if err != nil {
		return 0, 0, err
	}

	for _, count := range hashCount {
		if count > 1 {
			groups++
			extraFiles += count - 1
		}
	}
	return groups, extraFiles, nil
}

// CleanEmptyDirs 递归删除指定目录下的所有空子目录（不含 dir 自身）。
// 返回删除的空目录数。从最深层开始删除，确保祖父目录也能被清理。
func CleanEmptyDirs(dir string) (int, error) {
	dir = strings.TrimSpace(dir)
	if dir == "" {
		return 0, fmt.Errorf("目录为空")
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		return 0, err
	}
	var removed int
	removeEmptyDirs(abs, abs, &removed)
	return removed, nil
}

// removeEmptyDirs 递归后序遍历删除空目录。
// root 为调用入口目录：根目录自身永不删除（P2 修复——原实现 isEmptyDir(root) 命中时
// 会误删整个根目录，与「删除所有空子目录」契约矛盾，也与 fsutil 语义分叉）。
func removeEmptyDirs(root, dir string, removed *int) int {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return 0
	}
	for _, e := range entries {
		if e.IsDir() {
			subPath := filepath.Join(dir, e.Name())
			removeEmptyDirs(root, subPath, removed)
		}
	}
	// 再次检查是否为空（子目录可能已被删除）；根目录自身跳过
	if dir != root && isEmptyDir(dir) {
		if err := os.Remove(dir); err == nil {
			(*removed)++
		}
	}
	return *removed
}

// isEmptyDir 检查目录是否为空（不含任何文件和非空子目录）
func isEmptyDir(dir string) bool {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return false
	}
	return len(entries) == 0
}
