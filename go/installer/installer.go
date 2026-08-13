package installer

import (
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/paths"
	"ysm-model-manager/go/types"
)

// InstallLock 防止安装操作与后台同步并发（sync 包复用同一把锁，见 sync.go——
// 原两包各自定义 installLock/syncLock 互不感知，watcher 同步与用户安装可并发
// Rename 同一 custom 目录文件 → 竞态/丢更新；ADR-056 统一为共享单锁）
var InstallLock sync.Mutex

// cleanAbs 封装 filepath.Abs(filepath.Clean(path))
func cleanAbs(path string) string {
	p, err := filepath.Abs(filepath.Clean(path))
	if err != nil {
		log.Printf("[installer] 解析路径失败 %s: %v", path, err)
		return path
	}
	return p
}

// isSupportedModelExt 判断模型文件扩展名是否受支持（含 .ban 变体）
func isSupportedModelExt(src string) bool {
	ext := strings.ToLower(filepath.Ext(src))
	if strings.HasSuffix(strings.ToLower(src), ".ban") {
		ext = strings.ToLower(filepath.Ext(src[:len(src)-4]))
	}
	return types.IsSupportedExt(ext)
}

// Install 安装模型到目标目录（支持链接模式）
func Install(src, customDir, filesRoot, linkMode string) error {
	InstallLock.Lock()
	defer InstallLock.Unlock()
	return InstallLocked(src, customDir, filesRoot, linkMode)
}

// InstallLocked 安装模型到目标目录（调用方须已持有 InstallLock，禁止直接调用）。
// 语义与 Install 一致，但不重复加锁——供 sync.RelinkDir 等已持锁调用方使用（防重入死锁）。
func InstallLocked(src, customDir, filesRoot, linkMode string) error {
	src = strings.TrimSpace(src)
	customDir = strings.TrimSpace(customDir)
	if src == "" || customDir == "" {
		return types.AppError{Code: "INVALID_PARAM", Operation: "安装模型", Reason: "参数为空", Suggestion: "请检查输入"}
	}

	// 🔒 路径清理与安全校验
	srcClean := cleanAbs(src)
	customClean := cleanAbs(customDir)

	// 验证 customDir 在 .minecraft 内（防路径穿越）
	if !paths.ContainsMinecraftMarker(customClean) {
		return types.AppError{Code: "INVALID_PATH", Operation: "安装模型", SourcePath: customDir, Reason: "目标目录不在 .minecraft 路径内", Suggestion: "请确保整合包的 custom 目录位于 .minecraft 内"}
	}
	// 防符号链接段绕过字符串守卫——ContainsMinecraftMarker 不追踪
	// symlink（safe.go:52 注释要求调用方解析），customDir 若含指向 .minecraft 外的符号链接段，
	// 字符串守卫会误判安全。解析真实路径后重新校验；EvalSymlinks 失败（路径不存在）时
	// 保持原校验结果不放宽不放窄（原守卫已通过则继续）
	if resolvedCustom, err := filepath.EvalSymlinks(customClean); err == nil {
		if !paths.ContainsMinecraftMarker(resolvedCustom) {
			return types.AppError{Code: "INVALID_PATH", Operation: "安装模型", SourcePath: customDir, Reason: "目标目录不在 .minecraft 路径内", Suggestion: "请确保整合包的 custom 目录位于 .minecraft 内"}
		}
	}

	// 验证 src 在仓库目录内（防任意文件写入）
	if filesRoot != "" {
		if err := paths.IsInside(filesRoot, srcClean); err != nil {
			return types.AppError{Code: "INVALID_PATH", Operation: "安装模型", SourcePath: src, Reason: "源文件不在仓库目录内", Suggestion: "请确保模型文件位于已选择的仓库目录中"}
		}
		// 防符号链接段绕过字符串守卫——IsInside 不追踪 symlink
		// （safe.go:21 注释要求调用方解析），src 若含指向仓库外的符号链接段会误判安全。
		// 解析真实路径后重新校验；base 也须同步解析——Windows 下 cleanAbs 可能产出 8.3 短名
		// （如 ZHUJIE~1）而 EvalSymlinks 归一化为长名，短/长名混比会让 IsInside 误判越权。
		// 任一侧 EvalSymlinks 失败（路径不存在）时保持原校验结果不放宽不放窄
		if resolvedSrc, err := filepath.EvalSymlinks(srcClean); err == nil {
			if resolvedFiles, err := filepath.EvalSymlinks(filesRoot); err == nil {
				if err := paths.IsInside(resolvedFiles, resolvedSrc); err != nil {
					return types.AppError{Code: "INVALID_PATH", Operation: "安装模型", SourcePath: src, Reason: "源文件不在仓库目录内", Suggestion: "请确保模型文件位于已选择的仓库目录中"}
				}
			}
		}
	}

	if !isSupportedModelExt(src) {
		return types.AppError{Code: "UNSUPPORTED_FORMAT", Operation: "安装模型", SourcePath: src, Reason: "不支持的文件类型", Suggestion: "支持格式: " + strings.Join(types.AllExts(), " / ")}
	}

	// 计算相对路径，保持目录结构
	// 上方 IsInside 已 fail-fast 保证 srcClean 在仓库内，此处直接用 Clean 后路径算 rel，
	// 不用 HasPrefix 二次判断（无分隔符边界校验，/repo 会误匹配 /repository）
	targetDir := customDir
	if filesRoot != "" {
		absFiles := cleanAbs(filesRoot)
		rel, err := filepath.Rel(absFiles, srcClean)
		if err == nil {
			relDir := filepath.Dir(rel)
			if relDir != "." {
				targetDir = filepath.Join(customDir, relDir)
				// 再次校验子目录也在 .minecraft 内
				targetDir = cleanAbs(targetDir)
				if !paths.ContainsMinecraftMarker(targetDir) {
					return types.AppError{Code: "INVALID_PATH", Operation: "安装模型", SourcePath: targetDir, Reason: "子目录不在 .minecraft 路径内", Suggestion: "请确保整合包的 custom 目录位于 .minecraft 内"}
				}
			}
		}
	}

	switch linkMode {
	case "hardlink":
		return linkOrCopyLocked(src, targetDir)
	case "symlink":
		return symlinkOrCopyLocked(src, targetDir)
	default:
		_, err := copyFileLocked(src, targetDir)
		return err
	}
}

