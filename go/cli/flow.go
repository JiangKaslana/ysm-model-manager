package cli

import (
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"ysm-model-manager/go/texture_cache"
	"ysm-model-manager/go/types"
	"ysm-model-manager/internal/app"
)

func init() {
	RegisterCommand("gui-flow", "模拟 GUI 完整加载流程（配置→扫描→加载→渲染预估）", runGUIFlow)
}

// guiFlowResult GUI 流程各阶段结果
type guiFlowResult struct {
	Stage       string
	Duration    time.Duration
	Success     bool
	Description string
}

// runGUIFlow 模拟 GUI 完整加载流程
func runGUIFlow(a *app.App, args []string) error {
	fs := newCmdFlagSet("gui-flow")
	modelPath := fs.String("model", "", "指定模型路径（可选，不填则用第一个）")
	verbose := fs.Bool("verbose", false, "详细输出每个阶段的细节")
	if err := parseFlags(fs, args); err != nil {
		return err
	}

	filesRoot := parseFilesRoot(args)

	fmt.Println("🎮 GUI 流程模拟器")
	fmt.Println(strings.Repeat("=", 70))
	fmt.Printf("   根目录: %s\n", filesRoot)
	fmt.Printf("   模型:   %s\n", map[bool]string{true: *modelPath, false: "(自动选择)"}[*modelPath != ""])
	fmt.Println(strings.Repeat("=", 70))

	var results []guiFlowResult
	totalStart := time.Now()

	// ============ Phase 1: 配置加载 ============
	results = append(results, runPhaseConfigLoad(a, filesRoot))

	// ============ Phase 2: 模型扫描 ============
	results = append(results, runPhaseModelScan(a, filesRoot))

	// 如果指定了模型，使用它；否则用扫描到的第一个
	targetModel := *modelPath
	if targetModel == "" {
		if lastResult := results[len(results)-1]; lastResult.Success {
			// 从描述中提取第一个模型
			if idx := strings.Index(lastResult.Description, "首个模型:"); idx != -1 {
				targetModel = strings.TrimSpace(lastResult.Description[idx+len("首个模型:"):])
				// 取到换行前
				if nlIdx := strings.Index(targetModel, "\n"); nlIdx != -1 {
					targetModel = targetModel[:nlIdx]
				}
			}
		}
	}

	// ============ Phase 3: 模型分析（Go 侧）============
	if targetModel != "" {
		results = append(results, runPhaseModelAnalyze(a, targetModel))

		// ============ Phase 4: 纹理缓存检查 ============
		results = append(results, runPhaseTextureCache(targetModel))

		// ============ Phase 5: 数据准备（IPC 传输模拟）============
		results = append(results, runPhaseDataPrep(a, targetModel))

		// ============ Phase 6: 渲染预估 ============
		if *verbose {
			results = append(results, runPhaseRenderEstimate(a, targetModel, *verbose))
		}
	} else {
		results = append(results, guiFlowResult{
			Stage:       "模型分析",
			Success:     false,
			Description: "未找到可分析的模型",
		})
	}

	// ============ 汇总报告 ============
	totalDuration := time.Since(totalStart)
	if err := printFlowReport(results, totalDuration, *verbose); err != nil {
		return err
	}

	return nil
}

// runPhaseConfigLoad 模拟配置加载
func runPhaseConfigLoad(a *app.App, filesRoot string) guiFlowResult {
	start := time.Now()

	err := a.SaveAppConfig(filesRoot, "", "", "", "")
	if err != nil {
		return guiFlowResult{
			Stage:       "① 配置加载",
			Duration:    time.Since(start),
			Success:     false,
			Description: fmt.Sprintf("❌ 失败: %v", err),
		}
	}

	config := a.LoadAppConfig()
	modelRoot := config.FilesRoot
	if m := config.CustomRoots["ysm"]; m != "" {
		modelRoot = m
	}

	return guiFlowResult{
		Stage:    "① 配置加载",
		Duration: time.Since(start),
		Success:  true,
		Description: fmt.Sprintf("✅ 配置已加载\n   仓库根: %s\n   模型根: %s",
			config.FilesRoot, modelRoot),
	}
}

