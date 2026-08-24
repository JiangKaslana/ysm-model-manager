package sync

import (
	"crypto/sha256"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"
)

// ConflictType 冲突类型
type ConflictType string

const (
	// ConflictContentModified 内容冲突：本地和远端文件内容都被修改
	ConflictContentModified ConflictType = "content_modified"
	// ConflictAddedInBoth 双端新增：本地和远端都新增了同名文件
	ConflictAddedInBoth ConflictType = "added_in_both"
)

// ResolutionStrategy 冲突解决策略
type ResolutionStrategy string

const (
	// ResolveForceRemote 强制使用远端版本
	ResolveForceRemote ResolutionStrategy = "force_remote"
	// ResolveForceLocal 强制保留本地版本
	ResolveForceLocal ResolutionStrategy = "force_local"
	// ResolveManual 手动解决（由调用方决定）
	ResolveManual ResolutionStrategy = "manual"
)

// FileConflict 文件冲突详情
type FileConflict struct {
	// Path 冲突文件的相对路径
	Path string `json:"path"`
	// Type 冲突类型
	Type ConflictType `json:"type"`
	// LocalModTime 本地文件修改时间
	LocalModTime time.Time `json:"localModTime"`
	// RemoteModTime 远端文件修改时间
	RemoteModTime time.Time `json:"remoteModTime"`
	// LocalSize 本地文件大小
	LocalSize int64 `json:"localSize"`
	// RemoteSize 远端文件大小
	RemoteSize int64 `json:"remoteSize"`
	// LocalHash 本地文件哈希（可选，用于精确比较）
	LocalHash string `json:"localHash,omitempty"`
	// RemoteHash 远端文件哈希（可选，用于精确比较）
	RemoteHash string `json:"remoteHash,omitempty"`
	// SuggestedStrategy 建议的解决策略（如：保留较新版本）
	SuggestedStrategy ResolutionStrategy `json:"suggestedStrategy"`
}

// ConflictReport 冲突报告
type ConflictReport struct {
	// Conflicts 冲突文件列表
	Conflicts []FileConflict `json:"conflicts"`
	// TotalConflicts 总冲突数
	TotalConflicts int `json:"totalConflicts"`
}

// DetectConflicts 检测本地和远端之间的冲突
// localDir: 本地目录路径
// remoteDir: 远端（全局/主仓库）目录路径
// rtype: 资源类型 ID
// 返回冲突报告
func DetectConflicts(localDir, remoteDir, rtype string) (*ConflictReport, error) {
	// 收集本地文件
	localFiles, err := collectFileEntries(localDir)
	if err != nil {
		return nil, fmt.Errorf("收集本地文件失败: %w", err)
	}

	// 收集远端文件
	remoteFiles, err := collectFileEntries(remoteDir)
	if err != nil {
		return nil, fmt.Errorf("收集远端文件失败: %w", err)
	}

	var conflicts []FileConflict

	// 遍历本地文件，检查是否与远端冲突
	for path, localInfo := range localFiles {
		remoteInfo, exists := remoteFiles[path]
		if !exists {
			continue // 远端不存在，是新增或删除，不算冲突
		}

		// 检查是否修改过（通过修改时间和大小判断）
		localModified := localInfo.ModTime.After(localInfo.InitTime)
		remoteModified := remoteInfo.ModTime.After(remoteInfo.InitTime)

		if localModified && remoteModified {
			// 两端都修改了，这是内容冲突
			conflict := FileConflict{
				Path:              path,
				Type:              ConflictContentModified,
				LocalModTime:      localInfo.ModTime,
				RemoteModTime:     remoteInfo.ModTime,
				LocalSize:         localInfo.Size,
				RemoteSize:        remoteInfo.Size,
				SuggestedStrategy: suggestStrategy(localInfo.ModTime, remoteInfo.ModTime),
			}
			conflicts = append(conflicts, conflict)
		}
	}

	// 检查双端新增的文件（本地和远端都有，但不在对方的原始基线中）
	// 简化处理：如果文件两端都存在但大小和时间完全不同，且都不是基线版本，视为双端新增
	for path, localInfo := range localFiles {
		remoteInfo, exists := remoteFiles[path]
		if !exists {
			continue
		}
		// 如果修改时间都很近（比如都在最近 24 小时内），且大小不同，可能是双端新增
		now := time.Now()
		if now.Sub(localInfo.ModTime) < 24*time.Hour && now.Sub(remoteInfo.ModTime) < 24*time.Hour {
			if localInfo.Size != remoteInfo.Size && localInfo.Hash != remoteInfo.Hash {
				// 避免重复添加
				found := false
				for _, c := range conflicts {
					if c.Path == path {
						found = true
						break
					}
				}
				if !found {
					conflict := FileConflict{
						Path:              path,
						Type:              ConflictAddedInBoth,
						LocalModTime:      localInfo.ModTime,
						RemoteModTime:     remoteInfo.ModTime,
						LocalSize:         localInfo.Size,
						RemoteSize:        remoteInfo.Size,
						SuggestedStrategy: suggestStrategy(localInfo.ModTime, remoteInfo.ModTime),
					}
					conflicts = append(conflicts, conflict)
				}
			}
		}
	}

	report := &ConflictReport{
		Conflicts:      conflicts,
		TotalConflicts: len(conflicts),
	}

	return report, nil
}

