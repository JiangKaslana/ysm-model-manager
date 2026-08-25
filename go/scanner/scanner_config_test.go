// ===== scanner 包 0% 覆盖函数补测（SetErrorSink / scanTTL / 配置源收敛 go/config）=====
package scanner

import (
	"testing"
	"time"

	"ysm-model-manager/go/config"
	"ysm-model-manager/go/types"
)

func TestSetErrorSink(t *testing.T) {
	orig := errorSink
	defer func() { errorSink = orig }()

	errorSink = nil
	SetErrorSink(func(msg string) {
		// 记录调用
	})
	if errorSink == nil {
		t.Error("SetErrorSink 后 errorSink 不应为 nil")
	}

	// 覆盖
	called := ""
	SetErrorSink(func(msg string) {
		called = msg
	})
	errorSink("hello")
	if called != "hello" {
		t.Errorf("errorSink 调用未传递消息: got=%q", called)
	}

	// 设 nil
	SetErrorSink(nil)
	if errorSink != nil {
		t.Error("SetErrorSink(nil) 后 errorSink 应为 nil")
	}
}

func TestScanTTL_NilFallback(t *testing.T) {
	config.Set(nil)
	defer config.Set(nil)

	got := scanTTL()
	if got != scanCacheTTL {
		t.Errorf("config=nil 时 scanTTL() = %v, 期望 %v", got, scanCacheTTL)
	}
}

func TestScanTTL_Injected(t *testing.T) {
	config.Set(nil)
	defer config.Set(nil)

	config.Set(func() types.AppConfig {
		return types.AppConfig{ScanCacheTTLMs: 60000} // 60s
	})

	got := scanTTL()
	expected := 60 * time.Second
	if got != expected {
		t.Errorf("注入 ScanCacheTTLMs=60000 后 scanTTL() = %v, 期望 %v", got, expected)
	}
}

func TestScanTTL_ZeroValueFallback(t *testing.T) {
	config.Set(nil)
	defer config.Set(nil)

	config.Set(func() types.AppConfig {
		return types.AppConfig{ScanCacheTTLMs: 0}
	})

	got := scanTTL()
	if got != scanCacheTTL {
		t.Errorf("ScanCacheTTLMs=0 时应回退默认: got=%v, want=%v", got, scanCacheTTL)
	}
}

func TestScanTTL_Override(t *testing.T) {
	config.Set(nil)
	defer config.Set(nil)

	config.Set(func() types.AppConfig {
		return types.AppConfig{ScanCacheTTLMs: 1000}
	})
	if scanTTL() != time.Second {
		t.Error("第一次注入未生效")
	}

	config.Set(func() types.AppConfig {
		return types.AppConfig{ScanCacheTTLMs: 120000}
	})
	got := scanTTL()
	if got != 120*time.Second {
		t.Errorf("覆盖后 scanTTL() = %v, 期望 %v", got, 120*time.Second)
	}
}

func TestScanTTL_NilAfterSet(t *testing.T) {
	config.Set(nil)
	defer config.Set(nil)

	config.Set(func() types.AppConfig {
		return types.AppConfig{ScanCacheTTLMs: 5000}
	})
	config.Set(nil)

	got := scanTTL()
	if got != scanCacheTTL {
		t.Errorf("config.Set(nil) 后应回退: got=%v, want=%v", got, scanCacheTTL)
	}
}
