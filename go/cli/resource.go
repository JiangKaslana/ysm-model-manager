package cli

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"ysm-model-manager/go/repoaudit"
)

func init() {
	RegisterCommandC("resource-scan", CatResource, "扫描模型仓库资源，统计资产分布", runResourceScan)
	RegisterCommandC("repo-audit", CatResource, "仓库健康审计（完整性 + 缓存 + 资产）", runRepoAudit)
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
	Warnings    []string              `json:"warnings,omitempty"`
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
	ByType map[string]int `json:"by_type"`
}

// addClassified 把 Classify 结果累加进动态类型 map
func addClassified(ext string, stats *resourceStats) {
	t := repoaudit.Classify(ext)
	if stats.ByType == nil {
		stats.ByType = make(map[string]int)
	}
	stats.ByType[t]++
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
			result.Warnings = append(result.Warnings, fmt.Sprintf("访问异常: %s (%v)", path, err))
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

		// 按类型分类统计（与审计共用 repoaudit.Classify 口径）
		addClassified(ext, &result.Stats)

		return nil
	})

	if err != nil {
		return newRuntimeErrf("扫描目录失败: %v", err)
	}

	// 输出结果
	if *output != "" {
		jsonBytes, jsonErr := marshalAuditJSON(result)
		if jsonErr != nil {
			return jsonErr
		}
		if err := os.WriteFile(*output, jsonBytes, 0644); err != nil {
			return newRuntimeErrf("保存 JSON 文件失败: %v", err)
		}
		fmt.Printf("💾 资源扫描结果已保存到: %s\n", *output)
		return nil
	}

	// 文本输出
	printResourceScanResult(result)

	return nil
}

// printResourceScanResult 打印资源扫描结果
func printResourceScanResult(result resourceScanResult) {
	fmt.Printf("📊 资源扫描结果:\n")
	fmt.Printf("  目录: %s\n", result.Directory)
	fmt.Printf("  文件总数: %d\n", result.TotalFiles)
	fmt.Printf("  目录总数: %d\n", result.TotalDirs)
	fmt.Printf("  总大小: %s\n\n", formatSize(result.TotalSize))

	fmt.Printf("📦 资源分类:\n")
	// 按 id 排序保证输出稳定
	keys := make([]string, 0, len(result.Stats.ByType))
	for k := range result.Stats.ByType {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		fmt.Printf("  %-14s %5d\n", k, result.Stats.ByType[k])
	}
	fmt.Println()

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

// runRepoAudit 执行仓库健康审计（核心逻辑在 repoaudit 共享包，CLI 只做参数/输出薄壳）
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

	result, err := repoaudit.Audit(*dirPath)
	if err != nil {
		return newRuntimeErrf("审计失败: %v", err)
	}

	// 输出结果
	if *output != "" {
		jsonBytes, jsonErr := marshalAuditJSON(result)
		if jsonErr != nil {
			return jsonErr
		}
		if err := os.WriteFile(*output, jsonBytes, 0644); err != nil {
			return newRuntimeErrf("保存审计 JSON 失败: %v", err)
		}
		fmt.Printf("💾 审计结果已保存到: %s\n", *output)
		return nil
	}

	// 文本输出
	printRepoAuditResult(result)
	return nil
}

// marshalAuditJSON 序列化审计/体检结果（规律六：JSON 序列化错误不吞 + %w 保留错误链）
func marshalAuditJSON(v interface{}) ([]byte, error) {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return nil, newRuntimeErrf("JSON 序列化失败: %w", err)
	}
	return data, nil
}

// printRepoAuditResult 打印仓库审计结果
func printRepoAuditResult(result repoaudit.Result) {
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
