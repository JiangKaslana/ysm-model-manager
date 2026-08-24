// ===== 从压缩包中提取并解析 Bedrock Geometry =====
// 支持 ZIP（YSM 标准格式）和 7z 格式。容器打开统一走 go/container（ADR-068）。
package geometry

import (
	"encoding/base64"
	"encoding/json"
	"log"
	"path/filepath"
	"sort"
	"strings"

	"ysm-model-manager/go/container"
	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/types"
)

// maxExtractSize 单个文件最大读取大小（ZIP/7z 内文件），防止 ZIP 炸弹
// 共享 types.MaxReadLimit（索引 6.7+5.2，与 fileops/ysm 的 50MB 上限单点）
const maxExtractSize = types.MaxReadLimit

// isArmModelName 判断模型文件是否为第一人称手臂模型（arm.json / arm.geo.json）。
// 该类文件是游戏第一人称视角的手臂几何，与 main.json 的手臂重叠，
// 合并会渲染出两对手臂，加载时须排除。
func isArmModelName(name string) bool {
	base := strings.ToLower(name)
	if idx := strings.LastIndexAny(base, "/\\"); idx >= 0 {
		base = base[idx+1:]
	}
	base = strings.TrimSuffix(base, ".json")
	return base == "arm" || base == "arm.geo"
}

// filterArmModels 移除模型顺序表中的第一人称手臂模型占位：
// 避免 arm.json 占据 texIdx 槽位导致 main 纹理错位。
func filterArmModels(order []string) []string {
	out := make([]string, 0, len(order))
	for _, p := range order {
		if !isArmModelName(p) {
			out = append(out, p)
		}
	}
	return out
}

// extractFirstPNG 从容器读取器中找第一张 .png（ZIP/7z 共用）。
func extractFirstPNG(r container.Reader) []byte {
	for _, e := range r.Entries() {
		if strings.HasSuffix(strings.ToLower(e.Name()), ".png") && !e.IsDir() {
			rc, err := e.Open()
			if err != nil {
				continue
			}
			buf := fsutil.ReadLimitedEntry(rc, int64(maxExtractSize))
			if len(buf) > 0 {
				return buf
			}
		}
	}
	return nil
}

// ExtractFirstPNGFromZip 从 ZIP 中提取第一张 PNG 图片（用于快速预览）
func ExtractFirstPNGFromZip(data []byte, size int64) []byte {
	r, err := container.OpenZipBytes(data, size)
	if err != nil {
		return nil
	}
	defer r.Close()
	return extractFirstPNG(r)
}

// ExtractFirstPNGFrom7z 从 7z 中提取第一张 PNG 图片（用于快速预览）
func ExtractFirstPNGFrom7z(data []byte, size int64) []byte {
	r, err := container.Open7zBytes(data, size)
	if err != nil {
		return nil
	}
	defer r.Close()
	return extractFirstPNG(r)
}

type geoEntry struct {
	name string
	data []byte
}

// classifyFileInventory 识别 zip 内所有文件的归属（parseGlobalResources 轻量版：
// 只识别不解析，Go 端承担文件识别能力，前端消费准确归属清单，不再事后按文件名猜）。
// 纯新增能力，不改变既有收集（animJSONs/pngs 等数组内容不动，零 fallback 干扰）。
func classifyFileInventory(entries []container.Entry) *types.FileInventory {
	inv := &types.FileInventory{}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		low := strings.ToLower(e.Name())
		switch {
		case strings.HasSuffix(low, ".animation_controller.json"):
			inv.Controllers = append(inv.Controllers, e.Name())
		case strings.HasSuffix(low, ".animation.json"):
			inv.Animations = append(inv.Animations, e.Name())
		case strings.HasSuffix(low, ".lang"):
			inv.LangFiles = append(inv.LangFiles, e.Name())
		case strings.HasSuffix(low, ".inc"):
			inv.IncFiles = append(inv.IncFiles, e.Name())
		case (strings.HasSuffix(low, ".png") || strings.HasSuffix(low, ".jpg")) && strings.Contains(low, "avatar/"):
			inv.Avatars = append(inv.Avatars, e.Name())
		case strings.HasSuffix(low, ".json") && !strings.Contains(low, "ysm.json") && isLegacyGeometryName(low):
			inv.LegacyModels = append(inv.LegacyModels, e.Name())
		}
	}
	return inv
}

// legacyGeometryNames 旧格式几何文件基名（无 ysm.json 场景）。含 .geo 变体：
// 与 IsMainModelName/isArmModelName 同口径（code review P3：main.geo.json 等
// 会被当 geometry 解析但此前漏分类）；package-level 避免 per-entry 重建分配（P3）。
var legacyGeometryNames = []string{"main", "main.geo", "arm", "arm.geo", "arrow", "info"}

// isLegacyGeometryName 旧格式几何文件名约定（Modern YSM parseLegacyFormat 同口径：
// 无 ysm.json 的包以 main/arm/arrow/info 等固定名作为模型声明）
func isLegacyGeometryName(lowPath string) bool {
	// zip 内路径恒为正斜杠，不能用 filepath.Base（Windows 按 \ 分割会失效）
	if i := strings.LastIndexByte(lowPath, '/'); i >= 0 {
		lowPath = lowPath[i+1:]
	}
	base := strings.TrimSuffix(lowPath, ".json")
	for _, n := range legacyGeometryNames {
		if base == n {
			return true
		}
	}
	return false
}

// parseLegacyMetadata 旧格式 info.json 元数据（无 ysm.json 场景；Modern YSM
// parseLegacyMetadata 同口径——name/tips/license(字符串)/authors(字符串数组)）。
// 缺失/畸形返回 nil（容错，不阻断解析）；license 字符串映射为 License{Type}。
func parseLegacyMetadata(entries []container.Entry) *types.YsmMetadata {
	for _, e := range entries {
		// 只匹配根级 info.json（旧格式约定单个根文件）：嵌套/无关 *info.json
		// （textures/skin_info.json、assets/<ns>/info.json 等）不参与（code review P2）
		if e.IsDir() || !strings.EqualFold(e.Name(), "info.json") {
			continue
		}
		rc, err := e.Open()
		if err != nil {
			continue
		}
		buf := fsutil.ReadLimitedEntry(rc, maxExtractSize)
		if len(buf) == 0 {
			continue
		}
		var info struct {
			Name    string   `json:"name"`
			Tips    string   `json:"tips"`
			License string   `json:"license"`
			Authors []string `json:"authors"`
		}
		if err := json.Unmarshal(buf, &info); err != nil {
			continue
		}
		m := &types.YsmMetadata{Name: info.Name, Tips: info.Tips}
		if info.License != "" {
			m.License = &types.YsmLicense{Type: info.License}
		}
		for _, a := range info.Authors {
			if a != "" {
				m.Authors = append(m.Authors, types.YsmAuthor{Name: a})
			}
		}
		if m.Name != "" || m.Tips != "" || m.License != nil || len(m.Authors) > 0 {
			return m
		}
		// 空占位（{}）不 return——继续找后续候选（code review P2：一个空 info.json
		// 不得抑制同 archive 中其他有效候选；根级仅一个时最终落到循环末 return nil）
	}
	return nil
}

// projEntry 收集投射物/载具模型路径 + 声明的纹理名，
// texIdxMap 构建时用 texName 查 texOrder 位置分配 texSlot。
// section 为来源段名（"projectile"/"vehicle"/"arrow"），供 TextureCategories 分类。
type projEntry struct {
	model   string
	texName string // 声明的纹理名（小写 basename 去扩展名）
	section string // 来源段名
}

