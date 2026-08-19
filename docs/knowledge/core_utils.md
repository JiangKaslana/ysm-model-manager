---
kind: core_utils
name: 核心工具函数 core-utils
tier: architecture
category: utils
source_files:
  - frontend/src/utils/core/
use_when:
  - 工具函数
  - 工具方法
  - 纯函数
  - 防抖
  - 深拷贝
  - 类型守卫
  - 格式化
  - UUID
  - 响应式
  - 键盘导航
  - 虚拟网格
  - 数学计算
  - 路径工具
---

# 核心工具函数 core-utils

## 概览

`utils/core/` 是全前端最基础的纯函数工具层，不依赖任何前端框架或业务模块。按 ADR-044 策略 A 收敛自多包重复实现，统一入口。

## 核心职责

| 工具 | 文件 | 用途 |
|------|------|------|
| async | `async.ts` | 异步工具（sleep、retry、timeout） |
| clamp | `clamp.ts` | 数值约束（min/max/clamp） |
| collections | `collections.ts` | 集合操作（groupBy、uniq、chunk） |
| debounce | `debounce.ts` | 防抖/节流 |
| deep-clone | `deep-clone.ts` | 结构化深拷贝（JSON-safe） |
| disposable | `disposable.ts` | 资源生命周期管理（dispose 模式） |
| format | `format.ts` | 通用格式化（大小、时长、百分比） |
| format-timestamp | `format-timestamp.ts` | 时间戳格式化 |
| guards | `guards.ts` | TypeScript 类型守卫（isString、isNumber、isObject） |
| json-stringify | `json-stringify.ts` | 安全 JSON 序列化（兜底 null） |
| keyboard-nav | `keyboard-nav.ts` | 键盘导航辅助（方向键/Enter/Esc） |
| log | `log.ts` | 运行时日志工具（带级别过滤） |
| math-geometry | `math-geometry.ts` | 几何数学工具（向量/矩阵/插值） |
| path | `path.ts` | 路径工具（basename/dirname/join/relative） |
| reactivity | `reactivity.ts` | 轻量响应式（信号/订阅/计算属性） |
| safe-call | `safe-call.ts` | 安全调用包装（try-catch 兜底） |
| set-key | `set-key.ts` | 深层属性设置（set-in / update-in） |
| uuid | `uuid.ts` | UUID 生成（crypto.randomUUID 或降级） |
| virtual-grid | `virtual-grid.ts` | 虚拟网格布局（列表/表格的视口裁剪计算） |

## 对外 API / 入口

每个工具独立导出，按需 import：

```ts
import { clamp } from './utils/core/clamp';
import { sleep, retry } from './utils/core/async';
```

## 不变量

- 所有函数为纯函数，无副作用
- 零外部依赖（不依赖 Three.js、Wails、DOM）
- 全局唯一实现（ADR-044 策略 A 收敛），禁止各模块自行实现同功能

## 相关

- [utils-dom](./utils-dom.md) — DOM 工具层（依赖 core-utils）
- [utils-fmt](./utils-fmt.md) — 格式化工具（依赖 core-utils）