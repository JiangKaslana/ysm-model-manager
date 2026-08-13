// ========== 日志（拆分自 app_install.go）==========
// 从 app_install.go 拆分：日志相关函数
package app

import "ysm-model-manager/go/types"

// ========== 日志 ==========
func (a *App) AddImportLog(modelName, sourcePath, targetDir string, fileSize int64, status, errMsg string) {
	a.logger.Add(modelName, sourcePath, targetDir, fileSize, status, errMsg)
}

func (a *App) AddOpLog(op, modelName, sourcePath, targetDir string, fileSize int64, status, errMsg string) {
	a.logger.AddOp(op, modelName, sourcePath, targetDir, fileSize, status, errMsg)
}

func (a *App) GetImportLogs() []types.ImportLog {
	return a.logger.GetAll()
}

func (a *App) ClearImportLogs() {
	a.logger.Clear()
}

// GetRuntimeLogs 获取运行时日志（watcher/sync 等标准库 log 输出）
func (a *App) GetRuntimeLogs() []types.RuntimeLog {
	return a.runtimeLogs.GetAll()
}

// ClearRuntimeLogs 清空运行时日志缓冲
func (a *App) ClearRuntimeLogs() {
	a.runtimeLogs.Clear()
}
