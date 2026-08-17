# 联网调研报告（再续）：五个实用技术方向

- **日期**：2026-08-17（周一）
- **作者**：鲸鱼架构师 deepseek（GLM-5.2）
- **范围**：专挑实用技术，聚焦"项目已实现、业界对照能补实用范式"的 5 个方向
- **前序报告**：
  - `docs/web-research-report-2026-08-17.md`（Part 1：Wails COOP/COEP、Go os.Root、emscripten Pthread、VRM 骨骼、原生 Web Components）
  - `docs/web-research-report-2026-08-17-part2.md`（Part 2：rsync rolling hash、WASM 流式 I/O、Molang 求值、robust watcher、content-addressable 缓存）
- **本报告动机**：Part 1/2 聚焦"在攻克的难点"与"知识卡有入口、尚未联网对照"的方向；本报告专挑**实用技术**——项目已实现、但业界对照能补缺失元数据、范式或安全细节的点

---

## 0. 调研主题与项目现状映射

| # | 知识卡现状 | 新方向主题 | 业界对照 |
|---|-----------|-----------|---------|
| 11 | `go-recycle` 用 `.recycle` 目录软删除，`os.Rename` 瞬时移动，跨设备回退复制 | **trash/回收站设计范式**：FreeDesktop Trash Spec v1.0 | FreeDesktop.org Trash Specification v1.0、`andreafrancia/trash-cli`、Rust `trash` crate |
| 12 | `version-updater` 应用自更新，启动时静默检查（6 小时频次限制），`DoUpdate` 下载安装 | **应用自更新安全范式**：TUF、Ed25519 签名验证 | The Update Framework Specification、`doyensec/ElectronSafeUpdater` |
| 13 | `community-feature` 创意工坊（GitHub 模型仓库）浏览与批量下载，多镜像竞速（raw/jsd/api） | **GitHub 仓库镜像/CDN 范式**：jsDelivr 多 CDN failover、`Promise.any` 竞速 | jsDelivr README、`tortoise-db-viewer` 多源 fallback 实现 |
| 14 | `i18n` 基于 ADR-045 设计，`t.ts` 纯函数式翻译，`t(key, params)` 简单查表 + `{key}` 插值 | **i18n 复杂消息格式化范式**：ICU MessageFormat、复数/性别/时间格式 | `messageformat` v3、`i18next-icu`、ICU 官方文档 |
| 15 | `ysm-baked` YSM 烘焙几何反推，cube 语义参数烘焙为纯顶点面，反推可能误判 | **Blockbench 几何反推范式**：cube `from`/`to`/`rotation`/`origin` 语义、UV 坐标系 | Blockbench Cube API、CubeFace UVToLocal/texelToLocalMatrix、Texture Generation UV Packing |

---

## 1. trash/回收站设计范式（`go-recycle` 对照 FreeDesktop Trash Spec v1.0）

### 1.1 一手资料

**来源**：FreeDesktop.org Trash Specification v1.0（specifications.freedesktop.org/trash/latest/）

核心结构：

```
$trash/
  files/      # 被删除的文件/目录本身
  info/       # 每个 trash 文件对应一个 .trashinfo 元数据
  directoriesizes  # 目录大小缓存（可选）
```

`.trashinfo` 文件格式（类似 .desktop 文件）：

```ini
[Trash Info]
Path=/home/netsu/Documents/todelete.txt
DeletionDate=2021-10-08T18:24:04
```

关键规定：

