//go:build !race

package types_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestResourceTypesEmbedJSONConsistency 确保 embed.go 编译期内嵌数据与根
// resource_types.json 逐字段一致（历史曾漂移：create-blueprint.name「蓝图」vs「蓝图 / 结构」）。
// 任一方新增/修改资源类型时，另一侧不同步即构建失败。
func TestResourceTypesEmbedJSONConsistency(t *testing.T) {
	// 读取根 resource_types.json
	jsonPath := filepath.Join("..", "..", "resource_types.json")
	raw, err := os.ReadFile(jsonPath)
	if err != nil {
		t.Fatalf("read resource_types.json: %v", err)
	}
	var wrapper struct {
		ResourceTypes []map[string]any `json:"resourceTypes"`
	}
	if err := json.Unmarshal(raw, &wrapper); err != nil {
		t.Fatalf("parse resource_types.json: %v", err)
	}
	fromJSON := wrapper.ResourceTypes

	// 从 embed 源文件提取内嵌 JSON（字符串常量 `` 内容）
	embedPath := filepath.Join("..", "..", "go", "types", "resource_types_embed.go")
	src, err := os.ReadFile(embedPath)
	if err != nil {
		t.Fatalf("read resource_types_embed.go: %v", err)
	}
	embedJSON := extractEmbeddedJSON(string(src))
	if embedJSON == "" {
		t.Fatal("could not extract JSON from resource_types_embed.go")
	}
	var embedWrapper struct {
		ResourceTypes []map[string]any `json:"resourceTypes"`
	}
	if err := json.Unmarshal([]byte(embedJSON), &embedWrapper); err != nil {
		t.Fatalf("parse embed JSON: %v", err)
	}
	fromEmbedSlice := embedWrapper.ResourceTypes

	if len(fromJSON) != len(fromEmbedSlice) {
		t.Fatalf("length mismatch: JSON=%d embed=%d", len(fromJSON), len(fromEmbedSlice))
	}

	// 按 id 建立索引比对
	byID := make(map[string]map[string]any, len(fromJSON))
	for _, item := range fromJSON {
		id, _ := item["id"].(string)
		byID[id] = item
	}
	byIDEmbed := make(map[string]map[string]any, len(fromEmbedSlice))
	for _, item := range fromEmbedSlice {
		id, _ := item["id"].(string)
		byIDEmbed[id] = item
	}

	for id, jv := range byID {
		ev, ok := byIDEmbed[id]
		if !ok {
			t.Errorf("id %q present in JSON but missing in embed", id)
			continue
		}
		jb, _ := json.Marshal(jv)
		eb, _ := json.Marshal(ev)
		if string(jb) != string(eb) {
			t.Errorf("mismatch for id %q\n  JSON:   %s\n  Embed:  %s", id, jb, eb)
		}
	}
	for id := range byIDEmbed {
		if _, ok := byID[id]; !ok {
			t.Errorf("id %q present in embed but missing in JSON", id)
		}
	}
}

// extractEmbeddedJSON 从 resource_types_embed.go 中提取 []byte(`...`) 内的 JSON。
// 找 embeddedRegistryJSON = []byte(`...`) 的模式，返回 “ 之间的内容。
func extractEmbeddedJSON(src string) string {
	const prefix = "embeddedRegistryJSON = []byte("
	idx := strings.Index(src, prefix)
	if idx < 0 {
		return ""
	}
	rest := src[idx+len(prefix):]
	// 去掉开头的反引号
	if len(rest) > 0 && rest[0] == '`' {
		rest = rest[1:]
	}
	// 找结尾的反引号
	end := strings.LastIndex(rest, "`")
	if end < 0 {
		return ""
	}
	return rest[:end]
}
