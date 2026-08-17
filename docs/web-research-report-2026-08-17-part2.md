# 联网调研报告（续）：rsync/MEMFS/Molang/watcher/CAS 五个新方向

- **日期**：2026-08-17（周一）
- **作者**：鲸鱼架构师 deepseek（GLM-5.2）
- **范围**：基于 88 张知识卡现状联想出的 5 个新方向，对照业界一手资料，提炼可落地的代码范式与避坑点
- **前序报告**：`docs/web-research-report-2026-08-17.md`（Wails COOP/COEP、Go os.Root、emscripten Pthread、VRM 骨骼、原生 Web Components）
- **本报告动机**：前序报告围绕"项目当前在攻克的难点"，本报告围绕"知识卡里已有入口、但尚未联网对照业界最佳实践的方向"——从 scanner/sync/wasm/animation/watcher 五张卡联想出去

---

## 0. 联想路径与调研主题

| # | 知识卡现状（联想起点） | 新方向主题 | 业界对照 |
|---|----------------------|-----------|---------|
| 1 | `go-sync` 用全量 SHA256 对比 Missing/Extra/Disabled | **rsync rolling hash 增量同步** | rsync 技术报告 + `minio/rsync-go` + `kardianos/rsync` |
| 2 | `ysm-wasm` Go 端 Node.js + WASM callMain + MEMFS 是生产主路径 | **WASM 大文件流式 I/O**（替代 MEMFS 全量载入） | emscripten issue #21335 + WasmFS + OPFS |
| 3 | `animation-system` 解析基岩版 animation.json 关键帧插值 | **Molang 表达式求值**（animation.json 里的 `query.x` 表达式） | `bridge-core/molang` + `JannisX11/MolangJS` + bedrock.dev 规范 |
| 4 | `go-watcher` 监听文件变化触发刷新 | **Robust file watcher**（Windows ReadDirectoryChangesW 缓冲区溢出/漏事件） | Microsoft Learn + fsnotify Windows 后端源码 |
| 5 | `go-scanner` 30s 扫描缓存 + 路径级失效 + per-key 版本戳 | **Content-addressable 缓存**（替代手写失效层） | git-like object store + content hash key |

---

## 1. rsync rolling hash 增量同步（`go-sync` 升级方向）

### 1.1 一手资料

**来源 1**：rsync 技术报告《The rsync algorithm》（rsync.samba.org）

核心算法（5 步）：

1. 文件 B 切成固定大小 S 字节的非重叠块（最后一块可能更短）
2. 每块算两个 checksum：**weak rolling 32-bit** + **strong 128-bit MD4**
3. 把 checksum 发给持有 A 的那边
4. A 那边在所有偏移（不只是 S 的倍数）搜索匹配块，用 rolling checksum 的特殊性质单次遍历
5. 发回构造 A 的指令序列：引用 B 的块 / 字面量数据

关键性质（rolling checksum）：

```
s(k,l) = a(k,l) + 2^16 * b(k,l)
a(k,l) = (a(k,l-1) + X_l) mod M
b(k,l) = (b(k,l-1) + (l-k+1)*X_l) mod M
```

- 给定 `X1..Xn` 的 checksum，算 `X2..Xn+1` 的 checksum 非常便宜
- 在文件所有偏移以 rolling 方式计算，每个点计算量极少

**来源 2**：`minio/rsync-go`（纯 Go 实现，用 highwayhash）

```go
rs := &rsync.RSync{}
rs.CreateSignature(srcReader, writeSignature)  // 算 B 的签名
rs.CreateDelta(targetReader, sig, writeOperation, nil)  // 算 A 相对 B 的 delta
rs.ApplyDelta(srcWriter, srcReader, opsOut, nil)  // 用 delta + B 重建 A
```

**来源 3**：`kardianos/rsync`（纯 Go，无 CGO，含 `rdiff` CLI）

核心 API：`CreateSignature` / `CreateDelta` / `ApplyDelta`，与 `minio/rsync-go` 同构。

### 1.2 与项目现状对照