// evalSymlinksOrKeep 解析路径中的符号链接段（真实路径），失败时保留原路径。
// paths.IsInside/ContainsMinecraftMarker 不追踪 symlink
// （safe.go:22 注释要求调用方解析）；存在路径解析到目标，不存在路径（目标尚未创建）
// 保留原样——EvalSymlinks 对不存在路径返回错误属正常，不拦截。
func evalSymlinksOrKeep(p string) string {
	if resolved, err := filepath.EvalSymlinks(p); err == nil {
		return resolved
	}
	return p
}

// InstallDir 安装整个目录下的所有文件到目标目录（支持链接模式）
// 用于 MMD/VRC 模型，.pmx/.pmd 文件所在文件夹包含纹理等配套文件
// rtype 用于过滤文件类型（如 MMD 排除 .vrm）
func InstallDir(srcDir, dstDir, filesRoot, linkMode, rtype string) error {
	InstallLock.Lock()
	defer InstallLock.Unlock()
	return InstallDirLocked(srcDir, dstDir, filesRoot, linkMode, rtype)
}

// InstallDirLocked 安装整个目录下的所有文件到目标目录（调用方须已持有 InstallLock，
// 禁止直接调用）。语义与 InstallDir 一致，但不重复加锁——供 sync.RelinkDir 等
// 已持锁调用方使用（防重入死锁）。
func InstallDirLocked(srcDir, dstDir, filesRoot, linkMode, rtype string) error {
	srcDir = strings.TrimSpace(srcDir)
	dstDir = strings.TrimSpace(dstDir)
	if srcDir == "" || dstDir == "" {
		return types.AppError{Code: "INVALID_PARAM", Operation: "安装目录", Reason: "参数为空", Suggestion: "请检查输入"}
	}
	srcDir = cleanAbs(srcDir)
	dstDir = cleanAbs(dstDir)

	// 符号链接绕过字符串守卫——paths.IsInside/ContainsMinecraftMarker
	// 不追踪 symlink（go/paths/safe.go:22 注释明确「调用方应先用 filepath.EvalSymlinks 解析」），
	// src/dst 若含指向仓库外的符号链接段，字符串守卫会误判安全。此处先解析真实路径再校验：
	// 存在的路径解析到目标，不存在的路径保留原样（目标目录尚未创建时 EvalSymlinks 失败属正常）
	srcDir = evalSymlinksOrKeep(srcDir)
	dstDir = evalSymlinksOrKeep(dstDir)
	if filesRoot != "" {
		filesRoot = evalSymlinksOrKeep(filesRoot)
	}

	// 死递归守卫——srcDir==dstDir 时 finalDst 成为 srcDir 的
	// 子目录，os.ReadDir(srcDir) 会列到它 → 递归建 …/repo/repo/… 无限下钻直到路径
	// 超长报错（当前调用方不触发，但属无守卫的定时炸弹）。src/dst 同目录直接拒绝。
	if strings.EqualFold(srcDir, dstDir) {
		return types.AppError{Code: "INVALID_PARAM", Operation: "安装目录", SourcePath: srcDir, Reason: "源目录与目标目录相同"}
	}

	// 验证 dstDir 在 .minecraft 内
	if !paths.ContainsMinecraftMarker(dstDir) {
		return types.AppError{Code: "INVALID_PATH", Operation: "安装目录", SourcePath: dstDir, Reason: "目标目录不在 .minecraft 路径内"}
	}
	// 验证 srcDir 在仓库目录内
	if filesRoot != "" {
		if err := paths.IsInside(filesRoot, srcDir); err != nil {
			return types.AppError{Code: "INVALID_PATH", Operation: "安装目录", SourcePath: srcDir, Reason: "源目录不在仓库目录内"}
		}
	}

	finalDst := filepath.Join(dstDir, filepath.Base(srcDir))
	// finalDst 落在 srcDir 内同样死递归（srcDir 与 dstDir
	// 不同但嵌套时，如 dstDir 是 srcDir 的子目录）——在递归入口再守一道
	if paths.IsInside(srcDir, finalDst) == nil {
		return types.AppError{Code: "INVALID_PATH", Operation: "安装目录", SourcePath: finalDst, Reason: "目标目录位于源目录内（潜在死递归）"}
	}
	// 失败回滚——installDirRecursive 部分失败时删除整树，
	// 防新旧混合状态残留（对齐 go/fileops/fileops.go:412-419 copyDirRecursive 的
	// 整树 os.RemoveAll(dstDir) 回滚）；仅删除「本次新建」的 finalDst，不影响 dstDir
	// 其它内容。重装/覆盖场景下 finalDst 是用户既有数据（MkdirAll 会复用旧目录），
	// 失败时不能整树删除，否则误删旧数据——先记录本次安装前 finalDst 是否已存在
	dstExisted := false
	if _, err := os.Stat(finalDst); err == nil {
		dstExisted = true
	} else if !os.IsNotExist(err) {
		log.Printf("[installer] 检查目标目录状态失败 %s: %v", finalDst, err)
	}
	if err := installDirRecursive(srcDir, finalDst, linkMode, rtype, filesRoot); err != nil {
		// 仅本次新建目录才回滚删除；回滚失败时记录明确警告并返回复合错误，
		// 让调用方能区分「安装失败」与「安装失败 + 回滚失败留残渣」两种状态
		if !dstExisted {
			if rmErr := os.RemoveAll(finalDst); rmErr != nil {
				log.Printf("[installer] 回滚删除失败 %s: %v（磁盘上可能留有部分文件）", finalDst, rmErr)
				return fmt.Errorf("%w; 回滚失败: %v", err, rmErr)
			}
		}
		return err
	}
	return nil
}

