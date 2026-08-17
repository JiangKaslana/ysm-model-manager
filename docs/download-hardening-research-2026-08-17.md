# 下载层加固调研报告

- **日期**：2026-08-17（周一）
- **作者**：鲸鱼架构师 deepseek（GLM-5.2）
- **范围**：`go/download/download.go` + `go/download/download_http_test.go`
- **对标库**：`github.com/hashicorp/go-getter`（v2.1.0+）、`github.com/cavaliergopher/grab/v3`
- **动机**：项目里有 10 处 `TODO(BUG-HTTP-X)` 探察态断言点（另有 BUG-HTTP-2/5 已在报告产出前由 `FIXED(...)` 硬断言覆盖），但源码本体已实现对应修复。真实差距是"测试未跟上源码"——回归发生时 CI 不会变红。本报告先澄清现状，再给出最小化补丁。
- **落地状态（同日更新）**：P0-a（断言升级）已落地，提交 `57b1bd9f`——10 处探察态断言点全部 `t.Fatalf` 化（9 处 `t.Log→t.Fatalf` + BUG-HTTP-7c 异常分支加固），`go test ./go/download/...` 全绿 ✅。P0-b（checksum）调研完成：**降级为 P2 预留能力**（§4.2.1）。P1-a / P1-b 调研完成：**均已闭环**（§4.3.1 / §4.4.1，本项目 Go 1.25.0 ≥1.24；dedup 依赖 WalkDir 语义免疫、installer 已有 EvalSymlinks 三重守卫 + deny-list；WASM MT 已由 ADR-079 + COI Service Worker 落地）。见 §5。

---

## 1. 调研结论摘要

| 项 | 结论 |
|---|---|
| P0 安全红线（HTTP 下载） | ✅ **源码已修**。`downloadTo` 已有 `CheckRedirect`（scheme 白名单 + 10 跳上限）、`Content-Range` 拒绝、`Content-Type` 白名单、`TruncationError` 截断检测、原子写入 + `.part` 清理。 |
| 测试断言 | ✅ **已落地（提交 `57b1bd9f`）**。10 处探察态断言点全部升级为 `t.Fatalf` 硬断言，回归即红 CI。 |
| 与 go-getter/grab 范式差距 | 🟡 **可选加固**。缺失：checksum 校验（grab 内建 `req.SetChecksum`）、断点续传（grab 内建 Range 续传）。这两项不是安全红线，是可靠性增强。 |
| P1 路径安全（dedup/installer） | ✅ **实际已闭环**（调研修正 §4.3.1）：Go 1.25.0 ≥1.24；dedup 由 `WalkDir` 语义免疫 symlink 跟随 + `ErrSymlinkRoot`；installer 已有 `EvalSymlinks` 三重守卫 + 可执行文件 deny-list（`rtype=""` 也拦截）。`os.Root` 残余增量极小，无需大改。 |
| P1 WASM Pthread MT 解码（ADR-079） | ✅ **已由 ADR-079 落地**（调研修正 §4.4.1）：COI Service Worker 补 COOP/COEP 头（GitHub Pages 静态托管可用）+ `crossOriginIsolated` 检测 → 多线程 / 单线程 fallback。桌面/网页均闭环。 |

---

## 2. 业界成熟方案对照

### 2.1 `hashicorp/go-getter` — 安全下载范式标杆

**关键安全选项**（go-getter README "Security Options" 段）：

```go
var httpGetter = &getter.HttpGetter{
    XTerraformGetDisabled: true,   // 禁用 X-Terraform-Get 头（默认开启，允许任意重定向）
    XTerraformGetLimit:    10,     // 若必须开，限制重定向跳数
    // HeadFirstTimeout / ReadTimeout 等可调
}
```

- **`DisableSymlinks`**：防止写入通过或复制自指向目录外的 symlink。
- **`X-Terraform-Get` 禁用**：该头允许任意重定向，默认开启是 CVE-2022-26945 的根因。
- **强制协议前缀**（`git::`/`http::`）：消除协议歧义，默认拒绝 `file://`/`ftp://`。
- **checksum 查询参数**：`?checksum=sha256:...` 自动校验，支持 md5/sha1/sha256/sha512/file。

**CVE 警示**：

- **CVE-2022-26945**：go-getter ≤1.5.11 / ≤2.0.2 允许协议切换、无限重定向、配置绕过。**修复在 1.6.1 / 2.1.0**。若引入 go-getter，必须 ≥2.1.0。
- **CVE-2022-30321**（ghsa-fcgg-rvwg-jv58）：go-getter through 2.0.2 不安全下载，同因。

**与项目现状对照**：

| go-getter 防护 | 项目 `download.go` 现状 |
|---|---|
| 重定向 scheme 白名单 | ✅ 已实现（第 149–157 行 `CheckRedirect`） |
| 重定向跳数上限 | ✅ 已实现（`len(via) >= 10`） |
| `X-Terraform-Get` 禁用 | ⚪ 项目用标准 `net/http`，默认不处理该头，无需显式禁用 |
| `DisableSymlinks` | ⚪ 项目下载路径由调用方控制，暂无 symlink 写入风险 |
| checksum 校验 | 🟡 更新包场景已闭环（`go/updater`：SHA256SUMS 解析 + 下载中 SHA256 流式校验 + `ErrHashMismatch`）；模型文件场景无现成数据源（§4.2.1），预留 API 能力 |
| 断点续传 | ❌ 项目每次重下，无 Range 续传 |

### 2.2 `cavaliergopher/grab/v3` — 大文件下载库

**rad 特性**（grab README）：

- 自动恢复未完成下载（HTTP Range 续传）
- 并发监控下载进度
- 从 `Content-Disposition` 头或 URL 路径猜测文件名
- 用 `context.Context` 安全取消下载
- **校验和验证下载**（`req.SetChecksum(hash, expected, true)`）
- 批量并发下载
- 速率限制器