1. **`Path`**：原始位置的绝对路径（从 `/` 开始）或相对路径（从 trash 目录所在目录开始）。相对路径**不得包含 `..`**
2. **`DeletionDate`**：`YYYY-MM-DDThh:mm:ss` 格式（RFC 3339），用户/文件系统的本地时间
3. **文件名唯一性**：`$trash/files` 里的文件名由实现决定，但必须唯一。同名文件多次删除不得互相覆盖
4. **原子创建**：trashing 时**必须先创建 `$trash/info` 里的 .trashinfo 文件**，且必须原子创建。Unix 用 `O_EXCL` 打开，失败则换名重试
5. **不得用文件名恢复原名**：`$trash/files` 里的文件名**绝不能**用来恢复原文件名，必须用 info 文件
6. **保留元数据**：trashed 文件的访问权限、访问时间、修改时间、扩展属性 SHOULD 与删除前相同
7. **目录 trash**：trashed 目录整体移入 `$trash/files`，内部文件名不得更改，access/mtime SHOULD 保留
8. **跨分区 trash**：从其他分区删除的文件，放在 `$topdir/.Trash-$uid` 或 `$topdir/.Trash/$uid`（后者需 sticky bit）

### 1.2 与项目现状对照

| 项目 `go-recycle` 现状 | FreeDesktop Trash Spec v1.0 |
|----------------------|---------------------------|
| `.recycle` 目录软删除 | `$trash/files` + `$trash/info` 双目录 |
| `os.Rename` 瞬时移动 | 同（但 spec 要求先创建 .trashinfo） |
| 跨设备回退复制（EXDEV/ERROR_NOT_SAME_DEVICE） | 跨分区 trash 放 `$topdir/.Trash-$uid` |
| **无删除时间元数据** | `DeletionDate` 必填 |
| **无原路径元数据** | `Path` 必填，用于恢复 |
| 重名自动加 `(1)`/`(2)` | 文件名唯一性（实现决定命名） |
| **无原子创建** | 必须 `O_EXCL` 原子创建 .trashinfo |

### 1.3 落地建议

**短期（低成本补元数据）**：

1. **加 `.trashinfo` 元数据**：每次 `Move`/`MoveEx` 时，在 `.recycle/info/` 下创建 `.trashinfo` 文件，记录 `Path`（原绝对路径）与 `DeletionDate`（RFC 3339 本地时间）
2. **`Restore` 读元数据**：恢复时从 `.trashinfo` 读 `Path`，恢复到原位（当前实现恢复到原位，但元数据缺失时无法验证）
3. **`List` 显示删除时间**：从 `.trashinfo` 读 `DeletionDate`，在回收站列表显示"删除于 2026-08-17 18:24"

**中期（原子性 + 跨分区）**：

4. **原子创建 .trashinfo**：用 `os.OpenFile(infoPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644)` 原子创建，失败则换名重试（防并发删除同名文件竞态）
5. **跨分区 trash**：当前跨设备回退复制是把文件复制到 `.recycle` 下，spec 建议放在 `$topdir/.Trash-$uid`（分区根的 .Trash-$uid 目录），避免大文件跨分区复制

**避坑点**：

- spec 的 `DeletionDate` 时区是"用户或文件系统的本地时间"，**不是 UTC**——但跨时区恢复时会有歧义（参考 xdg 邮件列表 2008-09 讨论）
- `.trashinfo` 的 `Path` 如果是相对路径，**不得包含 `..`**——项目当前用绝对路径，无此问题
- 目录 trash 时，`$trash/info` 只为目录本身创建一个 .trashinfo，不为目录内每个文件创建

---

## 2. 应用自更新安全范式（`version-updater` 对照 TUF + Ed25519）

### 2.1 一手资料

**来源 1**：The Update Framework (TUF) Specification（theupdateframework.github.io/specification/latest/）

核心威胁模型（TUF 防御的攻击）：

1. **篡改攻击**：攻击者修改更新包
2. **回滚攻击**：攻击者提供旧版（已修复漏洞的版本）
3. **冻结攻击**：攻击者让客户端相信"无更新"（一直提供当前版本号）
4. **无限数据攻击**：攻击者提供巨大文件耗尽客户端
5. **混合攻击**：组合以上

TUF 元数据角色（4 层信任）：

