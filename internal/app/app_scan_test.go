// ===== app_scan.go 薄壳级单测（零测试层补测）=====
// 覆盖：isPathInRoot 路径守卫边界 / 守卫入口（ListFileNames/CheckFileExists 根外拒绝）/
// 扫描缓存命中语义 / ListModelAuthors 作者前缀提取。避开 Wails runtime 与真实用户配置目录。
package app

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ysm-model-manager/go/logs"
	"ysm-model-manager/go/types"
)

// scanApp 构造注入 configCache + logger 的 App（AddOpLog 依赖 logger）
func scanApp(t *testing.T, cfg types.AppConfig) *App {
	t.Helper()
	a := repoApp(t, cfg)
	a.logger = logs.NewLogger(t.TempDir())
	return a
}

func TestIsPathInRoot_Boundaries(t *testing.T) {
	base := t.TempDir()
	a := scanApp(t, types.AppConfig{FilesRoot: base})
	// ysm 子目录：FilesRoot/ysm
	root := filepath.Join(base, types.GroupStorageRoot("ysm"))
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		name string
		path string
		want bool
	}{
		{"根内文件", filepath.Join(root, "a.ysm"), true},
		{"根内子目录", filepath.Join(root, "sub", "b.ysm"), true},
		{"根本身（rel==. 拒绝）", root, false},
		{"兄弟目录（.. 越权）", filepath.Join(base, "other", "c.ysm"), false},
		{"..foo 合法目录（精确段比较不误拒）", filepath.Join(root, "..foo", "d.ysm"), true},
		{"空串", "", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := a.isPathInRoot(c.path); got != c.want {
				t.Errorf("isPathInRoot(%q) = %v, 期望 %v", c.path, got, c.want)
			}
		})
	}
}

func TestIsPathInRoot_NoRootConfigured(t *testing.T) {
	// FilesRoot 未配置 → GetRepoRoot 返回空 → 守卫一律拒绝（不静默放行）
	a := scanApp(t, types.AppConfig{})
	if a.isPathInRoot("/anything") {
		t.Error("未配置 FilesRoot 时 isPathInRoot 应恒 false")
	}
}

func TestListFileNames_Guard(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, types.GroupStorageRoot("ysm"))
	if err := os.MkdirAll(filepath.Join(root, "sub"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "a.ysm"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "sub", "b.ysm"), []byte("y"), 0o644); err != nil {
		t.Fatal(err)
	}
	a := scanApp(t, types.AppConfig{FilesRoot: base})

	t.Run("根内子目录递归列名", func(t *testing.T) {
		got := a.ListFileNames(filepath.Join(root, "sub"))
		if len(got) != 1 || got[0] != "b.ysm" {
			t.Fatalf("ListFileNames(sub) 应列出 b.ysm, got %v", got)
		}
	})

	t.Run("仓库根本身只读放行（整仓扫描语义，与 ReadFileBytes 同口径）", func(t *testing.T) {
		// 2026-08-16 修复：ListFileNames 改 isPathInRootOrSelf——只读遍历放行根本身安全，
		// 旧 isPathInRoot 对 rel==. 拒绝（防整删语义属写操作 RemoveDir/RenameDir 职责）
		got := a.ListFileNames(root)
		if len(got) != 2 {
			t.Fatalf("ListFileNames(根) 应列出全部文件（a.ysm+b.ysm）, got %v", got)
		}
	})

	t.Run("根外拒绝返回 nil", func(t *testing.T) {
		outside := filepath.Join(filepath.Dir(base), "outside-ysm-guard")
		if got := a.ListFileNames(outside); got != nil {
			t.Errorf("根外目录应返回 nil, got %v", got)
		}
	})

	t.Run("兄弟类型根（MmdRoot）下目录放行——mmd 预览纹理清单修复回归", func(t *testing.T) {
		// 2026-08-16 修复核心场景：mmd-skin 目录在 MmdRoot 下，旧 isPathInRoot 只认 ysm 根
		// 误拒 → ListAllFilePaths 返回 nil → 前端纹理清单空（files=0）→ 模型无贴图纯黑
		mmdRoot := filepath.Join(base, "mmd")
		modelDir := filepath.Join(mmdRoot, "模型A")
		if err := os.MkdirAll(modelDir, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(modelDir, "tex.png"), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
		a2 := scanApp(t, types.AppConfig{FilesRoot: base, MmdRoot: mmdRoot})
		got := a2.ListAllFilePaths(modelDir)
		if len(got) != 1 || filepath.Base(got[0]) != "tex.png" {
			t.Errorf("MmdRoot 下目录应列出 tex.png, got %v", got)
		}
	})
}

