# Android 适配代码审核汇总报告

> 生成时间：2026-08-10 · 由 3 个子代理并发审核后汇总
> 审核基线：`docs/android-dev.md`（ADR-046 P2）→ 桥接层 / 前端事件与目录解析 / 业务集成层
> 风险级别：P1(极高) / P2(高) / P3(中) / P4(低)

---

## 一、总体结论

**三个子代理的局部结论不一致，但指向同一事实：架构工艺扎实，集成契约未经真机/源码验证。**

| 子代理 | 范围 | 结论 |
|---|---|---|
| A | Go + Java 桥接 / 权限 / 平台守卫 | 有条件通过（无 P1，缺陷集中 Java 生命周期与 Android 平台假设） |
| B | 前端事件 + 目录解析 | **不通过**（发现 P1：6 个 `Events.On` 真机全部不可达） |
| C | 业务集成 + 全局测试覆盖 | 有条件通过（P1：磁盘泄漏 + 测试黑盒） |

**汇总判定：不通过（P1-1 经本人核实成立，核心 Android 事件子系统在真机失效；已于 2026-08-10 修复，待真机/CI 复验）。**

> ✅ **已亲自下场核实 — P1-1 成立（致命，非误报）。**
> 本人直接读取 Wails v3.0.0-alpha2.105 运行时源码 + 项目本体 Java/Go 代码，确认投递链断裂属实：
> - `MainActivity.java` 用 `emitSystemEvent("android:back" / "storage:permissionGranted" / "android:NetworkChanged" / ...)` 发射；
> - `application_android.go:650-656` 的 `androidSystemEventTypes` 仅含 5 个（`BatteryChanged/NetworkChanged/ThemeChanged/ScreenLocked/ScreenUnlocked`），**不含 `android:back` 与 `storage:permissionGranted`** → 这两条走 `else` 分支被 `androidLogf("warn", ...)` 直接丢弃；
> - 命中的 5 个也只投 `applicationEvents` 通道（`handleApplicationEvent`，Go 侧 `applicationEventListeners`），**永不到达 WebView**；
> - 前端 `@wailsio/runtime` 的 `Events.On` 订阅的是另一条 `CustomEvent` 通道（`dispatch` → `wailsEventListeners`）；
> - 项目 Go 侧 grep `OnApplicationEvent` / `Event.Emit("android"` **零命中，无转发器**。
> 结论：`android-events.ts` 的 6 个 handler 在真机**全部不可达**，ADR-046 P2「授权后自动重扫」与 ADR-047「返回键先关弹窗」在真机**均失效**。A、C 子代理因未追踪 Wails 运行时投递链而漏报此 P1。

---

## 二、关键风险总览（去重后，按 P1→P4）

### 🔴 P1 — 极高（建议合入前必须处理）

| # | 问题 | 维度 | 位置 |
|---|---|---|---|
| 1 | **（已核实·已修复）事件投递链路断裂**：`android:back` / `storage:permissionGranted` / `NetworkChanged` 等经 `emitSystemEvent` 发，真机全部不送达 JS（`android:back`/`storage:permissionGranted` 甚至被白名单丢弃）。后果：返回键首按无反应、授权后不重扫、断网无提示；`android-events.ts` 整体为运行时死代码 | 功能 | `MainActivity.java:1031/546/897/924/788/829/849/859` → `application_android.go:650-656,746-750` → `event_manager.go:128 vs 143` → `android-events.ts:16-66` |
| 2 | **`wails-picker` 缓存副本永不清理（磁盘泄漏）**：每次选择建 `cacheDir/wails-picker/<nanoTime>/` 完整副本，全仓无清理，`onDestroy` 也不清 | 性能 | `MainActivity.java:610-644` / `onDestroy:1001` |
| 3 | **`registerAndroidEvents` 6 个事件消费零测试**：行为完全黑盒 | 测试 | `android-events.ts:14-67` |
| 4 | **`getAndroidBridge()` 零测试**：全局 Android 门控唯一判据 | 测试 | `android-bridge.ts:12-15` |
| 5 | **授权「拒绝」路径无事件/兜底/测试**：用户拒绝后前端永久停在"引导中" | 测试 | `MainActivity.java:541-548` |

