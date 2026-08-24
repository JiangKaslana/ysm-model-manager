// ========== 同步冲突检测与解决（P1 优先级） ==========
package app

import (
	"encoding/json"
	"fmt"
	"log"

	ysmsync "ysm-model-manager/go/sync"
)

// DetectConflicts 检测指定整合包与全局仓库之间的文件冲突
// rtype: 资源类型 ID
// instanceName: 整合包名称
// 返回冲突报告 JSON
func (a *App) DetectConflicts(rtype, instanceName string) string {
	cfg := a.LoadAppConfig()
	if cfg.McRoot == "" {
		return `{"conflicts":[],"totalConflicts":0}`
	}

	globalDir, err := a.filesRootForSync(rtype)
	if err != nil || globalDir == "" {
		return `{"conflicts":[],"totalConflicts":0}`
	}

	targetDir, err := a.findInstanceDir(rtype, instanceName, cfg.McRoot)
	if err != nil || targetDir == "" {
		return `{"conflicts":[],"totalConflicts":0}`
	}

	report, err := ysmsync.DetectConflicts(targetDir, globalDir, rtype)
	if err != nil {
		log.Printf("[conflict] DetectConflicts 失败: %v", err)
		return fmt.Sprintf(`{"error":"%s","conflicts":[],"totalConflicts":0}`, err.Error())
	}

	data, err := json.Marshal(report)
	if err != nil {
		log.Printf("[conflict] JSON 序列化失败: %v", err)
		return `{"error":"JSON 序列化失败","conflicts":[],"totalConflicts":0}`
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
		return `{"resolved":0,"failed":0,"manual":0,"error":"未配置游戏根目录"}`
	}

	globalDir, err := a.filesRootForSync(rtype)
	if err != nil || globalDir == "" {
		return `{"resolved":0,"failed":0,"manual":0,"error":"未找到全局资源目录"}`
	}

	targetDir, err := a.findInstanceDir(rtype, instanceName, cfg.McRoot)
	if err != nil || targetDir == "" {
		return `{"resolved":0,"failed":0,"manual":0,"error":"未找到整合包目录"}`
	}

	// 解析冲突列表
	var conflicts []ysmsync.FileConflict
	if err := json.Unmarshal([]byte(conflictsJSON), &conflicts); err != nil {
		log.Printf("[conflict] 解析冲突列表失败: %v", err)
		return fmt.Sprintf(`{"resolved":0,"failed":0,"manual":0,"error":"解析冲突列表失败: %s"}`, err.Error())
	}

	if len(conflicts) == 0 {
		return `{"resolved":0,"failed":0,"manual":0}`
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
		return fmt.Sprintf(`{"resolved":%d,"failed":%d,"manual":%d}`, resolved, failed, manual)
	}
	return string(data)
}
