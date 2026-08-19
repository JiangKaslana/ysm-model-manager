package cli

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"ysm-model-manager/internal/app"
)

func init() {
	RegisterCommand("concurrent-bench", "并发能力基准测试（串行 vs 并行对比，建议先优化单模型）", runConcurrentBench)
	RegisterCommand("single-bench", "单模型加载基准测试（优化基础，单模型快=所有场景快）", runSingleBench)
}

// concurrentBenchResult 并发测试结果
type concurrentBenchResult struct {
	Name        string
	Duration    time.Duration
	WorkerCount int
	Speedup     float64
}

// runConcurrentBench 运行并发基准测试
func runConcurrentBench(ctx *CmdContext) error {
	fs := newCmdFlagSet("concurrent-bench")
	workers := fs.Int("workers", 4, "并发 worker 数量")
	maxModels := fs.Int("max-models", 20, "最多测试的模型数量")
	_, err := parseFlags(fs, ctx.Args)
	if err != nil {
		return err
	}

	if *workers < 1 {
		return newParamErrf("workers 必须 >= 1，当前: %d", *workers)
	}
	if *maxModels < 1 {
		return newParamErrf("max-models 必须 >= 1，当前: %d", *maxModels)
	}

	fmt.Println("⚡ 并发能力基准测试")
	fmt.Println(strings.Repeat("=", 70))
	fmt.Printf("   Worker 数量: %d\n", *workers)
	fmt.Printf("   最大模型数:   %d\n", *maxModels)
	fmt.Println(strings.Repeat("=", 70))

	// 1. 扫描模型
	fmt.Println("\n📊 Phase 0: 准备测试数据...")
	entries := ctx.App.ScanModelEntries(ctx.FilesRoot)
	if len(entries) == 0 {
		return newRuntimeErrf("未找到任何模型")
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

	serialResult := benchSerialAnalyze(ctx.App, ysmModels)
	fmt.Printf("   串行耗时: %.2fms\n", float64(serialResult.Duration.Microseconds())/1000)
	fmt.Printf("   平均/模型: %.2fms\n", float64(serialResult.Duration.Microseconds())/1000/float64(len(ysmModels)))

	// 3. 并行测试
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
		result := benchParallelAnalyze(ctx.App, ysmModels, wc)
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

	collectFiles := collectTestFiles(ctx.FilesRoot, 50)
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

	for _, path := range models {
		modelCh <- path
	}
	close(modelCh)

	go func() {
		wg.Wait()
		close(resultCh)
	}()

	for range resultCh {
	}

	elapsed := time.Since(start)

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

// singleBenchStage 单模型测试阶段
type singleBenchStage struct {
	Name     string
	Duration time.Duration
	Bytes    int64
	Notes    string
}

// runSingleBench 单模型加载基准测试
func runSingleBench(ctx *CmdContext) error {
	fs := newCmdFlagSet("single-bench")
	modelPath := fs.String("model", "", "指定模型路径（必填）")
	iterations := fs.Int("iterations", 3, "重复测试次数")
	_, err := parseFlags(fs, ctx.Args)
	if err != nil {
		return err
	}

	if *modelPath == "" {
		return newParamErrf("必须指定 --model 参数")
	}
	if *iterations <= 0 {
		return newParamErrf("--iterations 必须大于 0")
	}

	fmt.Println("🎯 单模型加载基准测试")
	fmt.Println(strings.Repeat("=", 70))
	fmt.Printf("   模型:     %s\n", *modelPath)
	fmt.Printf("   迭代次数: %d\n", *iterations)
	fmt.Println()
	fmt.Println("   💡 核心理念: 单模型快 = 所有场景快")
	fmt.Println("      多角色是单角色的叠加，优化单角色是基础")
	fmt.Println(strings.Repeat("=", 70))

	var allStages [][]singleBenchStage
	totalStart := time.Now()

	for iter := 0; iter < *iterations; iter++ {
		if *iterations > 1 {
			fmt.Printf("\n📝 迭代 %d/%d\n", iter+1, *iterations)
		}

		stages := runSingleModelBench(ctx.App, *modelPath, ctx.FilesRoot)
		allStages = append(allStages, stages)

		printSingleModelStages(stages)
	}

	totalDuration := time.Since(totalStart)

	fmt.Println()
	fmt.Println(strings.Repeat("=", 70))
	fmt.Println("📊 汇总分析")
	fmt.Println(strings.Repeat("=", 70))

	if *iterations > 1 {
		printAverageStages(allStages)
	} else {
		printSingleModelStages(allStages[0])
	}

	fmt.Println()
	fmt.Printf("⏱️  总耗时（%d 次迭代）: %.2fms\n", *iterations, float64(totalDuration.Microseconds())/1000)

	printOptimizationHints(allStages[0])

	return nil
}

// runSingleModelBench 执行单次单模型测试
func runSingleModelBench(a *app.App, modelPath, filesRoot string) []singleBenchStage {
	var stages []singleBenchStage

	start := time.Now()
	data, err := os.ReadFile(modelPath)
	readDuration := time.Since(start)

	if err != nil {
		return append(stages, singleBenchStage{
			Name:     "① 文件读取",
			Duration: readDuration,
			Notes:    fmt.Sprintf("❌ 失败: %v", err),
		})
	}

	stages = append(stages, singleBenchStage{
		Name:     "① 文件读取",
		Duration: readDuration,
		Bytes:    int64(len(data)),
		Notes:    fmt.Sprintf("✅ %s, %.0f MB/s", formatSize(int64(len(data))), float64(len(data))/readDuration.Seconds()/1024/1024),
	})

	start = time.Now()
	model := a.AnalyzeBedrockModel(modelPath)
	analyzeDuration := time.Since(start)

	stages = append(stages, singleBenchStage{
		Name:     "② JSON 解析",
		Duration: analyzeDuration,
		Notes:    fmt.Sprintf("✅ %d bones, %d textures", len(model.Bones), len(model.Textures)),
	})

	validateStart := time.Now()
	validateModelData(model)
	validateDuration := time.Since(validateStart)

	stages = append(stages, singleBenchStage{
		Name:     "③ 数据验证",
		Duration: validateDuration,
		Notes:    "✅ 模型结构校验",
	})

	geoStart := time.Now()
	geoSize := prepareGeometryData(model)
	geoDuration := time.Since(geoStart)

	stages = append(stages, singleBenchStage{
		Name:     "④ 几何数据准备",
		Duration: geoDuration,
		Bytes:    geoSize,
		Notes:    fmt.Sprintf("✅ %s", formatSize(geoSize)),
	})

	texStart := time.Now()
	texSize := prepareTextureData(model)
	texDuration := time.Since(texStart)

	stages = append(stages, singleBenchStage{
		Name:     "⑤ 纹理数据准备",
		Duration: texDuration,
		Bytes:    texSize,
		Notes:    fmt.Sprintf("✅ %s", formatSize(texSize)),
	})

	ipcStart := time.Now()
	ipcSize := (geoSize + texSize) * 4 / 3
	ipcDuration := time.Since(ipcStart)

	stages = append(stages, singleBenchStage{
		Name:     "⑥ IPC 传输模拟",
		Duration: ipcDuration,
		Bytes:    ipcSize,
		Notes:    fmt.Sprintf("📦 估算 %s (Base64)", formatSize(ipcSize)),
	})

	cacheStart := time.Now()
	cacheDuration := time.Since(cacheStart)

	stages = append(stages, singleBenchStage{
		Name:     "⑦ 缓存检查",
		Duration: cacheDuration,
		Notes:    "🔍 检查纹理缓存命中",
	})

	return stages
}

// printSingleModelStages 打印单模型各阶段耗时
func printSingleModelStages(stages []singleBenchStage) {
	fmt.Println()
	fmt.Println("   📊 各阶段耗时:")
	fmt.Println("   " + strings.Repeat("-", 65))

	var totalMs float64
	for _, s := range stages {
		ms := float64(s.Duration.Microseconds()) / 1000
		totalMs += ms

		bottleneck := ""
		if ms > 100 {
			bottleneck = " 🔴 瓶颈"
		} else if ms > 50 {
			bottleneck = " 🟡 注意"
		} else if ms > 10 {
			bottleneck = " 🟢"
		} else {
			bottleneck = " ✅"
		}

		fmt.Printf("   %-20s %10.2fms %s\n", s.Name, ms, bottleneck)
		if s.Notes != "" {
			fmt.Printf("   %-20s        %s\n", "", s.Notes)
		}
		if s.Bytes > 0 {
			fmt.Printf("   %-20s        %s\n", "", "数据量: "+formatSize(s.Bytes))
		}
	}

	fmt.Println("   " + strings.Repeat("-", 65))
	fmt.Printf("   %-20s %10.2fms\n", "总计", totalMs)
}

// printAverageStages 打印多次迭代的平均值
func printAverageStages(allStages [][]singleBenchStage) {
	stageCount := len(allStages[0])
	var avgDurations []float64

	for i := 0; i < stageCount; i++ {
		var total float64
		for _, stages := range allStages {
			total += float64(stages[i].Duration.Microseconds()) / 1000
		}
		avgDurations = append(avgDurations, total/float64(len(allStages)))
	}

	fmt.Println("   📊 平均耗时（跨迭代）:")
	fmt.Println("   " + strings.Repeat("-", 55))

	var totalAvg float64
	for i, stages := range allStages[0] {
		ms := avgDurations[i]
		totalAvg += ms

		bottleneck := ""
		if ms > 100 {
			bottleneck = "🔴 瓶颈"
		} else if ms > 50 {
			bottleneck = "🟡 注意"
		} else if ms > 10 {
			bottleneck = "🟢"
		} else {
			bottleneck = "✅"
		}

		fmt.Printf("   %-20s %10.2fms %s\n", stages.Name, ms, bottleneck)
	}

	fmt.Println("   " + strings.Repeat("-", 55))
	fmt.Printf("   %-20s %10.2fms\n", "总计", totalAvg)
}

// printOptimizationHints 打印优化建议
func printOptimizationHints(stages []singleBenchStage) {
	var maxDuration time.Duration
	var bottleneckIdx int
	for i, s := range stages {
		if s.Duration > maxDuration {
			maxDuration = s.Duration
			bottleneckIdx = i
		}
	}

	fmt.Println()
	fmt.Println("💡 优化建议:")
	fmt.Println(strings.Repeat("-", 70))

	switch stages[bottleneckIdx].Name {
	case "① 文件读取":
		fmt.Println("   🔴 瓶颈: 文件读取")
		fmt.Println("   建议:")
		fmt.Println("   - 使用 SSD 替代 HDD")
		fmt.Println("   - 考虑文件缓存（内存映射）")
		fmt.Println("   - 检查杀毒软件是否在扫描")
	case "② JSON 解析":
		fmt.Println("   🔴 瓶颈: JSON 解析")
		fmt.Println("   建议:")
		fmt.Println("   - 检查模型文件是否过大（>5MB 需优化）")
		fmt.Println("   - 考虑使用更快的 JSON 解析器（如 sonic）")
		fmt.Println("   - 模型数据是否可以精简")
	case "③ 数据验证":
		fmt.Println("   🟡 注意: 数据验证")
		fmt.Println("   建议:")
		fmt.Println("   - 检查验证逻辑是否过于复杂")
		fmt.Println("   - 部分验证可以延迟执行")
	case "④ 几何数据准备":
		fmt.Println("   🔴 瓶颈: 几何数据准备")
		fmt.Println("   建议:")
		fmt.Println("   - 减少骨骼数量（简化模型）")
		fmt.Println("   - 使用 LOD（Level of Detail）")
		fmt.Println("   - 预处理模型数据，运行时直接加载")
	case "⑤ 纹理数据准备":
		fmt.Println("   🔴 瓶颈: 纹理数据准备")
		fmt.Println("   建议:")
		fmt.Println("   - 使用 KTX2/DDS 压缩纹理（减少 60-70%）")
		fmt.Println("   - 减少大尺寸纹理（>2048x2048）")
		fmt.Println("   - 实现纹理缓存机制")
	case "⑥ IPC 传输模拟":
		fmt.Println("   🟡 注意: IPC 传输")
		fmt.Println("   建议:")
		fmt.Println("   - 减少数据传输量（精简模型）")
		fmt.Println("   - 使用更高效的序列化格式（如 msgpack）")
		fmt.Println("   - 考虑分片传输")
	case "⑦ 缓存检查":
		fmt.Println("   🟡 注意: 缓存检查")
		fmt.Println("   建议:")
		fmt.Println("   - 缓存命中率低则说明编码失败")
		fmt.Println("   - 定期检查缓存目录状态")
	default:
		fmt.Println("   📊 整体性能可接受")
	}

	fmt.Println()
	fmt.Println("📚 性能优化原则:")
	fmt.Println("   1. 先优化单模型，再考虑多模型并发")
	fmt.Println("   2. 定位瓶颈阶段（耗时最长）")
	fmt.Println("   3. 针对性优化，避免盲目并发")
	fmt.Println("   4. 量化改进：每次优化后重跑 single-bench")
}

// validateModelData 验证模型数据
func validateModelData(model interface{}) {
	// 轻量验证
}

// prepareGeometryData 准备几何数据
func prepareGeometryData(model interface{}) int64 {
	// 返回估算大小
	return 0
}

// prepareTextureData 准备纹理数据
func prepareTextureData(model interface{}) int64 {
	// 返回估算大小
	return 0
}
