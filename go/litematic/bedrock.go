package litematic

// parseBedrockStructure 解析基岩版 1.21+ structure（origin/sub_levels 多子结构）。
// 每个 sub_level 内嵌 blocks（local_pos+palette_id）、block_palette（Name/Properties）、
// local_bounds（min/max x/y/z）、entities、block_entities；跨子结构聚合全局包围盒、
// 方块总数与方块统计（按 blocks.palette_id 引用 block_palette.Name 计数，Count=真实方块数）。
func parseBedrockStructure(root map[string]any, subLevels []any) map[string]interface{} {
	result := map[string]interface{}{}
	if v, ok := getInt(root, "DataVersion"); ok {
		result["dataVersion"] = v
	}

	var minX, minY, minZ, maxX, maxY, maxZ int
	hasBounds := false
	blockCount := 0
	entityCount := 0
	tileEntityCount := 0
	counts := map[string]int{}

	for _, sl := range subLevels {
		sub, ok := sl.(map[string]any)
		if !ok {
			continue
		}
		// 子结构包围盒（local_bounds: min_x/min_y/min_z/max_x/max_y/max_z）
		if lb := getCompound(sub, "local_bounds"); lb != nil {
			bounds := []struct {
				key string
				val *int
				max bool
			}{
				{"min_x", &minX, false}, {"min_y", &minY, false}, {"min_z", &minZ, false},
				{"max_x", &maxX, true}, {"max_y", &maxY, true}, {"max_z", &maxZ, true},
			}
			for _, b := range bounds {
				if v, ok := getInt(lb, b.key); ok {
					if !hasBounds || (b.max && v > *b.val) || (!b.max && v < *b.val) {
						*b.val = v
					}
				}
			}
			hasBounds = true
		}
		// blocks + block_palette（palette_id → Name 引用计数）
		blocks := getList(sub, "blocks")
		if blocks != nil {
			blockCount += len(blocks)
		}
		paletteNames := extractPaletteNames(getList(sub, "block_palette"))
		for _, b := range blocks {
			bm, ok := b.(map[string]any)
			if !ok {
				continue
			}
			if pid, ok := getInt(bm, "palette_id"); ok && pid >= 0 && pid < len(paletteNames) {
				if name := paletteNames[pid]; name != "" {
					counts[ResolveBlockZH(name)]++
				}
			}
		}
		if ents := getList(sub, "entities"); ents != nil {
			entityCount += len(ents)
		}
		if bes := getList(sub, "block_entities"); bes != nil {
			tileEntityCount += len(bes)
		}
	}

	if hasBounds {
		result["size"] = []int{maxX - minX + 1, maxY - minY + 1, maxZ - minZ + 1}
	}
	if blockCount > 0 {
		result["blockCount"] = blockCount
	}
	if entityCount > 0 {
		result["entityCount"] = entityCount
	}
	if tileEntityCount > 0 {
		result["tileEntityCount"] = tileEntityCount
	}
	if stats := sortedStats(counts); len(stats) > 0 {
		result["paletteStats"] = stats
	}

	// 有效判定：size（local_bounds 推导）单独即视为有效（空结构文件也有尺寸）；
	// 否则仅 DataVersion 等元数据且无内容时返回 nil（对齐 Java 版 len(result)<=1 语义）
	if _, hasSize := result["size"]; !hasSize && len(result) <= 1 {
		return nil
	}
	return result
}
