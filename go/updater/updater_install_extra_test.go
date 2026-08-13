// ===== go/updater InstallUpdate exe 直装安全错误路径补测 =====
// 只测「在触碰真实 exe 前返回错误」的路径（v1.13.0 起纯 exe 发布，
// Release 资产为裸 exe，InstallUpdate 直接校验下载的 exe 文件）：
// 1. 更新包文件不存在 → 打开失败报错
// 2. 更新包内容非 PE 魔数（非 "MZ" 开头）→ PE 校验失败报错
// 绝不执行到真实替换 / helper 启动 / os.Exit 路径。
package updater

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// makeFakeExe 构造一个内容非 PE 的临时更新包文件，返回其路径
func makeFakeExe(t *testing.T, content string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "YSM-Model-Manager_windows_amd64.exe")
	if err := os.WriteFile(p, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
	return p
}

// TestInstallUpdate_MissingFile 覆盖更新包文件不存在：应在 PE 校验前报打开失败
func TestInstallUpdate_MissingFile(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("仅 Windows")
	}
	missing := filepath.Join(t.TempDir(), "no-such-update.exe")
	err := InstallUpdate(missing)
	if err == nil {
		t.Fatal("更新包不存在应报错")
	}
	if !strings.Contains(err.Error(), "打开更新包失败") {
		t.Errorf("错误信息应指向打开失败, got %v", err)
	}
}

// TestInstallUpdate_NotPE 覆盖更新包存在但内容非 PE 魔数：
// PE 校验失败提前返回，不触碰真实 exe
func TestInstallUpdate_NotPE(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("仅 Windows")
	}
	p := makeFakeExe(t, "this is not a PE binary")
	err := InstallUpdate(p)
	if err == nil {
		t.Fatal("非 PE 内容的更新包应报错")
	}
	if !strings.Contains(err.Error(), "有效 Windows 程序") {
		t.Errorf("错误信息应提示 PE 校验失败, got %v", err)
	}
}
