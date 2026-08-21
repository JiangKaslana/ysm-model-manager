package cli

import (
	"flag"
	"fmt"
	"os"

	"ysm-model-manager/internal/app"
)

// CmdContext 统一命令执行上下文
type CmdContext struct {
	App       *app.App
	FilesRoot string
	Args      []string
}

// CliCommand 命令注册结构
type CliCommand struct {
	Name        string
	Category    string
	Description string
	// Flags 命令的 FlagSet，供 per-command --help 反射 PrintDefaults。
	// 可选：命令实现里 fs := newCmdFlagSet(name); ... cmd.Flags = fs 注册。
	Flags *flag.FlagSet
	// Subcommands 嵌套子命令映射（key=子命令名）。非空时 Run 应自行分发 ctx.Args[0]。
	Subcommands map[string]CliCommand
	Run         func(ctx *CmdContext) error
}

// 命令分类常量
const (
	CatModel    = "模型管理"
	CatPerf     = "性能诊断"
	CatCache    = "缓存管理"
	CatResource = "资源仓库"
	CatConfig   = "配置"
	CatOther    = "其他"
)

var cliCommands = map[string]CliCommand{}

// RegisterCommand 注册一个 CLI 子命令（默认归入 CatOther）
// 重复注册会输出警告并跳过，不再 panic（init() 阶段 panic 无法 recover）
func RegisterCommand(name, description string, run func(ctx *CmdContext) error) {
	RegisterCommandC(name, CatOther, description, run)
}

// RegisterCommandC 注册带分类的 CLI 子命令
func RegisterCommandC(name, category, description string, run func(ctx *CmdContext) error) {
	if _, exists := cliCommands[name]; exists {
		fmt.Fprintf(os.Stderr, "[WARN] CLI 命令 %q 重复注册，跳过\n", name)
		return
	}
	cliCommands[name] = CliCommand{
		Name:        name,
		Category:    category,
		Description: description,
		Run:         run,
	}
}

// RegisterSubcommand 为父命令注册嵌套子命令。
// 父命令必须先通过 RegisterCommand/RegisterCommandC 注册。
// 父命令的 Run 负责从 ctx.Args[0] 取子命令名再分发；
// 若子命令未命中，父命令应打印自身子命令列表。
func RegisterSubcommand(parent, subName, subDesc string, subRun func(ctx *CmdContext) error) {
	parentCmd, exists := cliCommands[parent]
	if !exists {
		fmt.Fprintf(os.Stderr, "[WARN] 父命令 %q 未注册，无法挂载子命令 %q\n", parent, subName)
		return
	}
	if parentCmd.Subcommands == nil {
		parentCmd.Subcommands = map[string]CliCommand{}
	}
	if _, dup := parentCmd.Subcommands[subName]; dup {
		fmt.Fprintf(os.Stderr, "[WARN] 子命令 %q.%q 重复注册，跳过\n", parent, subName)
		return
	}
	parentCmd.Subcommands[subName] = CliCommand{
		Name:        subName,
		Category:    parentCmd.Category,
		Description: subDesc,
		Run:         subRun,
	}
	cliCommands[parent] = parentCmd // map value 是 struct，需写回
}

// DispatchSubcommand 在父命令 Run 内调用：取 ctx.Args[0] 作子命令名分发。
// 无子命令或未命中时返回 (nil, false)，由父命令自行处理（打印子命令列表或报错）。
func DispatchSubcommand(ctx *CmdContext, parent CliCommand) (CliCommand, bool) {
	if len(ctx.Args) == 0 || parent.Subcommands == nil {
		return CliCommand{}, false
	}
	sub, ok := parent.Subcommands[ctx.Args[0]]
	return sub, ok
}

// GetCommand 获取已注册的命令
func GetCommand(name string) (CliCommand, bool) {
	cmd, exists := cliCommands[name]
	return cmd, exists
}

// GetAllCommands 获取所有已注册命令
func GetAllCommands() []CliCommand {
	var cmds []CliCommand
	for _, cmd := range cliCommands {
		cmds = append(cmds, cmd)
	}
	return cmds
}

// DispatchCommand 分发命令执行
func DispatchCommand(a *app.App, saveConfigFn func(filesRoot, rpRoot, mcRoot, linkMode, theme string) error, filesRoot string, commandArgs []string, requireFilesRoot bool) error {
	if len(commandArgs) == 0 {
		return nil
	}

	cmdName := commandArgs[0]

	if len(commandArgs) > 1 && (commandArgs[1] == "--help" || commandArgs[1] == "-h") {
		printCommandHelp(cmdName)
		return nil
	}

	cmd, exists := cliCommands[cmdName]
	if !exists {
		return &ErrParam{CmdName: cmdName,
			Err: fmt.Errorf("未知命令: %s", cmdName)}
	}

	if requireFilesRoot && filesRoot == "" {
		return &ErrParam{CmdName: cmdName,
			Err: fmt.Errorf("--files-root 参数不能为空")}
	}

	if filesRoot != "" && saveConfigFn != nil {
		if err := saveConfigFn(filesRoot, "", "", "", ""); err != nil {
			return &ErrRuntime{CmdName: cmdName,
				Err: fmt.Errorf("初始化配置失败: %w", err)}
		}
	}

	ctx := &CmdContext{App: a, FilesRoot: filesRoot, Args: commandArgs[1:]}
	if err := cmd.Run(ctx); err != nil {
		return err
	}

	return nil
}