// checkDstSymlinkSegments 校验目标路径父链中已存在的符号链接段不越出 .minecraft。
// finalDst 的叶子（本次新建）通常尚不存在、无法整路径 EvalSymlinks，故从叶子向上
// Lstat 逐段检查——若中间组件是指向 .minecraft 外已存在目录的 symlink，MkdirAll
// 会跟随它在真实位置创建目录并写入穿透（字符串守卫 ContainsMinecraftMarker 不追踪
// symlink，会被绕过）。与 src 侧条目级拦截同口径：命中 symlink 时 EvalSymlinks
// 解析真实路径后重新校验。
func checkDstSymlinkSegments(finalDst string) error {
	p := cleanAbs(finalDst)
	for {
		if fi, err := os.Lstat(p); err == nil && fi.Mode()&os.ModeSymlink != 0 {
			if resolved, err := filepath.EvalSymlinks(p); err == nil && !paths.ContainsMinecraftMarker(resolved) {
				return types.AppError{Code: "INVALID_PATH", Operation: "安装目录", SourcePath: p, Reason: "目标父链符号链接指向 .minecraft 外", Suggestion: "请移除指向外部目录的符号链接"}
			}
		}
		parent := filepath.Dir(p)
		if parent == p {
			return nil
		}
		p = parent
	}
}

