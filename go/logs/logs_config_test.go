// ===== logs 包 0% 覆盖函数补测（logMaxEntries / logMaxFieldLen / logCorruptRetentionDays / 配置源收敛 go/config）=====
package logs

import (
	"testing"

	"ysm-model-manager/go/config"
	"ysm-model-manager/go/types"
)

func TestLogLimits_NilFallback(t *testing.T) {
	config.Set(nil)
	defer config.Set(nil)

	if got := logMaxEntries(); got != maxLogEntries {
		t.Errorf("config=nil 时 logMaxEntries() = %d, 期望 %d", got, maxLogEntries)
	}
	if got := logMaxFieldLen(); got != maxFieldLen {
		t.Errorf("config=nil 时 logMaxFieldLen() = %d, 期望 %d", got, maxFieldLen)
	}
	if got := logCorruptRetentionDays(); got != corruptRetentionDays {
		t.Errorf("config=nil 时 logCorruptRetentionDays() = %d, 期望 %d", got, corruptRetentionDays)
	}
}

func TestLogLimits_Injected(t *testing.T) {
	config.Set(nil)
	defer config.Set(nil)

	config.Set(func() types.AppConfig {
		return types.AppConfig{
			LogMaxEntries:           1000,
			LogMaxFieldLen:          2048,
			LogCorruptRetentionDays: 14,
		}
	})

	if got := logMaxEntries(); got != 1000 {
		t.Errorf("logMaxEntries() = %d, 期望 1000", got)
	}
	if got := logMaxFieldLen(); got != 2048 {
		t.Errorf("logMaxFieldLen() = %d, 期望 2048", got)
	}
	if got := logCorruptRetentionDays(); got != 14 {
		t.Errorf("logCorruptRetentionDays() = %d, 期望 14", got)
	}
}

func TestLogLimits_ZeroValueFallback(t *testing.T) {
	config.Set(nil)
	defer config.Set(nil)

	config.Set(func() types.AppConfig {
		return types.AppConfig{
			LogMaxEntries:           0,
			LogMaxFieldLen:          0,
			LogCorruptRetentionDays: 0,
		}
	})

	if got := logMaxEntries(); got != maxLogEntries {
		t.Errorf("LogMaxEntries=0 时应回退: got=%d, want=%d", got, maxLogEntries)
	}
	if got := logMaxFieldLen(); got != maxFieldLen {
		t.Errorf("LogMaxFieldLen=0 时应回退: got=%d, want=%d", got, maxFieldLen)
	}
	if got := logCorruptRetentionDays(); got != corruptRetentionDays {
		t.Errorf("LogCorruptRetentionDays=0 时应回退: got=%d, want=%d", got, corruptRetentionDays)
	}
}

func TestLogLimits_Override(t *testing.T) {
	config.Set(nil)
	defer config.Set(nil)

	config.Set(func() types.AppConfig {
		return types.AppConfig{LogMaxEntries: 50}
	})
	if logMaxEntries() != 50 {
		t.Error("第一次注入未生效")
	}

	config.Set(func() types.AppConfig {
		return types.AppConfig{LogMaxEntries: 999}
	})
	if got := logMaxEntries(); got != 999 {
		t.Errorf("覆盖后 logMaxEntries() = %d, 期望 999", got)
	}
}

func TestLogLimits_NilAfterSet(t *testing.T) {
	config.Set(nil)
	defer config.Set(nil)

	config.Set(func() types.AppConfig {
		return types.AppConfig{LogMaxEntries: 777}
	})
	config.Set(nil)

	if got := logMaxEntries(); got != maxLogEntries {
		t.Errorf("config.Set(nil) 后应回退: got=%d, want=%d", got, maxLogEntries)
	}
}
