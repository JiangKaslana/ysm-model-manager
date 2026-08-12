// ========== YSM 模型解析 ==========
// 从 app.go 拆分：模型文件分析、几何体解析、CLI fallback
package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"ysm-model-manager/go/executil"
	"ysm-model-manager/go/geometry"
	"ysm-model-manager/go/threejs"
	"ysm-model-manager/go/types"
	"ysm-model-manager/go/ysm"
)

func (a *App) AnalyzeYSMModel(path string) ysm.YSMModelMeta {
	return ysm.AnalyzeYSMModel(path)
}

func (a *App) ExtractYsmSummary(path string) ysm.YsmSummary {
	summary, err := ysm.ExtractYsmSummary(path)
	if err != nil {
		// 解析失败不再完全静默——记录日志便于诊断。
		// 绑定签名保持单返回值（不破坏前端契约），前端 detail.ts 有 hasRealSummary 兜底 toast
		log.Printf("[ysm] ExtractYsmSummary 解析失败 %s: %v", path, err)
		summary = ysm.YsmSummary{
			Schema: "ysm-summary/v1",
			Source: filepath.Base(path),
		}
	}
	return summary
}

func (a *App) ExtractYSMHeader(path string) ysm.YSMHeader {
	return ysm.AnalyzeYSMHeader(path)
}

func (a *App) ExtractYSMHeaderFromBase64(base64Data string) ysm.YSMHeader {
	data, err := base64.StdEncoding.DecodeString(base64Data)
	if err != nil {
		return ysm.YSMHeader{}
	}
	return ysm.AnalyzeYSMHeaderFromBytes(data)
}

func (a *App) SavePreviewTempFile(base64Data string) (string, error) {
	data, err := base64.StdEncoding.DecodeString(base64Data)
	if err != nil {
		return "", err
	}
	tmpDir := filepath.Join(os.TempDir(), "ysm-preview")
	os.MkdirAll(tmpDir, 0755)
	tmpFile, err := os.CreateTemp(tmpDir, "preview-*.ysm")
	if err != nil {
		return "", err
	}
	defer tmpFile.Close()
	_, err = tmpFile.Write(data)
	if err != nil {
		return "", err
	}
	return tmpFile.Name(), nil
}

