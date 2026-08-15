package litematic

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"image"
	"image/png"
	"sort"

	"ysm-model-manager/go/types"
)

func ParseMeta(path string) (*types.LitematicMeta, error) {
	root, err := openGzRoot(path)
	if err != nil {
		return nil, err
	}

	meta := &types.LitematicMeta{}

	if v, ok := getInt(root, "Version"); ok {
		meta.Version = v
	}
	if v, ok := getInt(root, "MinecraftDataVersion"); ok {
		meta.MinecraftDataVersion = v
	}

	metadata := getCompound(root, "Metadata")
	if metadata == nil {
		return nil, fmt.Errorf("缺少 Metadata compound")
	}

	meta.Name, _ = getString(metadata, "Name")
	meta.Author, _ = getString(metadata, "Author")
	meta.Description, _ = getString(metadata, "Description")
	meta.TimeCreated, _ = getLong(metadata, "TimeCreated")
	meta.TimeModified, _ = getLong(metadata, "TimeModified")
	if v, ok := getInt(metadata, "TotalBlocks"); ok {
		meta.TotalBlocks = v
	}
	if v, ok := getInt(metadata, "TotalVolume"); ok {
		meta.TotalVolume = v
	}

	if encSize := getCompound(metadata, "EnclosingSize"); encSize != nil {
		var size [3]int
		if v, ok := getInt(encSize, "x"); ok {
			size[0] = v
		}
		if v, ok := getInt(encSize, "y"); ok {
			size[1] = v
		}
		if v, ok := getInt(encSize, "z"); ok {
			size[2] = v
		}
		meta.EnclosingSize = size
	}

	if previewData, ok := getByteArray(metadata, "PreviewImage"); ok && len(previewData) > 0 {
		meta.PreviewImage = convertPreviewImage(previewData)
	}

	regions := getCompound(root, "Regions")
	if regions != nil {
		meta.RegionCount = len(regions)
		meta.BlockStats = aggregateBlockStatsFromPalette(regions)
	}

	return meta, nil
}

// maxStatBlocks 大投影方块统计截断上限：与渲染路径 maxBlocks 截断口径一致，
// 防止超大投影（如 100³=1M+ 方块）逐块提取拖慢元数据解析；上限内抽样统计足够反映方块占比
const maxStatBlocks = 2_000_000

func aggregateBlockStatsFromPalette(regions map[string]any) []types.LitematicBlockStat {
	counts := make(map[string]int)
	scanned := 0

	for _, regionTag := range regions {
		region, ok := regionTag.(map[string]any)
		if !ok {
			continue
		}

		paletteList := getList(region, "BlockStatePalette")
		if paletteList == nil || len(paletteList) <= 1 {
			continue
		}

		paletteNames := make([]string, len(paletteList))
		for i, elem := range paletteList {
			if elemMap, ok := elem.(map[string]any); ok {
				if nameTag := getAny(elemMap, "Name"); nameTag != nil {
					if name, ok := nameTag.(string); ok {
						paletteNames[i] = name
					}
				}
			}
		}

		info, _ := buildRegionInfo(region)
		if info == nil {
			continue
		}

		totalBlocks := info.sizeX * info.sizeY * info.sizeZ
		if remain := maxStatBlocks - scanned; totalBlocks > remain {
			totalBlocks = remain
		}
		// bitOffset 累加代替 i*bpe 乘法；extractBits 内部已带越界守卫
		bitOffset := 0
		for i := 0; i < totalBlocks; i++ {
			paletteIdx := extractBits(info.longs, bitOffset, info.bpe)
			bitOffset += info.bpe
			if paletteIdx < 0 || paletteIdx >= len(paletteNames) || paletteIdx == 0 {
				continue
			}
			if name := paletteNames[paletteIdx]; name != "" {
				counts[name]++
			}
		}
		scanned += totalBlocks
		if scanned >= maxStatBlocks {
			break
		}
	}

	stats := make([]types.LitematicBlockStat, 0, len(counts))
	for name, count := range counts {
		cn := ResolveBlockZH(name)
		stats = append(stats, types.LitematicBlockStat{Name: cn, Count: count})
	}
	sort.Slice(stats, func(i, j int) bool {
		return stats[i].Count > stats[j].Count
	})
	return stats
}

func convertPreviewImage(data []byte) string {
	const size = 140
	expectedLen := size * size * 4
	if len(data) < expectedLen {
		return ""
	}

	rgba := make([]byte, expectedLen)
	for i := 0; i < size*size; i++ {
		a := data[i*4]
		r := data[i*4+1]
		g := data[i*4+2]
		b := data[i*4+3]
		rgba[i*4] = r
		rgba[i*4+1] = g
		rgba[i*4+2] = b
		rgba[i*4+3] = a
	}

	img := &image.RGBA{
		Pix:    rgba,
		Stride: size * 4,
		Rect:   image.Rect(0, 0, size, size),
	}

	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return ""
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(buf.Bytes())
}

