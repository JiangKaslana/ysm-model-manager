package cli

import (
	"fmt"
	"runtime"
	"sort"

	"ysm-model-manager/go/version"
	"ysm-model-manager/internal/app"
)

// printFn 可替换的打印函数
var printFn = func(a ...any) {
	fmt.Println(a...)
}

// RunCLI 执行 CLI 模式
func RunCLI(args []string) error {
	if len(args) > 0 && (args[0] == "--version" || args[0] == "-v") {
		printVersion()
		return nil
	}

	if len(args) == 0 || args[0] == "--help" || args[0] == "-h" {
		printCLIHelp()
		return nil
	}

	filesRoot, jsonMode, commandArgs := ParseCommandArgs(args)

	if len(commandArgs) == 0 {
		printCLIHelp()
		return nil
	}

	if filesRoot == "" {
		printCLIHelp()
		if jsonMode {
			resp := NewJsonError(commandArgs[0], &ErrParam{Err: fmt.Errorf("--files-root 参数不能为空")}, 0)
			fmt.Println(resp.ToJson())
		}
		return &ErrParam{Err: fmt.Errorf("--files-root 参数不能为空")}
	}

	a := app.NewApp()

	// 全局 --json 模式：捕获输出并包装为 JSON 响应
	if jsonMode {
		outputBuf, restoreStdout := captureStdout()
		err := DispatchCommand(a, a.SaveAppConfig, filesRoot, jsonMode, commandArgs, true)
		restoreStdout()

		cmdName := commandArgs[0]
		elapsed := float64(0)

		if err != nil {
			resp := NewJsonError(cmdName, err, elapsed)
			fmt.Println(resp.ToJson())
		} else {
			resp := NewJsonSuccess(cmdName, map[string]interface{}{
				"output":    outputBuf.String(),
				"lines":     splitLines(outputBuf.String()),
				"filesRoot": filesRoot,
			}, elapsed)
			// 覆盖平台信息（使用 CLI 运行平台）
			resp.Meta.Platform = runtime.GOOS
			fmt.Println(resp.ToJson())
		}
		return err
	}

	return DispatchCommand(a, a.SaveAppConfig, filesRoot, jsonMode, commandArgs, true)
}

// ExecuteCLIWithApp 执行 CLI 命令
func ExecuteCLIWithApp(a *app.App, saveConfigFn func(filesRoot, rpRoot, mcRoot, linkMode, theme string) error, args []string) error {
	if len(args) > 0 && (args[0] == "--version" || args[0] == "-v") {
		printVersion()
		return nil
	}

	if len(args) == 0 || args[0] == "--help" || args[0] == "-h" {
		printCLIHelp()
		return nil
	}

	filesRoot, jsonMode, commandArgs := ParseCommandArgs(args)

	if len(commandArgs) == 0 {
		printCLIHelp()
		return nil
	}

	return DispatchCommand(a, saveConfigFn, filesRoot, jsonMode, commandArgs, false)
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
	fmt.Println("  --json                 全局 JSON 输出模式")
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
