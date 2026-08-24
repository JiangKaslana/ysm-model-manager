# ADR-068：统一容器桥接层：ContainerReader 抽象收敛 ysm/geometry/avatar 解包重复

- **状态**：✅ 已采纳
- **日期**：2026-08-16
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`docs/adr/ADR-067-zip-packaged-resource-detection.md`、`go/geometry/archive.go`、`go/ysm/summary.go`、`go/ysm/parse.go`、`go/ysm/texsize.go`、`go/avatar/avatar_extract.go`、`go/packs/mcmeta.go`

---

## 1. 背景（Context）

### 1.1 容器解包重复 10-12 处，无统一桥接

全 `go/` 目录"打开容器→找条目"的实现分散在各包各自实现（ADR-067 调研实测）：

| 打开方式 | 数量 | 分布 |
|---------|------|------|
| `zip.OpenReader` | 10 处（生产） | packs ×6、ysm ×4（summary/parse/ysm/texsize） |
| `zip.NewReader(bytes)`（内存） | 6 处 | geometry ×4、avatar ×2 |
| `sevenzip` | 5 处 | geometry ×4、ysm ×1 |
| `gzip.NewReader`（单文件流） | 1 处 | litematic（三格式共用，唯一良好范例） |

- **`go/packs/mcmeta.go`**：ADR-067 S5 已把 4 个检测函数（matchZipArchive/isYsmFile/hasMcmeta/hasShaders）收敛到 `zipEntryMatch` 轻量 helper——检测层已统一。
- **`go/ysm/summary.go`**：同一容器**遍历 3 次**（找 ysm.json → 数 geometry → 找 geo 尺寸），每次 `zip.OpenReader`。
- **`go/geometry/archive.go`**：`collectArchiveFiles` 已是格式无关内核（zip/7z 共用 `FileInfo()/Open()` 接口），但外层 `ParseFromZip`/`ParseFrom7z`/`ParseComponentsFromZip`/`ParseComponentsFrom7z` 四个函数仍各自 newReader 重复外壳，7z 版 ~300 行与 zip 版逐行对称。
- **`go/avatar/avatar_extract.go`**：2 处 `zip.NewReader(bytes.NewReader(data))` 独立实现。

### 1.2 资源本质 = 容器 + 内容物

- 资源包/光影包：zip 内是多层文件夹的 json（pack.mcmeta / shaders/）。
- YSM：wasm 解密（加密二进制 → zip）后，内容物仍是 zip 容器 + models/*.json。
- ADR-067 后 mmd/vrc/蓝图/投影也接受 `.zip` 包裹（内容指纹识别）。

**"解析详情前分三步"（识别类型 → 解包容器 → 解析内容物）的第二步在各类型重复实现**——新增资源类型（VRM/MMD zip 化）时，解包这一层必须重写一遍，这是架构级债务。

## 2. 决策（Decision）

**引入统一容器桥接层 `ContainerReader` 抽象，收敛 ysm/geometry/avatar 的解包重复**：

1. **接口**（`go/container/container.go`，新包）：
   ```go
   type ContainerReader interface {
       Entries() []Entry            // 内容物条目（正斜杠名 + 是否目录）
       Open(name string) (io.ReadCloser, error)
       Close() error
   }
   // 双入口：NewContainerReader(path) 按扩展名分派 zip/7z；
   // NewContainerReaderFromBytes(data, size) 供内存路径（avatar/geometry 已持有 []byte）
   ```
2. **格式分派**：`.zip` → `archive/zip`、`.7z` → `sevenzip`（依赖已引入）、目录 → `os` 直读（ReadPackMeta 的 dir 分支一并收敛）。
3. **迁移范围**：
   - `geometry/archive.go`：4 个顶层函数 → 共用 `NewContainerReader*` + `collectArchiveFiles`，**删除 ParseFrom7z 与 ParseFromZip 的对称外壳**（~300 行 7z 版收编）。
   - `avatar/avatar_extract.go` 两处 → `NewContainerReaderFromBytes`。
   - `ysm/summary.go` / `parse.go` / `texsize.go`：`zip.OpenReader` 调用点迁移；`summary.go` 三次遍历收敛为 `Entries()` 单次列出 + 三次内容物定位（减少重复打开）。
   - `packs` 检测层已在 ADR-067 S5 收敛，本 ADR 不重复动（`ReadPackMeta`/`ReadShaderpackLang` 的内容读取可后续迁移）。
4. **保留前置阶段**（不可并入抽象）：
   - **YSM 加密二进制 → wasm 解密**：`ysm/ysm.go`/`header.go`，解密产物 zip 再进 `ContainerReader`。
   - **litematic gzip-NBT**：gzip 是单文件流（非多条目容器），`openGzRoot` 已够简洁，不强制并入。
5. **大小/安全约束继承**：单条目 `types.MaxReadLimit`（50MB）+1 截断探测、容器 `types.MaxImportSize`（500MB）——ContainerReader 内部统一施加，消除各包自写 `LimitReader` 差异。

## 3. 后果（Consequences）

**正面**：
- 消除 ~400-500 行"打开容器+遍历条目"重复（geometry 7z 对称外壳、ysm 三次遍历、avatar 两处）。
- **新增资源类型只写内容物解析器**，解包免费——ADR-067 后的 VRM/MMD zip 化落地的硬前置。
- 内存/大小限制单点维护（现各包自写 LimitReader）。

**负面**：
- 五包签名级重构（geometry/ysm/avatar 为主），`go test ./go/...` 约 200+ 测试需同步（geometry ~80 用例、avatar ~25、ysm/packs 各 ~20）。
- `ContainerReader` 需同时支持 path 版与 bytes 版（geometry/avatar 已持有 []byte，避免多一次 syscall）。

**已知遗留**：
- `.7z` 只读库（`bodgit/sevenzip` 无 Writer），测试仅覆盖坏数据路径。
- `packs.ReadPackMeta/ReadShaderpackLang` 内容读取暂不迁移（检测层已统一，读取层低优先）。
- importer 的 `DetectZipType` 走魔数路径（不真打开容器），保持现状。

## 4. 数据溯源

来源：AI 子代理调研（2026-08-16，"容器解包→详情解析管线"）+ 用户反馈（"解析模型详情前需要分三步，比较离谱，怕解压步骤没折腾好"）→ 结果：
- 实测 `zip.OpenReader` 10 处 / `zip.NewReader` 6 处 / `sevenzip` 5 处独立实现；`ysm/summary.go` 同一容器遍历 3 次；`geometry/archive.go` 已是"准统一解包层"（collectArchiveFiles 格式无关）只差外层外壳。
- ADR-067 落地后 `matchZipArchive` 曾计划为第 7 处独立 `zip.OpenReader` → 已由 ADR-067 S5（`zipEntryMatch` 轻量 helper，packs 检测层收敛）先行处理，本 ADR 处理解析层的完整抽象。
- 结论：ADR-068 立项，编码按 §2 分步（接口 → geometry 迁移 → avatar → ysm 三次遍历收敛 → 测试同步）。

<!-- 文件名: container-reader-abstraction.md → 实际文件 ADR-068-container-reader-abstraction.md -->
