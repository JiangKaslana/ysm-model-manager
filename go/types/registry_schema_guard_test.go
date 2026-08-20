package types

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

// guardViolations 解析注册表 payload 并运行 schema 守卫，返回违规列表。
// 直接调用 validateRegistrySchema，不依赖 LoadRegistry 的全局日志/缓存——
// 单条目注册表同样受检（回归：守卫曾被嵌套在去重 if 内，仅多条目注册表触发，
// 导致单条目违规静默通过）。
func guardViolations(t *testing.T, payload string) []string {
	t.Helper()
	var reg ResourceTypeRegistry
	if err := json.Unmarshal([]byte(payload), &reg); err != nil {
		t.Fatalf("payload 解析失败: %v", err)
	}
	return validateRegistrySchema(&reg)
}

// hasViolation 检查违规列表是否含包含 substr 的条目。
func hasViolation(violations []string, substr string) bool {
	for _, v := range violations {
		if strings.Contains(v, substr) {
			return true
		}
	}
	return false
}

// writeTempRegistry 把 payload 写到临时文件并设为注册表路径（LoadRegistry 集成测试用）。
func writeTempRegistry(t *testing.T, payload string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "resource_types.json")
	if err := os.WriteFile(path, []byte(payload), 0o644); err != nil {
		t.Fatal(err)
	}
	SetRegistryPath(path)
	return path
}

// ===== 守卫 1：壳类型（有 subtypes）禁止带 storageSubDir / configField =====

func TestSchemaGuard_ShellTypeWithStorageSubDir_Warns(t *testing.T) {
	// 单条目注册表（去重 if 不触发）也必须走守卫——回归用例
	payload := `{
		"resourceTypes": [
			{
				"id": "shell-evil", "name": "壳越权", "group": "g",
				"storageSubDir": "should-not-be-here",
				"subtypes": [{"name": "Sub", "label": "子", "extensions": [".x"]}]
			}
		]
	}`
	violations := guardViolations(t, payload)
	if !hasViolation(violations, "shell-evil") || !hasViolation(violations, "storageSubDir") {
		t.Fatalf("期望壳越权 storageSubDir 违规，实际: %v", violations)
	}
}

func TestSchemaGuard_ShellTypeWithConfigField_Warns(t *testing.T) {
	payload := `{
		"resourceTypes": [
			{
				"id": "shell-cfg", "name": "壳越权配置", "group": "g",
				"configField": "EvilRoot",
				"subtypes": [{"name": "Sub", "label": "子", "extensions": [".x"]}]
			}
		]
	}`
	violations := guardViolations(t, payload)
	if !hasViolation(violations, "shell-cfg") || !hasViolation(violations, "configField") {
		t.Fatalf("期望壳越权 configField 违规，实际: %v", violations)
	}
}

func TestSchemaGuard_LeafTypeWithStorageSubDir_NoWarn(t *testing.T) {
	// 叶类型（无 subtypes）带 storageSubDir 是合法的——不应触发壳越权违规
	payload := `{
		"resourceTypes": [
			{"id": "leaf-ok", "name": "合法叶", "group": "g", "storageSubDir": "leafs", "extensions": [".l"]}
		]
	}`
	violations := guardViolations(t, payload)
	if hasViolation(violations, "越权") {
		t.Fatalf("合法叶不应触发壳越权违规，实际: %v", violations)
	}
}

func TestSchemaGuard_ShellTypeWithScanDirs_NoWarn(t *testing.T) {
	// 豁免：壳带 installDir/scanDir 合法——整合包实例扫描按壳聚合消费
	// （browser-adapter 契约钉死 create-blueprint→schematics），非落盘越权
	payload := `{
		"resourceTypes": [
			{
				"id": "shell-dir", "name": "壳聚合", "group": "g",
				"installDir": "schematics/", "scanDir": "schematics",
				"instanceLevel": false, "scanInstance": true, "dirLevelSync": true,
				"subtypes": [{"name": "Sub", "label": "子", "extensions": [".x"]}]
			}
		]
	}`
	violations := guardViolations(t, payload)
	if len(violations) != 0 {
		t.Fatalf("壳带 installDir/scanDir + 豁免标记不应触发违规，实际: %v", violations)
	}
}

