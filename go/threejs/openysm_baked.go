package threejs

import (
	"encoding/json"
	"math"
	"sort"
	"strconv"
	"strings"

	"ysm-model-manager/go/types"
)

type bakedUVFace struct {
	Uv      []float64       `json:"uv"`
	UvSize  []float64       `json:"uv_size"`
	Texture json.RawMessage `json:"texture"`
}

type bakedMeshBuilder struct {
	positions []float64
	normals   []float64
	uvs       []float64
	indices   []int
}

func buildOpenYSMBakedBoneMeshData(cubes []types.Cube2D, bonePivot vec3, texW, texH float64, boneID string) []MeshData {
	builders := make(map[int]*bakedMeshBuilder)
	for _, c := range cubes {
		appendOpenYSMCube(builders, c, bonePivot, texW, texH)
	}

	keys := make([]int, 0, len(builders))
	for texIdx, builder := range builders {
		if len(builder.positions) > 0 {
			keys = append(keys, texIdx)
		}
	}
	sort.Ints(keys)

	meshes := make([]MeshData, 0, len(keys))
	for _, texIdx := range keys {
		builder := builders[texIdx]
		renderMode := "cutout"
		if texIdx > 0 {
			renderMode = "overlay"
		}
		meshes = append(meshes, MeshData{
			ID:            boneID + "_baked_t" + strconv.Itoa(texIdx),
			BoneID:        boneID,
			TexIdx:        texIdx,
			RenderMode:    renderMode,
			LocalPosition: [3]float64{0, 0, 0},
			LocalRotation: [4]float64{0, 0, 0, 1},
			Positions:     builder.positions,
			Normals:       builder.normals,
			Uvs:           builder.uvs,
			Indices:       builder.indices,
		})
	}
	return meshes
}

func appendOpenYSMCube(builders map[int]*bakedMeshBuilder, c types.Cube2D, bonePivot vec3, texW, texH float64) {
	sx, sy, sz := c.Size[0], c.Size[1], c.Size[2]
	inflate := c.Inflate

	x := -c.Origin[0] - sx - inflate
	y := c.Origin[1] - inflate
	z := c.Origin[2] - inflate
	w := sx + inflate*2
	h := sy + inflate*2
	d := sz + inflate*2
	if w == 0 {
		w = thicknessEpsilon
	}
	if h == 0 {
		h = thicknessEpsilon
	}
	if d == 0 {
		d = thicknessEpsilon
	}

	x1, x2 := x, x+w
	y1, y2 := y, y+h
	z1, z2 := z, z+d
	p := [8]vec3{
		{x1, y1, z1},
		{x1, y1, z2},
		{x1, y2, z1},
		{x1, y2, z2},
		{x2, y1, z1},
		{x2, y1, z2},
		{x2, y2, z1},
		{x2, y2, z2},
	}

	uvByFace, texIdxByFace, okByFace := openYSMCubeUVs(c, texW, texH)
	faceDefs := []struct {
		name   string
		points [4]int
		normal vec3
	}{
		{"west", [4]int{3, 2, 0, 1}, vec3{-1, 0, 0}},
		{"east", [4]int{6, 7, 5, 4}, vec3{1, 0, 0}},
		{"north", [4]int{2, 6, 4, 0}, vec3{0, 0, -1}},
		{"south", [4]int{7, 3, 1, 5}, vec3{0, 0, 1}},
		{"up", [4]int{3, 7, 6, 2}, vec3{0, 1, 0}},
		{"down", [4]int{0, 4, 5, 1}, vec3{0, -1, 0}},
	}

	cubePivot := vec3{-c.Pivot[0], c.Pivot[1], c.Pivot[2]}
	hasRotation := c.Rotation[0] != 0 || c.Rotation[1] != 0 || c.Rotation[2] != 0
	for _, fd := range faceDefs {
		uv, ok := uvByFace[fd.name]
		if !ok && c.FaceUV != "" {
			continue
		}
		if !okByFace[fd.name] && c.FaceUV != "" {
			continue
		}

		texIdx := texIdxByFace[fd.name]
		builder := builders[texIdx]
		if builder == nil {
			builder = &bakedMeshBuilder{}
			builders[texIdx] = builder
		}

		base := len(builder.positions) / 3
		for _, pi := range fd.points {
			v := p[pi]
			if hasRotation {
				v = rotateOpenYSMPoint(v, cubePivot, c.Rotation)
			}
			builder.positions = append(builder.positions, v.x-bonePivot.x, v.y-bonePivot.y, v.z-bonePivot.z)
		}

		n := fd.normal
		if hasRotation {
			n = normalizeVec3(rotateOpenYSMNormal(n, c.Rotation))
		}
		for i := 0; i < 4; i++ {
			builder.normals = append(builder.normals, n.x, n.y, n.z)
		}

		builder.uvs = append(builder.uvs, uv[0], uv[1], uv[2], uv[3], uv[4], uv[5], uv[6], uv[7])
		builder.indices = append(builder.indices, base, base+2, base+1, base+2, base+3, base+1)
	}
}

