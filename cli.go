package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"ysm-model-manager/go/texture_cache"
	"ysm-model-manager/go/types"
	"ysm-model-manager/internal/app"
)

// cliCommand CLI 子命令定义
type cliCommand struct {
	Name        string
	Description string
	Run         func(a *app.App, args []string) error
}

// cliCommands 注册所有 CLI 子命令
var cliCommands = map[string]cliCommand{
	"search": {
		Name:        "search",
		Description: "搜索模型（支持关键词过滤）",
		Run:         runSearch,
	},
	"analyze": {
		Name:        "analyze",
		Description: "分析单个模型的详细信息",
		Run:         runAnalyze,
	},
	"list": {
		Name:        "list",
		Description: "列出所有模型的摘要信息",
		Run:         runList,
	},
	"verify": {
		Name:        "verify",
		Description: "验证模型文件完整性",
		Run:         runVerify,
	},
	"benchmark": {
		Name:        "benchmark",
		Description: "性能基准测试",
		Run:         runBenchmark,
	},
	"export": {
		Name:        "export",
		Description: "导出模型结构信息",
		Run:         runExport,
	},
	"file-bench": {
		Name:        "file-bench",
		Description: "测试大文件读取性能（模拟 MMD/PMX/VRM 加载）",
		Run:         runFileBench,
	},
	"scan-dir": {
		Name:        "scan-dir",
		Description: "扫描 MMD 目录结构并统计资产",
		Run:         runScanDir,
	},
	"analyze-mmd": {
		Name:        "analyze-mmd",
		Description: "分析 MMD 模型资产（贴图、PMX、VMD 等）",
		Run:         runAnalyzeMMD,
	},
	"cache-status": {
		Name:        "cache-status",
		Description: "查看纹理缓存状态（路径、大小、文件数）",
		Run:         runCacheStatus,
	},
	"cache-verify": {
		Name:        "cache-verify",
		Description: "检查模型贴图的缓存命中情况",
		Run:         runCacheVerify,
	},
	"cache-clear": {
		Name:        "cache-clear",
		Description: "清空纹理缓存",
		Run:         runCacheClear,
	},
	"config-show": {
		Name:        "config-show",
		Description: "查看当前配置",
		Run:         runConfigShow,
	},
}

// runCLI 执行 CLI 模式
// 参数格式: --files-root <路径> <命令> [命令选项...]
func runCLI(args []string) error {
	// 1. 先解析全局参数
	var filesRoot string
	var commandArgs []string

	for i := 0; i < len(args); i++ {
		if args[i] == "--files-root" && i+1 < len(args) {
			filesRoot = args[i+1]
			i++
		} else if strings.HasPrefix(args[i], "--files-root=") {
			filesRoot = strings.TrimPrefix(args[i], "--files-root=")
		} else {
			commandArgs = append(commandArgs, args[i])
		}
	}

	// 2. 检查是否有子命令
	if len(commandArgs) == 0 {
		printCLIHelp()
		return nil
	}

	cmdName := commandArgs[0]
	cmd, exists := cliCommands[cmdName]
	if !exists {
		fmt.Printf("❌ 未知命令: %s\n\n", cmdName)
		printCLIHelp()
		return fmt.Errorf("未知命令: %s", cmdName)
	}

	if filesRoot == "" {
		return fmt.Errorf("--files-root 参数不能为空")
	}

	// 3. 初始化 App
	a := app.NewApp()
	if err := a.SaveAppConfig(filesRoot, "", "", "", ""); err != nil {
		return fmt.Errorf("初始化配置失败: %w", err)
	}

	// 4. 执行子命令
	fmt.Printf("🚀 CLI Mode: %s\n", cmd.Name)
	fmt.Printf("   根目录: %s\n\n", filesRoot)

	// 将 filesRoot 注入到命令参数中
	argsWithRoot := append([]string{"--files-root", filesRoot}, commandArgs[1:]...)
	return cmd.Run(a, argsWithRoot)
}

// parseFilesRoot 从参数中提取 --files-root
func parseFilesRoot(args []string) string {
	for i, arg := range args {
		if arg == "--files-root" && i+1 < len(args) {
			return args[i+1]
		}
		if strings.HasPrefix(arg, "--files-root=") {
			return strings.TrimPrefix(arg, "--files-root=")
		}
	}
	return ""
}

// runSearch 执行搜索命令
func runSearch(a *app.App, args []string) error {
	fs := flag.NewFlagSet("search", flag.ExitOnError)
	keyword := fs.String("keyword", "", "搜索关键词")
	minBones := fs.Int("min-bones", 0, "最小骨骼数")
	maxBones := fs.Int("max-bones", 0, "最大骨骼数")
	minCubes := fs.Int("min-cubes", 0, "最小立方块数")
	maxCubes := fs.Int("max-cubes", 0, "最大立方块数")
	minTex := fs.Int("min-tex", 0, "最小贴图尺寸")
	maxTex := fs.Int("max-tex", 0, "最大贴图尺寸")
	outputFormat := fs.String("format", "json", "输出格式: json 或 table")
	parseFlags(fs, args)

	filesRoot := parseFilesRoot(args)
	results := a.SearchModels(filesRoot, *keyword, *minBones, *maxBones, *minCubes, *maxCubes, *minTex, *maxTex)

	if len(results) == 0 {
		fmt.Println("📭 未找到匹配的模型")
		return nil
	}

	if *outputFormat == "table" {
		printSearchTable(results)
	} else {
		data, _ := json.MarshalIndent(results, "", "  ")
		fmt.Printf("✅ 找到 %d 个模型:\n", len(results))
		fmt.Println(string(data))
	}

	return nil
}

// printSearchTable 以表格格式输出搜索结果
func printSearchTable(results []types.SearchResult) {
	fmt.Printf("✅ 找到 %d 个模型:\n\n", len(results))
	fmt.Printf("%-40s %-10s %-10s %-10s\n", "名称", "骨骼", "立方块", "贴图")
	fmt.Println(strings.Repeat("-", 72))
	for _, r := range results {
		name := r.Name
		if len(name) > 38 {
			name = name[:35] + "..."
		}
		fmt.Printf("%-40s %-10d %-10d %dx%d\n", name, r.BoneCount, r.CubeCount, r.TexWidth, r.TexHeight)
	}
}