| 项目 `go-sync` 现状 | rsync 范式 |
|-------------------|-----------|
| 全量 SHA256 对比 Missing/Extra/Disabled | rolling weak + strong checksum，只传差异块 |
| 文件级对比（整个文件哈希相同则 Synced） | 块级对比（文件大部分相同只传差异） |
| 推送 = 复制/硬链接整个文件 | 推送 = 发 delta + 对端 patch |
| 哈希 >500MB 跳过（性能保护） | rolling hash 天然分块，大文件不是问题 |

### 1.3 落地建议

**短期（不引入 rsync）**：现状全量 SHA256 对比在"模型文件不大、数量不多"的场景下够用，**不要为优化而优化**

**中期（性能瓶颈出现时）**：
1. 引入 `kardianos/rsync` 或 `minio/rsync-go`，在 `sync_push.go` 的推送路径用 rsync delta 替代整文件复制
2. 前提：推送两端都跑项目代码（实例侧 + 仓库侧），rsync delta 需要两端配合
3. 注意：项目当前推送是"仓库 → 实例"的单向复制，rsync 的收益在于**两端已有相似文件，只传差异**——如果实例侧本来就没有文件，rsync 退化为整文件传，无收益

**避坑点**：
- rsync rolling checksum 在**高度随机化的压缩数据**上效果差（块几乎不会匹配）——YSM 模型是二进制，内部可能已压缩，rsync 收益不确定
- `kardianos/rsync` 的 `ApplyDelta` 需要随机写 basis 文件，对硬链接/符号链接场景需额外处理

---

## 2. WASM 大文件流式 I/O（`ysm-wasm` 升级方向）

### 2.1 一手资料

**来源**：emscripten issue #21335 "[WasmFS+OPFS] Unspecified file size limit"

核心问题：

> I have a wasm file compiled with `-lopfs.js -sWASMFS -sFORCE_FILESYSTEM` ... it works for smaller files (~150MB) but fails for a 4GB file. When I try to read it using `readFile` from JS I don't see correct size on ArrayBuffer.

官方回复（关键）：

> In WasmFS, the `readFile` JS API first reads the entire file into Wasm memory, then copies the contents out into JS. For very large files, it will not be possible to allocate that much Wasm memory, so `readFile` will fail. I recommend using `read` instead of `readFile` to read the file contents in chunks rather than all at once.

issue 中的实测代码：

```c
void em_fs_4gb_test() {
    FILE *f = fopen("/opfs/test.mp4", "wb");
    u32 block_size = 1024 * 1024;
    u32 block_count = 4 * 1024;
    u8 *block = malloc(block_size);
    memset(block, 1, block_size);
    for (u32 i = 0; i < block_count; i++) {
        u32 written = fwrite(block, 1, block_size, f);
        if (written != block_size) { printf("Error writing block %d\n", i); break; }
    }
    free(block);
    fclose(f);
}
```

链接参数：

```
-sWASMFS -sFORCE_FILESYSTEM -lopfs.js
-sENVIRONMENT=web,worker -sPTHREAD_POOL_SIZE=1
-sEXPORTED_RUNTIME_METHODS=FS,OPFS,getValue,setValue,UTF8ToString
```

### 2.2 与项目现状对照

| 项目 `ysm-wasm` 现状 | 业界流式范式 |
|---------------------|-------------|
| Go 端 Node.js + WASM callMain + MEMFS | WasmFS + OPFS（浏览器持久化文件系统） |
| MEMFS 把整个 .ysm 载入内存 | `fopen` + 分块 `fread`/`fwrite`，不一次性载入 |
| 解码产物 `/output` 全量收集 | 产物流式写出，分块读取 |
| 大模型可能撑爆 MEMFS | OPFS 可处理 4GB+ 文件（需 64-bit offset 修复） |

### 2.3 落地建议

**短期（不改动）**：项目当前 .ysm 解码走 Go 端 Node.js + WASM callMain + MEMFS，**对模型文件大小（通常 <50MB）够用**，MEMFS 内存压力不是当前痛点

**中期（大模型/长运行内存压力出现时）**：
1. **前端 WebView2 路径**：`decodeYsmFileFromMemory` 已是内存直解（`_malloc` + `ccall("ysm_decode_from_memory")`），无需 MEMFS，已是较优路径
2. **Go 端 Node.js 路径**：当前 `callMain(["-i","/input","-o","/output"])` + MEMFS 全量载入——若大模型撑爆内存，改用 `fopen` + 分块 `fread` 流式解码，但需 YSMParser C++ 侧支持流式 I/O
3. **网页版路径**：考虑 WasmFS + OPFS，但 OPFS 在 GitHub Pages 静态托管下不可用，仅桌面浏览器可用

