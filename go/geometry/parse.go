package geometry

import (
	"encoding/json"
	"log"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"ysm-model-manager/go/types"
)

const maxParseSize = 100 << 20 // 100MB

type rawGeometryFile struct {
	FormatVersion string `json:"format_version"`
	Geometry      []struct {
		Description struct {
			Identifier    string  `json:"identifier"`
			TextureWidth  float64 `json:"texture_width"`
			TextureHeight float64 `json:"texture_height"`
		} `json:"description"`
		Bones []struct {
			Name     string          `json:"name"`
			Parent   string          `json:"parent,omitempty"`
			Pivot    [3]float64      `json:"pivot"`
			Rotation json.RawMessage `json:"rotation,omitempty"`
			Inflate  float64         `json:"inflate,omitempty"`
			Mirror   bool            `json:"mirror,omitempty"`
			Cubes    []struct {
				Origin   [3]float64      `json:"origin"`
				Size     [3]float64      `json:"size"`
				Pivot    [3]float64      `json:"pivot,omitempty"`
				UV       json.RawMessage `json:"uv,omitempty"`
				Rotation json.RawMessage `json:"rotation,omitempty"`
				Inflate  *float64        `json:"inflate,omitempty"`
				Mirror   *bool           `json:"mirror,omitempty"`
			} `json:"cubes"`
		} `json:"bones"`
	} `json:"minecraft:geometry"`
}

// ParseBedrockGeometry parses Bedrock geometry JSON and returns the selected
// primary form. Other geometry entries remain available in model.Variants.
func ParseBedrockGeometry(data []byte) *types.BedrockModel {
	models := ParseBedrockGeometryVariants(data, "")
	if len(models) == 0 {
		return nil
	}
	return SelectPrimaryModel(models, nil)
}

// ParseBedrockGeometryVariants parses every geometry entry in a JSON file.
func ParseBedrockGeometryVariants(data []byte, source string) []types.BedrockModel {
	if len(data) > maxParseSize {
		log.Printf("[geometry] ParseBedrockGeometry input too large: %d bytes", len(data))
		return nil
	}

	var raw rawGeometryFile
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil
	}
	if len(raw.Geometry) == 0 {
		return nil
	}

	models := make([]types.BedrockModel, 0, len(raw.Geometry))
	for i, g := range raw.Geometry {
		if len(g.Bones) == 0 {
			continue
		}
		identifier := g.Description.Identifier
		name := variantName(source, identifier, i)
		model := types.BedrockModel{
			Name:       name,
			Identifier: identifier,
			Source:     source,
			Format:     raw.FormatVersion,
			TexWidth:   int(g.Description.TextureWidth),
			TexHeight:  int(g.Description.TextureHeight),
		}

		var cubeTotal int
		for _, b := range g.Bones {
			cubes := make([]types.Cube2D, 0, len(b.Cubes))
			for _, c := range b.Cubes {
				var uv [2]float64
				var faceUV string
				var rot [3]float64
				if len(c.UV) > 0 {
					uvStr := string(c.UV)
					if len(uvStr) > 0 && uvStr[0] == '{' {
						faceUV = uvStr
					} else if err := json.Unmarshal(c.UV, &uv); err != nil {
						log.Printf("[geometry] parse cube uv failed: %v", err)
					}
				}
				if len(c.Rotation) > 0 {
					if err := json.Unmarshal(c.Rotation, &rot); err != nil {
						log.Printf("[geometry] parse cube rotation failed: %v", err)
					}
				}
				inflate := b.Inflate
				if c.Inflate != nil {
					inflate = *c.Inflate
				}
				mirror := b.Mirror
				if c.Mirror != nil {
					mirror = *c.Mirror
				}
				cubes = append(cubes, types.Cube2D{
					Origin:   c.Origin,
					Size:     c.Size,
					Pivot:    c.Pivot,
					UV:       uv,
					FaceUV:   faceUV,
					Rotation: rot,
					Inflate:  inflate,
					Mirror:   mirror,
				})
			}

			var boneRot [3]float64
			if len(b.Rotation) > 0 {
				if err := json.Unmarshal(b.Rotation, &boneRot); err != nil {
					log.Printf("[geometry] parse bone rotation failed: %v", err)
				}
			}
			model.Bones = append(model.Bones, types.Bone2D{
				Name:     b.Name,
				Parent:   b.Parent,
				Pivot:    b.Pivot,
				Rotation: boneRot,
				Cubes:    cubes,
			})
			cubeTotal += len(cubes)
		}
		model.BoneCount = len(model.Bones)
		model.CubeCount = cubeTotal
		models = append(models, model)
	}
	return models
}

func SelectPrimaryModel(models []types.BedrockModel, preferred []string) *types.BedrockModel {
	if len(models) == 0 {
		return nil
	}
	best := 0
	bestScore := primaryScore(models[0], preferred)
	for i := 1; i < len(models); i++ {
		score := primaryScore(models[i], preferred)
		if score < bestScore {
			best = i
			bestScore = score
		}
	}

	selected := models[best]
	variants := make([]types.BedrockModelVariant, 0, len(models))
	variants = append(variants, types.VariantFromModel(models[best]))
	for i := range models {
		if i == best {
			continue
		}
		variants = append(variants, types.VariantFromModel(models[i]))
	}
	selected.Variants = variants
	selected.ActiveVariant = 0
	return &selected
}

func SortGeometryFilesByPreference(names []string, preferred []string) {
	if len(preferred) == 0 || len(names) < 2 {
		return
	}
	sort.SliceStable(names, func(i, j int) bool {
		return pathOrderScore(names[i], preferred) < pathOrderScore(names[j], preferred)
	})
}

func primaryScore(m types.BedrockModel, preferred []string) int {
	key := strings.ToLower(strings.Join([]string{m.Source, m.Identifier, m.Name}, " "))
	score := pathOrderScore(m.Source, preferred) * 100
	if strings.Contains(key, "main") {
		score -= 90
	}
	if strings.Contains(key, "default") || strings.Contains(key, "player") || strings.Contains(key, "body") {
		score -= 45
	}
	for _, bad := range []string{"arm", "hand", "item", "wing", "tail", "hair", "extra", "layer"} {
		if strings.Contains(key, bad) {
			score += 35
		}
	}
	if m.CubeCount <= 2 {
		score += 80
	}
	score -= minInt(m.CubeCount, 200) / 12
	return score
}

func pathOrderScore(path string, preferred []string) int {
	if len(preferred) == 0 {
		return 1000
	}
	norm := normalizePath(path)
	base := strings.ToLower(filepath.Base(norm))
	for i, p := range preferred {
		pp := normalizePath(p)
		pb := strings.ToLower(filepath.Base(pp))
		if norm == pp || base == pb || strings.HasSuffix(norm, "/"+pp) {
			return i
		}
	}
	return 1000
}

func normalizePath(path string) string {
	path = strings.ReplaceAll(path, "\\", "/")
	path = strings.TrimPrefix(path, "./")
	return strings.ToLower(path)
}

func variantName(source, identifier string, index int) string {
	if identifier != "" && !strings.EqualFold(identifier, "unknown") {
		parts := strings.Split(identifier, ".")
		return parts[len(parts)-1]
	}
	if source != "" {
		name := filepath.Base(strings.ReplaceAll(source, "\\", "/"))
		return strings.TrimSuffix(name, filepath.Ext(name))
	}
	return "model_" + strconv.Itoa(index+1)
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
