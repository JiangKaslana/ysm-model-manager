package fsutil

import "strings"

// DirPerms 目录标准权限（drwxr-xr-x）：os.MkdirAll 全仓 15+ 处手写 0755 收敛于此。
const DirPerms = 0755

// FilePerms 数据文件标准权限（-rw-r--r--）：os.WriteFile/Chmod 全仓 8 处手写 0644 收敛于此。
const FilePerms = 0644

// illegalNameChars Windows/Linux 文件名非法字符集。
// 单一事实来源——fileops/folder_import 的非法字符检测均委托本常量，
// 防多处硬编码 `\/:*?"<>|` 口径漂移。
const illegalNameChars = `\/:*?"<>|`

// ContainsIllegalNameChar 检测文件名是否含非法字符。
// 单一事实来源——fileops.CreateDir/RenameDir/RenameFile/folder_import.WriteModelFolder
// 的非法字符检测均委托本函数。
func ContainsIllegalNameChar(name string) bool {
	return strings.ContainsAny(name, illegalNameChars)
}
