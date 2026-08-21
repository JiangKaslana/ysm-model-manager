package cli

import (
	"fmt"
	"os"
	"path/filepath"

	"ysm-model-manager/go/dedup"
)

func init() {
	RegisterCommandC("health-report", CatResource, "一键全仓体检报告（完整性+缓存+资源+去重，--bench 追加性能基线）", runHealthReport)
}

// healthReportJSON health-report 的 JSON 载荷：复用 repo-audit 的审计结构（collectRepoHealth 同源），
// 追加去重（Dedup）与可选性能基线（Bench）维度。
type healthReportJSON struct {
	Timestamp    string               `json:"timestamp"`
	Directory    string               `json:"directory"`
	Score        int                  `json:"score"`
	Completeness auditCompleteness    `json:"completeness"`
	Cache        auditCacheStatus     `json:"cache"`
	Resources    auditResourceSummary `json:"resources"`
	Dedup        dedupSummary         `json:"dedup"`
	Bench        *benchEntry          `json:"bench,omitempty"`
	Warnings     []string             `json:"warnings,omitempty"`
}

// dedupSummary 去重维度汇总
type dedupSummary struct {
	Groups     int   `json:"groups"`
	ExtraFiles int   `json:"extra_files"`
	Reclaim    int64 `json:"reclaim_bytes"`
}

// benchEntry 性能基线条目（--bench 时填充）
type benchEntry struct {
	Model       string  `json:"model"`
	TotalMs     float64 `json:"total_ms"`
	Bottleneck  string  `json:"bottleneck"`
	StagesCount int     `json:"stages"`
}

// runHealthReport 一键全仓体检报告（roadmap 方向 A）：
// collectRepoHealth（完整性+缓存+资源+分数，与 repo-audit 同源防双轨）+ dedup 去重汇总。
// --bench 追加首模型 single-bench 性能基线（默认关闭——单模型基准真跑耗时高，
// 体检走「先健康后性能」两级，常规体检不必拉性能）。
func runHealthReport(ctx *CmdContext) error {
	fs := newCmdFlagSet("health-report")
	dirPath := fs.String("dir", "", "仓库目录（默认使用 --files-root）")
	output := fs.String("output", "", "输出文件路径（JSON 格式）")
	bench := fs.Bool("bench", false, "追加首个模型的 single-bench 性能基线（默认关闭，耗时高）")
	_, err := parseFlags(fs, ctx.Args)
	if err != nil {
		return err
	}
	if *dirPath == "" {
		*dirPath = ctx.FilesRoot
	}
	if *dirPath == "" {
		return newParamErrf("health-report: --dir 参数不能为空（或提供 --files-root）")
	}

	scanDir, err := filepath.Abs(*dirPath)
	if err != nil {
		return newParamErrf("无法解析扫描目录 %q: %v", *dirPath, err)
	}

	// 1. 复用 repo-audit 核心（同源口径）
	audit, err := collectRepoHealth(scanDir)
	if err != nil {
		return err
	}

	report := healthReportJSON{
		Timestamp:    audit.Timestamp,
		Directory:    audit.Directory,
		Score:        audit.Score,
		Completeness: audit.Completeness,
		Cache:        audit.Cache,
		Resources:    audit.Resources,
		Warnings:     audit.Warnings,
	}

	// 2. 去重维度（复用 go/dedup，与 dedup 命令同库）
	if groups, err := dedup.FindDuplicateFiles(scanDir, true); err != nil {
		return newRuntimeErrf("去重扫描失败: %v", err)
	} else {
		for _, g := range groups {
			report.Dedup.Groups++
			report.Dedup.ExtraFiles += len(g.Files) - 1
			report.Dedup.Reclaim += g.Size * int64(len(g.Files)-1)
		}
	}

	// 3. 可选性能基线（首模型 single-bench，默认关）
	if *bench {
		target := scanFirstModel(scanDir)
		if target == "" {
			fmt.Println("⚠️  未找到模型，跳过性能基线（--bench）")
		} else {
			stages := runSingleModelBench(ctx.App, target, scanDir)
			avg := avgBenchStages([][]singleBenchStage{stages})
			var total float64
			for _, s := range avg {
				total += float64(s.Duration.Microseconds()) / 1000
			}
			report.Bench = &benchEntry{
				Model:       target,
				TotalMs:     total,
				Bottleneck:  bottleneckStage(avg),
				StagesCount: len(avg),
			}
		}
	}

	// 输出
	if *output != "" {
		jsonBytes, jsonErr := marshalAuditJSON(report)
		if jsonErr != nil {
			return jsonErr
		}
		if err := os.WriteFile(*output, jsonBytes, 0o644); err != nil {
			return newRuntimeErrf("保存体检报告失败: %w", err)
		}
		fmt.Printf("💾 体检报告已保存到: %s\n", *output)
	}

	printHealthReport(report)
	return nil
}

// printHealthReport 打印体检报告文本
func printHealthReport(r healthReportJSON) {
	icon := "🟢"
	if r.Score < 80 {
		icon = "🟡"
	}
	if r.Score < 60 {
		icon = "🔴"
	}
	fmt.Printf("%s 仓库健康体检: %d/100（%s）\n", icon, r.Score, r.Directory)

	fmt.Printf("\n📋 完整性: 检查 %d · 有效 %d · 无效 %d · 有效率 %.1f%%\n",
		r.Completeness.Checked, r.Completeness.Valid, r.Completeness.Invalid, r.Completeness.Percentage)

	fmt.Printf("💾 缓存: %d 个文件 · %s%s\n",
		r.Cache.CacheFiles, formatSize(r.Cache.CacheSize), cacheHitSuffix(r.Cache.HitRate))

	fmt.Printf("📦 资源: %d 个文件 · %s · 类型分布 ", r.Resources.TotalFiles, formatSize(r.Resources.TotalSize))
	for t, c := range r.Resources.ByType {
		fmt.Printf("%s:%d ", t, c)
	}
	fmt.Println()

	fmt.Printf("🗑️  去重: %d 组重复 · 多余 %d 个文件 · 可回收 %s\n", r.Dedup.Groups, r.Dedup.ExtraFiles, formatSize(r.Dedup.Reclaim))

	if r.Bench != nil {
		fmt.Printf("⚡ 性能基线: %s · %.1fms · 瓶颈 %s\n", r.Bench.Model, r.Bench.TotalMs, r.Bench.Bottleneck)
	}

	if len(r.Warnings) > 0 {
		fmt.Printf("\n⚠️  警告 (%d):\n", len(r.Warnings))
		for _, w := range r.Warnings {
			fmt.Printf("  • %s\n", w)
		}
	} else {
		fmt.Printf("\n✅ 无警告\n")
	}
}

// cacheHitSuffix 缓存命中率后缀（命中率为 0 且未计算时不展示百分比）
func cacheHitSuffix(hitRate float64) string {
	if hitRate > 0 {
		return fmt.Sprintf(" · 估算命中率 %.0f%%", hitRate)
	}
	return ""
}

// bottleneckStage 返回最慢阶段名（供 --bench 摘要）
func bottleneckStage(stages []singleBenchStage) string {
	if len(stages) == 0 {
		return ""
	}
	slowest := stages[0]
	for _, s := range stages {
		if s.Duration > slowest.Duration {
			slowest = s
		}
	}
	return slowest.Name
}