**aptly 的 grab 用法范式**（`aptly-dev/aptly/http/grab.go`）：

```go
func (d *GrabDownloader) maybeSetupChecksum(req *grab.Request, expected *utils.ChecksumInfo) error {
    if expected == nil { return nil }
    if expected.MD5 != "" {
        expectedHash, _ := hex.DecodeString(expected.MD5)
        req.SetChecksum(md5.New(), expectedHash, true)
    } else if expected.SHA1 != "" { /* ... */ }
    else if expected.SHA256 != "" { /* ... */ }
    else if expected.SHA512 != "" { /* ... */ }
    req.Size = expected.Size
    return nil
}
```

aptly 还做了**重试退避**（`maxTries` + `delay` + `delayMultiplier`），区分可重试错误与不可重试错误。

**grab 已知问题**（issue #21）：

> 在已损坏的本地文件上续传时，grab 下载看似成功但内容损坏。206 Partial Content 被当作成功，文件字节数与原始相同但内容 corrupted。

这与项目 `BUG-HTTP-1`（206 Partial Content 静默装盘）是**同一类问题**。项目已用 `Content-Range` 头检测解决，grab 则建议用 checksum feature 兜底。

### 2.3 P1 路径安全 — Go 1.24 `os.Root`

**业界共识**（Go 官方博客 2025-03-12 + argemma.com 2026-01-29 文章 + gosec G304）：

- `filepath.Clean` **不是安全控制**。`filepath.Join(root, filepath.Clean(p))` 仍可被 `../../bar` 逃逸。
- Go 1.24 引入 `os.Root` 类型，自动拒绝逃逸 root 的相对路径组件和 symlink：

```go
root, _ := os.OpenRoot(scanRoot)
root.WalkDir(...)   // 自动拒绝逃逸的 symlink
root.Open("a/../b") // 允许（不逃逸 root）
```

- `github.com/google/safeopen` 是 Go 1.24 前的替代方案。

**与项目现状对照**：

| 项目 BUG | 业界做法 / **项目实际现状（调研修正）** |
|---|---|
| `dedup/BUG-1`：symlink 子目录被跟随 | 业界 `os.OpenRoot(scanRoot)` + `Root.WalkDir`；**项目实际已免疫**：`filepath.WalkDir` 不跟随 symlink（Go 语义）+ 显式跳过 symlink 条目 + `ErrSymlinkRoot` 拒根（§4.3.1） |
| `dedup/BUG-3`：NUL 字节路径截断 | 输入校验层拒绝 `\x00`；项目 `download.ResolveSavePath` 已剔除 NUL（附录 C） |
| `installer/BUG-1/2`：任意路径读取 | 业界 `os.OpenRoot(filesRoot)` + `Root.Open`；**项目实际已修复**：`EvalSymlinks` 三重守卫（src / customDir / 条目级，§4.3.1） |
| `installer/BUG-3`：`rtype=""` 复制 `.exe/.bat/.dll` | 业界文件类型白名单；**项目实际已修复**：`installer.go` deny-list（.exe/.bat/.dll/.cmd/.scr/.pif/.com/.msi/.ps1/.vbs）即使 `rtype=""` 也拒绝（§4.3.1） |

### 2.4 P1 WASM Pthread MT 解码 — COOP/COEP 硬约束

**业界硬约束**（emscripten 官方文档 + web.dev）：

- SharedArrayBuffer 在浏览器里**需要 COOP/COEP 头**才能启用，无此头 Pthreads 直接不工作。
- 必须：
  ```
  Cross-Origin-Embedder-Policy: require-corp
  Cross-Origin-Opener-Policy: same-origin
  ```
- 验证方式：前端 `self.crossOriginIsolated === true`。
- **GitHub Pages 这类静态托管无法设 COOP/COEP**，所以 Pthreads 在网页版根本跑不起来——只能桌面端。

**Wails v3 特定坑**：

- Wails v3 的 AssetServer 默认不发 COOP/COEP 头。
- 需要在 Go 端的 AssetHandler 中间件注入这两个头，否则即使 emscripten 编译了 `-pthread`，WebView2 也不会给 SharedArrayBuffer。
- 参考实现：`prismarine-viewer` 的 worker 桥范式，但**只抄算法口径**（知识卡 `mc-ao-tint` 已立此规矩）。

**推荐路径——⚠️ 已由项目落地（ADR-079，调研修正见 §4.4.1）**：

1. ✅ **COI Service Worker**（`frontend/src/backend/coi-sw.ts` + `public/sw.js`）：拦截同源响应补 COOP/COEP 头——**GitHub Pages 静态托管也能跑 MT**（报告初判"静态托管无法设头"不成立）。
2. ✅ **降级 fallback**（`frontend/src/workers/stats.worker.ts`）：`crossOriginIsolated` 检测 → 多线程 WASM / 单线程 fallback。
3. ✅ **检测**：worker 内读 `crossOriginIsolated`，false 走单线程（测试 `coi-sw.test.ts` 覆盖）。

---

## 3. P0 真实差距：测试断言未跟上源码（已落地）

### 3.1 源码已实现的修复（`download.go`）

| 行号 | 修复 | 对应 BUG |
|---|---|---|
| 149–157 | `CheckRedirect`：scheme 白名单 + 10 跳上限 | BUG-HTTP-3/4a/4b |
| 182–184 | `Content-Range` 头存在即拒绝 | BUG-HTTP-2 |
| 187–189 | `Content-Type` 白名单（拒绝 HTML/XML） | BUG-HTTP-5 |
| 252–260 | `TruncationError`：`downloaded < total` 或 `> total` 即拒绝 | BUG-HTTP-6a |
| 199–211 | defer 清理半截临时文件 | BUG-HTTP-7a/b |
| 264–274 | Sync → Close → Rename 原子写入 | BUG-HTTP-7c |