| 角色 | 职责 | 签名密钥 |
|------|------|---------|
| `root` | 信任根，授权其他角色密钥 | root 密钥（离线保管） |
| `targets` | 声明哪些目标文件可用、其哈希 | targets 密钥 |
| `snapshot` | 指向各元数据文件的当前版本 | snapshot 密钥 |
| `timestamp` | 声明 snapshot 的最新版本、过期时间 | timestamp 密钥（在线） |

更新流程：

1. 客户端下载 `timestamp.json`，验证签名、未过期
2. 对比 `timestamp.json` 里的 snapshot 版本号，若≤已存版本则无更新
3. 下载 `snapshot.json`，验证签名、版本号匹配 timestamp
4. 下载 `targets.json`，验证签名、版本号匹配 snapshot
5. 从 `targets.json` 找目标文件的哈希，下载目标文件并验证哈希
6. 验证通过后才交给应用代码

**来源 2**：`doyensec/ElectronSafeUpdater`（安全 Electron 更新参考实现）

核心特性：

- **Ed25519 数字签名**：所有 release 用椭圆曲线密码学签名
- **SHA-512 完整性验证**：文件哈希校验后再安装
- **证书固定**：可选 TLS 证书 CA 固定
- **路径校验**：防目录穿越与路径攻击
- **安全临时文件**：`0o700` 权限创建目录（仅所有者）
- **签名链**：ZIP、DMG、YAML 元数据、version manifest 各自独立签名
- **原子操作**：失败时回滚、优雅的文件操作
- **自动轮询**：每 30 分钟检查一次，带随机 jitter
- **智能缓存**：避免重新下载相同 release
- **自动重试**：瞬态网络错误自动重试（最长 1 天延迟）
- **渐进发布**：基于哈希的延迟发布（最长 6 小时）
- **安全降级**：加密验证的降级到旧版本

### 2.2 与项目现状对照

| 项目 `version-updater` 现状 | TUF + Ed25519 范式 |
|--------------------------|-------------------|
| `CheckUpdate` 检查新版本 | `timestamp.json` 验证签名+未过期 |
| `DoUpdate(url, expectedHash)` 下载安装 | 下载目标文件、验证 SHA-512、Ed25519 签名 |
| `expectedHash` 单一哈希校验 | TUF 多层元数据签名链 |
| **无签名验证** | Ed25519 签名防篡改 |
| **无防回滚** | TUF timestamp 版本号防回滚 |
| **无防冻结** | TUF timestamp 过期时间防冻结 |
| 静默检查 6 小时频次 | 自动轮询 30 分钟 + jitter |
| `update:progress` 事件驱动进度弹窗 | 同（Smart Caching + Auto Retries） |

### 2.3 落地建议

**短期（低成本补安全）**：

1. **加 Ed25519 签名验证**：release 时用私钥签名 exe/zip，客户端 `DoUpdate` 下载后先验签名再安装。Go 库：`github.com/o1egl/p256` 或 `crypto/ed25519`
2. **加防回滚**：`CheckUpdate` 返回的版本号与本地已存版本号对比，低于本地则拒绝（防攻击者提供旧版）
3. **加 timestamp 过期检查**：检查接口返回的时间戳，超过 N 天则视为"可能被冻结"，提示用户手动检查

**中期（完整 TUF）**：

4. **实现 TUF 4 层元数据**：`root.json` / `targets.json` / `snapshot.json` / `timestamp.json`，每层独立签名
5. **渐进发布**：release 先推给 10% 用户，观察 6 小时无问题再全推（防坏版本扩散）

**避坑点**：

- TUF 的 4 层元数据对单机桌面应用**可能过重**——项目是单人开发，TUF 这种面向大规模分发的框架，ROI 不高
- Ed25519 签名验证的核心是**私钥保管**——私钥泄露则签名无意义。项目当前无 release 签名流程，引入需先建私钥保管机制
- `DoUpdate` 返回值非 `"success"` 即抛错，但**此分支与 releaseNotes 转义截断零测试覆盖**（知识卡 P3 观察）——先补测试再改安全逻辑

