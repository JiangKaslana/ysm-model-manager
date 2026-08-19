package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"ysm-model-manager/internal/app"
)

func init() {
	RegisterCommand("concurrent-bench", "并发能力基准测试（串行 vs 并行对比）", runConcurrentBench)
}

// concurrentBenchResult 并发测试结果
type concurrentBenchResult struct {
	Name        string
	Duration    time.Duration
	WorkerCount int
	Speedup     float64
}

// runConcurrentBench 运行并发基准测试
func runConcurrentBench(a *app.App, args []string) error {
	fs := flag.NewFlagSet("concurrent-bench", flag.ExitOnError)
	workers := fs.Int("workers", 4, "并发 worker 数量")
	maxModels := fs.Int("max-models", 20, "最多测试的模型数量")
	parseFlags(fs, args)

	filesRoot := parseFilesRoot(args)

	fmt.Println("⚡ 并发能力基准测试")
	fmt.Println(strings.Repeat("=", 70))
	fmt.Printf("   Worker 数量: %d\n", *workers)
	fmt.Printf("   最大模型数:   %d\n", *maxModels)
	fmt.Println(strings.Repeat("=", 70))

	// 1. 扫描模型
	fmt.Println("\n📊 Phase 0: 准备测试数据...")
	entries := a.ScanModelEntries(filesRoot)
	if len(entries) == 0 {
		return fmt.Errorf("未找到任何模型")
	}

	// 过滤 YSM 模型
	var ysmModels []string
	for _, e := range entries {
		ext := strings.ToLower(filepath.Ext(e.Path))
		if ext == ".ysm" {
			ysmModels = append(ysmModels, e.Path)
		}
	}

	if len(ysmModels) == 0 {
		// 如果没有 YSM，用其他模型
		for _, e := range entries {
			ysmModels = append(ysmModels, e.Path)
			if len(ysmModels) >= *maxModels {
				break
			}
		}
	} else if len(ysmModels) > *maxModels {
		ysmModels = ysmModels[:*maxModels]
	}

	fmt.Printf("   测试模型数: %d\n", len(ysmModels))
	fmt.Println()

	// 2. 串行测试
	fmt.Println(strings.Repeat("-", 70))
	fmt.Println("📊 Phase 1: 串行模型分析")
	fmt.Println(strings.Repeat("-", 70))

	serialResult := benchSerialAnalyze(a, ysmModels)
	fmt.Printf("   串行耗时: %.2fms\n", float64(serialResult.Duration.Microseconds())/1000)
	fmt.Printf("   平均/模型: %.2fms\n", float64(serialResult.Duration.Microseconds())/1000/float64(len(ysmModels)))

	// 3. 并行测试（不同 worker 数）
	fmt.Println()
	fmt.Println(strings.Repeat("-", 70))
	fmt.Println("📊 Phase 2: 并行模型分析")
	fmt.Println(strings.Repeat("-", 70))

	var parallelResults []concurrentBenchResult
	workerCounts := []int{2, 4, *workers}
	if *workers < 4 {
		workerCounts = []int{2, *workers}
	}

	for _, wc := range workerCounts {
		result := benchParallelAnalyze(a, ysmModels, wc)
		result.Speedup = float64(serialResult.Duration) / float64(result.Duration)
		parallelResults = append(parallelResults, result)

		speedupStr := fmt.Sprintf("%.1fx", result.Speedup)
		if result.Speedup >= 1.5 {
			speedupStr = "🟢 " + speedupStr
		} else if result.Speedup >= 1.2 {
			speedupStr = "🟡 " + speedupStr
		} else {
			speedupStr = "🔴 " + speedupStr
		}

		fmt.Printf("   Workers=%d: %.2fms (加速比: %s)\n",
			result.WorkerCount,
			float64(result.Duration.Microseconds())/1000,
			speedupStr)
	}

	// 4. 文件读取并发测试
	fmt.Println()
	fmt.Println(strings.Repeat("-", 70))
	fmt.Println("📊 Phase 3: 并发文件读取")
	fmt.Println(strings.Repeat("-", 70))

	collectFiles := collectTestFiles(filesRoot, 50)
	if len(collectFiles) > 0 {
		fileResult := benchParallelRead(collectFiles, *workers)
		serialFileResult := benchSerialRead(collectFiles)

		fmt.Printf("   文件数: %d\n", len(collectFiles))
		fmt.Printf("   串行: %.2fms\n", float64(serialFileResult.Microseconds())/1000)
		fmt.Printf("   并行(%d workers): %.2fms\n", *workers, float64(fileResult.Microseconds())/1000)
		fmt.Printf("   加速比: %.1fx\n", float64(serialFileResult)/float64(fileResult))
	}

	// 5. 汇总报告
	fmt.Println()
	fmt.Println(strings.Repeat("-", 70))
	fmt.Println("📊 汇总报告")
	fmt.Println(strings.Repeat("-", 70))

	printConcurrentReport(serialResult, parallelResults)

	return nil
}

// benchSerialAnalyze 串行分析模型
func benchSerialAnalyze(a *app.App, models []string) concurrentBenchResult {
	start := time.Now()

	for _, path := range models {
		_ = a.AnalyzeBedrockModel(path)
	}

	return concurrentBenchResult{
		Name:     "serial",
		Duration: time.Since(start),
	}
}