// collectArchiveFiles 从压缩包收集 ysm.json 映射/模型文件/纹理（合并版与组件版共用）。
// 与 ParseFromZip 原内联逻辑等价，但 geoFiles **不排除 arm**（arm 过滤由合并版调用方
// filterArmModels 做；组件版需要 arm 作为独立组件）。entries 现为 container.Entry（ADR-068）。
// 新增返回值 modelTexName：模型路径(ToSlash)→声明纹理名(小写basename去扩)，用于组件版
// 按 basename 直接查表，避免 texOrder 去重后索引漂移。
func collectArchiveFiles(entries []container.Entry) (modelOrder, texOrder []string, geoFiles []geoEntry, pngs [][]byte, pngNames, animJSONs []string, modelTexName map[string]string) {
	// ysm.json 统一解析（结构解码共享；口径后处理留在本函数，清单版：player.texture 去扩展名）
	md := parseYsmArchive(entries, "[geometry]")

	// texOrder：player.texture 先、projectiles/vehicles/arrow 后。
	// uv 对象剥反斜杠、裸字符串不剥（复刻原内联不对称）；先小写再去 .png/.jpg 扩展名。
	for _, t := range md.PlayerTexs {
		tn := t.path
		if idx := strings.LastIndex(tn, "/"); idx >= 0 {
			tn = tn[idx+1:]
		}
		if t.isUV {
			if idx := strings.LastIndex(tn, "\\"); idx >= 0 {
				tn = tn[idx+1:]
			}
		}
		tn = strings.TrimSuffix(strings.TrimSuffix(strings.ToLower(tn), ".png"), ".jpg")
		texOrder = append(texOrder, tn)
	}
	for _, pm := range md.ProjModels {
		if pm.texName == "" {
			continue
		}
		tn := texBasenameNoExt(pm.texName)
		// 去重：vehicles 段 horse+mule 都指向 foxcar.png，
		// 重复追加会导致后续纹理 texSlot 偏移（minecart 采样到 boat.png）
		alreadyIn := false
		for _, ex := range texOrder {
			if ex == tn {
				alreadyIn = true
				break
			}
		}
		if !alreadyIn {
			texOrder = append(texOrder, tn)
		}
	}

	// modelOrder：player 模型先、投射物模型后（与 texOrder 同序，texIdxMap 位置绑定不错位）
	modelOrder = append(modelOrder, md.ModelOrder...)
	for _, pm := range md.ProjModels {
		if pm.model != "" {
			modelOrder = append(modelOrder, pm.model)
		}
	}

	// maid-model 命名空间检测（与 parseModelFromEntries 同口径）
	var maidNs string
	for _, e := range entries {
		low := strings.ToLower(e.Name())
		if strings.HasSuffix(low, "/maid_model.json") {
			parts := strings.Split(low, "/")
			if len(parts) >= 3 {
				maidNs = strings.Join(parts[:len(parts)-1], "/") + "/"
			}
			break
		}
	}

	for _, e := range entries {
		low := strings.ToLower(e.Name())
		if strings.HasSuffix(low, ".json") && !e.IsDir() {
			if strings.Contains(low, "ysm.json") {
				continue
			}
			// maid-model 命名空间过滤：只处理首个 namespace 的 entity JSON
			if maidNs != "" {
				if !strings.HasPrefix(low, maidNs) || strings.HasSuffix(low, "maid_model.json") || strings.HasSuffix(low, "maid_chair.json") || strings.HasSuffix(low, "maid_sound.json") {
					continue
				}
			}
			if strings.Contains(low, "animation") || strings.Contains(low, "controller") {
				rc, err := e.Open()
				if err != nil {
					continue
				}
				// 原 io.ReadAll(io.LimitReader(rc, maxExtractSize))
				// 无 +1 探测、丢弃错误——恰 50MB 的动画 JSON 被截断后静默下发（ADR-033
				// 陷阱在动画路径存活，与文件头注释 24-28 行声称已修复矛盾）；改走
				// fsutil.ReadLimitedEntry（+1 探测，超限返回 nil）
				// ReadLimitedEntry 内部已 Close，删调用侧多余 rc.Close()
				buf := fsutil.ReadLimitedEntry(rc, maxExtractSize)
				if len(buf) > 10 {
					animJSONs = append(animJSONs, string(buf))
				}
				continue
			}
			rc, err := e.Open()
			if err != nil {
				continue
			}
			buf := fsutil.ReadLimitedEntry(rc, int64(maxExtractSize))
			// 注意：不排除 arm（组件版需要；合并版由调用方 filterArmModels 过滤）
			geoFiles = append(geoFiles, geoEntry{name: e.Name(), data: buf})
		}
		if (strings.HasSuffix(low, ".png") || strings.HasSuffix(low, ".jpg")) && !e.IsDir() && !strings.Contains(low, "avatar/") {
			// maid-model 命名空间过滤：只收集首个 namespace 的纹理
			if maidNs != "" && !strings.HasPrefix(low, maidNs) {
				continue
			}
			rc, err := e.Open()
			if err != nil {
				continue
			}
			pngData := fsutil.ReadLimitedEntry(rc, int64(maxExtractSize))
			// 与 .ysm 解压路径口径对齐：不按尺寸过滤小纹理（64×64 合法贴图可 <4KB），
			// 头像/预览图仅由 avatar/ 路径与基名前缀排除
			if len(pngData) > 0 {
				name := e.Name()
				if idx := strings.LastIndex(name, "/"); idx >= 0 {
					name = name[idx+1:]
				}
				if idx := strings.LastIndex(name, "\\"); idx >= 0 {
					name = name[idx+1:]
				}
				name = strings.TrimSuffix(name, ".png")
				name = strings.TrimSuffix(name, ".jpg")
				pngNames = append(pngNames, name)
				pngs = append(pngs, pngData)
			}
		}
	}
	return modelOrder, texOrder, geoFiles, pngs, pngNames, animJSONs, md.ModelTexName
}

// parseModelFromEntries 共享主体：ysm.json 解析 + model/texture 顺序 + geo/png/anim 收集，
// 构建 BedrockModel。logTag 用于日志前缀（"zip" / "7z"）。
//
// 清单分层（L0 权威 → L1 兜底）：
//
//	L0：maid_model.json model[] / model_list[] 数组（TLM 自有结构）
//	    —— 条目支持两种形式：
//	     (a) 完整路径：{name, model, texture} （直接指向 zip 内相对路径）
//	     (b) model_id：{name, model_id} （从 model_id 去命名空间前缀 + 候选路径字典推断 zip 路径）
//	L1：遍历 zip 内 .json 枚举 + 文件名排序（无 L0 或 L0 非法时启用）
//
// 多命名空间处理：zip 内可能存在多个 maid_model.json（如 credits_authors 致谢清单 + 主包清单），
// 选 model/model_list 条目数最长者作为主命名空间（"最长清单即主包" 启发式）。
//
// L0 生效时：geoFiles / pngs / modelOrder / texOrder 全部从清单派生，多余的文件
// （如 junk_geo.json、外来命名空间内容）一律丢弃，避免顺序/纹理绑定被污染。
// maidManifestItem 对应 L0 maid_model.json model[] / model_list[] 的单条
// 支持两种描述形式，两个字段组合使用：
//   - 形式 A（完整路径，老/自定义包）：Model + Texture 直接给出相对路径
//   - 形式 B（model_id，TLM 原生）：ModelID = "namespace:name" → 通过路径字典推断
type maidManifestItem struct {
	Name    string `json:"name"`
	Model   string `json:"model"`    // 相对命名空间根的路径（形式 A）
	Texture string `json:"texture"`  // 相对路径（形式 A）
	ModelID string `json:"model_id"` // TLM 标准："namespace:name"（形式 B）
}

