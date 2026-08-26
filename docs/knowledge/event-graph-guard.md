---
kind: event-graph-guard
name: Bus 事件契约守卫
tier: leaf
category: core
source_files:
  - scripts/event-graph.mjs
tests:
  - tests/test_bus_contract.mjs
use_when:
  - 未传参
  - 缺参
  - bus 事件
  - 事件契约
  - 事件漂移
  - 内联脚本
  - 可选链
  - event-graph
---

# Bus 事件契约守卫

## 概览

`scripts/event-graph.mjs` 是 Bus 事件契约的唯一机器守卫：从 `frontend/src/bus.ts` 的 `BusEvents`
接口提取权威事件清单，扫描 `frontend/src/**/*.ts|js`（排除 .test.ts）与 `frontend/*.html`
内联脚本，产出 `docs/event-graph.md`（生成物，pre-commit GEN_CMDS 自动同步）。

## 核心职责（2026-08-29「未传参」审计加固）

| 异常类 | 含义 | strict 下 |
|--------|------|-----------|
| undeclared | 事件名不在 BusEvents 表（emit/on/once/off 四侧） | 硬错误 |
| missing_payload | 非 void 事件 emit 缺第二参数 ★核心 | 硬错误 |
| void_with_payload | void 事件 emit 多传 payload | 硬错误 |
| voidDrift | VOID_EVENTS 清单 vs `: void` 标记双向漂移 | 硬错误 |
| 孤儿发射 / 鬼订阅 | emit 无订阅 / 订阅无 emit | 仅记录 |

- **可选链盲区已修**：旧版正则要求接收者后紧跟 `.`，`window.bus?.emit(...)` 整行失明——
  实证漂移：index.html 内联 `emit("nav:change")` 全项目无监听、`loading:start/end`
  幽灵监听，长期漏检。现 `\s*\??\.\s*` 兼容两种形态。
- **实参计数**：偏移法平衡括号提取实参段（跨行调用可查）；argc 含事件名，
  typed 合法 ≥2、void 合法 ==1。仅校验字面量事件名 + `bus.*` 接收者（自定义 emitter 不误伤）。
- **JSON 先行**：`--json` 无论成败都输出结构化报告再定退出码（doctor/CI/测试消费）。
- `--root <dir>` 仅供测试 fixture 覆盖仓库根。

## 对外 API / 入口

```bash
node scripts/event-graph.mjs                 # 生成 docs/event-graph.md
node scripts/event-graph.mjs --check         # 校验生成物新鲜度（pre-push ALL_STATIC_TOOLS）
node scripts/event-graph.mjs --strict        # 硬错误阻断（pre-push FRONTEND_STATIC_TOOLS 已挂）
node scripts/event-graph.mjs --json          # 机读报告
```

## 与其他子系统关系

- 契约事实源 = `frontend/src/bus.ts`（BusEvents + VOID_EVENTS；运行时缺参 console.warn 同源）
- 门禁挂点：`scripts/pre-push-gate.mjs` 的 `ALL_STATIC_TOOLS`（--check+autoFix）与
  `FRONTEND_STATIC_TOOLS`（--strict）；契约测试 `tests/test_bus_contract.mjs`
- TS 类型表只约束 .ts 调用方；html 内联 / 运行时边界靠本守卫兜底

## 不变量

- 新增事件 → 只改 bus.ts 一处（类型表 + 必要时 VOID_EVENTS），守卫自动覆盖全部调用面
- emit 非 void 事件必须带 payload；void 事件必须不带——违者 push 被闸
- 孤儿/鬼订阅是设计信号非错误：新增事件先想清楚发射方与订阅方是否成对落地

## 相关

- [event-bus.md](event-bus.md)（bus.ts 本体）
- docs/event-graph.md（自动生成的事件图）
