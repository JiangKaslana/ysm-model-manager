// ========== YSM 模型解析 ==========
// 从 app.go 拆分：模型文件分析、几何体解析、CLI fallback
package main

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"

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
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	return data
}

func (a *App) ListOpenYsmFunctionFiles(modelPath string) []string {
	modelPath = strings.TrimSpace(modelPath)
	if modelPath == "" {
		return nil
	}
	baseDir := modelPath
	if info, err := os.Stat(modelPath); err != nil || !info.IsDir() {
		baseDir = filepath.Dir(modelPath)
	}
	functionsDir := filepath.Join(baseDir, "functions")
	info, err := os.Stat(functionsDir)
	if err != nil || !info.IsDir() {
		return nil
	}

	out := make([]string, 0, 16)
	filepath.WalkDir(functionsDir, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		if strings.EqualFold(filepath.Ext(path), ".molang") {
			out = append(out, path)
			if len(out) >= 256 {
				return filepath.SkipAll
			}
		}
		return nil
	})
	return out
}

func (a *App) AnalyzeBedrockModel(modelPath string) types.BedrockModel {
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
	model := a.AnalyzeBedrockModel(modelPath)
	spec, err := threejs.Build(model)
	if err != nil {
		return "{}"
	}
	return spec
}

func (a *App) GetModel3DSpecVariant(modelPath string, variantIndex int) string {
	model := types.ApplyVariant(a.AnalyzeBedrockModel(modelPath), variantIndex)
	spec, err := threejs.Build(model)
	if err != nil {
		return "{}"
	}
	return spec
}

func (a *App) BuildModel3DSpecFromModel(model types.BedrockModel) string {
	spec, err := threejs.Build(model)
	if err != nil {
		return "{}"
	}
	return spec
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

	cmd := exec.Command(parserPath, "-i", inDir, "-o", outDir)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	if err := cmd.Run(); err != nil {
		return types.BedrockModel{}
	}

	modelOrder := readParsedYSMModelOrder(outDir)
	var variants []types.BedrockModel
	filepath.WalkDir(outDir, func(p string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(strings.ToLower(p), ".json") {
			return nil
		}
		if strings.HasSuffix(p, "ysm.json") {
			return nil
		}
		if len(modelOrder) > 0 && parserPathOrderScore(p, modelOrder) < 0 {
			return nil
		}
		data, rErr := os.ReadFile(p)
		if rErr != nil {
			return nil
		}
		for _, g := range geometry.ParseBedrockGeometryVariants(data, p) {
			if g.BoneCount > 0 {
				if texIndex := parserPathOrderScore(p, modelOrder); texIndex >= 0 {
					g.TexIndex = texIndex
				}
				variants = append(variants, g)
			}
		}
		return nil
	})
	merged := geometry.SelectPrimaryModel(variants, modelOrder)
	if merged == nil {
		return types.BedrockModel{}
	}

	var textures []string
	var animations []string
	filepath.WalkDir(outDir, func(p string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		low := strings.ToLower(p)
		if strings.HasSuffix(low, ".png") || strings.HasSuffix(low, ".jpg") {
			if strings.Contains(strings.ReplaceAll(low, "\\", "/"), "/avatar/") {
				return nil
			}
			if data, rErr := os.ReadFile(p); rErr == nil && len(data) > 0 {
				mime := "image/png"
				if strings.HasSuffix(low, ".jpg") {
					mime = "image/jpeg"
				}
				textures = append(textures, "data:"+mime+";base64,"+base64.StdEncoding.EncodeToString(data))
			}
			return nil
		}
		if strings.HasSuffix(low, ".json") && strings.Contains(low, "animation") {
			if data, rErr := os.ReadFile(p); rErr == nil && len(data) > 0 {
				animations = append(animations, string(data))
			}
		}
		return nil
	})
	if len(textures) > 0 {
		merged.Texture = textures[0]
		merged.Textures = textures
	}
	if len(animations) > 0 {
		merged.Animations = animations
	}
	return *merged
}

func readParsedYSMModelOrder(outDir string) []string {
	var order []string
	filepath.WalkDir(outDir, func(p string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.EqualFold(filepath.Base(p), "ysm.json") {
			return nil
		}
		data, rErr := os.ReadFile(p)
		if rErr != nil {
			return nil
		}
		var root struct {
			Files map[string]struct {
				Model any `json:"model"`
			} `json:"files"`
		}
		if jsonErr := json.Unmarshal(data, &root); jsonErr != nil {
			return nil
		}
		add := func(v string) {
			v = strings.TrimSpace(v)
			if v != "" {
				order = append(order, v)
			}
		}
		for _, player := range root.Files {
			switch model := player.Model.(type) {
			case string:
				add(model)
			case []any:
				for _, item := range model {
					if s, ok := item.(string); ok {
						add(s)
					}
				}
			case map[string]any:
				if s, ok := model["main"].(string); ok {
					add(s)
				}
			}
		}
		return filepath.SkipAll
	})
	return order
}

func parserPathOrderScore(path string, order []string) int {
	if len(order) == 0 {
		return -1
	}
	norm := strings.ToLower(strings.ReplaceAll(path, "\\", "/"))
	base := strings.ToLower(filepath.Base(norm))
	for i, p := range order {
		pp := strings.ToLower(strings.ReplaceAll(p, "\\", "/"))
		pb := strings.ToLower(filepath.Base(pp))
		if norm == pp || base == pb || strings.HasSuffix(norm, "/"+pp) {
			return i
		}
	}
	return -1
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
