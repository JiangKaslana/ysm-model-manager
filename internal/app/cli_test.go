//go:build cli

// ===== cli.go 薄壳级单测（零测试层补测）=====
// 覆盖：diagnoseModel 诊断纯函数（空骨骼/pivot 全零/cube rotation 缺失）/
// hasMolangInJSON Molang 特征检测。避开 stdin/stdout 与 pauseExit（进程退出）。
// 注：cli.go 本身带 //go:build cli tag，本测试须同 tag（go test -tags cli ./internal/app/）。
package app

import (
	"testing"

	"ysm-model-manager/go/types"
)

func TestDiagnoseModel_EmptyBones(t *testing.T) {
	issues := diagnoseModel(&types.BedrockModel{})
	if len(issues) != 1 {
		t.Fatalf("空骨骼应产生 1 个 error, got %d", len(issues))
	}
	if issues[0].Severity != "error" || issues[0].Category != "geometry" {
		t.Errorf("空骨骼 issue 应为 error/geometry, got %+v", issues[0])
	}
}

func TestDiagnoseModel_PivotAllZero(t *testing.T) {
	m := &types.BedrockModel{
		BoneCount: 1,
		Bones: []types.Bone2D{
			{
				Name:  "boneA",
				Pivot: [3]float64{0, 0, 0},
				Cubes: []types.Cube2D{
					{Pivot: [3]float64{0, 0, 0}},
				},
			},
		},
	}
	issues := diagnoseModel(m)
	found := false
	for _, is := range issues {
		if is.Category == "missing_field" && is.Severity == "warning" {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("骨骼 pivot 全零应产生 warning, got %+v", issues)
	}
}

func TestDiagnoseModel_CubeNoRotation(t *testing.T) {
	m := &types.BedrockModel{
		BoneCount: 1,
		Bones: []types.Bone2D{
			{
				Name:  "boneA",
				Pivot: [3]float64{1, 2, 3},
				Cubes: []types.Cube2D{
					{Pivot: [3]float64{1, 2, 3}, Rotation: [3]float64{0, 0, 0}},
				},
			},
		},
	}
	issues := diagnoseModel(m)
	found := false
	for _, is := range issues {
		if is.Category == "missing_field" && is.Severity == "info" {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("cube 有 pivot 无 rotation 应产生 info, got %+v", issues)
	}
}

func TestDiagnoseModel_CleanModelNoIssues(t *testing.T) {
	m := &types.BedrockModel{
		BoneCount: 1,
		Bones: []types.Bone2D{
			{
				Name:  "boneA",
				Pivot: [3]float64{1, 2, 3},
				Cubes: []types.Cube2D{
					{Origin: [3]float64{0, 0, 0}, Size: [3]float64{4, 4, 4}, Pivot: [3]float64{1, 2, 3}, Rotation: [3]float64{0, 15, 0}},
				},
			},
		},
		TexWidth:  64,
		TexHeight: 64,
	}
	issues := diagnoseModel(m)
	for _, is := range issues {
		if is.Severity == "error" {
			t.Errorf("干净模型不应有 error, got %+v", issues)
		}
	}
}

func TestHasMolangInJSON(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want bool
	}{
		{"空串", "", false},
		{"普通 JSON", `{"name":"a","desc":"hello"}`, false},
		{"q. 前缀", `{"expr":"q.anim_time"}`, true},
		{"t. 前缀", `{"expr":"t.partial_ticks"}`, true},
		{"query. 完整词", `{"expr":"query.is_on_ground"}`, true},
		{"temp. 前缀", `{"expr":"temp.speed"}`, true},
		{"math. 前缀", `{"expr":"math.sin(x)"}`, true},
		{"大写 Molang 仍命中（小写归一）", `{"expr":"QUERY.LIFE_TIME"}`, true},
		{"普通字符串含 sq. 子串不误报（需引号前缀标记）", `{"note":"sq.area=1"}`, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := hasMolangInJSON(c.in); got != c.want {
				t.Errorf("hasMolangInJSON(%q) = %v, 期望 %v", c.in, got, c.want)
			}
		})
	}
}