### 3.2 测试文件的"探察态"断言（`download_http_test.go`）

落地前：10 处 `t.Log("TODO(BUG-HTTP-X)...")` 断言点不让 CI 变红，回归静默通过。下表行号为当日快照；同一文件后续又追加了 `#11 错误分类` 专项测试，行号已前移，以当前文件为准。**该 10 处已全部升级为 `t.Fatalf`（提交 `57b1bd9f`）**，下表为落地前的探察态清单：

| 行号 | 测试函数 | 现状断言 | 应升级为 |
|---|---|---|---|
| 69 | `TestHTTP_206PartialContent_Rejected` | `t.Logf("TODO(BUG-HTTP-1)...")` | `t.Fatalf("206 应被拒绝，实际成功写入 %d 字节", info.Size())` |
| 127 | `TestHTTP_Redirect_ChainExceedsLimit` | `t.Log("TODO(BUG-HTTP-3)...")` | `t.Fatalf("12 跳重定向链未被拦截，存在 SSRF 风险")` |
| 145 | `TestHTTP_Redirect_ToFileScheme_Rejected` | `t.Log("TODO(BUG-HTTP-4a)...")` | `t.Fatalf("重定向到 file:// 未被拒绝，存在 SSRF/本地文件读取风险")` |
| 163 | `TestHTTP_Redirect_ToFtpScheme_Rejected` | `t.Log("TODO(BUG-HTTP-4b)...")` | `t.Fatalf("重定向到 ftp:// 未被拒绝，存在 SSRF 风险")` |
| 210 | `TestHTTP_ContentLength_TruncationDetected` | `t.Log("TODO(BUG-HTTP-6a)...")` | `t.Fatalf("Content-Length 截断未被检测到，不完整文件被当作完整文件装盘")` |
| 286 | `TestHTTP_ProgressPanic_DuringLoop_TempFileCleaned` | `t.Log("TODO(BUG-HTTP-7a)...")` | `t.Fatalf("onProgress 循环内 panic 后 savePath 文件仍存在 — defer 清理逻辑失效")` |
| 295 | 同上 | `t.Log("TODO(BUG-HTTP-7b)...")` | `t.Fatalf("循环内 panic 后 .part 临时文件残留: %s", e.Name())` |
| 337 | `TestHTTP_ProgressPanic_FinalCallback_FileSurvives` | `t.Logf("TODO(BUG-HTTP-7c)...")` | 见下方说明 |
| 445 | `TestHTTP_ConcurrentSamePath_MutexSafety` | `t.Log("TODO(BUG-HTTP-8)...")` | `t.Fatalf("并发下载后 .part 临时文件残留: %s", e.Name())` |

**✅ 落地**：上表所列断言点已于 2026-08-17 全部升级（提交 `57b1bd9f`），探察态清零。另注：BUG-HTTP-2（200+Content-Range）与 BUG-HTTP-5（Content-Type）已在报告产出前由 `FIXED(...)` 硬断言覆盖，不在探察态清单内。

**BUG-HTTP-7c 特殊处理**：

测试注释说"这是预期行为 — rename 已完成，panic 在 success path 中"。所以 7c 不是 bug，是**预期行为的文档化测试**。断言应改为：

```go
if info, err := os.Stat(savePath); err == nil {
    data, _ := os.ReadFile(savePath)
    if string(data) != "hello" {
        t.Fatalf("最终回调 panic 后 savePath 内容异常: got %q, want %q", string(data), "hello")
    }
    // 预期行为：rename 已完成，文件存活。若需防御，应在 rename 后 wrap onProgress 调用。
}
```

### 3.3 实测验证

我跑了 5 个 `TODO(BUG-HTTP-X)` 测试，**全部实际走 `OK` 分支**（源码已修，测试通过）：

```
=== RUN   TestHTTP_206PartialContent_Rejected
    download_http_test.go:74: OK: 206 被正确拒绝: HTTP 206
--- PASS: TestHTTP_206PartialContent_Rejected (0.00s)
=== RUN   TestHTTP_Redirect_ChainExceedsLimit
    download_http_test.go:129: OK: 重定向链被拦截: 请求失败 ... 重定向次数过多
--- PASS: TestHTTP_Redirect_ChainExceedsLimit (0.01s)
=== RUN   TestHTTP_Redirect_ToFileScheme_Rejected
    download_http_test.go:147: OK: file:// 重定向被拒绝: ... 禁止重定向到非 http(s): file:///etc/passwd
--- PASS: TestHTTP_Redirect_ToFileScheme_Rejected (0.00s)
=== RUN   TestHTTP_Redirect_ToFtpScheme_Rejected
    download_http_test.go:165: OK: ftp:// 重定向被拒绝: ... 禁止重定向到非 http(s): ftp://...
--- PASS: TestHTTP_Redirect_ToFtpScheme_Rejected (0.00s)
=== RUN   TestHTTP_ContentLength_TruncationDetected
    download_http_test.go:212: OK: 截断被检测到: 读取响应体失败 ... unexpected EOF
--- PASS: TestHTTP_ContentLength_TruncationDetected (0.00s)
```

**结论**：源码本体已实现全部 P0 修复，但测试断言停留在 `t.Log("TODO(BUG-HTTP-X)...")` 探察态。真实差距是"测试未跟上源码"，非"源码待修"。**该差距已于当日修复（提交 `57b1bd9f`）：10 处断言点升级为 `t.Fatalf`，回归红 CI。**

---

## 4. 建议的 diff 补丁