// collectMaidManifest 遍历所有 maid_model.json，选"清单最长者"为真正的命名空间。
// 从 parseModelFromEntries 的 L0 清单收集子域收编（只搬逻辑、不改行为），
// 返回命名空间前缀（含尾部 /）与清单；无 maid_model.json 时 maidNs 为空、manifest 为 nil。
func collectMaidManifest(entries []container.Entry, logPrefix string) (string, []maidManifestItem) {
	// ===== 1. 遍历所有 maid_model.json，选"清单最长者"为真正的命名空间 =====
	type maidNsCandidate struct {
		ns       string
		manifest []maidManifestItem
		count    int
	}
	var candidates []maidNsCandidate

	for _, e := range entries {
		low := strings.ToLower(e.Name())
		if strings.HasSuffix(low, "/maid_model.json") {
			parts := strings.Split(low, "/")
			if len(parts) < 3 {
				continue
			}
			ns := strings.Join(parts[:len(parts)-1], "/") + "/"
			rc, err := e.Open()
			if err != nil {
				continue
			}
			buf := fsutil.ReadLimitedEntry(rc, int64(maxExtractSize))
			// 解析层级：顶层 / pack / chair / decor 四处都可能含 model/model_list，
			// 分别收集、各自算条目数，取总和最大的那个作为此命名空间的清单来源。
			//   TLM 真实格式：{pack_name, pack:{model_list:[...]}, chair:{model_list:[...]}}
			//   自定义简化格式：{model:[...]} 或 {model_list:[...]}
			type groupWrapper struct {
				Model     []maidManifestItem `json:"model"`
				ModelList []maidManifestItem `json:"model_list"`
			}
			var raw struct {
				Model     []maidManifestItem `json:"model"`
				ModelList []maidManifestItem `json:"model_list"`
				Pack      groupWrapper       `json:"pack"`
				Chair     groupWrapper       `json:"chair"`
				Decor     groupWrapper       `json:"decor"`
			}
			if json.Unmarshal(buf, &raw) != nil {
				continue
			}
			pick := func(g groupWrapper) []maidManifestItem {
				if len(g.Model) >= len(g.ModelList) {
					return g.Model
				}
				return g.ModelList
			}
			groups := [][]maidManifestItem{
				pick(groupWrapper{Model: raw.Model, ModelList: raw.ModelList}),
				pick(raw.Pack),
				pick(raw.Chair),
				pick(raw.Decor),
			}
			bestGroup := groups[0]
			for _, g := range groups[1:] {
				if len(g) > len(bestGroup) {
					bestGroup = g
				}
			}
			candidates = append(candidates, maidNsCandidate{
				ns:       ns,
				manifest: bestGroup,
				count:    len(bestGroup),
			})
		}
	}

	var maidNs string
	var maidManifest []maidManifestItem // 非 nil 且 len>0 表示 L0 生效
	if len(candidates) > 0 {
		// 启发式：条目数最长者 = 主包清单
		best := candidates[0]
		for _, c := range candidates[1:] {
			if c.count > best.count {
				best = c
			}
		}
		maidNs = best.ns
		maidManifest = best.manifest
		log.Printf("%s maid-model 命名空间: %s（L0 清单 %d 条 / 候选共 %d 个）",
			logPrefix, maidNs, len(maidManifest), len(candidates))
	}
	return maidNs, maidManifest
}

