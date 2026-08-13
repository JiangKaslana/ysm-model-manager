// ========== 安装 + 回收站（主文件，保留核心安装逻辑）==========
// 从原 app_install.go 拆分：核心安装函数与绑定入口
package app

// app_install.go 已拆分为多个子文件：
//   - app_install_import.go: 导入相关函数
//   - app_install_recycle.go: 回收站相关函数
//   - app_install_instance.go: 实例相关函数
//   - app_install_link.go: 链接模式相关函数
//   - app_install_log.go: 日志相关函数
