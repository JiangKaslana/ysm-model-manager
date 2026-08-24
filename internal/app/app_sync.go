// ========== 同步冲突检测与解决（P1 优先级） ==========
package app

import (
	"encoding/json"
	"log"

	ysmsync "ysm-model-manager/go/sync"
)

// buildSyncErrorJSON 构建带 error 字段的同步操作结果 JSON
// 使用 json.Marshal 安全序列化，避免手工拼接 JSON 导致转义问题
func buildSyncErrorJSON(errMsg string) string {
	data, err := json.Marshal(map[string]interface{}{
		"conflicts":      []interface{}{},
		"totalConflicts": 0,
		"error":          errMsg,
	})
	if err != nil {
		return `{"conflicts":[],"totalConflicts":0,"error":"json marshal failed"}`
	}
	return string(data)
}

// buildResolveErrorJSON 构建带 error 字段的冲突解决结果 JSON
func buildResolveErrorJSON(errMsg string) string {
	data, err := json.Marshal(map[string]interface{}{
		"resolved": 0,
		"failed":   0,
		"manual":   0,
		"error":    errMsg,
	})
	if err != nil {
		return `{"resolved":0,"failed":0,"manual":0,"error":"json marshal failed"}`
	}
	return string(data)
}

// DetectConflicts 检测指定整合包与全局仓库之间的文件冲突
// rtype: 资源类型 ID
// instanceName: 整合包名称
// 返回冲突报告 JSON
func (a *App) DetectConflicts(rtype, instanceName string) string {
	cfg := a.LoadAppConfig()
	if cfg.McRoot == "" {
		return buildSyncErrorJSON("未配置游戏根目录")
	}

	globalDir, err := a.filesRootForSync(rtype)
	if err != nil || globalDir == "" {
		if err != nil {
			log.Printf("[conflict] 获取全局资源目录失败: %v", err)
			return buildSyncErrorJSON("获取全局资源目录失败: " + err.Error())
		}
		return buildSyncErrorJSON("未找到全局资源目录")
	}

	targetDir, err := a.findInstanceDir(rtype, instanceName, cfg.McRoot)
	if err != nil || targetDir == "" {
		if err != nil {
			log.Printf("[conflict] 获取整合包目录失败: %v", err)
			return buildSyncErrorJSON("获取整合包目录失败: " + err.Error())
		}
		return buildSyncErrorJSON("未找到整合包目录: " + instanceName)
	}

	report, err := ysmsync.DetectConflicts(targetDir, globalDir, rtype)
	if err != nil {
		log.Printf("[conflict] DetectConflicts 失败: %v", err)
		return buildSyncErrorJSON("冲突检测失败: " + err.Error())
	}

	data, err := json.Marshal(report)
	if err != nil {
		log.Printf("[conflict] JSON 序列化失败: %v", err)
		return buildSyncErrorJSON("JSON 序列化失败")
	}
	return string(data)
}

// ResolveConflicts 批量解决冲突
// conflictsJSON: 冲突列表 JSON（来自 DetectConflicts）
// defaultStrategy: 默认解决策略 (force_remote/force_local/manual)
// rtype: 资源类型 ID
// instanceName: 整合包名称
// 返回解决结果 JSON
func (a *App) ResolveConflicts(conflictsJSON, defaultStrategy, rtype, instanceName string) string {
	cfg := a.LoadAppConfig()
	if cfg.McRoot == "" {
		return buildResolveErrorJSON("未配置游戏根目录")
	}

	globalDir, err := a.filesRootForSync(rtype)
	if err != nil || globalDir == "" {
		if err != nil {
			log.Printf("[conflict] 获取全局资源目录失败: %v", err)
			return buildResolveErrorJSON("获取全局资源目录失败: " + err.Error())
		}
		return buildResolveErrorJSON("未找到全局资源目录")
	}

	targetDir, err := a.findInstanceDir(rtype, instanceName, cfg.McRoot)
	if err != nil || targetDir == "" {
		if err != nil {
			log.Printf("[conflict] 获取整合包目录失败: %v", err)
			return buildResolveErrorJSON("获取整合包目录失败: " + err.Error())
		}
		return buildResolveErrorJSON("未找到整合包目录: " + instanceName)
	}

	// 解析冲突列表
	var conflicts []ysmsync.FileConflict
	if err := json.Unmarshal([]byte(conflictsJSON), &conflicts); err != nil {
		log.Printf("[conflict] 解析冲突列表失败: %v", err)
		return buildResolveErrorJSON("解析冲突列表失败: " + err.Error())
	}

	if len(conflicts) == 0 {
		data, err := json.Marshal(map[string]int{"resolved": 0, "failed": 0, "manual": 0})
		if err != nil {
			return `{"resolved":0,"failed":0,"manual":0}`
		}
		return string(data)
	}

	// 执行解决
	resolved, failed, manual := ysmsync.ResolveConflicts(
		conflicts,
		ysmsync.ResolutionStrategy(defaultStrategy),
		targetDir,
		globalDir,
	)

	result := map[string]int{
		"resolved": resolved,
		"failed":   failed,
		"manual":   manual,
	}

	data, err := json.Marshal(result)
	if err != nil {
		log.Printf("[conflict] JSON 序列化失败: %v", err)
		return buildResolveErrorJSON("JSON 序列化失败")
	}
	return string(data)
}