---

## 3. GitHub 仓库镜像/CDN 范式（`community-feature` 对照 jsDelivr + 多源 fallback）

### 3.1 一手资料

**来源 1**：jsDelivr README（github.com/jsdelivr/jsdelivr）

核心架构：

- **多 CDN provider**：Cloudflare + Fastly，任一 CDN 故障流量自动切到剩余 provider
- **多 DNS provider**：同时用 2 个 DNS provider，jsDelivr 宕需要两个同时宕
- **RUM 路由**：真实用户性能数据（Real User Monitoring）驱动负载均衡，秒级响应性能下降
- **永久 S3 存储**：文件首次访问后永久存 S3，即使 GitHub 仓库被删/jsDelivr 宕，文件仍可服务
- **version-fallback**：版本范围请求时，若最新 release 无该文件，自动回退到旧 release 的同名文件（不返回 404）
- **Power-of-Two Expansion**：纹理画布扩展到最近 2 的幂（16/32/64/128/256/512），保证游戏引擎兼容

关键 failover 层级：

1. DNS 层：双 DNS provider，任一检测到负载均衡端点问题则切单 CDN
2. 负载均衡层：RUM + synthetic 数据监控 CDN provider uptime，故障则移除该 provider
3. Origin 层：多服务器多数据中心，单 server 宕 CDN 自动切健康 server

**来源 2**：`tortoise-db-viewer` 多源 fallback 实现（commit 9444f58）

核心范式：

```js
// origins raced at boot (Promise.any on version.json) across R2 -> raw -> Pages
// the winner is sticky per region (7d) with a ?origin= override
const origins = ['https://r2.example.com', 'https://raw.githubusercontent.com/...', 'https://pages.example.com'];
const winner = await Promise.any(origins.map(o => fetch(`${o}/version.json`).then(r => {
  if (!r.ok) throw new Error(`${o} failed`);
  return o;
})));
```

- **`Promise.any` 竞速**：多个 origin 同时请求 `version.json`，任一成功则用该 origin
- **region sticky 7 天**：竞速胜出的 origin 在该 region 粘性 7 天，避免每次启动都竞速
- **`?origin=` override**：允许手动指定 origin（调试/绕过故障）
- **DB bytes tried in order**：R2（brotli via header）→ jsDelivr（`@cdn-v` immutable tag）→ raw（cdn branch HEAD）
- **client-side gzip 解码**：`DecompressionStream`（原生，无依赖），镜像服务 raw `.gz`（无 Content-Encoding）也能工作

### 3.2 与项目现状对照

| 项目 `community-feature` 现状 | jsDelivr + 多源 fallback 范式 |
|---------------------------|---------------------------|
| 多镜像竞速（raw/jsd/api） | `Promise.any` 竞速 + region sticky |
| `data.ts` 抓取远端 index.json | `version.json` 竞速定 origin |
| 多镜像竞速失败切换 | 3 层 failover（DNS/负载均衡/Origin） |
| **无 region sticky** | 竞速胜出者粘性 7 天 |
| **无 `?origin=` override** | 手动指定 origin 调试 |
| **无 brotli/gzip 解码** | `DecompressionStream` 客户端解码 |

### 3.3 落地建议

**短期（低成本改进）**：

1. **加 region sticky**：竞速胜出的镜像在 localStorage 粘性 N 天，避免每次启动都竞速（项目当前每次都竞速，浪费带宽）
2. **加 `?origin=` override**：允许手动指定镜像（调试/绕过故障镜像）
3. **加镜像健康检查**：竞速时记录每个镜像的响应时间与成功率，长时间失败的镜像暂时从竞速列表移除

**中期（性能优化）**：

4. **加 brotli/gzip 客户端解码**：镜像服务压缩后的 index.json 用 `DecompressionStream` 解码，减少带宽
5. **加 version-fallback**：请求版本范围时，若最新 release 无该文件，自动回退到旧 release（jsDelivr 同款机制）

