// ===== 原子复制原语（ADR-044 策略 A：基础设施工具收敛）=====
// 收敛自 fileops/recycle/importer/sync 四份 copyFile + 四份 copyDirRecursive：
// 单文件复制统一为 CopyFile（tmp+rename 原子 + Sync 落盘 + Chmod 0644 + MkdirAll 父目录），
// 目录复制统一为 CopyDirRecursive（参数化 symlink 策略 / 防覆盖 / 失败回滚），
// 各包按自身语义传参，禁止各自手写 tmp+rename 实现。
// 背景：直写目标在磁盘满/IO 中断时留半截损坏文件（项目头号反模式），
// 且多份实现语义漂移（recycle 曾缺 Sync、fileops 缺 Chmod）；收敛后单一实现 + 选项。

package fsutil

import (
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
)

// CopyFile 原子复制单文件：先写同目录临时文件再 rename 落地，崩溃/失败不留半截目标。
//   - MkdirAll 目标父目录（与 recycle/importer 的 copyFile 行为对齐）；
//   - Sync 落盘后再 Close+Rename（与 installer.copyFileLocked 对齐，防零长度文件装盘）；
//   - Chmod 0644（CreateTemp 恒建 0600，对齐 installer/importer 的 0644 约定，
//     防多用户/共享目录下复制文件不可读）。
//
// 同目录 tmp+rename 天然跨分区兼容（tmp 与 dst 同盘），无需 EXDEV 特殊分支。
// 返回普通 error；不追踪 symlink（上层 walk 负责 symlink 策略）。
func CopyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	if err := os.MkdirAll(filepath.Dir(dst), DirPerms); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(dst), ".copy-*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	ok := false
	defer func() {
		tmp.Close()
		if !ok {
			os.Remove(tmpName)
		}
	}()
	if _, err := io.Copy(tmp, in); err != nil {
		return err
	}
	// Sync 确保数据落盘后再 Close+Rename（与 installer/recycle/importer 的
	// copyFile 落盘检查对齐：不 Sync 时崩溃可能零长度文件装盘）
	if err := tmp.Sync(); err != nil {
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmpName, 0644); err != nil {
		os.Remove(tmpName)
		return err
	}
	if err := os.Rename(tmpName, dst); err != nil {
		os.Remove(tmpName)
		return err
	}
	ok = true
	return nil
}

// CopyDirOptions 目录递归复制选项（各调用方按自身语义传参）
type CopyDirOptions struct {
	// RejectSymlink 拒绝复制符号链接（fileops 安全红线：仓库内 symlink
	// 指向外部时词法校验通过但内容被拷入；true=遇到即报错。
	// false=复制链接本身（recycle/sync：保留链接语义，不跟随复制）。
	RejectSymlink bool
	// Overwrite 目标已存在：true=原子覆盖（tmp+rename 天然支持）；
	// false=报错（fileops 防重复导入）。
	Overwrite bool
	// Rollback 失败时整树回滚（RemoveAll dstDir），防半棵树残留被扫成
	// 「截断模型」进入同步匹配。fileops 恒 true；sync 仅当 dst 为本次新建时
	// true（重拉/刷新场景 dst 可能是用户既有目录，误删旧内容即数据丢失）。
	Rollback bool
}

// CopyDirRecursive 递归复制目录树到 dst（保留相对路径）。
// 逐项 MkdirAll + CopyFile；symlink 按 opts 策略处理（拒绝或复制链接本身）；
// 失败按 opts.Rollback 整树回滚。与 sync/fileops/recycle 的 copyDirRecursive
// 语义对齐（新增类型/调用方只需传选项，不再各自实现）。
func CopyDirRecursive(src, dst string, opts CopyDirOptions) error {
	if err := os.MkdirAll(dst, DirPerms); err != nil {
		return err
	}
	err := filepath.WalkDir(src, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.Type()&os.ModeSymlink != 0 {
			if opts.RejectSymlink {
				return fmt.Errorf("拒绝复制符号链接: %s", p)
			}
			// 符号链接：复制链接本身（保留语义），不跟随复制——symlink-to-dir
			// 走 CopyFile 会 os.Open(目录)+io.Copy → EISDIR 中断整棵树复制
			linkTarget, lerr := os.Readlink(p)
			if lerr != nil {
				return lerr
			}
			target, rerr := relJoin(dst, src, p)
			if rerr != nil {
				return rerr
			}
			// 目标已存在时 Symlink 在 Windows 上失败；先清目标再建链接，
			// 与 CopyFile 的 tmp+rename 原子替换口径对齐
			_ = os.Remove(target)
			return os.Symlink(linkTarget, target)
		}
		rel, rerr := filepath.Rel(src, p)
		if rerr != nil {
			return rerr
		}
		target := filepath.Join(dst, rel)
		if d.IsDir() {
			return os.MkdirAll(target, DirPerms)
		}
		if !opts.Overwrite {
			if _, err := os.Stat(target); err == nil {
				return fmt.Errorf("目标已存在: %s", target)
			}
		}
		return CopyFile(p, target)
	})
	if err != nil {
		if opts.Rollback {
			if rmErr := os.RemoveAll(dst); rmErr != nil {
				log.Printf("[fsutil] 复制失败回滚清理失败 %s: %v（原错误: %v）", dst, rmErr, err)
			}
		}
		return err
	}
	return nil
}

// relJoin 计算 p 相对 src 的目标路径（symlink 分支专用，避免与文件分支的
// filepath.Rel 重复调用语义混淆）
func relJoin(dst, src, p string) (string, error) {
	rel, err := filepath.Rel(src, p)
	if err != nil {
		return "", err
	}
	return filepath.Join(dst, rel), nil
}
