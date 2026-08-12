# ADR-055：红线门禁行号不敏感比对

- **状态**：✅ 已采纳（Accepted）
- **日期**：2026-08-12
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`docs/governance-rules.md`；`scripts/check-redlines.mjs`；`scripts/pre-push-gate.mjs`；`scripts/baseline/redlines-baseline.json`

---

## 1. 背景（Context）

`check-redlines` 是 pre-push 门禁的红线扫描（15 条规则，R1–R10 + W1–W7）。其基线比对键为 **`file:line:ruleId`**，对行号敏感，带来两类假阳性：

1. **行号漂移**：任何加首行注释 / 格式化都会让存量违规的行号整体偏移 → 旧键失效（gone）+ 新键出现（new）→ 全部"假新增"阻断推送。本次 58 个测试文件加 `// @vitest-environment node` 首行注释，触发 **91 条假阳性**，人工排查成本远超门禁收益。
2. **基线文件自引用**：R2 等规则扫描路径含 `'.'`，会命中 `scripts/baseline/redlines-baseline.json` 自身（内容即违规键文本）；基线格式变更时键错位，再爆 **312 条假新增**。

基线 1115 条存量中，R2/R5/R7/R8/R4/W1 六条债务型规则占 96%（1070 条）——它们从未清零，基线比对的实际作用从"拦截新违规"退化为"拦截行号变动"。

## 2. 决策（Decision）

### 2.1 比对键改为内容敏感

`file:line:ruleId` → **`file:ruleId:行内容(snippet)`**（snippet 复用 `cleanSnippet`：trim + 120 字符截断 + 控制字符清洗）：

- 行号漂移（加注释/格式化）但行内容不变 → 键不变 → **不再假新增**。
- 只有行内容真正变化或出现新行才算新增。
- 行号仍保留在 `violations[].line` 中供定位；`--json` 输出契约不变（`test_scripts_json.mjs` 全过）。

### 2.2 基线文件自引用排除

`add()` 统一过滤 `scripts/baseline/` 路径——基线文件是数据快照，不是代码，不应成为任何规则的违规源。

### 2.3 基线重建

`--update-baseline` 重建：1115 → **993 条**（去除基线自引用条目 + 同内容去重）。`--baseline` 校验红线零新增。

## 3. 后果（Consequences）

- **正面**：实测给 `sync.test.ts` 加首行注释（行号全部 +1）→ `new=0`，行号漂移根治；pre-push 不再因格式变更产生数十分钟假阳性排查。真实拦截能力保留（W7 缓存失效 / R10 esc 单点 / 契约测试保护等存量小的真红线，新增仍被有效检出）。
- **负面 / 已知遗留**：同文件同规则同内容的重复行会去重（极端重复样板漏检，影响面小）；债务型规则（R2/R5/R7/R8/R4/W1）存量仍在基线中未清零，"债务搁置"状态延续；若某条债务型规则再频繁误报，后续可评估降级为 WARN 不阻断（本次未执行，保持最小改动）。

## 4. 数据溯源

- 来源：`--update-baseline` 前后基线对比（1115→993）∩ 契约测试 `test_scripts_json.mjs`（--json 结构）∩ 行号漂移实测（sync.test.ts 加注释 → new=0）∩ 基线按规则分布统计（R2 346 / R5 309 / R7 155 / R8 138 / R4 66 / W1 56 / W7 19 / 其余 <15）。
- 结果：比对键内容化 + 基线自引用排除，提交 `2cd69f78`；pre-push 复跑通过（变更域 tests:2 → 仅契约测试 18.4s）。