**避坑点**：

- jsDelivr 的多 CDN failover 对项目**过重**——项目镜像源固定（raw/jsd/api），不需要 jsDelivr 级的多 CDN 架构
- `Promise.any` 竞速时，**慢镜像的 fetch 不会自动取消**，会浪费带宽。考虑用 `AbortController` 在胜出后取消其他
- region sticky 的 7 天阈值是 trade-off：太短则频繁竞速，太长则故障镜像粘性过久

---

## 4. i18n 复杂消息格式化范式（`i18n` 对照 ICU MessageFormat）

### 4.1 一手资料

**来源 1**：ICU MessageFormat（unicode-org.github.io/icu/userguide/format_parse/messages/）

核心语法：

```
# 简单插值
Hello {name}!

# 复数（plural）
You have {numPhotos, plural, =0 {no photos} =1 {one photo} other {# photos}}.

# 性别选择（select）
{gender, select, male {He said} female {She said} other {They said}}

# 嵌套（复数 + 性别）
{gender, select,
  male {{numPhotos, plural, =0 {he has no photos} =1 {he has one photo} other {he has # photos}}}
  female {{numPhotos, plural, =0 {she has no photos} =1 {she has one photo} other {she has # photos}}}
  other {{numPhotos, plural, =0 {they have no photos} =1 {they have one photo} other {they have # photos}}}
}

# 时间/数字格式化
The task was {done, number, percent} complete at {t, time}.
```

关键特性：

- **`plural`**：复数形式（`zero`/`one`/`two`/`few`/`many`/`other`），支持 `=0`/`=1` 精确匹配
- **`select`**：通用选择器（性别、角色等）
- **`selectordinal`**：序数复数（`1st`/`2nd`/`3rd`）
- **`number`**：数字格式化（`percent`/`currency`/自定义 skeleton）
- **`time`/`date`**：时间日期格式化
- **嵌套**：复数内嵌性别，性别内嵌复数
- **`#` 占位符**：在 `plural` 里代表当前数字

**来源 2**：`messageformat` v3（messageformat.github.io/messageformat/）

核心特性：

- 基于 ICU MessageFormat 标准，支持 Unicode CLDR 所有语言
- 编译期把消息编译成 JS 函数（build-time），减少运行时开销
- 支持多种源文件格式（JSON/YAML/Java properties/gettext .po）
- 可在 build 时把其他格式转成 ICU MessageFormat 再处理

**来源 3**：`i18next-icu`（github.com/i18next/i18next-icu）

i18next + ICU 集成：

```js
i18next.use(ICU).init({
  lng: "en",
  resources: {
    en: {
      translation: {
        key: "You have {numPhotos, plural, =0 {no photos.} =1 {one photo.} other {# photos.}}"
      }
    }
  }
});
i18next.t("key", { numPhotos: 1000 }); // -> You have 1,000 photos.
```

关键警告：

- 用了 i18next-icu，**i18next 的 `{{variable}}` 插值不再工作**，只能用 ICU 的 `{variable}` 语法
- i18next 的类型级插值提取器会混淆 ICU 的单大括号与嵌套大括号，需 `parseInterpolation: false` 关闭

### 4.2 与项目现状对照

| 项目 `i18n` 现状 | ICU MessageFormat 范式 |
|---------------|----------------------|
| `t(key, params)` 简单查表 + `{key}` 插值 | ICU `plural`/`select`/`number`/`time` |
| 缺失 key 返回 key 本身（带单次 `console.warn`） | ICU 解析错误返回未替换字符串或 fallback |
| 支持简体中文（基准）、英语、日语 | ICU CLDR 支持所有语言复数规则 |
| **无复数形式** | `{count, plural, =0 {no} one {# item} other {# items}}` |
| **无性别选择** | `{gender, select, male {...} female {...} other {...}}` |
| **无数字/时间格式化** | `{done, number, percent}` / `{t, time}` |

