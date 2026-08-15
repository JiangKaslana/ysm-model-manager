---
kind: go-container
name: 统一容器桥接层 go/container
tier: architecture
category: go
source_files:
  - go/container/container.go
use_when:
  - 容器
  - 解包
  - zip
  - 7z
  - ContainerReader
  - 归档
  - 压缩包
  - 目录容器
invariant_anchors:
  - go/container/container.go|OpenZipPath
---

# 统一容器桥接层 go/container

## 概览

`go/container/` 包是统一容器桥接层（ADR-068）：收敛 ysm/geometry/avatar/packs 各自独立的「打开容器→找条目」实现（调研实测 zip.OpenReader 10 处 / zip.NewReader 6 处 / sevenzip 5 处重复）。统一提供 `Entry`/`Reader` 抽象：zip/7z/目录都是「条目列表 + 按名读取」，调用方只写一次内容物解析，解包免费。

## 核心职责

- `container.go` — 容器抽象与打开入口：`Entry`（Name/IsDir/UncompressedSize64/Open）+ `Reader`（Entries/Close），zip/7z/目录三种实现，path/bytes 双入口分派

## 对外 API / 入口

- `Open(path) (Reader, error)` — 按扩展名分派：`.zip` → zip、`.7z` → sevenzip、目录 → dir 直读；其他扩展名拒绝
- `OpenZipPath(path)` / `OpenZipBytes(data, size)` — zip 容器的路径/内存双入口（内存版供 avatar/geometry 已持有 `[]byte` 的场景，避免多一次 syscall）
- `Open7zPath(path)` / `Open7zBytes(data, size)` — 7z 容器双入口（`bodgit/sevenzip` 只读库，无 Writer）
- `OpenDir(root)` — 目录容器（`filepath.WalkDir` 收集相对路径条目、正斜杠名），供已解压资源包/光影包分支迁移
- `Entry` 接口方法：`Name()`（正斜杠名）、`IsDir()`、`UncompressedSize64()`（zip/7z 原值；目录版取 FileInfo.Size）、`Open() (io.ReadCloser, error)`

## 与其他子系统关系

- **ADR-068 迁移范围**：`geometry/archive.go`（4 个顶层函数共用 `NewContainerReader*` + `collectArchiveFiles`，删除 ParseFrom7z/ParseFromZip 对称外壳 ~294 行）、`avatar/avatar_extract.go` 两处 → `OpenZipBytes` + `ReadFileFromContainer`、`ysm/summary.go`/`parse.go`/`texsize.go`/`ysm.go` 四处 `zip.OpenReader`/`sevenzip` → container 打开
- **保留前置阶段**（不并入）：YSM 加密二进制 → wasm 解密（解密产物 zip 再进 container）；litematic gzip-NBT 是单文件流（非多条目容器），`openGzRoot` 不迁移
- **边界**：本包只做「打开 + 条目枚举 + 条目读取」，不做大小限制（读取时由调用方用 `fsutil.ReadLimitedEntry` / `types.MaxReadLimit` 施加，与现状一致）
- `packs` 检测层走 `zipEntryMatch` 轻量 helper（ADR-067 S5），未重复打开——但 `ReadPackMeta`/`ReadShaderpackLang` 的内容读取可后续迁移（低优先遗留）

## 不变量

- 目录容器条目名统一正斜杠（`filepath.ToSlash`），与 zip/7z 条目名口径一致——调用方按名匹配无需区分来源
- `Close()` 对 bytes 版为 no-op（内存容器无句柄）；path 版必须 defer Close（zip/7z 的 `ReadCloser`）
- 7z 只读库无 Writer，测试仅覆盖坏数据路径（非 7z 魔数 → `sevenzip.NewReader` 报错，不得 panic 或静默返回空容器）
- 不支持格式必须显式报错（`Open` 对非 zip/7z/目录拒绝），不静默降级

## 相关

- [go_geometry](./go-geometry.md) / [go_ysm_parser](./go-ysm-parser.md) / [go_avatar](./go-avatar.md) — ADR-068 迁移消费方
- [go_types](./go-types.md) — MaxReadLimit / MaxImportSize 大小约束
- ADR-068（统一容器桥接层）；ADR-069（ysm 作为解密容器参与指纹匹配，消费本包文件树）
