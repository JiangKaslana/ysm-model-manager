// Package app - 错误 JSON 构建工具
//
// 所有绑定方法统一使用 ErrorJSON / DedupErrorJSON 生成错误响应，
// 避免手工拼接 JSON 导致的转义遗漏（规则：错误字段必须用 json.Marshal）。

package app

import (
	"encoding/json"
	"log"
)

// ErrorJSON 构建带 error 字段的响应 JSON。
// baseFields 为成功时也会包含的字段（如 conflicts、totalConflicts），
// error 作为附加字段注入。序列化失败时返回兜底字符串并记日志。
func ErrorJSON(baseFields map[string]interface{}, errMsg string) string {
	fields := make(map[string]interface{}, len(baseFields)+1)
	for k, v := range baseFields {
		fields[k] = v
	}
	fields["error"] = errMsg
	data, err := json.Marshal(fields)
	if err != nil {
		log.Printf("[ErrorJSON] 序列化失败: %v", err)
		return `{"error":"json marshal failed"}`
	}
	return string(data)
}

// SyncErrorJSON 构建同步操作的错误响应（含 conflicts / totalConflicts 基础字段）。
func SyncErrorJSON(errMsg string) string {
	return ErrorJSON(map[string]interface{}{
		"conflicts":      []interface{}{},
		"totalConflicts": 0,
	}, errMsg)
}

// ResolveErrorJSON 构建冲突解决的操作错误响应（含 resolved / failed / manual 基础字段）。
func ResolveErrorJSON(errMsg string) string {
	return ErrorJSON(map[string]interface{}{
		"resolved": 0,
		"failed":   0,
		"manual":   0,
	}, errMsg)
}

// DedupErrorJSON 构建去重扫描的错误响应（仅含 error 字段，前端契约：DedupGroup[] | {error}）。
// findDuplicateErrorJSON 是其别名，保留向后兼容。
func DedupErrorJSON(errMsg string) string {
	data, err := json.Marshal(map[string]string{"error": errMsg})
	if err != nil {
		log.Printf("[DedupErrorJSON] 序列化失败: %v", err)
		return `{"error":"json marshal failed"}`
	}
	return string(data)
}