// benchParallelAnalyze 并行分析模型
func benchParallelAnalyze(a *app.App, models []string, workers int) concurrentBenchResult {
	start := time.Now()

	modelCh := make(chan string, len(models))
	resultCh := make(chan time.Duration, len(models))

	var wg sync.WaitGroup

	// 启动 worker
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for path := range modelCh {
				s := time.Now()
				_ = a.AnalyzeBedrockModel(path)
				resultCh <- time.Since(s)
			}
		}()
	}

	// 发送任务
	for _, path := range models {
		modelCh <- path
	}
	close(modelCh)

	// 收集结果
	go func() {
		wg.Wait()
		close(resultCh)
	}()

	var totalWork time.Duration
	var modelCount int
	for d := range resultCh {
		totalWork += d
		modelCount++
	}

	elapsed := time.Since(start)
	_ = totalWork
	_ = modelCount

	return concurrentBenchResult{
		Name:        fmt.Sprintf("parallel-%d", workers),
		Duration:    elapsed,
		WorkerCount: workers,
	}
}

// collectTestFiles 收集测试文件
func collectTestFiles(root string, maxSize int64) []string {
	var files []string
	count := 0

	filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if !info.IsDir() && info.Size() > 0 && info.Size() < maxSize*1024*1024 {
			ext := strings.ToLower(filepath.Ext(path))
			if ext == ".ysm" || ext == ".json" || ext == ".zip" || ext == ".7z" {
				files = append(files, path)
				count++
				if count >= 30 {
					return filepath.SkipAll
				}
			}
		}
		return nil
	})

	return files
}

// benchSerialRead 串行读取文件
func benchSerialRead(files []string) time.Duration {
	start := time.Now()

	for _, f := range files {
		_, _ = os.ReadFile(f)
	}

	return time.Since(start)
}

// benchParallelRead 并行读取文件
func benchParallelRead(files []string, workers int) time.Duration {
	start := time.Now()

	fileCh := make(chan string, len(files))
	var wg sync.WaitGroup

	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for f := range fileCh {
				_, _ = os.ReadFile(f)
			}
		}()
	}

	for _, f := range files {
		fileCh <- f
	}
	close(fileCh)

	wg.Wait()
	return time.Since(start)
}

// printConcurrentReport 打印并发测试报告
func printConcurrentReport(serial concurrentBenchResult, parallel []concurrentBenchResult) {
	fmt.Println()
	fmt.Println("📈 性能对比表:")
	fmt.Printf("   %-20s %-15s %-12s %s\n", "方案", "耗时", "加速比", "状态")
	fmt.Println("   " + strings.Repeat("-", 60))
	fmt.Printf("   %-20s %-15s %-12s %s\n",
		"串行",
		fmt.Sprintf("%.2fms", float64(serial.Duration.Microseconds())/1000),
		"1.00x",
		"🟢 基准")

	for _, p := range parallel {
		var status string
		switch {
		case p.Speedup >= 2.0:
			status = "🟢 优秀"
		case p.Speedup >= 1.5:
			status = "🟢 良好"
		case p.Speedup >= 1.2:
			status = "🟡 一般"
		default:
			status = "🔴 无提升"
		}

		fmt.Printf("   %-20s %-15s %-12s %s\n",
			fmt.Sprintf("并行(%d workers)", p.WorkerCount),
			fmt.Sprintf("%.2fms", float64(p.Duration.Microseconds())/1000),
			fmt.Sprintf("%.2fx", p.Speedup),
			status)
	}

	// 建议
	fmt.Println()
	fmt.Println("💡 并发建议:")
	best := parallel[0]
	for _, p := range parallel {
		if p.Speedup > best.Speedup {
			best = p
		}
	}

	if best.Speedup >= 1.5 {
		fmt.Printf("   ✅ 推荐使用 %d workers，可获得 %.1fx 加速\n", best.WorkerCount, best.Speedup)
		fmt.Println("   💡 适合场景: 批量模型分析、并行文件处理")
	} else if best.Speedup >= 1.2 {
		fmt.Printf("   ⚠️  并发提升有限（%.1fx），当前 I/O 可能是瓶颈\n", best.Speedup)
		fmt.Println("   💡 建议: 检查磁盘 I/O，可能需要 SSD")
	} else {
		fmt.Println("   🔴 并发无明显提升")
		fmt.Println("   💡 原因: 单线程已能跑满，或 I/O 成为瓶颈")
	}

	// Go 并发特性说明
	fmt.Println()
	fmt.Println("📚 Go 并发知识点:")
	fmt.Println("   - goroutine: 轻量级协程，创建成本低（KB 级）")
	fmt.Println("   - channel: goroutine 间通信，支持缓冲/无缓冲")
	fmt.Println("   - sync.WaitGroup: 等待一组 goroutine 完成")
	fmt.Println("   - 工作池模式: 固定数量 worker 处理任务队列")
	fmt.Println()
	fmt.Println("   本次使用的模式: 工作池 + channel + WaitGroup")
	fmt.Println("   优势: 控制并发数，避免 goroutine 爆炸")
}