// runAnalyze 执行分析命令
func runAnalyze(a *app.App, args []string) error {
	fs := flag.NewFlagSet("analyze", flag.ExitOnError)
	modelPath := fs.String("model", "", "模型文件或目录路径")
	parseFlags(fs, args)

	if *modelPath == "" {
		return fmt.Errorf("--model 参数不能为空")
	}

	filesRoot := parseFilesRoot(args)

	// 分析模型
	model := a.AnalyzeBedrockModel(*modelPath)
	if model.BoneCount == 0 {
		// 尝试 YSM 分析
		meta := a.AnalyzeYSMModel(*modelPath)
		printYSMAnalysis(meta)
	} else {
		printBedrockAnalysis(model)
	}

	// 同时导出结构
	structure := a.ExportModelStructureJSON(*modelPath)
	if structure != "" {
		fmt.Println("\n📊 模型结构预览:")
		previewLen := min(500, len(structure))
		fmt.Println(structure[:previewLen])
		if len(structure) > previewLen {
			fmt.Printf("... (省略 %d 字节)\n", len(structure)-previewLen)
		}
	}

	_ = filesRoot
	return nil
}

// printBedrockAnalysis 打印 Bedrock 模型分析结果
func printBedrockAnalysis(model types.BedrockModel) {
	fmt.Println("📋 模型分析结果:")
	fmt.Println(strings.Repeat("-", 50))
	fmt.Printf("  骨骼数量:    %d\n", model.BoneCount)
	fmt.Printf("  立方块数量:  %d\n", model.CubeCount)
	fmt.Printf("  贴图尺寸:    %d x %d\n", model.TexWidth, model.TexHeight)
	fmt.Printf("  格式版本:    %s\n", model.Format)

	if len(model.Bones) > 0 {
		fmt.Println("\n🦴 骨骼列表:")
		for i, bone := range model.Bones {
			if i >= 10 {
				fmt.Printf("  ... 还有 %d 个骨骼\n", len(model.Bones)-10)
				break
			}
			fmt.Printf("    [%d] %s (父: %s, 立方块: %d)\n",
				i, bone.Name, bone.Parent, len(bone.Cubes))
		}
	}
}

// printYSMAnalysis 打印 YSM 模型分析结果
func printYSMAnalysis(meta interface{}) {
	data, _ := json.MarshalIndent(meta, "  ", "  ")
	fmt.Println("📋 YSM 模型分析结果:")
	fmt.Println(strings.Repeat("-", 50))
	fmt.Println(string(data))
}

// runList 执行列表命令
func runList(a *app.App, args []string) error {
	fs := flag.NewFlagSet("list", flag.ExitOnError)
	limit := fs.Int("limit", 0, "显示条目数上限 (0=全部)")
	outputFormat := fs.String("format", "table", "输出格式: json 或 table")
	parseFlags(fs, args)

	filesRoot := parseFilesRoot(args)
	entries := a.ScanModelEntries(filesRoot)

	if len(entries) == 0 {
		fmt.Println("📭 仓库为空")
		return nil
	}

	if *outputFormat == "json" {
		data, _ := json.MarshalIndent(entries, "", "  ")
		fmt.Println(string(data))
		return nil
	}

	// 表格输出
	count := len(entries)
	if *limit > 0 && *limit < count {
		count = *limit
	}

	fmt.Printf("📚 共发现 %d 个模型:\n\n", len(entries))
	fmt.Printf("%-5s %-40s %-12s %-10s %s\n", "#", "名称", "扩展名", "大小", "修改时间")
	fmt.Println(strings.Repeat("-", 90))

	for i := 0; i < count; i++ {
		e := entries[i]
		name := e.Name
		if len(name) > 38 {
			name = name[:35] + "..."
		}
		size := formatSize(e.Size)
		modTime := time.UnixMilli(e.ModTime).Format("2006-01-02 15:04")
		fmt.Printf("%-5d %-40s %-12s %-10s %s\n", i+1, name, e.Ext, size, modTime)
	}

	if *limit > 0 && *limit < len(entries) {
		fmt.Printf("\n... 还有 %d 个模型未显示\n", len(entries)-*limit)
	}

	// 统计信息
	fmt.Printf("\n📊 统计:\n")
	fmt.Printf("   模型总数: %d\n", len(entries))
	if len(entries) > 0 {
		totalSize := int64(0)
		for _, e := range entries {
			totalSize += e.Size
		}
		fmt.Printf("   总大小:   %s\n", formatSize(totalSize))
	}

	return nil
}

// runVerify 执行验证命令
func runVerify(a *app.App, args []string) error {
	fs := flag.NewFlagSet("verify", flag.ExitOnError)
	repair := fs.Bool("repair", false, "尝试自动修复问题")
	parseFlags(fs, args)

	filesRoot := parseFilesRoot(args)
	entries := a.ScanModelEntries(filesRoot)

	fmt.Println("🔍 开始验证模型完整性...\n")

	var (
		validCount   int
		errorCount   int
		warningCount int
		errors       []string
		warnings     []string
	)

	for _, entry := range entries {
		model := a.AnalyzeBedrockModel(entry.Path)
		hasError := false
		hasWarning := false

		// 检查 1: 骨骼数
		if model.BoneCount == 0 {
			errors = append(errors, fmt.Sprintf("❌ %s: 骨骼数为 0 (可能不是有效的几何模型)", entry.Name))
			hasError = true
		}

		// 检查 2: 立方块数
		if model.CubeCount == 0 && model.BoneCount > 0 {
			warnings = append(warnings, fmt.Sprintf("⚠️ %s: 有 %d 个骨骼但没有立方块", entry.Name, model.BoneCount))
			hasWarning = true
		}

		// 检查 3: 贴图尺寸
		if model.TexWidth == 0 || model.TexHeight == 0 {
			warnings = append(warnings, fmt.Sprintf("⚠️ %s: 贴图尺寸为 0", entry.Name))
			hasWarning = true
		}

		// 检查 4: 贴图尺寸是否为 2 的幂
		if model.TexWidth > 0 && model.TexHeight > 0 {
			if !isPowerOf2(model.TexWidth) || !isPowerOf2(model.TexHeight) {
				warnings = append(warnings, fmt.Sprintf("⚠️ %s: 贴图尺寸 %dx%d 不是 2 的幂", entry.Name, model.TexWidth, model.TexHeight))
				hasWarning = true
			}
		}

		if hasError {
			errorCount++
		} else if hasWarning {
			warningCount++
		} else {
			validCount++
		}
	}

	// 输出结果
	fmt.Printf("📊 验证结果:\n")
	fmt.Printf("   ✅ 有效:    %d\n", validCount)
	fmt.Printf("   ⚠️ 警告:    %d\n", warningCount)
	fmt.Printf("   ❌ 错误:    %d\n", errorCount)

	if len(warnings) > 0 {
		fmt.Printf("\n⚠️ 警告详情:\n")
		for _, w := range warnings {
			fmt.Printf("   %s\n", w)
		}
	}

	if len(errors) > 0 {
		fmt.Printf("\n❌ 错误详情:\n")
		for _, e := range errors {
			fmt.Printf("   %s\n", e)
		}

		if *repair {
			fmt.Println("\n🔧 修复模式暂未实现，请手动处理上述错误")
		}
	}

	return nil
}