**避坑点**：
- `readFile` 会把整个文件载入 Wasm 内存，大文件必失败——用 `read` 分块
- OPFS 的 32-bit offset 限制在 4GB 以上文件会出问题（issue #21335 核心）
- WasmFS + OPFS 需要 `-sWASMFS -lopfs.js` 链接参数，与项目当前 Emscripten 构建参数不同

---

## 3. Molang 表达式求值（`animation-system` 补全方向）

### 3.1 一手资料

**来源 1**：bedrock.dev《Molang Documentation》

核心定义：

> Molang is a simple expression-based language designed for fast, data-driven calculation of values at run-time, with a direct connection to in-game values and systems. Its focus is to enable low-level systems like animation to support flexible data-driven behavior.

语法结构（C 语言家族风格）：

| 关键字 | 描述 |
|--------|------|
| `1.23` | 数值常量 |
| `! && \|\| < <= >= > == !=` | 逻辑运算符 |
| `* / + -` | 基础数学运算符 |
| `(` `)` | 括号控制求值顺序 |
| `{` `}` | 大括号控制执行作用域 |
| `??` | 空合并运算符（处理缺失变量或过期 actor 引用） |
| `geometry.texture_name` | 引用实体定义中命名的几何体 |
| `math.function_name` | 各种数学函数 |
| `query.function_name` | 访问实体属性 |
| `variable.variable_name` | actor 上的读写存储 |
| `temp.variable_name` | 读写临时存储 |
| `context.variable_name` | 游戏在某些场景下提供的只读存储 |
| ` ? ` | 二元条件运算符 |
| ` ? : ` | 三元条件运算符 |

别名映射（减少打字负担）：

| 全名 | 别名 |
|------|------|
| `context.moo` | `c.moo` |
| `query.moo` | `q.moo` |
| `temp.moo` | `t.moo` |
| `variable.moo` | `v.moo` |

版本化变更（节选）：

| Pack min_engine_version | 描述 |
|------------------------|------|
| 1.17.0 | 初始支持版本化变更 |
| 1.18.10 | 修复条件（三元）运算符结合律：`A ? B : C ? D : E` 从 `(A ? B : C) ? D : E` 改为 `A ? B : (C ? D : E)` |
| 1.18.20 | 修复逻辑 AND 在逻辑 OR 之前求值，比较运算符在等式运算符之前求值 |
| 1.20.50 | `block_property` 不再支持，逻辑改在动画中处理 |

**来源 2**：`bridge-core/molang`（bridge. 团队开发，TypeScript，full Molang feature support）

性能基准（执行同一 vanilla 脚本 100,000 次）：

| 库 | Parse & Execute (uncached) | Parse & Execute (cached) |
|----|---------------------------|------------------------|
| `bridge-core/molang` | 1253.332ms | 90.036ms |
| `JannisX11/MolangJS` | 11872ms | 185.299ms |

bridge. 的优势：在执行大量不同脚本（缓存无效）时快 10x

**来源 3**：`JannisX11/MolangJS`（Blockbench & Snowstorm 使用）

```javascript
import Molang from 'molangjs';
const MolangParser = new Molang();
let result = MolangParser.parse('query.has_rider ? Math.sin(query.anim_time) : -44 * 3', {
    'query.has_rider': 1,
    'query.anim_time': '11 + 5'
});
```

特性：
- `Molang#global_variables`：全局变量对象
- `Molang#cache_enabled`：是否使用缓存（默认 true）
- `Molang#use_radians`：三角函数用弧度还是角度（默认 false）
- `Molang#variableHandler`：自定义未识别变量处理器

### 3.2 与项目现状对照

| 项目 `animation-system` 现状 | Molang 业界范式 |
|---------------------------|----------------|
| 解析基岩版 animation.json 关键帧插值 | 关键帧的 value 可以是 Molang 表达式 |
| 知识卡提到"关键帧插值求值" | 插值前需先求值 Molang 表达式 |
| 项目无 Molang 求值器 | `bridge-core/molang` / `MolangJS` 可直接引入 |

