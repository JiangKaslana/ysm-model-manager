# 审核框架

> 从 AGENTS.md 外移。审核流水线、代码健康度、反模式、致命陷阱、治理红线、防御范式的完整内容。

## 审核流水线

> 用3个子代理继续分析3个测试文件，反推源码不足，改进测试与源码。主模型提交汇总子代理的合理改动，使用codereview复查。
> 思路参考知识卡定位未审核的模块 → 审核相关代码的实现 → 核对风险修复的可行性，进行修复 → 提交改动 → 发起codereview（如果你的终端有审核工具）
> 发现预料之外的缺陷时，只读，报告，给出精确的修复建议（diff 格式、文件:行号、修改原因）。

## 代码健康度检测

| 维度         | 关键指标                  | 检查方法                                                                 |
|--------------|--------------------------|--------------------------|
| **基础质量** | 类型安全                  | 生产代码中 0 处新增 `as any`/`@ts-ignore`                                |
|              | 资源释放                  | 每个 `new` 对象有对应 `dispose()`，Observer 在 dispose 时移除            |
|              | 异常处理                  | 无静默吞错(`catch{}`)，Promise 链有错误处理                             |
| **设计质量** | 状态流清晰                | 通过 `grep setState` 追踪写入点，确认无"幽灵路径"                        |
|              | 职责单一                  | 函数不做"数据获取+UI更新+状态持久化"多重任务                             |
|              | 并发安全                  | 检查 `_loading`/`_pending` 标志，模拟用户快速点击3次                     |
| **维护风险** | 重复代码                  | 相似逻辑在≥2文件中出现(UI布局除外)                                       |
|              | 循环依赖                  | `npm run dep:graph` 检查模块依赖                                         |
|              | 魔法数值                  | 查找未定义常量的硬编码数值/字符串                                        |

## 审核执行流程

1. **依赖分析**
   - 列出模块所有 `import` 语句
   - 标记上游模块审核状态

2. **状态流追踪**
   ```bash
   grep -E 'setState|setEnvState|= envState\.' <文件路径>
   ```

## 资源生命周期

```bash
grep -E 'new\s+\w+|\bcreate\w+\b|\badd\w+\b' <文件路径> # 创建点
grep -E '\.dispose\(|\bremove\w+\b|\bdelete\w+\b' <文件路径> # 释放点
```

## 异常路径推演

- 如果第X行抛出异常，清理代码是否会执行？
- 异步操作是否接受 AbortSignal？
- finally 块是否有 disposed 标志守卫？

## 生成报告

```markdown
## [模块名] — 审核结果

**总体结论：** 通过 / 有条件通过 / 不通过

**亮点：**
- [具体模式 + 文件:行号]

**风险：（如果有）**

| 文件 | 位置 |观察 | 改进建议 |
|------|------|------|------|
| 🔴 极高P1 |xxx.ts:123 | 具体问题描述 | 建议 |
| 🟠 高P2 |xxx.ts:123 | 具体问题描述 | 建议 |
| 🟡 中P3 |xxx.ts:123 | 具体问题描述 | 建议 |
| 🟢 低P4 |xxx.ts:123 | 具体问题描述 | 建议 |
```

---

# 一、常见反模式（审查时重点排查）

| 反模式 | 表现 | 危害 |
|--------|------|------|
| **隐式状态写入** | 函数直接修改模块级 `_xxx` 变量，而非通过 setter/action | 状态变化不可追踪，难以 debug |
| **职责过载** | 一个函数做了"数据获取 + UI 更新 + 状态持久化" | 违反三层解耦，难以测试 |
| **魔法数值/硬编码** | `if (x > 0.5)` 或 `'some:event'` 无常量定义；CSS 硬编码颜色 | 修改时极易遗漏 |
| **显著重复** | 相似逻辑在 **≥2 个文件**中出现 | 应抽取公共函数或 `utils/` 模块 |
| **Promise 链断裂** | async 函数中 `.then()` 无 `.catch()`，或 `catch` 后静默吞错 | 错误无声消失，用户不知发生了什么 |
| **事件无守卫注册** | `bus.on` 顶层直接注册不检查已注册 | 组件多次创建累积 handler（ADR-008） |
| **先删后建** | 先删除旧文件/目录再安装/重建，失败无回滚 | 失败即丢数据（relinkDir，ADR-028） |
| **存在即跳过** | 目标已存在即返回成功，不校验内容/链接类型 | 更新静默不生效、relink 假成功（ADR-028） |
| **防抖只合并调度不合并执行** | timer 合并触发，但执行体可并发重入 | 并发操作同一资源（syncAll，ADR-031） |
| **已关闭 channel 复用** | Stop 时 close(done)，Start 复用已关闭 channel | 重启后假活、监听失效（ADR-031） |
| **限流器截断静默** | `io.LimitReader` 截断不报错，下游接受截断数据 | 损坏文件被装盘（Download，ADR-033） |
| **文本匹配错误分类** | 错误分类靠英文错误子串 `contains` | 脆弱、跨平台失效（isFileLocked/linkErr） |