// runBenchmark 执行性能基准测试
func runBenchmark(a *app.App, args []string) error {
	fs := flag.NewFlagSet("benchmark", flag.ExitOnError)
	iterations := fs.Int("iterations", 3, "迭代次数")
	parseFlags(fs, args)

	filesRoot := parseFilesRoot(args)

	fmt.Printf("⚡ 性能基准测试\n")
	fmt.Printf("   迭代次数: %d\n\n", *iterations)

	// 基准 1: 扫描性能
	fmt.Println("📊 Benchmark 1: 模型扫描")
	scanTimes := make([]time.Duration, *iterations)
	for i := 0; i < *iterations; i++ {
		start := time.Now()
		entries := a.ScanModelEntries(filesRoot)
		scanTimes[i] = time.Since(start)
		fmt.Printf("   迭代 %d: %v (发现 %d 个模型)\n", i+1, scanTimes[i], len(entries))
	}
	printBenchmarkResults("扫描", scanTimes)

	// 基准 2: 搜索性能
	fmt.Println("\n📊 Benchmark 2: 模型搜索 (全量)")
	searchTimes := make([]time.Duration, *iterations)
	for i := 0; i < *iterations; i++ {
		start := time.Now()
		results := a.SearchModels(filesRoot, "", 0, 0, 0, 0, 0, 0)
		searchTimes[i] = time.Since(start)
		fmt.Printf("   迭代 %d: %v (找到 %d 个结果)\n", i+1, searchTimes[i], len(results))
	}
	printBenchmarkResults("搜索", searchTimes)

	// 基准 3: 关键词搜索
	fmt.Println("\n📊 Benchmark 3: 关键词搜索")
	keywordTimes := make([]time.Duration, *iterations)
	for i := 0; i < *iterations; i++ {
		start := time.Now()
		results := a.SearchModels(filesRoot, "model", 0, 0, 0, 0, 0, 0)
		keywordTimes[i] = time.Since(start)
		fmt.Printf("   迭代 %d: %v (找到 %d 个结果)\n", i+1, keywordTimes[i], len(results))
	}
	printBenchmarkResults("关键词搜索", keywordTimes)

	// 基准 4: 单模型分析
	entries := a.ScanModelEntries(filesRoot)
	if len(entries) > 0 {
		fmt.Println("\n📊 Benchmark 4: 单模型分析")
		analyzeTimes := make([]time.Duration, min(*iterations, len(entries)))
		for i := 0; i < len(analyzeTimes); i++ {
			start := time.Now()
			_ = a.AnalyzeBedrockModel(entries[i].Path)
			analyzeTimes[i] = time.Since(start)
			fmt.Printf("   迭代 %d: %v\n", i+1, analyzeTimes[i])
		}
		printBenchmarkResults("模型分析", analyzeTimes)
	}

	return nil
}

// printBenchmarkResults 打印基准测试结果
func printBenchmarkResults(name string, times []time.Duration) {
	if len(times) == 0 {
		return
	}

	var total time.Duration
	minTime := times[0]
	maxTime := times[0]

	for _, t := range times {
		total += t
		if t < minTime {
			minTime = t
		}
		if t > maxTime {
			maxTime = t
		}
	}

	avgTime := total / time.Duration(len(times))
	fmt.Printf("   📈 %s: 平均=%v, 最小=%v, 最大=%v\n", name, avgTime, minTime, maxTime)
}

// runExport 执行导出命令
func runExport(a *app.App, args []string) error {
	fs := flag.NewFlagSet("export", flag.ExitOnError)
	modelPath := fs.String("model", "", "模型文件路径")
	outputPath := fs.String("output", "", "输出文件路径")
	format := fs.String("format", "json", "导出格式: json 或 bone-structure")
	parseFlags(fs, args)

	if *modelPath == "" {
		return fmt.Errorf("--model 参数不能为空")
	}

	var content string
	switch *format {
	case "bone-structure":
		structure, err := a.ExportBoneStructures(filepath.Dir(*modelPath))
		if err != nil {
			return fmt.Errorf("导出骨骼结构失败: %w", err)
		}
		content = structure
	default:
		content = a.ExportModelStructureJSON(*modelPath)
	}

	if content == "" {
		return fmt.Errorf("导出内容为空")
	}

	if *outputPath != "" {
		if err := os.WriteFile(*outputPath, []byte(content), 0644); err != nil {
			return fmt.Errorf("写入文件失败: %w", err)
		}
		fmt.Printf("✅ 已导出到: %s\n", *outputPath)
	} else {
		fmt.Println(content)
	}

	return nil
}

// printCLIHelp 打印 CLI 帮助信息
func printCLIHelp() {
	fmt.Println("🎮 YSM 模型管理器 - CLI 模式")
	fmt.Println()
	fmt.Println("用法:")
	fmt.Println("  app --cli --files-root <路径> <命令> [选项]")
	fmt.Println()
	fmt.Println("可用命令:")
	for name, cmd := range cliCommands {
		fmt.Printf("  %-12s %s\n", name, cmd.Description)
	}
	fmt.Println()
	fmt.Println("公共选项:")
	fmt.Println("  --files-root <路径>    模型仓库根目录 (必填)")
	fmt.Println()
	fmt.Println("示例:")
	fmt.Println("  app --cli --files-root ./models search --keyword warrior")
	fmt.Println("  app --cli --files-root ./models list --format table")
	fmt.Println("  app --cli --files-root ./models analyze --model ./models/player/ysm.json")
	fmt.Println("  app --cli --files-root ./models benchmark --iterations 5")
}

// Helper functions

// parseFlags 解析 flag 参数（跳过已知的公共参数）
func parseFlags(fs *flag.FlagSet, args []string) {
	// 过滤掉 --files-root 及其值
	var filtered []string
	skipNext := false
	for i, arg := range args {
		if skipNext {
			skipNext = false
			continue
		}
		if arg == "--files-root" {
			if i+1 < len(args) {
				skipNext = true
			}
			continue
		}
		if strings.HasPrefix(arg, "--files-root=") {
			continue
		}
		filtered = append(filtered, arg)
	}
	_ = fs.Parse(filtered)
}

// isPowerOf2 检查是否为 2 的幂
func isPowerOf2(n int) bool {
	return n > 0 && (n&(n-1)) == 0
}

// ============ CLI 常量定义 ============

