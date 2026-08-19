---
kind: backend_web
name: 网页版后端 backend-web
tier: architecture
category: core
source_files:
  - frontend/src/backend/
use_when:
  - 网页版
  - 浏览器模式
  - web mode
  - IndexedDB
  - IDB
  - 浏览器后端
  - browser adapter
  - 跨域隔离
  - COI
  - NBT 解析
  - 体素
  - 体素颜色
  - Web CLI
  - 社区下载
  - 网页版文件系统
  - 网页版仓库
---

# 网页版后端 backend-web

## 概览

`frontend/src/backend/` 是 YSM 网页版（ADR-049 Web Edition）的后端抽象层。在桌面/Android 环境下走 Wails Go 绑定替代，网页版使用 `browser-adapter.ts` + `idb.ts` 的同一前端接口。所有模块通过 `app.ts` 的 `getApp()` 工厂方法统一接入。

## 核心职责

| 模块 | 文件 | 用途 |
|------|------|------|
| 应用入口 | `app.ts` | 统一的 `getApp()` 工厂，桌面走 Wails Go 绑定，网页版走 browser-adapter |
| 浏览器适配 | `browser-adapter.ts` | 网页版后端适配器，将 Wails Binding 调用映射为 IDB/Web API |
| IndexedDB 存储 | `idb.ts` | 网页版持久化存储（模型库/配置/缓存），基于 IndexedDB |
| 平台检测 | `platform.ts` | 运行时平台判定（桌面/网页/Android） |
| 跨域隔离 | `coi-sw.ts` | COOP/COEP 跨域隔离 Service Worker，支持 SharedArrayBuffer |
| 文件系统 | `web-fs.ts` | 网页版虚拟文件系统（OPFS 或 IDB 兜底） |
| 仓库存储 | `web-store.ts` | 网页版模型仓库数据（扫描/索引/缓存） |
| 统计 | `web-stats.ts` | 网页版模型批量统计（Web Worker 协同） |
| 社区下载 | `web-community.ts` | 网页版社区/创意工坊下载 |
| CLI 桥 | `web-cli.ts` | 网页版 CLI 模拟（纯前端，不需要 Go 后端） |
| 通用工具 | `web-common.ts` | 网页版公共工具函数 |
| 提取 | `extract.ts` | 网页版 ZIP 提取 |
| NBT 解析 | `nbt-parse.ts` | 网页版 NBT 格式解析（Litematic 等） |
| 体素 | `voxel-parse.ts` | 网页版体素数据解析 |
| 体素颜色 | `voxel-colors.ts` | 体素颜色映射表 |
| 体素颜色数据 | `voxel-colors-data.ts` | 体素颜色数据（Litematic 块色） |
| 包元数据 | `pack-meta.ts` | 网页版资源包/光影包元数据解析 |
| YSM 头 | `ysm-header.ts` | 网页版 YSM 文件头解析 |
| 类型 | `types.ts` | 网页版后端共享类型 |

## 对外 API / 入口

```ts
import { getApp } from './backend/app';
const app = getApp();  // 桌面: window.go.main.App, 网页版: browserAdapter
```

## 与其他子系统关系

- **wails-bridge** — 桌面端通过 `window.go.main.App` 调用 Go 绑定
- **backend-idb** — IndexedDB 封装知识卡（补充 `idb.ts` 细节）
- **model-stats** — 网页版统计复用 Web Worker 层

## 不变量

- 桌面端不走 `backend/` 目录（仅 `app.ts` 做平台分流）
- 所有 `web-*` 文件仅在 `MODE === 'web'` 时生效，桌面端 `getApp()` 直接返回 Wails 绑定
- `browser-adapter.ts` 实现 `App` 接口的全部方法，是网页版唯一的事实后端