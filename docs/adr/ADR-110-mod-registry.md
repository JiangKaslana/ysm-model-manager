# ADR-110：mod 依赖下沉注册表，消除 Go 硬编码

- **状态**：✅ 已采纳
- **日期**：2026-08-21
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`ADR-095` `ADR-111`

---

## 1. 背景（Context）

此前 mod 依赖分散在 `go/ysm/ysm.go` 的三个硬编码 map：

```go
var ModKeywords = map[string][]string{...}      // 文件名关键词
var ModGroupKeywords = map[string][]string{...} // 组级回退
var ModMeta = map[string]struct{...}{...}       // 内容检测型
```

**问题**：
- 新增资源类型必须改 Go 代码（如 `vrchat-avatar` 的 `"vrchat"` 关键词是死代码）
- 组级回退逻辑散在 `HasModInDir` 函数里，MMD 子类型新增时容易遗漏
- 注册表 `resource_types.json` 无法表达 mod 依赖，数据与逻辑分离

---

## 2. 决策（Decision）

### 2.1 注册表 schema 新增 `mod` 字段

```jsonc
{
  "id": "EntityPlayer",
  "mod": {
    "jarKeywords": ["mmdskin", "mmd-skin"]
  }
}
// 或内容检测型
{
  "id": "maid-model",
  "mod": {
    "modId": "touhou_little_maid",
    "displayName": "Touhou Little Maid"
  }
}
```

### 2.2 `ModRequirement` struct

```go
type ModRequirement struct {
    JarKeywords []string `json:"jarKeywords,omitempty"`
    ModID       string   `json:"modId,omitempty"`
    DisplayName string   `json:"displayName,omitempty"`
}
```

### 2.3 查询函数

- `ModKeywordsFor(rtype string) []string`：类型自身 → 组级回退 → nil
- `ModMetaFor(rtype string) (modID, displayName string)`

### 2.4 删除硬编码

- 删除 `ModKeywords` / `ModGroupKeywords` / `ModMeta`
- `HasModInDir` 改读注册表

---

## 3. 后果（Consequences）

- **正面**：新增类型只改 JSON，无需改 Go；组级回退自动生效
- **负面**：注册表 schema 变更，需同步 `ResourceType` struct
- **改动面**：`go/types/resource.go` + `go/ysm/ysm.go` + `resource_types.json`

---

## 4. 实施

已落地（commit `39ea7b72`）：
- `resource_types.json` 各类型加 `mod` 字段
- `go/types` 新增 `ModRequirement` + `ModKeywordsFor` / `ModMetaFor`
- `go/ysm` 删除硬编码，`HasModInDir` 改读注册表