// installDirRecursive 递归安装目录树
func installDirRecursive(srcDir, finalDst, linkMode, rtype, filesRoot string) error {
	// 目标侧符号链接段校验——必须放在 MkdirAll 之前：MkdirAll 会跟随 symlink
	// 在真实位置建目录，若 finalDst 父链含指向 .minecraft 外的 symlink 段，
	// 先校验拒绝、避免写入穿透
	if err := checkDstSymlinkSegments(finalDst); err != nil {
		return err
	}
	// 目标子目录名 = 源文件夹名
	if err := os.MkdirAll(finalDst, 0755); err != nil {
		return types.AppError{Code: "IO_ERROR", Operation: "安装目录", TargetPath: finalDst, Reason: "无法创建目标目录"}
	}
	// 校验目标也在 .minecraft 内
	finalDst = cleanAbs(finalDst)
	if !paths.ContainsMinecraftMarker(finalDst) {
		return types.AppError{Code: "INVALID_PATH", Operation: "安装目录", SourcePath: finalDst, Reason: "目标子目录不在 .minecraft 路径内"}
	}

	isAllowed := func(name string) bool {
		low := strings.ToLower(name)
		switch rtype {
		case "mmd-skin":
			ext := filepath.Ext(low)
			return ext == ".pmx" || ext == ".pmd" || ext == ".png" || ext == ".tga" || ext == ".spa" || ext == ".sph"
		case "ysm":
			ext := filepath.Ext(low)
			return ext == ".json" || ext == ".png" || ext == ".jpg" || ext == ".jpeg"
		default:
			return true
		}
	}

	entries, err := os.ReadDir(srcDir)
	if err != nil {
		log.Printf("[installer] readdir 失败 %s: %v", srcDir, err)
		return err
	}
	var errs []string
	for _, entry := range entries {
		if entry.IsDir() {
			// 递归处理子目录（MMD 的 spa/textures/toon 等深层子文件夹）
			subSrc := filepath.Join(srcDir, entry.Name())
			subDst := filepath.Join(finalDst, entry.Name())
			if err := installDirRecursive(subSrc, subDst, linkMode, rtype, filesRoot); err != nil {
				log.Printf("[installer] 递归安装 %s 失败: %v (继续)", subSrc, err)
				errs = append(errs, fmt.Sprintf("%s: %v", entry.Name(), err))
			}
			continue
		}
		if !isAllowed(entry.Name()) {
			continue
		}
		srcFile := filepath.Join(srcDir, entry.Name())
		// 条目级符号链接逃逸——仓库内若存在指向仓库外的 symlink
		// （DirEntry.IsDir 对 symlink 恒为 false，指向仓库外目录的 symlink 也会落到本分支），
		// linkMode=symlink 时会把指向仓库外的链接直接落进游戏目录。解析真实路径后按
		// paths.IsInside(filesRoot, …) 校验（与 Install 的 src 守卫同口径），越权则跳过并记录；
		// EvalSymlinks 失败（断链/不存在）时保持放行，交给下方落地逻辑按原语义处理
		if fi, err := os.Lstat(srcFile); err == nil && fi.Mode()&os.ModeSymlink != 0 {
			if resolved, err := filepath.EvalSymlinks(srcFile); err == nil {
				if filesRoot != "" {
					if err := paths.IsInside(filesRoot, resolved); err != nil {
						log.Printf("[installer] 跳过越权符号链接条目 %s (真实目标 %s 不在仓库内): %v", srcFile, resolved, err)
						continue
					}
				}
			}
		}
		switch linkMode {
		case "hardlink":
			if err := linkOrCopyLocked(srcFile, finalDst); err != nil {
				log.Printf("[installer] linkOrCopy 失败 %s: %v (继续)", srcFile, err)
				errs = append(errs, fmt.Sprintf("%s: %v", entry.Name(), err))
			}
		case "symlink":
			if err := symlinkOrCopyLocked(srcFile, finalDst); err != nil {
				log.Printf("[installer] symlinkOrCopy 失败 %s: %v (继续)", srcFile, err)
				errs = append(errs, fmt.Sprintf("%s: %v", entry.Name(), err))
			}
		default:
			if _, err := copyFileLocked(srcFile, finalDst); err != nil {
				log.Printf("[installer] CopyFile 失败 %s: %v (继续)", srcFile, err)
				errs = append(errs, fmt.Sprintf("%s: %v", entry.Name(), err))
			}
		}
	}
	if len(errs) > 0 {
		return fmt.Errorf("安装目录 %s 部分失败: %s", srcDir, strings.Join(errs, "; "))
	}
	return nil
}

