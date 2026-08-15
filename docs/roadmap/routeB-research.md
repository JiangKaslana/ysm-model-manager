# ADR-066 路线 B 预研：把 go/threejs Spec3D 生成搬进浏览器

> 只调研不改代码。下文结论均以依据文件:行号标注。

---

## 0. 关键前置发现（必读，影响评估结论）

用户背景里"网页端没有 Go 运行时，必须 round-trip 回 Go"这个命题**已被 ADR-049 P2-2（2026-08-12）事实上解决**——并非用 WASM，而是用**纯 TS 移植**：

- `frontend/src/utils/3d/spec-builder.ts` 已完成 Go `Build3DSpecFromGeometryJSON` 的纯 TS 移植（304 行），契约镜像 `internal/app/app_model.go:188`，双边测试锁定（`spec-builder.test.ts` ↔ `app_model_test.go`）。
- `frontend/src/views/app-preview/model3d-loader.ts:117` 已消费 `buildSpecFromGeometryJSON(decoded.geometryRaw)` 走纯 TS 路径（`resolveWebMode()` 分支）。
- `docs/adr/ADR-049-web-edition-bridge.md:65-68` 明确记载：**"实现路径与原计划（移植到 ysm-parser WASM）不同——TS 移植成本更低、与 Go 契约可直接双边对拍，WASM 路线放弃。"**

同时，用户提到的 `model3d-spec.ts`（366 行）确实是**更早期的已废弃"JS 兜底"**——它现在唯一的消费者是 `cube-mesh.ts:8` 的 `CUBE_EPS` 常量，`buildSpecFromModel` 函数本身已无生产调用方（仅在 `model3d-spec.test.ts` 自测）。**当前产线算法权威是 `spec-builder.ts`，不是 `model3d-spec.ts`。**

**这意味着 ADR-066 路线 B 实际是在重开"要不要 Go WASM"这个 ADR-049 已经判死刑的决策**。本评估照单全收技术可行性，但结论会如实反映这个前置事实。

---

## 1. Go WASM 两种编译模式的浏览器可行性

### 1.1 `GOOS=js GOARCH=wasm`（syscall/js + wasm_exec.js）

**可行性：✅ 完全可行。**

- **threejs 依赖链无系统调用阻塞**：`go/threejs` 6 文件（spec.go 864 行 + 5 个测试文件），生产代码 grep `"os"|"syscall"|"unsafe"` 零命中（唯一 `"os"` 出现在 `spec_fixture_test.go:11`，仅测试用）。
  - 依据：`go/threejs/spec.go:1-13`（import 列表只有 `encoding/json`/`fmt`/`log`/`math`/`strconv` + `ysm-model-manager/go/types`）；`spec_fixture_test.go:11` 是测试。
  - `go/geometry` 生产代码零 `"os|syscall|unsafe"`（只在 `_test.go` 里有 `os` 做夹具读入）。
  - `go/types` 生产代码：`resource.go:7` 和 `extensions.go:9` 有 `"os"`，但二者是**类型注册表加载**（`LoadResourceTypes`），与 Spec3D 构建无关；`types/bedrock.go:1-42` 完全是纯 json 结构，零依赖。
- **`wasm_exec.js` 位置确认**：本机的 Go 是 `go1.26.3 windows/amd64`，`C:\Program Files\Go\lib\wasm\wasm_exec.js`（16992 字节）+ `go_js_wasm_exec` 603 字节 + `go_wasip1_wasm_exec` 797 字节（新版 Go 多了一套 wasip1 辅助）。浏览器使用路径：
  ```html
  <script src="/static/go.js"></script>   <!-- 从 Go 安装目录复制 -->
  <script>
    const go = new Go();
    WebAssembly.instantiateStreaming(fetch("/static/spec3d.wasm"), go.importObject)
      .then(result => go.run(result.instance));
  </script>
  ```
- **浏览器加载方式**：Go 官方在 `wasm_exec.html` 里提供了完整范例，标准模式就是 `instantiateStreaming` + `new Go()`。

### 1.2 `GOOS=wasip1 GOARCH=wasm`（WASI）

**可行性：⚠️ 理论上可行，但浏览器侧要补 WASI polyfill，实际复杂度高出一档。**

- WASI 模式**没有 `syscall/js`**，Go 应用以 `main()` 方式运行，通过 stdin/stdout 或 WASI 文件描述符做 JSON 通信。浏览器需引入 `@wasmer/wasi` 或 `wasmtime-js` 作为宿主。
- 依赖链 WASI 兼容性：`github.com/bodgit/sevenzip`（本项目 go.mod:7 用 v1.6.4）是纯 Go 库，无 Cgo、无 `syscall/os` 系统调用（仅用 `io`/`bytes`/`compress` 等标准库 I/O 抽象）。**但 sevenzip 本身不直接参与 Spec3D 构建**——`go/threejs` 只依赖 `go/geometry` + `go/types`；geometry 只在解析阶段（`archive.go`）读 7z/zip，spec 构建阶段根本不加载这些容器。
- 所以**如果只切 spec 构建到 WASM，`GOOS=wasip1` 的 wasi 宿主根本不需要 sevenzip 运行时**——编译时 Go 会把所有依赖一起编进 wasm，但运行时只走 spec 构建路径。

