# ADR-071：网页版能力边界：.7z 明确不支持 + 社区站点编辑保存补齐

- **状态**：✅ 已采纳
- **日期**：2026-08-16
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/backend/web-fs.ts`、`frontend/src/backend/web-community.ts`、`frontend/src/views/app-content/site`、`docs/adr/ADR-066-universal-resource-preview.md`

---

## 1. 背景（Context）

### 1.1 `.7z`：识别可导入但不可预览（审计缺口 #4）

`resource_types.json` 中 ysm 扩展含 `.7z`，web 端 `mainFileRank(".7z")=主文件` → `.7z` 可导入成模型条目；但：

- `expandZipFiles`（web-fs.ts）只解 `.zip`（fflate 无 7z 解码）→ `.7z` 原样入库；
- WASM 解码器（YSMParser）不认 7z；Go 兜底（`AnalyzeBedrockModel`）web 缺失 → **点击预览必失败**（桌面正常）。

现状是"列表有条目、点击报错"的坏体验，无明确边界。

### 1.2 社区站点编辑保存失败（审计缺口 #5）

`SaveWorkshopPresetsBySite` / `SaveWorkshopCreatorsBySite` / `MergeWorkshopCreatorsFromJSON` 在 web 端 fail-fast（browser-adapter 未实现）→ 社区页「编辑站点→保存」必报错"保存失败: [web] binding … 未实现"；创作者 JSON 拖入合并也失败。Go 端这些写 `workshop_sites.json` / `creators.json` 用户覆盖文件，web 端已有 localStorage 覆盖范式（`SaveWorkshopSites`/`SaveWorkshopCreators` 已实现 bundled+覆盖）。

## 2. 决策（Decision）

**明确网页版能力边界，两个小方向并行，不互相等：**

1. **`.7z`：明确"暂不支持"提示（M1）**——web 端导入/展示 `.7z` 时给明确提示（"网页版暂不支持 .7z，请使用桌面版"），而不是静默失败/点击报错。**不做 web 端 7z 解压**（fflate 无此能力，7z-wasm 等库引入依赖体积/成熟度成本，YSM `.7z` 场景低频）——列为远期评估（M3，7z-wasm 或降级为"仅列表展示"）。
2. **社区站点编辑：web 实现 localStorage 语义对齐（M2）**——`SaveWorkshopPresetsBySite` / `SaveWorkshopCreatorsBySite` / `MergeWorkshopCreatorsFromJSON` 在 web 端实现，语义对齐 Go 的"用户覆盖文件"（web 用 localStorage 覆盖层，与已实现的 `SaveWorkshopSites`/`SaveWorkshopCreators` 同范式）；「编辑站点→保存」与「创作者 JSON 拖入合并」恢复可用。
3. **边界**：`.7z` 的能力缺口不阻塞其他类型（YSM zip / 蓝图 / 投影 / MMD / VRC 的 zip 已识别+导入）；社区编辑补齐不依赖 D2 或体素 3D（独立功能项）。

## 3. 后果（Consequences）

**正面**：
- 能力边界**明确化**：`.7z` 是"明确不支持 + 提示"而非"看起来能用、点开报错"。
- 社区站点编辑/JSON 合并恢复可用（web localStorage 覆盖层，与既有 SaveWorkshop* 同范式）。
- 两个小方向独立排期，M1（.7z 提示）几分钟可落地，M2（社区编辑）独立实现。

**负面**：
- `.7z` 在 web 端暂不可预览（明确的边界，非静默失败）。
- 社区编辑的 web localStorage 与桌面文件覆盖是"双份存储"——靠同范式契约（bundled+覆盖优先）维持一致。

**已知遗留**：
- 7z-wasm 等前端 7z 解压库的引入评估（依赖体积/浏览器兼容）列为远期（M3）。
- 社区编辑的「站点导出/导入 CSV/JSON」在 web 端继续门控提示"请使用桌面版"（审计已确认设计内降级）。

## 4. 数据溯源

来源：网页版 vs Go 能力差异审计（2026-08-16，审计缺口 #4 .7z / #5 社区站点编辑）+ 用户决策（"等不起，给 ADR 定大方向"）→ 结果：ADR-071 立项，方向 = `.7z` 明确不支持+提示（M1）与社区站点编辑 localStorage 对齐（M2），两方向独立排期不互相等；7z-wasm 远期评估（M3）。编码按 M1 → M2 → M3。

<!-- 文件名: web-capability-boundary-7z-community.md → 实际文件 ADR-071-web-capability-boundary-7z-community.md -->