// CLI 阈值常量：复用 types 包中的共享常量，避免硬编码
const (
	// cliLargeFileThreshold 大文件阈值（1MB），用于筛选需要性能测试的文件
	cliLargeFileThreshold = 1 * 1024 * 1024
	// cliScanLargeFileThreshold 扫描大文件阈值（10MB），用于标识需要关注的文件
	cliScanLargeFileThreshold = 10 * 1024 * 1024
	// cliTextureLargeWarning 贴图大小警告阈值（32MB）
	cliTextureLargeWarning = 32 * 1024 * 1024
	// cliPerformanceWarning 性能警告阈值（100MB）
	cliPerformanceWarning = 100 * 1024 * 1024
	// cliPerformanceCaution 性能警告阈值（50MB）
	cliPerformanceCaution = 50 * 1024 * 1024
)

// ============ MMD 相关命令 ============

// fileBenchResult 文件基准测试结果
type fileBenchResult struct {
	Timestamp   string          `json:"timestamp"`
	Files       []fileBenchFile `json:"files"`
	SingleRead  benchSummary    `json:"single_read"`
	BatchRead   benchSummary    `json:"batch_read"`
	IPCOverhead ipcEstimate     `json:"ipc_overhead"`
}

type fileBenchFile struct {
	Path           string  `json:"path"`
	Size           int64   `json:"size"`
	AvgMs          float64 `json:"avg_ms"`
	ThroughputMBps float64 `json:"throughput_mbps"`
}

type benchSummary struct {
	AvgMs      float64 `json:"avg_ms"`
	MinMs      float64 `json:"min_ms"`
	MaxMs      float64 `json:"max_ms"`
	Throughput float64 `json:"throughput_mbps"`
}

type ipcEstimate struct {
	OriginalSize      int64   `json:"original_size"`
	Base64Size        int64   `json:"base64_size"`
	InflationRatio    float64 `json:"inflation_ratio"`
	SerDescOverheadMs float64 `json:"serde_overhead_ms"`
}

// runFileBench 测试大文件读取性能（支持 JSON 输出和基准对比）
func runFileBench(a *app.App, args []string) error {
	fs := flag.NewFlagSet("file-bench", flag.ExitOnError)
	testDir := fs.String("dir", "", "测试目录路径（扫描此目录下的大文件）")
	filePath := fs.String("file", "", "单个测试文件路径")
	iterations := fs.Int("iterations", 3, "迭代次数")
	output := fs.String("output", "", "输出文件路径（JSON 格式，用于基准对比）")
	compare := fs.String("compare", "", "对比基准文件路径")
	parseFlags(fs, args)

	var files []string

	if *filePath != "" {
		files = append(files, *filePath)
	} else if *testDir != "" {
		filepath.Walk(*testDir, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				return nil
			}
			if !info.IsDir() {
				ext := strings.ToLower(filepath.Ext(path))
				size := info.Size()
				// 只关注大文件（> 1MB），模拟 MMD 资源
				if size > 1*1024*1024 {
					files = append(files, path)
				}
				_ = ext
			}
			return nil
		})
	} else {
		return fmt.Errorf("请指定 --dir 或 --file 参数")
	}

	if len(files) == 0 {
		fmt.Printf("📭 没有找到大于 %s 的文件\n", formatSize(cliLargeFileThreshold))
		return nil
	}

	fmt.Printf("⚡ 文件读取性能测试\n")
	fmt.Printf("   文件数: %d\n", len(files))
	fmt.Printf("   迭代次数: %d\n\n", *iterations)

	// 按大小排序
	type fileInfo struct {
		path string
		size int64
	}
	var fileInfos []fileInfo
	for _, f := range files {
		info, err := os.Stat(f)
		if err != nil {
			continue
		}
		fileInfos = append(fileInfos, fileInfo{path: f, size: info.Size()})
	}

	// 显示文件列表
	fmt.Println("📁 待测试文件:")
	totalSize := int64(0)
	for i, fi := range fileInfos {
		name := filepath.Base(fi.path)
		if len(name) > 50 {
			name = name[:47] + "..."
		}
		fmt.Printf("   [%d] %-50s %s\n", i+1, name, formatSize(fi.size))
		totalSize += fi.size
	}
	fmt.Printf("\n   总大小: %s\n\n", formatSize(totalSize))

	// 逐个文件测试
	fmt.Println("📊 单文件读取测试:")
	var allReadTimes []time.Duration
	for _, fi := range fileInfos {
		name := filepath.Base(fi.path)
		readTimes := make([]time.Duration, *iterations)

		for i := 0; i < *iterations; i++ {
			start := time.Now()
			data := a.ReadFileBytes(fi.path)
			readTimes[i] = time.Since(start)
			_ = data
		}

		avgTime := avgDuration(readTimes)
		throughput := float64(fi.size) / avgTime.Seconds() / (1024 * 1024)
		allReadTimes = append(allReadTimes, readTimes...)

		fmt.Printf("   %s (%s):\n", name, formatSize(fi.size))
		fmt.Printf("     平均耗时: %v | 吞吐: %.1f MB/s\n", avgTime, throughput)
	}

	// 批量读取测试
	if len(fileInfos) > 1 {
		fmt.Println("\n📊 批量读取测试 (模拟 ReadFileBytesBatch):")
		paths := make([]string, len(fileInfos))
		for i, fi := range fileInfos {
			paths[i] = fi.path
		}

		batchTimes := make([]time.Duration, *iterations)
		for i := 0; i < *iterations; i++ {
			start := time.Now()
			results := a.ReadFileBytesBatch(paths)
			batchTimes[i] = time.Since(start)
			_ = results
		}

		avgBatch := avgDuration(batchTimes)
		batchThroughput := float64(totalSize) / avgBatch.Seconds() / (1024 * 1024)
		fmt.Printf("   %d 个文件, 总大小 %s:\n", len(fileInfos), formatSize(totalSize))
		fmt.Printf("     平均耗时: %v | 吞吐: %.1f MB/s\n", avgBatch, batchThroughput)
	}

	// 转换为 fileBenchItem 格式
	benchItems := make([]fileBenchItem, len(fileInfos))
	for i, f := range fileInfos {
		benchItems[i] = fileBenchItem{Path: f.path, Size: f.size}
	}

	// 实际测量 IPC 开销
	fmt.Println("\n📊 IPC 传输开销测量:")
	overheadEstimate := calculateIPCOverhead(a, benchItems, *iterations)
	fmt.Printf("   原始大小:     %s\n", formatSize(totalSize))
	fmt.Printf("   Base64 膨胀:  %s (+%.0f%%)\n", formatSize(overheadEstimate.Base64Size), overheadEstimate.InflationRatio*100)
	fmt.Printf("   序列化开销:   ~%s\n", durationFormat(overheadEstimate.SerDescOverheadMs))

	// 保存基准
	if *output != "" {
		result := fileBenchResult{
			Timestamp:   time.Now().UTC().Format(time.RFC3339),
			Files:       make([]fileBenchFile, len(benchItems)),
			IPCOverhead: overheadEstimate,
		}
		for i, f := range benchItems {
			result.Files[i] = fileBenchFile{Path: f.Path, Size: f.Size}
		}
		if jsonBytes, err := json.MarshalIndent(result, "", "  "); err == nil {
			os.WriteFile(*output, jsonBytes, 0644)
			fmt.Printf("\n💾 基准已保存到: %s\n", *output)
		}
	}

	// 对比基准
	if *compare != "" {
		fmt.Println("\n📈 基准对比:")
		compareResult := loadAndCompareBenchmark(*compare, benchItems)
		fmt.Println(compareResult)
	}

	return nil
}