### 4.1 P0 测试断言升级（最小化补丁，安全收益最大）—— ✅ 已执行，提交 `57b1bd9f`

**文件**：`go/download/download_http_test.go`

**改动原则**：仅升级断言强度（`t.Log` → `t.Fatalf`），不改动测试逻辑、不新增测试。改动局限于一个文件，风险可控。

```diff
@@ TestHTTP_206PartialContent_Rejected @@
 	err := dl.File(context.Background(), ts.URL, savePath, nil)
 	if err == nil {
 		if info, err2 := os.Stat(savePath); err2 == nil {
-			t.Logf("TODO(BUG-HTTP-1): 206 Partial Content 被当作成功，文件已写入 (%d bytes)，可能是不完整分片数据被当作完整文件装盘", info.Size())
+			t.Fatalf("BUG-HTTP-1: 206 Partial Content 被当作成功，文件已写入 (%d bytes)，不完整分片数据被当作完整文件装盘", info.Size())
 		} else {
-			t.Log("TODO(BUG-HTTP-1b): 206 返回 nil 但无文件写入，行为异常")
+			t.Fatalf("BUG-HTTP-1b: 206 返回 nil 但无文件写入，行为异常")
 		}
 	} else {
 		t.Logf("OK: 206 被正确拒绝: %v", err)
 	}

@@ TestHTTP_Redirect_ChainExceedsLimit @@
 	dl := New()
 	err := dl.File(context.Background(), servers[0].URL, filepath.Join(t.TempDir(), "chain.txt"), nil)
 	if err == nil {
-		t.Log("TODO(BUG-HTTP-3): 12 跳重定向链未被拦截，可能存在 SSRF 风险")
+		t.Fatalf("BUG-HTTP-3: 12 跳重定向链未被拦截，存在 SSRF 风险")
 	} else {
 		t.Logf("OK: 重定向链被拦截: %v", err)
 	}

@@ TestHTTP_Redirect_ToFileScheme_Rejected @@
 	err := dl.File(context.Background(), ts.URL, filepath.Join(t.TempDir(), "file.txt"), nil)
 	if err == nil {
-		t.Log("TODO(BUG-HTTP-4a): 重定向到 file:// 未被拒绝，存在 SSRF/本地文件读取风险")
+		t.Fatalf("BUG-HTTP-4a: 重定向到 file:// 未被拒绝，存在 SSRF/本地文件读取风险")
 	} else {

@@ TestHTTP_Redirect_ToFtpScheme_Rejected @@
 	err := dl.File(context.Background(), ts.URL, filepath.Join(t.TempDir(), "ftp.txt"), nil)
 	if err == nil {
-		t.Log("TODO(BUG-HTTP-4b): 重定向到 ftp:// 未被拒绝，存在 SSRF 风险")
+		t.Fatalf("BUG-HTTP-4b: 重定向到 ftp:// 未被拒绝，存在 SSRF 风险")
 	} else {

@@ TestHTTP_ContentLength_TruncationDetected @@
 	err := dl.File(context.Background(), url, filepath.Join(t.TempDir(), "truncated.txt"), nil)
 	if err == nil {
-		t.Log("TODO(BUG-HTTP-6a): Content-Length 截断未被检测到 — 服务端声明 1000 字节但只发送 7 字节，不完整文件被当作完整文件装盘")
+		t.Fatalf("BUG-HTTP-6a: Content-Length 截断未被检测到 — 服务端声明 1000 字节但只发送 7 字节，不完整文件被当作完整文件装盘")
 	} else {

@@ TestHTTP_ProgressPanic_DuringLoop_TempFileCleaned @@
 	// 验证 savePath 未被写入
 	if _, err := os.Stat(savePath); !os.IsNotExist(err) {
-		t.Log("TODO(BUG-HTTP-7a): onProgress 循环内 panic 后 savePath 文件仍存在 — defer 清理逻辑失效")
+		t.Fatalf("BUG-HTTP-7a: onProgress 循环内 panic 后 savePath 文件仍存在 — defer 清理逻辑失效")
 	} else {
 		t.Log("OK: 循环内 panic 后 savePath 未被写入")
 	}

 	// 验证 .part 临时文件已清理
 	entries, _ := os.ReadDir(saveDir)
 	for _, e := range entries {
 		if strings.HasSuffix(e.Name(), ".part") {
-			t.Log("TODO(BUG-HTTP-7b): 循环内 panic 后 .part 临时文件残留: " + e.Name())
+			t.Fatalf("BUG-HTTP-7b: 循环内 panic 后 .part 临时文件残留: %s", e.Name())
 		}
 	}

@@ TestHTTP_ProgressPanic_FinalCallback_FileSurvives @@
 	// 由于 panic 发生在最终回调（ok=true 后），savePath 应已存在
 	if info, err := os.Stat(savePath); err == nil {
 		data, _ := os.ReadFile(savePath)
-		if string(data) == "hello" {
-			t.Logf("TODO(BUG-HTTP-7c): 最终 onProgress 回调 panic 后 savePath 仍存在（%d 字节，内容正确）。这是预期行为 — rename 已完成，panic 在 success path 中。若需防御，应在 rename 后 wrap onProgress 调用。", info.Size())
-		} else {
-			t.Logf("注意: savePath 存在但内容异常: %q", string(data))
+		if string(data) != "hello" {
+			t.Fatalf("BUG-HTTP-7c: 最终回调 panic 后 savePath 内容异常: got %q, want %q", string(data), "hello")
 		}
+		// 预期行为：rename 已完成，文件存活。若需防御，应在 rename 后 wrap onProgress 调用。
 	}

@@ TestHTTP_ConcurrentSamePath_MutexSafety @@
 	entries, _ := os.ReadDir(saveDir)
 	for _, e := range entries {
 		if strings.HasSuffix(e.Name(), ".part") {
-			t.Log("TODO(BUG-HTTP-8): 并发下载后 .part 临时文件残留: " + e.Name())
+			t.Fatalf("BUG-HTTP-8: 并发下载后 .part 临时文件残留: %s", e.Name())
 		}
 	}
```