// InstallToGlobal 安装到全局 custom 目录
func InstallToGlobal(src, mcRoot string) (string, error) {
	InstallLock.Lock()
	defer InstallLock.Unlock()

	if src == "" || mcRoot == "" {
		return "", types.AppError{Code: "INVALID_PARAM", Operation: "安装到全局", Reason: "参数为空", Suggestion: "请检查输入"}
	}
	mcRoot = cleanAbs(mcRoot)
	if !paths.ContainsMinecraftMarker(mcRoot) {
		return "", types.AppError{Code: "INVALID_PATH", Operation: "安装到全局", SourcePath: mcRoot, Reason: "目标不在 .minecraft 路径内", Suggestion: "请确保 .minecraft 目录路径正确"}
	}
	src = cleanAbs(src)
	if !isSupportedModelExt(src) {
		return "", types.AppError{Code: "UNSUPPORTED_FORMAT", Operation: "安装到全局", SourcePath: src, Reason: "不支持的文件类型", Suggestion: "支持格式: " + strings.Join(types.AllExts(), " / ")}
	}
	// 固定布局约定：YSM mod 的全局模型目录固定在 config/yes_steve_model/custom（mod 加载约定），
	// 非用户可配置项；多实例根场景由上层传入具体 mcRoot，此处仅拼接布局
	customDir := filepath.Join(mcRoot, "config", "yes_steve_model", "custom")
	if err := os.MkdirAll(customDir, 0755); err != nil {
		return "", types.AppError{Code: "IO_ERROR", Operation: "安装到全局", TargetPath: customDir, Reason: "无法创建安装目录", Suggestion: "请检查磁盘权限或空间"}
	}
	return copyFileLocked(src, customDir)
}

// InstallWithOverlay 带冲突检查的安装
func InstallWithOverlay(src, customDir string) (string, error) {
	InstallLock.Lock()
	defer InstallLock.Unlock()

	if src == "" || customDir == "" {
		return "", types.AppError{Code: "INVALID_PARAM", Operation: "安装模型（覆盖检查）", Reason: "参数为空", Suggestion: "请检查输入"}
	}
	src = cleanAbs(src)
	customDir = cleanAbs(customDir)
	if !paths.ContainsMinecraftMarker(customDir) {
		return "", types.AppError{Code: "INVALID_PATH", Operation: "安装模型（覆盖检查）", SourcePath: customDir, Reason: "目标目录不在 .minecraft 路径内", Suggestion: "请确保整合包的 custom 目录位于 .minecraft 内"}
	}
	if !isSupportedModelExt(src) {
		return "", types.AppError{Code: "UNSUPPORTED_FORMAT", Operation: "安装模型（覆盖检查）", SourcePath: src, Reason: "不支持的文件格式", Suggestion: "仅支持 " + strings.Join(types.AllExts(), " / ") + " 格式"}
	}
	if err := os.MkdirAll(customDir, 0755); err != nil {
		return "", types.AppError{Code: "IO_ERROR", Operation: "安装模型（覆盖检查）", TargetPath: customDir, Reason: "无法创建目录", Suggestion: "请检查磁盘权限或空间"}
	}
	// 防覆盖检查：在 InstallLock 临界区内先检查后写入（同一锁内天然原子，无 TOCTOU 窗口）。
	// 不能把检查下沉到 copyFileLocked —— 那会破坏 Install/RelinkDir 的覆盖替换语义
	dst := filepath.Join(customDir, filepath.Base(src))
	if _, err := os.Stat(dst); err == nil {
		return "CONFLICT:" + dst, types.AppError{Code: "ALREADY_EXISTS", Operation: "安装模型（覆盖检查）", TargetPath: dst, Reason: "文件已存在", Suggestion: "如需覆盖请先删除原文件"}
	}
	return copyFileLocked(src, customDir)
}

