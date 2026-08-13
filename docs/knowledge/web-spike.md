---
kind: web-spike
name: 纯浏览器 WASM 解码验证入口 frontend/src/web-spike
tier: leaf
category: core
source_files:
  - frontend/src/web-spike/main.ts
use_when:
  - ADR-049 Phase 0
  - 无 Wails 壳的 WASM 解码验证
  - base64 内嵌 YSMParser 浏览器测试
invariant_anchors:
  - frontend/src/web-spike/main.ts|initYSMParser
  - frontend/src/web-spike/main.ts|decodeYsmFileFromMemory
---

# 纯浏览器 WASM 解码验证入口 frontend/src/web-spike

## 概览

`frontend/src/web-spike/` 是 ADR-049 Phase 0 的独立验证入口（`web.html`），用于在无 Wails 壳的纯浏览器环境中验证 YSMParser WASM 解码能力。走 `decodeYsmFileFromMemory` 内存解析路径，零 binding 依赖。

## 核心职责

- 独立 HTML 页面入口，不经主 UI 启动链
- 自行加载语言包（`initI18n()`），否则 `t()` 拿到空 bundle 会回落显示裸 key
- 支持文件拖拽或文件选择器输入 `.ysm` 文件
- 调用 WASM 解码后展示统计指标与文件列表

## 对外 API / 入口

- 页面入口：`web.html`（独立 HTML，通过 `main.ts` 驱动）
- 依赖：`../wasm/ysm-parser.ts`（`initYSMParser` / `decodeYsmFileFromMemory`）
- 依赖：`../core/i18n/locale.ts`（`initI18n`）、`../core/i18n/t.ts`（`t`）
- 依赖：`../utils/format/summarize.ts`（`summarizeDecoded` → `{bones, cubes, texCount}`）

## 交互流程

1. 页面加载 → 调用 `initI18n()` 异步等待语言包就绪
2. 用户拖入文件或点击选择 → 触发 `handle(file)`
3. `handle` 等待 `i18nReady` → 初始化 WASM → 读文件字节 → 调用 `decodeYsmFileFromMemory`
4. 结果展示：统计表格（文件数、骨骼数、方块数、纹理数）+ 文件列表（前 40 条，超出截断并提示 omitted 数量）

## 与其他子系统关系

- **上游**：ADR-049 Phase 0（WASM 解码能力独立验证阶段）
- **WASM 层**：`frontend/src/wasm/ysm-parser.ts`
- **非主 UI**：独立入口，不经过 `internal/app` 的 Wails 绑定链，验证的是纯浏览器场景下的解码路径

## 不变量

- 必须自行调用 `initI18n()`，否则 i18n key 暴露给用户
- 仅展示前 40 个文件，避免大模型导致 DOM 过重
- `decodeYsmFileFromMemory` 无输出时显示 `web.decodeNoOutput`，不崩溃

## 相关

- ADR-049（WASM 解码验证路线图）