### 1.3 推荐：`GOOS=js GOARCH=wasm`

| 维度 | js/wasm | wasip1 |
|------|---------|--------|
| 浏览器原生支持 | ✅ 无需 polyfill | ❌ 需 @wasmer/wasi 等 |
| JS↔Go 通信 | 直接函数导出 + `syscall/js.Value` | stdin/stdout JSON 或 FS |
| 调试支持 | Go 官方文档+IDE 支持 | 社区库，踩坑多 |
| 依赖兼容 | 所有纯 Go 库都支持 | 纯 Go 库基本支持，但需宿主 polyfill |

**结论：浏览器端首选 `GOOS=js GOARCH=wasm`**（syscall/js 路径），wasip1 除非未来要同一份 wasm 在 Node/Edge 侧复用否则不选。

---

## 2. WASM 入口设计

### 入口形态（估计 <60 行 Go 代码）

```go
// cmd/spec3d-wasm/main.go (GOOS=js GOARCH=wasm)
package main

import (
    "syscall/js"
    "encoding/json"
    "fmt"

    "ysm-model-manager/go/threejs"
    "ysm-model-manager/go/types"
)

func build(this js.Value, args []js.Value) interface{} {
    var model types.BedrockModel
    if err := json.Unmarshal([]byte(args[0].String()), &model); err != nil {
        return js.ValueOf(fmt.Sprintf(`{"error":"%s"}`, err))
    }
    out, err := threejs.Build(model)
    if err != nil {
        return js.ValueOf(fmt.Sprintf(`{"error":"%s"}`, err))
    }
    return js.ValueOf(out)
}

func buildMulti(this js.Value, args []js.Value) interface{} {
    // 类似，反序列化 []BedrockModel + []int，调 BuildMulti
}

func main() {
    js.Global().Set("spec3dBuild", js.FuncOf(build))
    js.Global().Set("spec3dBuildMulti", js.FuncOf(buildMulti))
    select {} // 阻塞主协程，保持 wasm 存活
}
```

**估算**：60 行 Go 代码 + 1 份 build tag（`//go:build js && wasm`，或直接放在 `cmd/spec3d-wasm/` 目录下）。`types.BedrockModel` 结构体已含 `json:"..."` tag，JSON 反序列化零工作量（`bedrock.go:4-42`）。

### 与生产代码隔离

- `cmd/spec3d-wasm/` 目录是**新入口**，不污染 Wails 主应用入口；wails 桌面端不受影响。
- 与 `go/threejs` 生产代码共享，算法改动自动同步——**这是 WASM 相对 TS 移植的核心优势**（见 §5）。

---

## 3. 前端接入

### 3.1 加载代码形态（估计 ~80 行 TS）

```ts
// frontend/src/wasm/spec3d-wasm.ts
let wasmReady = false;
let spec3dBuild: Function | null = null;

export async function initSpec3DWasm(): Promise<boolean> {
  if (wasmReady) return true;
  const go = await import("/static/go.js");   // 浏览器侧 <script> 已注册全局
  const response = await fetch("/static/spec3d.wasm");
  const wasmBytes = await response.arrayBuffer();
  const inst = await WebAssembly.instantiate(wasmBytes, go.importObject);
  go.run(inst.instance);
  spec3dBuild = (window as any).spec3dBuild;
  wasmReady = true;
  return true;
}

export function buildSpec3DFromBedrockModelJSON(json: string): string {
  return spec3dBuild!(json);
}
```

### 3.2 与现有 `ysm-parser.ts` 是否能共用基础设施

**结论：不能共用，且不应共用。**

- `ysm-parser.ts` 是 Emscripten 体系（`ccall`/`FS`/`_malloc`/`HEAPU8`），基于 C++ 编译的 ysm-parser。
- Go wasm_exec.js 是另一套体系（`WebAssembly.instantiate` + `Go()` 对象 + `syscall/js` 导出函数），无 `ccall`、无 EM_FS。
- 两份 wasm 需要各自独立的加载模块（`ysm-parser.ts` 一个，`spec3d-wasm.ts` 一个），**共用基础设施的 ROI 为零**。
- 但**数据传递能复用**：`model3d-loader.ts` 已有 `decodeYsmViaWasm` 输出 `geometryRaw`（BedrockModel JSON 字符串），直接传给 `spec3d-wasm.ts` 即可——这条 pipeline 完全复用。

