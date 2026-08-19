package main

import (
	"fmt"
	"strings"

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
	"cache-diag": {
		Name:        "cache-diag",
		Description: "诊断缓存流程（哈希计算、读写功能、目录权限）",
		Run:         runCacheDiag,
	},
	"config-show": {
		Name:        "config-show",
		Description: "查看当前配置",
		Run:         runConfigShow,
	},
}

// runCLI 执行 CLI 模式
func runCLI(args []string) error {
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

	a := app.NewApp()
	if err := a.SaveAppConfig(filesRoot, "", "", "", ""); err != nil {
		return fmt.Errorf("初始化配置失败: %w", err)
	}

	fmt.Printf("🚀 CLI Mode: %s\n", cmd.Name)
	fmt.Printf("   根目录: %s\n\n", filesRoot)

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
