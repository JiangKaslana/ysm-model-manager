// ===== 文件导入核心（ADR-003 补充下沉）=====
// 从 internal/app/app_install.go 的 importModelFileWithOptions 提取：
// base64 解码 + 类型检测 + 校验 + 写文件；仓库根目录通过 rootFn 回调解析，
// 日志通过 logger 注入（薄壳传 App.logger.Add）。
package importer

import (
	"bytes"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/container"
	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/types"
)

// ZIP/7z 容器魔数（文件头签名）：importFromBuffer 魔数校验与 DetectZipType 扫描共用
var (
	zipLocalHeaderSig = []byte{0x50, 0x4B, 0x03, 0x04} // ZIP local file header（PK\x03\x04）
	sevenZipSig       = []byte{0x37, 0x7A, 0xBC, 0xAF} // 7z 签名（7z\xBC\xAF）
)

// ImportOptions 导入选项
type ImportOptions struct {
	SkipCheck bool // 跳过魔数校验
	Overwrite bool // 允许覆盖已存在文件
}

// ImportLogger 导入日志回调（薄壳注入 App.logger.Add）
type ImportLogger func(name, src, dst string, size int64, status, msg string)

// ImportFromBase64 从 base64 导入模型文件（校验 + 类型检测 + 写文件）
// rootFn 按资源类型返回仓库根目录（薄壳注入 a.GetRepoRoot）
func ImportFromBase64(fileName, base64Data string, opts ImportOptions, rootFn func(rtype string) string, logger ImportLogger) error {
	ext := strings.ToLower(filepath.Ext(fileName))
	if !types.IsSupportedExt(ext) {
		return types.AppError{Code: types.ErrUnsupportedType, Operation: "导入模型", SourcePath: fileName, Reason: "不支持的文件格式"}
	}
	// ysm 包内 json 白名单：.json 仅允许 ysm.json 入口清单，包内 geometry/animation/语言 json 不得单独导入
	// 与 go/scanner/scanner.go 的 ysm.json 白名单对齐（ADR-038 D2）
	if ext == ".json" && !types.IsYsmEntryJSON(filepath.Base(fileName)) {
		return types.AppError{Code: types.ErrUnsupportedType, Operation: "导入模型", SourcePath: fileName, Reason: "仅支持 ysm.json 清单文件", Suggestion: "YSM 包内 json 资源（geometry/animation/语言文件）不可单独导入，请导入 .ysm/.zip/.7z 或解压目录中的 ysm.json"}
	}
	// 路径穿越检测：仅拦截真正的穿越模式（../、..\\、末尾..），
	// 避免误杀 my..file.ysm 等合法文件名（ADR-038 D2）
	if strings.Contains(fileName, "../") || strings.Contains(fileName, "..\\") || strings.HasSuffix(fileName, "..") {
		return types.AppError{Code: types.ErrFileNameInvalid, Operation: "导入模型", SourcePath: fileName, Reason: "文件名包含路径穿越", Suggestion: "请使用纯文件名，不要包含路径"}
	}
	if strings.ContainsAny(fileName, `\/`) {
		return types.AppError{Code: types.ErrFileNameInvalid, Operation: "导入模型", SourcePath: fileName, Reason: "文件名包含非法路径分隔符", Suggestion: "请使用纯文件名，不要包含路径"}
	}
	data, err := base64.StdEncoding.DecodeString(base64Data)
	if err != nil {
		return types.AppError{Code: types.ErrDecodeFailed, Operation: "导入模型", Reason: "Base64 解码失败", Suggestion: "文件可能已损坏，请重新下载"}
	}
	if len(data) > types.MaxImportSize {
		return types.AppError{Code: types.ErrFileTooLarge, Operation: "导入模型", SourcePath: fileName, Reason: "文件大小超过 500MB 限制", Suggestion: "请压缩文件至 500MB 以内"}
	}
	if len(data) == 0 {
		return types.AppError{Code: types.ErrFileEmpty, Operation: "导入模型", SourcePath: fileName, Reason: "文件内容为空", Suggestion: "请检查文件是否损坏"}
	}

	// 类型检测：优先内容检测（ZIP/7z 可能为 YSM/资源包/光影包），回退扩展名匹配
	rtype := ""
	if ext == ".zip" || ext == ".7z" {
		rtype = DetectZipType(data)
	}
	// DetectZipType 无特征返回空（ADR-082 续）：扩展名不属于当前 rtype 注册表扩展名集合时，
	// 用扩展名反查真实类型（ADR-065：扩展名列表注册表驱动，消除手写 .zip/.ysm/.7z/.json
	// 字面量漂移）。反查仍无结果 → 识别不出就是识别不出：明确报错，不假装 YSM 导入。
	if rtype == "" {
		rtypes := types.ExtBelongsTo(ext)
		if len(rtypes) == 1 {
			rtype = rtypes[0]
		}
	}
	if rtype == "" {
		return types.AppError{Code: types.ErrUnsupportedType, Operation: "导入模型", SourcePath: fileName, Reason: "无法识别文件类型", Suggestion: "ZIP/7z 内未找到已知资源特征（pack.mcmeta/shaders/ysm.json/模型后缀等），请确认文件格式或改用桌面端导入"}
	}

	targetRoot := rootFn(rtype)
	if targetRoot == "" {
		return fmt.Errorf("请先设置文件存储路径")
	}

	// 魔数校验
	if !opts.SkipCheck && len(data) >= 4 {
		// logger 为薄壳注入，可能为 nil（如测试/嵌入式调用），nil 时跳过日志不影响导入
		warn := func(msg string) {
			if logger != nil {
				logger(fileName, fileName, targetRoot, 0, "warn", msg)
			}
		}
		if ext == ".zip" || ext == ".ysm" {
			if !bytes.HasPrefix(data, zipLocalHeaderSig) {
				warn("文件头不匹配标准ZIP格式，可能为旧版或非标准YSM文件，已导入")
			}
		} else if ext == ".7z" {
			if !bytes.HasPrefix(data, sevenZipSig) {
				warn("文件头不匹配标准7z格式，已导入")
			}
		}
	}

	destPath := filepath.Join(targetRoot, fileName)
	destDir := filepath.Dir(destPath)
	if err := os.MkdirAll(destDir, fsutil.DirPerms); err != nil {
		return types.AppError{Code: types.ErrMkdirFailed, Operation: "导入模型", TargetPath: destDir, Reason: "无法创建目标目录", Suggestion: "请检查磁盘权限或空间"}
	}
	if !opts.Overwrite {
		if _, err := os.Stat(destPath); err == nil {
			return types.AppError{Code: types.ErrFileExists, Operation: "导入模型", SourcePath: fileName, Reason: "文件已存在", Suggestion: "如需替换请先删除原文件"}
		}
	}
	return WriteFileAtomic(destPath, data)
}