### 3.3 接入 renderModel3D

`model3d-loader.ts:117` 目前调 `buildSpecFromGeometryJSON(decoded.geometryRaw)`（纯 TS 路径）。路线 B 只需把这行替换成 `buildSpec3DFromBedrockModelJSON(decoded.geometryRaw)`，`renderModel3D` 完全不感知（入参 `Spec3D` JSON 串，出参 `Model3DHandle`）。

---

## 4. 体积估算

| 项目 | 大小 | 依据 |
|------|------|------|
| Go wasm 运行时基线（`GOOS=js` hello-world） | ~1.5-2.5 MB（gzip 后 ~500-700 KB） | Go 官方经验值 |
| `go/threejs` 算法代码 + 依赖（geometry/types） | +150-300 KB（gzip 前） | spec.go 864 行 + 依赖包 |
| `encoding/json`、`math` 等标准库 | +200-400 KB（含在运行时基线里） | Go 编译时内联 |
| **总 wasm 大小估计** | **~2.0-3.0 MB（gzip 后 800-1100 KB）** | 与 ysm-wasm-data.js 体量相当 |

**对比**：`frontend/src/wasm/ysm-wasm-data.js` 体积 = **1457 KB**（纯 .wasm base64 编码，gzip 后 ~500 KB）。Spec3D wasm 体积与之相当，属于同一数量级，浏览器加载无压力。

**gzip 是必须的**：首次加载可接受（~1MB gzipped），后续命中浏览器缓存。WebView2 环境同 Chromium，缓存行为一致。

---

## 5. 对比方案：前端 TS 重写 spec 构建（现状）

### 5.1 现状——TS 重写**已完成**

- `spec-builder.ts`（304 行）= ADR-049 P2-2 产出的纯 TS 移植，2026-08-12 闭环并上线。
- 双边测试锁定：`spec-builder.test.ts` ↔ `app_model_test.go`。
- `model3d-loader.ts:117` 已消费此 TS 路径，网页版 3D 预览已闭环。

### 5.2 把 Go spec.go 2086 行翻译成 TS 的成本分析

**如果从零翻译**：

- `go/threejs` 6 文件 2086 行，生产代码约 1000 行核心算法。
- 关键陷阱（用户提到的"陷阱 #11 历史 9 次 fix"）集中在：
  - `vec3`/四元数（`spec.go` 含 `eulerToQuaternion` 等几何变换）
  - `inflate` 几何修正（origin-=-i, size+=2i）+ `mirror` UV 翻转
  - `texSlot` 与 `texIdx` 对齐
  - 多组件 `BuildMulti` 的 `texIdxBase` 偏移
  - 同名骨骼 cube 覆盖 vs merge 规则
- 完整翻译 + 双边测试锁定估计 **5-8 人日**。
- 维护风险：Go 改算法，前端 TS 要**手工同步**——ADR-049 已经靠"双边测试锁定"缓解，但**每次 Go 侧 spec 算法改动，都要改两份代码+跑两套测试**。

### 5.3 结论：WASM 复用 vs TS 重写

| 维度 | TS 重写（现状） | Go WASM（路线 B） |
|------|---------------|-------------------|
| 一次成本 | 5-8 人日（已花） | 3-5 人日 |
| 增量维护 | 每次 Go 改 → 改两份 | 改一份（共享） |
| 口径漂移风险 | 中（靠双边测试缓解） | 零（同一份 Go 代码） |
| 浏览器加载成本 | 0（纯 TS） | ~1MB gzip，首次加载 |
| 现有状态 | ✅ 已上线 | ❌ 未做 |

**"长治久安"角度**：Go WASM 从架构上是更优解（单一真源），**但 TS 路径已经跑通、双边测试已经锁定，且 ADR-049 已经决策过放弃 WASM**。除非未来出现明确证据表明 TS 路径有无法弥补的口径漂移问题，否则**重开 WASM 路线的 ROI 很低**。

---

## 6. 工作量分级（如果一定要立项）

| 里程碑 | 内容 | 代码量 | 风险 | 验收 |
|--------|------|--------|------|------|
| **M1** | `cmd/spec3d-wasm` 入口包 + `GOOS=js GOARCH=wasm` 编译 | 60 行 Go | 低 | `GOOS=js GOARCH=wasm go build -o spec3d.wasm ./cmd/spec3d-wasm` 成功 |
| **M2** | `spec3d-wasm.ts` 前端加载 + `go.js` 静态资源 | 80 行 TS + 1 静态文件 | 低 | 页面加载后 `spec3dBuild('{"bones":[]}')` 返回 `{"models":[]}` |
| **M3** | `model3d-loader.ts` 接入 WASM 替换 TS 路径 + 双侧对拍测试 | 20 行改动 | 中（口径对齐） | 现有 `spec-builder.test.ts` 全部用例在 WASM 路径下输出一致 |
| **M4** | Taskfile 加 wasm 构建目标 + CI pipeline | 30 行配置 | 中（CI 时间） | `task wasm` 生成 spec3d.wasm，CI 触发 |

