// ===== 推送/拉取执行（ADR-003 补充下沉）=====
// 从 internal/app/app_install.go 的 PushResourceToInstance /
// PullResourceFromInstance 提取执行循环；实例查找/目录解析由薄壳完成，
// 本文件只做 SyncResources 结果的落地复制 + 计数。
package sync

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/installer"
	"ysm-model-manager/go/types"
)

// Logger 导入日志回调（薄壳注入 App.logger.Add）
type Logger func(name, src, dst string, size int64, status, msg string)

// PushResources 推送缺失资源到整合包（folder 级类型用 SyncResourcesDirLevel）
func PushResources(rtype, globalDir, targetDir, linkMode string, logger Logger) (int, error) {
	count := 0
	failed := 0

	// YSM(.json) 和 MMD(.pmx/.pmd) 位于子目录中，需文件夹推送
	// 用文件夹级同步检测 missing，然后完整复制整个文件夹（含纹理等配套文件）
	if types.IsDirLevelSync(rtype) {
		dirResult := SyncResourcesDirLevel(globalDir, targetDir, rtype)
		for _, missingDir := range dirResult.Missing {
			if err := installer.InstallDir(missingDir, targetDir, globalDir, linkMode, rtype); err == nil {
				count++
			} else {
				failed++
				if logger != nil {
					logger(filepath.Base(missingDir), missingDir, targetDir, 0, "failed", "推送失败: "+err.Error())
				}
			}
		}
		if failed > 0 {
			return count, fmt.Errorf("推送完成: 成功 %d，失败 %d", count, failed)
		}
		return count, nil
	}

	// 非文件夹级类型：文件级同步
	result := SyncResources(globalDir, targetDir)
	for _, src := range result.Missing {
		if err := installer.Install(src, targetDir, globalDir, linkMode); err == nil {
			count++
		} else {
			failed++
			if logger != nil {
				logger(filepath.Base(src), src, targetDir, 0, "failed", "推送失败: "+err.Error())
			}
		}
	}
	if failed > 0 {
		return count, fmt.Errorf("推送完成: 成功 %d，失败 %d", count, failed)
	}
	return count, nil
}

// PullResources 拉取整合包多余资源回仓库
func PullResources(rtype, globalDir, targetDir string, logger Logger) (int, error) {
	// 找出 extra 的文件并复制到全局
	// 对 YSM/MMD 使用文件夹级同步
	var result types.ResourceSyncResult
	if types.IsDirLevelSync(rtype) {
		result = SyncResourcesDirLevel(globalDir, targetDir, rtype)
	} else {
		result = SyncResources(globalDir, targetDir)
	}
	count := 0
	failed := 0
	for _, src := range result.Extra {
		fi, stErr := os.Stat(src)
		isDir := stErr == nil && fi.IsDir()
		if rtype == "ysm" || rtype == "mmd-skin" {
			if isDir {
				folderName := filepath.Base(src)
				dstDir := filepath.Join(globalDir, folderName)
				// 递归复制整个目录（保留相对路径）——MMD/YSM 模型文件夹的深层子目录
				// （textures/toon 等）不能丢弃；失败时 copyDirRecursive 已回滚清理
				if err := copyDirRecursive(src, dstDir); err != nil {
					failed++
					if logger != nil {
						logger(folderName, src, dstDir, 0, "failed", "拉取失败: "+err.Error())
					}
					continue
				}
				count++
			} else {
				if err := copyFile(src, filepath.Join(globalDir, filepath.Base(src))); err != nil {
					failed++
					if logger != nil {
						logger(filepath.Base(src), src, globalDir, 0, "failed", "拉取失败: "+err.Error())
					}
					continue
				}
				count++
			}
			continue
		}
		mapped, mapErr := mapSrcToGlobal(src, targetDir, globalDir)
		if mapErr != nil {
			failed++
			if logger != nil {
				logger(filepath.Base(src), src, globalDir, 0, "failed", "路径映射失败: "+mapErr.Error())
			}
			continue
		}
		dstDir := filepath.Dir(mapped)
		if err := os.MkdirAll(dstDir, 0755); err != nil {
			failed++
			if logger != nil {
				logger(filepath.Base(src), src, dstDir, 0, "failed", "拉取失败: "+err.Error())
			}
			continue
		}
		if err := copyFile(src, filepath.Join(dstDir, filepath.Base(src))); err != nil {
			failed++
			if logger != nil {
				logger(filepath.Base(src), src, dstDir, 0, "failed", "拉取失败: "+err.Error())
			}
			continue
		}
		count++
	}
	if failed > 0 {
		return count, fmt.Errorf("拉取完成: 成功 %d，失败 %d", count, failed)
	}
	return count, nil
}

// PullSingleResource 拉取单个资源（文件夹/文件）回仓库
func PullSingleResource(globalDir, targetDir, srcPath string) error {
	// 文件夹级拉取：整体复制文件夹到全局
	fi, stErr := os.Stat(srcPath)
	if stErr == nil && fi.IsDir() {
		folderName := filepath.Base(srcPath)
		dstDir := filepath.Join(globalDir, folderName)
		// 递归复制整个目录（保留相对路径），深层子目录（textures/toon 等）一并拉取
		return copyDirRecursive(srcPath, dstDir)
	}
	mapped, mapErr := mapSrcToGlobal(srcPath, targetDir, globalDir)
	if mapErr != nil {
		return mapErr
	}
	dstDir := filepath.Dir(mapped)
	if err := os.MkdirAll(dstDir, 0755); err != nil {
		return err
	}
	return copyFile(srcPath, filepath.Join(dstDir, filepath.Base(srcPath)))
}

