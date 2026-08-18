---
kind: resource-packs
name: 资源包功能 resource-packs
tier: architecture
category: feature
source_files: []
use_when:
  - 资源包
  - 光影包
  - 蓝图
  - 投影
  - resourcepack
  - shaderpack
  - 资源管理
---

# 资源包功能 resource-packs

## 概览

**已删除（2026-08-18）**。原 `frontend/src/features/resource-packs.ts` 是一个薄 wrapper，把仓库页的各类资源包 tab 统一委托给 `<app-resource-manager>` 组件渲染。

## 删除原因

仓库页的资源类型切换已改由 `app-nav` 下拉 + `app-tree` 重渲染（ADR-095），`resource-packs.ts` 无运行时消费者，作为死代码清理。

## 替代方案

- **仓库页**：`app-nav` 全局类型下拉 → `repo:rtype-changed` bus → `app-tree` 重渲染
- **整合包页**：`app-sync-manager` 直接管理同步状态（推/拉），不再嵌套 `<app-resource-manager>`
- **独立资源管理**：`<app-resource-manager rtype="...">` 仍可直接使用（组件本身保留）

## 相关

- [app_resource_manager](./app-resource-manager.md) — 组件本身仍存在
- [app_sync_manager](./app-sync-manager.md) — 整合包同步面板（已移除 RM 嵌套）