func parseModelFromEntries(entries []container.Entry, logTag string) (*types.BedrockModel, [][]byte, []string, []geoEntry) {
	logPrefix := "[geometry]"
	if logTag != "zip" {
		logPrefix = logPrefix + " " + logTag
	}

	// maidNs / maidManifest：L0 清单收集（命名空间选择 + 清单提取）已收编 collectMaidManifest
	maidNs, maidManifest := collectMaidManifest(entries, logPrefix)
	// manifest 下标 → 实际解析到的 zip 路径 / 纹理名（L0 过滤循环填充、SubModels 构建消费，
	// 两处不在同一 if 作用域，声明提到函数级）
	resolvedPathByItem := make(map[int]string)
	texNameByItem := make(map[int]string)
	var geo *types.BedrockModel
	var pngs [][]byte
	var pngNames []string
	var animJSONs []string
	var ysmMeta types.YsmMetadata // ysm.json metadata 段（return 前挂到 geo）

	// ysm.json 统一解析（结构解码共享；口径后处理留在本函数）。metadata 段单独容错：
	// 失败仅忽略（保持零值不挂载），核心解析不受影响。
	md := parseYsmArchive(entries, logPrefix)
	if len(md.Metadata) > 0 {
		if err := json.Unmarshal(md.Metadata, &ysmMeta); err != nil {
			log.Printf("%s metadata 段解析失败（忽略）: %v", logPrefix, err)
			ysmMeta = types.YsmMetadata{} // 失败即清零：Go json 部分填充会残留非 nil 指针（如 License），防误挂载
		}
	}

	var modelOrder []string
	var texOrder []string
	var texCategories []string
	// modelTexName: 模型路径 → 声明的纹理名（小写 basename 去扩展名）。
	// texIdxMap 构建时用它查 texOrder 位置分配 texSlot，而非按 modelOrder 序号
	// 截断——避免 plane.json（共用 texture.png）被截断到 arrow.png 槽位。
	projModels := make([]projEntry, 0, len(md.ProjModels))

	// texOrder：player.texture 先、projectiles/vehicles/arrow 后（模型版口径：保留扩展名）。
	// uv 对象剥反斜杠、裸字符串不剥（复刻原内联不对称）；仅小写，不去扩展名。
	for _, t := range md.PlayerTexs {
		tn := t.path
		if idx := strings.LastIndex(tn, "/"); idx >= 0 {
			tn = tn[idx+1:]
		}
		if t.isUV {
			if idx := strings.LastIndex(tn, "\\"); idx >= 0 {
				tn = tn[idx+1:]
			}
		}
		texOrder = append(texOrder, strings.ToLower(tn))
		texCategories = append(texCategories, "player")
	}
	for _, pm := range md.ProjModels {
		if pm.texName != "" {
			tn := texBasenameNoExt(pm.texName)
			// 去重：vehicles 段 horse+mule 都指向 foxcar.png，
			// 重复追加会导致后续纹理 texSlot 偏移（minecart 采样到 boat.png）
			alreadyIn := false
			for _, ex := range texOrder {
				if ex == tn {
					alreadyIn = true
					break
				}
			}
			if !alreadyIn {
				texOrder = append(texOrder, tn)
				cat := pm.section
				if cat == "" {
					cat = "projectile"
				}
				texCategories = append(texCategories, cat)
			}
		}
		if pm.model != "" {
			projModels = append(projModels, pm)
		}
	}

	// modelOrder：player 模型先、投射物模型后（与 texOrder 同序，texIdxMap 位置绑定不错位）
	modelOrder = append(modelOrder, md.ModelOrder...)
	for _, pm := range projModels {
		modelOrder = append(modelOrder, pm.model)
	}

	var geoFiles []geoEntry

	for _, e := range entries {
		low := strings.ToLower(e.Name())
		if strings.HasSuffix(low, ".json") && !e.IsDir() {
			if strings.Contains(low, "ysm.json") {
				continue
			}
			// maid-model 命名空间过滤：置于 Open 之前 + 动画分支之前（与 collectArchiveFiles
			// 同口径）——被拒条目不 Open（无 reader 泄漏，发现2）+ 外来命名空间的动画/控制器
			// JSON 一并跳过（发现5，两条路径不再漂移）
			if maidNs != "" {
				if !strings.HasPrefix(low, maidNs) || strings.HasSuffix(low, "maid_model.json") || strings.HasSuffix(low, "maid_chair.json") || strings.HasSuffix(low, "maid_sound.json") {
					continue
				}
			}
			if strings.Contains(low, "animation") || strings.Contains(low, "controller") {
				rc, err := e.Open()
				if err != nil {
					continue
				}
				// 原 io.ReadAll(io.LimitReader(rc, maxExtractSize))
				// 无 +1 探测、丢弃错误——恰 50MB 的动画 JSON 被截断后静默下发（ADR-033
				// 陷阱在动画路径存活，与文件头注释 24-28 行声称已修复矛盾）；改走
				// fsutil.ReadLimitedEntry（+1 探测，超限返回 nil）
				// ReadLimitedEntry 内部已 Close，删调用侧多余 rc.Close()
				buf := fsutil.ReadLimitedEntry(rc, maxExtractSize)
				if len(buf) > 10 {
					animJSONs = append(animJSONs, string(buf))
				}
				continue
			}
			rc, err := e.Open()
			if err != nil {
				continue
			}
			buf := fsutil.ReadLimitedEntry(rc, int64(maxExtractSize))
			if isArmModelName(e.Name()) {
				continue // 排除第一人称手臂模型 arm.json（与 main 手臂重叠 → 双手臂）
			}
			geoFiles = append(geoFiles, geoEntry{name: e.Name(), data: buf})
		}
		if (strings.HasSuffix(low, ".png") || strings.HasSuffix(low, ".jpg")) && !e.IsDir() && !strings.Contains(low, "avatar/") {
			// maid-model 命名空间过滤：只收集首个 namespace 的纹理
			if maidNs != "" && !strings.HasPrefix(low, maidNs) {
				continue
			}
			rc, err := e.Open()
			if err != nil {
				continue
			}
			pngData := fsutil.ReadLimitedEntry(rc, int64(maxExtractSize))
			// 与 .ysm 解压路径口径对齐：不按尺寸过滤小纹理（64×64 合法贴图可 <4KB），
			// 头像/预览图仅由 avatar/ 路径与基名前缀排除
			if len(pngData) > 0 {
				name := e.Name()
				if idx := strings.LastIndex(name, "/"); idx >= 0 {
					name = name[idx+1:]
				}
				if idx := strings.LastIndex(name, "\\"); idx >= 0 {
					name = name[idx+1:]
				}
				name = strings.TrimSuffix(name, ".png")
				name = strings.TrimSuffix(name, ".jpg")
				pngNames = append(pngNames, name)
				pngs = append(pngs, pngData)
			}
		}
	}

	// ===== 1.5 L0 清单过滤：L0 生效时 geoFiles/pngs/modelOrder/texOrder 全部派生自清单 =====
	// 支持两种条目形式：
	//   形式 A（显式路径）：item.Model / item.Texture 直接填相对路径（老/自定义包）
	//   形式 B（model_id 推断）：item.ModelID = "namespace:name"
	//       → 从 model_id 取后缀 name，再用候选路径字典（models/entity/*.json、models/item/*、
	//         textures/entity/*.png 等）逐个试；试不中时退到 basename 模糊匹配
	//
	// 拆分为 resolveL0Model / resolveL0Texture 两个纯函数（2026-08-23）：
	// 原实现用 goto 把模型解析与纹理解析绞在同一个 for 循环里，改一处牵全身。
	// 现各自返回 zip 内绝对路径（空=未命中），主循环只负责读取 entry 数据并写入 l0* 列表。
	if len(maidManifest) > 0 {
		// --- 快速索引 1：全量条目按绝对 zip 路径索引 ---
		entryByPath := make(map[string]container.Entry, len(entries))
		for _, e := range entries {
			entryByPath[strings.ToLower(e.Name())] = e
		}
		// --- 快速索引 2：目标命名空间内的 JSON/PNG basename→[]entry 模糊匹配池 ---
		type namedEntry struct {
			path string
			e    container.Entry
		}
		var nsGeoBasenames map[string][]namedEntry
		var nsPngBasenames map[string][]namedEntry
		lazyBuildBasenameIdx := func() {
			if nsGeoBasenames != nil {
				return
			}
			nsGeoBasenames = map[string][]namedEntry{}
			nsPngBasenames = map[string][]namedEntry{}
			for _, e := range entries {
				low := strings.ToLower(e.Name())
				if !strings.HasPrefix(low, maidNs) {
					continue
				}
				rel := low[len(maidNs):]
				if strings.HasSuffix(low, ".json") {
					if strings.Contains(rel, "ysm.json") ||
						strings.HasSuffix(rel, "maid_model.json") ||
						strings.HasSuffix(rel, "maid_chair.json") ||
						strings.HasSuffix(rel, "maid_sound.json") ||
						strings.Contains(rel, "animation") ||
						strings.Contains(rel, "controller") {
						continue
					}
					base := filepath.Base(rel)
					base = strings.TrimSuffix(base, ".geo.json")
					base = strings.TrimSuffix(base, ".json")
					nsGeoBasenames[base] = append(nsGeoBasenames[base], namedEntry{path: low, e: e})
				} else if strings.HasSuffix(low, ".png") || strings.HasSuffix(low, ".jpg") {
					base := strings.TrimSuffix(filepath.Base(rel), filepath.Ext(filepath.Base(rel)))
					nsPngBasenames[base] = append(nsPngBasenames[base], namedEntry{path: low, e: e})
				}
			}
		}

		// model_id 路径候选字典：按"常见度"排序，找到第一个存在的即停
		modelCandidates := []string{
			"models/entity/<N>.json",
			"models/main/<N>.json",
			"models/<N>.json",
			"models/entity/<N>.geo.json",
			"geckolib/models/entity/<N>.json",
			"models/block/<N>.json",
			"<N>.json",
		}
		textureCandidates := []string{
			"textures/entity/<N>.png",
			"textures/main/<N>.png",
			"textures/<N>.png",
			"geckolib/textures/entity/<N>.png",
			"textures/entity/<N>.jpg",
		}

		// tryCandidates：从候选模板里找第一个存在的 zip entry
		tryCandidates := func(baseName string, templates []string) (container.Entry, string, bool) {
			for _, t := range templates {
				rel := strings.ReplaceAll(t, "<N>", baseName)
				abs := strings.ToLower(maidNs + strings.TrimPrefix(rel, "/"))
				if e, ok := entryByPath[abs]; ok {
					return e, abs, true
				}
			}
			return nil, "", false
		}
		// extractName：从 model_id "ns:name" 取 name 部分；空则返回 fallback
		extractName := func(modelID, fallback string) string {
			if modelID == "" {
				return fallback
			}
			if idx := strings.Index(modelID, ":"); idx >= 0 {
				return modelID[idx+1:]
			}
			return modelID
		}
		// stripNsPrefix：若 value 形如 "nsBase:path"，去掉 nsBase: 前缀后返回 path
		// （droneeee 一类的混合写法："model": "droneeee:models/entity/x.json"）
		stripNsPrefix := func(value, nsBase string) string {
			if nsBase == "" || value == "" {
				return value
			}
			if idx := strings.Index(value, ":"); idx >= 0 {
				if value[:idx] == nsBase && !filepath.IsAbs(value[idx+1:]) {
					return value[idx+1:]
				}
			}
			return value
		}

		// resolveL0Model：解析 L0 条目的模型路径，返回 zip 内绝对路径（空=未命中）
		// 优先级：形式 A 显式路径 → model_id 候选字典 → basename 模糊回扫
		resolveL0Model := func(item maidManifestItem, nsBase string) (absPath string) {
			modelRel := stripNsPrefix(item.Model, nsBase)
			if modelRel != "" {
				modelAbs := strings.ToLower(maidNs + strings.TrimPrefix(filepath.ToSlash(modelRel), "/"))
				if _, ok := entryByPath[modelAbs]; ok {
					log.Printf("%s L0 形式A 模型: %s → %s", logPrefix, item.Model, modelAbs)
					return modelAbs
				}
			}
			// model_id 推断（含 ":" 但前缀非 nsBase 的情况）
			mid := item.ModelID
			if mid == "" && strings.Contains(item.Model, ":") && !filepath.IsAbs(item.Model) {
				mid = item.Model
			}
			if mid != "" {
				namePart := extractName(mid, "")
				if namePart != "" {
					if _, abs, hit := tryCandidates(namePart, modelCandidates); hit {
						log.Printf("%s L0 形式B 模型(候选): %s → %s", logPrefix, mid, abs)
						return abs
					}
					lazyBuildBasenameIdx()
					if match, ok := nsGeoBasenames[namePart]; ok && len(match) > 0 {
						log.Printf("%s L0 形式B 模型(basename回扫): %s → %s", logPrefix, mid, match[0].path)
						return match[0].path
					}
					log.Printf("%s L0 模型未命中: %s", logPrefix, mid)
				}
			}
			return ""
		}

		// resolveL0Texture：解析 L0 条目的纹理路径，返回 zip 内绝对路径（空=未命中）
		// 优先级：形式 A 显式路径 → model_id 候选字典 → basename 模糊回扫
		resolveL0Texture := func(item maidManifestItem, nsBase string, _modelAbs string) (absPath string) {
			textureRel := stripNsPrefix(item.Texture, nsBase)
			if textureRel != "" {
				texAbs := strings.ToLower(maidNs + strings.TrimPrefix(filepath.ToSlash(textureRel), "/"))
				if _, ok := entryByPath[texAbs]; ok {
					log.Printf("%s L0 形式A 纹理: %s → %s", logPrefix, item.Texture, texAbs)
					return texAbs
				}
			}
			mid := item.ModelID
			if mid != "" {
				namePart := extractName(mid, "")
				if namePart != "" {
					if _, abs, hit := tryCandidates(namePart, textureCandidates); hit {
						// 返回 tryCandidates 的小写 abs（与 resolveL0Model 候选分支一致）：
						// entryByPath 的 key 全小写（593 行），返回 e.Name() 原始大小写会让
						// 主循环 entryByPath[texAbs] 重查 miss → 大写条目纹理静默丢弃
						// （code review P2，Windows 工具产出混合大小写 zip 的常见形态）。
						log.Printf("%s L0 形式B 纹理(候选): %s → %s", logPrefix, mid, abs)
						return abs
					}
					lazyBuildBasenameIdx()
					if match, ok := nsPngBasenames[namePart]; ok && len(match) > 0 {
						log.Printf("%s L0 形式B 纹理(basename回扫): %s → %s", logPrefix, mid, match[0].path)
						return match[0].path
					}
					log.Printf("%s L0 纹理未命中: %s", logPrefix, mid)
				}
			}
			return ""
		}

		var nsBase string
		if strings.HasPrefix(maidNs, "assets/") {
			nsBase = strings.TrimPrefix(maidNs, "assets/")
			nsBase = strings.TrimSuffix(nsBase, "/")
		}

		// modelOrder / texOrder 从清单派生（权威顺序），geoFiles / pngs 只收清单引用的条目
		l0GeoFiles := make([]geoEntry, 0, len(maidManifest))
		l0Pngs := make([][]byte, 0, len(maidManifest))
		l0PngNames := make([]string, 0, len(maidManifest))
		l0ModelOrder := make([]string, 0, len(maidManifest))
		l0TexOrder := make([]string, 0, len(maidManifest))

		for i, item := range maidManifest {
			// 模型解析
			modelAbs := resolveL0Model(item, nsBase)
			if modelAbs != "" {
				if e, ok := entryByPath[modelAbs]; ok {
					if rc, err := e.Open(); err == nil {
						buf := fsutil.ReadLimitedEntry(rc, int64(maxExtractSize))
						if len(buf) > 0 && !isArmModelName(e.Name()) {
							l0GeoFiles = append(l0GeoFiles, geoEntry{name: e.Name(), data: buf})
							l0ModelOrder = append(l0ModelOrder, modelAbs[len(maidNs):])
							resolvedPathByItem[i] = modelAbs
						}
					}
				}
			}

			// 纹理解析
			texAbs := resolveL0Texture(item, nsBase, modelAbs)
			if texAbs != "" {
				if e, ok := entryByPath[texAbs]; ok {
					if rc, err := e.Open(); err == nil {
						pngData := fsutil.ReadLimitedEntry(rc, int64(maxExtractSize))
						if len(pngData) > 0 {
							tn := e.Name()
							if idx := strings.LastIndex(tn, "/"); idx >= 0 {
								tn = tn[idx+1:]
							}
							tn = strings.TrimSuffix(tn, filepath.Ext(tn))
							l0Pngs = append(l0Pngs, pngData)
							l0PngNames = append(l0PngNames, tn)
							l0TexOrder = append(l0TexOrder, strings.ToLower(filepath.Base(texAbs)))
							texNameByItem[i] = strings.ToLower(tn)
						}
					}
				}
			}
		}

		// 只有清单至少命中了 1 个模型才用 L0 覆盖（空命中视为清单与 zip 内容脱节，回退 L1）
		if len(l0GeoFiles) > 0 {
			geoFiles = l0GeoFiles
			pngs = l0Pngs
			pngNames = l0PngNames
			modelOrder = l0ModelOrder
			texOrder = l0TexOrder
			// texCategories 与 texOrder 同序，L0 覆盖后必须同步重建（code review P3）：
			// 不重建则仍对应 ysm 派生的旧 texOrder，后续重排块会错位/丢分类。
			// L0 清单（maid_model.json）纹理全部是主模型皮肤声明，统一归 "player"。
			texCategories = make([]string, len(l0TexOrder))
			for i := range texCategories {
				texCategories[i] = "player"
			}
		}
	}

	// 移除第一人称手臂模型占位：避免 arm.json 占据 texIdx 槽位导致 main 纹理错位
	modelOrder = filterArmModels(modelOrder)

	if len(modelOrder) > 0 {
		orderMap := make(map[string]int, len(modelOrder))
		for i, p := range modelOrder {
			// key 统一小写：L0 路径 l0ModelOrder 已小写（modelAbs[len(maidNs):]），
			// 查询键 geoFiles[i].name 是 zip 条目原始大小写——大小写敏感会 miss
			// → 声明序排序失效（code review P3，Windows 混合大小写 zip）。
			orderMap[strings.ToLower(filepath.ToSlash(p))] = i
		}
		sort.SliceStable(geoFiles, func(i, j int) bool {
			// 查询键须与 orderMap 键同口径（"\\"→"/" 归一化 + 小写化）：Windows 工具
			// 产出的归档条目名可能含反斜杠/混合大小写，原实现未归一化导致声明序排序失效
			ai, oki := orderMap[strings.ToLower(filepath.ToSlash(geoFiles[i].name))]
			aj, okj := orderMap[strings.ToLower(filepath.ToSlash(geoFiles[j].name))]
			if oki && okj {
				return ai < aj
			}
			return oki
		})
	}

	// 建立模型文件→纹理索引映射
	texIdxMap := make(map[string]int)
	texCount := len(texOrder)
	if texCount == 0 {
		texCount = len(modelOrder)
	}
	// modelTexName: 模型 basename → 声明的纹理名（小写 basename 去扩展名）。
	// texIdxMap 构建时用它查 texOrder 位置分配 texSlot，而非按 modelOrder 序号
	// 截断——避免 plane.json（共用 texture.png）被截断到 arrow.png 槽位。
	modelTexName := make(map[string]string, len(projModels))
	for _, pm := range projModels {
		mp := pm.model
		if idx := strings.LastIndex(mp, "/"); idx >= 0 {
			mp = mp[idx+1:]
		}
		if idx := strings.LastIndex(mp, "\\"); idx >= 0 {
			mp = mp[idx+1:]
		}
		mp = strings.TrimSuffix(strings.TrimSuffix(mp, ".geo.json"), ".json")
		// texName: 小写 basename 去扩展名（收敛自内联，口径与 texBasenameNoExt 同）
		// key 统一小写：查询端 bn 来自 modelOrder（L0 路径已小写），projModel 声明
		// 可能含大写——大小写敏感会让声明纹理名查表 miss → texSlot 绑定失效
		// （code review P3，Windows 混合大小写 zip）。
		modelTexName[strings.ToLower(mp)] = texBasenameNoExt(pm.texName)
	}
	if len(modelOrder) > 0 {
		for i, p := range modelOrder {
			p = filepath.ToSlash(p)
			if idx := strings.LastIndex(p, "/"); idx >= 0 {
				p = p[idx+1:]
			}
			bn := strings.ToLower(strings.TrimSuffix(strings.TrimSuffix(p, ".json"), ".geo.json"))
			// 优先按声明的纹理名查 texOrder 位置；查不到再按 modelOrder 序号兜底
			ti := -1
			if texName, ok := modelTexName[bn]; ok && texName != "" {
				for j, tn := range texOrder {
					if tn == texName {
						ti = j
						break
					}
				}
			}
			if ti < 0 {
				ti = i
				if ti >= texCount {
					ti = texCount - 1
				}
			}
			texIdxMap[bn] = ti
		}
	}

	for _, gf := range geoFiles {
		g := ParseBedrockGeometry(gf.data)
		if g == nil || g.BoneCount == 0 {
			continue
		}
		// 每个 cube 记住来源文件 tex 维度
		for bi := range g.Bones {
			for ci := range g.Bones[bi].Cubes {
				g.Bones[bi].Cubes[ci].CubeTexW = g.TexWidth
				g.Bones[bi].Cubes[ci].CubeTexH = g.TexHeight
			}
		}
		// 按模型文件位置设置 cube 纹理索引
		// geoName 须先归一化 "\\"→"/" 再取 basename，且统一小写（与 texIdxMap 构建端
		// bn 同口径）：条目名含反斜杠/混合大小写时原实现取不到 basename 或大小写不匹配
		// → texIdxMap 永不命中 → TexSlot 绑定失效（code review P3，Windows 混合大小写 zip）
		geoName := filepath.ToSlash(gf.name)
		if idx := strings.LastIndex(geoName, "/"); idx >= 0 {
			geoName = geoName[idx+1:]
		}
		geoName = strings.ToLower(strings.TrimSuffix(strings.TrimSuffix(geoName, ".json"), ".geo.json"))
		ti, hasTex := texIdxMap[geoName]
		if hasTex {
			for bi := range g.Bones {
				for ci := range g.Bones[bi].Cubes {
					g.Bones[bi].Cubes[ci].TexSlot = ti
				}
			}
		}
		if geo == nil {
			geo = g
		} else {
			geo.Bones = append(geo.Bones, g.Bones...)
			geo.BoneCount += g.BoneCount
			geo.CubeCount += g.CubeCount
			if g.TexWidth > geo.TexWidth {
				geo.TexWidth = g.TexWidth
			}
			if g.TexHeight > geo.TexHeight {
				geo.TexHeight = g.TexHeight
			}
		}
	}

	// orderMap 的 key 必须与查询 key 同口径——
	// texOrder 条目是「小写 basename 含扩展名」（如 tex1.png），而查询 key 是
	// `strings.ToLower(pngNames[i])`（pngNames 已 TrimSuffix 去扩展名，如 tex1），
	// 原实现 key 永不命中 → 「纹理按声明顺序排序」形同死代码，TexSlot 绑定错位。
	// 声明提到 if 外：L0 SubModel.TexSlot 需按排序后槽位换算（审核 P3）
	orderMap := make(map[string]int, len(texOrder))
	if len(texOrder) > 0 {
		for i, n := range texOrder {
			bn := strings.TrimSuffix(n, ".png")
			bn = strings.TrimSuffix(bn, ".jpg")
			orderMap[bn] = i
		}
		sort.SliceStable(pngs, func(i, j int) bool {
			oi, hasI := orderMap[strings.ToLower(pngNames[i])]
			oj, hasJ := orderMap[strings.ToLower(pngNames[j])]
			if hasI && hasJ {
				return oi < oj
			}
			return hasI
		})
		sort.SliceStable(pngNames, func(i, j int) bool {
			oi, hasI := orderMap[strings.ToLower(pngNames[i])]
			oj, hasJ := orderMap[strings.ToLower(pngNames[j])]
			if hasI && hasJ {
				return oi < oj
			}
			return hasI
		})
	}
	// 纹理名与 pngs 同序（同一循环收集 + 同一 orderMap 排序），供前端纹理列表显示
	if geo != nil {
		geo.TextureNames = pngNames

		// texCategories 与 texOrder 同序，需要按 pngNames 排序后的顺序重排
		if len(texCategories) > 0 && len(texOrder) > 0 {
			ordered := make([]string, len(pngNames))
			for i, pn := range pngNames {
				// 在 texOrder 中找到 pngNames[i] 对应的位置，取同位置的 texCategories。
				// texOrder 已小写（475/495 行），pngNames 保留 zip 原始大小写——比较须
				// 大小写不敏感（同函数 958/966 行排序比较器均已 ToLower，此处保持口径一致）。
				lowPn := strings.ToLower(pn)
				for j, tn := range texOrder {
					bn := strings.TrimSuffix(tn, ".png")
					bn = strings.TrimSuffix(bn, ".jpg")
					if bn == lowPn || strings.ToLower(tn) == lowPn {
						if j < len(texCategories) {
							ordered[i] = texCategories[j]
						}
						break
					}
				}
			}
			geo.TextureCategories = ordered
		}

		// ===== SubModels 清单：L0 优先 → L1 兜底 =====
		if len(maidManifest) > 0 {
			// L0：Name 取自 manifest，SourcePath 是 zip 内绝对路径，TexSlot 对应 manifest 下标
			l0Subs := make([]types.SubModel, 0, len(maidManifest))
			for i, item := range maidManifest {
				if item.Name == "" {
					continue
				}
				// SourcePath 用实际解析到的 zip 路径（形式 B model_id 推断时 item.Model 为空，
				// 直接拼 maidNs 会得到命名空间目录 → 单角色匹配必失败，静默回退全量合并模型）；
				// 未解析到则留空 → 前端 subPath undefined 走兜底。
				// TexSlot 用条目纹理在排序后纹理数组的下标（texNameByItem → orderMap），
				// 而非 manifest 下标（纹理解析失败的条目会使 l0Pngs 收缩、下标漂移）。
				slot := 0
				if tn, ok := texNameByItem[i]; ok {
					if s, ok2 := orderMap[tn]; ok2 {
						slot = s
					}
				}
				l0Subs = append(l0Subs, types.SubModel{
					Name:       item.Name,
					SourcePath: resolvedPathByItem[i],
					TexSlot:    slot,
				})
			}
			if len(l0Subs) > 0 {
				geo.SubModels = l0Subs
			}
		}
		if len(geo.SubModels) == 0 && len(geoFiles) > 0 {
			// L1 兜底：从 geoFiles 派生（Name=basename 去 .geo.json/.json 后缀）
			l1Subs := make([]types.SubModel, 0, len(geoFiles))
			for i, gf := range geoFiles {
				subName := filepath.ToSlash(gf.name)
				if idx := strings.LastIndex(subName, "/"); idx >= 0 {
					subName = subName[idx+1:]
				}
				subName = strings.TrimSuffix(subName, ".geo.json")
				subName = strings.TrimSuffix(subName, ".json")
				slot := i
				if slot >= len(pngs) && len(pngs) > 0 {
					slot = len(pngs) - 1
				}
				l1Subs = append(l1Subs, types.SubModel{
					Name:       subName,
					SourcePath: gf.name,
					TexSlot:    slot,
				})
			}
			geo.SubModels = l1Subs
		}
	}
	// 顺带返回过滤后的 geoFiles（L0/L1 口径、排 arm）：ParseFromZipEntry 复用同一趟解析
	// 的 geoFiles 做 subPath 匹配，避免二次全量遍历（审核 P3）
	if geo != nil && (ysmMeta.Name != "" || ysmMeta.Tips != "" || len(ysmMeta.Authors) > 0 || ysmMeta.License != nil || len(ysmMeta.Links) > 0) {
		geo.Metadata = &ysmMeta
	}
	if geo != nil {
		geo.FileInventory = classifyFileInventory(entries)
	}
	// 旧格式兜底：无 ysm.json（或 ysm.json 无 metadata）时从 info.json 补元数据
	// （Modern YSM parseLegacyFormat 同口径；已挂 metadata 不覆盖）
	if geo != nil && geo.Metadata == nil {
		geo.Metadata = parseLegacyMetadata(entries)
	}
	return geo, pngs, animJSONs, geoFiles
}

