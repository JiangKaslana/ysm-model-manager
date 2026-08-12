# 项目结构地图

> **自动生成**：目录结构由 `node scripts/gen-project-map.mjs` 扫描磁盘生成；
> 目录用途是人工知识，直接维护在本文档的表格里（脚本从本文件读回复用，无外部基线）。
> 改目录结构后运行脚本刷新；`--check` 已接入 `doctor.mjs` 防漂移。

## Go 端

<!-- GEN: go-structure -->

| 包 | 用途 |
|----|------|
| `avatar/` | 创作者头像提取与缓存 |
| `dedup/` | 文件去重检测（纯函数，不绑回收站/UI） |
| `download/` | 纯下载逻辑（不依赖 Wails runtime） |
| `executil/` | 外部进程工具（HideWindow 平台双实现，收敛自三处副本） |
| `fileops/` | 文件操作 + 预览提取 + 包信息（ADR-003 P3 下沉） |
| `fsutil/` | 目录遍历工具（WalkDir 集中管理） |
| `geometry/` | Bedrock Geometry JSON 解析（ZIP/7z 提取，防炸弹限制） |
| `importer/` | 资源导入策略接口与内置实现 |
| `installer/` | 模型安装 |
| `instance/` | 整合包实例同步状态组装（ADR-003 补充下沉） |
| `internal/` | Go 内部工具（testutil 测试工具） |
| `litematic/` | Litematica 投影文件 (.litematic) 解析与预览数据 |
| `logs/` | 导入日志 |
| `packs/` | 资源包元数据读取（pack.mcmeta / 光影包 lang / 资源类型检测） |
| `paths/` | 路径安全 |
| `recycle/` | 回收站管理 |
| `scanner/` | 模型扫描 + 作者提取 + 仓库索引（ADR-003 P2 Logic Sinking） |
| `sync/` | 整合包同步 |
| `tags/` | 模型标签持久化存储 |
| `threejs/` | 3D 骨骼计算（对齐 YSMViewer 口径） |
| `types/` | 共享类型 + 注册表 |
| `updater/` | 自动更新 |
| `version/` | 版本号 |
| `watcher/` | 文件监听 |
| `ysm/` | YSM 解析 + 摘要 |

<!-- /GEN: go-structure -->

## internal（Wails Binding 入口）

<!-- GEN: internal-structure -->

| 包 | 用途 |
|----|------|
| `app/` | Wails Binding 入口（app.go / resource_bindings.go） |

<!-- /GEN: internal-structure -->

## 前端

<!-- GEN: frontend-structure -->

| 路径 | 用途 |
|------|------|
| `core/` | 基础设施（buttons / global-handlers / theme / context-menus） |
| `features/` | 业务功能（import-queue / recycle-bin / version-updater / community） |
| `services/` | 服务注册（registry.ts） |
| `test-utils/` | 测试工具（G-1 抗脆弱测试基础设施 — ADR-035 §19.1：getByTestId / getAllByTestId / waitFor） |
| `utils/` | 工具函数（display / fmt / dom / icon / summarize / model3d） |
| `views/` | 页面级视图组件（app-content / app-tree / app-preview 等） |
| `wails/` | Wails 桥接（app.ts） |
| `wasm/` | WASM 生成数据（base64 豁免文件） |
| `web-spike/` | 网页版 spike 入口（main.ts，构建/冒烟验证） |
| `app-modules.test.ts` | app-modules 主题/隐私模式启动链测试（normalizeTheme / safeGet / initTheme / applyUIPrefs） |
| `app-modules.ts` | 组件入口 + 右键菜单映射 |
| `bus.test.ts` | 事件总线测试 |
| `bus.ts` | 事件总线 |
| `real-data-fuzz.test.ts` | 真实数据模糊测试（资源类型/schema 契约） |

<!-- /GEN: frontend-structure -->

## 根级文件

<!-- GEN: root-files -->

| 文件 | 用途 |
|------|------|
| `AGENTS.md` | AI 入口手册（硬约束 + 导航） |
| `README.md` | 项目说明（面向用户） |
| `cli_export.go` | CLI 模式构建入口（build tag: cli） |
| `creators.json` | 创作者数据 |
| `embed.go` | 内嵌资源声明（embed 文件系统） |
| `link-checker-out.json` | 链接检查器输出产物（不入库） |
| `main.go` | 程序入口（薄壳，GUI 构建） |
| `main_test.go` | 根级测试（App 生命周期/CLI 冒烟） |
| `opencode.json` | opencode 配置 |
| `resource_types.json` | 资源类型单一事实来源（注册表优先） |
| `wails.json` | Wails 配置 |
| `workshop-github.json` | 工坊 GitHub 关联 |
| `workshop_sites.json` | 工坊站点配置 |

<!-- /GEN: root-files -->
