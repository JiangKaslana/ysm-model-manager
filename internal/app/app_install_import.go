// ========== 安装 + 导入（拆分自 app_install.go）==========
// 从 app_install.go 拆分：模型安装/导入核心逻辑
package app

import (
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/importer"
	"ysm-model-manager/go/installer"
	ysmsync "ysm-model-manager/go/sync"
	"ysm-model-manager/go/types"
)

// ========== 安装 ==========
func (a *App) InstallModelFile(src, mcRoot string) (string, error) {
	return installer.InstallToGlobal(src, mcRoot)
}

func (a *App) InstallModelTo(src, customDir string) error {
	err := installer.Install(src, customDir, a.ysmRoot(), a.getLinkMode())
	if err != nil {
		a.logger.Add(filepath.Base(src), src, customDir, 0, "failed", err.Error())
	} else {
		a.logger.Add(filepath.Base(src), src, customDir, 0, "success", "")
	}
	return err
}

func (a *App) InstallModelWithOverlay(src, customDir string) (string, error) {
	return installer.InstallWithOverlay(src, customDir)
}

// SyncCustomToRepo 同步整合包自定义目录到仓库（执行逻辑下沉 go/sync）
func (a *App) SyncCustomToRepo(customDir, repoDir string) (int, error) {
	return ysmsync.SyncCustomToRepo(customDir, repoDir, a.ScanModelEntries, a.logger.Add)
}

func (a *App) ImportModelFile(fileName, base64Data string) error {
	return a.importModelFile(fileName, base64Data, false)
}

// DetectZipType 通过 ZIP 内容检测资源类型（供前端导入路由使用）
func (a *App) DetectZipType(base64Data string) string {
	data, err := base64.StdEncoding.DecodeString(base64Data)
	if err != nil {
		return "unknown"
	}
	return importer.DetectZipType(data)
}

func (a *App) ImportModelFileSkipCheck(fileName, base64Data string) error {
	return a.importModelFile(fileName, base64Data, true)
}

func (a *App) importModelFile(fileName, base64Data string, skipCheck bool) error {
	return a.importModelFileWithOptions(fileName, base64Data, importOptions{skipCheck: skipCheck})
}

func (a *App) ImportModelFileOverwrite(fileName, base64Data string) error {
	return a.importModelFileWithOptions(fileName, base64Data, importOptions{overwrite: true})
}

type importOptions struct {
	skipCheck bool
	overwrite bool
}

// importModelFileWithOptions 导入模型文件（校验+写文件核心下沉 go/importer）
func (a *App) importModelFileWithOptions(fileName, base64Data string, opts importOptions) error {
	return importer.ImportFromBase64(fileName, base64Data, importer.ImportOptions{
		SkipCheck: opts.skipCheck,
		Overwrite: opts.overwrite,
	}, func(rtype string) string {
		dir, _ := a.GetRepoRoot(rtype)
		return dir
	}, a.logger.Add)
}

func (a *App) ImportModelFileTo(fileName, subpath, base64Data string) error {
	return a.importModelFileWithSubpath(fileName, subpath, base64Data, false)
}

func (a *App) ImportModelFileOverwriteTo(fileName, subpath, base64Data string) error {
	return a.importModelFileWithSubpath(fileName, subpath, base64Data, true)
}

// ImportModelFileToMMD 导入 MMD 模型文件到指定用途子目录（ADR-096）。
// mmdSubdir: MMD 用途子目录名（如 SceneModel/CustomAnim），对应 MMD 独立顶级类型。
// subpath: 文件在子目录内的相对路径（文件夹导入时保留层级）。
func (a *App) ImportModelFileToMMD(fileName, subpath, mmdSubdir, base64Data string) error {
	return a.importModelFileMMD(fileName, subpath, mmdSubdir, base64Data, false)
}

// ImportModelFileOverwriteToMMD 覆盖导入 MMD 模型文件到指定用途子目录。
func (a *App) ImportModelFileOverwriteToMMD(fileName, subpath, mmdSubdir, base64Data string) error {
	return a.importModelFileMMD(fileName, subpath, mmdSubdir, base64Data, true)
}

// importModelFileMMD 导入 MMD 模型文件。
// 壳-叶架构已移除：mmdSubdir 现在作为资源类型 ID（如 EntityPlayer、SceneModel），
// 直接走该类型的存储根目录与扩展名校验。
func (a *App) importModelFileMMD(fileName, subpath, mmdSubdir, base64Data string, overwrite bool) error {
	rtype := mmdSubdir
	if rtype == "" {
		rtype = "EntityPlayer"
	}
	root, _ := a.GetRepoRoot(rtype)
	if root == "" {
		return fmt.Errorf("请先设置文件存储路径")
	}
	// 扩展名校验：按资源类型自声明的 extensions 白名单
	if allowedExts := types.SupportedExtsForType(rtype); len(allowedExts) > 0 {
		ext := strings.ToLower(filepath.Ext(fileName))
		extSet := make(map[string]bool, len(allowedExts))
		for _, e := range allowedExts {
			extSet[strings.ToLower(e)] = true
		}
		if !extSet[ext] {
			return types.AppError{Code: types.ErrUnsupportedType, Operation: "导入模型", SourcePath: fileName, Reason: fmt.Sprintf("文件格式不被 %s 类型支持", rtype), Suggestion: "仅允许: " + strings.Join(allowedExts, " / ")}
		}
	}
	// 拼接子目录：mmdSubdir 在前，subpath 在后（如有）。
	fullSubpath := mmdSubdir
	if subpath != "" {
		fullSubpath = mmdSubdir + "/" + subpath
	}
	return a.importModelFileWithSubpath(fileName, fullSubpath, base64Data, overwrite)
}

