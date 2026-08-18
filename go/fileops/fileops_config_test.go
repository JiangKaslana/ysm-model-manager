// ===== fileops 包 0% 覆盖函数补测（SetConfigFunc / previewReadLimit）=====
package fileops

import (
	"testing"

	"ysm-model-manager/go/types"
)

func TestSetConfigFunc_NilFallback(t *testing.T) {
	// 保存原始值
	orig := configFunc
	configFunc = nil
	defer func() { configFunc = orig }()

	// configFunc=nil 时应回退默认值 maxPreviewRead (50MB)
	got := previewReadLimit()
	if got != maxPreviewRead {
		t.Errorf("configFunc=nil 时 previewReadLimit() = %d, 期望 %d", got, maxPreviewRead)
	}
}

func TestSetConfigFunc_Injected(t *testing.T) {
	orig := configFunc
	defer func() { configFunc = orig }()

	// 注入自定义配置
	SetConfigFunc(func() types.AppConfig {
		return types.AppConfig{PreviewReadLimitMB: 100}
	})

	got := previewReadLimit()
	expected := int64(100) << 20
	if got != expected {
		t.Errorf("注入 PreviewReadLimitMB=100 后 previewReadLimit() = %d, 期望 %d", got, expected)
	}
}

func TestSetConfigFunc_ZeroValueFallback(t *testing.T) {
	orig := configFunc
	defer func() { configFunc = orig }()

	// 注入但字段为 0 → 应回退默认
	SetConfigFunc(func() types.AppConfig {
		return types.AppConfig{PreviewReadLimitMB: 0}
	})

	got := previewReadLimit()
	if got != maxPreviewRead {
		t.Errorf("PreviewReadLimitMB=0 时应回退默认: got=%d, want=%d", got, maxPreviewRead)
	}
}

func TestSetConfigFunc_Override(t *testing.T) {
	orig := configFunc
	defer func() { configFunc = orig }()

	// 先注入一个值
	SetConfigFunc(func() types.AppConfig {
		return types.AppConfig{PreviewReadLimitMB: 50}
	})
	if previewReadLimit() != int64(50)<<20 {
		t.Error("第一次注入未生效")
	}

	// 再覆盖
	SetConfigFunc(func() types.AppConfig {
		return types.AppConfig{PreviewReadLimitMB: 200}
	})
	got := previewReadLimit()
	if got != int64(200)<<20 {
		t.Errorf("覆盖后 previewReadLimit() = %d, 期望 %d", got, int64(200)<<20)
	}
}

func TestSetConfigFunc_NilAfterSet(t *testing.T) {
	orig := configFunc
	defer func() { configFunc = orig }()

	SetConfigFunc(func() types.AppConfig {
		return types.AppConfig{PreviewReadLimitMB: 75}
	})
	// 再设为 nil
	SetConfigFunc(nil)

	got := previewReadLimit()
	if got != maxPreviewRead {
		t.Errorf("SetConfigFunc(nil) 后应回退默认: got=%d, want=%d", got, maxPreviewRead)
	}
}