// copyFileLocked 复制文件到目标目录（调用方须持有 InstallLock，禁止直接调用）
// 原子写入模式：先写入 .copy-tmp 临时文件，再 os.Rename 原子替换目标文件，
// 确保中途崩溃/失败时不留下半截目标文件（进程 kill 后 defer 不执行时仍安全）
func copyFileLocked(src, dstDir string) (string, error) {
	src = cleanAbs(src)
	dstDir = cleanAbs(dstDir)
	if err := os.MkdirAll(dstDir, 0755); err != nil {
		return "", err
	}
	dst := filepath.Join(dstDir, filepath.Base(src))
	if src == dst {
		return dst, nil
	}
	// 原子写入——写 .copy-tmp 再 Rename，进程崩溃无半截目标残留
	tmp := dst + ".copy-tmp"
	_ = os.Remove(tmp)
	ok := false
	defer func() {
		if !ok {
			os.Remove(tmp)
		}
	}()
	in, err := os.Open(src)
	if err != nil {
		return "", types.AppError{Code: "IO_ERROR", Operation: "复制文件", SourcePath: src, Reason: "无法读取源文件", Suggestion: "请检查文件是否被占用或已删除"}
	}
	defer in.Close()
	out, err := os.Create(tmp)
	if err != nil {
		return "", types.AppError{Code: "IO_ERROR", Operation: "复制文件", TargetPath: dst, Reason: "无法创建临时文件", Suggestion: "请检查磁盘空间或权限"}
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close() // 错误路径显式关闭（成功路径在下方 Sync+Close，避免双重关闭）
		return "", types.AppError{Code: "IO_ERROR", Operation: "复制文件", TargetPath: dst, Reason: "写入临时文件失败", Suggestion: "请检查磁盘空间或权限"}
	}
	// Sync 确保数据落盘后再 Close+Rename（注释原承诺 Sync 但未调用，崩溃时可能零长度文件装盘）
	if err := out.Sync(); err != nil {
		out.Close()
		return "", types.AppError{Code: "IO_ERROR", Operation: "复制文件", TargetPath: dst, Reason: "临时文件落盘失败", Suggestion: "请检查磁盘空间或权限"}
	}
	if err := out.Close(); err != nil {
		return "", types.AppError{Code: "IO_ERROR", Operation: "复制文件", TargetPath: dst, Reason: "临时文件写入未完成", Suggestion: "请检查磁盘空间或权限"}
	}
	if err := os.Chmod(tmp, 0644); err != nil {
		log.Printf("[installer] 设置临时文件权限失败 %s: %v", tmp, err)
	}
	if err := os.Rename(tmp, dst); err != nil {
		return "", types.AppError{Code: "IO_ERROR", Operation: "安装模型", SourcePath: src, TargetPath: dst, Reason: "替换目标文件失败", Suggestion: "请检查目标文件是否被占用或为只读"}
	}
	ok = true
	return dst, nil
}

// CopyFile 复制文件到目标目录（带互斥锁）
func CopyFile(src, dstDir string) (string, error) {
	InstallLock.Lock()
	defer InstallLock.Unlock()
	return CopyFileLocked(src, dstDir)
}

// CopyFileLocked 复制文件到目标目录（调用方须已持有 InstallLock，禁止直接调用）。
// 语义与 CopyFile 一致，但不重复加锁——供 sync.RelinkDir 等已持锁调用方使用（防重入死锁）。
func CopyFileLocked(src, dstDir string) (string, error) {
	return copyFileLocked(src, dstDir)
}

// linkOrCopyLocked 以硬链接落地 src 到 dstDir（调用方须持有 InstallLock，禁止直接调用）；
// 目标已存在时：
//   - 同源（已是到 src 的硬链接）→ 幂等返回
//   - 不同源（旧副本/旧版本）→ 先建临时链接再原子替换，失败不破坏原文件
func linkOrCopyLocked(src, dstDir string) error {
	src = cleanAbs(src)
	dstDir = cleanAbs(dstDir)
	if err := os.MkdirAll(dstDir, 0755); err != nil {
		return err
	}
	dst := filepath.Join(dstDir, filepath.Base(src))
	// hardlink 模式：wantSymlink=false——目标若是指向 src 的符号链接则视为不同源，强制转硬链接
	if same, err := sameSource(src, dst, false); err == nil && same {
		return nil
	}
	tmp := dst + ".link-tmp"
	_ = os.Remove(tmp)
	if err := os.Link(src, tmp); err != nil {
		return linkErr(src, dst, err)
	}
	if err := os.Rename(tmp, dst); err != nil {
		_ = os.Remove(tmp)
		return types.AppError{Code: "IO_ERROR", Operation: "安装模型", SourcePath: src, TargetPath: dst, Reason: "替换目标文件失败", Suggestion: "请检查目标文件是否被占用或为只读"}
	}
	return nil
}

// linkOrCopy 以硬链接落地 src 到 dstDir（带互斥锁）
func linkOrCopy(src, dstDir string) error {
	InstallLock.Lock()
	defer InstallLock.Unlock()
	return linkOrCopyLocked(src, dstDir)
}