// PushSingleResource 推送单个资源到整合包：
// 文件夹 / .json/.pmx/.pmd（文件夹级类型）走 InstallDir，其余 Install
func PushSingleResource(filePath, customDir, globalDir, linkMode, rtype string) error {
	fi, stErr := os.Stat(filePath)
	if stErr == nil && fi.IsDir() {
		return installer.InstallDir(filePath, customDir, globalDir, linkMode, rtype)
	}
	ext := strings.ToLower(filepath.Ext(filePath))
	if ext == ".json" || ext == ".pmx" || ext == ".pmd" {
		return installer.InstallDir(filepath.Dir(filePath), customDir, globalDir, linkMode, rtype)
	}
	return installer.Install(filePath, customDir, globalDir, linkMode)
}

// SyncCustomToRepo 同步整合包自定义目录的模型到仓库（哈希/名称去重）
func SyncCustomToRepo(customDir, repoDir string, scanFn func(string) []types.ModelEntry, logger Logger) (int, error) {
	customDir = strings.TrimSpace(customDir)
	repoDir = strings.TrimSpace(repoDir)
	if customDir == "" || repoDir == "" {
		return 0, fmt.Errorf("参数空")
	}
	if scanFn == nil {
		return 0, fmt.Errorf("scanFn 为空")
	}
	srcEntries := scanFn(customDir)
	if len(srcEntries) == 0 {
		return 0, nil
	}

	repoEntries := scanFn(repoDir)
	repoHashes := make(map[string]bool)
	repoNames := make(map[string]bool)
	for _, re := range repoEntries {
		if re.Hash != "" {
			repoHashes[re.Hash] = true
		}
		repoNames[re.Name] = true
	}

	count := 0
	for _, e := range srcEntries {
		if e.Hash != "" && repoHashes[e.Hash] {
			if logger != nil {
				logger(e.Name, e.Path, repoDir, 0, "skipped", "仓库已存在同哈希文件，跳过")
			}
			continue
		}
		if repoNames[e.Name] {
			if logger != nil {
				logger(e.Name, e.Path, repoDir, 0, "skipped", "仓库已存在同名文件，跳过")
			}
			continue
		}
		rel, err := filepath.Rel(customDir, e.Path)
		if err != nil || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || rel == ".." {
			// P0 修复：防路径穿越——e.Path 不在 customDir 下时，丢弃 err 会生成 "..\\leaked\\m.ysm"
			// 并 MkdirAll 到 customDir 外部。显式拒绝越界条目。
			if logger != nil {
				logger(e.Name, e.Path, repoDir, 0, "failed",
					"跳过越界路径（不在 customDir 下）: "+e.Path)
			}
			continue
		}
		if rel == "" {
			rel = e.Name
		}
		dstPath := filepath.Join(repoDir, rel)
		dstDir := filepath.Dir(dstPath)
		if err := os.MkdirAll(dstDir, 0755); err != nil {
			if logger != nil {
				logger(e.Name, e.Path, repoDir, 0, "failed", "创建目录失败: "+err.Error())
			}
			continue
		}
		if _, err := installer.CopyFile(e.Path, dstDir); err != nil {
			if logger != nil {
				logger(e.Name, e.Path, repoDir, 0, "failed", "复制失败: "+err.Error())
			}
			continue
		}
		count++
		if logger != nil {
			logger(e.Name, e.Path, repoDir, 0, "success", "已复制到仓库")
		}
	}
	return count, nil
}

// mapSrcToGlobal P3 修复（子代理审计）：原用 strings.Replace(src, targetDir, globalDir, 1)
// 子串替换——非路径语义且大小写敏感（Windows 下 targetDir 与 src 前缀大小写不一致时 Replace
// 不命中 → dstDir=Dir(src) → copyFile(src, src) 静默截断源文件；或兄弟目录前缀误匹配写错目录）。
// 改用 filepath.Rel 精确映射：src 必须在 targetDir 下，rel 以 ".." 开头显式报错防逃逸。
func mapSrcToGlobal(src, targetDir, globalDir string) (string, error) {
	rel, err := filepath.Rel(targetDir, src)
	if err != nil {
		return "", err
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("路径 %s 不在目标目录 %s 内", src, targetDir)
	}
	return filepath.Join(globalDir, rel), nil
}

// copyFile 复制文件到目标路径（已收敛至 fsutil.CopyFile 的 tmp+rename 原子落地——
// 原 os.Create+io.Copy 直写目标，拉取中断/磁盘满会留半截文件进仓库，被扫描成
// 「截断哈希」进入同步匹配；fsutil 补 Sync 落盘检查 + Chmod 0644，与 installer/
// fileops/recycle/importer 全部统一，ADR-044 策略 A）。
func copyFile(src, dst string) error {
	return fsutil.CopyFile(src, dst)
}

// copyDirRecursive 递归复制目录树到 dstDir（保留相对路径）：
// 已收敛至 fsutil.CopyDirRecursive（ADR-044 策略 A）。仅当 dstDir 为本次新建时才回滚
// 删除——重拉/刷新场景 dstDir 可能是用户既有模型文件夹，误删旧内容即数据丢失
// （对齐 installer.InstallDir 的 dstExisted 语义）。
func copyDirRecursive(src, dstDir string) error {
	dstExisted := false
	if _, err := os.Stat(dstDir); err == nil {
		dstExisted = true
	}
	return fsutil.CopyDirRecursive(src, dstDir, fsutil.CopyDirOptions{
		RejectSymlink: false,       // 保留 symlink 链接本身（不跟随复制）
		Overwrite:     true,        // 重拉/刷新场景允许覆盖既有文件
		Rollback:      !dstExisted, // 仅本次新建目录才整树回滚，防误删用户既有数据
	})
}