func TestSchemaGuard_ShellTypeWithHashable_Warns(t *testing.T) {
	// 壳带 hashable（哈希策略）→ 白名单违规（叶 blueprint 已覆写，壳不得双写）
	payload := `{
		"resourceTypes": [
			{
				"id": "shell-hash", "name": "壳越权哈希", "group": "g",
				"hashable": true,
				"subtypes": [{"name": "Sub", "label": "子", "extensions": [".x"]}]
			}
		]
	}`
	violations := guardViolations(t, payload)
	if !hasViolation(violations, "hashable") {
		t.Fatalf("期望壳越权 hashable 违规，实际: %v", violations)
	}
}

func TestSchemaGuard_ShellTypeWithConfigFallback_Warns(t *testing.T) {
	// 壳带 configFallback（回退链）→ 白名单违规
	payload := `{
		"resourceTypes": [
			{
				"id": "shell-fb", "name": "壳越权回退", "group": "g",
				"configFallback": "MmdRoot",
				"subtypes": [{"name": "Sub", "label": "子", "extensions": [".x"]}]
			}
		]
	}`
	violations := guardViolations(t, payload)
	if !hasViolation(violations, "configFallback") {
		t.Fatalf("期望壳越权 configFallback 违规，实际: %v", violations)
	}
}

// ===== 守卫 2：storageSubDir 全局唯一 =====

func TestSchemaGuard_DuplicateStorageSubDir_Warns(t *testing.T) {
	payload := `{
		"resourceTypes": [
			{"id": "a", "name": "A", "group": "g", "storageSubDir": "dup", "extensions": [".a"]},
			{"id": "b", "name": "B", "group": "g", "storageSubDir": "dup", "extensions": [".b"]}
		]
	}`
	violations := guardViolations(t, payload)
	if !hasViolation(violations, "dup") || !hasViolation(violations, "存储路径冲突") {
		t.Fatalf("期望 storageSubDir 重复违规，实际: %v", violations)
	}
}

func TestSchemaGuard_UniqueStorageSubDir_NoWarn(t *testing.T) {
	payload := `{
		"resourceTypes": [
			{"id": "a", "name": "A", "group": "g", "storageSubDir": "alpha", "extensions": [".a"]},
			{"id": "b", "name": "B", "group": "g", "storageSubDir": "beta", "extensions": [".b"]}
		]
	}`
	violations := guardViolations(t, payload)
	if hasViolation(violations, "存储路径冲突") {
		t.Fatalf("唯一 storageSubDir 不应触发冲突违规，实际: %v", violations)
	}
}

// ===== 守卫 3：configField 全局唯一 =====

func TestSchemaGuard_DuplicateConfigField_Warns(t *testing.T) {
	payload := `{
		"resourceTypes": [
			{"id": "a", "name": "A", "group": "g", "configField": "SharedRoot", "extensions": [".a"]},
			{"id": "b", "name": "B", "group": "g", "configField": "SharedRoot", "extensions": [".b"]}
		]
	}`
	violations := guardViolations(t, payload)
	if !hasViolation(violations, "SharedRoot") || !hasViolation(violations, "配置槽查询歧义") {
		t.Fatalf("期望 configField 重复违规，实际: %v", violations)
	}
}

// ===== 合法注册表通过（零违规）=====

func TestSchemaGuard_CleanRegistry_NoWarn(t *testing.T) {
	// 壳无 storageSubDir/configField；叶各自唯一——零违规
	payload := `{
		"resourceTypes": [
			{
				"id": "shell-clean", "name": "合法壳", "group": "g",
				"subtypes": [{"name": "Sub", "label": "子", "extensions": [".x"]}]
			},
			{"id": "leaf1", "name": "叶1", "group": "g", "storageSubDir": "l1", "configField": "L1Root", "extensions": [".1"]},
			{"id": "leaf2", "name": "叶2", "group": "g", "storageSubDir": "l2", "configField": "L2Root", "extensions": [".2"]}
		]
	}`
	violations := guardViolations(t, payload)
	if len(violations) != 0 {
		t.Fatalf("合法注册表不应触发任何违规，实际: %v", violations)
	}
}

// ===== subDirGrouping 豁免：真实落盘叶允许 configField（mmd-skin 形态）=====