## 二、致命陷阱

| # | 陷阱 | 表现 | 规则 |
|---|------|------|------|
| 1 | Go 改后未重建 | 前端调用没反应 | 改 Go 文件必须 `wails3 build` 或 `go build .` + 重启 |
| 2 | 全局事件放错组件 | 切页后 handler 消失 | 全局 handler 必须放 `app-content/index.ts` 的 `registerGlobalHandlers()` |
| 3 | 按钮异步后卡死 | 操作失败后按钮灰掉 | `finally` 里 emit 完成事件，不放 try 末尾 |
| 4 | `const` TDZ | 静默失败 | `const fn = () => {}` 不提升，先定义再调用 |
| 5 | Go Binding 函数名写错 | 前端调用 undefined | 先用 grep 在 `internal/app/` 确认函数名 |
| 6 | 下载进度 99% 卡死 | Content-Length=-1 | 锁定 99%，2s 后转菊花；`stuckGuardReset()` 清全部状态 |
| 7 | 三入口各自注册 | 事件重复/遗漏 | 单击/多选/全选都走 `enqueueDownloadTasks()`，只注册一组 Wails EventsOn |
| 8 | 回收站误删 | 硬链接数据丢失 | 符号链接→直接删，硬链接(nlink>1)→直接删，普通→移 `.recycle`，跨分区→复制后删 |
| 9 | `public/` 下放 JS | Vite dev 优先加载 | 新 JS 放 `frontend/src/`，ES module → `app-modules.ts` 加 import |
| 10 | 回调 API 未 Promise 化 | DnD 数据读不到 | `entry.file(callback)` → `new Promise(resolve => entry.file(resolve))` |
| 11 | 3D 坐标变换反复修（实证：model3d.ts 9 次 fix 全项目第一） | "对齐 ysmview cube pivot" 连续 5 次 fix | 改 model2d/model3d/spec.go 坐标前先 grep `bug-chronicle` + 对齐 ysmview 口径（pivot X 取反、`from.x = origin.x - size.x`）；改完用自由相机近距验证 |
| 12 | CLI 未知 flag 被当标题/位置参数（实证：`--help` 误占 ADR-027-help.md / 生成 help.md 卡） | `new-adr.mjs --help` 占号；`new-knowledge-card.mjs --help` 当 kind | 有 positional 参数的 CLI：未知 `--flag` 显式白名单拦截，绝不落入位置参数位；`--help` 退 0 / 未知 flag 退 1；主流程 `process.exit(main())` 让退出码生效 |
| 13 | 幽灵路径：状态被旁路写入（实证：page-store `setCurrentPage` 零调用方且 emits 完成事件；registry 注册空转零消费） | 状态变了但内容不渲染 / 服务注册无人消费 | 模块级状态唯一写入点收敛到 `registerXxx(unsubs)` listener；setter 禁发「完成事件」绕过请求链路；服务名联合类型收窄、注册必有消费方（`get()`） |
| 14 | 旁路弹窗：不走 modal.ts 单例槽位（实证：version-updater 自带 47 行 dlg-overlay 骨架） | 连点叠加、单例失效、双执行 | 所有弹窗走 `dialogs/modal.ts`（modalConfirm/modalPrompt/modalSelect + `registerDlg` 槽位），禁止自带弹窗骨架（check-redlines.mjs W6 扫描） |
| 15 | esc 重复实现（实证：10 文件 3-5 个 replace 版本并存） | 属性上下文 XSS 面不统一 | 转义统一 import `utils/dom/html.ts` 的 esc（5-replace 含引号），禁止私有实现（check-redlines.mjs R10 扫描） |
| 16 | doctor 检查项 `[WARN] … skip` 被当「通过」（实证：npx 探测误跳过，多轮 typecheck 假绿） | 前端检查全程空转，类型错误漏网 | doctor 前端检查直接查 `frontend/node_modules/.bin/{name}`；见 `[WARN] skip` 必须手动跑 `node_modules/.bin/tsc` 确认，信任但验证 |
| 17 | 零值哨兵：用 [0,0,0] 当"缺失"标志（实证：`types.Cube2D.Pivot`） | 显式声明的零值被误判为缺失 → 旋转中心被 fallback 到 cube 中心 | 解析层用指针（nil=缺席）或显式存在标志（`PivotSet`）区分「JSON 缺席」与「显式零值」，禁止用零值当哨兵 |