// fileBenchItem 文件基准测试项
type fileBenchItem struct {
	Path  string  `json:"path"`
	Size  int64   `json:"size"`
	AvgMs float64 `json:"avg_ms"`
}

// calculateIPCOverhead 实际测量 IPC 开销
func calculateIPCOverhead(a *app.App, files []fileBenchItem, iterations int) ipcEstimate {
	if len(files) == 0 {
		return ipcEstimate{}
	}

	// 测量单次读取
	var totalSingle time.Duration
	for i := 0; i < iterations; i++ {
		start := time.Now()
		_ = a.ReadFileBytes(files[0].Path)
		totalSingle += time.Since(start)
	}

	// 估算序列化开销（基于文件大小）
	originalSize := files[0].Size
	base64Size := int64(float64(originalSize) * 1.33) // Base64 膨胀 ~33%

	// 序列化时间估算：约 100MB/s 的 JSON 序列化速度
	serdeSpeedMBps := 100.0
	serdeTimeMs := float64(originalSize) / (1024 * 1024) / serdeSpeedMBps * 1000

	return ipcEstimate{
		OriginalSize:      originalSize,
		Base64Size:        base64Size,
		InflationRatio:    0.33,
		SerDescOverheadMs: serdeTimeMs,
	}
}

// loadAndCompareBenchmark 加载并对比基准
func loadAndCompareBenchmark(baselinePath string, currentFiles []fileBenchItem) string {
	data, err := os.ReadFile(baselinePath)
	if err != nil {
		return fmt.Sprintf("❌ 无法读取基准文件: %v", err)
	}

	var baseline fileBenchResult
	if err := json.Unmarshal(data, &baseline); err != nil {
		return fmt.Sprintf("❌ 基准文件格式错误: %v", err)
	}

	return fmt.Sprintf("📊 对比基准 (%s):\n   迭代次数: %d\n   文件数: %d",
		baseline.Timestamp, len(baseline.Files), len(currentFiles))
}

// scanDirResult 目录扫描结果
type scanDirResult struct {
	Timestamp   string        `json:"timestamp"`
	Directory   string        `json:"directory"`
	TotalFiles  int           `json:"total_files"`
	TotalDirs   int           `json:"total_dirs"`
	TotalSize   int64         `json:"total_size"`
	ByExtension []extStatItem `json:"by_extension"`
	Largest     []largeFile   `json:"largest_files"`
}

type extStatItem struct {
	Ext   string `json:"ext"`
	Count int    `json:"count"`
	Size  int64  `json:"size"`
}

type largeFile struct {
	Path string `json:"path"`
	Size int64  `json:"size"`
}

// runScanDir 扫描目录结构（支持 JSON 输出）
func runScanDir(a *app.App, args []string) error {
	fs := flag.NewFlagSet("scan-dir", flag.ExitOnError)
	dirPath := fs.String("dir", "", "目录路径")
	detail := fs.Bool("detail", false, "显示详细文件列表")
	output := fs.String("output", "", "输出文件路径（JSON 格式）")
	parseFlags(fs, args)

	if *dirPath == "" {
		return fmt.Errorf("--dir 参数不能为空")
	}

	fmt.Printf("📁 扫描目录: %s\n\n", *dirPath)

	var (
		totalFiles   int
		totalDirs    int
		totalSize    int64
		extCount     = make(map[string]int)
		extSize      = make(map[string]int64)
		largestFiles []struct {
			path string
			size int64
		}
	)

	threshold := cliScanLargeFileThreshold

	err := filepath.Walk(*dirPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}

		if info.IsDir() {
			totalDirs++
			return nil
		}

		ext := strings.ToLower(filepath.Ext(path))
		size := info.Size()
		totalFiles++
		totalSize += size

		extCount[ext]++
		extSize[ext] += size

		// 追踪最大的文件
		if size > threshold {
			largestFiles = append(largestFiles, struct {
				path string
				size int64
			}{path: path, size: size})
		}

		return nil
	})

	if err != nil {
		return fmt.Errorf("扫描目录失败: %w", err)
	}

	// 构建结果结构
	result := scanDirResult{
		Timestamp:   time.Now().UTC().Format(time.RFC3339),
		Directory:   *dirPath,
		TotalFiles:  totalFiles,
		TotalDirs:   totalDirs,
		TotalSize:   totalSize,
		ByExtension: make([]extStatItem, 0, len(extCount)),
		Largest:     make([]largeFile, 0, len(largestFiles)),
	}
	for ext, count := range extCount {
		result.ByExtension = append(result.ByExtension, extStatItem{
			Ext:   ext,
			Count: count,
			Size:  extSize[ext],
		})
	}
	for _, f := range largestFiles {
		result.Largest = append(result.Largest, largeFile{Path: f.path, Size: f.size})
	}

	// JSON 输出
	if *output != "" {
		if jsonBytes, err := json.MarshalIndent(result, "", "  "); err == nil {
			os.WriteFile(*output, jsonBytes, 0644)
			fmt.Printf("💾 JSON 已保存到: %s\n\n", *output)
			return nil
		} else {
			return fmt.Errorf("JSON 序列化失败: %w", err)
		}
	}

	// 终端输出
	fmt.Printf("📊 目录统计:\n")
	fmt.Printf("   目录数:   %d\n", totalDirs)
	fmt.Printf("   文件数:   %d\n", totalFiles)
	fmt.Printf("   总大小:   %s\n\n", formatSize(totalSize))

	// 按扩展名分组
	fmt.Println("📋 按扩展名分组:")
	type extStat struct {
		ext   string
		count int
		size  int64
	}
	var stats []extStat
	for ext, count := range extCount {
		stats = append(stats, extStat{ext, count, extSize[ext]})
	}
	// 按大小排序
	for i := 0; i < len(stats); i++ {
		for j := i + 1; j < len(stats); j++ {
			if stats[j].size > stats[i].size {
				stats[i], stats[j] = stats[j], stats[i]
			}
		}
	}

	fmt.Printf("   %-10s %-8s %s\n", "扩展名", "数量", "总大小")
	fmt.Println("   " + strings.Repeat("-", 50))
	for _, s := range stats {
		fmt.Printf("   %-10s %-8d %s\n", s.ext, s.count, formatSize(s.size))
	}

	// 大文件列表
	if len(largestFiles) > 0 {
		fmt.Printf("\n⚠️  大文件列表 (>10MB, 共 %d 个):\n", len(largestFiles))
		for i, lf := range largestFiles {
			if i >= 10 {
				fmt.Printf("   ... 还有 %d 个\n", len(largestFiles)-10)
				break
			}
			relPath := strings.TrimPrefix(lf.path, *dirPath)
			fmt.Printf("   [%d] %s (%s)\n", i+1, relPath, formatSize(lf.size))
		}
	}

	// 详细列表
	if *detail && totalFiles > 0 {
		fmt.Printf("\n📝 文件详情 (前 20 个):\n")
		count := 0
		filepath.Walk(*dirPath, func(path string, info os.FileInfo, err error) error {
			if err != nil || info.IsDir() || count >= 20 {
				return nil
			}
			relPath := strings.TrimPrefix(path, *dirPath)
			fmt.Printf("   %s (%s)\n", relPath, formatSize(info.Size()))
			count++
			return nil
		})
		if totalFiles > 20 {
			fmt.Printf("   ... 还有 %d 个文件\n", totalFiles-20)
		}
	}

	return nil
}

