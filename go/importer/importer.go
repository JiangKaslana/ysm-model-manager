// Package importer 提供资源导入策略接口和内置实现
//
// 每种资源类型可以注册自己的导入策略，通用组件通过 rtype 自动选择：
//
//	handler := importer.Get("resourcepack")
//	errMsg := handler.Import(zipPath, dstDir)
package importer

import (
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/paths"
)

// Handler 资源导入策略接口
type Handler interface {
	// Type 返回支持的类型 ID
	Type() string
	// Import 执行导入，返回错误信息（空串=成功）
	Import(srcPath, dstDir string) string
}

var (
	registry   = map[string]Handler{}
	registryMu sync.RWMutex
)

// Register 注册导入策略（线程安全）
func Register(h Handler) {
	registryMu.Lock()
	defer registryMu.Unlock()
	registry[h.Type()] = h
}

// Get 获取指定类型的导入策略（线程安全）
func Get(rtype string) Handler {
	registryMu.RLock()
	defer registryMu.RUnlock()
	return registry[rtype]
}

// sanitizePath 清理路径，确保不含路径遍历组件（..）
// 注意：上层调用（installer.Install）已通过 paths.IsInside 做了严格校验，
// 此处的检查是防御纵深，防止 importer 被独立使用时出现路径遍历。
func sanitizePath(path, label string) (string, error) {
	cleaned := filepath.Clean(path)
	if paths.HasTraversal(cleaned) {
		return cleaned, fmt.Errorf("%s 包含非法路径 '..'", label)
	}
	return cleaned, nil
}

// ===== SimpleCopyImporter =====
// 适用于资源包/光影包等只需复制文件的资源类型

type SimpleCopyImporter struct {
	rtype string
}

// NewSimpleCopy 创建简单文件复制导入器
func NewSimpleCopy(rtype string) *SimpleCopyImporter {
	return &SimpleCopyImporter{rtype: rtype}
}

func (s *SimpleCopyImporter) Type() string { return s.rtype }

