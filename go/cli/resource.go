package cli

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"ysm-model-manager/go/texture_cache"
)

func init() {
	RegisterCommand("resource-scan", "扫描模型仓库资源，统计资产分布", runResourceScan)
	RegisterCommand("repo-audit", "仓库健康审计（完整性 + 缓存 + 资产）", runRepoAudit)
}

// resourceScanResult 资源扫描结果
type resourceScanResult struct {
	Timestamp   string                `json:"timestamp"`
	Directory   string                `json:"directory"`
	TotalFiles  int                   `json:"total_files"`
	TotalDirs   int                   `json:"total_dirs"`
	TotalSize   int64                 `json:"total_size"`
	ByExtension map[string]extSummary `json:"by_extension"`
	LargeFiles  []largeFileEntry      `json:"large_files,omitempty"`
	Stats       resourceStats         `json:"stats"`
}

type extSummary struct {
	Count int   `json:"count"`
	Size  int64 `json:"size"`
}

type largeFileEntry struct {
	Path string `json:"path"`
	Size int64  `json:"size"`
}

type resourceStats struct {
	Models     int `json:"models"`
	Textures   int `json:"textures"`
	Animations int `json:"animations"`
	Effects    int `json:"effects"`
	Others     int `json:"others"`
}

// runResourceScan 扫描模型仓库资源
func runResourceScan(ctx *CmdContext) error {
	fs := newCmdFlagSet("resource-scan")
	dirPath := fs.String("dir", ctx.FilesRoot, "目录路径（默认使用 --files-root）")
	output := fs.String("output", "", "输出文件路径（JSON 格式）")
	_, err := parseFlags(fs, ctx.Args)
	if err != nil {
		return err
	}

	if *dirPath == "" {
		return newParamErrf("--dir 参数不能为空")
	}

	fmt.Printf("📁 扫描资源目录: %s\n\n", *dirPath)

	result := resourceScanResult{
		Timestamp:   time.Now().UTC().Format(time.RFC3339),
		Directory:   *dirPath,
		ByExtension: make(map[string]extSummary),
		LargeFiles:  make([]largeFileEntry, 0),
	}

	threshold := cliScanLargeFileThreshold

	err = filepath.Walk(*dirPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}

		if info.IsDir() {
			result.TotalDirs++
			return nil
		}

		ext := strings.ToLower(filepath.Ext(path))
		size := info.Size()
		result.TotalFiles++
		result.TotalSize += size

		// 按扩展名统计
		summary := result.ByExtension[ext]
		summary.Count++
		summary.Size += size
		result.ByExtension[ext] = summary

		// 大文件记录
		if size > threshold {
			result.LargeFiles = append(result.LargeFiles, largeFileEntry{
				Path: path,
				Size: size,
			})
		}

		// 按类型分类统计
		classifyResource(ext, &result.Stats)

		return nil
	})

	if err != nil {
		return newRuntimeErrf("扫描目录失败: %v", err)
	}

	// 输出结果
	if *output != "" {
		if jsonBytes, err := json.MarshalIndent(result, "", "  "); err == nil {
			if err := os.WriteFile(*output, jsonBytes, 0644); err != nil {
				return newRuntimeErrf("保存 JSON 文件失败: %v", err)
			}
			fmt.Printf("💾 资源扫描结果已保存到: %s\n", *output)
			return nil
		}
		return newRuntimeErrf("JSON 序列化失败: %v", err)
	}

	// 文本输出
	printResourceScanResult(result)

	return nil
}

// classifyResource 按扩展名分类统计资源
func classifyResource(ext string, stats *resourceStats) {
	switch ext {
	case ".ysm", ".json":
		stats.Models++
	case ".png", ".jpg", ".jpeg", ".bmp", ".tga", ".dds", ".ktx2":
		stats.Textures++
	case ".vmd", ".bvh":
		stats.Animations++
	case ".pmx", ".pmd", ".x":
		stats.Models++
	case ".fx", ".cg", ".glsl":
		stats.Effects++
	default:
		stats.Others++
	}
}