### 4.3 落地建议

**短期（不改）**：

项目当前 UI 文案简单（按钮文字、菜单名、提示语），`{key}` 插值够用。引入 ICU MessageFormat 会增加：

- 翻译包体积（ICU 语法比简单插值长）
- 翻译人员学习成本（ICU 语法对非技术翻译人员不友好）
- 运行时开销（ICU 解析比简单查表慢）

**中期（出现复杂文案需求时）**：

1. **引入 `messageformat` v3**：build 时编译 ICU 消息成 JS 函数，运行时零解析开销
2. **或引入 `@formatjs/intl`**：React 生态主流，但项目无 React，`messageformat` v3 更合适
3. **典型用例**：
   - 复数：「已导入 {count} 个模型」（中文无复数，但英语/日语需要）
   - 数字格式化：「仓库大小 {size, number, percent}」
   - 时间格式化：「最近扫描 {time, time}」

**避坑点**：

- **中文无复数形式**，ICU `plural` 对中文场景无收益——但英语/日语翻译包需要
- ICU 的 `{count, plural, ...}` 语法与项目当前 `{key}` 插值**不兼容**，迁移需改所有翻译包
- `messageformat` v3 的 build-time 编译需要集成到 vite 构建链，增加构建复杂度

---

## 5. Blockbench 几何反推范式（`ysm-baked` 对照 Blockbench Cube API）

### 5.1 一手资料

**来源 1**：Blockbench Cube API（web.blockbench.net/docs/classes/custom_cube.Cube.html）

Cube 的语义参数：

```typescript
interface ICubeOptions {
  name?: string
  autouv?: 0 | 1 | 2          // 自动 UV 设置
  shade?: boolean              // 是否基于法线着色
  inflate?: number             // 膨胀值，所有面均匀膨胀
  from?: ArrayVector3          // 立方体最小角坐标
  to?: ArrayVector3            // 立方体最大角坐标
  rotation?: ArrayVector3      // 旋转（欧拉角）
  origin?: ArrayVector3        // 旋转中心（pivot）
  stretch?: ArrayVector3       // 拉伸
  box_uv?: boolean             // 是否用 Box UV 模式
  uv_offset?: ArrayVector2     // Box UV 模式的 UV 位置
  faces?: Partial<Record<CardinalDirection, CubeFaceOptions>>
}
```

CubeFace 的语义参数：

```typescript
class CubeFace {
  direction: CubeFaceDirection  // 'north' | 'south' | 'east' | 'west' | 'up' | 'down'
  uv: [number, number, number, number]  // [x1, y1, x2, y2]
  uv_size: readonly [number, number]
  rotation: number              // UV 旋转（0/90/180/270）
  tint?: number                 // 染色索引
  cullface?: CubeFaceDirection  // 背面剔除参考方向
  material_name?: string
  enabled?: boolean
}
```

关键方法：

- `CubeFace.UVToLocal`：UV 坐标 → 3D 局部坐标（用第一个三角形做重心坐标，warped quad 可能不准）
- `CubeFace.texelToLocalMatrix`：UV → 3D 局部坐标矩阵
- `Cube.roll(axis, steps, origin)`：绕轴 90 度步进旋转
- `Cube.transferOrigin(origin, update)`：转移 origin 到新位置，同时更新 from/to 保持视觉位置
- `Cube.getWorldCenter()`：立方体在世界空间的中心

**来源 2**：Blockbench Texture Generation - UV Packing Algorithm（deepwiki.com/JannisX11/blockbench/6.5-texture-generation）

Face UV System and Packing Algorithm 核心步骤：

1. **Sort**：面按大小排序（最大优先）
2. **Find Space**：扫描 2D 空间找第一个可用位置
3. **Mark Space**：在 map 中标记矩形为占用
4. **Update UV**：计算并分配 UV 坐标
5. **Expand Canvas**：若需，扩展纹理尺寸