// WriteFileAtomic 已提升至 go/fsutil（ADR-044 策略 A：基础设施工具收敛，tags/logs/fileops 共用）。
// 本处保留 AppError 包装以维持 importer 的结构化错误契约：
// 临时文件创建阶段失败（目录只读/磁盘满）→ MKDIR_FAILED（与 app_install.go:138 兄弟路径一致），
// 其余（写入/关闭/权限/落地）→ WRITE_FAILED。
func WriteFileAtomic(destPath string, data []byte) error {
	if err := fsutil.WriteFileAtomic(destPath, data); err != nil {
		if errors.Is(err, fsutil.ErrTempCreateFailed) {
			return types.AppError{Code: types.ErrMkdirFailed, Operation: "导入模型", TargetPath: filepath.Dir(destPath), Reason: "无法创建临时文件: " + err.Error(), Suggestion: "请检查磁盘权限或空间"}.WithCause(err)
		}
		return types.AppError{Code: types.ErrWriteFailed, Operation: "导入模型", TargetPath: destPath, Reason: "写入失败: " + err.Error(), Suggestion: "请检查磁盘权限或空间"}.WithCause(err)
	}
	return nil
}

// DetectZipType 扫描容器条目名识别资源类型
// 注册表驱动（Top 2）：命中规则来自 resource_types.json 的 zipEntries
// （exact/prefix/suffix 三种模式），新增类型只需改 JSON，无需改检测器。
// ADR-082 续：zip 走 local header 字节扫描（轻量），.7z 走 container 枚举（ADR-068 统一
// 打开）；无特征返回 ""（未知）——不再默认 ysm，识别不出就是识别不出，由调用方决定
// 报错/降级，杜绝「坏文件假装 YSM 模型」。
func DetectZipType(data []byte) string {
	if len(data) >= 4 && bytes.HasPrefix(data, sevenZipSig) {
		// .7z 内容指纹：container.Open7zBytes 枚举条目（ADR-068 统一桥接），
		// 与 zip 分支同走 MatchZipEntry 注册表指纹
		r, err := container.Open7zBytes(data, int64(len(data)))
		if err != nil {
			return ""
		}
		defer r.Close()
		for _, e := range r.Entries() {
			if rtype := types.MatchZipEntry(e.Name()); rtype != "" {
				return rtype
			}
		}
		return ""
	}
	idx := 0
	for idx+30 <= len(data) {
		if !bytes.HasPrefix(data[idx:idx+4], zipLocalHeaderSig) {
			break
		}
		nameLen := int(data[idx+26]) | int(data[idx+27])<<8
		extraLen := int(data[idx+28]) | int(data[idx+29])<<8
		if idx+30+nameLen > len(data) {
			break
		}
		name := strings.ToLower(string(data[idx+30 : idx+30+nameLen]))
		if rtype := types.MatchZipEntry(name); rtype != "" {
			return rtype
		}
		// 跳到下一个 entry（跳过压缩数据）
		compSize := int(data[idx+18]) | int(data[idx+19])<<8 | int(data[idx+20])<<16 | int(data[idx+21])<<24
		idx += 30 + nameLen + extraLen + compSize
	}
	// 无特征返回空（未知）：识别不出就是识别不出，不再假装 YSM
	return ""
}