// ParseFromZip 从 ZIP 字节中解析 Bedrock Geometry 并提取纹理和动画。
func ParseFromZip(data []byte, size int64) (*types.BedrockModel, [][]byte, []string) {
	geo, pngs, anims, _ := parseModelFromArchive(data, size, false)
	return geo, pngs, anims
}

// ParseFrom7z 从 7z 字节中解析 Bedrock Geometry 并提取纹理。
func ParseFrom7z(data []byte, size int64) (*types.BedrockModel, [][]byte) {
	geo, pngs, _, _ := parseModelFromArchive(data, size, true)
	return geo, pngs
}

// ParseFromZipEntry 按 subPath（zip 内路径，L0 SubModel.SourcePath 口径）解析单个 geometry 文件。
// 不合并多角色 bones，直接返回单角色 BedrockModel；纹理 pngs 仍全量返回（切换角色只是换骨骼，不换纹理集合）。
// 命中失败 → geo=nil。调用方需自行兜底（如回到全量合并解析）。
//
// subPath 匹配策略（与 L0 SubModel.SourcePath 生成口径一致，三层降级命中）：
//  1. 精确（lower + ToSlash）zip entry 路径命中
//  2. 对 subPath 去掉 "assets/<ns>/" 前缀后，再精确/相对命名空间前缀命中
//  3. basename 模糊（去 .json/.geo.json，或只截取 lastSegment 去后缀，按 geoFiles basename 字典取首条）
func ParseFromZipEntry(data []byte, size int64, subPath string) (*types.BedrockModel, [][]byte) {
	return parseFromArchiveEntry(data, size, subPath, false)
}

