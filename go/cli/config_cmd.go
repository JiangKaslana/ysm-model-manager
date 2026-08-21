package cli

import (
	"fmt"
	"strings"
)

func init() {
	// config 父命令：统一配置入口
	RegisterCommandC("config", CatConfig, "配置管理（子命令: show/path/mc-paths/mirror/link-mode）", runConfig)
}

// runConfig 父命令：分发子命令。无子命令时打印用法。
func runConfig(ctx *CmdContext) error {
	if len(ctx.Args) == 0 {
		printConfigUsage()
		return nil
	}
	sub := ctx.Args[0]
	subCtx := &CmdContext{App: ctx.App, FilesRoot: ctx.FilesRoot, Args: ctx.Args[1:]}

	switch sub {
	case "show":
		// 复用已有 config-show 命令体
		return runConfigShow(subCtx)
	case "path":
		fmt.Printf("📄 配置文件路径: %s\n", ctx.App.GetConfigPath())
		return nil
	case "mc-paths":
		paths := ctx.App.GetMinecraftPaths()
		if len(paths) == 0 {
			fmt.Println("📭 未检测到 Minecraft 安装路径")
			return nil
		}
		fmt.Printf("🎮 检测到 %d 个 Minecraft 路径:\n", len(paths))
		for i, p := range paths {
			fmt.Printf("  %d. %s\n", i+1, p)
		}
		return nil
	case "mirror":
		return runConfigMirror(subCtx)
	case "link-mode":
		return runConfigLinkMode(subCtx)
	default:
		return &ErrParam{CmdName: "config", Err: fmt.Errorf("未知子命令: %s", sub)}
	}
}

// printConfigUsage 打印 config 父命令用法
func printConfigUsage() {
	fmt.Println("📖 config - 配置管理")
	fmt.Println()
	fmt.Println("用法:")
	fmt.Println("  app --cli --files-root <路径> config <子命令> [选项...]")
	fmt.Println()
	fmt.Println("子命令:")
	fmt.Println("  show                 查看当前配置（同 config-show）")
	fmt.Println("  path                 查看配置文件路径")
	fmt.Println("  mc-paths             检测 Minecraft 安装路径")
	fmt.Println("  mirror               设置下载镜像")
	fmt.Println("  link-mode            查看或设置链接模式")
	fmt.Println()
	fmt.Println("示例:")
	fmt.Println("  app --cli --files-root ./models config show")
	fmt.Println("  app --cli --files-root ./models config mirror --url https://mirror.example.com")
}

// runConfigMirror 设置下载镜像
func runConfigMirror(ctx *CmdContext) error {
	fs := newCmdFlagSet("config mirror")
	url := fs.String("url", "", "镜像 URL（设置为空则清除镜像）")
	_, err := parseFlags(fs, ctx.Args)
	if err != nil {
		return err
	}

	// 统一 trim：存储、空判、显示三处用同一个值，避免空白输入误报"已设置"
	mirror := strings.TrimSpace(*url)

	if err := ctx.App.SetDownloadMirror(mirror); err != nil {
		return newRuntimeErrf("设置镜像失败: %w", err)
	}
	if mirror == "" {
		fmt.Println("✅ 已清除下载镜像")
	} else {
		fmt.Printf("✅ 下载镜像已设置为: %s\n", mirror)
	}
	return nil
}

// runConfigLinkMode 查看或设置链接模式
func runConfigLinkMode(ctx *CmdContext) error {
	fs := newCmdFlagSet("config link-mode")
	mode := fs.String("mode", "", "链接模式: symlink|hardlink|copy（不填则查看当前模式）")
	_, err := parseFlags(fs, ctx.Args)
	if err != nil {
		return err
	}

	// 无 --mode：查看当前
	if *mode == "" {
		current := ctx.App.GetLinkMode()
		fmt.Printf("🔗 当前链接模式: %s\n", current)
		fmt.Println("   可选: symlink | hardlink | copy")
		return nil
	}

	// 有 --mode：设置
	validModes := []string{"symlink", "hardlink", "copy"}
	modeValid := false
	for _, v := range validModes {
		if v == *mode {
			modeValid = true
			break
		}
	}
	if !modeValid {
		return newParamErrf("config link-mode: 无效模式 %q，可选: %s", *mode, strings.Join(validModes, "|"))
	}

	if err := ctx.App.SetLinkMode(*mode); err != nil {
		return newRuntimeErrf("设置链接模式失败: %w", err)
	}
	fmt.Printf("✅ 链接模式已设置为: %s\n", *mode)
	return nil
}
