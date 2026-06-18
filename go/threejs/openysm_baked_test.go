package threejs

import (
	"encoding/json"
	"testing"

	"ysm-model-manager/go/types"
)

func TestBuildUsesOneBakedMeshPerBone(t *testing.T) {
	model := types.BedrockModel{
		TexWidth:  64,
		TexHeight: 64,
		Bones: []types.Bone2D{{
			Name:  "Body",
			Pivot: [3]float64{0, 0, 0},
			Cubes: []types.Cube2D{{
				Origin: [3]float64{-4, 0, -2},
				Size:   [3]float64{8, 12, 4},
				UV:     [2]float64{0, 0},
			}, {
				Origin:   [3]float64{-1, 12, -1},
				Size:     [3]float64{2, 2, 2},
				Pivot:    [3]float64{0, 12, 0},
				Rotation: [3]float64{0, 45, 0},
				UV:       [2]float64{16, 16},
			}},
		}},
	}

	raw, err := Build(model)
	if err != nil {
		t.Fatal(err)
	}

	var spec Model3DSpec
	if err := json.Unmarshal([]byte(raw), &spec); err != nil {
		t.Fatal(err)
	}
	if len(spec.Models) != 1 {
		t.Fatalf("models = %d, want 1", len(spec.Models))
	}
	if spec.UnitScale != 1.0/16.0 {
		t.Fatalf("unitScale = %v, want 1/16", spec.UnitScale)
	}
	meshes := spec.Models[0].MeshGroups
	if len(meshes) != 1 {
		t.Fatalf("meshGroups = %d, want 1 baked mesh", len(meshes))
	}
	mesh := meshes[0]
	if mesh.ID != "Body_baked_t0" {
		t.Fatalf("mesh ID = %q, want Body_baked_t0", mesh.ID)
	}
	if mesh.TexIdx != 0 {
		t.Fatalf("texIdx = %d, want 0", mesh.TexIdx)
	}
	if got := len(mesh.Positions) / 3; got != 48 {
		t.Fatalf("vertices = %d, want 48", got)
	}
	if got := len(mesh.Indices); got != 72 {
		t.Fatalf("indices = %d, want 72", got)
	}
	if mesh.LocalRotation != [4]float64{0, 0, 0, 1} {
		t.Fatalf("local rotation = %#v, want identity", mesh.LocalRotation)
	}
}

func TestBuildSplitsBakedMeshesByFaceTexture(t *testing.T) {
	faceUV := `{
		"north":{"uv":[0,0],"uv_size":[4,4],"texture":0},
		"south":{"uv":[0,0],"uv_size":[4,4],"texture":1},
		"east":{"uv":[0,0],"uv_size":[4,4],"texture":0},
		"west":{"uv":[0,0],"uv_size":[4,4],"texture":0},
		"up":{"uv":[0,0],"uv_size":[4,4],"texture":0},
		"down":{"uv":[0,0],"uv_size":[4,4],"texture":0}
	}`
	model := types.BedrockModel{
		TexWidth:  64,
		TexHeight: 64,
		Bones: []types.Bone2D{{
			Name:  "Body",
			Pivot: [3]float64{0, 0, 0},
			Cubes: []types.Cube2D{{
				Origin: [3]float64{0, 0, 0},
				Size:   [3]float64{4, 4, 4},
				FaceUV: faceUV,
			}},
		}},
	}

	raw, err := Build(model)
	if err != nil {
		t.Fatal(err)
	}
	var spec Model3DSpec
	if err := json.Unmarshal([]byte(raw), &spec); err != nil {
		t.Fatal(err)
	}

	meshes := spec.Models[0].MeshGroups
	if len(meshes) != 2 {
		t.Fatalf("meshGroups = %d, want 2 texture buckets", len(meshes))
	}
	if meshes[0].TexIdx != 0 || meshes[1].TexIdx != 1 {
		t.Fatalf("texIdx buckets = [%d,%d], want [0,1]", meshes[0].TexIdx, meshes[1].TexIdx)
	}
	if got := len(meshes[0].Positions) / 3; got != 20 {
		t.Fatalf("texture 0 vertices = %d, want 20", got)
	}
	if got := len(meshes[1].Positions) / 3; got != 4 {
		t.Fatalf("texture 1 vertices = %d, want 4", got)
	}
}