### 🟠 P2 — 高

| # | 问题 | 维度 | 位置 |
|---|---|---|---|
| 6 | **返回键双击退出窗口与弹窗消费冲突**：Java 先置 `lastBackPressTime` 再发事件，前端关弹窗后 Java 退出窗口已武装 → 2s 内再按直接退出，零提示 | 功能/逻辑 | `MainActivity.java:1021-1032` ↔ `android-events.ts:18` |
| 7 | **`NetworkChanged` payload 形状假设错误**：Go 侧 `Emit` 单参时 `Data` 为对象而非字符串，断连提示静默失效（且 `catch{}` 吞错） | 功能 | `android-events.ts:31-44` |
| 8 | **`permissionGranted` 双发 + `tree:reload` 无重入守卫/防抖**：一次授权触发 2 次全量扫盘，`vm._entries` 后写覆盖 | 功能/性能 | `MainActivity.java:546,897` + `bus-handlers.ts:256-282` |
| 9 | **已授权但目录不可用静默无反馈**：`GetDefaultRepoRoot` 返空时 `return null` 无 toast/日志，违反「失败必须可见」 | 功能 | `directory-picker.ts:36-38` |
| 10 | **授权 AlertDialog 可堆叠**：`setCancelable(false)` 无在途判重，多入口触发叠加 | 功能 | `MainActivity.java:921-943` |
| 11 | **网络事件高频无节流/去重**：蜂窝网下每秒多次回调，全量构造+JNI 派发 | 性能 | `MainActivity.java:701-713` |
| 12 | **`file.reveal` 缺 Android 守卫**：直调 `RevealInExplorer` → Android 上 Go 守卫报错红色 toast，同族按钮行为不一致 | 功能 | `context-menus.ts:414-423` |
| 13 | **Android 上各类资源根被统一覆盖为同一公共目录**：高级设置各类型"更改"全指向 `GetDefaultRepoRoot()` | 功能 | `community.ts:191-196` |
| 14 | **base64 峰值内存 ~2.7× 文件体积**：队列常驻持有 `base64` + `File`，无总量/单文件上限，Android WebView 易 OOM | 性能 | `import-queue.ts:69-75,589-609` |
| 15 | **文件夹整组导入一次性攒全部 base64**：峰值 = 整文件夹 ×1.33，无分批 | 性能 | `import-executor.ts:111-135` |
| 16 | **`menuMore` 无并发槽位**：连点 → 叠加多路 `tree:reload` + 多系统授权页 | 性能/功能 | `toolbar-events.ts:363-370` |
| 17 | **Activity 重建致文件选择回调永久悬挂**：`pendingWebFileChooser` 未持久化、`onDestroy` 未 `onReceiveValue(null)` | 功能 | `MainActivity.java:284-288,1001`；`Manifest:54` |
| 18 | **`pathmgr_android.go` 零单测**：全仓 `grep go:build android *_test.go` 无结果 | 测试 | `internal/app/pathmgr_android.go` |
| 19 | **Java 层零测试**：`build/android/app/src/` 仅有 `main`，无 `test/`/`androidTest/` | 测试 | `build/android/` |

### 🟡 P3 — 中（择批修复，清单节选）