func (s *SimpleCopyImporter) Import(srcPath, dstDir string) string {
	if srcPath == "" {
		return "源文件路径为空"
	}
	if dstDir == "" {
		return "目标目录为空"
	}

	// 路径清理与遍历防护
	srcPath, err := sanitizePath(srcPath, "源路径")
	if err != nil {
		return err.Error()
	}
	dstDir, err = sanitizePath(dstDir, "目标路径")
	if err != nil {
		return err.Error()
	}

	if err := os.MkdirAll(dstDir, fsutil.DirPerms); err != nil {
		return fmt.Sprintf("创建目标目录失败: %v", err)
	}

	// 检查源路径是文件还是目录
	info, err := os.Stat(srcPath)
	if err != nil {
		return fmt.Sprintf("无法访问源路径: %v", err)
	}

	if info.IsDir() {
		// 目录导入：复制整个目录树
		baseName := filepath.Base(srcPath)
		if baseName == "" || baseName == "." ||
			baseName == string(filepath.Separator) ||
			baseName == string(filepath.VolumeName(srcPath)) {
			return "源路径无效：无法确定要导入的模型文件夹（源为磁盘根目录）"
		}
		targetDir := filepath.Join(dstDir, baseName)
		if err := copyDirRecursive(srcPath, targetDir); err != nil {
			return fmt.Sprintf("导入目录失败: %v", err)
		}
		return ""
	}

	// 文件导入：先复制到临时文件再原子改名，避免复制中断时
	// 破坏已存在的目标文件（原 os.Create 直接截断目标，半截数据覆盖原文件后失败即丢数据；
	// 对齐 copyDir 的 ADR-028 原子替换模式，CreateTemp 保证并发导入互不干扰）
	srcFile, err := os.Open(srcPath)
	if err != nil {
		return fmt.Sprintf("打开源文件失败: %v", err)
	}
	defer srcFile.Close()

	dstPath := filepath.Join(dstDir, filepath.Base(srcPath))
	tmpFile, err := os.CreateTemp(dstDir, ".import-*.tmp")
	if err != nil {
		return fmt.Sprintf("创建临时文件失败: %v", err)
	}
	tmpName := tmpFile.Name()
	// 任一失败分支清理临时文件，不留残渣
	cleanup := func() {
		tmpFile.Close()
		os.Remove(tmpName)
	}
	if _, err := io.Copy(tmpFile, srcFile); err != nil {
		cleanup()
		return fmt.Sprintf("复制文件失败: %v", err)
	}
	// BUG(INFO-SAME-DIR) 修复：在 rename 前显式关闭 srcFile——
	// Windows 上文件被进程持有句柄时 os.Rename 无法覆盖（Access is denied），
	// src==dst 场景（同目录自拷贝）尤其会触发。defer Close 在函数退出时才执行，
	// 太晚了。读取完成后立即关闭。
	if err := srcFile.Close(); err != nil {
		cleanup()
		return fmt.Sprintf("关闭源文件失败: %v", err)
	}
	// Sync + 显式 Close 检查——defer 吞掉 Close 错误时，
	// ENOSPC/EIO 落盘失败被误判成功，损坏文件留盘（与 recycle/installer 同款反模式）
	if err := tmpFile.Sync(); err != nil {
		cleanup()
		return fmt.Sprintf("复制文件失败: %v", err)
	}
	if err := tmpFile.Close(); err != nil {
		os.Remove(tmpName)
		return fmt.Sprintf("复制文件失败: %v", err)
	}
	if err := os.Chmod(tmpName, fsutil.FilePerms); err != nil {
		log.Printf("[importer] 设置权限失败 %s: %v", tmpName, err)
	}
	// 原子替换：os.Rename 在 Windows 上可覆盖已存在文件（MOVEFILE_REPLACE_EXISTING）；
	// 目标已存在为目录时失败，此时清理临时文件
	if err := os.Rename(tmpName, dstPath); err != nil {
		os.Remove(tmpName)
		return fmt.Sprintf("移动目标文件失败: %v", err)
	}
	return ""
}

// copyDirRecursive 递归复制目录（先复制到临时目录再 rename，保证原子性）
func copyDirRecursive(src, dst string) error {
	// BUG(INFO-ROOT-SRC) 修复：检测 src 包含 dst 的情况——
	// 若 src 是 dst 的祖先目录（如 src=tmpDir, dst=tmpDir/dest/xxx），
	// 递归复制时会将 dst 自身包含在遍历中，导致 src/dst/src/dst/... 死循环。
	absSrc, err := filepath.Abs(src)
	if err != nil {
		return fmt.Errorf("解析源路径失败: %w", err)
	}
	absDst, err := filepath.Abs(dst)
	if err != nil {
		return fmt.Errorf("解析目标路径失败: %w", err)
	}
	if absSrc == absDst {
		return fmt.Errorf("源目录与目标目录相同: %s", absSrc)
	}
	// 检查 src 是否为 dst 的祖先（src 包含 dst）
	rel, err := filepath.Rel(absSrc, absDst)
	if err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return fmt.Errorf("目标目录 %s 位于源目录 %s 内，递归复制会死循环", absDst, absSrc)
	}
	// 用 MkdirTemp 创建临时目录（自动生成唯一名称，避免并发冲突）
	tmpDir, err := os.MkdirTemp(filepath.Dir(dst), ".tmp_import_")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmpDir) // 失败时清理临时目录

	if err := copyDirContents(src, tmpDir); err != nil {
		return err
	}

	// 原子替换：若目标已存在，先挪走作备份再 rename（os.Rename 在 Windows 上不覆盖已存在的目录）
	// 与 sync_relink.go 同模式：rename 失败则回滚恢复，避免「先删后建」失败即丢目录（ADR-028）
	// backup 文件名加时间戳后缀，防并发导入同名目录时备份互相覆盖
	if _, stErr := os.Stat(dst); stErr == nil {
		backup := dst + ".import-bak-" + strconv.FormatInt(time.Now().UnixNano(), 10)
		_ = os.RemoveAll(backup)
		if err := os.Rename(dst, backup); err != nil {
			return err
		}
		if err := os.Rename(tmpDir, dst); err != nil {
			_ = os.Rename(backup, dst) // 回滚恢复原目录
			return err
		}
		_ = os.RemoveAll(backup)
		return nil
	}
	return os.Rename(tmpDir, dst)
}