func TestSchemaGuard_SubDirGroupingTypeWithConfigField_NoWarn(t *testing.T) {
	// subDirGrouping 类型（有 subtypes 但真实落盘）不算装饰壳——configField 合法
	payload := `{
		"resourceTypes": [
			{
				"id": "mmd-skin", "name": "MMD", "group": "mmd",
				"subDirGrouping": true,
				"configField": "MmdRoot",
				"subtypes": [
					{"name": "EntityPlayer", "label": "角色", "extensions": [".pmx"]},
					{"name": "SceneModel", "label": "场景", "extensions": [".pmx"]}
				]
			}
		]
	}`
	violations := guardViolations(t, payload)
	if hasViolation(violations, "越权") {
		t.Fatalf("subDirGrouping 类型带 configField 不应触发壳越权违规，实际: %v", violations)
	}
}

// ===== 守卫 4：configFallback 引用完整性 =====

func TestSchemaGuard_ConfigFallbackResolves_NoWarn(t *testing.T) {
	// VrcRoot→MmdRoot 形态：回退字段指向已声明的 configField
	payload := `{
		"resourceTypes": [
			{"id": "mmd", "name": "MMD", "group": "mmd", "configField": "MmdRoot", "storageSubDir": "mmd", "extensions": [".pmx"]},
			{"id": "vrc", "name": "VRC", "group": "mmd", "configField": "VrcRoot", "configFallback": "MmdRoot", "storageSubDir": "vrc", "extensions": [".vrm"]}
		]
	}`
	violations := guardViolations(t, payload)
	if hasViolation(violations, "孤儿回退") {
		t.Fatalf("configFallback 指向存在字段不应触发孤儿回退违规，实际: %v", violations)
	}
}

func TestSchemaGuard_ConfigFallbackOrphan_Warns(t *testing.T) {
	// configFallback 指向无人声明的字段 → 孤儿回退
	payload := `{
		"resourceTypes": [
			{"id": "vrc", "name": "VRC", "group": "mmd", "configField": "VrcRoot", "configFallback": "GhostRoot", "storageSubDir": "vrc", "extensions": [".vrm"]}
		]
	}`
	violations := guardViolations(t, payload)
	if !hasViolation(violations, "GhostRoot") || !hasViolation(violations, "孤儿回退") {
		t.Fatalf("期望 configFallback 孤儿回退违规，实际: %v", violations)
	}
}

// ===== 集成：LoadRegistry 完整链路——守卫只告警不阻断、不改数据 =====

func TestSchemaGuard_LoadRegistryIntegration(t *testing.T) {
	payload := `{
		"resourceTypes": [
			{
				"id": "shell-x", "name": "壳", "group": "g",
				"storageSubDir": "evil",
				"subtypes": [{"name": "Sub", "label": "子", "extensions": [".x"]}]
			},
			{"id": "leaf", "name": "叶", "group": "g", "storageSubDir": "ok", "extensions": [".l"]}
		]
	}`
	writeTempRegistry(t, payload)
	defer SetRegistryPath("")

	reg := LoadRegistry()
	if got := len(reg.ResourceTypes); got != 2 {
		t.Fatalf("ResourceTypes 长度 = %d，期望 2", got)
	}
	// 守卫只告警不改数据——壳越权的 storageSubDir 仍应可读
	rt := RegistryType("shell-x")
	if rt == nil {
		t.Fatal("RegistryType('shell-x') 应为非 nil")
	}
	if rt.StorageSubDir != "evil" {
		t.Errorf("shell-x.StorageSubDir = %q，期望 'evil'（守卫不改数据）", rt.StorageSubDir)
	}
}

// ===== 并发安全：守卫/加载在多 goroutine 下不 panic =====

func TestSchemaGuard_ConcurrentLoadNoPanic(t *testing.T) {
	payload := `{
		"resourceTypes": [
			{"id": "a", "name": "A", "group": "g", "storageSubDir": "dup", "extensions": [".a"]},
			{"id": "b", "name": "B", "group": "g", "storageSubDir": "dup", "extensions": [".b"]}
		]
	}`
	writeTempRegistry(t, payload)
	defer SetRegistryPath("")

	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			LoadRegistry()
		}()
	}
	wg.Wait()
}
