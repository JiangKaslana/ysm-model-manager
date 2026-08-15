package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types"
)

// Build3DSpecFromGeometryJSON：Android 等无 Node 环境的 .ysm 3D 兜底通道
// （前端 WASM 解码出 geometry JSON → 本 binding 复用 threejs.BuildMulti 构建 spec）
func TestBuild3DSpecFromGeometryJSON(t *testing.T) {
	a := &App{}
	if got := a.Build3DSpecFromGeometryJSON(""); got != "{}" {
		t.Fatalf("空输入应返回 {}，got %q", got)
	}
	if got := a.Build3DSpecFromGeometryJSON("not json"); got != "{}" {
		t.Fatalf("非法 JSON 应返回 {}，got %q", got)
	}

	const geo = `{
  "format_version": "1.12.0",
  "minecraft:geometry": [{
    "description": { "identifier": "geometry.test", "texture_width": 64, "texture_height": 32 },
    "bones": [{ "name": "bone1", "pivot": [0, 0, 0], "cubes": [{ "origin": [-4, 0, -4], "size": [8, 8, 8] }] }]
  }]
}`
	got := a.Build3DSpecFromGeometryJSON(geo)
	if got == "{}" {
		t.Fatal("合法 geometry 应构建出 spec，got {}")
	}
	var spec struct {
		Models []struct {
			MeshGroups []any `json:"meshGroups"`
		} `json:"models"`
	}
	if err := json.Unmarshal([]byte(got), &spec); err != nil {
		t.Fatalf("spec 非合法 JSON: %v", err)
	}
	if len(spec.Models) == 0 {
		t.Fatalf("spec.models 为空: %s", got)
	}
	if len(spec.Models[0].MeshGroups) == 0 {
		t.Fatalf("spec.models[0].meshGroups 为空（cube 未生成顶点）: %s", got)
	}
}

// TestReadFileBytes_MultiRootGuard：路径守卫须放行兄弟类型根（VrcRoot 等），
// 拒绝 ysm 根外路径——修复「ReadFileBytes 返回空」（VRM 预览失败，2026-08-16）。
// 守卫口径与 ScanModelEntries 对齐：扫描能列出的文件就能读。
func TestReadFileBytes_MultiRootGuard(t *testing.T) {
	base := t.TempDir()
	vrcRoot := filepath.Join(base, "vrchat")
	if err := os.MkdirAll(vrcRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	content := []byte("vrm-bytes")
	vrmPath := filepath.Join(vrcRoot, "avatar.vrm")
	if err := os.WriteFile(vrmPath, content, 0o644); err != nil {
		t.Fatal(err)
	}

	cfg := types.AppConfig{FilesRoot: filepath.Join(base, "ysm"), VrcRoot: vrcRoot}
	a := repoApp(t, cfg)

	// 1. 兄弟类型根（VrcRoot）内文件可读（修复目标）
	if got := a.ReadFileBytes(vrmPath); string(got) != "vrm-bytes" {
		t.Fatalf("VrcRoot 内文件应可读，got %q", got)
	}
	// 2. ysm 根内文件仍可读（回归：既有行为不破坏）
	ysmRoot := filepath.Join(cfg.FilesRoot, types.StorageSubDir("ysm"))
	if err := os.MkdirAll(ysmRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	ysmPath := filepath.Join(ysmRoot, "a.ysm")
	if err := os.WriteFile(ysmPath, content, 0o644); err != nil {
		t.Fatal(err)
	}
	if got := a.ReadFileBytes(ysmPath); string(got) != "vrm-bytes" {
		t.Fatalf("ysm 根内文件应可读，got %q", got)
	}
	// 3. 根外路径仍拒绝（守卫未放松）
	outside := filepath.Join(base, "..", "outside.ysm")
	if got := a.ReadFileBytes(outside); got != nil {
		t.Fatalf("根外路径应拒绝（nil），got %q", got)
	}
	// 4. 不存在的文件返回 nil（不抛错，与既有契约一致）
	if got := a.ReadFileBytes(filepath.Join(vrcRoot, "missing.vrm")); got != nil {
		t.Fatalf("不存在文件应返回 nil，got %q", got)
	}
}