// copyDirContents 递归复制目录内容到目标（无原子性保证，供 copyDirRecursive 内部调用）
func copyDirContents(src, dst string) error {
	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		srcPath := filepath.Join(src, entry.Name())
		dstPath := filepath.Join(dst, entry.Name())
		if entry.IsDir() {
			// 必须先建目录再递归——否则源中的空子目录会整体丢失
			// （copyFile 仅在复制文件时 MkdirAll 父目录，空目录无人创建）
			// 注：目录符号链接/junction 的 IsDir() 恒 false，走 else 分支复制链接本身
			if err := os.MkdirAll(dstPath, fsutil.DirPerms); err != nil {
				return err
			}
			if err := copyDirContents(srcPath, dstPath); err != nil {
				return err
			}
		} else {
			// 符号链接文件：复制链接本身
			if entry.Type()&os.ModeSymlink != 0 {
				target, rErr := os.Readlink(srcPath)
				if rErr != nil {
					return rErr
				}
				if sErr := os.Symlink(target, dstPath); sErr != nil {
					return sErr
				}
				continue
			}
			if err := copyFile(srcPath, dstPath); err != nil {
				return err
			}
		}
	}
	return nil
}

// ===== DirectoryCopyImporter =====
// 适用于 MMD 模型等以文件夹为单位的资源类型

type DirectoryCopyImporter struct {
	rtype string
}

// NewDirectoryCopy 创建文件夹复制导入器
func NewDirectoryCopy(rtype string) *DirectoryCopyImporter {
	return &DirectoryCopyImporter{rtype: rtype}
}

func (d *DirectoryCopyImporter) Type() string { return d.rtype }

// Import 复制源文件夹到目标目录
// srcPath 可以是文件夹内任意文件路径，也可以是文件夹本身
// 若 srcPath 是文件则取父目录，若是目录则直接使用
func (d *DirectoryCopyImporter) Import(srcPath, dstDir string) string {
	if srcPath == "" {
		return "源文件路径为空"
	}
	if dstDir == "" {
		return "目标目录为空"
	}

	// 路径清理与遍历防护
	srcPath, err := sanitizePath(srcPath, "源路径")
	if err != nil {
		return err.Error()
	}
	dstDir, err = sanitizePath(dstDir, "目标路径")
	if err != nil {
		return err.Error()
	}

	// 判断 srcPath 是文件还是目录
	info, stErr := os.Stat(srcPath)
	if stErr != nil {
		return fmt.Sprintf("无法访问源路径: %v", stErr)
	}
	var srcDir string
	if info.IsDir() {
		srcDir = srcPath
	} else {
		srcDir = filepath.Dir(srcPath)
	}
	folderName := filepath.Base(srcDir)
	if folderName == "" || folderName == "." ||
		folderName == string(filepath.Separator) ||
		folderName == string(filepath.VolumeName(srcDir)) {
		return "源路径无效：无法确定要导入的模型文件夹（源为磁盘根目录）"
	}
	dstPath := filepath.Join(dstDir, folderName)

	// 确保目标父目录存在
	if err := os.MkdirAll(dstDir, fsutil.DirPerms); err != nil {
		return fmt.Sprintf("创建目标目录失败: %v", err)
	}
	// 复制整个文件夹
	if err := copyDir(srcDir, dstPath); err != nil {
		return fmt.Sprintf("复制文件夹失败: %v", err)
	}
	return ""
}

