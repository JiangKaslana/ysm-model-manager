// ===== 从压缩包中提取并解析 Bedrock Geometry =====
// 支持 ZIP（YSM 标准格式）和 7z 格式。容器打开统一走 go/container（ADR-068）。
package geometry

import (
	"bytes"
	"encoding/json"
	"io"
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

// readLimitedEntry 读取 zip/7z 单条目：limit+1 探测截断（ADR-033 修复）——
// 原 `io.ReadAll(io.LimitReader(rc, maxExtractSize))` 截断后 err==nil 静默，
// 超 50MB 的 PNG/geometry 会被截断后继续使用（损坏数据装盘）。
// ADR-044 策略 A：实现已收敛至 fsutil.ReadLimitedEntry（本处保留包内转发，调用点零改动）。
// 读取错误或超限返回 nil，调用方跳过该条目。
func readLimitedEntry(rc io.ReadCloser) []byte {
	return fsutil.ReadLimitedEntry(rc, int64(maxExtractSize))
}

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
			buf := readLimitedEntry(rc)
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

// collectArchiveFiles 从压缩包收集 ysm.json 映射/模型文件/纹理（合并版与组件版共用）。
// 与 ParseFromZip 原内联逻辑等价，但 geoFiles **不排除 arm**（arm 过滤由合并版调用方
// filterArmModels 做；组件版需要 arm 作为独立组件）。entries 现为 container.Entry（ADR-068）。
func collectArchiveFiles(entries []container.Entry) (modelOrder, texOrder []string, geoFiles []geoEntry, pngs [][]byte, pngNames, animJSONs []string) {
	for _, e := range entries {
		low := strings.ToLower(e.Name())
		if strings.HasSuffix(low, "ysm.json") && !e.IsDir() {
			rc, err := e.Open()
			if err != nil {
				continue
			}
			buf := readLimitedEntry(rc)
			var ysm struct {
				Properties struct {
					DefaultTexture string `json:"default_texture"`
				} `json:"properties"`
				Files struct {
					Player struct {
						Model   json.RawMessage `json:"model"`
						Texture json.RawMessage `json:"texture"`
					} `json:"player"`
				} `json:"files"`
			}
			if err := json.Unmarshal(buf, &ysm); err != nil {
				log.Printf("[geometry] 解析 ysm.json 失败: %v", err)
			} else {
				// 解析 texture 顺序
				if len(ysm.Files.Player.Texture) > 0 {
					texRaw := string(ysm.Files.Player.Texture)
					if strings.HasPrefix(strings.TrimSpace(texRaw), `[`) {
						var arr []json.RawMessage
						if json.Unmarshal(ysm.Files.Player.Texture, &arr) == nil {
							for _, item := range arr {
								s := strings.TrimSpace(string(item))
								if strings.HasPrefix(s, `{`) {
									var obj struct {
										Uv string `json:"uv"`
									}
									if json.Unmarshal(item, &obj) == nil && obj.Uv != "" {
										tn := obj.Uv
										if idx := strings.LastIndex(tn, "/"); idx >= 0 {
											tn = tn[idx+1:]
										}
										if idx := strings.LastIndex(tn, "\\"); idx >= 0 {
											tn = tn[idx+1:]
										}
										tn = strings.TrimSuffix(strings.TrimSuffix(strings.ToLower(tn), ".png"), ".jpg")
										texOrder = append(texOrder, tn)
									}
								} else {
									var sval string
									if json.Unmarshal(item, &sval) == nil && sval != "" {
										tn := sval
										if idx := strings.LastIndex(tn, "/"); idx >= 0 {
											tn = tn[idx+1:]
										}
										tn = strings.TrimSuffix(strings.TrimSuffix(strings.ToLower(tn), ".png"), ".jpg")
										texOrder = append(texOrder, tn)
									}
								}
							}
						}
					}
				}
				// 解析 model 字段（支持 4 种格式）
				raw := strings.TrimSpace(string(ysm.Files.Player.Model))
				if len(raw) > 0 {
					if raw[0] == '[' {
						var arr []json.RawMessage
						if json.Unmarshal(ysm.Files.Player.Model, &arr) == nil {
							for _, item := range arr {
								s := strings.TrimSpace(string(item))
								if len(s) > 0 && s[0] == '{' {
									var obj struct {
										Path string `json:"path"`
										Name string `json:"name"`
									}
									if json.Unmarshal(item, &obj) == nil {
										n := obj.Path
										if n == "" {
											n = obj.Name
										}
										if n != "" {
											modelOrder = append(modelOrder, n)
										}
									}
								} else {
									var sval string
									if json.Unmarshal(item, &sval) == nil && sval != "" {
										modelOrder = append(modelOrder, sval)
									}
								}
							}
						}
					} else if raw[0] == '{' {
						// map 格式：JSON 对象**写入序**即 Bedrock 声明序（main 通常最先声明）。
						// Go map 丢失写入序，必须 json.Decoder Token 流式保序遍历——
						// sort.Strings 键排序会把 main 排到 arm 后，导致 texSlot 绑定错位（P2 修复）。
						dec := json.NewDecoder(bytes.NewReader(ysm.Files.Player.Model))
						if tok, err := dec.Token(); err == nil && tok == json.Delim('{') {
							for dec.More() {
								keyTok, err := dec.Token()
								if err != nil {
									break
								}
								_, _ = keyTok.(string) // 键名仅作引用，写入序即声明序
								var val string
								if err := dec.Decode(&val); err != nil {
									break
								}
								if val != "" {
									modelOrder = append(modelOrder, val)
								}
							}
						}
					} else {
						var sval string
						if json.Unmarshal(ysm.Files.Player.Model, &sval) == nil && sval != "" {
							modelOrder = append(modelOrder, sval)
						}
					}
				}
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
			buf := readLimitedEntry(rc)
			// 注意：不排除 arm（组件版需要；合并版由调用方 filterArmModels 过滤）
			geoFiles = append(geoFiles, geoEntry{name: e.Name(), data: buf})
		}
		if (strings.HasSuffix(low, ".png") || strings.HasSuffix(low, ".jpg")) && !e.IsDir() && !strings.Contains(low, "avatar/") {
			rc, err := e.Open()
			if err != nil {
				continue
			}
			pngData := readLimitedEntry(rc)
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
	return modelOrder, texOrder, geoFiles, pngs, pngNames, animJSONs
}

// parseModelFromEntries 共享主体：ysm.json 解析 + model/texture 顺序 + geo/png/anim 收集，
// 构建 BedrockModel。logTag 用于日志前缀（"zip" / "7z"）。
func parseModelFromEntries(entries []container.Entry, logTag string) (*types.BedrockModel, [][]byte, []string) {
	logPrefix := "[geometry]"
	if logTag != "zip" {
		logPrefix = logPrefix + " " + logTag
	}
	var geo *types.BedrockModel
	var pngs [][]byte
	var pngNames []string
	var animJSONs []string

	var modelOrder []string
	var texOrder []string
	for _, e := range entries {
		low := strings.ToLower(e.Name())
		if strings.HasSuffix(low, "ysm.json") && !e.IsDir() {
			rc, err := e.Open()
			if err != nil {
				continue
			}
			buf := readLimitedEntry(rc)
			var ysm struct {
				Properties struct {
					DefaultTexture string `json:"default_texture"`
				} `json:"properties"`
				Files struct {
					Player struct {
						Model   json.RawMessage `json:"model"`
						Texture json.RawMessage `json:"texture"`
					} `json:"player"`
				} `json:"files"`
			}
			if err := json.Unmarshal(buf, &ysm); err != nil {
				log.Printf("%s 解析 ysm.json 失败: %v", logPrefix, err)
			} else {
				// 解析 texture 顺序
				if len(ysm.Files.Player.Texture) > 0 {
					texRaw := string(ysm.Files.Player.Texture)
					if strings.HasPrefix(strings.TrimSpace(texRaw), `[`) {
						var arr []json.RawMessage
						if json.Unmarshal(ysm.Files.Player.Texture, &arr) == nil {
							for _, item := range arr {
								s := strings.TrimSpace(string(item))
								if strings.HasPrefix(s, `{`) {
									var obj struct {
										Uv string `json:"uv"`
									}
									if json.Unmarshal(item, &obj) == nil && obj.Uv != "" {
										tn := obj.Uv
										if idx := strings.LastIndex(tn, "/"); idx >= 0 {
											tn = tn[idx+1:]
										}
										if idx := strings.LastIndex(tn, "\\"); idx >= 0 {
											tn = tn[idx+1:]
										}
										texOrder = append(texOrder, strings.ToLower(tn))
									}
								} else {
									var sval string
									if json.Unmarshal(item, &sval) == nil && sval != "" {
										tn := sval
										if idx := strings.LastIndex(tn, "/"); idx >= 0 {
											tn = tn[idx+1:]
										}
										texOrder = append(texOrder, strings.ToLower(tn))
									}
								}
							}
						}
					}
				}
				// 解析 model 字段（支持 4 种格式）
				raw := strings.TrimSpace(string(ysm.Files.Player.Model))
				if len(raw) > 0 {
					if raw[0] == '[' {
						var arr []json.RawMessage
						if json.Unmarshal(ysm.Files.Player.Model, &arr) == nil {
							for _, item := range arr {
								s := strings.TrimSpace(string(item))
								if len(s) > 0 && s[0] == '{' {
									var obj struct {
										Path string `json:"path"`
										Name string `json:"name"`
									}
									if json.Unmarshal(item, &obj) == nil {
										n := obj.Path
										if n == "" {
											n = obj.Name
										}
										if n != "" {
											modelOrder = append(modelOrder, n)
										}
									}
								} else {
									var sval string
									if json.Unmarshal(item, &sval) == nil && sval != "" {
										modelOrder = append(modelOrder, sval)
									}
								}
							}
						}
					} else if raw[0] == '{' {
						// map 格式：JSON 对象**写入序**即 Bedrock 声明序（main 通常最先声明）。
						// Go map 丢失写入序，必须 json.Decoder Token 流式保序遍历——
						// sort.Strings 键排序会把 main 排到 arm 后，导致 texSlot 绑定错位（P2 修复）。
						dec := json.NewDecoder(bytes.NewReader(ysm.Files.Player.Model))
						if tok, err := dec.Token(); err == nil && tok == json.Delim('{') {
							for dec.More() {
								keyTok, err := dec.Token()
								if err != nil {
									break
								}
								_, _ = keyTok.(string) // 键名仅作引用，写入序即声明序
								var val string
								if err := dec.Decode(&val); err != nil {
									break
								}
								if val != "" {
									modelOrder = append(modelOrder, val)
								}
							}
						}
					} else {
						var sval string
						if json.Unmarshal(ysm.Files.Player.Model, &sval) == nil && sval != "" {
							modelOrder = append(modelOrder, sval)
						}
					}
				}
			}
			break
		}
	}

	var geoFiles []geoEntry

	for _, e := range entries {
		low := strings.ToLower(e.Name())
		if strings.HasSuffix(low, ".json") && !e.IsDir() {
			if strings.Contains(low, "ysm.json") {
				continue
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
			buf := readLimitedEntry(rc)
			if isArmModelName(e.Name()) {
				continue // 排除第一人称手臂模型 arm.json（与 main 手臂重叠 → 双手臂）
			}
			geoFiles = append(geoFiles, geoEntry{name: e.Name(), data: buf})
		}
		if (strings.HasSuffix(low, ".png") || strings.HasSuffix(low, ".jpg")) && !e.IsDir() && !strings.Contains(low, "avatar/") {
			rc, err := e.Open()
			if err != nil {
				continue
			}
			pngData := readLimitedEntry(rc)
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

	// 移除第一人称手臂模型占位：避免 arm.json 占据 texIdx 槽位导致 main 纹理错位
	modelOrder = filterArmModels(modelOrder)

	if len(modelOrder) > 0 {
		orderMap := make(map[string]int, len(modelOrder))
		for i, p := range modelOrder {
			orderMap[filepath.ToSlash(p)] = i
		}
		sort.SliceStable(geoFiles, func(i, j int) bool {
			// 查询键须与 orderMap 键同口径（"\\"→"/" 归一化）：Windows 工具
			// 产出的归档条目名可能含反斜杠，原实现未归一化导致声明序排序失效
			ai, oki := orderMap[filepath.ToSlash(geoFiles[i].name)]
			aj, okj := orderMap[filepath.ToSlash(geoFiles[j].name)]
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
	if len(modelOrder) > 0 {
		for i, p := range modelOrder {
			p = filepath.ToSlash(p)
			if idx := strings.LastIndex(p, "/"); idx >= 0 {
				p = p[idx+1:]
			}
			ti := i
			if ti >= texCount {
				ti = texCount - 1
			}
			texIdxMap[strings.TrimSuffix(p, ".json")] = ti
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
		// geoName 须先归一化 "\\"→"/" 再取 basename：条目名含反斜杠时
		// 原实现取不到 basename → texIdxMap 永不命中 → TexSlot 绑定失效
		geoName := filepath.ToSlash(gf.name)
		if idx := strings.LastIndex(geoName, "/"); idx >= 0 {
			geoName = geoName[idx+1:]
		}
		geoName = strings.TrimSuffix(strings.TrimSuffix(geoName, ".json"), ".geo.json")
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

	if len(texOrder) > 0 {
		// orderMap 的 key 必须与查询 key 同口径——
		// texOrder 条目是「小写 basename 含扩展名」（如 tex1.png），而查询 key 是
		// `strings.ToLower(pngNames[i])`（pngNames 已 TrimSuffix 去扩展名，如 tex1），
		// 原实现 key 永不命中 → 「纹理按声明顺序排序」形同死代码，TexSlot 绑定错位。
		orderMap := make(map[string]int, len(texOrder))
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
	}
	return geo, pngs, animJSONs
}

// ParseFromZip 从 ZIP 字节中解析 Bedrock Geometry 并提取纹理和动画。
func ParseFromZip(data []byte, size int64) (*types.BedrockModel, [][]byte, []string) {
	r, err := container.OpenZipBytes(data, size)
	if err != nil {
		return nil, nil, nil
	}
	defer r.Close()
	return parseModelFromEntries(r.Entries(), "zip")
}

// ParseFrom7z 从 7z 字节中解析 Bedrock Geometry 并提取纹理。
func ParseFrom7z(data []byte, size int64) (*types.BedrockModel, [][]byte) {
	r, err := container.Open7zBytes(data, size)
	if err != nil {
		log.Printf("[geometry] 打开 7z 失败: %v", err)
		return nil, nil
	}
	defer r.Close()
	geo, pngs, _ := parseModelFromEntries(r.Entries(), "7z")
	return geo, pngs
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
// 含 arm/载具等组件（不合并、不排除）；main 优先排序，TexSlot 全局化。
// 供 threejs.BuildMulti 生成多组件 spec。
func ParseComponentsFromZip(data []byte, size int64) ([]types.BedrockModel, []string, error) {
	r, err := container.OpenZipBytes(data, size)
	if err != nil {
		return nil, nil, err
	}
	defer r.Close()
	modelOrder, texOrder, geoFiles, _, _, _ := collectArchiveFiles(r.Entries())
	return buildComponents(geoFiles, modelOrder, texOrder)
}

// buildComponents 组件化收集：main 优先排序 + TexSlot 全局化 + 独立解析。
// 与 ParseFromZip 合并逻辑同源（collectArchiveFiles 共享收集），仅解析阶段不合并 bones、
// texSlot 不按 texOrder 钳制（texArr 含全部组件纹理，texSlot = 成功组件序，连续无空洞）。
// 返回 texNames（组件序纹理名，R1 契约校验用）：取「组件在 modelOrder **声明序**中的
// 原始位置 j」的 texOrder[j]（main 优先只影响显示排序，不改变纹理槽基——P2 修复）；
// 无声明/越界用组件 basename（补扫段 texArr 按名排序与组件补扫按名一致）。
func buildComponents(geoFiles []geoEntry, modelOrder, texOrder []string) ([]types.BedrockModel, []string, error) {
	orderMap := make(map[string]int, len(modelOrder))
	for i, p := range modelOrder {
		orderMap[filepath.ToSlash(p)] = i
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
	undeclSeq := 0 // 未声明组件按名段序号（texSlot 基 = len(texOrder)）
	for _, gf := range geoFiles {
		g := ParseBedrockGeometry(gf.data)
		if g == nil || g.BoneCount == 0 {
			continue
		}
		texSlot := len(texOrder) + undeclSeq
		if j, declared := orderMap[filepath.ToSlash(gf.name)]; declared && len(texOrder) > 0 {
			if j < len(texOrder) {
				texSlot = j // 已声明且在纹理声明范围内：贴 texArr[j]
			} else {
				texSlot = len(texOrder) - 1 // 模型多于纹理声明：钳到最后一张声明纹理
			}
		} else {
			undeclSeq++ // 未声明 / 无纹理声明：按名段
		}
		for bi := range g.Bones {
			for ci := range g.Bones[bi].Cubes {
				g.Bones[bi].Cubes[ci].CubeTexW = g.TexWidth
				g.Bones[bi].Cubes[ci].CubeTexH = g.TexHeight
				g.Bones[bi].Cubes[ci].TexSlot = texSlot
			}
		}
		// TrimSuffix 先 .geo.json 后 .json：main.geo.json → "main" 而非 "main.geo"（P2）
		geoName := filepath.ToSlash(gf.name)
		if idx := strings.LastIndex(geoName, "/"); idx >= 0 {
			geoName = geoName[idx+1:]
		}
		tn := strings.TrimSuffix(strings.TrimSuffix(geoName, ".geo.json"), ".json")
		// texNames[i] = 组件实际贴图名（texSlot 指向声明序则用声明名，否则组件 basename）——
		// 前端 R1 存在性校验：期望名必须存在于 texArr 实际清单（共享槽位不再误报）
		if texSlot < len(texOrder) && texOrder[texSlot] != "" {
			tn = texOrder[texSlot]
		}
		// SourceName = 组件源模型文件名（去扩展名，如 main/arm/arrow），UI 组件名用
		g.SourceName = strings.TrimSuffix(strings.TrimSuffix(geoName, ".geo.json"), ".json")
		texNames = append(texNames, tn)
		comps = append(comps, *g)
	}
	return comps, texNames, nil
}

// ParseComponentsFrom7z 多组件解析（7z 版）：与 ParseComponentsFromZip 同构，
// 复用 collectArchiveFiles/buildComponents（含 arm、main 优先、TexSlot 全局化）。
func ParseComponentsFrom7z(data []byte, size int64) ([]types.BedrockModel, []string, error) {
	r, err := container.Open7zBytes(data, size)
	if err != nil {
		return nil, nil, err
	}
	defer r.Close()
	modelOrder, texOrder, geoFiles, _, _, _ := collectArchiveFiles(r.Entries())
	return buildComponents(geoFiles, modelOrder, texOrder)
}
