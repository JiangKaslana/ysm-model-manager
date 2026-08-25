// Package config 运行阈值配置的共享单持有点（ADR-091 D12 收敛）。
//
// 背景：fileops/logs/download/scanner 原各持一份 `var configFunc func() types.AppConfig`，
// 由 internal/app 在 ServiceStartup 注入、运行期任意 goroutine 读取——普通全局变量
// 写读无同步，仅有「写恰发生在启动期单线程」的时序巧合兜底，未来热重载/重注入
// 即数据竞争。此包将配置源收敛到一处 atomic 守卫，四处不再各留副本。
//
// 设计取舍：存 provider 函数（而非 AppConfig 快照指针）。复刻原 configFunc 的
// 「每次读取现拉」语义——SaveThresholds 等运行期写盘后，下一次 Get 立即读到新值，
// 行为零漂移（ADR-062）。若存快照指针，则需在每个写盘点手动重 Store，少一处就静默
// 鬼影（阈值直到重启才更新）。
package config

import (
	"sync/atomic"

	"ysm-model-manager/go/types"
)

// Provider 运行阈值配置源。区别于常见配置注入，这里保持函数形以支持运行期重读。
type Provider func() types.AppConfig

// provider 惰性 nil 哨兵存储在 atomic 中，nil = 未注入（Get 返回零值，消费包回退默认常量）。
var provider atomic.Pointer[Provider]

// Set 注入运行阈值配置源。薄壳 internal/app 启动时调用，取代 4 包各自 SetConfigFunc。
// 传 nil 表示清除注入（测试复位 / 未注入态），Get 回退零值。
func Set(fn Provider) {
	if fn == nil {
		provider.Store(nil)
		return
	}
	provider.Store(&fn)
}

// Get 返回当前 AppConfig。未注入时返回零值，字段 0 由消费包回退各自包级默认常量。
func Get() types.AppConfig {
	if p := provider.Load(); p != nil {
		return (*p)()
	}
	return types.AppConfig{}
}
