package cli

import (
	"fmt"
	"sort"

	"ysm-model-manager/go/version"
	"ysm-model-manager/internal/app"
)

// cliCommand CLI 子命令定义
type cliCommand struct {
	Name        string
	Description string
	Run         func(ctx *CmdContext) error
}

// cliCommands 注册所有 CLI 子命令（由各文件的 init() 自注册）
var cliCommands = map[string]cliCommand{}

// RegisterCommand 注册一个 CLI 子命令（供各文件的 init() 调用）
func RegisterCommand(name, description string, run func(ctx *CmdContext) error) {
	if _, exists := cliCommands[name]; exists {
		panic(fmt.Sprintf("CLI 命令 %q 重复注册", name))
	}
	cliCommands[name] = cliCommand{
		Name:        name,
		Description: description,
		Run:         run,
	}
}

// dispatchCommand 内部路由：根据命令名查找并执行命令
// requireFilesRoot=true 时，filesRoot 为空会返回 ErrParam（生产路径）
// requireFilesRoot=false 时，允许 filesRoot 为空（测试复用路径）
func dispatchCommand(a *app.App, filesRoot string, commandArgs []string, requireFilesRoot bool) error {
	if len(commandArgs) == 0 {
		printCLIHelp()
		return nil
	}

	cmdName := commandArgs[0]

	// 子命令 --help
	if len(commandArgs) > 1 && (commandArgs[1] == "--help" || commandArgs[1] == "-h") {
		printCommandHelp(cmdName)
		return nil
	}

	cmd, exists := cliCommands[cmdName]
	if !exists {
		fmt.Printf("❌ 未知命令: %s\n\n", cmdName)
		printCLIHelp()
		return &ErrParam{CmdName: cmdName,
			Err: fmt.Errorf("未知命令: %s", cmdName)}
	}

	if requireFilesRoot && filesRoot == "" {
		return &ErrParam{CmdName: cmdName,
			Err: fmt.Errorf("--files-root 参数不能为空")}
	}

	if err := a.SaveAppConfig(filesRoot, "", "", "", ""); err != nil {
		return &ErrRuntime{CmdName: cmdName,
			Err: fmt.Errorf("初始化配置失败: %w", err)}
	}

	fmt.Printf("🚀 CLI Mode: %s\n", cmd.Name)
	fmt.Printf("   根目录: %s\n\n", filesRoot)

	ctx := &CmdContext{App: a, FilesRoot: filesRoot, Args: commandArgs[1:]}
	if err := cmd.Run(ctx); err != nil {
		return err
	}

	return nil
}

// RunCLI 执行 CLI 模式
// 返回的 error 用于映射到正确的退出码
// 支持: --help, --version, <command> --help
func RunCLI(args []string) error {
	// 全局 --version
	if len(args) > 0 && (args[0] == "--version" || args[0] == "-v") {
		printVersion()
		return nil
	}

	// 全局 --help (无参数时)
	if len(args) == 0 || args[0] == "--help" || args[0] == "-h" {
		printCLIHelp()
		return nil
	}

	filesRoot, commandArgs := ParseCommandArgs(args)

	if len(commandArgs) == 0 {
		printCLIHelp()
		return nil
	}

	return dispatchCommand(app.NewApp(), filesRoot, commandArgs, true)
}

// runCLIWithApp 使用预初始化的 App 执行 CLI 模式（用于测试）
// 与 RunCLI 的区别：filesRoot 可空（便于无文件根的单测场景）
func runCLIWithApp(a *app.App, args []string) error {
	// --version
	if len(args) > 0 && (args[0] == "--version" || args[0] == "-v") {
		printVersion()
		return nil
	}

	// --help
	if len(args) == 0 || args[0] == "--help" || args[0] == "-h" {
		printCLIHelp()
		return nil
	}

	filesRoot, commandArgs := ParseCommandArgs(args)

	if len(commandArgs) == 0 {
		printCLIHelp()
		return nil
	}

	return dispatchCommand(a, filesRoot, commandArgs, false)
}

// printVersion 打印版本信息
func printVersion() {
	fmt.Printf("YSM 模型管理器 v%s\n", version.Version)
	fmt.Println("  CLI 模式")
}

// printCLIHelp 打印 CLI 帮助信息
func printCLIHelp() {
	fmt.Println("🎮 YSM 模型管理器 - CLI 模式")
	fmt.Println()
	fmt.Printf("版本: v%s\n", version.Version)
	fmt.Println()
	fmt.Println("用法:")
	fmt.Println("  app --cli --files-root <路径> <命令> [选项]")
	fmt.Println()
	fmt.Println("可用命令:")

	// 按字母顺序排序显示
	var names []string
	for name := range cliCommands {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		cmd := cliCommands[name]
		fmt.Printf("  %-18s %s\n", name, cmd.Description)
	}

	fmt.Println()
	fmt.Println("全局选项:")
	fmt.Println("  --files-root <路径>    模型仓库根目录 (必填)")
	fmt.Println("  --help, -h             显示帮助信息")
	fmt.Println("  --version, -v          显示版本号")
	fmt.Println()
	fmt.Println("获取帮助:")
	fmt.Println("  app --cli --help")
	fmt.Println("  app --cli <命令> --help")
	fmt.Println()
	fmt.Println("示例:")
	fmt.Println("  app --cli --files-root ./models search --keyword warrior")
	fmt.Println("  app --cli --files-root ./models list --format table")
	fmt.Println("  app --cli --files-root ./models analyze --model ./models/player/ysm.json")
	fmt.Println("  app --cli --files-root ./models single-bench --model ./models/player.ysm")
	fmt.Println("  app --cli --files-root ./models concurrent-bench --workers 4")
}

// printCommandHelp 打印子命令帮助信息
func printCommandHelp(cmdName string) {
	cmd, exists := cliCommands[cmdName]
	if !exists {
		fmt.Printf("❌ 未知命令: %s\n", cmdName)
		return
	}

	fmt.Printf("📖 命令: %s\n", cmd.Name)
	fmt.Println()
	fmt.Printf("说明: %s\n", cmd.Description)
	fmt.Println()
	fmt.Println("用法:")
	fmt.Printf("  app --cli --files-root <路径> %s [选项...]\n", cmdName)
	fmt.Println()
	fmt.Println("详细参数请查看 AGENTS.md 的 CLI 模式使用说明章节。")
	fmt.Println("或在命令前加 --help 查看具体选项。")
}
