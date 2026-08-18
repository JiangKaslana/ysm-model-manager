# ADR-069：内容识别统一：ysm 作为解密容器参与 zip/7z 指纹匹配

- **状态**：✅ 已采纳（识别层已统一：`DetectResourceType`/`DetectZipType` 不再扩展名直判 .ysm，走 `MatchZipEntry` 注册表指纹匹配；前端 `loader.ts` isWasmCapable 由注册表派生；`resource_types.json` 中 ysm 声明 `zipEntries` 指纹；Go/TS 双端指纹匹配已落地）
- **日期**：2026-08-16
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`docs/adr/ADR-067-zip-packaged-resource-detection.md`、`docs/adr/ADR-068-container-reader-abstraction.md`（解包代码收敛，边界互补）、`frontend/src/views/app-preview/loader.ts:20-23`、`go/packs/mcmeta.go`、`go/importer/importer_file.go:99`、`go/geometry/archive.go`

---

## 1. 背景（Context）

### 1.1 用户洞察：ysm 是「加密的 zip」，输出与 zip/7z 同构

- **YSMParser WASM 是唯一解码器**：前端 `wasm/ysm-parser.ts`（`ysm_decode_from_memory`）与 Go 侧 `wasm_decoder.go`/`avatar_decode.go`（Node 子进程）都调用同一个 YSMParser wasm。
- **YSMParser 只管 .ysm 加密解密**：`decodeYsmFileFromMemory` 解密加密二进制 → 得到 **zip 容器**；.zip 走 Go `archive/zip`、.7z 走 `sevenzip` 纯 Go 解——**标准容器不经过 WASM**。
- **输出统一**：无论输入是加密 .ysm（解密后）还是标准 .zip/.7z（直接读），产物都是 **ysm.json + models/*.json + textures/ 的多层文件树**（`DecodedFile{Path, Data}`），之后进同一条解析管线（前端 `parseYsmJsonDirect` / Go `extracted.go` / `collectArchiveFiles`）。
- **前端刻意统一**：`loader.ts:20-23` `isWasmCapable = matchTypeByExt(modelPath, YSM)`——.ysm/.zip/.7z/.json 全部喂 WASM（YSM 模型本质就是 zip 结构，WASM 对加密/标准一视同仁）。

### 1.2 现状问题：内容识别与解密环节割裂

- `DetectZipType`（字节扫描 zip local header）与 `DetectResourceType`（路径打开 + detector）**两条识别逻辑**，对 .ysm 走 `isYsmFile`（扩展名直判），对 .zip/.7z 走 `zipEntries` 指纹——**.ysm 解密产物不参与指纹匹配**，而是靠「扩展名 = ysm」特殊兜底。
- 这与「所有模型内容物同构」的事实矛盾：**解密后的 .ysm 与解包后的 .zip 内容完全相同**，识别却走不同路径。
- 用户论断：**「ysm 就是特殊的 zip 格式」——所有位于 ysm 类型的模型，解密后都是基岩版模型 json + png；zip/7z 作为解密环节通用，mmd/vrm 同样可复用，资源包/光影包内部也是特殊格式可 zip/7z 打包。**

### 1.3 与 ADR-068 的边界

- **ADR-068（隔壁立项）**：ContainerReader 抽象收敛「打开容器→条目」的解包**代码**（geometry/avatar/ysm 的 zip/7z OpenReader 重复），保留 YSM 加密→WASM 解密为前置阶段。
- **本 ADR**：收敛「条目→类型」的内容**识别**——.ysm 解密产物与 .zip/.7z 解包产物统一进 zipEntries 指纹匹配，消除「扩展名=ysm 特殊兜底」的割裂。两者互补：068 管打开，069 管识别。

## 2. 决策（Decision）

**ys m 作为解密容器参与 zip/7z 内容识别，统一「打开→文件树→指纹匹配」链路**：

1. **识别统一**：`DetectResourceType`/`DetectZipType` 的 .zip/.7z 分支对「文件树」做 `zipEntries` 指纹匹配；`.ysm` 解密产物（WASM 解密 → zip 容器 → 文件树）**同样进指纹匹配**，而非扩展名直判兜底。识别层只认「文件树 + 指纹」，不关心来源是加密 .ysm 还是标准容器。
2. **指纹覆盖**：ys m 的 `zipEntries`（`ysm.json` suffix / `models/` prefix）既匹配解包后的 .zip 文件树，也匹配解密后的 .ysm 文件树——同一指纹表两用，新增类型只改 JSON。
3. **前端能力映射**：`loader.ts` 的 `isWasmCapable` 语义演进为「容器可解码」——.ysm（需 WASM 解密）与 .zip/.7z（WASM 可直接当 zip 读）统一走 WASM 路径（现状已如此，保持）；Go 侧走 ADR-068 ContainerReader + 本 ADR 指纹。
4. **解密与识别解耦**：WASM 只管「加密二进制 → zip」这一前置步骤；识别不依赖 WASM（Go 侧 .ysm 若未来能纯 Go 解密，识别层零改动）。

## 3. 后果（Consequences）

**正面**：
- 「扩展名=ysm 特殊兜底」的割裂消除——内容识别统一为「文件树 + 指纹」，与「所有模型内容物同构」的事实一致。
- mmd/vrm/资源包/光影包的 zip/7z 打包复用同一识别链路（用户论断落地），新增类型零配置。
- 与 ADR-068 边界清晰（068 打开、069 识别），两 ADR 落地后解包+识别全链路统一。

**负面**：
- .ysm 识别从「扩展名直判」改为「解密→指纹匹配」有性能/链路变化（解密开销前置到识别），需基准验证。
- 与 ADR-068 有交接面：识别层消费 068 的 ContainerReader 文件树，落地顺序建议 068 先行（打开统一）再本 ADR（识别统一）。

**已知遗留**：
- 前端 web 端 .7z 无解压能力（浏览器无原生 7z）——降级提示「请用桌面版导入或转 .zip」（ADR-067 已列，延续）。
- .ysm 纯 Go 解密（不依赖 WASM）不在本 ADR 范围（识别层已解耦，未来可独立立项）。

## 4. 数据溯源

来源：用户架构讨论「ysm 就是特殊的 zip 格式，所有分类位于 ysm 的模型解密后都是基岩版 json+png；zip/7z 作为解密环节通用，mmd/vrm 同样可复用」+ 探索确认 YSMParser WASM 唯一解码器、输出文件树同构（loader.ts:20-23 / wasm_decoder.go / geometry archive.go）→ 结果：ADR-069 立项，编码与 ADR-068（ContainerReader）衔接，按 §2 分阶段落地。

<!-- 文件名: container-archive-unification.md → 实际文件 ADR-069-container-archive-unification.md -->
