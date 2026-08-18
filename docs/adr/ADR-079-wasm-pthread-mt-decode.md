# ADR-079：WASM pthread 多线程解码：三端 COOP/COEP 注入 + 重编译上游

- **状态**：✅ 已采纳（M1-M4 全落地：网页 COI SW / 桌面中间件 / 重编译 pthread / 接入降级）
- **日期**：2026-08-16
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`upstream/YesSteveModel-Parser/build-wasm`、`frontend/src/wasm/ysm-worker-loader.ts`、`docs/adr/ADR-070-web-voxel-3d-ts-port.md`、借鉴 `MikuMikuAR`（`frontend/dist-web/app/sw.js` COI Service Worker + `CoopCoepMiddleware` mpr build tag）

---

## 1. 背景（Context）

### 1.1 单模型解码是单线程

上游 YSMParser 用 Emscripten（emcc）编译，`build-wasm/CMakeCache.txt` 的 `CMAKE_CXX_FLAGS` 为空（**无 `-pthread`**）——WASM 单线程。单模型 YSM 解码（纹理 fpng + geometry + 骨骼）是顺序流水线，多核闲置。

### 1.2 多线程的两条路

- **路 B（Worker 池，已落地 ADR-071 #6 扩展）**：多个 stats Worker 并行解码**不同模型**（多模型批量并行）——纯 JS，无 SharedArrayBuffer/COOP-COEP 依赖，GitHub Pages 可用。角标 `🧵×N`。
- **路 A（WASM pthread，本 ADR）**：重编译上游 `-pthread -sUSE_PTHREADS=1`，WASM 内部 Worker 池 + SharedArrayBuffer——提升**单模型**解码吞吐（fpng 可并行，整体估计 1.5-2x）。

### 1.3 部署墙与隔壁破法（关键事实）

SharedArrayBuffer 要求 `crossOriginIsolated`（COOP/COEP 响应头）：

| 端 | COOP/COEP 注入 |
|----|----------------|
| 网页版 GitHub Pages | 静态托管**无法自定义响应头**——但 MikuMikuAR 已实证：**Service Worker 拦截响应补 COOP/COEP**（`COEP: credentialless` 而非 require-corp，避免硬拦无 CORP 的跨源资源如 AI relay/GitHub API/iframe），浏览器在下一次导航（SW 控制后 reload）解锁 `crossOriginIsolated=true`（实测 `threads=24` 成功） |
| 桌面 Wails | Go `CoopCoepMiddleware`（mpr build tag 门控注入 `COOP: same-origin` + `COEP: require-corp`） |
| Android | `MainActivity.shouldInterceptRequest` 注入 |

## 2. 决策（Decision）

**单模型解码多线程 = 三端 COOP/COEP 注入 + 重编译上游 pthread，分四阶段，不互相等：**

1. **M1（网页 COI，先行）**：网页版 **COI Service Worker**——拦截同源响应补 `COOP: same-origin` + `COEP: credentialless`（借鉴 MikuMikuAR sw.js：credentialless 放行无 CORP 跨源子资源、注册后下次导航生效、不支持浏览器自动降级）；注册 `crossOriginIsolated` 检测（`crypto.subtle`/`crossOriginIsolated` 属性）供前端分支。
2. **M2（桌面中间件）**：Wails asset server 加 `CoopCoepMiddleware`（mpr build tag 门控，桌面默认关——WebView2 本地服务注入 `COOP/COEP` 解锁 SharedArrayBuffer）。
3. **M3（重编译上游）**：`upstream/YesSteveModel-Parser/build-wasm` 加 `-pthread -sUSE_PTHREADS=1 -sPTHREAD_POOL_SIZE=4` 重编译 → 产出多线程 WASM + 胶水；`pack-wasm.ps1` 打包双产物（单线程默认 + 多线程可选用）。
4. **M4（接入 + 降级）**：前端 `ysm-worker-loader.ts` 支持加载多线程 WASM 变体（`crossOriginIsolated=true` 时用 pthread 版）；不支持/未隔离 → 自动降级单线程 WASM（现状链路不变）。

**边界**：不做 WASM SIMD/多线程的深度调优（fpng 并行是唯一明确收益点）；Worker 池（路 B）与 pthread（路 A）**互补共存**——批量统计走池、单大模型加载可走 pthread；pthread 不作为网页版默认（Pages 首次加载无 SW 控制需 reload，降级路径保持默认单线程）。

**实现补注（2026-08-16）**：M1 落地（public/sw.js 纯 COI SW + coi-sw.ts 注册/检测，网页版 Pages 可达 crossOriginIsolated）；M2 落地（internal/app/coi_middleware.go + mpr_off/on.go，main.go Middleware 接入，-tags mpr 构建注入 COOP/COEP；off/on 双测试）；M3 落地（ysm-wasm-data-mt.js + ysm-glue-data-mt.js 双产物 + initYsmParserInWorkerMt pthread 初始化）；M4 落地（stats.worker.ts:99–101 crossOriginIsolated 分支 → pthread/单线程自动降级）。**M1–M4 全落地，2026-08-18 补注。**

## 3. 后果（Consequences）

**正面**：
- 单模型 YSM 解码多线程（1.5-2x 估计），三端（网页/桌面/Android）路径完整。
- 隔壁（MikuMikuAR）已实证 SW credentialless 方案在 GitHub Pages 达成 `crossOriginIsolated=true`——风险前置消化。
- 分阶段解耦：M1（SW）独立可做、M2（桌面中间件）独立、M3（重编译）独立、M4（接入）收口——**不互相等**。

**负面**：
- 重编译上游 + 双 WASM 产物（体积：pthread WASM + worker 胶水，与 stats worker chunk 同量级）——bundle 增长。
- SW 首次导航不生效（需 reload 一次解锁跨源隔离）——体验小瑕疵，自动降级兜底。
- `COEP: credentialless` 的跨源子资源语义变化（不带凭据）——需验证现有跨源调用（AI relay/GitHub API/iframe）不受影响（MikuMikuAR 已验证同款）。

**已知遗留**：
- fpng 并行化的实际加速比需 M3 后基准测试确认（预期 1.5-2x，非线性）。
- Android `shouldInterceptRequest` 注入的验证（低优先，Android 端无网页版渲染需求）。
- 双 WASM 产物按需加载策略（多线程版仅 `crossOriginIsolated` 时下载）。

## 4. 数据溯源

来源：用户追问"YSMParser 能否多线程"+ 实查上游 `build-wasm/CMakeCache.txt`（emcc 无 -pthread）+ 隔壁 MikuMikuAR 实证（SW 注入 COOP/COEP credentialless 在 GitHub Pages 达成 `crossOriginIsolated=true`，`threads=24`）→ 结果：ADR-079 立项，方向 = 三端 COOP/COEP 注入 + 重编译上游 pthread，四阶段（M1 SW → M2 桌面中间件 → M3 重编译 → M4 接入降级），与 Worker 池（路 B）互补共存。编码按 M1 → M4 排期，M1（SW）不依赖他人。

<!-- 文件名: wasm-pthread-mt-decode.md → 实际文件 ADR-079-wasm-pthread-mt-decode.md -->