- `/data/data` 硬编码，多用户/工作资料场景失效（`pathmgr_android.go:37`）
- `EXTERNAL_STORAGE` 未 `EvalSymlinks` 规范化/未校验 → 路径字符串表示不一致（`pathmgr_android.go:74-77`）
- `println(err)` 诊断不可读且 Android 不进 logcat（`pathmgr.go:33`）
- 缓存目录只增不减（同 P1-2，弱项单列）
- 静态线程池 `executor` 未 `shutdown()` + Activity 泄漏窗口（`WailsJSBridge.java:21,57-65`）
- `invoke()` 同步阻塞 JS 线程（`WailsJSBridge.java:38-42`）
- WebView 释放顺序不规范（未 `removeView`/`removeJavascriptInterface`）（`MainActivity.java:1000-1010`）
- `usesCleartextTraffic="true"` 论据与 `WAILS_SCHEME="https"` 矛盾，构成不必要 MITM 面（`Manifest:45-48` ↔ `MainActivity.java:63`）
- `SelectImportFile` 吞错，取消/失败不可区分（`resource_bindings.go:288-292`）
- `AddFilter` 在 Android 被忽略，扩展名过滤形同虚设（`resource_bindings.go:282` ↔ `MainActivity.java:527`）
- `resolveAndroidRepoDir` 未授权分支无节流，与 `loader.ts` 5s 节流策略不一（`directory-picker.ts:26-34`）
- 高级设置 `pickDirectory` 在 try 外 + 无 `_busy` 防连点（`community.ts:195`）
- `set-mc-path` 在 Android 写入无意义 mcRoot（`community.ts:115-121`）
- 导入文件当前实现为**单选**，文档写"多选"（`android-dev.md:33-34` 失真）
- 契约测试 `tests/*.mjs` 对 android 零覆盖；`android-events.test.ts` 缺失

### 🟢 P4 — 低（维护债务，可忽略）

- 冷启动伪"新授权"信号、`launchFilePicker` 锁不对称、注释漂移、`string(raw)` 全量拷贝、空结果仍起线程、双重 `getAndroidBridge()` 调用、toast 双分隔符等（详见各子代理报告）

---

## 三、分维度结论

### 1. 功能逻辑验证
- **核心缺陷在「Java↔JS 事件契约」**：Wails v3 的 `emitSystemEvent` 不投递 WebView，而本仓前端全部依赖它 → 若 B 结论成立，`android-events.ts` 是运行时死代码，ADR-046 P2「授权后自动重扫」与 ADR-047「返回键先关弹窗」均失效。
- **状态机/时序类缺陷密集**：返回键双击竞态、授权事件双发、Activity 重建悬挂——均属"桌面经验难迁移、唯有真机可暴露"的类。
- **已验证正确的项**：`resolveAndroidRepoDir` 是路径类按钮唯一入口（4 调用点零复制）；桌面无桥不崩溃（5 消费方均有 null 守卫）；ADR-028 反模式未重现；路径穿越防御与 JS 转义细节高于平均水平。

### 2. 性能分析
- **确认 1 项资源泄漏（P1）**：`wails-picker` 缓存无清理。
- **内存峰值风险（P2）**：导入链路 base64 常驻 + 整组攒齐，Android WebView 堆上限下易 OOM。
- **冗余/并发（P2）**：`tree:reload` 全仓 14 处 emit 但无防抖无重入守卫；网络事件高频无去重。
- **亮点**：错误 toast 与授权引导各自 5s 节流已落地且有测试；可写性用真实 `CreateTemp` 探针而非 `MkdirAll`，规避经典误判。

### 3. 测试覆盖检查
- **零覆盖区域（严重）**：`pathmgr_android.go`（无 `//go:build android` 测试）、Java 整层（无 `test/`/`androidTest/`）、`android-events.ts`、`getAndroidBridge()`、契约测试 `tests/*.mjs` 对 android 零命中。
- **弱覆盖**：调用方 Android 分支多为"正向断言"，缺授权拒绝/取消/断网/并发重入等边界。
- **回归闸门已落地**：`frontend/src/core/handlers/android-events.test.ts`（vitest，8 用例）覆盖事件名逐字匹配 / string payload 解析 / 非 string 不崩 / 返回键弹窗消费 / 授权后双刷新——校验 `MainActivity` 事件是否真能送达 JS（若此测试当初存在，P1-1 不会漏网）。

---

## 四、放行条件（建议优先级）