### 3.3 落地建议

**短期（不引入）**：项目当前主要处理 YSM 模型（Yuan's Sketch Model），其动画格式与基岩版 animation.json 相似但可能不含完整 Molang 表达式——**先确认 YSM 动画的 keyframe value 是否真有 Molang 表达式**，若只是数值则无需引入

**中期（需要 Molang 求值时）**：
1. **推荐 `bridge-core/molang`**：TypeScript 原生、性能最优（10x faster on uncached）、full feature support、MIT 协议
2. **备选 `JannisX11/MolangJS`**：Blockbench 同款，社区更成熟，但性能差 10x
3. **集成点**：`animation-system` 卡的"关键帧插值求值"环节，在插值前先 `MolangParser.parse(keyframe.value, variables)` 求值

**避坑点**：
- Molang 有**版本化变更**（`min_engine_version` 决定规则），求值器需支持版本感知，否则 1.18.10 前的三元结合律会算错
- `bridge-core/molang` 是 AST + interpreter 模式，AST 可缓存，适合重复求值同一表达式的场景（动画每帧求值）
- Molang 的 `query.*` 函数依赖游戏上下文（`query.anim_time` / `query.life_time` 等），在项目这种"离线预览"场景下需提供合理的 mock 值

---

## 4. Robust file watcher（`go-watcher` 升级方向）

### 4.1 一手资料

**来源 1**：Microsoft Learn《ReadDirectoryChangesW function (winbase.h)》

核心参数：

- `hDirectory`：用 `CreateFile` + `FILE_FLAG_BACKUP_SEMANTICS` 打开目录句柄
- `nBufferLength`：缓冲区大小，**对同步调用至关重要**——如果缓冲区太小，事件会丢失
- `bWatchSubtree`：是否递归监听子目录
- `dwNotifyFilter`：监听哪些变化（`FILE_NOTIFY_CHANGE_FILE_NAME` / `FILE_NOTIFY_CHANGE_DIR_NAME` / `FILE_NOTIFY_CHANGE_SIZE` / `FILE_NOTIFY_CHANGE_LAST_WRITE` 等）
- 同步 vs 异步：异步用 `OVERLAPPED` + `GetOverlappedResult`

关键坑：

> The operating system detects a change in file size only when the file is written to the disk. For operating systems that use extensive caching, detection occurs only when the cache is sufficiently flushed.

即：**文件 size 变化的检测有延迟**（依赖 OS 缓存刷新），不能假设写完立刻收到事件。

**来源 2**：fsnotify Windows 后端源码（`windowsBackend`）

核心实现范式：

1. **`subscribe` 同步 arm 第一份 `ReadDirectoryChangesW`**：确保调用方在 `subscribe` 返回后执行的文件操作一定能被观察到，避免"spawning goroutine 与 caller 的第一个 fs op 竞态，偶尔漏掉初始 create event"
2. **per-watch goroutine**：`run()` 循环调用 `ReadDirectoryChangesW`，直到 watch 停止或不可恢复错误
3. **`doneCh` 同步关闭**：`closeWatch` 发出 stop 信号后 `<-sub.doneCh` 等待 `run()` 退出，保证目录句柄在返回前已关闭——"从另一个 goroutine 关闭正在 mid-syscall 的句柄是 undefined behavior on Windows"
4. **错误分类处理**：
   - `ERROR_OPERATION_ABORTED` → 正常停止
   - `ERROR_INVALID_PARAMETER` → 缩小 buffer 重试
   - `ERROR_NOTIFY_ENUM_DIR` → **缓冲区溢出，设置 `ErrOverflow` 并通知，不停止**
   - `ERROR_ACCESS_DENIED` → 检查目录是否被删除（`GetFileAttributes`），是则移除 watch
   - 其他 → fatal

5. **`processCompletion` 遍历 `FILE_NOTIFY_INFORMATION` 链**：
   ```go
   for offset < bytes {
       fni := (*windows.FileNotifyInformation)(unsafe.Pointer(&buf[offset]))
       nameLen := int(fni.FileNameLength) / 2
       nameSlice := unsafe.Slice((*uint16)(unsafe.Pointer(&fni.FileName)), nameLen)
       name := windows.UTF16ToString(nameSlice)
       s.processOne(fni.Action, name)
       if fni.NextEntryOffset == 0 { break }
       offset += fni.NextEntryOffset
   }
   ```

