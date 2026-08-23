// ===== go/instance 单测（ADR-003 补充下沉验证）=====
package instance

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ysm-model-manager/go/types"
)

func TestBuildSyncItems_Basic(t *testing.T) {
	sub := types.SubDirMap("ysm")
	if sub == "" {
		t.Skip("ysm 无 InstanceDir 配置，跳过目录构造测试")
	}
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")
	instDir := filepath.Join(filepath.Join(base, "inst"), sub)
	if err := os.MkdirAll(globalDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(instDir, 0755); err != nil {
		t.Fatal(err)
	}
	// Synced: 两处一致
	_ = os.WriteFile(filepath.Join(globalDir, "m.ysm"), []byte("x"), 0644)
	_ = os.WriteFile(filepath.Join(instDir, "m.ysm"), []byte("x"), 0644)
	// Missing: 全局有、整合包没有
	_ = os.WriteFile(filepath.Join(globalDir, "missing.ysm"), []byte("x"), 0644)
	// Extra: 整合包有、全局没有
	_ = os.WriteFile(filepath.Join(instDir, "extra.ysm"), []byte("x"), 0644)

	ins := &types.VersionInstance{Name: "t", VersionDir: filepath.Join(base, "inst")}
	items := BuildSyncItems(ins, []ResourceTypeInfo{{ID: "ysm", Icon: "📦"}}, map[string]string{"ysm": globalDir}, "")
	if len(items) == 0 {
		t.Fatal("应产出同步状态项")
	}

	byName := map[string]types.ResourceSyncItem{}
	for _, it := range items {
		byName[it.Name] = it
	}
	if it, ok := byName["m.ysm"]; !ok || it.Status != types.SyncStatusSynced {
		t.Fatalf("m.ysm 应 Synced: %+v", it)
	}
	if it, ok := byName["missing.ysm"]; !ok || it.Status != types.SyncStatusMissing {
		t.Fatalf("missing.ysm 应 Missing: %+v", it)
	}
	if it, ok := byName["extra.ysm"]; !ok || it.Status != types.SyncStatusOptional {
		t.Fatalf("extra.ysm 应 Optional: %+v", it)
	}
}

func TestBuildSyncItems_EmptyInputs(t *testing.T) {
	// 无资源类型 → 空
	ins := &types.VersionInstance{Name: "t", VersionDir: t.TempDir()}
	if items := BuildSyncItems(ins, nil, map[string]string{}, ""); len(items) != 0 {
		t.Fatalf("无资源类型应返回空，实际 %d", len(items))
	}
	// 资源类型 root 为空 → 跳过该类型
	if items := BuildSyncItems(ins, []ResourceTypeInfo{{ID: "ysm", Icon: "📦"}}, map[string]string{"ysm": ""}, ""); len(items) != 0 {
		t.Fatalf("root 为空应跳过，实际 %d", len(items))
	}
}

// ====== fsutil.IsResourcePackFolder（已收敛至 fsutil 包测试，见 walk_test.go） ======

// synced pack.mcmeta 文件夹必须恰好出现一条——
// 主循环（含 fsutil.IsResourcePackFolder 放行）是文件夹唯一来源；兜底 Walk 的文件夹分支
// 已删除，防止同一文件夹被加两次（UI 显示同包双状态 Synced+Optional）
func TestBuildSyncItems_SyncedPackFolderExactlyOnce(t *testing.T) {
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")
	instDir := filepath.Join(base, "inst")
	if err := os.MkdirAll(globalDir, 0755); err != nil {
		t.Fatal(err)
	}
	// 实例侧与全局侧都有同一资源包文件夹（含 pack.mcmeta）→ SyncResources 判 Synced
	instPack := filepath.Join(instDir, "PackA")
	globalPack := filepath.Join(globalDir, "PackA")
	if err := os.MkdirAll(instPack, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(globalPack, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(instPack, "pack.mcmeta"), []byte("{}"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(globalPack, "pack.mcmeta"), []byte("{}"), 0644); err != nil {
		t.Fatal(err)
	}
	ins := &types.VersionInstance{VersionDir: base}
	items := BuildSyncItems(ins, []ResourceTypeInfo{{ID: "resourcepack", Icon: "🎨"}}, map[string]string{"resourcepack": globalDir}, "")
	count := 0
	for _, it := range items {
		if it.Name == "PackA" {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("synced 资源包文件夹应恰好 1 条，实际 %d（%d 总数）", count, len(items))
	}
}

// TestBuildSyncItems_InstExtraFile resourcepack 类型下实例标准目录（resourcepacks）
// 独有 .zip（全局侧没有）应显示为 Optional——由 SyncResources 相对路径对比的
// Extra 产生；非资源包扩展名（.txt）仍过滤。2026-08-23 收敛：resourcepack
// scanInstance=false，不再兜底扫描 instDir 根，zip 必须位于标准 resourcepacks 目录。
func TestBuildSyncItems_InstExtraFile(t *testing.T) {
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")
	instDir := filepath.Join(base, "resourcepacks")
	if err := os.MkdirAll(globalDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(instDir, 0755); err != nil {
		t.Fatal(err)
	}
	// 实例标准目录（versionDir/resourcepacks）独有 .zip（资源包合法扩展名）→ Optional
	if err := os.WriteFile(filepath.Join(instDir, "pack-user.zip"), []byte("zip"), 0644); err != nil {
		t.Fatal(err)
	}
	// 实例标准目录独有 .txt（非资源包扩展名）→ extMatch 过滤，不应添加
	if err := os.WriteFile(filepath.Join(instDir, "notes.txt"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	ins := &types.VersionInstance{VersionDir: base}
	items := BuildSyncItems(ins, []ResourceTypeInfo{{ID: "resourcepack", Icon: "🎨"}}, map[string]string{"resourcepack": globalDir}, "")
	// 应恰好 1 条：pack-user.zip（optional），notes.txt 被过滤
	if len(items) != 1 {
		t.Fatalf("实例标准目录应产出 1 条（pack-user.zip），实际 %d 条: %+v", len(items), items)
	}
	if items[0].Name != "pack-user.zip" {
		t.Errorf("条目应为 pack-user.zip, got %q", items[0].Name)
	}
	if items[0].Status != types.SyncStatusOptional {
		t.Errorf("实例独有文件应标 optional, got %q", items[0].Status)
	}
}

// TestBuildSyncItems_NilInstance 导出入口 nil 守卫（L27-29）——nil 不应 panic
func TestBuildSyncItems_NilInstance(t *testing.T) {
	if items := BuildSyncItems(nil, []ResourceTypeInfo{{ID: "ysm", Icon: "📦"}}, map[string]string{"ysm": "/x"}, ""); items != nil {
		t.Fatalf("nil instance 应返回 nil，实际 %v", items)
	}
}

// TestBuildSyncItems_UnknownTypeSkip SubDirMap 返回空 → 该类型直接跳过（L63-65）
func TestBuildSyncItems_UnknownTypeSkip(t *testing.T) {
	ins := &types.VersionInstance{Name: "t", VersionDir: t.TempDir()}
	if items := BuildSyncItems(ins, []ResourceTypeInfo{{ID: "no-such-type", Icon: "x"}}, map[string]string{"no-such-type": "/x"}, ""); len(items) != 0 {
		t.Fatalf("未知类型无 InstanceDir 应跳过，实际 %d 条", len(items))
	}
}

// TestBuildSyncItems_IndependentTypes 壳-叶架构移除后，EntityPlayer/CustomAnim 等
// 类型现为独立资源类型（不再是 MMD 壳子类型），各自有独立 instanceDir 和扩展名。
// 验证各类型独立运作、互不干扰。
func TestBuildSyncItems_IndependentTypes(t *testing.T) {
	base := t.TempDir()

	// EntityPlayer 全局与实例目录（位置路由：instanceDir=3d-skin/EntityPlayer 壳根）
	epGlobal := filepath.Join(base, "mmd")
	epInst := filepath.Join(base, "inst", "3d-skin", "EntityPlayer")
	_ = os.MkdirAll(epGlobal, 0755)
	_ = os.MkdirAll(epInst, 0755)

	// 仓库侧：角色A（两侧都有 → Synced）、角色B（仅仓库 → Missing）
	epRoleA := filepath.Join(epGlobal, "角色A")
	_ = os.MkdirAll(epRoleA, 0755)
	_ = os.WriteFile(filepath.Join(epRoleA, "a.pmx"), []byte("pmx"), 0644)
	epInstRoleA := filepath.Join(epInst, "角色A")
	_ = os.MkdirAll(epInstRoleA, 0755)
	_ = os.WriteFile(filepath.Join(epInstRoleA, "a.pmx"), []byte("pmx"), 0644)

	epRoleB := filepath.Join(epGlobal, "角色B")
	_ = os.MkdirAll(epRoleB, 0755)
	_ = os.WriteFile(filepath.Join(epRoleB, "b.pmx"), []byte("pmx"), 0644)

	// 整合包侧独有：角色C（Extra/Optional）
	epInstRoleC := filepath.Join(epInst, "角色C")
	_ = os.MkdirAll(epInstRoleC, 0755)
	_ = os.WriteFile(filepath.Join(epInstRoleC, "c.pmx"), []byte("pmx"), 0644)

	ins := &types.VersionInstance{Name: "t", VersionDir: filepath.Join(base, "inst")}

	// 独立类型 EntityPlayer：应只包含 EntityPlayer 相关条目
	items := BuildSyncItems(ins,
		[]ResourceTypeInfo{{ID: "EntityPlayer", Icon: "🧍"}},
		map[string]string{"EntityPlayer": epGlobal}, "")

	byName := map[string]types.ResourceSyncItem{}
	for _, it := range items {
		byName[it.Name] = it
	}
	if it, ok := byName["角色A"]; !ok || it.Status != types.SyncStatusSynced {
		t.Errorf("角色A 应 Synced: %+v", it)
	}
	if it, ok := byName["角色B"]; !ok || it.Status != types.SyncStatusMissing {
		t.Errorf("角色B 应 Missing: %+v", it)
	}
	if it, ok := byName["角色C"]; !ok || it.Status != types.SyncStatusOptional {
		t.Errorf("角色C 应 Optional: %+v", it)
	}

	// 独立类型 CustomAnim：不应返回任何 EntityPlayer 条目
	caInst := filepath.Join(base, "inst", "CustomAnim")
	_ = os.MkdirAll(caInst, 0755)
	_ = os.WriteFile(filepath.Join(epGlobal, "walk.vmd"), []byte("vmd"), 0644)

	items2 := BuildSyncItems(ins,
		[]ResourceTypeInfo{{ID: "CustomAnim", Icon: "🎬"}},
		map[string]string{"CustomAnim": epGlobal}, "")

	for _, it := range items2 {
		if strings.Contains(it.Path, "EntityPlayer") {
			t.Errorf("CustomAnim 类型不应返回 EntityPlayer 条目: %s", it.Path)
		}
	}
	foundWalk := false
	for _, it := range items2 {
		if it.Name == "walk.vmd" && it.Status == types.SyncStatusMissing {
			foundWalk = true
		}
	}
	if !foundWalk {
		t.Errorf("walk.vmd 应 Missing（CustomAnim 独立类型），实际: %+v", items2)
	}
}

// TestBuildSyncItems_DisabledThreeBranches 三分支口径一致：
// Synced .disabled / Missing .ban / Extra .ban（L85-88/L105-108/新增 Extra 分支）均应标 Disabled ⛔
func TestBuildSyncItems_DisabledThreeBranches(t *testing.T) {
	sub := types.SubDirMap("ysm")
	if sub == "" {
		t.Skip("ysm 无 InstanceDir 配置，跳过")
	}
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")
	instDir := filepath.Join(filepath.Join(base, "inst"), sub)
	if err := os.MkdirAll(globalDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(instDir, 0755); err != nil {
		t.Fatal(err)
	}
	// Synced + disabled：两处一致
	_ = os.WriteFile(filepath.Join(globalDir, "synced.ysm.disabled"), []byte("x"), 0644)
	_ = os.WriteFile(filepath.Join(instDir, "synced.ysm.disabled"), []byte("x"), 0644)
	// Missing + ban：全局有、整合包没有
	_ = os.WriteFile(filepath.Join(globalDir, "missing.ysm.ban"), []byte("x"), 0644)
	// Extra + ban：整合包有、全局没有（isDisabled 检测新增覆盖）
	_ = os.WriteFile(filepath.Join(instDir, "extra.ysm.ban"), []byte("x"), 0644)
	// 对照组：正常 Synced 不受影响
	_ = os.WriteFile(filepath.Join(globalDir, "active.ysm"), []byte("x"), 0644)
	_ = os.WriteFile(filepath.Join(instDir, "active.ysm"), []byte("x"), 0644)

	ins := &types.VersionInstance{Name: "t", VersionDir: filepath.Join(base, "inst")}
	items := BuildSyncItems(ins, []ResourceTypeInfo{{ID: "ysm", Icon: "📦"}}, map[string]string{"ysm": globalDir}, "")
	byName := map[string]types.ResourceSyncItem{}
	for _, it := range items {
		byName[it.Name] = it
	}
	for _, name := range []string{"synced.ysm.disabled", "missing.ysm.ban", "extra.ysm.ban"} {
		it, ok := byName[name]
		if !ok {
			t.Fatalf("%s 应产出条目（三分支 disabled 口径一致），实际缺失", name)
		}
		if it.Status != types.SyncStatusDisabled {
			t.Errorf("%s 应 Disabled，实际 %q", name, it.Status)
		}
		if it.Icon != "⛔" {
			t.Errorf("%s 应 ⛔ 图标，实际 %q", name, it.Icon)
		}
	}
	if it, ok := byName["active.ysm"]; !ok || it.Status != types.SyncStatusSynced {
		t.Fatalf("active.ysm 应 Synced: %+v", it)
	}
}

// TestBuildSyncItems_ExtraHardLinkLegacy Extra 硬链接（nlink>1）→ SyncStatusLegacy（L121-124 分支）
func TestBuildSyncItems_ExtraHardLinkLegacy(t *testing.T) {
	sub := types.SubDirMap("ysm")
	if sub == "" {
		t.Skip("ysm 无 InstanceDir 配置，跳过")
	}
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")
	instDir := filepath.Join(filepath.Join(base, "inst"), sub)
	if err := os.MkdirAll(globalDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(instDir, 0755); err != nil {
		t.Fatal(err)
	}
	legacy := filepath.Join(instDir, "legacy.ysm")
	if err := os.WriteFile(legacy, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	// 建立真实硬链接使 nlink=2（跨平台 os.Link，Windows NTFS 亦支持）
	if err := os.Link(legacy, filepath.Join(instDir, "legacy2.ysm")); err != nil {
		t.Skipf("无法创建硬链接（文件系统不支持）: %v", err)
	}
	ins := &types.VersionInstance{Name: "t", VersionDir: filepath.Join(base, "inst")}
	items := BuildSyncItems(ins, []ResourceTypeInfo{{ID: "ysm", Icon: "📦"}}, map[string]string{"ysm": globalDir}, "")
	found := 0
	for _, it := range items {
		if it.Name == "legacy.ysm" && it.Status == types.SyncStatusLegacy {
			found++
		}
	}
	if found != 1 {
		t.Fatalf("硬链接 Extra 文件应恰好 1 条 Legacy，实际 %d（全部: %+v）", found, items)
	}
}

// TestBuildSyncItems_YsmJSONEntryOnly ysm 的 .json 仅放行 ysm.json：
// anim.json 不展示，ysm.json（含缺失态）正常展示（L41-43 分支）
func TestBuildSyncItems_YsmJSONEntryOnly(t *testing.T) {
	sub := types.SubDirMap("ysm")
	if sub == "" {
		t.Skip("ysm 无 InstanceDir 配置，跳过")
	}
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")
	instDir := filepath.Join(filepath.Join(base, "inst"), sub)
	if err := os.MkdirAll(globalDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(instDir, 0755); err != nil {
		t.Fatal(err)
	}
	// ysm.json：全局有、实例缺 → Missing 展示
	_ = os.WriteFile(filepath.Join(globalDir, "ysm.json"), []byte("{}"), 0644)
	// anim.json：全局有、实例缺 → 不应展示（非 ysm.json 的 .json 不单独展示）
	_ = os.WriteFile(filepath.Join(globalDir, "anim.json"), []byte("{}"), 0644)

	ins := &types.VersionInstance{Name: "t", VersionDir: filepath.Join(base, "inst")}
	items := BuildSyncItems(ins, []ResourceTypeInfo{{ID: "ysm", Icon: "📦"}}, map[string]string{"ysm": globalDir}, "")
	byName := map[string]types.ResourceSyncItem{}
	for _, it := range items {
		byName[it.Name] = it
	}
	if it, ok := byName["ysm.json"]; !ok || it.Status != types.SyncStatusMissing {
		t.Fatalf("ysm.json 应 Missing 展示: %+v", it)
	}
	if _, ok := byName["anim.json"]; ok {
		t.Fatalf("anim.json 不应单独展示（仅 ysm.json 放行）: %+v", byName["anim.json"])
	}
}

// TestBuildSyncItems_SyncedFileNoDup 同名文件两侧一致 → Synced 恰好 1 条：
// 由 SyncResources 相对路径对比保证。2026-08-23 收敛：resourcepack 不再兜底，
// 文件必须位于标准 resourcepacks 目录（全局侧 global + 实例侧 inst/resourcepacks）。
func TestBuildSyncItems_SyncedFileNoDup(t *testing.T) {
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")
	instDir := filepath.Join(base, "resourcepacks")
	if err := os.MkdirAll(globalDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(instDir, 0755); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(globalDir, "pack.zip"), []byte("zip"), 0644)
	_ = os.WriteFile(filepath.Join(instDir, "pack.zip"), []byte("zip"), 0644)
	ins := &types.VersionInstance{VersionDir: base}
	items := BuildSyncItems(ins, []ResourceTypeInfo{{ID: "resourcepack", Icon: "🎨"}}, map[string]string{"resourcepack": globalDir}, "")
	count := 0
	for _, it := range items {
		if it.Name == "pack.zip" {
			count++
			if it.Status != types.SyncStatusSynced {
				t.Errorf("pack.zip 应 Synced（相对路径对比），实际 %q", it.Status)
			}
		}
	}
	if count != 1 {
		t.Fatalf("pack.zip 应恰好 1 条，实际 %d 条: %+v", count, items)
	}
}

// TestBuildSyncItems_DirLevelChildren 验证 dirLevelSync 类型的 Synced 文件夹
// 会自动填充 children 字段，包含文件夹内部文件的真实同步状态
func TestBuildSyncItems_DirLevelChildren(t *testing.T) {
	sub := types.SubDirMap("ysm")
	if sub == "" {
		t.Skip("ysm 无 InstanceDir 配置，跳过")
	}
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")
	instDir := filepath.Join(filepath.Join(base, "inst"), sub)

	// 创建全局文件夹 packA，包含 3 个 .ysm 文件
	globalPack := filepath.Join(globalDir, "packA")
	_ = os.MkdirAll(globalPack, 0755)
	_ = os.WriteFile(filepath.Join(globalPack, "model_a.ysm"), []byte("a"), 0644)
	_ = os.WriteFile(filepath.Join(globalPack, "model_b.ysm"), []byte("b"), 0644)
	_ = os.WriteFile(filepath.Join(globalPack, "model_c.ysm"), []byte("c"), 0644)

	// 创建实例文件夹 packA，包含 2 个 .ysm 文件（缺 model_c，多 model_d）
	instPack := filepath.Join(instDir, "packA")
	_ = os.MkdirAll(instPack, 0755)
	_ = os.WriteFile(filepath.Join(instPack, "model_a.ysm"), []byte("a"), 0644)
	_ = os.WriteFile(filepath.Join(instPack, "model_b.ysm"), []byte("b"), 0644)
	_ = os.WriteFile(filepath.Join(instPack, "model_d.ysm"), []byte("d"), 0644)

	ins := &types.VersionInstance{Name: "t", VersionDir: filepath.Join(base, "inst")}
	items := BuildSyncItems(ins, []ResourceTypeInfo{{ID: "ysm", Icon: "📦"}}, map[string]string{"ysm": globalDir}, "")

	// 找到 packA 条目
	var packItem *types.ResourceSyncItem
	for i := range items {
		if items[i].Name == "packA" {
			packItem = &items[i]
			break
		}
	}
	if packItem == nil {
		t.Fatal("未找到 packA 条目")
	}

	// 验证 packA 是 Diverged 状态（子文件有 missing/optional 差异）
	if packItem.Status != types.SyncStatusDiverged {
		t.Errorf("packA 应为 Diverged（有内容差异），实际 %s", packItem.Status)
	}

	// 验证 IsDir 为 true
	if !packItem.IsDir {
		t.Error("packA 的 IsDir 应为 true")
	}

	// 验证 children 不为空
	if len(packItem.Children) == 0 {
		t.Fatal("packA 的 children 应为空（包含子文件差异）")
	}

	t.Logf("packA children 数量: %d", len(packItem.Children))
	for _, child := range packItem.Children {
		t.Logf("  child: name=%s status=%s", child.Name, child.Status)
	}

	// 验证子文件状态
	childByName := map[string]types.SyncStatus{}
	for _, child := range packItem.Children {
		childByName[child.Name] = child.Status
	}

	// model_a 和 model_b 应是 synced
	if status, ok := childByName["model_a.ysm"]; !ok || status != types.SyncStatusSynced {
		t.Errorf("model_a.ysm 应为 synced，实际 %v", status)
	}
	if status, ok := childByName["model_b.ysm"]; !ok || status != types.SyncStatusSynced {
		t.Errorf("model_b.ysm 应为 synced，实际 %v", status)
	}
	// model_c 应是 missing
	if status, ok := childByName["model_c.ysm"]; !ok || status != types.SyncStatusMissing {
		t.Errorf("model_c.ysm 应为 missing，实际 %v", status)
	}
	// model_d 应是 optional
	if status, ok := childByName["model_d.ysm"]; !ok || status != types.SyncStatusOptional {
		t.Errorf("model_d.ysm 应为 optional，实际 %v", status)
	}
}

// TestBuildSyncItems_DirLevelNoChildrenForMissing 验证 Missing 文件夹不会填充 children
// 因为只对 Synced 文件夹做内容级 diff（Missing 文件夹不存在于实例侧）
func TestBuildSyncItems_DirLevelNoChildrenForMissing(t *testing.T) {
	sub := types.SubDirMap("ysm")
	if sub == "" {
		t.Skip("ysm 无 InstanceDir 配置，跳过")
	}
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")

	// 创建全局文件夹 packB（实例侧没有）
	globalPack := filepath.Join(globalDir, "packB")
	_ = os.MkdirAll(globalPack, 0755)
	_ = os.WriteFile(filepath.Join(globalPack, "model_x.ysm"), []byte("x"), 0644)

	ins := &types.VersionInstance{Name: "t", VersionDir: filepath.Join(base, "inst")}
	items := BuildSyncItems(ins, []ResourceTypeInfo{{ID: "ysm", Icon: "📦"}}, map[string]string{"ysm": globalDir}, "")

	// 找到 packB 条目
	var packItem *types.ResourceSyncItem
	for i := range items {
		if items[i].Name == "packB" {
			packItem = &items[i]
			break
		}
	}
	if packItem == nil {
		t.Fatal("未找到 packB 条目")
	}

	// packB 应是 Missing 状态（整体缺失，不降级为 diverged）
	if packItem.Status != types.SyncStatusMissing {
		t.Errorf("packB 应为 Missing，实际 %s", packItem.Status)
	}

	// Missing 文件夹仍应展示仓库侧子项清单（仓库是权威源，待推送内容可预览）
	// 子项均标 missing（实例侧不存在）
	if len(packItem.Children) == 0 {
		t.Errorf("Missing 文件夹应展示仓库侧 children（待推送预览），实际为空")
	}
	for _, c := range packItem.Children {
		if c.Status != types.SyncStatusMissing {
			t.Errorf("Missing 夹子项 %q 应为 missing，实际 %q", c.Name, c.Status)
		}
	}
}

// TestBuildSyncItems_MissingDirRepoPreview 验证「仓库有完整层级、整合包不可见」的真实模型文件夹
// 场景：[Almeta_owx]【galgame】类：仓库根下真模型夹直接含多个 .ysm + 贴图，实例侧缺失 →
// 夹子保持 missing（整体缺失、非部分差异），展开的 children 从仓库侧列全部子项（标 missing）供预览
func TestBuildSyncItems_MissingDirRepoPreview(t *testing.T) {
	sub := types.SubDirMap("ysm")
	if sub == "" {
		t.Skip("ysm 无 InstanceDir 配置，跳过")
	}
	if !types.IsDirLevelSync("ysm") {
		t.Skip("ysm 非 dirLevel 类型，跳过")
	}
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")
	instDir := filepath.Join(filepath.Join(base, "inst"), sub)
	_ = os.MkdirAll(instDir, 0755)

	// 仓库根下真模型夹（无子目录，直接含 .ysm + 贴图），实例侧无此夹
	pack := filepath.Join(globalDir, "[Almeta_owx]【galgame】")
	_ = os.MkdirAll(pack, 0755)
	_ = os.WriteFile(filepath.Join(pack, "Eanes2024-10.ysm"), []byte("e"), 0644)
	_ = os.WriteFile(filepath.Join(pack, "丛雨-常服murasame2023-05.ysm"), []byte("m"), 0644)
	_ = os.WriteFile(filepath.Join(pack, "Eanes_45.png"), []byte("png"), 0644)

	ins := &types.VersionInstance{Name: "t", VersionDir: filepath.Join(base, "inst")}
	items := BuildSyncItems(ins, []ResourceTypeInfo{{ID: "ysm", Icon: "💎"}}, map[string]string{"ysm": globalDir}, "")

	// 找到真模型夹条目（顶层，因它自身是模型夹含 .ysm → 收集为单元，非容器）
	var packItem *types.ResourceSyncItem
	for i := range items {
		if items[i].Name == "[Almeta_owx]【galgame】" {
			packItem = &items[i]
			break
		}
	}
	if packItem == nil {
		t.Fatal("未找到 [Almeta_owx]【galgame】 条目")
	}
	// 整体缺失 → 保持 missing（不降级 diverged）；isDir 可展开
	if packItem.Status != types.SyncStatusMissing {
		t.Errorf("缺失真模型夹应保持 missing，实际 %q", packItem.Status)
	}
	if !packItem.IsDir {
		t.Error("缺失真模型夹 IsDir 应为 true（可展开预览）")
	}
	// 文件夹图标应为 📁（非类型图标 💎）——文件夹用文件夹图标，扁平文件才用类型图标
	if packItem.Icon != "📁" {
		t.Errorf("缺失真模型夹图标应为 📁，实际 %q", packItem.Icon)
	}
	// children 从仓库侧列出内部模型文件（可预览待推内容）
	if len(packItem.Children) == 0 {
		t.Fatal("缺失模型夹应展示仓库侧 children（预览待推清单）")
	}
	childByName := map[string]types.SyncStatus{}
	for _, c := range packItem.Children {
		childByName[c.Name] = c.Status
	}
	for _, fn := range []string{"Eanes2024-10.ysm", "丛雨-常服murasame2023-05.ysm"} {
		if st, ok := childByName[fn]; !ok || st != types.SyncStatusMissing {
			t.Errorf("待推文件 %q 应为 missing（仓库侧预览），实际 %v", fn, st)
		}
	}
}

// TestBuildSyncItems_NestedContainerDir 验证中间目录（仅含子模型文件夹、自身非模型文件夹）
// 在展示层重建为容器节点：父夹作为可展开 isDir 项，子模型夹挂为 children
// 场景：[YSM模型]官方开源wine_fox_json/ {01_taisho_maid, 02_new_year} 各含 .ysm
// wine_fox_json 自身不直接含模型文件 → 不应被作为独立同步单元，而应作为容器
func TestBuildSyncItems_NestedContainerDir(t *testing.T) {
	sub := types.SubDirMap("ysm")
	if sub == "" {
		t.Skip("ysm 无 InstanceDir 配置，跳过")
	}
	if !types.IsDirLevelSync("ysm") {
		t.Skip("ysm 非 dirLevel 类型，跳过")
	}
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")
	instDir := filepath.Join(filepath.Join(base, "inst"), sub)
	_ = os.MkdirAll(instDir, 0755)

	// 全局：父夹 wine_fox_json 下有两个子模型夹，各自含 .ysm（实例侧空 → 全 missing）
	parent := filepath.Join(globalDir, "[YSM模型]官方开源wine_fox_json")
	for _, name := range []string{"01_taisho_maid", "02_new_year"} {
		child := filepath.Join(parent, name)
		_ = os.MkdirAll(child, 0755)
		_ = os.WriteFile(filepath.Join(child, name+".ysm"), []byte("m"), 0644)
	}

	ins := &types.VersionInstance{Name: "t", VersionDir: filepath.Join(base, "inst")}
	items := BuildSyncItems(ins, []ResourceTypeInfo{{ID: "ysm", Icon: "📦"}}, map[string]string{"ysm": globalDir}, "")

	// 顶层应只出现父夹容器（2 个子夹被收入其中，不再平铺在根）
	if len(items) != 1 {
		t.Fatalf("应只返回 1 个顶层容器（父夹），实际 %d 条: %+v", len(items), items)
	}
	parentItem := items[0]
	if parentItem.Name != "[YSM模型]官方开源wine_fox_json" {
		t.Errorf("顶层应为父夹容器，got %q", parentItem.Name)
	}
	if !parentItem.IsDir {
		t.Error("父夹容器 IsDir 应为 true")
	}
	// 容器聚合状态：子夹均 missing（实例空）→ 整体有可推送差异
	if parentItem.Status != types.SyncStatusDiverged && parentItem.Status != types.SyncStatusMissing {
		t.Errorf("父夹容器应聚合为 diverged/missing（子夹缺失），got %q", parentItem.Status)
	}
	// children 应为两个子模型夹，不再平铺在根
	if len(parentItem.Children) != 2 {
		t.Fatalf("父夹容器应有 2 个 children（子模型夹），实际 %d", len(parentItem.Children))
	}
	childNames := map[string]bool{}
	for _, c := range parentItem.Children {
		childNames[c.Name] = true
		if !c.IsDir {
			t.Errorf("子模型夹 %q IsDir 应为 true", c.Name)
		}
	}
	if !childNames["01_taisho_maid"] || !childNames["02_new_year"] {
		t.Errorf("children 应含两个子模型夹，实际 %v", childNames)
	}
}

// TestBuildSyncItems_NestedContainer_DeepHierarchy 验证多层嵌套镜像磁盘层级
// 仓库怎么来，整合包就怎么来：每一层中间目录都建为可展开容器
func TestBuildSyncItems_NestedContainer_DeepHierarchy(t *testing.T) {
	sub := types.SubDirMap("ysm")
	if sub == "" {
		t.Skip("ysm 无 InstanceDir 配置，跳过")
	}
	if !types.IsDirLevelSync("ysm") {
		t.Skip("ysm 非 dirLevel 类型，跳过")
	}
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")
	instDir := filepath.Join(filepath.Join(base, "inst"), sub)
	_ = os.MkdirAll(instDir, 0755)

	// 深度嵌套：vendor/authors/character/model.ysm（实例空 → 全 missing）
	deep := filepath.Join(globalDir, "vendor", "authors", "character")
	_ = os.MkdirAll(deep, 0755)
	_ = os.WriteFile(filepath.Join(deep, "model.ysm"), []byte("m"), 0644)

	ins := &types.VersionInstance{Name: "t", VersionDir: filepath.Join(base, "inst")}
	items := BuildSyncItems(ins, []ResourceTypeInfo{{ID: "ysm", Icon: "📦"}}, map[string]string{"ysm": globalDir}, "")

	// 顶层：vendor（容器），其下 authors → character（模型文件夹叶子），逐步下钻
	if len(items) != 1 {
		t.Fatalf("顶层应为 vendor 容器，实际 %d 条", len(items))
	}
	vendor := items[0]
	if vendor.Name != "vendor" || !vendor.IsDir {
		t.Fatalf("vendor 应为容器，got %+v", vendor)
	}
	if len(vendor.Children) != 1 {
		t.Fatalf("vendor.children 应为 authors，实际 %d", len(vendor.Children))
	}
	authors := vendor.Children[0]
	if authors.Name != "authors" || !authors.IsDir {
		t.Fatalf("authors 应为容器，got %+v", authors)
	}
	if len(authors.Children) != 1 {
		t.Fatalf("authors.children 应为 character，实际 %d", len(authors.Children))
	}
	char := authors.Children[0]
	if char.Name != "character" || !char.IsDir {
		t.Fatalf("character 应为模型文件夹叶子，got %+v", char)
	}
	if char.Status != types.SyncStatusMissing {
		t.Errorf("character 应为 missing（实例空），got %q", char.Status)
	}
}