func TestCheckFileExists_Guard(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, types.GroupStorageRoot("ysm"))
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	inside := filepath.Join(root, "a.ysm")
	if err := os.WriteFile(inside, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(filepath.Dir(base), "outside-secret.ysm")
	// 2026-08-16 修复：CheckFileExists 改 isPathInRootOrSelf（与 ReadFileBytes 同口径，
	// FilesRoot 整仓可读可查存在）——真正根外 = FilesRoot 之外（父目录），仍拒绝
	if err := os.WriteFile(outside, []byte("s"), 0o644); err != nil {
		t.Fatal(err)
	}
	a := scanApp(t, types.AppConfig{FilesRoot: base})

	if !a.CheckFileExists(inside) {
		t.Error("根内存在的文件应返回 true")
	}
	if a.CheckFileExists(outside) {
		t.Error("根外文件应被守卫拒绝（false）")
	}
	if a.CheckFileExists(filepath.Join(root, "不存在.ysm")) {
		t.Error("不存在的文件应返回 false")
	}
}

func TestScanModelEntries_CacheHit(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, types.GroupStorageRoot("ysm"))
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	// 最小合法 .ysm 文件（扫描器按扩展名识别，不做深度解析）
	if err := os.WriteFile(filepath.Join(root, "a.ysm"), []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	a := scanApp(t, types.AppConfig{FilesRoot: base})

	first := a.ScanModelEntries(root)
	if len(first) != 1 {
		t.Fatalf("首次扫描应发现 1 个文件, got %d", len(first))
	}
	// 30s 内二次扫描命中缓存，结果一致
	second := a.ScanModelEntries(root)
	if len(second) != 1 {
		t.Fatalf("缓存命中扫描应仍返回 1 个文件, got %d", len(second))
	}
}

func TestScanModelEntries_SiblingTypeRootAllowed(t *testing.T) {
	// code_review 修复：扫描入口是跨类型通用绑定，守卫边界必须是全部合法根
	// （FilesRoot 公共祖先），而非仅 ysmRoot——resourcepack 等兄弟类型根相对
	// ysmRoot 是 ../，旧守卫会误拒（got 0 回归）
	base := t.TempDir()
	rpRoot := filepath.Join(base, types.GroupStorageRoot("resourcepack"))
	if err := os.MkdirAll(rpRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(rpRoot, "rp.zip"), []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	a := scanApp(t, types.AppConfig{FilesRoot: base})

	entries := a.ScanModelEntries(rpRoot)
	if len(entries) != 1 {
		t.Fatalf("兄弟类型根（resourcepack）应可扫描 1 个文件, got %d", len(entries))
	}
	// 越权路径仍拒绝
	if got := a.ScanModelEntries(filepath.Join(base, "..", "outside")); got != nil {
		t.Errorf("根外路径应返回 nil, got %v", got)
	}
}

func TestScanModelEntriesWithLabel_Guard(t *testing.T) {
	// code_review 修复：WithLabel 是前端主扫描入口，须与 ScanModelEntries 共用守卫
	base := t.TempDir()
	root := filepath.Join(base, types.GroupStorageRoot("ysm"))
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "a.ysm"), []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	a := scanApp(t, types.AppConfig{FilesRoot: base})

	if got := a.ScanModelEntriesWithLabel(root, "模型"); len(got) != 1 {
		t.Fatalf("根内扫描应返回 1 个文件, got %d", len(got))
	}
	if got := a.ScanModelEntriesWithLabel(filepath.Join(base, "..", "outside"), "模型"); got != nil {
		t.Errorf("根外路径应返回 nil, got %v", got)
	}
}

func TestScanModelEntriesWithHit_CacheSemantics(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, types.GroupStorageRoot("ysm"))
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	a := scanApp(t, types.AppConfig{FilesRoot: base})

	// 空目录：首次未命中缓存（hit=false），结果为空不报错
	entries, hit := a.scanModelEntriesWithHit(root)
	if hit {
		t.Error("首次扫描不应命中缓存")
	}
	if len(entries) != 0 {
		t.Errorf("空目录扫描应为空, got %d", len(entries))
	}
	// 二次扫描命中缓存
	_, hit2 := a.scanModelEntriesWithHit(root)
	if !hit2 {
		t.Error("二次扫描应命中 30s 缓存")
	}
	// 清缓存后再次未命中
	a.ClearScanCache()
	_, hit3 := a.scanModelEntriesWithHit(root)
	if hit3 {
		t.Error("ClearScanCache 后不应命中缓存")
	}
}

