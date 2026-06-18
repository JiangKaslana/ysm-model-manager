package types

// BedrockModel is the geometry payload used by the 2D and 3D previews.
// Bones always describe the currently selected form. Additional switchable
// forms are kept in Variants so previews do not render every form at once.
type BedrockModel struct {
	Name          string                `json:"name,omitempty"`
	Identifier    string                `json:"identifier,omitempty"`
	Source        string                `json:"source,omitempty"`
	TexIndex      int                   `json:"texIndex,omitempty"`
	ActiveVariant int                   `json:"activeVariant,omitempty"`
	BoneCount     int                   `json:"boneCount"`
	CubeCount     int                   `json:"cubeCount"`
	Texture       string                `json:"texture,omitempty"`
	Textures      []string              `json:"textures,omitempty"`
	Format        string                `json:"format,omitempty"`
	TexWidth      int                   `json:"texWidth,omitempty"`
	TexHeight     int                   `json:"texHeight,omitempty"`
	Bones         []Bone2D              `json:"bones,omitempty"`
	Variants      []BedrockModelVariant `json:"variants,omitempty"`
	Animations    []string              `json:"animations,omitempty"`
}

// BedrockModelVariant represents one switchable model/form inside a YSM pack.
// Textures and animations stay on BedrockModel and are shared by all variants.
type BedrockModelVariant struct {
	Name       string   `json:"name,omitempty"`
	Identifier string   `json:"identifier,omitempty"`
	Source     string   `json:"source,omitempty"`
	TexIndex   int      `json:"texIndex,omitempty"`
	BoneCount  int      `json:"boneCount"`
	CubeCount  int      `json:"cubeCount"`
	TexWidth   int      `json:"texWidth,omitempty"`
	TexHeight  int      `json:"texHeight,omitempty"`
	Bones      []Bone2D `json:"bones,omitempty"`
}

func VariantFromModel(m BedrockModel) BedrockModelVariant {
	return BedrockModelVariant{
		Name:       m.Name,
		Identifier: m.Identifier,
		Source:     m.Source,
		TexIndex:   m.TexIndex,
		BoneCount:  m.BoneCount,
		CubeCount:  m.CubeCount,
		TexWidth:   m.TexWidth,
		TexHeight:  m.TexHeight,
		Bones:      m.Bones,
	}
}

func ApplyVariant(m BedrockModel, index int) BedrockModel {
	if len(m.Variants) == 0 {
		return m
	}
	if index < 0 || index >= len(m.Variants) {
		index = m.ActiveVariant
	}
	if index < 0 || index >= len(m.Variants) {
		index = 0
	}
	v := m.Variants[index]
	m.Name = v.Name
	m.Identifier = v.Identifier
	m.Source = v.Source
	m.TexIndex = v.TexIndex
	m.BoneCount = v.BoneCount
	m.CubeCount = v.CubeCount
	m.TexWidth = v.TexWidth
	m.TexHeight = v.TexHeight
	m.Bones = v.Bones
	m.ActiveVariant = index
	return m
}

type Bone2D struct {
	Name     string     `json:"name"`
	Parent   string     `json:"parent,omitempty"`
	Pivot    [3]float64 `json:"pivot,omitempty"`
	Rotation [3]float64 `json:"rotation,omitempty"`
	Cubes    []Cube2D   `json:"cubes"`
}

type Cube2D struct {
	Origin   [3]float64 `json:"origin"`
	Size     [3]float64 `json:"size"`
	Pivot    [3]float64 `json:"pivot,omitempty"`
	UV       [2]float64 `json:"uv,omitempty"`
	FaceUV   string     `json:"faceUV,omitempty"`
	Rotation [3]float64 `json:"rotation,omitempty"`
	Inflate  float64    `json:"inflate,omitempty"`
	Mirror   bool       `json:"mirror,omitempty"`
}