// symlinkOrCopyLocked 以符号链接落地 src 到 dstDir（调用方须持有 InstallLock，禁止直接调用）；
// 目标已存在时与 linkOrCopyLocked 同语义
func symlinkOrCopyLocked(src, dstDir string) error {
	src = cleanAbs(src)
	dstDir = cleanAbs(dstDir)
	if err := os.MkdirAll(dstDir, 0755); err != nil {
		return err
	}
	// os.Symlink 不要求目标存在，src 缺失时会创建悬空链接并静默返回 nil——
	// 先显式校验 src 存在，缺失时报错而非留下悬空链接
	if _, err := os.Stat(src); err != nil {
		return types.AppError{Code: "IO_ERROR", Operation: "创建符号链接",
			SourcePath: src, Reason: "源文件不存在", Suggestion: "请检查模型文件是否已被删除"}
	}
	dst := filepath.Join(dstDir, filepath.Base(src))
	// symlink 模式：wantSymlink=true——目标若是硬链接则视为不同源，强制转符号链接
	if same, err := sameSource(src, dst, true); err == nil && same {
		return nil
	}
	tmp := dst + ".symlink-tmp"
	_ = os.Remove(tmp)
	if err := os.Symlink(src, tmp); err != nil {
		return symlinkErr(src, dst, err)
	}
	if err := os.Rename(tmp, dst); err != nil {
		_ = os.Remove(tmp)
		return types.AppError{Code: "IO_ERROR", Operation: "安装模型", SourcePath: src, TargetPath: dst, Reason: "替换目标文件失败", Suggestion: "请检查目标文件是否被占用或为只读"}
	}
	return nil
}

// symlinkOrCopy 以符号链接落地 src 到 dstDir（带互斥锁）
func symlinkOrCopy(src, dstDir string) error {
	InstallLock.Lock()
	defer InstallLock.Unlock()
	return symlinkOrCopyLocked(src, dstDir)
}

// sameSource 判断 dst 是否已是 src 的有效落地点（同一文件 / 指向 src 的链接）。
// wantSymlink：hardlink 模式传 false（要求 dst 非符号链接）、symlink 模式传 true
// （要求 dst 是符号链接）——P2 修复（子代理审计）：原实现只用 os.Stat+SameFile，
// 对「dst 是指向 src 的 symlink」与「dst 是 src 的 hardlink」无法区分，hardlink 模式
// 遇 symlink 静默放行不转换、symlink 模式遇 hardlink 也放行，linkMode 语义不落地。
// 不存在、断链或内容不同的旧副本均返回 false 语义（err != nil 或 !same）
func sameSource(src, dst string, wantSymlink bool) (bool, error) {
	dstInfo, err := os.Lstat(dst)
	if err != nil {
		return false, err
	}
	// 链接类型匹配：hardlink 模式拒绝符号链接目标（需转为硬链接）、
	// symlink 模式要求目标是符号链接（硬链接需转为符号链接）
	if wantSymlink != (dstInfo.Mode()&os.ModeSymlink != 0) {
		return false, nil
	}
	si, err := os.Stat(src)
	if err != nil {
		return false, err
	}
	di, err := os.Stat(dst)
	if err != nil {
		return false, err
	}
	return os.SameFile(si, di), nil
}

// errnoIs 按平台匹配 errno：Windows 用 Win32 错误码（如 ERROR_NOT_SAME_DEVICE=17），
// Unix 用 POSIX errno（如 EXDEV=18）——两端语义不同，必须分平台判断
func errnoIs(err error, unix, win int) bool {
	if runtime.GOOS == "windows" {
		return errors.Is(err, syscall.Errno(win))
	}
	return errors.Is(err, syscall.Errno(unix))
}