func TestListModelAuthors_PrefixExtraction(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, types.GroupStorageRoot("ysm"))
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	files := []string{
		"[作者A] 角色一.ysm",
		"[作者A] 角色二.ysm",
		"[作者B] 角色三.ysm",
		"无前缀.ysm",
	}
	for _, f := range files {
		if err := os.WriteFile(filepath.Join(root, f), []byte("{}"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	a := scanApp(t, types.AppConfig{FilesRoot: base})

	got := a.ListModelAuthors()
	if len(got) != 2 {
		t.Fatalf("应提取 2 个作者, got %v", got)
	}
	for _, author := range got {
		if author.Name == "作者A" && author.Count != 2 {
			t.Errorf("作者A 应计数 2, got %d", author.Count)
		}
		if author.Name == "作者B" && author.Count != 1 {
			t.Errorf("作者B 应计数 1, got %d", author.Count)
		}
	}
}

// TestIsPathInRootOrSelf_Boundaries 表驱动：多根守卫核心边界。
// isPathInRootOrSelf 是 Wails binding 层（ScanModelEntries / ScanModelEntriesWithLabel /
// GenerateRepoIndex / FindDuplicateFiles / CountDuplicateFiles）共用的路径守卫，
// 语义与 isPathInRoot 的关键差异：放行根本身（rel==.）、支持兄弟类型根（resourcepack 等）。
func TestIsPathInRootOrSelf_Boundaries(t *testing.T) {
	base := t.TempDir()
	ysmRoot := filepath.Join(base, types.GroupStorageRoot("ysm"))
	rpRoot := filepath.Join(base, types.GroupStorageRoot("resourcepack"))
	if err := os.MkdirAll(ysmRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(rpRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	a := scanApp(t, types.AppConfig{
		FilesRoot:        base,
		ResourcepackRoot: rpRoot,
	})

	cases := []struct {
		name string
		path string
		want bool
	}{
		{"ysm 根内文件", filepath.Join(ysmRoot, "a.ysm"), true},
		{"ysm 根本身（rel==. 放行——整仓扫描合法）", ysmRoot, true},
		{"resourcepack 根内文件（兄弟类型根放行）", filepath.Join(rpRoot, "rp.zip"), true},
		{"resourcepack 根本身", rpRoot, true},
		{"FilesRoot 根本身", base, true},
		{".. 越权", filepath.Join(base, "..", "outside"), false},
		{"根外子目录", filepath.Join(base, "..", "other"), false},
		{"空串", "", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := a.isPathInRootOrSelf(c.path)
			if got != c.want {
				t.Errorf("isPathInRootOrSelf(%q) = %v, 期望 %v", c.path, got, c.want)
			}
		})
	}
}

// TestIsPathInRootOrSelf_NoRootConfigured 多根均空 → 一律拒绝
func TestIsPathInRootOrSelf_NoRootConfigured(t *testing.T) {
	a := scanApp(t, types.AppConfig{})
	if a.isPathInRootOrSelf("/anything") {
		t.Error("无配置根时 isPathInRootOrSelf 应恒 false")
	}
}

// TestIsPathInRootOrSelf_RootItselfAllowed 对比：isPathInRoot 拒绝根本身，
// isPathInRootOrSelf 放行根本身（这是两函数语义差异的核心，直接影响整仓扫描合法与否）
func TestIsPathInRootOrSelf_RootItselfAllowed(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, types.GroupStorageRoot("ysm"))
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	a := scanApp(t, types.AppConfig{FilesRoot: base})

	if !a.isPathInRootOrSelf(root) {
		t.Error("isPathInRootOrSelf 应放行根本身（整仓扫描）")
	}
	if a.isPathInRoot(root) {
		t.Error("isPathInRoot 应拒绝根本身（防整删）")
	}
}

// ===== inferFolderType（ADR-092 子类型落位根基）=====
// 文件夹整组导入按内容推断 rtype，MMD 文件夹不再落到 ysm 根。

func TestInferFolderType_MMD(t *testing.T) {
	files := []types.ImportFileItem{
		{RelPath: "model.pmx", Base64: "cG14"},
		{RelPath: "anims/walk.vmd", Base64: "dm1k"},
		{RelPath: "textures/model.png", Base64: "cG5n"},
	}
	if got := inferFolderType(files); got != "mmd-skin" {
		t.Errorf("inferFolderType(MMD) = %q, 期望 'mmd-skin'", got)
	}
}

func TestInferFolderType_Ysm(t *testing.T) {
	files := []types.ImportFileItem{
		{RelPath: "ysm.json", Base64: "e30="},
		{RelPath: "models/entity.json", Base64: "e30="},
		{RelPath: "textures/tex.png", Base64: "cG5n"},
	}
	if got := inferFolderType(files); got != "ysm" {
		t.Errorf("inferFolderType(YSM) = %q, 期望 'ysm'", got)
	}
}

func TestInferFolderType_FallbackYsm(t *testing.T) {
	// 无主文件 / 未知扩展名 → 回退 ysm（向后兼容）
	if got := inferFolderType([]types.ImportFileItem{{RelPath: "notes.txt", Base64: ""}}); got != "ysm" {
		t.Errorf("inferFolderType(unknown) = %q, 期望 'ysm'", got)
	}
	if got := inferFolderType(nil); got != "ysm" {
		t.Errorf("inferFolderType(empty) = %q, 期望 'ysm'", got)
	}
}

// ===== resolveInstDirTarget（ADR-095：打开资源存储目录而非模组扫描目录）=====
// 覆盖矩阵：vanilla / Prism 布局 × ysm（installDir 含 {instance} 前缀）/ resourcepack
// （installDir 为 mcRoot 全局目录）；全部目录不存在 / 未知类型 → 回退 instDir。
func TestResolveInstDirTarget_VanillaYsm(t *testing.T) {
	// vanilla 布局：instDir = {mcRoot}/versions/{name}，ysm 存储目录 = instDir/ysm
	mcRoot := t.TempDir()
	instDir := filepath.Join(mcRoot, "versions", "1.20.1-Fabric")
	ysmDir := filepath.Join(instDir, "ysm")
	if err := os.MkdirAll(ysmDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if got := resolveInstDirTarget(instDir, "ysm"); got != ysmDir {
		t.Errorf("vanilla+ysm = %q, 期望 %q", got, ysmDir)
	}
}

func TestResolveInstDirTarget_VanillaResourcepack(t *testing.T) {
	// vanilla + resourcepack：installDir=resourcepacks/ 相对 mcRoot；instDir 侧无此目录
	mcRoot := t.TempDir()
	instDir := filepath.Join(mcRoot, "versions", "1.20.1-Fabric")
	rpDir := filepath.Join(mcRoot, "resourcepacks")
	if err := os.MkdirAll(rpDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if got := resolveInstDirTarget(instDir, "resourcepack"); got != rpDir {
		t.Errorf("vanilla+resourcepack = %q, 期望 %q", got, rpDir)
	}
}

func TestResolveInstDirTarget_PrismYsm(t *testing.T) {
	// Prism 布局：instDir = 整合包 .minecraft 根，ysm 存储目录 = instDir/ysm
	base := t.TempDir()
	instDir := filepath.Join(base, ".minecraft")
	ysmDir := filepath.Join(instDir, "ysm")
	if err := os.MkdirAll(ysmDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if got := resolveInstDirTarget(instDir, "ysm"); got != ysmDir {
		t.Errorf("Prism+ysm = %q, 期望 %q", got, ysmDir)
	}
}

func TestResolveInstDirTarget_PrismResourcepack(t *testing.T) {
	// Prism + resourcepack：instDir 即整合包根，存储目录 = instDir/resourcepacks
	base := t.TempDir()
	instDir := filepath.Join(base, ".minecraft")
	rpDir := filepath.Join(instDir, "resourcepacks")
	if err := os.MkdirAll(rpDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if got := resolveInstDirTarget(instDir, "resourcepack"); got != rpDir {
		t.Errorf("Prism+resourcepack = %q, 期望 %q", got, rpDir)
	}
}

func TestResolveInstDirTarget_NoneExistsFallback(t *testing.T) {
	// 所有候选都不存在 → 回退 instDir（不得拼出不存在的路径强行打开）
	instDir := filepath.Join(t.TempDir(), "empty-inst")
	if got := resolveInstDirTarget(instDir, "ysm"); got != instDir {
		t.Errorf("无候选存在 = %q, 期望回退 %q", got, instDir)
	}
}

func TestResolveInstDirTarget_UnknownType(t *testing.T) {
	// 未知类型（无 InstallDir 配置）→ 原样返回 instDir（保持原行为）
	instDir := filepath.Join(t.TempDir(), "unknown-inst")
	if got := resolveInstDirTarget(instDir, "no-such-type"); got != instDir {
		t.Errorf("未知类型 = %q, 期望 %q", got, instDir)
	}
}

func TestResolveInstDirTarget_YsmConfigTree(t *testing.T) {
	// 候选 C：ysm 的模型真身在 config 树内（用户环境 [海岛寿司店]v1.1/config/yes_steve_model）。
	// installDir 推导（instDir/ysm）不存在 → scanDir 存在性回溯命中 config/yes_steve_model。
	instDir := t.TempDir()
	ysmDir := filepath.Join(instDir, "config", "yes_steve_model")
	if err := os.MkdirAll(ysmDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if got := resolveInstDirTarget(instDir, "ysm"); got != ysmDir {
		t.Errorf("ysm config 树回溯 = %q, 期望 %q", got, ysmDir)
	}
}

func TestResolveInstDirTarget_YsmConfigTreeCustom(t *testing.T) {
	// 候选 C 逐级回溯：custom 存在时命中最深一层（config/yes_steve_model/custom）
	instDir := t.TempDir()
	custom := filepath.Join(instDir, "config", "yes_steve_model", "custom")
	if err := os.MkdirAll(custom, 0o755); err != nil {
		t.Fatal(err)
	}
	if got := resolveInstDirTarget(instDir, "ysm"); got != custom {
		t.Errorf("ysm custom 命中 = %q, 期望 %q", got, custom)
	}
}

func TestResolveInstDirTarget_SableBlueprintFallback(t *testing.T) {
	// 候选 D：蓝图标准目录（schematics）不存在，兜底扫描命中 Sable 非标准目录——
	// 弥合「列表显示正确（FindInstDir 兜底）但打开回退版本目录」的裂口。
	instDir := t.TempDir()
	sable := filepath.Join(instDir, "Sable-Schematics", "hello_new_generation_core")
	if err := os.MkdirAll(sable, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sable, "c1.nbt"), []byte("nbt"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := resolveInstDirTarget(instDir, "create-blueprint"); got != filepath.Join(instDir, "Sable-Schematics") {
		t.Errorf("Sable 兜底 = %q, 期望 %q", got, filepath.Join(instDir, "Sable-Schematics"))
	}
}

func TestResolveInstDirTarget_MaidModelStandard(t *testing.T) {
	// 候选 A：车万女仆（maid-model，原 tlm 条目合并改名）installDir=tlm_custom_pack/，
	// 标准目录直接命中，不依赖 scanDir/config 探测。条件测试：注册表条目缺失时跳过。
	if types.RegistryType("maid-model") == nil {
		t.Skip("注册表暂无 maid-model 条目，跳过")
	}
	instDir := t.TempDir()
	packDir := filepath.Join(instDir, "tlm_custom_pack")
	if err := os.MkdirAll(packDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if got := resolveInstDirTarget(instDir, "maid-model"); got != packDir {
		t.Errorf("maid-model 标准命中 = %q, 期望 %q", got, packDir)
	}
}

// ===== SearchModels 并发优化测试 =====

// geoJSON 创建可解析的 Bedrock 几何 JSON
func geoJSON(name string, bones int) string {
	boneObjs := make([]string, bones)
	for i := range bones {
		boneObjs[i] = fmt.Sprintf(
			`{"name":"%s_%d","pivot":[0,0,0],"cubes":[{"origin":[-4,0,-4],"size":[8,8,8]}]}`,
			name, i,
		)
	}
	return fmt.Sprintf(
		`{"format_version":"1.16.0","minecraft:geometry":[{"description":{"identifier":"%s","texture_width":64,"texture_height":64},"bones":[%s]}]}`,
		name, strings.Join(boneObjs, ","),
	)
}

// writeYsmModelFixture 在 dir 下创建一个独立的 ysm.json + 几何文件结构
// 每个模型用独立子目录，确保 ScanModelEntries 能发现多个 ysm.json
func writeYsmModelFixture(t *testing.T, dir, modelName string, bones int) string {
	t.Helper()
	modelDir := filepath.Join(dir, modelName)
	if err := os.MkdirAll(modelDir, 0o755); err != nil {
		t.Fatal(err)
	}
	geoName := modelName + ".geo.json"
	ysmJSON := fmt.Sprintf(`{"files":{"player":{"model":{"main":"%s"}}}}`, geoName)
	if err := os.WriteFile(filepath.Join(modelDir, "ysm.json"), []byte(ysmJSON), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(modelDir, geoName), []byte(geoJSON(modelName, bones)), 0o644); err != nil {
		t.Fatal(err)
	}
	return modelDir
}

// TestSearchModels_ModelMatchesFilters: 纯函数过滤逻辑测试
func TestSearchModels_ModelMatchesFilters(t *testing.T) {
	cases := []struct {
		name      string
		model     types.BedrockModel
		minBones  int
		maxBones  int
		minCubes  int
		maxCubes  int
		minTex    int
		maxTex    int
		wantMatch bool
	}{
		{"零骨骼不匹配", types.BedrockModel{BoneCount: 0}, 0, 0, 0, 0, 0, 0, false},
		{"正常匹配", types.BedrockModel{BoneCount: 5, CubeCount: 10, TexWidth: 64, TexHeight: 64}, 0, 0, 0, 0, 0, 0, true},
		{"骨骼数不足", types.BedrockModel{BoneCount: 3}, 5, 0, 0, 0, 0, 0, false},
		{"骨骼数超限", types.BedrockModel{BoneCount: 10}, 0, 5, 0, 0, 0, 0, false},
		{"立方体数不足", types.BedrockModel{BoneCount: 5, CubeCount: 2}, 0, 0, 5, 0, 0, 0, false},
		{"立方体数超限", types.BedrockModel{BoneCount: 5, CubeCount: 20}, 0, 0, 0, 10, 0, 0, false},
		{"纹理宽度不足", types.BedrockModel{BoneCount: 5, TexWidth: 32, TexHeight: 64}, 0, 0, 0, 0, 64, 0, false},
		{"纹理高度不足", types.BedrockModel{BoneCount: 5, TexWidth: 64, TexHeight: 32}, 0, 0, 0, 0, 64, 0, false},
		{"纹理宽度超限", types.BedrockModel{BoneCount: 5, TexWidth: 128}, 0, 0, 0, 0, 0, 64, false},
		{"纹理高度超限", types.BedrockModel{BoneCount: 5, TexHeight: 128}, 0, 0, 0, 0, 0, 64, false},
		{"全部条件满足", types.BedrockModel{BoneCount: 10, CubeCount: 50, TexWidth: 128, TexHeight: 128}, 5, 20, 10, 100, 64, 256, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := modelMatchesFilters(c.model, c.minBones, c.maxBones, c.minCubes, c.maxCubes, c.minTex, c.maxTex)
			if got != c.wantMatch {
				t.Errorf("modelMatchesFilters = %v, 期望 %v", got, c.wantMatch)
			}
		})
	}
}

// TestSearchModels_SequentialPath: 候选 <= 2 走顺序路径
func TestSearchModels_SequentialPath(t *testing.T) {
	base := t.TempDir()
	ysmRoot := filepath.Join(base, "ysm", "models")
	os.MkdirAll(ysmRoot, 0o755)
	writeYsmModelFixture(t, ysmRoot, "small", 3)
	writeYsmModelFixture(t, ysmRoot, "tiny", 1)

	a := scanApp(t, types.AppConfig{FilesRoot: base})
	results := a.SearchModels(base, "", 0, 0, 0, 0, 0, 0)
	if len(results) < 2 {
		t.Fatalf("至少应有 2 个结果，got %d", len(results))
	}
	for _, r := range results {
		if r.BoneCount == 0 {
			t.Errorf("结果 %s 应有非零骨骼数", r.Name)
		}
	}
}

// TestSearchModels_ConcurrentPath: 候选 > 2 走并发路径
func TestSearchModels_ConcurrentPath(t *testing.T) {
	base := t.TempDir()
	ysmRoot := filepath.Join(base, "ysm", "models")
	os.MkdirAll(ysmRoot, 0o755)
	const n = 8
	for i := range n {
		writeYsmModelFixture(t, ysmRoot, fmt.Sprintf("model_%d", i), i+1)
	}

	a := scanApp(t, types.AppConfig{FilesRoot: base})
	results := a.SearchModels(base, "", 0, 0, 0, 0, 0, 0)
	if len(results) != n {
		t.Fatalf("期望 %d 个结果，got %d", n, len(results))
	}
}

// TestSearchModels_KeywordFilter: 关键词预过滤有效
func TestSearchModels_KeywordFilter(t *testing.T) {
	base := t.TempDir()
	ysmRoot := filepath.Join(base, "ysm", "models")
	os.MkdirAll(ysmRoot, 0o755)
	writeYsmModelFixture(t, ysmRoot, "warrior", 5)
	writeYsmModelFixture(t, ysmRoot, "mage", 3)
	writeYsmModelFixture(t, ysmRoot, "rogue", 4)

	a := scanApp(t, types.AppConfig{FilesRoot: base})

	// 搜索 "warrior" → 只匹配 warrior
	results := a.SearchModels(base, "warrior", 0, 0, 0, 0, 0, 0)
	if len(results) != 1 {
		t.Fatalf("搜索 warrior 期望 1 个结果，got %d", len(results))
	}

	// 搜索不存在的关键词 → 空结果
	results = a.SearchModels(base, "nonexistent", 0, 0, 0, 0, 0, 0)
	if len(results) != 0 {
		t.Fatalf("搜索 nonexistent 期望 0 个结果，got %d", len(results))
	}
}

// TestSearchModels_BoneFilter: 骨骼数过滤有效
func TestSearchModels_BoneFilter(t *testing.T) {
	base := t.TempDir()
	ysmRoot := filepath.Join(base, "ysm", "models")
	os.MkdirAll(ysmRoot, 0o755)
	writeYsmModelFixture(t, ysmRoot, "low", 2)
	writeYsmModelFixture(t, ysmRoot, "high", 10)

	a := scanApp(t, types.AppConfig{FilesRoot: base})

	// 最少骨骼 5 → 只匹配 high
	results := a.SearchModels(base, "", 5, 0, 0, 0, 0, 0)
	if len(results) != 1 {
		t.Fatalf("期望 1 个结果，got %d", len(results))
	}

	// 最多骨骼 3 → 只匹配 low
	results = a.SearchModels(base, "", 0, 3, 0, 0, 0, 0)
	if len(results) != 1 {
		t.Fatalf("期望 1 个结果，got %d", len(results))
	}
}

// TestSearchModels_ConcurrentConsistency: 并发路径全量搜索有效
func TestSearchModels_ConcurrentConsistency(t *testing.T) {
	base := t.TempDir()
	ysmRoot := filepath.Join(base, "ysm", "models")
	os.MkdirAll(ysmRoot, 0o755)
	const n = 10
	for i := range n {
		writeYsmModelFixture(t, ysmRoot, fmt.Sprintf("model_%d", i), i+1)
	}

	a := scanApp(t, types.AppConfig{FilesRoot: base})

	results := a.SearchModels(base, "", 0, 0, 0, 0, 0, 0)
	if len(results) != n {
		t.Fatalf("期望 %d 个结果，got %d", n, len(results))
	}

	for _, r := range results {
		if r.BoneCount == 0 {
			t.Errorf("结果 %s 骨骼数为 0", r.Name)
		}
	}
}

// TestSearchModels_EmptyRepo: 空仓库返回 nil
func TestSearchModels_EmptyRepo(t *testing.T) {
	base := t.TempDir()
	a := scanApp(t, types.AppConfig{FilesRoot: base})
	results := a.SearchModels(base, "", 0, 0, 0, 0, 0, 0)
	if results != nil {
		t.Fatalf("空仓库应返回 nil, got %v", results)
	}
}

// TestSearchModels_Boundary2Sequential: 恰好 2 个候选 → 走顺序路径
func TestSearchModels_Boundary2Sequential(t *testing.T) {
	base := t.TempDir()
	ysmRoot := filepath.Join(base, "ysm", "models")
	os.MkdirAll(ysmRoot, 0o755)
	writeYsmModelFixture(t, ysmRoot, "a", 1)
	writeYsmModelFixture(t, ysmRoot, "b", 2)

	a := scanApp(t, types.AppConfig{FilesRoot: base})
	results := a.SearchModels(base, "", 0, 0, 0, 0, 0, 0)
	if len(results) != 2 {
		t.Fatalf("恰好 2 个模型应走顺序路径，got %d", len(results))
	}
}

// TestSearchModels_Boundary3Concurrent: 恰好 3 个候选 → 走并发路径
func TestSearchModels_Boundary3Concurrent(t *testing.T) {
	base := t.TempDir()
	ysmRoot := filepath.Join(base, "ysm", "models")
	os.MkdirAll(ysmRoot, 0o755)
	writeYsmModelFixture(t, ysmRoot, "a", 1)
	writeYsmModelFixture(t, ysmRoot, "b", 2)
	writeYsmModelFixture(t, ysmRoot, "c", 3)

	a := scanApp(t, types.AppConfig{FilesRoot: base})
	results := a.SearchModels(base, "", 0, 0, 0, 0, 0, 0)
	if len(results) != 3 {
		t.Fatalf("恰好 3 个模型应走并发路径，got %d", len(results))
	}
}

// TestSearchModels_CombinedFilter: 关键词+骨骼数+纹理组合过滤
func TestSearchModels_CombinedFilter(t *testing.T) {
	base := t.TempDir()
	ysmRoot := filepath.Join(base, "ysm", "models")
	os.MkdirAll(ysmRoot, 0o755)
	writeYsmModelFixture(t, ysmRoot, "warrior_heavy", 15)
	writeYsmModelFixture(t, ysmRoot, "warrior_light", 3)
	writeYsmModelFixture(t, ysmRoot, "mage_heavy", 12)
	writeYsmModelFixture(t, ysmRoot, "rogue_light", 4)

	a := scanApp(t, types.AppConfig{FilesRoot: base})

	// 组合：关键词 "warrior" + 最少骨骼 5 → 只匹配 warrior_heavy
	results := a.SearchModels(base, "warrior", 5, 0, 0, 0, 0, 0)
	if len(results) != 1 {
		t.Fatalf("warrior+骨骼>=5 应只匹配 1 个，got %d", len(results))
	}
	if !strings.Contains(results[0].Path, "warrior_heavy") {
		t.Errorf("期望 warrior_heavy, got path %s", results[0].Path)
	}

	// 组合：关键词 "warrior" + 最多骨骼 5 → 只匹配 warrior_light
	results = a.SearchModels(base, "warrior", 0, 5, 0, 0, 0, 0)
	if len(results) != 1 {
		t.Fatalf("warrior+骨骼<=5 应只匹配 1 个，got %d", len(results))
	}

	// 搜索 "mage" → 只匹配 mage_heavy
	results = a.SearchModels(base, "mage", 0, 0, 0, 0, 0, 0)
	if len(results) != 1 {
		t.Fatalf("搜索 mage 应只匹配 1 个，got %d", len(results))
	}
	if !strings.Contains(results[0].Path, "mage_heavy") {
		t.Errorf("期望 mage_heavy, got path %s", results[0].Path)
	}
}

// TestSearchModels_ResultOrder: 并发结果完整性验证
func TestSearchModels_ResultOrder(t *testing.T) {
	base := t.TempDir()
	ysmRoot := filepath.Join(base, "ysm", "models")
	os.MkdirAll(ysmRoot, 0o755)
	names := []string{"alpha", "beta", "gamma", "delta", "epsilon"}
	for _, name := range names {
		writeYsmModelFixture(t, ysmRoot, name, 2)
	}

	a := scanApp(t, types.AppConfig{FilesRoot: base})
	results := a.SearchModels(base, "", 0, 0, 0, 0, 0, 0)
	if len(results) != len(names) {
		t.Fatalf("期望 %d 个结果，got %d", len(names), len(results))
	}

	// 验证所有模型都被找到（通过 Path 包含目录名）
	for _, name := range names {
		found := false
		for _, r := range results {
			if strings.Contains(r.Path, name) {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("模型 %s 未在结果中找到", name)
		}
	}
}

// TestSearchModels_ZeroBoneFilter: 零骨骼模型被过滤
func TestSearchModels_ZeroBoneFilter(t *testing.T) {
	base := t.TempDir()
	ysmRoot := filepath.Join(base, "ysm", "models")
	os.MkdirAll(ysmRoot, 0o755)
	modelDir := filepath.Join(ysmRoot, "empty_model")
	os.MkdirAll(modelDir, 0o755)
	ysmJSON := `{"files":{"player":{"model":{"main":"empty.geo.json"}}}}`
	os.WriteFile(filepath.Join(modelDir, "ysm.json"), []byte(ysmJSON), 0o644)
	emptyGeo := `{"format_version":"1.16.0","minecraft:geometry":[{"description":{"identifier":"empty","texture_width":64,"texture_height":64},"bones":[]}]}`
	os.WriteFile(filepath.Join(modelDir, "empty.geo.json"), []byte(emptyGeo), 0o644)

	writeYsmModelFixture(t, ysmRoot, "valid_model", 5)

	a := scanApp(t, types.AppConfig{FilesRoot: base})
	results := a.SearchModels(base, "", 0, 0, 0, 0, 0, 0)
	// 空骨骼模型应被过滤（BoneCount=0，modelMatchesFilters 返回 false）
	if len(results) != 1 {
		t.Fatalf("空骨骼模型应被过滤，仅 1 个有效结果，got %d", len(results))
	}
	if !strings.Contains(results[0].Path, "valid_model") {
		t.Errorf("唯一有效结果应为 valid_model, got path %s", results[0].Path)
	}
}