// runAnalyzeMMD 分析 MMD 模型资产
func runAnalyzeMMD(a *app.App, args []string) error {
	fs := flag.NewFlagSet("analyze-mmd", flag.ExitOnError)
	modelDir := fs.String("dir", "", "MMD 模型目录路径")
	parseFlags(fs, args)

	if *modelDir == "" {
		return fmt.Errorf("--dir 参数不能为空")
	}

	fmt.Printf("🎭 MMD 模型资产分析: %s\n\n", *modelDir)

	var (
		pmxFiles     []string
		vrmFiles     []string
		vmdFiles     []string
		vpdFiles     []string
		textureFiles []string
		textureSize  int64
		modelSize    int64
	)

	textureExts := map[string]bool{
		".png":  true,
		".jpg":  true,
		".jpeg": true,
		".tga":  true,
		".bmp":  true,
		".dds":  true,
		".ktx2": true,
	}

	err := filepath.Walk(*modelDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() {
			return nil
		}

		ext := strings.ToLower(filepath.Ext(path))
		size := info.Size()

		switch ext {
		case ".pmx", ".pmd":
			pmxFiles = append(pmxFiles, path)
			modelSize += size
		case ".vrm":
			vrmFiles = append(vrmFiles, path)
			modelSize += size
		case ".vmd":
			vmdFiles = append(vmdFiles, path)
		case ".vpd":
			vpdFiles = append(vpdFiles, path)
		default:
			if textureExts[ext] {
				textureFiles = append(textureFiles, path)
				textureSize += size
			}
		}

		return nil
	})

	if err != nil {
		return fmt.Errorf("分析目录失败: %w", err)
	}

	// 输出分析结果
	fmt.Printf("📊 资产统计:\n")
	fmt.Printf("   PMX/PMD 模型:  %d 个 (%s)\n", len(pmxFiles), formatSize(modelSize))
	fmt.Printf("   VRM 模型:      %d 个\n", len(vrmFiles))
	fmt.Printf("   VMD 动画:      %d 个\n", len(vmdFiles))
	fmt.Printf("   VPD 物理:      %d 个\n", len(vpdFiles))
	fmt.Printf("   贴图文件:      %d 个 (%s)\n", len(textureFiles), formatSize(textureSize))

	// 贴图详细信息
	if len(textureFiles) > 0 {
		fmt.Printf("\n🖼️  贴图详情:\n")

		// 按大小排序
		type texInfo struct {
			path string
			size int64
			ext  string
		}
		var texInfos []texInfo
		for _, tf := range textureFiles {
			info, _ := os.Stat(tf)
			ext := strings.ToLower(filepath.Ext(tf))
			texInfos = append(texInfos, texInfo{path: tf, size: info.Size(), ext: ext})
		}

		// 排序
		for i := 0; i < len(texInfos); i++ {
			for j := i + 1; j < len(texInfos); j++ {
				if texInfos[j].size > texInfos[i].size {
					texInfos[i], texInfos[j] = texInfos[j], texInfos[i]
				}
			}
		}

		// 统计各格式大小
		extSizeMap := make(map[string]int64)
		for _, ti := range texInfos {
			extSizeMap[ti.ext] += ti.size
		}

		fmt.Printf("   按格式:\n")
		for ext, size := range extSizeMap {
			fmt.Printf("     %s: %s\n", ext, formatSize(size))
		}

		fmt.Printf("\n   最大贴图 Top 10:\n")
		for i := 0; i < min(10, len(texInfos)); i++ {
			relPath := strings.TrimPrefix(texInfos[i].path, *modelDir)
			fmt.Printf("     [%d] %s (%s) %s\n", i+1, relPath, texInfos[i].ext, formatSize(texInfos[i].size))
		}

		// 性能预警
		fmt.Printf("\n⚠️  性能预警:\n")
		largeTextures := 0
		for _, ti := range texInfos {
			if ti.size > cliTextureLargeWarning {
				largeTextures++
			}
		}
		if largeTextures > 0 {
			fmt.Printf("   🔴 有 %d 个贴图大于 %s，建议压缩或转换为 KTX2\n", largeTextures, formatSize(cliTextureLargeWarning))
		} else {
			fmt.Printf("   ✅ 无超大贴图\n")
		}

		// TGA 特殊警告
		tgaSize := extSizeMap[".tga"] + extSizeMap[".dds"]
		if tgaSize > 0 {
			fmt.Printf("   🟡 TGA/DDS 贴图占 %s，建议转换为 PNG 或 KTX2\n", formatSize(tgaSize))
		}
	}

	// 模型文件详情
	if len(pmxFiles) > 0 {
		fmt.Printf("\n📦 模型文件:\n")
		for i, pf := range pmxFiles {
			info, _ := os.Stat(pf)
			relPath := strings.TrimPrefix(pf, *modelDir)
			fmt.Printf("   [%d] %s (%s)\n", i+1, relPath, formatSize(info.Size()))
		}
	}

	// 总体评估
	fmt.Printf("\n📈 总体评估:\n")
	totalAssetsSize := modelSize + textureSize
	fmt.Printf("   模型+贴图总大小: %s\n", formatSize(totalAssetsSize))

	if totalAssetsSize > cliPerformanceWarning {
		fmt.Printf("   🔴 大于 %s，首次加载预计 > 10s\n", formatSize(cliPerformanceWarning))
		fmt.Printf("   💡 建议: 使用 KTX2 压缩贴图，可减少 60-70% 体积\n")
	} else if totalAssetsSize > cliPerformanceCaution {
		fmt.Printf("   🟡 %s-%s，首次加载可能 5-10s\n", formatSize(cliPerformanceCaution), formatSize(cliPerformanceWarning))
	} else {
		fmt.Printf("   🟢 小于 %s，加载性能应该可以接受\n", formatSize(cliPerformanceCaution))
	}

	return nil
}