`projectFace()` 算法（unwrap mesh 面到 2D UV 平面）：

1. 用 `face.getNormal(true)` 计算面法线
2. 用法线与第一个顶点创建平面
3. 用 `cameraTargetToRotation()` 计算面向平面的相机旋转
4. 用 `plane.projectPoint()` 把顶点投影到平面
5. 应用 Euler 旋转展平到 2D UV 空间

**来源 3**：Blockbench issue #2932 "Make tesselation of bbmodel faces consistent"

关键问题：

- bbmodel 文件里 mesh 面的顶点顺序**不一致**，读取者无法直接构建 triangle fan
- `getSortedVertices` 函数负责排序，但运行时反复排序开销大
- 提议：在 bbmodel 文件里加 per-face hint，告诉读取者面应该如何 tessellate（例如 per-face normal 或 getSortedVertices 的结果）

### 5.2 与项目现状对照

| 项目 `ysm-baked` 现状 | Blockbench Cube API 范式 |
|---------------------|------------------------|
| YSM 导出时 cube 的 `origin/size/uv/rotation` 烘焙为纯顶点面 | Blockbench 保留 `from/to/rotation/origin` 语义 |
| `RawYsmModel.RawCube.faces` 只保留每面 4 顶点 + 法线 + 4 组 u/v | `CubeFace.uv: [x1,y1,x2,y2]` + `uv_size` + `rotation` |
| `YSMParser` 反推 BlockBench 语义（猜 origin/size/uv） | `Cube.transferOrigin` 转移 origin 保持视觉位置 |
| 反推可能误判复杂嵌套旋转/极近重合顶点 | `CubeFace.UVToLocal` 用第一个三角形，warped quad 不准 |
| **UV 以每面浮点原样烘焙**（`RawFace.u/v[4]`） | `CubeFace.uv` 是 `[x1,y1,x2,y2]` 整数坐标 |

### 5.3 落地建议

**短期（不改）**：

项目当前定位是"消费反推 JSON"，不是"反推算法实现"。反推由 `YSMParser` WASM（与 YSMViewer 同源的 C++ 解析器）完成，项目前端 `parseBedrockGeometryFromJSON` 只负责消费反推出的 JSON。复杂嵌套旋转/重合顶点的反推误判是**上游已知限制**，不是本应用缺陷，不要在几何反推端打补丁硬修（等上游修复后同步）。

**中期（若上游反推算法升级）**：

1. **对照 Blockbench Cube API 验证反推结果**：反推出的 `from/to/rotation/origin` 应满足 Blockbench 的 `Cube.transferOrigin` 不变量——转移 origin 时 from/to 同步更新，视觉位置不变
2. **UV 反推验证**：反推出的 `CubeFace.uv` 应是 `[x1,y1,x2,y2]` 矩形坐标，`uv_size` 应等于 `[x2-x1, y2-y1]`。若反推出非矩形 UV（如每面 4 组独立 u/v），说明上游用了 per-vertex UV 而非 Box UV，项目 `geometry.ts:71-84` 的 UV 兼容数组/对象/JSON 字符串/兜底四种形态需继续支持
3. **tessellation 一致性**：若反推结果用于自定义渲染（非 Blockbench），注意 bbmodel 的 mesh 面顶点顺序不一致问题（issue #2932），需用类似 `getSortedVertices` 的逻辑排序

**避坑点**：

- Blockbench 的 `CubeFace.UVToLocal` 用**第一个三角形**做重心坐标，warped quad（非平面四边形）可能不准——项目渲染若依赖 UV→3D 映射，需注意此限制
- `Cube.roll` 的 90 度步进旋转与 YSM 的任意角度旋转**不同**，反推时若假设 90 度步进会误判非正交旋转
- `inflate` 参数在 YSM 烘焙时已被吸收进顶点坐标，反推时无法恢复——这是已知信息丢失，不是 bug