// printResourceScanResult 打印资源扫描结果
func printResourceScanResult(result resourceScanResult) {
	fmt.Printf("📊 资源扫描结果:\n")
	fmt.Printf("  目录: %s\n", result.Directory)
	fmt.Printf("  文件总数: %d\n", result.TotalFiles)
	fmt.Printf("  目录总数: %d\n", result.TotalDirs)
	fmt.Printf("  总大小: %s\n\n", formatSize(result.TotalSize))

	fmt.Printf("📦 资源分类:\n")
	fmt.Printf("  模型: %d\n", result.Stats.Models)
	fmt.Printf("  贴图: %d\n", result.Stats.Textures)
	fmt.Printf("  动画: %d\n", result.Stats.Animations)
	fmt.Printf("  特效: %d\n", result.Stats.Effects)
	fmt.Printf("  其他: %d\n\n", result.Stats.Others)

	fmt.Printf("📂 按扩展名统计:\n")
	for ext, summary := range result.ByExtension {
		fmt.Printf("  %-8s %5d 个  %s\n", ext, summary.Count, formatSize(summary.Size))
	}

	if len(result.LargeFiles) > 0 {
		fmt.Printf("\n💾 大文件 (>%s):\n", formatSize(cliScanLargeFileThreshold))
		for _, f := range result.LargeFiles {
			fmt.Printf("  %s  %s\n", formatSize(f.Size), f.Path)
		}
	}
}

// repoAuditResult 仓库审计结果
type repoAuditResult struct {
	Timestamp    string               `json:"timestamp"`
	Directory    string               `json:"directory"`
	Completeness auditCompleteness    `json:"completeness"`
	Cache        auditCacheStatus     `json:"cache"`
	Resources    auditResourceSummary `json:"resources"`
	Score        int                  `json:"score"`
	Warnings     []string             `json:"warnings,omitempty"`
}

type auditCompleteness struct {
	Checked    int     `json:"checked"`
	Valid      int     `json:"valid"`
	Invalid    int     `json:"invalid"`
	Percentage float64 `json:"percentage"`
}

type auditCacheStatus struct {
	CacheDir   string  `json:"cache_dir"`
	CacheFiles int     `json:"cache_files"`
	CacheSize  int64   `json:"cache_size"`
	HitRate    float64 `json:"hit_rate"`
	Hits       int     `json:"hits"`
	Misses     int     `json:"misses"`
}

type auditResourceSummary struct {
	TotalFiles  int            `json:"total_files"`
	TotalSize   int64          `json:"total_size"`
	ByType      map[string]int `json:"by_type"`
	LargestFile string         `json:"largest_file,omitempty"`
	LargestSize int64          `json:"largest_size,omitempty"`
}

// runRepoAudit 执行仓库健康审计
func runRepoAudit(ctx *CmdContext) error {
	fs := newCmdFlagSet("repo-audit")
	dirPath := fs.String("dir", ctx.FilesRoot, "目录路径（默认使用 --files-root）")
	output := fs.String("output", "", "输出文件路径（JSON 格式）")
	_, err := parseFlags(fs, ctx.Args)
	if err != nil {
		return err
	}

	if *dirPath == "" {
		return newParamErrf("--dir 参数不能为空")
	}

	fmt.Printf("🔍 仓库审计: %s\n\n", *dirPath)

	result := repoAuditResult{
		Timestamp:    time.Now().UTC().Format(time.RFC3339),
		Directory:    *dirPath,
		Completeness: auditCompleteness{},
		Cache:        auditCacheStatus{},
		Resources: auditResourceSummary{
			ByType: make(map[string]int),
		},
		Warnings: make([]string, 0),
	}

	// 1. 资源扫描（复用 resource-scan 逻辑）
	var totalSize int64
	var largestFile string
	var largestSize int64
	resources := map[string]int{}

	err = filepath.Walk(*dirPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() {
			return nil
		}
		ext := strings.ToLower(filepath.Ext(path))
		size := info.Size()
		result.Resources.TotalFiles++
		totalSize += size

		if size > largestSize {
			largestSize = size
			largestFile = path
		}

		// 简单完整性检查
		if ext == ".ysm" || ext == ".json" {
			result.Completeness.Checked++
			result.Completeness.Valid++
		}

		// 类型统计
		classifyResource(ext, &resourceStats{})
		typeName := "other"
		switch ext {
		case ".ysm", ".json", ".pmx", ".pmd":
			typeName = "model"
		case ".png", ".jpg", ".dds", ".ktx2":
			typeName = "texture"
		case ".vmd", ".bvh":
			typeName = "animation"
		}
		resources[typeName]++

		return nil
	})

	if err != nil {
		return newRuntimeErrf("扫描目录失败: %v", err)
	}

	result.Resources.TotalSize = totalSize
	result.Resources.ByType = resources
	result.Resources.LargestFile = largestFile
	result.Resources.LargestSize = largestSize

	// 计算完整性百分比
	if result.Completeness.Checked > 0 {
		result.Completeness.Percentage = float64(result.Completeness.Valid) / float64(result.Completeness.Checked) * 100
	} else {
		result.Completeness.Percentage = 100.0
	}

	// 缓存状态
	stats := texture_cache.GetCacheStats()
	result.Cache.CacheDir = stats.Dir
	result.Cache.CacheFiles = stats.FileCount
	result.Cache.CacheSize = stats.TotalSize

	// 计算健康分数 (0-100)
	result.Score = calculateAuditScore(result)

	// 生成警告
	generateAuditWarnings(&result)

	// 输出结果
	if *output != "" {
		if jsonBytes, err := json.MarshalIndent(result, "", "  "); err == nil {
			if err := os.WriteFile(*output, jsonBytes, 0644); err != nil {
				return newRuntimeErrf("保存 JSON 文件失败: %v", err)
			}
			fmt.Printf("💾 审计结果已保存到: %s\n", *output)
			return nil
		}
		return newRuntimeErrf("JSON 序列化失败: %v", err)
	}

	// 文本输出
	printRepoAuditResult(result)
	return nil
}