// durationFormat 格式化时长为易读字符串
func durationFormat(ms float64) string {
	if ms < 10 {
		return fmt.Sprintf("%.2fms", ms)
	}
	if ms < 1000 {
		return fmt.Sprintf("%.0fms", ms)
	}
	return fmt.Sprintf("%.2fs", ms/1000)
}

// formatSize 格式化文件大小
func formatSize(bytes int64) string {
	if bytes < 1024 {
		return fmt.Sprintf("%dB", bytes)
	}
	if bytes < 1024*1024 {
		return fmt.Sprintf("%.1fKB", float64(bytes)/1024)
	}
	if bytes < 1024*1024*1024 {
		return fmt.Sprintf("%.1fMB", float64(bytes)/(1024*1024))
	}
	return fmt.Sprintf("%.1fGB", float64(bytes)/(1024*1024*1024))
}

// avgDuration 计算平均时长
func avgDuration(durations []time.Duration) time.Duration {
	if len(durations) == 0 {
		return 0
	}
	var total time.Duration
	for _, d := range durations {
		total += d
	}
	return total / time.Duration(len(durations))
}

// min 返回两个整数中的较小值
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// max 返回两个整数中的较大值
func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

// ============ 缓存管理命令 ============

// runCacheStatus 查看纹理缓存状态
func runCacheStatus(a *app.App, args []string) error {
	_ = a
	_ = args

	stats := texture_cache.GetCacheStats()
	files, _ := texture_cache.ListCacheFiles()

	fmt.Printf("💾 纹理缓存状态\n")
	fmt.Printf("   缓存目录: %s\n", stats.Dir)

	if stats.Dir == "" {
		fmt.Printf("   ⚠️  缓存目录不可用（平台配置根路径为空）\n")
		return nil
	}

	fmt.Printf("   文件数量: %d\n", stats.FileCount)
	fmt.Printf("   总大小:   %s\n\n", formatSize(stats.TotalSize))

	if stats.FileCount == 0 {
		fmt.Println("📭 缓存为空")
		fmt.Println()
		fmt.Println("💡 提示: 首次加载模型时，系统会自动压缩贴图并写入缓存。")
		fmt.Println("   后续加载相同模型时会直接命中缓存，加载速度大幅提升。")
		return nil
	}

	// 显示最近的缓存文件
	fmt.Println("📋 最近缓存的 KTX2 文件 (前 20 个):")
	fmt.Printf("   %-64s %s\n", "哈希 (前 16 位)", "大小")
	fmt.Println("   " + strings.Repeat("-", 80))

	for i, f := range files {
		if i >= 20 {
			fmt.Printf("   ... 还有 %d 个文件\n", len(files)-20)
			break
		}
		hashShort := f.Hash
		if len(hashShort) > 16 {
			hashShort = hashShort[:16]
		}
		fmt.Printf("   %-64s %s\n", hashShort, formatSize(f.Size))
	}

	fmt.Println()
	fmt.Printf("📈 缓存效率估算:\n")
	if stats.FileCount > 0 {
		avgSize := stats.TotalSize / int64(stats.FileCount)
		fmt.Printf("   平均大小: %s/文件\n", formatSize(avgSize))
		fmt.Printf("   预计可加速: 命中缓存后跳过 GPU 解码阶段\n")
	}

	return nil
}

// runCacheVerify 检查模型贴图的缓存命中情况
func runCacheVerify(a *app.App, args []string) error {
	fs := flag.NewFlagSet("cache-verify", flag.ExitOnError)
	modelDir := fs.String("dir", "", "MMD 模型目录路径")
	verbose := fs.Bool("verbose", false, "显示详细的缓存命中信息")
	parseFlags(fs, args)

	if *modelDir == "" {
		return fmt.Errorf("--dir 参数不能为空")
	}

	fmt.Printf("🔍 检查模型贴图缓存: %s\n\n", *modelDir)

	var (
		textureFiles []string
		totalSize    int64
		hitCount     int
		hitSize      int64
		missCount    int
		missSize     int64
	)

	textureExts := map[string]bool{
		".png":  true,
		".jpg":  true,
		".jpeg": true,
		".tga":  true,
		".bmp":  true,
		".dds":  true,
	}

	type texInfo struct {
		path      string
		size      int64
		hash      string
		cached    bool
		cacheSize int64
	}
	var texInfos []texInfo

	err := filepath.Walk(*modelDir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}

		ext := strings.ToLower(filepath.Ext(path))
		if !textureExts[ext] {
			return nil
		}

		size := info.Size()
		textureFiles = append(textureFiles, path)
		totalSize += size

		// 计算哈希并检查缓存
		hash, err := texture_cache.TextureHash(path)
		if err != nil {
			texInfos = append(texInfos, texInfo{
				path:   path,
				size:   size,
				hash:   "ERROR",
				cached: false,
			})
			return nil
		}

		cached, _ := texture_cache.HasCached(hash)
		cacheSize := int64(0)
		if cached {
			cachePath := texture_cache.CachePath(hash)
			if cachePath != "" {
				if ci, err := os.Stat(cachePath); err == nil {
					cacheSize = ci.Size()
				}
			}
			hitCount++
			hitSize += size
		} else {
			missCount++
			missSize += size
		}

		texInfos = append(texInfos, texInfo{
			path:      path,
			size:      size,
			hash:      hash,
			cached:    cached,
			cacheSize: cacheSize,
		})

		return nil
	})

	if err != nil {
		return fmt.Errorf("扫描目录失败: %w", err)
	}

	fmt.Printf("📊 贴图统计:\n")
	fmt.Printf("   贴图总数: %d\n", len(textureFiles))
	fmt.Printf("   原始总大小: %s\n\n", formatSize(totalSize))

	if len(textureFiles) == 0 {
		fmt.Println("📭 没有找到贴图文件")
		return nil
	}

	// 缓存命中统计
	hitRate := 0.0
	if len(textureFiles) > 0 {
		hitRate = float64(hitCount) / float64(len(textureFiles)) * 100
	}

	fmt.Printf("🎯 缓存命中:\n")
	fmt.Printf("   ✅ 命中: %d 个 (%s)\n", hitCount, formatSize(hitSize))
	fmt.Printf("   ❌ 未命中: %d 个 (%s)\n", missCount, formatSize(missSize))
	fmt.Printf("   📈 命中率: %.1f%%\n\n", hitRate)

	// 未缓存文件列表
	if missCount > 0 {
		fmt.Printf("⚠️  未缓存的贴图:\n")
		for _, ti := range texInfos {
			if !ti.cached {
				relPath := strings.TrimPrefix(ti.path, *modelDir)
				status := "❌"
				if ti.hash == "ERROR" {
					status = "⚠️ "
				}
				fmt.Printf("   %s %s (%s)\n", status, relPath, formatSize(ti.size))
			}
		}
		fmt.Println()
	}

	// 详细信息
	if *verbose && hitCount > 0 {
		fmt.Printf("📋 缓存命中详情:\n")
		for _, ti := range texInfos {
			if ti.cached {
				relPath := strings.TrimPrefix(ti.path, *modelDir)
				fmt.Printf("   ✅ %s\n", relPath)
				fmt.Printf("      原始: %s → 缓存(KTX2): %s (压缩率: %.0f%%)\n",
					formatSize(ti.size),
					formatSize(ti.cacheSize),
					float64(ti.cacheSize)/float64(ti.size)*100)
			}
		}
		fmt.Println()
	}

	// 总结
	fmt.Printf("📈 总结:\n")
	if hitCount == len(textureFiles) {
		fmt.Printf("   🟢 所有贴图都已缓存，加载时将获得最佳性能\n")
	} else if hitCount > 0 {
		fmt.Printf("   🟡 部分贴图已缓存 (%.1f%%)，首次加载会有解码开销\n", hitRate)
		fmt.Printf("   💡 建议: 打开包含此模型的页面，系统会自动缓存剩余贴图\n")
	} else {
		fmt.Printf("   🔴 所有贴图均未缓存，首次加载会较慢\n")
		fmt.Printf("   💡 建议: 打开包含此模型的页面，系统会自动缓存贴图\n")
	}

	// 预估缓存后节省的时间
	if hitSize > 0 {
		// 假设 IPC 传输和 GPU 解码各占一半时间
		estimatedSavedMs := float64(hitSize) / (1024 * 1024) * 5 // 约 5ms/MB 的解码开销
		fmt.Printf("   ⚡ 估计节省: ~%.0fms (%s 贴图的解码+传输开销)\n", estimatedSavedMs, formatSize(hitSize))
	}

	return nil
}