### 4.2 与项目现状对照

| 项目 `go-watcher` 现状 | 业界 robust watcher 范式 |
|----------------------|------------------------|
| 监听资源目录文件系统变化 | `ReadDirectoryChangesW` + 异步 OVERLAPPED |
| 触发前端资源树刷新 | 事件分类 → debounce → 通知 |
| 知识卡未提缓冲区溢出处理 | `ERROR_NOTIFY_ENUM_DIR` 必须 fallback 全量重扫 |
| 知识卡未提句柄关闭竞态 | `doneCh` 同步等待 `run()` 退出 |

### 4.3 落地建议

**短期（核查）**：核查项目 `go-watcher` 是否：
1. 处理了 `ERROR_NOTIFY_ENUM_DIR`（缓冲区溢出）——这是 Windows watcher 最常见的漏事件原因，**必须 fallback 全量重扫**
2. 用了异步 OVERLAPPED 还是同步阻塞——同步阻塞会卡住 goroutine
3. 目录句柄关闭是否同步等待——避免 mid-syscall 关句柄的 UB

**中期（若发现问题）**：
1. 参考 fsnotify Windows 后端的错误分类处理
2. 加缓冲区溢出检测 + 全量重扫 fallback
3. 加 debounce（文件可能触发多个连续事件，如 Write + Size + LastWrite）

**避坑点**：
- Windows 上 `ReadDirectoryChangesW` 对**网络路径**支持差，可能漏事件或延迟很大
- 缓冲区大小是 trade-off：太小溢出漏事件，太大浪费内存且延迟高（等待填满）
- `FILE_NOTIFY_CHANGE_SIZE` 的检测有缓存延迟，不能依赖它做实时响应

---

## 5. Content-addressable 缓存（`go-scanner` 升级方向）

### 5.1 联想路径

`go-scanner` 卡现状：

> 30s 扫描缓存 + 路径级失效：`scanCache` 为 `sync.Map`（`string → scanCacheEntry{entries []ModelEntry, expiresAt time.Time}`），记录扫描条目与过期时刻；`keyVersions` 为另一份 `sync.Map`（`string → *atomic.Uint64`），用 `(*atomic.Uint64).Add(1)` 原子递增 per-key 版本戳，防并发 `InvalidatePath` 竞态——P1 修复；单全局 `cacheGen atomic.Uint64` 仅作全量失效的代际短路标记

这是**手写的缓存失效层**：路径作 key、30s 过期、显式 invalidate。业界更稳健的范式是**content-addressable**——以文件内容哈希作 key，天然无失效问题（内容变哈希就变）。

### 5.2 业界范式

**git object store**：每个对象以 SHA1 哈希命名，内容不变则哈希不变，天然去重与缓存友好。

**content-addressable storage (CAS)**：

- key = `sha256(content)` 或 `blake3(content)`
- value = content 本身或其元数据
- 优势：
  - **无失效问题**：内容变 → key 变 → 自动"失效"
  - **天然去重**：相同内容只存一份
  - **并发安全**：immutable key，无竞态
  - **可验证**：key 即校验和
- 劣势：
  - **哈希计算成本**：每次读需算哈希（但可缓存哈希本身）
  - **key 碰撞**：概率极低但理论存在

**项目现状对照**：

| 项目 `go-scanner` 现状 | CAS 范式 |
|----------------------|---------|
| key = 目录路径 | key = `sha256(content)` |
| 30s 过期 + 显式 invalidate | 无失效（内容变 key 变） |
| per-key 版本戳防竞态 | immutable key 无竞态 |
| 缓存的是 `ModelEntry[]` | 缓存的是 `ModelEntry` 本身（以哈希为 key） |
| `InvalidatePath` 需手动调 | 无需 invalidate |

### 5.3 落地建议

**短期（不改动）**：当前手写失效层在"扫描不频繁、并发不高"的场景下够用，且 30s 过期是合理的安全网