**改动影响面（实际落地）**：

- 文件数：1（`go/download/download_http_test.go`）
- 改动行数：11 行增删（9 处 `t.Log→t.Fatalf` + BUG-HTTP-7c 异常分支加固）
- 风险：极低。仅升级失败时的报告强度，不改动测试逻辑。
- 验证：`go test ./go/download/...` 全绿 ✅（提交 `57b1bd9f`）。

### 4.2 P0 可选加固：checksum 校验（照 aptly 范式）—— ⚠️ 调研结论修正，降级为 P2 预留，见 §4.2.1

**文件**：`go/download/download.go`（新增）、调用方（按需）

**改动原则**：参照 aptly 的 `maybeSetupChecksum` 范式，给 `downloadTo` 加可选的 `expectedSHA256 []byte` 参数。由调用方传入期望值，不传则跳过校验（保持现有行为零漂移）。

```diff
@@ download.go @@
+// ChecksumOption 可选的下载校验参数（照 aptly maybeSetupChecksum 范式）。
+// 不传则跳过校验，保持现有行为零漂移。
+type ChecksumOption struct {
+	// ExpectedSHA256 期望的 SHA256 哈希值（十六进制字符串）。
+	// 空串则跳过校验。
+	ExpectedSHA256 string
+}
+
 // downloadTo 下载到 savePath，支持 Accept 头与进度回调；失败/中断时清理半截临时文件。
 // 错误分类用 sentinel（ErrTruncated 等）+ 类型化（HTTPStatusError / TruncationError），
 // 调用方用 errors.Is / errors.As 判断类别，不要靠英文子串 contains 匹配（#11 反模式）。
-func (d *Downloader) downloadTo(ctx context.Context, url, savePath, accept string, onProgress ProgressFn) error {
+func (d *Downloader) downloadTo(ctx context.Context, url, savePath, accept string, onProgress ProgressFn, checksum *ChecksumOption) error {
 	// ... 现有逻辑 ...
+
+	// 可选 checksum 校验（照 aptly maybeSetupChecksum 范式）
+	if checksum != nil && checksum.ExpectedSHA256 != "" {
+		if _, err := tmp.Seek(0, io.SeekStart); err != nil {
+			return fmt.Errorf("定位临时文件失败: %w", err)
+		}
+		h := sha256.New()
+		if _, err := io.Copy(h, tmp); err != nil {
+			return fmt.Errorf("计算 SHA256 失败: %w", err)
+		}
+		actual := hex.EncodeToString(h.Sum(nil))
+		if !strings.EqualFold(actual, checksum.ExpectedSHA256) {
+			return fmt.Errorf("%w: 期望 %s, 实际 %s", ErrChecksumMismatch, checksum.ExpectedSHA256, actual)
+		}
+	}
 	// ... Sync → Close → Rename 原子写入 ...
 }
```

**新增 sentinel 错误**：

```go
// ErrChecksumMismatch 下载内容 SHA256 与期望值不符。
ErrChecksumMismatch = errors.New("校验和不匹配")
```

**调用方改动**：GitHub Release 资产有公布的 SHA256，可在 `ResolveSavePath` 旁加一个 `expectedSHA256` 参数透传。这一步**不是安全红线**，是可靠性增强，优先级低于 4.1。

### 4.2.1 P0-b 调研结论（2026-08-17 实测）——降级为 P2 预留能力

**① 纠正调研盲区：更新包场景 checksum 已闭环。**
`go/updater` 已有完整 SHA256SUMS 链路（`Check` 从 Release 资产定位 SHA256SUMS → `fetchExpectedHash` 解析 → `downloadOnce` 用 `io.TeeReader` 边下边算 SHA256 → 不匹配删文件并返回 `ErrHashMismatch`）。§2.1/§4.2 的"项目无 checksum 验证"**只对 `go/download` 成立**——报告产出时未考察 `go/updater`，属调研盲区，特此纠正。

**② 模型文件三源 checksum 数据源实测**（真实 HTTP 探测）：

| 源 | hash 字段 | 算法 | 结论 |
|---|---|---|---|
| `raw.githubusercontent.com` | 无 | — | ❌ 无数据源 |
| jsDelivr data API（`/v1/packages/gh/{repo}@{ref}`） | `hash` | base64 SHA-256（实测 44 字符） | 🟡 仅全文件树，无文件级 API |
| jsDelivr 文件级 API（`/v1/package/gh/{repo}@{ref}/{path}`） | — | — | ❌ 实测 400 Bad Request |
| GitHub Contents API | `sha` | git blob SHA-1（实测 40 hex） | ❌ 非内容 SHA256 |
| GitHub Release Assets | `digest` | sha256 | ⚪ 模型文件不走 Release 资产 |

**③ 降级理由**：唯一可能的数据源（jsDelivr data API）无文件级查询，取单文件 hash 须拉全文件树（大仓库数百 KB+，每模型一次往返），且该 hash 只约束 jsd 镜像源、约束不了 primary raw 源。相对收益低 → **从 P0-b 降级为 P2 预留**：`downloadTo` 预留可选 `expectedSHA256` 参数 + `ErrChecksumMismatch` sentinel（nil 则行为零漂移），不接调用方。

**④ 取代方案（若未来需要模型下载完整性）**：自营仓库/整合包清单配套 SHA256SUMS 文件，照 `go/updater` 的 `fetchExpectedHash` 范式接入——不依赖 jsDelivr API，数据源可控。现有威胁面（截断检测 + Content-Type 白名单 + 三源回退）已覆盖主流风险，该项不急。

