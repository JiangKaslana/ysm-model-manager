package threejs

// 临时诊断（勿提交）：构建 foxcar 真实 fixture，打印发光部件的 UV 四边形，
// 与 cube 面尺寸比对，判定是否有旋转/换位。
import (
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/geometry"
	"ysm-model-manager/go/types"
)

func TestDebugFoxcarGlowUV(t *testing.T) {
	p := filepath.Join("..", "..", "tests", "fixtures", "ysm", "01_taisho_maid", "models", "foxcar.json")
	data, err := os.ReadFile(p)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	m := geometry.ParseBedrockGeometry(data)
	if m == nil {
		t.Fatal("parse nil")
	}
	mg, err := buildModelGroup(*m, "main", 0)
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	fmt.Printf("TEX: %.0f x %.0f\n", mg.TextureWidth, mg.TextureHeight)
	for _, target := range []string{"ysmGlowFrontHeadlights", "ysmGlowRearLight"} {
		fmt.Printf("=== %s ===\n", target)
		n := 0
		for _, mesh := range mg.MeshGroups {
			if mesh.BoneID != target {
				continue
			}
			n++
			fmt.Printf("-- mesh #%d (cube %d) --\n", n, meshIdx(mesh.ID))
			tw, th := mg.TextureWidth, mg.TextureHeight
			for fi := 0; fi < 6; fi++ {
				// 每面 12 顶点位置 / 8 uv 值
				base := fi * 12
				uvb := fi * 8
				// 该面顶点 position 的 min/max
				minX, minY, minZ := 1e9, 1e9, 1e9
				maxX, maxY, maxZ := -1e9, -1e9, -1e9
				for v := 0; v < 4; v++ {
					x := mesh.Positions[base+v*3]
					y := mesh.Positions[base+v*3+1]
					z := mesh.Positions[base+v*3+2]
					if x < minX {
						minX = x
					}
					if x > maxX {
						maxX = x
					}
					if y < minY {
						minY = y
					}
					if y > maxY {
						maxY = y
					}
					if z < minZ {
						minZ = z
					}
					if z > maxZ {
						maxZ = z
					}
				}
				// 面内 UV quad: (u0,v0)(u1,v0)(u0,v1)(u1,v1)
				u := []float64{mesh.Uvs[uvb], mesh.Uvs[uvb+2], mesh.Uvs[uvb+4], mesh.Uvs[uvb+6]}
				v := []float64{mesh.Uvs[uvb+1], mesh.Uvs[uvb+3], mesh.Uvs[uvb+5], mesh.Uvs[uvb+7]}
				uMin, uMax := minmax(u)
				vMin, vMax := minmax(v)
				fmt.Printf(
					"face%d geomsz x=[%.2f..%.2f](%.1f) y=[%.2f..%.2f](%.1f) z=[%.2f..%.2f](%.1f) | uvpx u[%.1f..%.1f](%.1f) v[%.1f..%.1f](%.1f)\n",
					fi+1, minX, maxX, maxX-minX, minY, maxY, maxY-minY, minZ, maxZ, maxZ-minZ,
					uMin*tw, uMax*tw, (uMax-uMin)*tw, vMin*th, vMax*th, (vMax-vMin)*th,
				)
			}
		}
	}
}

func meshIdx(id string) int {
	// id 形如 boneID_N
	for i := len(id) - 1; i >= 0; i-- {
		if id[i] == '_' {
			out := 0
			for _, c := range []byte(id[i+1:]) {
				out = out*10 + int(c-'0')
			}
			return out
		}
	}
	return -1
}

func minmax(a []float64) (float64, float64) {
	mn, mx := 1e9, -1e9
	for _, f := range a {
		if f < mn {
			mn = f
		}
		if f > mx {
			mx = f
		}
	}
	return mn, mx
}

var _ = types.BedrockModel{}