// runPhaseModelScan 模拟模型扫描
func runPhaseModelScan(a *app.App, filesRoot string) guiFlowResult {
	start := time.Now()

	entries := a.ScanModelEntries(filesRoot)
	elapsed := time.Since(start)

	if len(entries) == 0 {
		return guiFlowResult{
			Stage:       "② 模型扫描",
			Duration:    elapsed,
			Success:     false,
			Description: "❌ 未找到任何模型",
		}
	}

	// 统计模型类型
	yamlCount := 0
	ysmCount := 0
	otherCount := 0
	var firstModel string

	for _, e := range entries {
		ext := strings.ToLower(filepath.Ext(e.Path))
		if ext == ".yml" || ext == ".yaml" {
			yamlCount++
		} else if ext == ".ysm" {
			ysmCount++
			if firstModel == "" {
				firstModel = e.Path
			}
		} else {
			otherCount++
		}
		// 如果没有 YSM，用 YAML
		if firstModel == "" && (ext == ".yml" || ext == ".yaml") {
			firstModel = e.Path
		}
	}

	return guiFlowResult{
		Stage:    "② 模型扫描",
		Duration: elapsed,
		Success:  true,
		Description: fmt.Sprintf(
			"✅ 发现 %d 个模型 (%.0f models/sec)\n   YAML: %d, YSM: %d, 其他: %d\n   首个模型: %s",
			len(entries),
			float64(len(entries))/elapsed.Seconds(),
			yamlCount, ysmCount, otherCount,
			firstModel,
		),
	}
}

// runPhaseModelAnalyze 模拟模型分析
func runPhaseModelAnalyze(a *app.App, modelPath string) guiFlowResult {
	start := time.Now()

	model := a.AnalyzeBedrockModel(modelPath)
	elapsed := time.Since(start)

	if model.Bones == nil || len(model.Bones) == 0 {
		return guiFlowResult{
			Stage:       "③ 模型分析",
			Duration:    elapsed,
			Success:     false,
			Description: fmt.Sprintf("❌ 分析失败: %s", modelPath),
		}
	}

	boneCount := len(model.Bones)
	texCount := len(model.Textures)
	geoSize := estimateGeometrySize(model)

	return guiFlowResult{
		Stage:    "③ 模型分析",
		Duration: elapsed,
		Success:  true,
		Description: fmt.Sprintf(
			"✅ 分析完成\n   文件: %s\n   骨骼: %d\n   纹理: %d\n   预估几何: %s",
			filepath.Base(modelPath),
			boneCount, texCount,
			formatSize(geoSize),
		),
	}
}

// runPhaseTextureCache 检查纹理缓存状态
func runPhaseTextureCache(modelPath string) guiFlowResult {
	start := time.Now()

	hash, err := texture_cache.TextureHash(modelPath)
	if err != nil {
		return guiFlowResult{
			Stage:       "④ 纹理缓存",
			Duration:    time.Since(start),
			Success:     false,
			Description: fmt.Sprintf("❌ 哈希计算失败: %v", err),
		}
	}

	cached, ok, _ := texture_cache.ReadCached(hash)
	elapsed := time.Since(start)

	if ok && cached != nil {
		return guiFlowResult{
			Stage:    "④ 纹理缓存",
			Duration: elapsed,
			Success:  true,
			Description: fmt.Sprintf("✅ 缓存命中 (%.0f KB)\n   哈希: %s",
				float64(len(cached))/1024, hash[:16]+"..."),
		}
	}

	return guiFlowResult{
		Stage:       "④ 纹理缓存",
		Duration:    elapsed,
		Success:     true,
		Description: fmt.Sprintf("⚠️  缓存未命中（首次加载会编码生成）\n   哈希: %s", hash[:16]+"..."),
	}
}

// runPhaseDataPrep 模拟数据准备与 IPC 传输
func runPhaseDataPrep(a *app.App, modelPath string) guiFlowResult {
	start := time.Now()

	model := a.AnalyzeBedrockModel(modelPath)
	elapsed := time.Since(start)

	// 估算 IPC 传输大小
	geoSize := estimateGeometrySize(model)
	texSize := estimateTextureSize(model)
	totalSize := geoSize + texSize

	// Base64 编码后会膨胀约 33%
	ipcSize := totalSize * 4 / 3

	return guiFlowResult{
		Stage:    "⑤ 数据准备",
		Duration: elapsed,
		Success:  true,
		Description: fmt.Sprintf(
			"📦 数据就绪\n   几何数据: %s\n   纹理数据: %s\n   IPC 估算: %s (Base64 后)\n   预计传输: %.0fms (假设 50MB/s)",
			formatSize(geoSize),
			formatSize(texSize),
			formatSize(ipcSize),
			float64(ipcSize)/(50*1024*1024)*1000,
		),
	}
}

