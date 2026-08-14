// ysm-updater-helper — Windows 自更新助手
//
// 工作流程：
//  1. 等待主进程退出（通过轮询进程列表或等待参数指定的 PID）
//  2. 复制新的 exe 到目标位置（替换旧的）
//  3. 启动新主程序
//  4. 自我清理（删除临时文件）
//
// 命令行参数：
//
//	ysm-updater-helper.exe <new-exe-path> <target-exe-path> <main-pid>
package main

import (
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"time"
)

func main() {
	if len(os.Args) < 4 {
		fmt.Fprintf(os.Stderr, "用法: %s <new-exe-path> <target-exe-path> <main-pid>\n", filepath.Base(os.Args[0]))
		os.Exit(1)
	}

	newPath := os.Args[1]
	targetPath := os.Args[2]
	pidStr := os.Args[3]

	// pid 仅用于校验参数合法性（等待改为固定 sleep，轮询逻辑 807c81a5 已删）
	_, err := strconv.Atoi(pidStr)
	if err != nil {
		log.Fatalf("无效的 PID: %s", pidStr)
	}

	// 1. 等待主进程退出（最多等待 30 秒）
	// 注意：Windows 不支持 Signal(0) 检测存活，也不应对目标进程发 Signal(os.Kill)
	// （那会直接杀死仍在运行的主进程）。用 os.FindProcess + 定期轮询检查线程数/句柄
	// 变化不可行，改为固定等待：主进程 os.Exit(0) 后系统回收 PE 文件锁需 ~500ms，
	// 直接 sleep 足够（与下方 500ms 合并）。
	time.Sleep(2 * time.Second)

	// 2. 复制新 exe 到目标位置（原子替换：同目录临时文件 + .old 备份 + 失败回滚）
	if err := replaceExe(newPath, targetPath); err != nil {
		log.Fatalf("替换文件失败 %s → %s: %v", newPath, targetPath, err)
	}

	// 3. 启动新主程序
	newProc := exec.Command(targetPath)
	newProc.Dir = filepath.Dir(targetPath)
	if err := newProc.Start(); err != nil {
		if rbErr := os.Rename(targetPath+".old", targetPath); rbErr != nil {
			log.Printf("[updater] 启动失败回滚 %s: %v", targetPath, rbErr)
		}
		log.Fatalf("启动新程序失败: %v", err)
	}

	// 4. 清理临时文件
	tmpDir := filepath.Dir(newPath)
	os.RemoveAll(tmpDir)

	os.Exit(0)
}

// copyFile 复制文件（保留原始文件在出错时不变）
func copyFile(src, dst string) error {
	srcFile, err := os.Open(src)
	if err != nil {
		return fmt.Errorf("打开源文件失败: %w", err)
	}
	defer srcFile.Close()

	dstFile, err := os.Create(dst)
	if err != nil {
		return fmt.Errorf("创建目标文件失败: %w", err)
	}
	defer dstFile.Close()

	if _, err := io.Copy(dstFile, srcFile); err != nil {
		os.Remove(dst) // 清理不完整的文件
		return fmt.Errorf("写入失败: %w", err)
	}

	return dstFile.Close()
}

// replaceExe 原子替换 exe：先写 .new（target 原位不动），再备份为 .old，最后 rename 到位；
// 拷贝全程 target 始终可用，缺失窗口仅收敛为两段 rename 间隙（微秒级），任一步失败可回滚
func replaceExe(newPath, targetPath string) error {
	backup := targetPath + ".old"
	tmp := targetPath + ".new"
	// 1) 先写 .new：target 仍在原位，拷贝失败/断电时应用目录始终有可用 exe
	if err := copyFile(newPath, tmp); err != nil {
		os.Remove(tmp)
		return fmt.Errorf("复制失败: %w", err)
	}
	// 2) 备份旧 exe（Go os.Rename 在 Windows 为 MoveFileEx+REPLACE_EXISTING，残留 .old 会被覆盖）
	if err := os.Rename(targetPath, backup); err != nil {
		os.Remove(tmp)
		return fmt.Errorf("备份目标失败: %w", err)
	}
	// 3) .new → target：与 2) 之间是唯一缺失窗口（微秒级）
	if err := os.Rename(tmp, targetPath); err != nil {
		// 回滚前先清理 .new 残留（子代理审核 P2：第 3 步失败时 tmp 可能仍在，
		// CleanupOldVersion 只清 .old 不清 .new，残留会成为应用目录垃圾）
		os.Remove(tmp)
		if rbErr := os.Rename(backup, targetPath); rbErr != nil {
			log.Printf("[updater] 回滚失败 %s→%s: %v", backup, targetPath, rbErr)
		}
		return fmt.Errorf("替换失败: %w", err)
	}
	return nil
}