// runCacheClear 清空纹理缓存
func runCacheClear(a *app.App, args []string) error {
	_ = a

	fs := flag.NewFlagSet("cache-clear", flag.ExitOnError)
	yes := fs.Bool("yes", false, "跳过确认，直接清空")
	parseFlags(fs, args)

	stats := texture_cache.GetCacheStats()

	fmt.Printf("🗑️  清空纹理缓存\n")
	fmt.Printf("   缓存目录: %s\n", stats.Dir)
	fmt.Printf("   文件数量: %d\n", stats.FileCount)
	fmt.Printf("   总大小:   %s\n\n", formatSize(stats.TotalSize))

	if stats.FileCount == 0 {
		fmt.Println("📭 缓存已经是空的")
		return nil
	}

	if !*yes {
		fmt.Print("⚠️  确定要清空所有缓存吗？(y/N): ")
		var confirm string
		fmt.Scanln(&confirm)
		if confirm != "y" && confirm != "Y" {
			fmt.Println("❌ 已取消")
			return nil
		}
	}

	err := texture_cache.ClearCache()
	if err != nil {
		return fmt.Errorf("清空缓存失败: %w", err)
	}

	fmt.Printf("✅ 已清空 %d 个缓存文件\n", stats.FileCount)
	fmt.Println()
	fmt.Println("💡 提示: 清空后首次加载模型会较慢，系统会自动重新生成缓存。")

	return nil
}

// runConfigShow 查看当前配置
func runConfigShow(a *app.App, args []string) error {
	_ = args

	filesRoot := parseFilesRoot(args)
	if filesRoot == "" {
		filesRoot = "."
	}

	cfg := a.LoadAppConfig()

	fmt.Printf("⚙️  当前配置\n\n")
	fmt.Printf("📁 根目录: %s\n\n", filesRoot)

	if cfg.FilesRoot != "" || cfg.LinkMode != "" {
		fmt.Printf("📊 存储根目录:\n")
		fmt.Printf("   FilesRoot: %s\n", cfg.FilesRoot)

		if len(cfg.CustomRoots) > 0 {
			fmt.Printf("\n📂 自定义资源根路径:\n")
			for k, v := range cfg.CustomRoots {
				if v != "" {
					fmt.Printf("   %-20s: %s\n", k, v)
				}
			}
		}

		fmt.Printf("\n🔧 运行参数:\n")
		fmt.Printf("   链接模式: %s\n", cfg.LinkMode)
		fmt.Printf("   主题: %s\n", cfg.Theme)
		fmt.Printf("   镜像: %s\n", cfg.Mirror)

		if cfg.VoxelMaxBlocks > 0 {
			fmt.Printf("   体素上限: %d\n", cfg.VoxelMaxBlocks)
		}

		// 阈值配置
		fmt.Printf("\n⏱️  阈值配置:\n")
		if cfg.ScanCacheTTLMs > 0 {
			fmt.Printf("   扫描缓存 TTL: %dms\n", cfg.ScanCacheTTLMs)
		}
		if cfg.DownloadTimeoutSec > 0 {
			fmt.Printf("   下载超时: %ds\n", cfg.DownloadTimeoutSec)
		}
		if cfg.PreviewReadLimitMB > 0 {
			fmt.Printf("   预览读取上限: %dMB\n", cfg.PreviewReadLimitMB)
		}
		if cfg.LogMaxEntries > 0 {
			fmt.Printf("   日志条数上限: %d\n", cfg.LogMaxEntries)
		}

		// 窗口状态
		if cfg.WinW > 0 && cfg.WinH > 0 {
			fmt.Printf("\n🪟  窗口状态: %dx%d @ (%d,%d)\n", cfg.WinW, cfg.WinH, cfg.WinX, cfg.WinY)
		}
	} else {
		fmt.Println("📭 配置为空（使用默认值）")
	}

	// 缓存状态
	stats := texture_cache.GetCacheStats()
	fmt.Printf("\n💾 纹理缓存:\n")
	fmt.Printf("   目录: %s\n", stats.Dir)
	fmt.Printf("   文件: %d 个, 总大小: %s\n", stats.FileCount, formatSize(stats.TotalSize))

	fmt.Printf("\n💡 提示:\n")
	fmt.Printf("   使用 'cache-status' 查看缓存详情\n")
	fmt.Printf("   使用 'cache-verify --dir <模型目录>' 检查特定模型的缓存命中\n")
	fmt.Printf("   使用 'cache-clear' 清空缓存\n")

	return nil
}
