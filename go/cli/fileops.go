package cli

import (
	"fmt"
)

func init() {
	RegisterCommandC("move", CatModel, "移动模型文件（源与目标须在同一仓库根内）", runMove)
	RegisterCommandC("copy", CatModel, "复制模型文件（源与目标须在同一仓库根内）", runCopy)
	RegisterCommandC("rename", CatModel, "重命名模型文件或目录", runRename)
	RegisterCommandC("toggle", CatModel, "切换模型启用/禁用状态（.ban）", runToggle)
}

// runMove 移动模型文件
func runMove(ctx *CmdContext) error {
	fs := newCmdFlagSet("move")
	src := fs.String("src", "", "源文件路径（必填）")
	dstDir := fs.String("dst", "", "目标目录路径（必填）")
	_, err := parseFlags(fs, ctx.Args)
	if err != nil {
		return err
	}
	if *src == "" {
		return newParamErrf("move: --src 参数不能为空")
	}
	if *dstDir == "" {
		return newParamErrf("move: --dst 参数不能为空")
	}

	if err := ctx.App.MoveModelFile(*src, *dstDir); err != nil {
		return newRuntimeErrf("移动失败: %w", err)
	}
	fmt.Printf("✅ 已移动: %s -> %s\n", *src, *dstDir)
	return nil
}

// runCopy 复制模型文件
func runCopy(ctx *CmdContext) error {
	fs := newCmdFlagSet("copy")
	src := fs.String("src", "", "源文件路径（必填）")
	dstDir := fs.String("dst", "", "目标目录路径（必填）")
	_, err := parseFlags(fs, ctx.Args)
	if err != nil {
		return err
	}
	if *src == "" {
		return newParamErrf("copy: --src 参数不能为空")
	}
	if *dstDir == "" {
		return newParamErrf("copy: --dst 参数不能为空")
	}

	if err := ctx.App.CopyModelFile(*src, *dstDir); err != nil {
		return newRuntimeErrf("复制失败: %w", err)
	}
	fmt.Printf("✅ 已复制: %s -> %s\n", *src, *dstDir)
	return nil
}

// runRename 重命名模型文件或目录
func runRename(ctx *CmdContext) error {
	fs := newCmdFlagSet("rename")
	path := fs.String("path", "", "要重命名的文件或目录路径（必填）")
	newName := fs.String("name", "", "新名称（必填）")
	_, err := parseFlags(fs, ctx.Args)
	if err != nil {
		return err
	}
	if *path == "" {
		return newParamErrf("rename: --path 参数不能为空")
	}
	if *newName == "" {
		return newParamErrf("rename: --name 参数不能为空")
	}

	// 优先尝试 RenameDir（目录重命名），失败再尝试 RenameFile（文件重命名）。
	// 保留 RenameDir 的错误：两者都失败时合并错误信息，避免丢失根因。
	dirErr := ctx.App.RenameDir(*path, *newName)
	if dirErr == nil {
		fmt.Printf("✅ 已重命名目录: %s -> %s\n", *path, *newName)
		return nil
	}
	if err := ctx.App.RenameFile(*path, *newName); err != nil {
		return newRuntimeErrf("重命名失败（目录: %v / 文件: %v）", dirErr, err)
	}
	fmt.Printf("✅ 已重命名文件: %s -> %s\n", *path, *newName)
	return nil
}

// runToggle 切换模型启用/禁用状态
func runToggle(ctx *CmdContext) error {
	fs := newCmdFlagSet("toggle")
	path := fs.String("path", "", "模型文件路径（必填）")
	_, err := parseFlags(fs, ctx.Args)
	if err != nil {
		return err
	}
	if *path == "" {
		return newParamErrf("toggle: --path 参数不能为空")
	}

	enabled, err := ctx.App.ToggleModelEnable(*path)
	if err != nil {
		return newRuntimeErrf("切换状态失败: %w", err)
	}
	if enabled {
		fmt.Printf("✅ 已启用: %s\n", *path)
	} else {
		fmt.Printf("🚫 已禁用: %s\n", *path)
	}
	return nil
}