// linkErr 将硬链接错误分类为可操作的提示
func linkErr(src, dst string, err error) error {
	// errno 优先：跨设备（Unix EXDEV=18 / Win ERROR_NOT_SAME_DEVICE=17）、
	// 权限（Unix EACCES=13 / EPERM=1，Win ERROR_ACCESS_DENIED=5）
	if fsutil.IsCrossDeviceErr(err) {
		return types.AppError{Code: "LINK_FAILED", Operation: "安装模型", SourcePath: src, TargetPath: dst, Reason: "仓库与游戏目录在不同分区，不支持硬链接", Suggestion: "请在设置中切换为复制模式"}
	}
	if errnoIs(err, 13, 5) || errnoIs(err, 1, 5) {
		return types.AppError{Code: "LINK_FAILED", Operation: "安装模型", SourcePath: src, TargetPath: dst, Reason: "权限不足，无法创建硬链接", Suggestion: "请以管理员身份运行，或在设置中切换为复制模式"}
	}
	// 文本兜底（非 errno 包装的异常错误）——注意避免过宽子串："different" 会误伤无关错误，只匹配跨设备特征短语；
	// 仅兜底非 errno 包装的文本错误，errno 判定统一走 fsutil.IsCrossDeviceErr（含 Windows 错误码 17）
	errStr := strings.ToLower(err.Error())
	if strings.Contains(errStr, "cross-device") || strings.Contains(errStr, "different device") || strings.Contains(errStr, "not same device") {
		return types.AppError{Code: "LINK_FAILED", Operation: "安装模型", SourcePath: src, TargetPath: dst, Reason: "仓库与游戏目录在不同分区，不支持硬链接", Suggestion: "请在设置中切换为复制模式"}
	}
	if strings.Contains(errStr, "access") || strings.Contains(errStr, "permission") {
		return types.AppError{Code: "LINK_FAILED", Operation: "安装模型", SourcePath: src, TargetPath: dst, Reason: "权限不足，无法创建硬链接", Suggestion: "请以管理员身份运行，或在设置中切换为复制模式"}
	}
	return types.AppError{Code: "LINK_FAILED", Operation: "安装模型", SourcePath: src, TargetPath: dst, Reason: "硬链接失败", Suggestion: "请在设置中切换为复制模式"}
}

// symlinkErr 将符号链接错误分类为可操作的提示
func symlinkErr(src, dst string, err error) error {
	// errno 优先：权限（Unix EPERM=1 / EACCES=13，Win ERROR_PRIVILEGE_NOT_HELD=1314 / ERROR_ACCESS_DENIED=5）
	if errnoIs(err, 1, 1314) || errnoIs(err, 13, 5) {
		return types.AppError{Code: "LINK_FAILED", Operation: "安装模型", SourcePath: src, TargetPath: dst, Reason: "创建符号链接需要管理员权限", Suggestion: "请以管理员身份运行，或在设置中切换为复制模式"}
	}
	// 文本兜底（非 errno 包装的异常错误）
	errStr := strings.ToLower(err.Error())
	if strings.Contains(errStr, "access") || strings.Contains(errStr, "privilege") || strings.Contains(errStr, "permission") {
		return types.AppError{Code: "LINK_FAILED", Operation: "安装模型", SourcePath: src, TargetPath: dst, Reason: "创建符号链接需要管理员权限", Suggestion: "请以管理员身份运行，或在设置中切换为复制模式"}
	}
	return types.AppError{Code: "LINK_FAILED", Operation: "安装模型", SourcePath: src, TargetPath: dst, Reason: "符号链接失败", Suggestion: "请在设置中切换为复制模式"}
}

// IsValidRepoRoot 禁止选择系统敏感目录作为仓库
// 跨平台实现：禁止根目录、系统关键目录
func IsValidRepoRoot(path string) bool {
	abs, err := filepath.Abs(filepath.Clean(path))
	if err != nil {
		return false
	}

	// 禁止任何盘符根目录（Windows）和根目录 /
	for _, root := range []string{"/", "\\"} {
		if abs == root || strings.TrimRight(abs, "\\/") == "" {
			return false
		}
	}
	// Windows 盘符根目录（C:\ D:\ 等）
	if len(abs) >= 3 && abs[1] == ':' && (abs[2] == '\\' || abs[2] == '/') && len(abs) == 3 {
		return false
	}

	// 系统关键目录（按平台）
	absLower := strings.ToLower(abs) + string(filepath.Separator)
	var forbidden []string
	if runtime.GOOS == "windows" {
		// Windows 系统目录
		for _, drive := range []string{"c:", "d:", "e:"} {
			prefix := drive + string(filepath.Separator)
			forbidden = append(forbidden,
				prefix+"windows"+string(filepath.Separator),
				prefix+"program files"+string(filepath.Separator),
				prefix+"program files (x86)"+string(filepath.Separator),
			)
		}
	} else {
		// Linux/macOS 系统目录
		forbidden = []string{
			"/etc" + string(filepath.Separator),
			"/usr" + string(filepath.Separator),
			"/bin" + string(filepath.Separator),
			"/sbin" + string(filepath.Separator),
			"/var" + string(filepath.Separator),
			"/dev" + string(filepath.Separator),
			"/proc" + string(filepath.Separator),
			"/sys" + string(filepath.Separator),
			"/System" + string(filepath.Separator),
			"/private" + string(filepath.Separator),
		}
	}

	for _, f := range forbidden {
		if strings.HasPrefix(absLower, f) || strings.EqualFold(abs, strings.TrimRight(f, string(filepath.Separator))) {
			return false
		}
	}

	return true
}