// ParseFrom7zEntry 对应 ParseFromZipEntry 的 7z 版本；subPath 匹配策略完全一致。
func ParseFrom7zEntry(data []byte, size int64, subPath string) (*types.BedrockModel, [][]byte) {
	return parseFromArchiveEntry(data, size, subPath, true)
}

// matchGeoEntryBySubPath 从 geoFiles 中挑一个匹配 subPath 的条目。
// subPath 为空 → 未命中。匹配策略：exact ToSlash lower → 命名空间相对 → basename（去 json/geo.json）
func matchGeoEntryBySubPath(geoFiles []geoEntry, subPath string) (geoEntry, bool) {
	if subPath == "" {
		return geoEntry{}, false
	}
	sp := strings.ToLower(filepath.ToSlash(subPath))
	// 1) exact full path
	for _, gf := range geoFiles {
		if strings.ToLower(filepath.ToSlash(gf.name)) == sp {
			return gf, true
		}
	}
	// 2) 命名空间前缀剥离（subPath 形如 assets/droneeee/models/entity/x.json
	//    而 geoFiles 里的 name 也可能写绝对路径或不含 assets 前缀的相对路径——
	//    先去掉 assets/<ns>/ 段再互相比对）
	trimAssets := func(p string) string {
		p = strings.ToLower(filepath.ToSlash(p))
		if strings.HasPrefix(p, "assets/") {
			// 截到第二个 "/" 之后（assets/<ns>/xxx → xxx）
			if rest := strings.TrimPrefix(p, "assets/"); strings.Contains(rest, "/") {
				return rest[strings.Index(rest, "/")+1:]
			}
		}
		// 去掉任意首段 "xxx/"（命名空间前缀去头）
		if idx := strings.Index(p, "/"); idx >= 0 && idx+1 < len(p) {
			return p[idx+1:]
		}
		return p
	}
	spRel := trimAssets(sp)
	if spRel != sp {
		for _, gf := range geoFiles {
			if trimAssets(gf.name) == spRel {
				return gf, true
			}
		}
	}
	// 3) basename 模糊：去 .json/.geo.json 后 basename 相等
	geoBase := func(p string) string {
		p = strings.ToLower(filepath.ToSlash(p))
		if idx := strings.LastIndex(p, "/"); idx >= 0 {
			p = p[idx+1:]
		}
		p = strings.TrimSuffix(p, ".geo.json")
		p = strings.TrimSuffix(p, ".json")
		return p
	}
	spBase := geoBase(sp)
	if spBase == "" {
		return geoEntry{}, false
	}
	for _, gf := range geoFiles {
		if geoBase(gf.name) == spBase {
			return gf, true
		}
	}
	return geoEntry{}, false
}