### 4.3 P1 路径安全：引入 `os.Root`（需先确认 Go 版本）—— ⚠️ 调研修正：已闭环，无需大改，见 §4.3.1

**前置检查**：项目 `go.mod` 的 `go` 指令 = **1.25.0（≥1.24 满足）**。但进一步调研发现：dedup / installer 的对应 BUG 已由既有防线覆盖（§4.3.1），`os.Root` 迁移的残余增量极小。

**改动原则**：去重和安装器都改用 `os.OpenRoot(scanRoot)` + `Root.WalkDir` / `Root.Open`。这一步**同时修 `dedup/BUG-1` 和 `installer/BUG-1/BUG-2`**（任意路径读取）。

**去重改动草图**：

```diff
@@ go/dedup/dedup.go @@
 func FindDuplicateFiles(scanRoot string) ([]DuplicateGroup, error) {
+	// Go 1.24 os.Root 范式：自动拒绝逃逸 root 的 symlink 和 ".." 组件
+	root, err := os.OpenRoot(scanRoot)
+	if err != nil {
+		return nil, fmt.Errorf("打开扫描根失败: %w", err)
+	}
+	defer root.Close()
+
 	// ... 现有 WalkDir 逻辑改为 root.WalkDir ...
 }
```

**安装器改动草图**：

```diff
@@ go/installer/installer.go @@
 func InstallToGlobal(mcRoot, src string) (string, error) {
+	// os.Root 限制：src 必须在 filesRoot 内，否则 Open 拒绝
+	filesRoot := /* 从 AppConfig 取 */
+	root, err := os.OpenRoot(filesRoot)
+	if err != nil {
+		return "", fmt.Errorf("打开 filesRoot 失败: %w", err)
+	}
+	defer root.Close()
+
+	// 用 root.Open(src) 替代 os.Open(src)，自动拒绝逃逸 symlink
 	// ... 现有逻辑 ...
 }
```

**`installer/BUG-3`（`rtype=""` 复制 `.exe/.bat/.dll`）**：

需要 `resource_types.json` 加 `allowed_extensions` 字段，安装器按 rtype 查表，拒绝表外扩展名。这一步涉及数据模型改动，需单独立 ADR。⚠️ 调研修正：无需 data 模型改动——`installer.go` 已用 deny-list 硬编码拦截可执行扩展名（§4.3.1），`resource_types.json` 白名单属可选加固。

### 4.3.1 P1-a 调研结论（2026-08-17）——已闭环，`os.Root` 无需大改

| 报告 BUG | 项目实际现状（源码核验） | 结论 |
|---|---|---|
| `dedup/BUG-1`：symlink 子目录被跟随 | `go/dedup/dedup.go` 用 `filepath.WalkDir`——**Go 语义不跟随 symlink**（仅 root 自身例外）；且第 54–59 行显式跳过 `ModeSymlink` 条目 + 根为 symlink 时返回 `ErrSymlinkRoot` | ✅ 已免疫，无需 `os.Root` |
| `installer/BUG-1/2`：任意路径读取 | `go/installer/installer.go` 已有 `EvalSymlinks` 三重守卫：customDir 侧（68–71）、src 侧（82–88）、finalDst 逐段 Lstat（242–251）、条目级 symlink 逃逸拦截（327–333） | ✅ 已修复 |
| `installer/BUG-3`：`rtype=""` 复制可执行文件 | `installer.go` 285–288：deny-list `.exe/.bat/.dll/.cmd/.scr/.pif/.com/.msi/.ps1/.vbs`，**即使 `rtype=""` 也拒绝**；`installer_extra2_test.go:966` 有硬断言 | ✅ 已修复（比"白名单"方案更轻） |

**残余增量评估**：`os.Root` 相对现状的唯一增量是"路径解析 + 打开"合并（抗 TOCTOU），而 dedup 为只读分析、installer 输入路径受调用方约束——残余风险可接受。**结论：P1-a 不做 `os.Root` 迁移，不立 ADR**；若未来引入第三方文件解析或 scanner 高危场景再评估（Go 1.25.0 已满足前置）。

### 4.4 P1 WASM Pthread MT 解码：COOP/COEP 头注入—— ⚠️ 调研修正：已由 ADR-079 落地，见 §4.4.1

**前置检查**：Wails v3 AssetServer 是否支持自定义响应头中间件。若不支持，需 fork Wails 或在 WebView2 层注入。（⚠️ 已不需要——项目用 COI Service Worker 方案，无 AssetServer 依赖，见 §4.4.1）

**桌面端改动草图（历史参考，未采用）**：

```diff
@@ go/app/asset_handler.go（假设存在）@@
 func (h *AssetHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
+	// 启用 SharedArrayBuffer 所需的 COOP/COEP 头（emscripten Pthreads 前提）
+	w.Header().Set("Cross-Origin-Opener-Policy", "same-origin")
+	w.Header().Set("Cross-Origin-Embedder-Policy", "require-corp")
 	// ... 现有逻辑 ...
 }
```

**网页版改动草图（历史参考，未采用）**：

```diff
@@ frontend/src/platform.ts @@
+// 检测 SharedArrayBuffer 是否可用（COOP/COEP 头是否生效）
+export function isSharedArrayBufferAvailable(): boolean {
+    return typeof SharedArrayBuffer !== 'undefined';
+}
+
+// 检测 crossOriginIsolated 状态
+export function isCrossOriginIsolated(): boolean {
+    return (self as any).crossOriginIsolated === true;
+}
```

**降级逻辑**：