func (a *App) importModelFileWithSubpath(fileName, subpath, base64Data string, overwrite bool) error {
	root, _ := a.GetRepoRoot("ysm")
	if root == "" {
		return fmt.Errorf("请先设置文件存储路径")
	}
	ext := strings.ToLower(filepath.Ext(fileName))
	if !types.IsSupportedExt(ext) {
		return types.AppError{Code: types.ErrUnsupportedType, Operation: "导入模型", SourcePath: fileName, Reason: "不支持的文件格式", Suggestion: "支持格式: " + strings.Join(types.AllExts(), " / ")}
	}
	// ysm 包内 json 白名单：.json 仅允许 ysm.json 入口清单（与 go/importer + go/scanner 对齐，ADR-038 D2）
	if ext == ".json" && !types.IsYsmEntryJSON(filepath.Base(fileName)) {
		return types.AppError{Code: types.ErrUnsupportedType, Operation: "导入模型", SourcePath: fileName, Reason: "仅支持 ysm.json 清单文件", Suggestion: "YSM 包内 json 资源（geometry/animation/语言文件）不可单独导入，请导入 .ysm/.zip/.7z 或解压目录中的 ysm.json"}
	}
	data, err := base64.StdEncoding.DecodeString(base64Data)
	if err != nil {
		return types.AppError{Code: types.ErrDecodeFailed, Operation: "导入模型", Reason: "Base64 解码失败", Suggestion: "文件可能已损坏，请重新下载"}
	}
	// 路径穿越防护（对齐 importer_file.go 契约）：
	// - subpath 允许嵌套目录（folder/sub 保持目录结构），逐段拒绝空/. /.. 段
	// - fileName 拒绝 .. 序列与路径分隔符（仅纯文件名）
	if subpath != "" {
		for _, seg := range strings.Split(strings.ReplaceAll(subpath, "\\", "/"), "/") {
			if seg == "" || seg == "." || seg == ".." {
				return types.AppError{Code: types.ErrInvalidPath, Operation: "导入模型", SourcePath: subpath, Reason: "非法子目录路径", Suggestion: "子目录仅支持纯目录名层级"}
			}
		}
	}
	if strings.Contains(fileName, "../") || strings.Contains(fileName, "..\\") || strings.HasSuffix(fileName, "..") {
		return types.AppError{Code: types.ErrFileNameInvalid, Operation: "导入模型", SourcePath: fileName, Reason: "文件名包含路径穿越", Suggestion: "请使用纯文件名，不要包含路径"}
	}
	if strings.ContainsAny(fileName, `\/`) {
		return types.AppError{Code: types.ErrFileNameInvalid, Operation: "导入模型", SourcePath: fileName, Reason: "文件名包含非法路径分隔符", Suggestion: "请使用纯文件名，不要包含路径"}
	}
	if len(data) > types.MaxImportSize {
		// 文案绑定 MaxImportSizeMB 常量——原硬编码 "500MB"
		// 与 MaxImportSize 无绑定，改常量后漂移即编译期暴露
		return types.AppError{Code: types.ErrFileTooLarge, Operation: "导入模型", SourcePath: fileName, Reason: fmt.Sprintf("文件大小超过 %dMB 限制", types.MaxImportSizeMB), Suggestion: fmt.Sprintf("请压缩文件至 %dMB 以内", types.MaxImportSizeMB)}
	}
	if len(data) == 0 {
		return types.AppError{Code: types.ErrFileEmpty, Operation: "导入模型", SourcePath: fileName, Reason: "文件内容为空", Suggestion: "请检查文件是否损坏"}
	}
	destPath := filepath.Join(root, subpath, fileName)
	destDir := filepath.Dir(destPath)
	if err := os.MkdirAll(destDir, 0755); err != nil {
		return types.AppError{Code: types.ErrMkdirFailed, Operation: "导入模型", TargetPath: destDir, Reason: "无法创建目标目录", Suggestion: "请检查磁盘权限或空间"}
	}
	if !overwrite {
		if _, err := os.Stat(destPath); err == nil {
			return types.AppError{Code: types.ErrFileExists, Operation: "导入模型", SourcePath: fileName, Reason: "文件已存在", Suggestion: "如需替换请先删除原文件"}
		}
	}
	// subpath 导入路径复用 importer.WriteFileAtomic——原 `os.WriteFile`
	// 直写目标，磁盘满/IO 中断留半截文件且非覆盖模式再次导入命中 FILE_EXISTS 死锁；
	// 与 ImportFromBase64 的原子写入语义保持一致
	return importer.WriteFileAtomic(destPath, data)
}