func copyDir(src, dst string) error {
	// BUG(SRC-DST) 修复：对齐 copyDirRecursive 的 src/dst 祖先守卫——
	// DirectoryCopyImporter.Import(modelDir, 其父目录) 时 dstPath == srcDir（src==dst），
	// 或 dstDir 位于模型文件夹内时 dst 是 src 的后代；无守卫时 copyDir 会把源目录
	// 整体备份再移除，静默替换源文件夹为自身副本（源 inode 被销毁）。
	absSrc, err := filepath.Abs(src)
	if err != nil {
		return fmt.Errorf("解析源路径失败: %w", err)
	}
	absDst, err := filepath.Abs(dst)
	if err != nil {
		return fmt.Errorf("解析目标路径失败: %w", err)
	}
	if absSrc == absDst {
		return fmt.Errorf("源目录与目标目录相同: %s", absSrc)
	}
	rel, err := filepath.Rel(absSrc, absDst)
	if err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return fmt.Errorf("目标目录 %s 位于源目录 %s 内，递归复制会死循环", absDst, absSrc)
	}

	// 用 MkdirTemp 创建临时目录，避免并发冲突
	tmpDir, err := os.MkdirTemp(filepath.Dir(dst), ".tmp_import_")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmpDir)

	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}
	for _, e := range entries {
		srcPath := filepath.Join(src, e.Name())
		dstPath := filepath.Join(tmpDir, e.Name())
		if e.IsDir() {
			// 注：目录符号链接/junction 的 IsDir() 恒 false，走 else 分支复制链接本身
			if err := copyDir(srcPath, dstPath); err != nil {
				return err
			}
		} else {
			if e.Type()&os.ModeSymlink != 0 {
				if target, rErr := os.Readlink(srcPath); rErr == nil {
					if sErr := os.Symlink(target, dstPath); sErr != nil {
						return sErr
					}
				} else {
					return rErr
				}
				continue
			}
			if err := copyFile(srcPath, dstPath); err != nil {
				return err
			}
		}
	}

	// 原子替换：目标已存在时先备份再 rename，失败回滚恢复（ADR-028 反模式规避）
	// backup 文件名加时间戳后缀，防并发导入同名目录时备份互相覆盖
	if _, stErr := os.Stat(dst); stErr == nil {
		backup := dst + ".import-bak-" + strconv.FormatInt(time.Now().UnixNano(), 10)
		_ = os.RemoveAll(backup)
		if err := os.Rename(dst, backup); err != nil {
			return err
		}
		if err := os.Rename(tmpDir, dst); err != nil {
			_ = os.Rename(backup, dst) // 回滚恢复原目录
			return err
		}
		_ = os.RemoveAll(backup)
		return nil
	}
	return os.Rename(tmpDir, dst)
}

// copyFile 复制单文件（工具函数）
// 已收敛至 fsutil.CopyFile（ADR-044 策略 A）：tmp+rename 原子落地 + Sync + Chmod 0644，
// 失败自动清理临时文件，不留半截目标（原直写 os.Create + 失败 os.Remove 降级为原子模式）。
func copyFile(src, dst string) error {
	return fsutil.CopyFile(src, dst)
}

// ===== 初始化注册 =====
func init() {
	Register(NewSimpleCopy("resourcepack"))
	Register(NewSimpleCopy("shaderpack"))
	Register(NewSimpleCopy("blueprint"))
	Register(NewDirectoryCopy("EntityPlayer"))
	Register(NewDirectoryCopy("SceneModel"))
	Register(NewDirectoryCopy("CustomAnim"))
	Register(NewDirectoryCopy("CustomMorph"))
	Register(NewDirectoryCopy("StageAnim"))
	Register(NewDirectoryCopy("mmd-shader"))
	Register(NewDirectoryCopy("DefaultAnim"))
	Register(NewDirectoryCopy("DefaultMorph"))
	Register(NewDirectoryCopy("maid-model"))
	Register(NewSimpleCopy("ysm"))
	Register(NewSimpleCopy("litematic"))
}
