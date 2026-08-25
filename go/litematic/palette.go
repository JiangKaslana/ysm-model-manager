package litematic

// palette 提取与映射的公共 helper。
// 原 buildRegionInfo / BuildNbtVoxelData / buildBedrockVoxelData 三处各写一遍
// 「逐条目取 Name → MapColor → 缺失兜底」，且兜底色不一致（#000000 vs #7F7F7F）；
// 统一收敛到本文件，三格式共用同一套口径。

// unknownBlockColor palette 条目 Name 缺失/非字符串（畸形输入）时的统一兜底渲染色。
// 取多数派约定 #7F7F7F（与未知方块 stone 的映射色同值），原 litematic 分支的
// #000000 已并入——行为变化仅影响畸形输入的渲染色，无测试断言黑。
const unknownBlockColor = "#7F7F7F"

// extractPaletteNames 提取 palette 列表各条目的 Name。
// 元素非 compound 或 Name 缺失/非字符串时兜底空串（调用方按需处理空气标记与计数跳过）。
func extractPaletteNames(list []any) []string {
	names := make([]string, len(list))
	for i, elem := range list {
		if em, ok := elem.(map[string]any); ok {
			name, _ := getString(em, "Name")
			names[i] = name
		}
	}
	return names
}

// paletteColorsFromNames 将 palette 名单映射为渲染色名单（MapColor 查表）。
// 空 Name（畸形条目）兜底 unknownBlockColor；air 系经 MapColor 返回 ""，
// 仍是下游「空颜色 = 空气」的判定口径，不受兜底影响。
func paletteColorsFromNames(names []string) []string {
	colors := make([]string, len(names))
	for i, n := range names {
		if n == "" {
			colors[i] = unknownBlockColor
		} else {
			colors[i] = MapColor(n)
		}
	}
	return colors
}
