package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

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

// formatSize 格式化文件大小
func formatSize(size int64) string {
	const unit = 1024
	if size < unit {
		return fmt.Sprintf("%d B", size)
	}
	div, exp := int64(unit), 0
	for n := size / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(size)/float64(div), "KMGTPE"[exp])
}

// isPowerOf2 检查是否为 2 的幂
func isPowerOf2(n int) bool {
	return n > 0 && (n&(n-1)) == 0
}

// min 返回较小值
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// ============ MMD 相关命令 ============

// runFileBench 测试大文件读取性能
func runFileBench(a *app.App, args []string) error {
	fs := flag.NewFlagSet("file-bench", flag.ExitOnError)
	testDir := fs.String("dir", "", "测试目录路径（扫描此目录下的大文件）")
	filePath := fs.String("file", "", "单个测试文件路径")
	iterations := fs.Int("iterations", 3, "迭代次数")
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
		fmt.Println("📭 没有找到大于 1MB 的文件")
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

	// 格式转换开销估算（JSON/Base64 序列化模拟）
	fmt.Println("\n📊 IPC 传输开销估算 (Base64 + JSON 序列化):")
	estimatedOverhead := float64(totalSize) * 1.33 // Base64 膨胀 ~33%
	avgSingleTime := avgDuration(allReadTimes)
	fmt.Printf("   原始大小: %s\n", formatSize(totalSize))
	fmt.Printf("   Base64 后: ~%s (+33%%)\n", formatSize(int64(estimatedOverhead)))
	fmt.Printf("   预估序列化: ~%v\n", time.Duration(avgSingleTime.Seconds()*0.3*float64(time.Second)))

	return nil
}

// runScanDir 扫描目录结构
func runScanDir(a *app.App, args []string) error {
	fs := flag.NewFlagSet("scan-dir", flag.ExitOnError)
	dirPath := fs.String("dir", "", "目录路径")
	detail := fs.Bool("detail", false, "显示详细文件列表")
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

	threshold := int64(10 * 1024 * 1024) // 10MB

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

	// 输出统计
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
			if ti.size > 32*1024*1024 { // > 32MB
				largeTextures++
			}
		}
		if largeTextures > 0 {
			fmt.Printf("   🔴 有 %d 个贴图大于 32MB，建议压缩或转换为 KTX2\n", largeTextures)
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

	if totalAssetsSize > 100*1024*1024 {
		fmt.Printf("   🔴 大于 100MB，首次加载预计 > 10s\n")
		fmt.Printf("   💡 建议: 使用 KTX2 压缩贴图，可减少 60-70% 体积\n")
	} else if totalAssetsSize > 50*1024*1024 {
		fmt.Printf("   🟡 50-100MB，首次加载可能 5-10s\n")
	} else {
		fmt.Printf("   🟢 小于 50MB，加载性能应该可以接受\n")
	}

	return nil
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