// calculateAuditScore 计算健康分数
func calculateAuditScore(result repoAuditResult) int {
	score := 100

	// 完整性扣分
	if result.Completeness.Percentage < 100 {
		score -= int((100 - result.Completeness.Percentage) * 0.5)
	}
	if result.Completeness.Invalid > 0 {
		score -= result.Completeness.Invalid * 5
	}

	// 缓存扣分
	if result.Resources.TotalFiles > 0 && result.Cache.CacheFiles == 0 {
		score -= 20 // 没有缓存
	}

	// 大文件警告
	if result.Resources.LargestSize > 500*1024*1024 {
		score -= 10
	}

	if score < 0 {
		score = 0
	}
	return score
}

// generateAuditWarnings 生成审计警告
func generateAuditWarnings(result *repoAuditResult) {
	if result.Completeness.Percentage < 95 {
		result.Warnings = append(result.Warnings,
			fmt.Sprintf("模型完整性 %.1f%% 低于 95%% 阈值", result.Completeness.Percentage))
	}
	if result.Resources.TotalFiles > 0 && result.Cache.CacheFiles == 0 {
		result.Warnings = append(result.Warnings,
			"无纹理缓存，首次加载性能可能较慢")
	}
	if result.Resources.LargestSize > 100*1024*1024 {
		result.Warnings = append(result.Warnings,
			fmt.Sprintf("存在超大文件 (%s)，可能影响加载性能", formatSize(result.Resources.LargestSize)))
	}
	if result.Cache.CacheSize > 1024*1024*1024 {
		result.Warnings = append(result.Warnings,
			fmt.Sprintf("缓存大小已达 %s，建议定期清理", formatSize(result.Cache.CacheSize)))
	}
}

// printRepoAuditResult 打印仓库审计结果
func printRepoAuditResult(result repoAuditResult) {
	fmt.Printf("🏥 仓库健康审计报告:\n")
	fmt.Printf("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n")

	// 健康分数
	scoreIcon := "🟢"
	if result.Score < 80 {
		scoreIcon = "🟡"
	}
	if result.Score < 60 {
		scoreIcon = "🔴"
	}
	fmt.Printf("%s 健康分数: %d/100\n\n", scoreIcon, result.Score)

	// 完整性
	fmt.Printf("📋 完整性:\n")
	fmt.Printf("  检查模型: %d\n", result.Completeness.Checked)
	fmt.Printf("  有效: %d\n", result.Completeness.Valid)
	fmt.Printf("  无效: %d\n", result.Completeness.Invalid)
	fmt.Printf("  有效率: %.1f%%\n\n", result.Completeness.Percentage)

	// 缓存
	fmt.Printf("💾 缓存状态:\n")
	fmt.Printf("  缓存目录: %s\n", result.Cache.CacheDir)
	fmt.Printf("  缓存文件: %d\n", result.Cache.CacheFiles)
	fmt.Printf("  缓存大小: %s\n\n", formatSize(result.Cache.CacheSize))

	// 资源
	fmt.Printf("📦 资源统计:\n")
	fmt.Printf("  文件总数: %d\n", result.Resources.TotalFiles)
	fmt.Printf("  总大小: %s\n", formatSize(result.Resources.TotalSize))
	if result.Resources.LargestFile != "" {
		fmt.Printf("  最大文件: %s (%s)\n", formatSize(result.Resources.LargestSize), result.Resources.LargestFile)
	}
	fmt.Printf("  类型分布: ")
	for t, c := range result.Resources.ByType {
		fmt.Printf("%s:%d ", t, c)
	}
	fmt.Println()

	// 警告
	if len(result.Warnings) > 0 {
		fmt.Printf("\n⚠️  警告 (%d):\n", len(result.Warnings))
		for _, w := range result.Warnings {
			fmt.Printf("  • %s\n", w)
		}
	} else {
		fmt.Printf("\n✅ 无警告\n")
	}
}
