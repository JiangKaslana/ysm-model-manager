// 对抗测试：fileops 路径安全边界——RemoveDir 零校验、FindPreviewImage 任意路径读、
// root="" 绕过写入函数、NUL 字节注入
package fileops

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// =====================================================================
// RemoveDir 零校验——CRITICAL
// =====================================================================

// ---------- 1. RemoveDir 接受相对路径穿越 ----------
func TestRemoveDir_RelativeTraversal(t *testing.T) {
	tmpDir := t.TempDir()
	inner := filepath.Join(tmpDir, "inner")
	os.MkdirAll(inner, 0755)
	os.WriteFile(filepath.Join(inner, "file.ysm"), []byte("test"), 0644)

	origWD, _ := os.Getwd()
	t.Cleanup(func() { _ = os.Chdir(origWD) })
	_ = os.Chdir(inner)

	err := RemoveDir("..")
	// Windows 上 os.RemoveAll(".") 失败（不能删除当前目录）——
	// 但关键发现是：RemoveDir 未拒绝相对路径，直接传给 OS。
	// Linux 上 ".." 会成功删除父目录。
	if err != nil {
		t.Logf("BUG(INFO-TRAVERSAL): RemoveDir 接受相对路径穿越（\"..\"），OS 层拒绝: %v——RemoveDir 自身无校验", err)
		return
	}
	// Linux: tmpDir 被删除
	if _, err := os.Stat(tmpDir); os.IsNotExist(err) {
		t.Logf("BUG(INFO-TRAVERSAL): RemoveDir(\"..\") 成功删除了父目录（Linux 无阻止）")
	} else {
		t.Logf("INFO(INFO-TRAVERSAL): RemoveDir(\"..\") 执行, tmpDir exists=%v", err == nil)
	}
}

// ---------- 2. RemoveDir 接受绝对路径 ----------
func TestRemoveDir_AbsolutePath(t *testing.T) {
	tmpDir := t.TempDir()
	subdir := filepath.Join(tmpDir, "target")
	os.MkdirAll(subdir, 0755)
	os.WriteFile(filepath.Join(subdir, "file.ysm"), []byte("test"), 0644)

	// RemoveDir 接受任何绝对路径——无 root 归属校验
	err := RemoveDir(subdir)
	if err != nil {
		t.Fatalf("RemoveDir 绝对路径失败: %v", err)
	}
	t.Logf("BUG(INFO-ABS): RemoveDir 接受任意绝对路径（无 root 校验）——攻击者可指定任何目录删除")
}

// ---------- 3. RemoveDir NUL 字节 ----------
func TestRemoveDir_NULByte(t *testing.T) {
	tmpDir := t.TempDir()
	os.MkdirAll(filepath.Join(tmpDir, "empty_subdir"), 0755)

	// NUL 字节注入——OS 层会拒绝，但 RemoveDir 自身无显式校验
	err := RemoveDir(tmpDir + "\x00" + "..\\evil")
	if err != nil {
		t.Logf("FIXED(INFO-NUL): RemoveDir NUL 字节被 OS 层拒绝: %v（但 RemoveDir 无显式校验）", err)
		return
	}
	t.Log("BUG(INFO-NUL): RemoveDir NUL 字节未报错（Linux 可能静默截断）")
}

// =====================================================================
// FindPreviewImage 任意路径读——HIGH
// =====================================================================

// ---------- 4. FindPreviewImage 读取任意路径的 preview.png ----------
func TestFindPreviewImage_ArbitraryPathRead(t *testing.T) {
	// FindPreviewImage 无 root 校验，任意路径可被读取。
	// 攻击者传入系统路径下的模型路径，可读取该目录下的 preview.png
	tmpDir := t.TempDir()
	// 在 tmpDir 内创建"任意位置"的 preview.png
	secretDir := filepath.Join(tmpDir, "secret")
	os.MkdirAll(secretDir, 0755)
	os.WriteFile(filepath.Join(secretDir, "preview.png"), []byte("SECRET_PREVIEW"), 0644)

	modelPath := filepath.Join(secretDir, "model.ysm")
	result := FindPreviewImage(modelPath)
	if result == "" {
		t.Fatal("FindPreviewImage 应返回 preview.png 内容")
	}
	if strings.Contains(result, "SECRET_PREVIEW") {
		t.Logf("BUG(INFO-READ): FindPreviewImage 接受任意路径，读取了非模型目录内的 preview.png——无 root 归属校验")
	}
}

