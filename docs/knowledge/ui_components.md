---
kind: ui_components
name: UI 组件库 ui-components
tier: architecture
category: ui
source_files:
  - frontend/src/ui/
use_when:
  - UI 组件
  - UI 组件库
  - 卡片组件
  - 折叠面板
  - 加载动画
  - 滑块
  - 行组件
  - 预设
  - 图标
  - 幻灯片菜单
  - 组件样式
---

# UI 组件库 ui-components

## 概览

`frontend/src/ui/` 是前端 Web Components 的通用 UI 组件库，提供可复用的展示型组件：卡片、折叠面板、加载动画、行排列、滑块、幻灯片菜单、图标等。所有组件为无业务逻辑的纯 UI 层。

## 核心职责

| 组件 | 文件 | 用途 |
|------|------|------|
| 卡片 | `ui-card.ts` | 通用卡片容器（标题/内容/操作栏） |
| 折叠面板 | `ui-collapsible.ts` | 可折叠/展开的内容区 |
| 加载动画 | `ui-loading.ts` | 加载中状态指示器 |
| 行排列 | `ui-rows.ts` | 列表行容器（排列/间距/选择态） |
| 高级行 | `ui-advanced-rows.ts` | 带额外控制的行排列 |
| 滑块 | `ui-slider-controller.ts` | 数值范围滑块控件 |
| 幻灯片菜单 | `ui-slide-menu.ts` | 轻量导航栈菜单（ADR-075/076 去桶化） |
| 幻灯片行 | `ui-slide-row.ts` | 幻灯片菜单的行组件 |
| 预设选择 | `ui-preset.ts` | 预设/模板选择器 |
| 顶部切换 | `ui-header-toggle.ts` | 头部切换按钮 |
| 图标 | `icons.ts` | 统一图标映射（emoji/SVG） |
| 样式 | `ui-components-styles.ts` | 组件共享样式串 |
| 常量 | `ui-constants.ts` | 组件尺寸/间距常量 |
| 类型 | `ui-types.ts` | 组件共享 TypeScript 类型 |
| 工具 | `ui-helpers.ts` | 组件辅助函数（DOM 创建/样式注入） |
| 控制注册 | `control-registry.ts` | 控件注册表（动态组件映射） |
| 契约 | `dom-contract.ts` | Shadow DOM 与 light DOM 的交互契约 |

## 对外 API / 入口

组件通过 `app-modules.ts` 统一注册为 Web Components 自定义元素：

```ts
import './ui/ui-card';
import './ui/ui-collapsible';
```

## 与其他子系统关系

- **app-modules** — 组件装配入口，所有 UI 组件在此注册
- **shared-styles** — 共享按钮/焦点样式被 UI 组件引用

## 不变量

- 纯 UI 组件，零业务逻辑引用
- 组件通过 Shadow DOM 样式隔离，不影响全局样式