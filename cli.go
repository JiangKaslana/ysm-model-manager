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

// cliCommands 注册所有 CLI 子命令（由各文件的 init() 自注册）
var cliCommands = map[string]cliCommand{}

// RegisterCommand 注册一个 CLI 子命令（供各文件的 init() 调用）
func RegisterCommand(name, description string, run func(a *app.App, args []string) error) {
	if _, exists := cliCommands[name]; exists {
		panic(fmt.Sprintf("CLI 命令 %q 重复注册", name))
	}
	cliCommands[name] = cliCommand{
		Name:        name,
		Description: description,
		Run:         run,
	}
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