// IsMainModelName 判断模型文件是否为主组件（main.json / main.geo.json）。
// 导出供 wasm 多组件路径（decodeYSMComponentsViaNodeJS）与 zip 路径统一 main 判定口径。
func IsMainModelName(name string) bool {
	base := strings.ToLower(name)
	if idx := strings.LastIndexAny(base, "/\\"); idx >= 0 {
		base = base[idx+1:]
	}
	base = strings.TrimSuffix(base, ".json")
	return base == "main" || base == "main.geo"
}

// ParseComponentsFromZip 多组件解析（YSMViewer 式）：zip 内每个模型文件独立组件，
// 含 arm/载具等组件（不合并、不排除）；main 优先排序，perComponent 独立纹理。
// 供 threejs.BuildMulti 生成多组件 spec。
func ParseComponentsFromZip(data []byte, size int64) ([]types.BedrockModel, []string, error) {
	return parseComponentsFromArchive(data, size, false)
}

// parseComponentsFromArchive 多组件解析统一实现（zip/7z）：collectArchiveFiles →
// buildComponents → classifyFileInventory。收敛 ParseComponentsFromZip/7z 的分形双份——
// 8-22 FileInventory 下沉后 collect/build/classify 循环在 zip/7z 各写一遍，改一处漏一处
// 即行为分叉（提交 eghrhegpe 0b1ceec0 以来两次同构累积）。
func parseComponentsFromArchive(data []byte, size int64, sevenZip bool) ([]types.BedrockModel, []string, error) {
	r, err := openArchiveBytes(data, size, sevenZip)
	if err != nil {
		return nil, nil, err
	}
	defer r.Close()
	modelOrder, texOrder, geoFiles, pngs, pngNames, _, modelTexName := collectArchiveFiles(r.Entries())
	models, texNames, err := buildComponents(geoFiles, modelOrder, texOrder, pngs, pngNames, modelTexName)
	if err != nil {
		return nil, nil, err
	}
	// 文件归属清单（只识别不解析）：每个组件挂同一容器清单，前端取任一组件即可得
	inv := classifyFileInventory(r.Entries())
	for i := range models {
		models[i].FileInventory = inv // 值类型 range 副本不写回，须按索引
	}
	return models, texNames, nil
}