1. **[已修复]** P1-1 已于 2026-08-10 修复：`MainActivity.java` 9 处 `emitSystemEvent` 全改 `emitEvent`（走 CustomEvent 通道直达前端）；`android-events.ts` 注释与 `android_events.md`/`android-dev.md` 错误不变量已同步；`android-events.test.ts` 作回归闸门。待真机 `assembleDebug` 复验。
2. **[阻断]** 清理 `wails-picker` 缓存（P1-2）。
3. **[高]** 修复返回键计时竞态 + `NetworkChanged` payload 形状 + 授权双发重扫（P2-6/7/8）。
4. **[部分满足]** `android-events.test.ts` 已新增（P1-3）；`getAndroidBridge.test.ts` 待补（P1-4）。
5. **[中]** disk/内存泄漏治理、并发槽位、`file.reveal` 守卫、文档"多选"表述修正（P2/P3 清单）。

---

## 五、各子代理亮点（值得保留的工艺）

- **单点平台门控零 `as any`**：`android-bridge.ts` 仅一处触碰 `window.wails`，5 消费方零复制，ADR-014 落实。
- **目录解析唯一入口真实复用**：4 调用方零逻辑复制，兑现 `android-dev.md:23`。
- **拒绝静默降级**：Go 侧宁可返空串走引导也不回退到不可写的 `/`，与「失败必须可见」一致。
- **路径穿越防御正确**：`getCanonicalPath().startsWith(cacheCanonical + separator)`，规避 `cachefoo` 绕过。
- **前台限定广播注册 / 传感器意图态与实际态分离**：省电与状态一致性兼顾。
- **测试负向断言坚持**：`directory-picker.test.ts` 既断言"做了什么"也断言"不该做的没做"。

---

_附录：三份子代理原始报告分别对应 桥接层(agent-d366811c) / 前端事件(agent-ce2b33b1) / 业务集成(agent-a938d3f0)，本报告已去重合并。所有结论均基于真实文件行号，未修改任何仓库文件。_

---

## 六、修复记录（2026-08-10）

> 针对 P1-1（事件投递链路断裂）实施的修复，由本人（Riku）在 Craft 模式下落地，已通过 vitest + tsc 验证。

### 根因（复核结论）
`MainActivity.java` 经 `emitSystemEvent` 发 `android:*` / `storage:permissionGranted` 事件；在 wails v3.0.0-alpha2.105 中该通道仅投 Go 侧 `applicationEvents`（`handleApplicationEvent`），永不到达 WebView。前端 `Events.On` 订阅的是另一条 `CustomEvent` 通道。两条通道互不相交，故 6 个 handler 真机全部不可达。

### 改动清单
| 文件 | 改动 |
|------|------|
| `build/android/app/src/main/java/com/wails/app/MainActivity.java` | 9 处 `bridge.emitSystemEvent(...)` → `bridge.emitEvent(...)`（走 CustomEvent 通道直达前端） |
| `frontend/src/core/handlers/android-events.ts` | 顶部注释纠正通道前提（`emitSystemEvent` → `emitEvent`，说明不到前端原因） |
| `frontend/src/core/handlers/android-events.test.ts` | **新增** vitest 回归测试（8 用例：事件名匹配 / string payload 解析 / 非 string 不崩 / 返回键弹窗消费 / 授权双刷新） |
| `docs/android-dev.md` | 双端桥表格修正通道名 + 坑点速查新增 `emitEvent` 坑点 |
| `docs/knowledge/android_events.md` | Java 层关系说明 `emitSystemEvent` → `emitEvent` |

### 验证
- `npx vitest run src/core/handlers/android-events.test.ts` → **8/8 通过**
- `npx tsc --noEmit`（前端） → **0 错误**
- Java 侧 `emitSystemEvent` 残留 grep → **0 命中**（确认全量切换）

### 待办（不在本次范围）
- 真机 `assembleDebug` 复验事件确已到达（Java 改后需 NDK 交叉编译才能跑，宿主机未编）。
- P1-2 `wails-picker` 缓存清理、P1-4 `getAndroidBridge.test.ts`、P2/P3 详见 §四。