---

## 6. 调研来源汇总

| # | 主题 | 来源 URL | 类型 |
|---|------|----------|------|
| 11 | FreeDesktop Trash Specification v1.0 | https://specifications.freedesktop.org/trash/latest/ | 官方规范 |
| 11 | `andreafrancia/trash-cli` 实现 | https://github.com/andreafrancia/trash-cli | 开源库 |
| 11 | Rust `trash` crate freedesktop.rs 源码 | https://docs.rs/trash/latest/src/trash/freedesktop.rs.html | 开源库源码 |
| 12 | The Update Framework (TUF) Specification | https://theupdateframework.github.io/specification/latest/ | 官方规范 |
| 12 | `doyensec/ElectronSafeUpdater` 安全更新参考实现 | https://github.com/doyensec/ElectronSafeUpdater/ | 开源库 |
| 12 | TUF Delta Support issue #335 | https://github.com/theupdateframework/tuf/issues/335 | GitHub issue |
| 13 | jsDelivr README 多 CDN failover | https://github.com/jsdelivr/jsdelivr | 开源项目 |
| 13 | `tortoise-db-viewer` 多源 fallback 实现 | https://github.com/Xian55/tortoise-db-viewer/commit/9444f58d08814dfc39a9df36ec708f99943e0633 | 开源项目 commit |
| 14 | ICU MessageFormat 官方文档 | https://unicode-org.github.io/icu/userguide/format_parse/messages/ | 官方文档 |
| 14 | `messageformat` v3 | http://messageformat.github.io/messageformat/ | 开源库 |
| 14 | `i18next-icu` i18next + ICU 集成 | https://github.com/i18next/i18next-icu | 开源库 |
| 15 | Blockbench Cube API | https://web.blockbench.net/docs/classes/custom_cube.Cube.html | 官方 API 文档 |
| 15 | Blockbench Texture Generation UV Packing | https://deepwiki.com/JannisX11/blockbench/6.5-texture-generation | DeepWiki 解读 |
| 15 | Blockbench issue #2932 tessellation 一致性 | https://github.com/JannisX11/blockbench/issues/2932 | GitHub issue |

---

## 7. 后续开发借鉴清单（再续）

11. **trash/回收站**：`go-recycle` 当前无删除时间/原路径元数据——**低成本补 `.trashinfo` 元数据**（`Path` + `DeletionDate`），`List` 显示删除时间，`Restore` 验证原路径；原子创建用 `O_EXCL`

12. **应用自更新安全**：`version-updater` 当前无签名验证/防回滚/防冻结——**低成本补 Ed25519 签名验证 + 版本号防回滚**；完整 TUF 4 层元数据对单人项目过重，ROI 不高

13. **GitHub 仓库镜像/CDN**：`community-feature` 多镜像竞速无 region sticky——**低成本补 localStorage 粘性 N 天 + `?origin=` override**；竞速胜出后用 `AbortController` 取消其他慢镜像的 fetch

14. **i18n 复杂消息格式化**：`i18n` 当前 `t(key, params)` 简单插值够用——**只有出现复数/性别/数字时间格式化需求时才引入 `messageformat` v3**；中文无复数形式，ICU `plural` 对中文场景无收益，但英语/日语翻译包需要

15. **Blockbench 几何反推**：`ysm-baked` 当前定位是"消费反推 JSON"，反推误判是上游已知限制——**不要在几何反推端打补丁硬修**，等上游 `YSMParser` 修复后同步 WASM 资产；反推结果验证对照 Blockbench Cube API 的 `transferOrigin` 不变量

---

*本报告所有代码范式与避坑点均来自上述一手资料的直接引用或整理，后续开发可直接对照本报告 §7 第 11-15 条借鉴清单落地。与前序报告 Part 1 §7 第 1-5 条 + Part 2 §7 第 6-10 条合并，共 15 条借鉴清单。*