```diff
@@ frontend/src/3d/ysm-parser-wasm.ts（假设存在）@@
 async function loadParser() {
+    if (!isCrossOriginIsolated()) {
+        // 网页版（GitHub Pages 等）无法设 COOP/COEP，降级单线程
+        return await loadSingleThreadedParser();
+    }
     return await loadMultiThreadedParser();
 }
```

**验证**（⚠️ 实际落地为 ADR-079 方案，见 §4.4.1）：

1. 桌面端启动后在 DevTools 控制台执行 `self.crossOriginIsolated`，应返回 `true`。
2. 网页版（`npm run dev:web`）执行同样命令——COI SW 补头后应返回 `true`（多线程）；SW 未注册路径返回 `false` 触发单线程 fallback。

### 4.4.1 P1-b 调研结论（2026-08-17）——已由 ADR-079 落地

项目实际实现（`frontend/`）已完整覆盖报告 §2.4/§4.4 建议的三步，且**网页版方案优于报告初判**：

| 报告建议 | 项目实际（源码核验） |
|---|---|
| 桌面端 AssetServer 注入 COOP/COEP | 未采用 AssetServer 方案；**COI Service Worker**（`frontend/src/backend/coi-sw.ts` + `public/sw.js`）截获同源响应补头（ADR-079 M1） |
| 网页版降级单线程 fallback | **已实现**：`frontend/src/workers/stats.worker.ts:98–101`（ADR-079 M4）读 `crossOriginIsolated` → pthread 多线程 / 单线程 fallback |
| 启动时检测 `crossOriginIsolated` | **已实现**：worker 内布尔检测 + `coi-sw.test.ts` 覆盖 true/false 两态 |

**报告初判纠偏**："GitHub Pages 静态托管无法设 COOP/COEP → 网页版跑不了 MT"不成立——Service Worker 可在静态托管下补同源响应头，`crossOriginIsolated=true` 解锁 SharedArrayBuffer。**结论：P1-b 已闭环，无需任何改动。**

---

## 5. 优先级与实施顺序

| 优先 | 项 | 动作 | 风险 | 验证 |
|---|---|---|---|---|
| 🔴 P0-a | 测试断言升级 | ✅ **已落地（提交 `57b1bd9f`）**：10 处断言点 `t.Fatalf` 化 | — | `go test ./go/download/...` 全绿 ✅ |
| 🟡 P0-b | checksum 校验 | 🔽 **调研降级为 P2 预留**：实测无现成数据源（§4.2.1），仅预留 `expectedSHA256` API | 低 | — |
| 🟡 P1-a | 路径安全 `os.Root` | ✅ **已闭环，不做迁移**（§4.3.1）：Go 1.25.0 满足前置，但 dedup 已免疫、installer 已有 EvalSymlinks 三重守卫 + deny-list | — | `go test ./go/dedup/... ./go/installer/...` 全绿 |
| 🟡 P1-b | WASM MT COOP/COEP | ✅ **已由 ADR-079 落地**（§4.4.1）：COI Service Worker 补头 + `crossOriginIsolated` 检测 + 单线程 fallback | — | `coi-sw.test.ts` 覆盖 |

**P0-a 已落地**：一个文件、11 行增删，回归红 CI 缺口已关闭。下一步按上表顺序评估 P0-b（checksum）。

---

## 6. 参考来源

