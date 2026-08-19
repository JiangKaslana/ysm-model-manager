package cli

import (
	"fmt"

	"ysm-model-manager/internal/app"
)

// AppAdapter CLI 所需的 App 功能接口
type AppAdapter interface {
	GetYSMRepoRoot() string
	SaveAppConfig(filesRoot, rpRoot, mcRoot, linkMode, theme string) error
}

// AppConfigData 应用配置数据
type AppConfigData struct {
	FilesRoot   string
	McRoot      string
	LinkMode    string
	Theme       string
	YsmRoot     string
	MmdRoot     string
	CustomRoots map[string]string
}

// CmdContext 统一命令执行上下文
type CmdContext struct {
	App       *app.App
	FilesRoot string
	Args      []string
	JsonMode  bool
}

// CliCommand 命令注册结构
type CliCommand struct {
	Name        string
	Description string
	Run         func(ctx *CmdContext) error
}

var cliCommands = map[string]CliCommand{}

// RegisterCommand 注册一个 CLI 子命令
func RegisterCommand(name, description string, run func(ctx *CmdContext) error) {
	if _, exists := cliCommands[name]; exists {
		panic(fmt.Sprintf("CLI 命令 %q 重复注册", name))
	}
	cliCommands[name] = CliCommand{
		Name:        name,
		Description: description,
		Run:         run,
	}
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
func DispatchCommand(a *app.App, saveConfigFn func(filesRoot, rpRoot, mcRoot, linkMode, theme string) error, filesRoot string, jsonMode bool, commandArgs []string, requireFilesRoot bool) error {
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

	ctx := &CmdContext{App: a, FilesRoot: filesRoot, Args: commandArgs[1:], JsonMode: jsonMode}
	if err := cmd.Run(ctx); err != nil {
		return err
	}

	return nil
}