// buildComponents 组件化收集：main 优先排序 + TexSlot 全局化 + 独立解析。
// 与 ParseFromZip 合并逻辑同源（collectArchiveFiles 共享收集），仅解析阶段不合并 bones、
// texSlot 不按 texOrder 钳制（texArr 含全部组件纹理，texSlot = 成功组件序，连续无空洞）。
// 返回 texNames（组件序纹理名，R1 契约校验用）：直接按组件 basename 查 modelTexName 映射，
// 不再依赖 modelOrder/texOrder 索引对齐——消除 texOrder 去重后索引漂移（wine_fox 根因）。
// buildComponents 组件化收集：每组件独立纹理（ADR-114 perComponent）。
// cube.TexSlot = 0（每组件用自己的第 0 张），不再全局 texOrder 位置分配。
// ComponentTextures[componentName] = [declaredTexBase64]，前端按组件名查纹理。
func buildComponents(geoFiles []geoEntry, modelOrder, texOrder []string, pngs [][]byte, pngNames []string, modelTexName map[string]string) ([]types.BedrockModel, []string, error) {
	orderMap := make(map[string]int, len(modelOrder))
	for i, p := range modelOrder {
		orderMap[filepath.ToSlash(p)] = i
	}
	// pngNameMap：纹理名（小写 basename 去扩展名）→ pngs 索引
	pngNameMap := make(map[string]int, len(pngNames))
	for i, n := range pngNames {
		pngNameMap[strings.ToLower(n)] = i
	}
	// 排序：main 优先 + modelOrder 相对序；modelOrder 为空（ysm.json 无 player.model
	// 声明或解析失败）时回退 IsMainModelName 优先 + 路径字典序——与 WASM 路径同口径（P2）。
	sort.SliceStable(geoFiles, func(i, j int) bool {
		mi := IsMainModelName(geoFiles[i].name)
		mj := IsMainModelName(geoFiles[j].name)
		if mi != mj {
			return mi
		}
		if len(modelOrder) > 0 {
			ai, oki := orderMap[filepath.ToSlash(geoFiles[i].name)]
			aj, okj := orderMap[filepath.ToSlash(geoFiles[j].name)]
			if oki && okj {
				return ai < aj
			}
			if oki != okj {
				return oki
			}
		}
		return geoFiles[i].name < geoFiles[j].name
	})
	var comps []types.BedrockModel
	// texNames = texArr **期望序**（契约校验：前端 texArr 来自元数据，序 = texOrderNames
	// 优先 + 其余按名；texNames[i] = texArr 第 i 个的期望名 = texOrder[i]，越界用 basename）。
	// 注意：texNames 索引是 texArr 连续索引（与组件解析跳过无关——texArr 来自元数据，
	// 不因组件跳过而收缩）；长度 = 成功组件数，契约比对 Math.min 截断，未解析组件槽位不比对。
	// texSlot = 纹理槽（组件贴 texArr[texSlot]）：已声明组件用**声明序位置 j**
	// （texArr 声明段 = texOrderNames 序）；未声明组件 = len(texOrder) + 按名段序号
	// （组件序尾部未声明段按路径排序，与 texArr 按名段一致）。——P2 修复：
	// 之前 texSlot=组件序会让 main 非首位时贴错纹理（如 model:["arm","main"] 时 main 贴 arm）。
	texNames := make([]string, 0, len(geoFiles))
	// ADR-114 perComponent：每组件独立纹理，cube.TexSlot=0（用自己的第 0 张）。
	// texOrder 仅用于查"组件声明的纹理名"，不再作为全局槽位索引。
	// compTex 在循环内创建，避免所有组件共享同一个 map 引用（否则每个组件的
	// ComponentTextures 都会包含所有已处理组件的条目）。
	for _, gf := range geoFiles {
		g := ParseBedrockGeometry(gf.data)
		if g == nil || g.BoneCount == 0 {
			continue
		}
		// 组件源模型名（去扩展名）：main/arm/arrow/minecart/boat/foxcar/trident
		geoName := filepath.ToSlash(gf.name)
		if idx := strings.LastIndex(geoName, "/"); idx >= 0 {
			geoName = geoName[idx+1:]
		}
		compName := strings.TrimSuffix(strings.TrimSuffix(geoName, ".geo.json"), ".json")

		// 查组件声明的纹理名：按 basename 直接查 modelTexName 映射，不再依赖 modelOrder 索引。
		// 修复 wine_fox 根因：texOrder 去重后长度 < modelOrder，按索引查表会错位。
		declaredTexName := ""
		if modelTexName != nil {
			declaredTexName = modelTexName[filepath.ToSlash(gf.name)]
		}
		// fallback：按 compName 查（path 前缀可能被 strip，如 "models/foxcar.json" → 查不到，
		// 此时用 basename）
		if declaredTexName == "" && modelTexName != nil {
			declaredTexName = modelTexName[compName]
		}
		// 未声明纹理的组件：同名 basename 纹理兜底（arm → arm.png；对齐 YSMViewer
		// 每组件独立纹理口径——Go 端识别组件同名纹理，前端不再 fallback 全局贴错/灰。
		// 三叉戟灰根因修复：投射物/子组件未声明纹理时 compTex 曾无条目）
		if declaredTexName == "" {
			if _, ok := pngNameMap[compName]; ok {
				declaredTexName = compName
			}
		}

		// 按声明的纹理名查 pngNameMap → pngs[idx] → base64
		var texBase64 string
		if declaredTexName != "" {
			if idx, ok := pngNameMap[declaredTexName]; ok && idx < len(pngs) {
				texBase64 = "data:image/png;base64," + base64.StdEncoding.EncodeToString(pngs[idx])
			}
		}

		// 每组件 cube.TexSlot=0（perComponent，用自己的第 0 张纹理）
		for bi := range g.Bones {
			for ci := range g.Bones[bi].Cubes {
				g.Bones[bi].Cubes[ci].CubeTexW = g.TexWidth
				g.Bones[bi].Cubes[ci].CubeTexH = g.TexHeight
				g.Bones[bi].Cubes[ci].TexSlot = 0
			}
		}

		// 填 ComponentTextures[compName] = [texBase64]
		compTex := make(map[string][]string)
		if texBase64 != "" {
			compTex[compName] = []string{texBase64}
		}

		// texNames[i] = 组件声明的纹理名（无声明用 basename）
		tn := compName
		if declaredTexName != "" {
			tn = declaredTexName
		}
		g.SourceName = compName
		g.ComponentTextures = compTex
		texNames = append(texNames, tn)
		comps = append(comps, *g)
	}
	return comps, texNames, nil
}

// ParseComponentsFrom7z 多组件解析（7z 版）：与 ParseComponentsFromZip 同构，
// 复用 parseComponentsFromArchive（含 arm、main 优先、perComponent 独立纹理）。
func ParseComponentsFrom7z(data []byte, size int64) ([]types.BedrockModel, []string, error) {
	return parseComponentsFromArchive(data, size, true)
}

// ===== zip/7z 双份路径收敛（8-22 功能冲刺遗留的分形重复）=====
// 六入口原先各写 OpenZipBytes/Open7zBytes，7z 失败日志也双份；FileInventory/SubModels/
// projectiles 每上新功能都要 zip/7z 各改一遍。收敛后单一打开点 + 单一实现，改 bug 只改一处。

// openArchiveBytes 统一 zip/7z 字节打开；7z 失败保留日志（对齐历史 ParseFrom7z/Entry 口径）。
func openArchiveBytes(data []byte, size int64, sevenZip bool) (container.Reader, error) {
	if sevenZip {
		r, err := container.Open7zBytes(data, size)
		if err != nil {
			log.Printf("[geometry] 打开 7z 失败: %v", err)
			return nil, err
		}
		return r, nil
	}
	return container.OpenZipBytes(data, size)
}

// archiveLogTag 供 parseModelFromEntries 的 logTag 参数：zip/7z 版统一口径。
func archiveLogTag(sevenZip bool) string {
	if sevenZip {
		return "7z"
	}
	return "zip"
}

// parseModelFromArchive 单模型合并解析统一实现（zip/7z）：open + parseModelFromEntries。
// ParseFromZip 返回 anims（= pngNames），ParseFrom7z 丢弃——本收敛只消 open 双写，签名各自不变。
func parseModelFromArchive(data []byte, size int64, sevenZip bool) (*types.BedrockModel, [][]byte, []string, []geoEntry) {
	r, err := openArchiveBytes(data, size, sevenZip)
	if err != nil {
		return nil, nil, nil, nil
	}
	defer r.Close()
	return parseModelFromEntries(r.Entries(), archiveLogTag(sevenZip))
}

// parseFromArchiveEntry 单角色按 subPath 解析统一实现（zip/7z）：open + parseModelFromEntries
// 一趟拿 pngs + 过滤后 geoFiles（不再二次 collectArchiveFiles，审核 P3），再 matchGeoEntryBySubPath。
func parseFromArchiveEntry(data []byte, size int64, subPath string, sevenZip bool) (*types.BedrockModel, [][]byte) {
	if subPath == "" {
		return nil, nil
	}
	r, err := openArchiveBytes(data, size, sevenZip)
	if err != nil {
		return nil, nil
	}
	defer r.Close()
	entries := r.Entries()
	// PNG 全量须与 ParseFromZip 同口径：L0 清单过滤（否则 SubModel.TexSlot = i 会指错纹理数组下标）。
	_, pngs, _, geoFiles := parseModelFromEntries(entries, archiveLogTag(sevenZip))
	if len(geoFiles) == 0 {
		return nil, pngs
	}
	if gf, ok := matchGeoEntryBySubPath(geoFiles, subPath); ok {
		g := ParseBedrockGeometry(gf.data)
		if g != nil {
			return g, pngs
		}
	}
	return nil, pngs
}