| 来源 | 用途 |
|---|---|
| [hashicorp/go-getter README](https://github.com/hashicorp/go-getter/blob/main/README.md) | 安全选项范式（`DisableSymlinks` / `X-Terraform-Get` 禁用） |
| [CVE-2022-26945 NVD](https://nvd.nist.gov/vuln/detail/cve-2022-26945) | go-getter 协议切换/无限重定向 CVE 警示 |
| [cavaliergopher/grab v3](https://pkg.go.dev/github.com/cavaliergopher/grab/v3) | 大文件下载库范式（自动恢复/checksum/速率限制） |
| [grab issue #21](https://github.com/cavaliergopher/grab/issues/21) | 206 Partial Content 静默装盘同类问题 |
| [aptly-dev/aptly http/grab.go](https://github.com/aptly-dev/aptly/blob/v1.6.3/http/grab.go) | grab 的生产用法范式（`maybeSetupChecksum` + 重试退避） |
| [Go 官方博客：Traversal-resistant file APIs](https://go.dev/blog/osroot) | Go 1.24 `os.Root` 范式 |
| [argemma.com：Go's filepath.Clean does not prevent path traversal](https://argemma.com/blog/go-filepath-clean/) | `filepath.Clean` 不是安全控制的警示 |
| [securego G304](https://securego.io/docs/rules/g304.html) | gosec G304 规则（文件路径 taint input） |
| [emscripten Pthreads 文档](https://emscripten.org/docs/porting/pthreads.html) | SharedArrayBuffer 需 COOP/COEP 头 |
| [web.dev：Making your website "cross-origin isolated"](https://web.dev/articles/coop-coep) | COOP/COEP 头设置范式 |

---

## 附录 A：本次调研触及但未深入的点

| 点 | 说明 |
|---|---|
| grab 的自动恢复（HTTP Range 续传） | 项目目前每次重下，无 Range 续传。可靠性增强，非安全红线。优先级低于 P0-b checksum。 |
| go-getter 的 `SubdirGlob` / `copyDir` 范式 | 项目安装器有自己的 overlay 逻辑，照抄 go-getter 的 `copyDir` 收益不大。 |
| emscripten `Atomics.wait` 检测 + fallback | 网页版降级单线程的具体实现细节，需读 emscripten 源码或 `prismarine-viewer` 范式。 |
| Wails v3 AssetServer 自定义头中间件 | 需读 Wails v3 源码确认是否支持，或是否需要 fork。 |
| `resource_types.json` 加 `allowed_extensions` 字段 | 涉及数据模型改动，需单独立 ADR。 |

## 附录 B：未触及的项目点

本次调研聚焦下载层、路径安全、WASM MT 三处。项目里还有以下"自造轮子"点未深入：

| 点 | 说明 |
|---|---|
| YSMParser WASM 解码本体 | ADR-029/079，涉及 emscripten 编译参数、Pthreads 配置。需读 `go/ysmparser/` 和前端 WASM 加载层。 |
| 知识卡漂移检测 | ADR-019。属于跨项目搬运（去 `MikuMikuAR\docs\` 抄），不联网搜。 |
| MC AO + biome tint | 知识卡 `mc-ao-tint`。属于定向抄上游（`PrismarineJS/prismarine-viewer`），不联网搜。 |

---

## 附录 C：P0-a 落地快照（2026-08-17 同日）

- **提交**：`57b1bd9f` `fix(test): download HTTP 探察态断言升级为硬断言`，仅 1 文件（`go/download/download_http_test.go`，+11/-11）。
- **升级清单**：10 处断言点（BUG-HTTP-1/1b/3/4a/4b/6a/7a/7b/7c/8）：9 处 `t.Log→t.Fatalf`；BUG-HTTP-7c 按 §3.2 特殊处理（OK 分支文档化，异常分支由"注意"日志升级为 `t.Fatalf`）。
- **验证**：`go test ./go/download/...` 全绿（3.09s）。
- **行号漂移提示**：§3.2 表格行号为报告产出日快照；同一文件后续追加了 `#11 错误分类` 专项测试（`TestHTTP_ErrorClassification_*`、`TestAudit_*` 等，现第 455 行起），后续以当前文件实际行号为准。
- **download.go 现状补充**：`ResolveSavePath` 已含三重路径防线（NUL 字节剔除 / `.recycle` 段剥离 / Clean+Abs+前缀校验），下载层 P1 风险已独立兜底；`os.Root`（§4.3）主要仍面向 `go/dedup` / `go/installer` 的批量读取侧，与报告结论一致。

---

## 附录 D：P0-b checksum 调研快照（2026-08-17 实测）

- **结论**：checksum 从 P0-b 降级为 **P2 预留**（详见 §4.2.1）。
- **盲区纠正**：`go/updater` 已有完整 SHA256SUMS 校验链路（`ErrHashMismatch` / `fetchExpectedHash` / `downloadOnce` 流式算哈希），报告初版"项目无 checksum 验证"仅对 `go/download` 成立。
- **实测数据**（真实 HTTP 探测）：
  - jsDelivr `/v1/packages/gh/jquery/jquery@3.7.1` 文件 `hash` = base64（44 字符 → 32 字节），**SHA-256**；`/v1/package/gh/{repo}@{ref}/{path}` 文件级查询 **400 不可用**。
  - GitHub `/repos/jquery/jquery/contents/package.json?ref=3.7.1` `sha` = 40 hex，**git blob SHA-1**，非内容 SHA256。
  - raw 源无 hash；Release Assets `digest` 与模型文件下载无关。
- **预留 API 改动量**：`downloadTo` 加可选 `expectedSHA256`（零漂移）+ `ErrChecksumMismatch` sentinel + 2 单测 ≈ 30 行，未落地（等自营仓库场景或用户决定）。
- **取代方案**：自营仓库配套 SHA256SUMS（照 updater `fetchExpectedHash` 范式），不依赖 jsDelivr API。

---

## 附录 E：P1 调研快照（2026-08-17 源码核验）

**P1-a（`os.Root` 路径安全）——已闭环，不做迁移：**
- Go 版本：`go.mod` = **1.25.0**（≥1.24 前置满足）。
- dedup（`go/dedup/dedup.go:48`）：`filepath.WalkDir` **不跟随 symlink**（Go 语义，仅 root 自身例外）+ 第 54–59 行显式跳过 `ModeSymlink` 条目 + 根为 symlink 返回 `ErrSymlinkRoot` → BUG-1 已免疫。
- installer（`go/installer/installer.go`）：`EvalSymlinks` 守卫（customDir 68–71 / src 82–88 / finalDst 逐段 242–251 / 条目级 327–333）+ deny-list 拦截 `.exe/.bat/.dll/.cmd/.scr/.pif/.com/.msi/.ps1/.vbs`（285–288，`rtype=""` 也拒绝，`installer_extra2_test.go:966` 硬断言）→ BUG-1/2/3 已修复。
- 残余增量：`os.Root` 抗 TOCTOU 属极致防御，dedup 只读分析 / installer 输入受调用方约束，风险可接受。**不立 ADR**。

**P1-b（WASM MT COOP/COEP）——已由 ADR-079 落地：**
- `frontend/src/backend/coi-sw.ts` + `public/sw.js`：COI Service Worker 补 COOP/COEP 头，**GitHub Pages 静态托管也可用**（报告初判"静态托管无法设头"不成立）。
- `frontend/src/workers/stats.worker.ts:98–101`（ADR-079 M4）：`crossOriginIsolated` 检测 → pthread 多线程 WASM / 单线程 fallback。
- `frontend/src/app-modules.ts:75`（ADR-079 M1）：网页版注册 COI SW；`coi-sw.test.ts` 覆盖两态。
- 结论：无需任何改动。

---

**报告完。** P0-a 已落地（提交 `57b1bd9f`），回归红 CI 缺口关闭；P0-b 调研完成并降级为 P2 预留（§4.2.1）；P1-a / P1-b 调研完成并确认**均已闭环**（§4.3.1 / §4.4.1）。本报告四优先级全部收敛：**剩余可选项仅 P2 预留参数**（~30 行，打开自营仓库 checksum 口子，需用户拍板）与附录 A 未深入点。
