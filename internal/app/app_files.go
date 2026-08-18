// ========== 文件操作 + 预览提取 + 包信息（薄壳，ADR-003 P3）==========
// 业务逻辑已下沉至 go/fileops（纯 Go 可测）；本文件仅做 Wails 绑定转发 +
// scanCache 缓存失效处理。
package app

import (
	"errors"
	"fmt"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"ysm-model-manager/go/executil"
	"ysm-model-manager/go/fileops"
	"ysm-model-manager/go/scanner"
	"ysm-model-manager/go/types"
)

// ========== 目录操作 ==========
func (a *App) CreateDir(dir string) error {
	return fileops.CreateDir(a.ysmRoot(), dir)
}

func (a *App) RenameDir(oldPath, newName string) error {
	if !a.isPathInRoot(oldPath) {
		return fmt.Errorf("路径超出仓库目录")
	}
	if err := fileops.RenameDir(oldPath, newName); err != nil {
		return err
	}
	// 改名后失效扫描缓存——否则 30s 内 ScanModelEntries 命中旧目录名（陈旧缓存"复活"）
	scanner.InvalidateCache()
	return nil
}

func (a *App) RemoveDir(dir string) error {
	if !a.isPathInRoot(dir) {
		return fmt.Errorf("路径超出仓库目录")
	}
	if err := fileops.RemoveDir(dir); err != nil {
		return err
	}
	// 删除后失效扫描缓存——否则 30s 内已删目录仍出现在扫描结果
	scanner.InvalidateCache()
	return nil
}

func (a *App) RenameFile(oldPath, newName string) error {
	// 补路径守卫——原实现无校验，任意 oldPath 均可被改名（知识卡守卫清单漏列 RenameFile）
	if !a.isPathInRoot(oldPath) {
		return fmt.Errorf("路径超出仓库目录")
	}
	if err := fileops.RenameFile(oldPath, newName); err != nil {
		return err
	}
	// 改名后失效扫描缓存——否则 30s 内旧文件名仍可被扫描命中
	scanner.InvalidateCache()
	return nil
}

// ========== 预览提取 ==========
func (a *App) FindPreviewImage(modelPath string) string {
	return fileops.FindPreviewImage(modelPath)
}

func (a *App) ExtractPreviewTexture(modelPath string) string {
	return fileops.ExtractPreviewTexture(modelPath)
}

// ========== 包信息 ==========
func (a *App) GetPackInfo(dirPath string) types.PackInfo {
	return fileops.GetPackInfo(a.ysmRoot(), dirPath)
}

// ========== 模型移动/复制 ==========
// MoveModelFile 移动（root 传 FilesRoot 做路径安全校验，对齐 CopyModelFile）
func (a *App) MoveModelFile(src, dstDir string) error {
	cfg := a.LoadAppConfig()
	return fileops.MoveModelFile(cfg.FilesRoot, src, dstDir)
}

// CopyModelFile 复制（root 传 FilesRoot 做路径安全校验）
func (a *App) CopyModelFile(src, dstDir string) error {
	cfg := a.LoadAppConfig()
	return fileops.CopyModelFile(cfg.FilesRoot, src, dstDir)
}

// ImportModelFolder 文件夹型模型整组导入（YSM 解压目录 / MMD 模型目录，保留子目录层级，ADR-038 关联）
// folderName = 仓库文件夹名（模型名）；files = 相对路径 → base64 内容
// rtype 按文件夹内容推断（非硬编码 ysm）：扫主文件扩展名经 ExtBelongsTo 判定，
// 使 MMD 文件夹落到 mmd-skin 根而非 ysm 根（ADR-092 子类型落位根基）。
func (a *App) ImportModelFolder(folderName, subpath string, files []types.ImportFileItem) error {
	rtype := inferFolderType(files)
	root, _ := a.GetRepoRoot(rtype)
	if root == "" {
		return fmt.Errorf("请先设置文件存储路径")
	}
	if err := fileops.WriteModelFolder(root, subpath, folderName, files); err != nil {
		return err
	}
	scanner.InvalidateCache()
	return nil
}

// inferFolderType 从文件夹文件列表推断资源类型：
// 扫首个「支持文件」（扩展名命中注册表且非 ysm.json 附属）经 ExtBelongsTo 判定，
// 单归属则用该类型；歧义/未知回退 ysm（保持向后兼容）。
// 关键：MMD 文件夹（含 .pmx/.pmd）不再落到 ysm 根。
func inferFolderType(files []types.ImportFileItem) string {
	for _, f := range files {
		rel := filepath.Clean(filepath.FromSlash(strings.TrimSpace(f.RelPath)))
		ext := strings.ToLower(filepath.Ext(rel))
		base := filepath.Base(rel)
		// ysm.json 是 YSM 解压目录入口，优先
		if ext == ".json" && types.IsYsmEntryJSON(base) {
			return "ysm"
		}
		if ext == ".json" {
			continue // 其他 json 不参与类型判定
		}
		rtypes := types.ExtBelongsTo(ext)
		if len(rtypes) == 1 {
			return rtypes[0]
		}
	}
	return "ysm"
}

// ========== 在资源管理器中显示 ==========
func (a *App) RevealInExplorer(path string) error {
	path = strings.TrimSpace(path)
	if path == "" {
		return fmt.Errorf("路径为空")
	}
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("explorer", "/select,", filepath.FromSlash(path))
		// 不设 HideWindow：explorer 是 GUI 程序，CREATE_NO_WINDOW 干扰单实例
		// DDE 转发 → 资源管理器打不开/无反应（与 OpenFolder 同源坑，P5 修复）
	case "darwin":
		// macOS: Finder 中选中并显示文件
		cmd = exec.Command("open", "-R", filepath.FromSlash(path))
		executil.HideWindow(cmd)
	case "android":
		// ADR-047 平台守卫：Android 无桌面资源管理器，SAF 打开需要 content:// URI 桥
		// （MikuMikuAR ADR-194 已弃用 SAF），明确返回不支持避免 xdg-open 静默失败
		return errors.New("RevealInExplorer: Android 不支持在资源管理器中显示，请在文件管理器中手动查找")
	default:
		// Linux: 无"选中文件"命令，退化为打开所在目录
		cmd = exec.Command("xdg-open", filepath.Dir(filepath.FromSlash(path)))
		executil.HideWindow(cmd)
	}
	return cmd.Start()
}

// ========== 启用/禁用 ==========
// ToggleModelEnable 切换 .ban 状态（fileops 纯逻辑 + 薄壳缓存失效）
func (a *App) ToggleModelEnable(path string) (bool, error) {
	enabled, err := fileops.ToggleModelEnable(a.ysmRoot(), path)
	if err == nil {
		scanner.InvalidatePath(filepath.Dir(path))
	}
	return enabled, err
}

func (a *App) IsFileBanned(path string) bool {
	return fileops.IsFileBanned(path)
}