func (a *App) ReadFileBytes(path string) []byte {
	// 路径守卫：限制在 FilesRoot 内，防止读取系统任意文件。
	// 技术债 #5：改用 isPathInRoot 统一口径（rel=="." 拒绝 + 精确段比较）——
	// 原内联 Rel 裸 HasPrefix(rel,"..") 对 rel=="." 放行（可读仓库根本身）、..foo 误拒
	if !a.isPathInRoot(path) {
		return nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	return data
}

func (a *App) AnalyzeBedrockModel(modelPath string) types.BedrockModel {
	// 剥禁用后缀（.ban/.disabled），与 scanner 口径一致
	for _, suffix := range []string{".ban", ".disabled"} {
		if strings.HasSuffix(strings.ToLower(modelPath), suffix) {
			modelPath = modelPath[:len(modelPath)-len(suffix)]
			break
		}
	}
	ext := strings.ToLower(filepath.Ext(modelPath))
	if ext == ".ysm" {
		return a.runYSMParserOnFile(modelPath)
	}
	data, err := os.ReadFile(modelPath)
	if err != nil {
		return types.BedrockModel{}
	}
	var geoJSON *types.BedrockModel
	var texData [][]byte
	var animJSONs []string

	if ext == ".zip" {
		geoJSON, texData, animJSONs = parseBedrockFromZip(data, int64(len(data)))
	} else if ext == ".7z" {
		geoJSON, texData = parseBedrockFrom7z(data, int64(len(data)))
	} else if ext == ".json" {
		geoJSON, texData = ysm.FindGeometryInExtractedYSM(modelPath)
	}

	if geoJSON == nil && (ext == ".zip" || ext == ".7z") {
		g := a.runYSMParserOnFile(modelPath)
		geoJSON = &g
	}
	if geoJSON == nil {
		return types.BedrockModel{}
	}

	var textures []string
	for _, td := range texData {
		if len(td) > 0 {
			textures = append(textures, "data:image/png;base64,"+base64.StdEncoding.EncodeToString(td))
		}
	}
	if len(textures) > 0 {
		geoJSON.Texture = textures[0]
		geoJSON.Textures = textures
	}
	if len(animJSONs) > 0 {
		geoJSON.Animations = animJSONs
	}
	return *geoJSON
}

func (a *App) GetModel3DSpec(modelPath string) string {
	// 剥禁用后缀（.ban/.disabled），与 scanner 口径一致
	for _, suffix := range []string{".ban", ".disabled"} {
		if strings.HasSuffix(strings.ToLower(modelPath), suffix) {
			modelPath = modelPath[:len(modelPath)-len(suffix)]
			break
		}
	}
	// 多组件路径（YSMViewer 式）：.ysm（WASM 解码）/ .zip / 解压目录 ysm.json
	// 各自组件独立构建，合并 spec.models；纹理 texIdx 由解析层全局化（组件 i → i），
	// 前端 texArr 全局数组按序索引。
	ext := strings.ToLower(filepath.Ext(modelPath))
	if comps, texNames := a.collect3DComponents(modelPath, ext); len(comps) > 0 {
		spec, err := threejs.BuildMulti(comps, nil)
		if err == nil && spec != "{}" {
			// R1 契约：注入组件序纹理名（texArrOrder），前端比对 texArr 序防止贴错纹理
			if len(texNames) > 0 {
				spec = injectTexArrOrder(spec, texNames)
			}
			return spec
		}
	}
	// 单组件兜底（.7z 或多组件失败时）
	model := a.AnalyzeBedrockModel(modelPath)
	spec, err := threejs.Build(model)
	if err != nil {
		return "{}"
	}
	return spec
}

// Build3DSpecFromGeometryJSON 从 bedrock geometry JSON 构建 3D spec（纯 Go，无 Node 依赖）。
// 用途：Android 上 Go 端无 .ysm 解码通道（Node WASM 不可用，runYSMNodeJSDecode 恒 nil）时，
// 前端用 WebView 内 WASM 解码 .ysm 拿到 geometry JSON，再调本函数构建 spec——
// 复用 threejs.BuildMulti 全量顶点算法（ADR-004：Go 绑定为唯一事实来源），桌面端主路径不变。
// 返回 "{}" 表示不可用（前端据此决定是否报错/提示）。
func (a *App) Build3DSpecFromGeometryJSON(geometryJSON string) string {
	if geometryJSON == "" {
		return "{}"
	}
	model := geometry.ParseBedrockGeometry([]byte(geometryJSON))
	if model == nil || len(model.Bones) == 0 {
		return "{}"
	}
	spec, err := threejs.BuildMulti([]types.BedrockModel{*model}, nil)
	if err != nil || spec == "{}" {
		return "{}"
	}
	return spec
}

// injectTexArrOrder 在 spec JSON 中注入 texArrOrder（组件序纹理名数组，R1 契约）。
// 前端拿到后与 model.textureNames（texArr 实际序）比对，不一致即纹理错位预警。
func injectTexArrOrder(spec string, texNames []string) string {
	var m map[string]any
	if err := json.Unmarshal([]byte(spec), &m); err != nil {
		return spec
	}
	m["texArrOrder"] = texNames
	b, err := json.Marshal(m)
	if err != nil {
		return spec
	}
	return string(b)
}

// collect3DComponents 收集多组件列表（含 arm/载具等独立组件，不合并 bones）。
// 返回 (组件列表, 组件序纹理名数组)——后者仅 zip/解压目录路径有（R1 契约）；
// .ysm WASM 路径无 ysm.json texture 声明，返回 nil（前端跳过比对）。
func (a *App) collect3DComponents(modelPath, ext string) ([]types.BedrockModel, []string) {
	switch ext {
	case ".ysm":
		if data, err := os.ReadFile(modelPath); err == nil {
			return decodeYSMComponentsViaNodeJS(data)
		}
	case ".zip":
		if data, err := os.ReadFile(modelPath); err == nil {
			if comps, tn, cerr := geometry.ParseComponentsFromZip(data, int64(len(data))); cerr == nil {
				return comps, tn
			}
		}
	case ".7z":
		if data, err := os.ReadFile(modelPath); err == nil {
			if comps, tn, cerr := geometry.ParseComponentsFrom7z(data, int64(len(data))); cerr == nil {
				return comps, tn
			}
		}
	case ".json":
		// 解压目录的 ysm.json 路径
		if strings.HasSuffix(strings.ToLower(modelPath), "ysm.json") {
			return ysm.FindComponentsInExtractedYSM(modelPath)
		}
	}
	return nil, nil
}

// SaveScreenshotFile 保存 base64 PNG 到磁盘（供 JS 批量截图用）
// 路径守卫：限制在 os.TempDir()/ysm-preview 内，禁止绝对路径与路径穿越（.. 段）
func (a *App) SaveScreenshotFile(filename string, base64Data string) error {
	clean := filepath.Clean(filename)
	// 用 filepath.Base 比对：合法纯文件名 Clean 后等于自身；含目录/穿越段会被拒绝。
	// 不能用 strings.Contains(clean, "..") —— 会误杀 my..file.png 这类合法文件名
	if filepath.IsAbs(clean) || filepath.Base(clean) != clean {
		return fmt.Errorf("文件名不能包含路径")
	}
	tmpDir := filepath.Join(os.TempDir(), "ysm-preview")
	if err := os.MkdirAll(tmpDir, 0755); err != nil {
		return err
	}
	dest := filepath.Join(tmpDir, clean)
	data, err := base64.StdEncoding.DecodeString(base64Data)
	if err != nil {
		return err
	}
	return os.WriteFile(dest, data, 0644)
}

func (a *App) runYSMParserOnFile(modelPath string) types.BedrockModel {
	parserPath := ysm.FindCLI()
	if parserPath == "" {
		if data, err := os.ReadFile(modelPath); err == nil {
			if m := decodeYSMViaNodeJS(data); m != nil {
				return *m
			}
		}
		return types.BedrockModel{}
	}

	tmpDir, err := os.MkdirTemp("", "ysm-parser-*")
	if err != nil {
		return types.BedrockModel{}
	}
	defer os.RemoveAll(tmpDir)

	inDir := filepath.Join(tmpDir, "input")
	outDir := filepath.Join(tmpDir, "output")
	os.MkdirAll(inDir, 0755)
	os.MkdirAll(outDir, 0755)

	ysmCopy := filepath.Join(inDir, filepath.Base(modelPath))
	if err := copyFile(modelPath, ysmCopy); err != nil {
		return types.BedrockModel{}
	}

	// 超时护栏：YSMParser 若挂起则 goroutine 永久阻塞，故加 30s 硬上限（对齐 fileops.extractTextureViaYSM 既有修复）
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, parserPath, "-i", inDir, "-o", outDir)
	executil.HideWindow(cmd)
	if err := cmd.Run(); err != nil {
		return types.BedrockModel{}
	}

	var merged *types.BedrockModel
	filepath.WalkDir(outDir, func(p string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(strings.ToLower(p), ".json") {
			return nil
		}
		if strings.HasSuffix(p, "ysm.json") {
			return nil
		}
		data, rErr := os.ReadFile(p)
		if rErr != nil {
			return nil
		}
		if g := parseBedrockGeometry(data); g != nil {
			for bi := range g.Bones {
				for ci := range g.Bones[bi].Cubes {
					g.Bones[bi].Cubes[ci].CubeTexW = g.TexWidth
					g.Bones[bi].Cubes[ci].CubeTexH = g.TexHeight
				}
			}
			if merged == nil {
				merged = g
			} else {
				merged.Bones = append(merged.Bones, g.Bones...)
				merged.BoneCount += g.BoneCount
				merged.CubeCount += g.CubeCount
				if g.TexWidth > merged.TexWidth {
					merged.TexWidth = g.TexWidth
				}
				if g.TexHeight > merged.TexHeight {
					merged.TexHeight = g.TexHeight
				}
			}
		}
		return nil
	})
	if merged == nil {
		return types.BedrockModel{}
	}

	// 收集全部纹理（Textures 数组 + 名字，供多纹理/3D texArr；Texture 取第一张兼容单纹理）
	var texItems []ysmTexItem
	filepath.WalkDir(outDir, func(p string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		low := strings.ToLower(p)
		if strings.HasSuffix(low, ".png") || strings.HasSuffix(low, ".jpg") {
			// 排除头像/预览图（与 wasm_decoder.go / 前端 wasm.ts 口径一致）；
			// 不过滤 <4KB 小图——64×64 真实纹理（如芙宁娜 arrow.png ~2KB）是合法贴图
			if strings.HasPrefix(filepath.Base(low), "avatar") || strings.Contains(low, "avatar/") {
				return nil
			}
			if data, rErr := os.ReadFile(p); rErr == nil && len(data) > 0 {
				mime := "image/png"
				if strings.HasSuffix(low, ".jpg") {
					mime = "image/jpeg"
				}
				tn := filepath.Base(p)
				tn = strings.TrimSuffix(strings.TrimSuffix(tn, ".png"), ".jpg")
				texItems = append(texItems, ysmTexItem{name: tn, raw: data, mime: mime})
			}
		}
		return nil
	})
	if len(texItems) > 0 {
		// 纹理序口径统一（texture_order.go）：有 ysm.json 声明序 → 声明序 + default_texture 置首；
		// 无（加密模型等 ysm.json 不可解）→ 纹理尺寸降序（主纹理通常最大）。与前端 wasm.ts 对称。
		var ysmJSON []byte
		if d, err := os.ReadFile(filepath.Join(outDir, "ysm.json")); err == nil {
			ysmJSON = d
		}
		names, datas := orderTexItems(texItems, ysmJSON)
		if len(datas) == 0 {
			return *merged
		}
		merged.Texture = datas[0]
		merged.Textures = datas
		merged.TextureNames = names
	}
	return *merged
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}

func parseBedrockFromZip(data []byte, size int64) (*types.BedrockModel, [][]byte, []string) {
	return geometry.ParseFromZip(data, size)
}

func parseBedrockFrom7z(data []byte, size int64) (*types.BedrockModel, [][]byte) {
	return geometry.ParseFrom7z(data, size)
}

func parseBedrockGeometry(data []byte) *types.BedrockModel {
	return geometry.ParseBedrockGeometry(data)
}
