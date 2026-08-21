//go:build android

package app

import (
	"errors"
	"os"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/fsutil"
)

// androidPathManager Android 实现：应用沙盒私有目录
// Android 上 os.UserConfigDir() 依赖 HOME/XDG_CONFIG_HOME 环境变量，通常未设置会报错；
// 应用私有目录（沙盒，无需存储权限）是配置/日志/标签的唯一可靠落点。
// 用户资源（模型仓库）走 DefaultRepoRoot 公共路径——授权 MANAGE_EXTERNAL_STORAGE
// 后 os.* 直读，对齐 MikuMikuAR /sdcard/MMD 查看器模式（ADR-046 P2）。
type androidPathManager struct{}

// androidSandboxDir 返回应用沙盒私有目录 /data/data/<pkg>/files。
// Wails v3 运行时不注入 HOME/XDG 也不 chdir（application_android.go nativeInit
// 仅存 bridge 引用，ADR-047 审核确认），Go 侧无从获取 Context.getFilesDir()；
// 包名从 /proc/self/cmdline 首字段解析（Android 进程名 = applicationId）。
// 读取失败返回 ""，交由 AppDataRoot 候选回退链处理。
func androidSandboxDir() string {
	raw, err := os.ReadFile("/proc/self/cmdline")
	if err != nil {
		return ""
	}
	// cmdline 以 NUL 分隔，首字段为进程名（= 包名，如 com.ysm.modelmanager）
	pkg := raw
	if i := strings.IndexByte(string(raw), 0); i >= 0 {
		pkg = raw[:i]
	}
	if len(pkg) == 0 {
		return ""
	}
	return filepath.Join("/data/data", string(pkg), "files")
}

// AppDataRoot 按候选序返回第一个可写目录；全不可写返回错误——
// 直接返回 HOME/Getwd 可能退化为不可写的文件系统根 "/"（P2 审核发现），
// 配置/标签将静默不落盘；显式报错让 appDataRoot 兜底，杜绝假成功
func (androidPathManager) AppDataRoot() (string, error) {
	var candidates []string
	// 沙盒私有目录优先：无权限依赖、应用私有，Android 上唯一可靠落点
	if d := androidSandboxDir(); d != "" {
		candidates = append(candidates, d)
	}
	if home := os.Getenv("HOME"); home != "" {
		candidates = append(candidates, home)
	}
	if d, err := os.UserConfigDir(); err == nil && d != "" {
		candidates = append(candidates, d)
	}
	if wd, err := os.Getwd(); err == nil && wd != "" {
		candidates = append(candidates, wd)
	}
	for _, dir := range candidates {
		if writableDir(dir) {
			return dir, nil
		}
	}
	return "", errors.New("pathmgr: Android 无可写配置目录（沙盒注入缺失）")
}

// DefaultRepoRoot Android 固定公共仓库根：外部存储根 + 应用名。
// 外部存储根运行时解析（EXTERNAL_STORAGE 环境变量，Android 多用户场景指向
// 当前用户的 /storage/emulated/<userId>），硬编码 /storage/emulated/0 仅作兜底。
// MANAGE_EXTERNAL_STORAGE 授权后（requestStoragePermission 引导），Go os.* 可直读
// 该路径；用户把模型放入该目录即可当查看器使用——无需目录选择器（Wails 官方拒绝
// Android 目录对话框，见 ADR-046 §2 中阻方案修正）。
func (androidPathManager) DefaultRepoRoot() string {
	// Android 系统注入的外部存储根（多用户下为当前用户路径）；空时回退主用户路径
	if ext := os.Getenv("EXTERNAL_STORAGE"); ext != "" {
		return filepath.Join(ext, "YSM-Model-Manager")
	}
	return "/storage/emulated/0/YSM-Model-Manager"
}

// writableDir 可写性探针：MkdirAll 对已存在目录不报错（即使不可写），
// 必须以实际写文件验证——CreateTemp 成功即证明可写，随即清理
func writableDir(dir string) bool {
	if err := os.MkdirAll(dir, fsutil.DirPerms); err != nil {
		return false
	}
	probe, err := os.CreateTemp(dir, ".ysm-probe-*")
	if err != nil {
		return false
	}
	_ = probe.Close()
	_ = os.Remove(probe.Name())
	return true
}

func init() {
	pathMgr = androidPathManager{}
}
