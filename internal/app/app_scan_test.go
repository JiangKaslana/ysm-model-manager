// ===== app_scan.go 薄壳级单测（零测试层补测）=====
// 覆盖：isPathInRoot 路径守卫边界 / 守卫入口（ListFileNames/CheckFileExists 根外拒绝）/
// 扫描缓存命中语义 / ListModelAuthors 作者前缀提取。避开 Wails runtime 与真实用户配置目录。
package app

import (
	"os"
	"path/filepath"
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

func TestResolveInstDirTarget_TlmStandard(t *testing.T) {
	// 候选 A：TLM 注册表条目落地后（并行会话 ADR 链路），标准目录直接命中。
	// 条件测试：注册表未含 tlm 条目（尚未提交）时跳过，不依赖未提交改动。
	if types.RegistryType("tlm") == nil {
		t.Skip("注册表暂无 tlm 条目（并行会话未提交），跳过")
	}
	instDir := t.TempDir()
	tlmDir := filepath.Join(instDir, "tlm_custom_pack")
	if err := os.MkdirAll(tlmDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if got := resolveInstDirTarget(instDir, "tlm"); got != tlmDir {
		t.Errorf("tlm 标准命中 = %q, 期望 %q", got, tlmDir)
	}
}
