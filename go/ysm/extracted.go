package ysm

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/geometry"
	"ysm-model-manager/go/types"
)

// FindGeometryInExtractedYSM reads a plain, extracted YSM directory when the
// user explicitly selects its ysm.json. Folders themselves are still handled as
// lightweight pack entries by the UI and never preview-rendered automatically.
func FindGeometryInExtractedYSM(ysmJsonPath string) (*types.BedrockModel, [][]byte) {
	data, err := os.ReadFile(ysmJsonPath)
	if err != nil {
		return nil, nil
	}

	dir := filepath.Dir(ysmJsonPath)
	modelNames, preferred := readPlayerModelOrder(data)
	var variants []types.BedrockModel

	// Some loose JSON files are geometry files themselves.
	variants = append(variants, geometry.ParseBedrockGeometryVariants(data, ysmJsonPath)...)
	variants = append(variants, parseLegacyMinecraftGeometry(data, ysmJsonPath)...)

	// YSM metadata usually points at models/*.json. Collect every referenced
	// model as a switchable form instead of merging all bones.
	seen := make(map[string]bool)
	for modelIndex, name := range modelNames {
		for _, sub := range []string{"", "models", "model"} {
			candidate := filepath.Join(dir, sub, name)
			if seen[candidate] {
				continue
			}
			seen[candidate] = true
			if data, ok := readExistingFile(candidate); ok {
				for _, m := range geometry.ParseBedrockGeometryVariants(data, candidate) {
					m.TexIndex = modelIndex
					variants = append(variants, m)
				}
				for _, m := range parseLegacyMinecraftGeometry(data, candidate) {
					m.TexIndex = modelIndex
					variants = append(variants, m)
				}
			}
		}
	}

	// If ysm.json does not list models, scan the extracted directory lightly.
	if len(variants) == 0 {
		excludeDirs := map[string]bool{"animations": true, "animation": true, "controller": true, "controllers": true, "avatar": true, "textures": true}
		filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
			if err != nil {
				log.Printf("[ysm] walk extracted dir ignored: %v", err)
				return nil
			}
			if d.IsDir() {
				if excludeDirs[strings.ToLower(d.Name())] {
					return filepath.SkipDir
				}
				rel, relErr := filepath.Rel(dir, path)
				if relErr == nil && strings.Count(rel, string(filepath.Separator)) > 10 {
					return filepath.SkipDir
				}
				return nil
			}
			if strings.EqualFold(path, ysmJsonPath) || !strings.HasSuffix(strings.ToLower(path), ".json") {
				return nil
			}
			if data, ok := readExistingFile(path); ok {
				variants = append(variants, geometry.ParseBedrockGeometryVariants(data, path)...)
				variants = append(variants, parseLegacyMinecraftGeometry(data, path)...)
			}
			return nil
		})
	}

	model := geometry.SelectPrimaryModel(variants, preferred)
	if model == nil {
		wrapped := append([]byte(`{"format_version":"1.12.0","minecraft:geometry":[`), data...)
		wrapped = append(wrapped, ']', '}')
		model = geometry.ParseBedrockGeometry(wrapped)
	}

	return model, collectExtractedTextures(dir)
}

func readPlayerModelOrder(data []byte) ([]string, []string) {
	var root struct {
		Files map[string]struct {
			Model json.RawMessage `json:"model"`
		} `json:"files"`
	}
	if err := json.Unmarshal(data, &root); err != nil {
		return nil, nil
	}

	var names []string
	var preferred []string
	addName := func(v string) {
		v = strings.TrimSpace(v)
		if v == "" {
			return
		}
		names = append(names, v)
		preferred = append(preferred, v)
	}

	for _, player := range root.Files {
		if len(player.Model) == 0 {
			continue
		}
		trimmed := strings.TrimSpace(string(player.Model))
		switch {
		case strings.HasPrefix(trimmed, "{"):
			var mapped map[string]string
			if json.Unmarshal(player.Model, &mapped) == nil {
				if mainPath := mapped["main"]; mainPath != "" {
					addName(mainPath)
				}
			}
		case strings.HasPrefix(trimmed, "["):
			var arr []string
			if json.Unmarshal(player.Model, &arr) == nil {
				for _, value := range arr {
					addName(value)
				}
			}
		default:
			addName(strings.Trim(trimmed, `"`))
		}
	}
	return names, preferred
}

func parseLegacyMinecraftGeometry(data []byte, source string) []types.BedrockModel {
	var root struct {
		Minecraft struct {
			Geometry []json.RawMessage `json:"geometry"`
		} `json:"minecraft"`
	}
	if err := json.Unmarshal(data, &root); err != nil || len(root.Minecraft.Geometry) == 0 {
		return nil
	}
	var out []types.BedrockModel
	for _, raw := range root.Minecraft.Geometry {
		wrapped := append([]byte(`{"format_version":"1.12.0","minecraft:geometry":[`), raw...)
		wrapped = append(wrapped, ']', '}')
		out = append(out, geometry.ParseBedrockGeometryVariants(wrapped, source)...)
	}
	return out
}

func readExistingFile(path string) ([]byte, bool) {
	if info, err := os.Stat(path); err != nil || info.IsDir() {
		return nil, false
	}
	data, err := os.ReadFile(path)
	return data, err == nil
}

func collectExtractedTextures(dir string) [][]byte {
	var texData [][]byte
	texDir := filepath.Join(dir, "textures")
	if d, err := os.Stat(texDir); err == nil && d.IsDir() {
		filepath.WalkDir(texDir, func(path string, d os.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return nil
			}
			ext := strings.ToLower(filepath.Ext(d.Name()))
			if ext == ".png" || ext == ".jpg" || ext == ".jpeg" || ext == ".tga" {
				if texBytes, readErr := os.ReadFile(path); readErr == nil {
					texData = append(texData, texBytes)
				}
			}
			return nil
		})
	}
	if len(texData) > 0 {
		return texData
	}
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		ext := strings.ToLower(filepath.Ext(e.Name()))
		if ext == ".png" || ext == ".jpg" || ext == ".jpeg" {
			if texBytes, readErr := os.ReadFile(filepath.Join(dir, e.Name())); readErr == nil {
				texData = append(texData, texBytes)
			}
		}
	}
	return texData
}
