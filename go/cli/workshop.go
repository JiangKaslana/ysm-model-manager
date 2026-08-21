package cli

import (
	"fmt"
	"strings"
)

func init() {
	RegisterCommandC("workshop", CatResource, "工坊站点管理（子命令: sites/validate）", runWorkshop)
}

// runWorkshop 父命令：分发子命令。无子命令时打印用法。
func runWorkshop(ctx *CmdContext) error {
	if len(ctx.Args) == 0 {
		printWorkshopUsage()
		return nil
	}
	sub := ctx.Args[0]
	subCtx := &CmdContext{App: ctx.App, FilesRoot: ctx.FilesRoot, Args: ctx.Args[1:]}

	switch sub {
	case "sites":
		return runWorkshopSites(subCtx)
	case "validate":
		return runWorkshopValidate(subCtx)
	default:
		return &ErrParam{CmdName: "workshop", Err: fmt.Errorf("未知子命令: %s", sub)}
	}
}

// printWorkshopUsage 打印 workshop 父命令用法
func printWorkshopUsage() {
	fmt.Println("📖 workshop - 工坊站点管理")
	fmt.Println()
	fmt.Println("用法:")
	fmt.Println("  app --cli --files-root <路径> workshop <子命令> [选项...]")
	fmt.Println()
	fmt.Println("子命令:")
	fmt.Println("  sites                列出所有工坊站点")
	fmt.Println("  validate             校验站点配置文件")
	fmt.Println()
	fmt.Println("示例:")
	fmt.Println("  app --cli --files-root ./models workshop sites")
	fmt.Println("  app --cli --files-root ./models workshop validate")
}

// runWorkshopSites 列出工坊站点
func runWorkshopSites(ctx *CmdContext) error {
	sites := ctx.App.DefaultWorkshopSites()
	if len(sites) == 0 {
		fmt.Println("📭 暂无工坊站点配置")
		return nil
	}

	fmt.Printf("🌐 共 %d 个工坊站点:\n", len(sites))
	fmt.Printf("%-12s %-15s %-25s %s\n", "ID", "标签", "URL", "分组")
	fmt.Println(strings.Repeat("-", 80))
	for _, s := range sites {
		id := truncateRunes(s.ID, 10)
		label := truncateRunes(s.Label, 13)
		url := truncateRunes(s.URL, 23)
		group := truncateRunes(s.Group, 15)
		fmt.Printf("%-12s %-15s %-25s %s\n", id, label, url, group)
	}
	return nil
}

// runWorkshopValidate 校验工坊站点配置
func runWorkshopValidate(ctx *CmdContext) error {
	count, err := ctx.App.ValidateWorkshopSites()
	if err != nil {
		return newRuntimeErrf("校验工坊站点失败: %w", err)
	}
	fmt.Printf("✅ 校验通过，共 %d 个站点\n", count)
	return nil
}