func openYSMCubeUVs(c types.Cube2D, texW, texH float64) (map[string][8]float64, map[string]int, map[string]bool) {
	result := make(map[string][8]float64, 6)
	texIdx := make(map[string]int, 6)
	ok := make(map[string]bool, 6)
	if texW == 0 {
		texW = 64
	}
	if texH == 0 {
		texH = 64
	}

	if c.FaceUV != "" {
		var faces map[string]bakedUVFace
		if err := json.Unmarshal([]byte(c.FaceUV), &faces); err != nil {
			return result, texIdx, ok
		}
		addOpenYSMFaceUV(result, texIdx, ok, faces, "north", "north", c.Mirror, texW, texH)
		addOpenYSMFaceUV(result, texIdx, ok, faces, "south", "south", c.Mirror, texW, texH)
		if c.Mirror {
			addOpenYSMFaceUV(result, texIdx, ok, faces, "east", "west", c.Mirror, texW, texH)
			addOpenYSMFaceUV(result, texIdx, ok, faces, "west", "east", c.Mirror, texW, texH)
		} else {
			addOpenYSMFaceUV(result, texIdx, ok, faces, "east", "east", c.Mirror, texW, texH)
			addOpenYSMFaceUV(result, texIdx, ok, faces, "west", "west", c.Mirror, texW, texH)
		}
		addOpenYSMFaceUV(result, texIdx, ok, faces, "up", "up", c.Mirror, texW, texH)
		addOpenYSMFaceUV(result, texIdx, ok, faces, "down", "down", c.Mirror, texW, texH)
		return result, texIdx, ok
	}

	u, v := c.UV[0], c.UV[1]
	dx := math.Floor(c.Size[0])
	dy := math.Floor(c.Size[1])
	dz := math.Floor(c.Size[2])
	faces := map[string]bakedUVFace{
		"north": {Uv: []float64{u + dz, v + dz}, UvSize: []float64{dx, dy}},
		"south": {Uv: []float64{u + dz + dx + dz, v + dz}, UvSize: []float64{dx, dy}},
		"east":  {Uv: []float64{u, v + dz}, UvSize: []float64{dz, dy}},
		"west":  {Uv: []float64{u + dz + dx, v + dz}, UvSize: []float64{dz, dy}},
		"up":    {Uv: []float64{u + dz, v}, UvSize: []float64{dx, dz}},
		"down":  {Uv: []float64{u + dz + dx, v + dz}, UvSize: []float64{dx, -dz}},
	}
	addOpenYSMFaceUV(result, texIdx, ok, faces, "north", "north", c.Mirror, texW, texH)
	addOpenYSMFaceUV(result, texIdx, ok, faces, "south", "south", c.Mirror, texW, texH)
	if c.Mirror {
		addOpenYSMFaceUV(result, texIdx, ok, faces, "east", "west", c.Mirror, texW, texH)
		addOpenYSMFaceUV(result, texIdx, ok, faces, "west", "east", c.Mirror, texW, texH)
	} else {
		addOpenYSMFaceUV(result, texIdx, ok, faces, "east", "east", c.Mirror, texW, texH)
		addOpenYSMFaceUV(result, texIdx, ok, faces, "west", "west", c.Mirror, texW, texH)
	}
	addOpenYSMFaceUV(result, texIdx, ok, faces, "up", "up", c.Mirror, texW, texH)
	addOpenYSMFaceUV(result, texIdx, ok, faces, "down", "down", c.Mirror, texW, texH)
	return result, texIdx, ok
}

func addOpenYSMFaceUV(out map[string][8]float64, texIdx map[string]int, ok map[string]bool, faces map[string]bakedUVFace, faceType, uvFaceName string, mirror bool, texW, texH float64) {
	fd, exists := faces[uvFaceName]
	if !exists || len(fd.Uv) < 2 || len(fd.UvSize) < 2 {
		return
	}
	u0 := fd.Uv[0] / texW
	v0 := fd.Uv[1] / texH
	u1 := (fd.Uv[0] + fd.UvSize[0]) / texW
	v1 := (fd.Uv[1] + fd.UvSize[1]) / texH
	if !mirror {
		u0, u1 = u1, u0
	}
	out[faceType] = [8]float64{u0, v0, u1, v0, u1, v1, u0, v1}
	texIdx[faceType] = parseOpenYSMTextureIndex(fd.Texture)
	ok[faceType] = true
}

func parseOpenYSMTextureIndex(raw json.RawMessage) int {
	if len(raw) == 0 {
		return 0
	}
	var num int
	if err := json.Unmarshal(raw, &num); err == nil {
		return num
	}
	var text string
	if err := json.Unmarshal(raw, &text); err == nil {
		text = strings.TrimSpace(text)
		text = strings.TrimPrefix(text, "#")
		if n, err := strconv.Atoi(text); err == nil {
			return n
		}
	}
	return 0
}

func rotateOpenYSMPoint(p, pivot vec3, rot [3]float64) vec3 {
	v := vec3{p.x - pivot.x, p.y - pivot.y, p.z - pivot.z}
	v = rotateXYZ(v, -rot[0]*math.Pi/180, -rot[1]*math.Pi/180, rot[2]*math.Pi/180)
	return vec3{v.x + pivot.x, v.y + pivot.y, v.z + pivot.z}
}

func rotateOpenYSMNormal(n vec3, rot [3]float64) vec3 {
	return rotateXYZ(n, -rot[0]*math.Pi/180, -rot[1]*math.Pi/180, rot[2]*math.Pi/180)
}

func rotateXYZ(v vec3, rx, ry, rz float64) vec3 {
	if rx != 0 {
		c, s := math.Cos(rx), math.Sin(rx)
		v = vec3{v.x, v.y*c - v.z*s, v.y*s + v.z*c}
	}
	if ry != 0 {
		c, s := math.Cos(ry), math.Sin(ry)
		v = vec3{v.x*c + v.z*s, v.y, -v.x*s + v.z*c}
	}
	if rz != 0 {
		c, s := math.Cos(rz), math.Sin(rz)
		v = vec3{v.x*c - v.y*s, v.x*s + v.y*c, v.z}
	}
	return v
}

func normalizeVec3(v vec3) vec3 {
	l := math.Sqrt(v.x*v.x + v.y*v.y + v.z*v.z)
	if l == 0 {
		return v
	}
	return vec3{v.x / l, v.y / l, v.z / l}
}