**总体分级：M（中）**，约 10-15 人日（含对拍测试 + CI）。

---

## 7. 风险清单

| # | 风险 | 严重度 | 缓解 |
|---|------|--------|------|
| R1 | **wasm 体积 ~1MB gzip**，首次加载慢 | 中 | CDN + 预加载 + 与 ysm-wasm 合并加载窗口 |
| R2 | **WebView2 WASM 支持** | 低 | 现代 WebView2 = 最新 Chromium，WASM + `instantiateStreaming` 完全支持 |
| R3 | **JSON 传递性能**（模型几百 KB - 几 MB 的 BedrockModel JSON） | 中 | JSON marshal 在 Go 侧是 O(n)，1MB JSON ~10-30ms，可接受；若未来卡可做 `[]byte` 直传（syscall/js.TypedArrayOf） |
| R4 | **构建链集成**（Taskfile 加目标 + CI 触发） | 低 | 30 行配置 |
| R5 | **与 Wails 桌面共存** | 无风险 | `cmd/spec3d-wasm` 独立包，wails 主入口不引用 |
| R6 | **七重依赖**（`github.com/bodgit/sevenzip`）的 WASM 编译 | 低 | 纯 Go 库无阻塞；但 spec 构建根本不加载 sevenzip |
| R7 | **维护分叉**：TS 路径已上线，WASM 路径会与现有 TS 路径并存 | 高 | 需要明确"是替换还是并存"——建议**替换**，避免两条 spec 构建链分叉 |

---

## 难度评估（≤20 行）

**推荐方案**：`GOOS=js GOARCH=wasm` + `cmd/spec3d-wasm` 独立入口 + `spec3d-wasm.ts` 独立加载模块，数据路径复用 `model3d-loader.ts` 现有 `decodeYsmViaWasm → geometryRaw`。

**总工作量**：M（10-15 人日），4 个里程碑可串行，风险集中在 M3 双侧对拍。

**最大风险**：R7——**TS 路径已经上线并 ADR-049 明确放弃 WASM，路线 B 会与现有生产代码并存或替换，决策成本高过实现成本**。

**是否值得立项 vs 暂缓**：**建议暂缓**。理由：

1. **ADR-049 已决策**：`spec-builder.ts`（304 行纯 TS）已跑通、上线、有双边测试锁定，网页版 3D 预览已闭环。
2. **WASM 相对 TS 的唯一实质优势**（单一真源）在当前场景下收益很低——`spec.go` 算法本身稳定，历史 9 次 fix 都已在 TS 侧通过双边测试同步。
3. **新增 ~1MB wasm 加载**对网页版首屏是纯负担，而 TS 路径零增量加载。
4. **除非**用户能给出"未来 3 个月内 spec 算法会频繁改动"的明确信号，否则路线 B 的 ROI 为负。

**如果立项**：先做 M1 spike（半天出 spec3d.wasm 能跑的 demo），再决定是否继续 M2-M4。M1 本身就是最好的决策证据。

---

## 附录：依据文件清单

| 事实 | 依据 |
|------|------|
| threejs 生产代码零 os/syscall/unsafe | `go/threejs/spec.go:1-13` + grep `go/threejs` 结果 |
| threejs spec.go 结构（Build/BuildMulti 签名） | `go/threejs/spec.go:61`、`:80`、`:110` |
| BedrockModel 纯 json 结构 | `go/types/bedrock.go:4-42` |
| model3d-spec.ts 是废弃兜底 | `frontend/src/utils/3d/model3d-spec.ts:1-3` + 无生产调用方 |
| spec-builder.ts 是当前活跃 TS 移植 | `frontend/src/utils/3d/spec-builder.ts:1-5`、`:113` |
| 网页版已用 spec-builder.ts | `frontend/src/views/app-preview/model3d-loader.ts:117` |
| ADR-049 已放弃 WASM 路线 | `docs/adr/ADR-049-web-edition-bridge.md:65-68` |
| ysm-wasm-data.js 体积 | `frontend/src/wasm/ysm-wasm-data.js` = 1457 KB |
| wasm_exec.js 位置 | `C:\Program Files\Go\lib\wasm\wasm_exec.js` (16992 bytes) |
| Go 版本 | `go version go1.26.3 windows/amd64` |
| sevenzip 纯 Go | `github.com/bodgit/sevenzip` README（纯 Go 无 cgo） |