**中期（性能瓶颈或竞态频发时）**：
1. **双层缓存**：路径 → 哈希（快速查找）+ 哈希 → ModelEntry（内容寻址）
2. 文件变化时（watcher 通知），重算该文件的哈希，更新路径 → 哈希映射
3. ModelEntry 缓存以哈希为 key，内容不变则命中，天然无失效问题
4. 去重：相同哈希的文件只存一份 ModelEntry

**避坑点**：
- 哈希计算本身有成本，对小文件可能得不偿失
- CAS 假设"内容相同即等价"，但项目里**文件路径也是语义的一部分**（`[作者]【作品】角色.ysm` 的路径编码了作者信息），纯内容寻址会丢失路径语义
- 30s 过期是**防御性设计**（即使忘了 invalidate 也会自动过期），CAS 移除过期后需确保 watcher 通知的可靠性

---

## 6. 调研来源汇总

| # | 主题 | 来源 URL | 类型 |
|---|------|----------|------|
| 1 | rsync 技术报告 | https://rsync.samba.org/tech_report/node2.html | 技术报告 |
| 1 | rsync rolling checksum | https://rsync.samba.org/tech_report/node3.html | 技术报告 |
| 1 | `minio/rsync-go` 纯 Go 实现 | https://github.com/minio/rsync-go | 开源库 |
| 1 | `kardianos/rsync` 纯 Go 实现 | https://pkg.go.dev/github.com/kardianos/rsync | 开源库 |
| 2 | emscripten WasmFS+OPFS 4GB 限制 | https://github.com/emscripten-core/emscripten/issues/21335 | GitHub issue |
| 2 | WasmFS Async APIs | https://github.com/emscripten-core/emscripten/issues/15964 | GitHub issue |
| 3 | Molang 官方规范 | https://bedrock.dev/docs/stable/Molang | 官方文档 |
| 3 | Microsoft Molang Query Functions | https://learn.microsoft.com/en-us/minecraft/creator/reference/content/molangreference/examples/molangconcepts/queryfunctions | 官方文档 |
| 3 | `bridge-core/molang` 快速 Molang parser | https://github.com/bridge-core/molang | 开源库 |
| 3 | `JannisX11/MolangJS` Blockbench 同款 | https://github.com/JannisX11/molangjs | 开源库 |
| 4 | Microsoft ReadDirectoryChangesW | https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-readdirectorychangesw | 官方文档 |
| 5 | git object store（内化知识） | — | 业界共识 |

---

## 7. 后续开发借鉴清单（续）

6. **rsync rolling hash**：`go-sync` 当前全量 SHA256 对比在模型文件不大、数量不多的场景下够用——**不要为优化而优化**；只有两端已有相似文件、需频繁增量同步时才考虑引入 `kardianos/rsync`

7. **WASM 大文件流式 I/O**：`ysm-wasm` 的 `decodeYsmFileFromMemory` 已是内存直解（较优路径）；Go 端 Node.js + MEMFS 对 <50MB 模型够用——**只有大模型撑爆内存时才改 `fopen` + 分块 `fread` 流式解码**，且需 YSMParser C++ 侧支持

8. **Molang 表达式求值**：`animation-system` 当前未提 Molang 求值——**先确认 YSM 动画的 keyframe value 是否真有 Molang 表达式**，若需要则引入 `bridge-core/molang`（TypeScript 原生、10x faster on uncached、MIT 协议），注意版本化变更与 `query.*` 函数的 mock

9. **Robust file watcher**：核查 `go-watcher` 是否处理了 `ERROR_NOTIFY_ENUM_DIR`（Windows 缓冲区溢出）——**这是 Windows watcher 最常见的漏事件原因，必须 fallback 全量重扫**；参考 fsnotify Windows 后端的错误分类 + `doneCh` 同步关闭范式

10. **Content-addressable 缓存**：`go-scanner` 当前手写失效层（30s 过期 + per-key 版本戳）在扫描不频繁、并发不高的场景下够用——**只有竞态频发或性能瓶颈时才改双层缓存**（路径→哈希 + 哈希→ModelEntry），注意纯内容寻址会丢失路径语义

---

*本报告所有代码范式与避坑点均来自上述一手资料的直接引用或整理，后续开发可直接对照本报告 §7 第 6-10 条借鉴清单落地。与前序报告 `docs/web-research-report-2026-08-17.md` §7 第 1-5 条合并，共 10 条借鉴清单。*