// ResolveConflict 解决单个文件冲突
// conflict: 冲突详情
// strategy: 解决策略
// localDir: 本地目录
// remoteDir: 远端目录
// 返回操作结果（保留/覆盖/重命名）
func ResolveConflict(conflict FileConflict, strategy ResolutionStrategy, localDir, remoteDir string) error {
	localPath := localDir + "/" + conflict.Path
	remotePath := remoteDir + "/" + conflict.Path

	switch strategy {
	case ResolveForceRemote:
		// 强制使用远端：删除本地，拷贝远端
		if err := os.Remove(localPath); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("删除本地文件失败: %w", err)
		}
		return copyConflictFile(remotePath, localPath)

	case ResolveForceLocal:
		// 强制保留本地：不做任何操作（标记为已解决）
		return nil

	case ResolveManual:
		// 手动解决：返回错误让上层处理
		return fmt.Errorf("需要手动解决冲突: %s", conflict.Path)

	default:
		return fmt.Errorf("未知的解决策略: %s", strategy)
	}
}

// ResolveConflicts 批量解决冲突
// conflicts: 冲突列表
// defaultStrategy: 默认策略（用于自动解决）
// localDir: 本地目录
// remoteDir: 远端目录
// 返回解决结果（成功数、失败数、需手动处理数）
func ResolveConflicts(conflicts []FileConflict, defaultStrategy ResolutionStrategy, localDir, remoteDir string) (resolved, failed, manual int) {
	for _, c := range conflicts {
		strategy := c.SuggestedStrategy
		if strategy == ResolveManual {
			strategy = defaultStrategy
		}

		err := ResolveConflict(c, strategy, localDir, remoteDir)
		if err != nil {
			if strategy == ResolveManual {
				manual++
			} else {
				failed++
			}
		} else {
			resolved++
		}
	}
	return
}

// ===== 辅助函数 =====

// fileEntryInfo 文件条目信息
type fileEntryInfo struct {
	Path     string
	Size     int64
	ModTime  time.Time
	InitTime time.Time // 初始化/基线时间
	Hash     string
}

// collectFileEntries 收集目录下的所有文件信息
func collectFileEntries(dir string) (map[string]fileEntryInfo, error) {
	entries := make(map[string]fileEntryInfo)

	err := filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // 忽略单个文件错误
		}
		if info.IsDir() {
			return nil
		}

		// 计算相对路径
		relPath, err := filepath.Rel(dir, path)
		if err != nil {
			return nil
		}
		relPath = filepath.ToSlash(relPath)

		// 计算文件哈希
		hash, _ := computeFileHash(path)

		entries[relPath] = fileEntryInfo{
			Path:     relPath,
			Size:     info.Size(),
			ModTime:  info.ModTime(),
			InitTime: info.ModTime(), // 简化：初始时间 = 修改时间（实际应从基线记录获取）
			Hash:     hash,
		}
		return nil
	})

	return entries, err
}

// computeFileHash 计算文件 SHA256 哈希
func computeFileHash(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()

	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return fmt.Sprintf("%x", h.Sum(nil)), nil
}

// suggestStrategy 根据修改时间建议解决策略
func suggestStrategy(localTime, remoteTime time.Time) ResolutionStrategy {
	// 如果远端更新，建议使用远端
	if remoteTime.After(localTime) {
		return ResolveForceRemote
	}
	// 如果本地更新，建议保留本地
	if localTime.After(remoteTime) {
		return ResolveForceLocal
	}
	// 时间相同，建议手动解决
	return ResolveManual
}

// copyConflictFile 拷贝文件
func copyConflictFile(src, dst string) error {
	srcFile, err := os.Open(src)
	if err != nil {
		return err
	}
	defer srcFile.Close()

	dstFile, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer dstFile.Close()

	_, err = io.Copy(dstFile, srcFile)
	return err
}
