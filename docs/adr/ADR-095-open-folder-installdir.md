# ADR-095：OpenInstanceFolder 打开资源存储目录而非模组扫描目录

- **状态**：已采纳（Accepted）
- **日期**：2026-08-18
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`internal/app/app_scan.go` `OpenInstanceFolder`；`resource_types.json`（`installDir` / `scanDir` 字段）；`go/types/extensions.go` `FindInstDir` / `SubDirMap`

---

## 1. 背景（Context）

整合包实例右键菜单「打开文件夹」（`instance.open-folder` → `App.OpenInstanceFolder`）打开的路径是 `\config` 目录，匹配到的是模组配置文件而非资源包存储目录。

调用链与两处问题：

1. **语义错配（根因）**：`OpenInstanceFolder` 用 `SubDirMap(rtype)` 取 `scanDir`（如 ysm = `config/yes_steve_model/custom`）。`scanDir` 的语义是「模组从哪加载文件」，而资源包实际存放地由 `installDir`（如 ysm = `versions/{instance}/ysm/`）表达。打开文件夹的预期是存储目录，代码却用了加载目录。
2. **判定放大（加剧）**：`FindInstDir` 用 `SupportedExtsForType` 做「目录内包含该类型文件」判定，而 ysm 类型扩展名含 `.json`（`resource_types.json`），`config/` 下成堆模组配置文件/绑定 json 直接命中 `dirContainsExt`，返回 config 目录，兜底扫描连执行机会都没有。

对比：资源管理器视图工具栏「打开文件夹」按钮传 `_rpRoot`（`frontend/src/views/app-resource-manager/index.ts`），实例模式下按 `installDir` 推导为版本目录下的资源存储目录——同一功能两处口径不一致。

## 2. 决策（Decision）

`OpenInstanceFolder` 不再用 `SubDirMap` / `FindInstDir` 探测模组扫描目录，改为按 `installDir`（资源存储目录模板）推导：

1. 有 `InstallDir` 配置时：
   - 先替换 `{instance}` 占位符为 `filepath.Base(instDir)`（实例名）；
   - **候选 A**：`instDir` 直接拼接 `installDir` 掐掉 `versions/{instance}/` 前缀后的剩余段（instDir 已是版本目录/整合包根时，ysm = `instDir/ysm`）；
   - **候选 B**：`instDir` 上两级（vanilla 布局的 `mcRoot`）+ 完整 `installDir`（resourcepack 等 `installDir` 为相对 mcRoot 的全局目录，如 `mcRoot/resourcepacks`）；
   - 存在且为目录的候选即打开；全部不存在回退 `instDir`。
2. `InstallDir` 为空（未知类型）时行为不变：直接打开 `instDir`。

覆盖矩阵（vanilla / Prism 两种布局 × ysm / 其他类型）：
- vanilla + ysm → 候选 A（`instDir/ysm`）✓
- vanilla + 其他 → 候选 B（`mcRoot/resourcepacks` 等）✓
- Prism + ysm → 候选 A（`.minecraft/ysm`）✓
- Prism + 其他 → 候选 A（`.minecraft/resourcepacks`）✓
- 全失败 → 回退 `instDir` ✓

## 3. 后果（Consequences）

**正面**：
- 右键「打开文件夹」打开资源存储目录，与资源管理器工具栏按钮口径一致；
- 消除 `.json` 扩展名在 `config/` 目录上的误命中，不再打开模组配置目录；
- 修改集中在 `internal/app/app_scan.go` 单函数，前端与绑定签名不变。

**负面 / 已知遗留**：
- 推导依赖「候选目录真实存在」，未安装过资源的类型在整合包内打开时会回退到实例根目录（行为与原实现的目录不存在回退一致）；
- Prism 布局下 ysm 的存储位置依赖整合包内是否真实存在 `ysm/` 子目录；不存在时回退，不强行拼接；
- `FindInstDir` / `SubDirMap` 仍被安装、同步链路（`app_install_instance.go`、`go/sync`）使用，本次仅改「打开文件夹」语义，未波及识别链路。

## 4. 数据溯源

- 现象：右键打开 `\config` → `app_scan.go` `OpenInstanceFolder` → `SubDirMap`（`scanDir`）→ `FindInstDir` → `config/yes_steve_model/custom`。
- 根因字段：`resource_types.json` ysm 条目 `installDir: "versions/{instance}/ysm/"`（存储）vs `scanDir: "config/yes_steve_model/custom"`（加载），`extensions: [".ysm", ".zip", ".7z", ".json"]`（含 `.json`）。
- 正确口径参照：`frontend/src/views/app-resource-manager/index.ts` `_rpRoot` 的实例模式推导（`VersionDir + installDir.replace("{instance}", ...)`）。
- 修复验证：`go build ./go/...` + `internal/app` 测试。

<!-- 文件名: open-folder-installdir.md → 实际文件 ADR-095-open-folder-installdir.md -->
