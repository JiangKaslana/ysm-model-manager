package types

// ParseDedupConfig / ParseSyncConfig 统一配置入口测试：
// 空串 → nil,nil（未配置）；合法 JSON → 字段正确；非法 JSON → 错误。

import (
	"strings"
	"testing"
)

func TestParseDedupConfig(t *testing.T) {
	t.Run("空串返回 nil 未配置", func(t *testing.T) {
		cfg, err := ParseDedupConfig("")
		if err != nil {
			t.Fatalf("空串不应报错: %v", err)
		}
		if cfg != nil {
			t.Errorf("空串应返回 nil, got %+v", cfg)
		}
	})

	t.Run("合法 JSON 解析字段", func(t *testing.T) {
		cfg, err := ParseDedupConfig(`{"strategy":"quick_hash","keepPolicy":"newest","priorityPath":"D:/a"}`)
		if err != nil {
			t.Fatalf("合法 JSON 应解析成功: %v", err)
		}
		if cfg.Strategy != "quick_hash" || cfg.KeepPolicy != "newest" || cfg.PriorityPath != "D:/a" {
			t.Errorf("字段解析错误: %+v", cfg)
		}
	})

	t.Run("非法 JSON 返回错误", func(t *testing.T) {
		if _, err := ParseDedupConfig("{bad"); err == nil {
			t.Error("非法 JSON 应返回错误")
		}
	})
}

func TestParseSyncConfig(t *testing.T) {
	t.Run("空串返回 nil 未配置", func(t *testing.T) {
		cfg, err := ParseSyncConfig("")
		if err != nil {
			t.Fatalf("空串不应报错: %v", err)
		}
		if cfg != nil {
			t.Errorf("空串应返回 nil, got %+v", cfg)
		}
	})

	t.Run("合法 JSON 解析字段", func(t *testing.T) {
		cfg, err := ParseSyncConfig(`{"autoSync":true,"conflictPolicy":"force_remote"}`)
		if err != nil {
			t.Fatalf("合法 JSON 应解析成功: %v", err)
		}
		if !cfg.AutoSync || cfg.ConflictPolicy != "force_remote" {
			t.Errorf("字段解析错误: %+v", cfg)
		}
	})

	t.Run("非法 JSON 返回错误", func(t *testing.T) {
		if _, err := ParseSyncConfig(`{"autoSync":}`); err == nil ||
			!strings.Contains(err.Error(), "invalid") {
			t.Errorf("非法 JSON 应返回错误, got %v", err)
		}
	})
}