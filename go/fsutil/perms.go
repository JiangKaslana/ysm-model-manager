package fsutil

// DirPerms 目录标准权限（drwxr-xr-x）：os.MkdirAll 全仓 15+ 处手写 0755 收敛于此。
const DirPerms = 0755

// FilePerms 数据文件标准权限（-rw-r--r--）：os.WriteFile/Chmod 全仓 8 处手写 0644 收敛于此。
const FilePerms = 0644