> 完整版见 `docs/pitfalls.md`。

---

# 三、治理红线

## 3.1 零 `window.__*` 全局变量

| ❌ 禁止 | ✅ 替代 |
|---------|--------|
| `window.__currentPage` | `PageStore.currentPage` (`core/page-store.ts`) |
| `window.go.main.App.*` | `getApp()` (`wails/app.ts`) |

## 3.2 Wails 调用统一走 `getApp()`

```js
// ✅ 正确
import { getApp } from "../backend/app.ts";
const App = await getApp();
const result = await App.SomeBinding();

// ❌ 禁止
const { SomeBinding } = window.go.main.App;
```

## 3.3 注册表优先

所有资源类型定义以 `resource_types.json` 为单一事实来源。**不要在 Go/Frontend 中手写 `StorageSubDir` / `specificRoot` / `ResourceExts` 的新条目**。先在 `resource_types.json` 加，一致性测试会自动校验。

## 3.4 防御范式（ADR-044）

> 31 批审核反推的「防御补丁式而非范式式」教训：同类缺陷（代际守卫遗漏、catch 缺失、truthiness 吞合法值、边界校验不对称）在 5~10+ 批中反复暴露。新代码必须按以下三条范式写，审查发现违规可直接判 P1/P2。

**① 异步范式**（每个 async 路径必须闭环）：

| 范式 | 反例（违规） | 正例 |
|------|------------|------|
| `await` 后落 DOM / 写状态前**必校验代际**（含 catch 分支） | `const data = await load(); render(data)` 无代际比对 | `if (gen !== _loadGen) return; render(data)`；catch 内同样比对 |
| async 事件 handler 最外层**必有 catch 出口**（转 `friendlyError` toast） | `btn.onclick = async () => { await save(); }` 无 catch | `btn.onclick = async () => { try { ... } catch (e) { toast(friendlyError(e)) } }` |
| busy 命中**必回完成事件**（带 `skipped` 标记），禁止静默吞事件 | `if (_downloadBusy) return;` 不发任何事件 | `if (busy) { emit(done, {skipped:true}); return; }` |

**② 数值守卫范式**（truthiness 判断只用于布尔）：

| 范式 | 反例（违规） | 正例 |
|------|------------|------|
| 数值守卫用 `Number.isFinite` 拦截 NaN/±Infinity | `if (!x && x !== 0)` 挡不住 Infinity | `if (!Number.isFinite(x)) fallback` |
| 数字回填用 `?? ""` 不用 `|| ""` | `v.x \|\| ""` 把 0 折叠成空 | `v.x ?? ""` |
| `!x` 只用于布尔，数值/字符串用显式 null/undefined 判断 | `if (!cosA) cosA = 1` 吞合法 0 | `if (cosA === undefined \|\| Number.isNaN(cosA)) cosA = 1` |

**③ 边界对称范式**（校验必须覆盖对称边界）：

| 范式 | 反例（违规） | 正例 |
|------|------------|------|
| 范围校验覆盖上下界 | int16 只查正上界、负 origin 静默回绕 | `origin < minCoord \|\| origin+size-1 > maxCoord` 双侧 |
| 路径校验覆盖 `.` 与 `..` 两个逃逸段 | 只查 `rel==".."`，`rel=="."`（根级）放行 | `rel==".." \|\| rel=="."` 都拒绝；`IsInside` 相等放行时额外 `Clean()==Clean(root)` 拒绝 |
| 字符串比较统一 EqualFold / 规范化 / 词边界 | 大小写敏感 `.recycle`、`HasPrefix("..")` 误判 `..foo`、裸子串 `contains("refused")` | `fsutil.IsRecycleDir`（EqualFold 基名）、`\b` 词边界或精确段比较 |
