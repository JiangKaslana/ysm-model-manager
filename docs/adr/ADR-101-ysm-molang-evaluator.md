---
kind: adr
title: ADR-101：YSM 骨骼动画 Molang 求值器（L4）
status: ✅ 已采纳
date: 2026-08-22
author: AI proxy
related: ADR-100（YSM 骨骼动画播放 L1-L3）
---

# ADR-101：YSM 骨骼动画 Molang 求值器（L4）

## 1. Context

ADR-100 L1-L3 已落地 YSM 骨骼动画播放基础链路（解析→播放器→平滑过渡→全 clip 列表），
但 `.animation.json` 中的 **Molang 表达式关键帧**（如 `query.anim_time * 90`、
`math.sin(90)`、`q.anim_time > 1 ? 10 : -10`）仍被静默跳过——`parseBedrockAnimationJSON`
检测到字符串轴标记 `hasMolang = true`，但 `evaluateKeyframes` 对字符串值走 `Number(item)`
路径，得到 `NaN` 后整帧丢弃。

上游参考：
- **Blockbench**（GPL-3.0，只做公式对表）使用 `molangjs ^1.7.0`（MIT，作者 JannisX11 同属 Blockbench 团队）作为 Bedrock 动画的官方 Molang 求值引擎。
- **ModernYSM**（Java）自研 fork 的 Molang 引擎，加载期编译 AST、运行期纯树遍历。
- **YSMViewer**（C#）桌面端完整实现，浏览器端阉割（NaN 丢弃）。

## 2. Decision

**采用源码内嵌策略**，将 `molangjs/src` + `molangjs/syntax` 按 MIT 许可保留原始版权头，
本地路径 import，彻底避开上游 npm 包的 CJS/ESM 混用打包 bug（package.json 含 `"type":"module"`
但 dist/molang.cjs.js 用 CJS module.exports，Node 层报 `module is not defined`）。

不引入 npm 依赖，不修改上游包，不依赖动态 import（测试环境兼容性问题多）。

### 设计要点

- **单例 parser**：`new Molang()` 全局复用，`cache_enabled` 默认开（400 条 LRU），
  表达式只解析一次，运行期纯求值——对齐 ModernYSM「加载期编译 AST / 运行期只 eval」原则。
- **未知变量 → 0**：`variableHandler = () => 0`，mod 扩展查询（ysm.*/按键/药效等）在预览器
  无宿主语境时优雅降级，不抛错（对齐 YSMViewer 回退口径）。
- **角度制**：`use_radians = false`（默认），三角函数按度数——Bedrock 格式约定。
- **安全底线**：molangjs 是真正的 DSL 解析器（词法/语法/AST），不是 `eval`——
  延续本项目「Molang 不解释执行任意 JS 表达式」的安全底线。
- **Infinity/NaN 守卫**：`compileMolang` 求值闭包与 `parseAxisItem` 常量折叠分支
  统一 `Number.isFinite` 检查，Infinity/NaN → 零占位，不穿透到渲染层。

### 接口

```ts
// molang.ts
export type MolangFn = (animTime: number) => number;
export function compileMolang(expr: string): MolangFn | null;

// animation.ts 扩展
export interface Keyframe {
  time: number;
  post: Vec3;
  pre: Vec3;
  lerp: "linear" | "step";
  postMolang?: MolangAxes;  // L4 新增
  preMolang?: MolangAxes;   // L4 新增
}
```

## 3. Consequences

### 正面
- 表达式关键帧（`query.anim_time`、`math.sin`、三元条件等）现在**真实驱动骨骼**，
  模型动画从"部分能动"升级到"完整 Bedrock 语义可播放"。
- 零新增 npm 依赖，内嵌源码 MIT 许可可商用，无传染性。
- 编译期静态分析可行（AST 结构固定），后续 L5 状态机可复用同一 parser 实例。

### 负面
- `molangjs` 源码目录（~46KB unpacked）进入仓库，体积增量有限但需随上游更新手动同步。
- `compileMolang` 是同步接口，模块加载期（`new Molang()`）失败时静默返回 null，
  调用方走零占位——不阻塞渲染，但调试时可能漏掉表达式错误。
- Blockbench 的 `molangjs` 是 1.7.0 版本，部分新表达式语法（如 `ctrl.*` 系列）
  尚未覆盖，仅支持 Bedrock 基岩版标准 Molang 子集。

### 已知遗留
- **不支持 `ctrl.*` / `ysm.*` 等游戏态查询**：`variableHandler` 统一返回 0，
  需要 Mod 运行时上下文才能正确求值的表达式会退化（预览器场景下可接受）。
- **不支持 `fn.*` 自定义函数**：模型包作者注册的函数在预览器中不可用。
- **未实现 `pre` 轴的 Molang 求值**：当前 `resolveFramePost` 只处理 `postMolang`，
  `preMolang` 字段保留但未使用（Bedrock 格式中 pre 通常等于 post，可延后支持）。

## 4. 文件清单

| 文件 | 说明 |
|------|------|
| `frontend/src/utils/animation/molang.ts` | 新模块：Molang 求值器封装 |
| `frontend/src/utils/animation/molang.test.ts` | 新测试：7 项全覆盖 |
| `frontend/src/utils/animation/molang-lib/*` | 内嵌 molangjs src + syntax（MIT） |
| `frontend/src/utils/animation/animation.ts` | L4 扩展：Keyframe postMolang/preMolang、parseAxisItem、resolveFramePost |
| `frontend/src/utils/animation/animation.test.ts` | L4 新增 6 项测试 |
| `docs/knowledge/animation-system.md` | 更新：求值链路不再休眠 |