// ---------- 5. FindPreviewImage 空路径 ----------
func TestFindPreviewImage_EmptyPath(t *testing.T) {
	result := FindPreviewImage("")
	// filepath.Dir("") = "."，会从 CWD 查找预览图
	t.Logf("INFO(INFO-EMPTY): FindPreviewImage(\"\") 返回 %q（从 CWD 查找，无报错）", result)
}

// =====================================================================
// CreateDir root="" 绕过——HIGH
// =====================================================================

// ---------- 6. CreateDir root="" 在任意位置创建目录 ----------
func TestCreateDir_EmptyRoot(t *testing.T) {
	// CreateDir("", "subdir")——root="" 时在 CWD 下创建，无 root 归属校验
	// tmpDir 不参与本测试（测试重点在 root="" 绕过）
	err := CreateDir("", "subdir")
	if err != nil {
		t.Logf("INFO(INFO-EMPTY-ROOT): CreateDir(\"\") 被拒绝: %v", err)
		return
	}
	t.Logf("BUG(INFO-EMPTY-ROOT): CreateDir(\"\", \"subdir\") 成功——在 CWD 下创建目录，无 root 归属校验")
	// 清理
	os.RemoveAll("subdir")
}

// =====================================================================
// RenameDir 无 oldPath 校验——MEDIUM
// =====================================================================

// ---------- 7. RenameDir 接受任意 oldPath ----------
func TestRenameDir_ArbitraryOldPath(t *testing.T) {
	tmpDir := t.TempDir()
	oldDir := filepath.Join(tmpDir, "old")
	os.MkdirAll(oldDir, 0755)
	os.WriteFile(filepath.Join(oldDir, "file.ysm"), []byte("test"), 0644)

	// RenameDir 不校验 oldPath 来源——攻击者可指定任意目录重命名
	err := RenameDir(oldDir, "newname")
	if err != nil {
		t.Fatalf("RenameDir 任意 oldPath 失败: %v", err)
	}
	newDir := filepath.Join(tmpDir, "newname")
	if _, err := os.Stat(newDir); err == nil {
		t.Logf("BUG(INFO-OLD-PATH): RenameDir 接受任意 oldPath，成功重命名")
	}
}

// =====================================================================
// ExtractPreviewTexture 任意路径读——HIGH
// =====================================================================

// ---------- 8. ExtractPreviewTexture 读取任意 .zip ----------
func TestExtractPreviewTexture_ArbitraryZipRead(t *testing.T) {
	tmpDir := t.TempDir()
	// 创建任意 .zip 文件（含 PNG）
	zipPath := filepath.Join(tmpDir, "arbitrary.zip")
	// 用合法 zip 写入
	f, err := os.Create(zipPath)
	if err != nil {
		t.Fatal(err)
	}
	// 写最小 zip 头部（PK + 无效 body——extractFirstPNGFromZip 返回 nil）
	f.Write([]byte("PK\x03\x04"))
	f.Close()

	// ExtractPreviewTexture 应接受此路径
	result := ExtractPreviewTexture(zipPath)
	t.Logf("INFO(INFO-ZIP): ExtractPreviewTexture 接受任意 .zip 路径, result=%q（无效 zip 返回空）", result)
}

// ---------- 9. ExtractPreviewTexture NUL 字节 ----------
func TestExtractPreviewTexture_NULByte(t *testing.T) {
	tmpDir := t.TempDir()
	badPath := filepath.Join(tmpDir, "file.ysm") + "\x00" + ".zip"
	result := ExtractPreviewTexture(badPath)
	if result != "" {
		t.Logf("BUG(INFO-NUL-TEX): ExtractPreviewTexture 接受 NUL 字节路径")
		return
	}
	t.Log("FIXED/INFO(INFO-NUL-TEX): ExtractPreviewTexture 返回空（OS 层或读文件失败）")
}
