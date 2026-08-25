package logs

import (
	"sync"
	"testing"
)

// 并发交错压力：Add/GetAll/Flush/Clear 多 goroutine 混跑不死锁、-race 干净，
// 终态条数精确 = 写入总数。守护 save 锁外落盘后的锁序约束
// （save 内部 saveMu→mu；任何调用方持 mu 时调 save 即死锁，此测试第一时间暴露）
func TestLogger_ConcurrentAccess(t *testing.T) {
	dir := t.TempDir()
	l := NewLogger(dir)

	const workers, rounds = 8, 50
	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < rounds; j++ {
				l.Add("model", "src", "dst", 1, "ok", "")
				_ = l.GetAll()
				if j%10 == 0 {
					l.Flush()
				}
			}
		}()
	}
	wg.Wait()

	l.Flush()
	if got := len(l.GetAll()); got != workers*rounds {
		t.Fatalf("并发写入后条数 = %d, 期望 %d", got, workers*rounds)
	}

	// 清空后立即读盘验证：Clear 的落盘仍是同步语义（返回即已落盘）
	l.Clear()
	reloaded := NewLogger(dir)
	if n := len(reloaded.GetAll()); n != 0 {
		t.Fatalf("Clear 后重载日志条数 = %d, 期望 0", n)
	}
}