// runPhaseRenderEstimate 模拟渲染预估
func runPhaseRenderEstimate(a *app.App, modelPath string, verbose bool) guiFlowResult {
	start := time.Now()

	model := a.AnalyzeBedrockModel(modelPath)
	elapsed := time.Since(start)

	boneCount := len(model.Bones)
	texCount := len(model.Textures)

	// Three.js 渲染预估
	var renderEstimate string
	switch {
	case boneCount > 5000 || texCount > 50:
		renderEstimate = "🔴 高负载 (5000+ 骨骼或 50+ 纹理) — 建议使用 LOD"
	case boneCount > 2000 || texCount > 20:
		renderEstimate = "🟡 中等负载 (2000+ 骨骼或 20+ 纹理)"
	default:
		renderEstimate = "🟢 轻量负载 — 可流畅渲染"
	}

	return guiFlowResult{
		Stage:    "⑥ 渲染预估",
		Duration: elapsed,
		Success:  true,
		Description: fmt.Sprintf(
			"%s\n   骨骼: %d, 纹理: %d\n   预估首帧: %.0f-%.0fms",
			renderEstimate,
			boneCount, texCount,
			float64(boneCount)*0.01+50, // 粗略估计
			float64(boneCount)*0.02+100,
		),
	}
}

// printFlowReport 打印流程报告
func printFlowReport(results []guiFlowResult, totalDuration time.Duration, verbose bool) error {
	fmt.Println()
	fmt.Println("📊 流程报告")
	fmt.Println(strings.Repeat("-", 70))

	var successCount int
	var failCount int

	for i, r := range results {
		status := "✅"
		if !r.Success {
			status = "❌"
			failCount++
		} else {
			successCount++
		}

		fmt.Printf("\n%s [%d] %s (%.2fms)\n",
			status, i+1, r.Stage,
			float64(r.Duration.Microseconds())/1000)

		// 打印描述（缩进）
		for _, line := range strings.Split(r.Description, "\n") {
			fmt.Printf("   %s\n", line)
		}
	}

	fmt.Println()
	fmt.Println(strings.Repeat("-", 70))
	fmt.Printf("⏱️  总耗时: %.2fms\n", float64(totalDuration.Microseconds())/1000)
	fmt.Printf("📈 成功: %d, 失败: %d\n", successCount, failCount)

	if failCount > 0 {
		fmt.Println()
		fmt.Println("⚠️  有阶段失败，请检查上述输出")
		return fmt.Errorf("有 %d 个阶段失败", failCount)
	} else {
		fmt.Println()
		fmt.Println("🎉 GUI 流程模拟完成！")
		fmt.Println()
		fmt.Println("💡 提示:")
		fmt.Println("   - CLI 仅模拟后端流程，前端 Three.js 渲染需在 GUI 中验证")
		fmt.Println("   - 缓存未命中属正常现象，首次加载后会自动编码生成")
		fmt.Println("   - 使用 'cache-status' 查看缓存状态")
	}

	return nil
}

// estimateGeometrySize 估算几何体大小
func estimateGeometrySize(model types.BedrockModel) int64 {
	var size int64

	// 顶点数据（假设每个顶点 36 字节: 位置 + 法线 + UV）
	if len(model.Bones) > 0 {
		size += int64(len(model.Bones)) * 36
	}

	// 动画数据
	for _, anim := range model.Animations {
		size += int64(len(anim))
	}

	// 立方块数据（假设每个 cube 约 80 字节）
	for _, bone := range model.Bones {
		size += int64(len(bone.Cubes)) * 80
	}

	return size
}

// estimateTextureSize 估算纹理数据大小
func estimateTextureSize(model types.BedrockModel) int64 {
	var size int64

	// 主纹理
	if model.Texture != "" {
		size += int64(len(model.Texture)) * 3 / 4 // Base64 解码后大小
	}

	// 多纹理
	for _, tex := range model.Textures {
		if tex != "" {
			size += int64(len(tex)) * 3 / 4
		}
	}

	return size
}