func ParseSchematicSummary(path string) map[string]interface{} {
	root, err := openGzRoot(path)
	if err != nil {
		return nil
	}

	result := map[string]interface{}{}

	if v, ok := getInt(root, "Version"); ok {
		result["version"] = v
	}
	if v, ok := getInt(root, "DataVersion"); ok {
		result["dataVersion"] = v
	}

	w, wok := getInt(root, "Width")
	h, hok := getInt(root, "Height")
	l, lok := getInt(root, "Length")
	if wok && hok && lok {
		result["size"] = []int{w, h, l}
	}

	metaCompound := getCompound(root, "Metadata")
	if metaCompound != nil {
		if author, ok := getString(metaCompound, "Author"); ok {
			result["author"] = author
		}
		if name, ok := getString(metaCompound, "Name"); ok {
			result["name"] = name
		}
	}

	blocksBA, _ := getByteArray(root, "Blocks")
	if blocksBA != nil {
		result["blockCount"] = len(blocksBA)
	}

	paletteCompound := getCompound(root, "Palette")
	if paletteMax, ok := getInt(root, "PaletteMax"); ok {
		result["paletteMax"] = paletteMax
	}
	if paletteCompound != nil {
		result["paletteSize"] = len(paletteCompound)
	}

	if paletteCompound == nil && blocksBA != nil {
		dataBA, _ := getByteArray(root, "Data")
		idCounts := map[string]int{}
		for i, id := range blocksBA {
			if id == 0 {
				continue
			}
			var d byte
			if dataBA != nil && i < len(dataBA) {
				d = dataBA[i]
			}
			name := ResolveBlockName(int(id), d)
			if name == "" {
				if d != 0 {
					name = fmt.Sprintf("ID:%d:%d", id, d)
				} else {
					name = fmt.Sprintf("ID:%d", id)
				}
			} else {
				name = ResolveBlockZH(name)
			}
			idCounts[name]++
		}
		stats := make([]types.LitematicBlockStat, 0, len(idCounts))
		for name, count := range idCounts {
			stats = append(stats, types.LitematicBlockStat{Name: name, Count: count})
		}
		sort.Slice(stats, func(i, j int) bool { return stats[i].Count > stats[j].Count })
		result["paletteStats"] = stats
		if m, ok := getString(root, "Materials"); ok {
			result["materials"] = m
		}
	}

	tileEntities := getList(root, "TileEntities")
	if tileEntities != nil {
		result["tileEntityCount"] = len(tileEntities)
	}
	entities := getList(root, "Entities")
	if entities != nil {
		result["entityCount"] = len(entities)
	}

	if len(result) <= 1 {
		return nil
	}
	return result
}

func ParseNbtStructure(path string) map[string]interface{} {
	root, err := openGzRoot(path)
	if err != nil {
		return nil
	}

	// 基岩版 1.21+ structure 新格式（origin/sub_levels 多子结构）：根含 sub_levels 时走聚合分支
	if subLevels := getList(root, "sub_levels"); subLevels != nil {
		return parseBedrockStructure(root, subLevels)
	}

	sizeList := getList(root, "size")
	blocksList := getList(root, "blocks")
	paletteList := getList(root, "palette")
	entitiesList := getList(root, "entities")
	if sizeList == nil && blocksList == nil && paletteList == nil {
		return nil
	}

	result := map[string]interface{}{}
	if v, ok := getInt(root, "DataVersion"); ok {
		result["dataVersion"] = v
	}
	if sizeList != nil && len(sizeList) == 3 {
		sx, _ := sizeList[0].(int32)
		sy, _ := sizeList[1].(int32)
		sz, _ := sizeList[2].(int32)
		result["size"] = []int{int(sx), int(sy), int(sz)}
	}
	if blocksList != nil {
		result["blockCount"] = len(blocksList)
	}
	if entitiesList != nil {
		result["entityCount"] = len(entitiesList)
	}
	if paletteList != nil {
		counts := map[string]int{}
		for _, elem := range paletteList {
			if elemMap, ok := elem.(map[string]any); ok {
				nameTag := getAny(elemMap, "Name")
				if name, ok := nameTag.(string); ok && name != "" {
					cn := ResolveBlockZH(name)
					counts[cn]++
				}
			}
		}
		stats := make([]types.LitematicBlockStat, 0, len(counts))
		for name, count := range counts {
			stats = append(stats, types.LitematicBlockStat{Name: name, Count: count})
		}
		sort.Slice(stats, func(i, j int) bool { return stats[i].Count > stats[j].Count })
		if len(stats) > 0 {
			result["paletteStats"] = stats
		}
	}
	return result
}

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
		palette := getList(sub, "block_palette")
		paletteNames := make([]string, 0, len(palette))
		for _, elem := range palette {
			name := ""
			if em, ok := elem.(map[string]any); ok {
				name, _ = getString(em, "Name")
			}
			paletteNames = append(paletteNames, name)
		}
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
	if len(counts) > 0 {
		stats := make([]types.LitematicBlockStat, 0, len(counts))
		for name, count := range counts {
			stats = append(stats, types.LitematicBlockStat{Name: name, Count: count})
		}
		sort.Slice(stats, func(i, j int) bool { return stats[i].Count > stats[j].Count })
		result["paletteStats"] = stats
	}

	// 有效判定：size（local_bounds 推导）单独即视为有效（空结构文件也有尺寸）；
	// 否则仅 DataVersion 等元数据且无内容时返回 nil（对齐 Java 版 len(result)<=1 语义）
	if _, hasSize := result["size"]; !hasSize && len(result) <= 1 {
		return nil
	}
	return result
}
