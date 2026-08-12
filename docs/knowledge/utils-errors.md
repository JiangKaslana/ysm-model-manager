---
kind: utils-errors
name: 错误处理 errors
tier: leaf
category: utils
source_files:
  - frontend/src/utils/dom/errors.ts
use_when:
  - 错误提示
  - 友好错误
  - friendlyError
  - toast 文案
  - 报错翻译
  - 网络错误
  - 文件被占用
---

# 错误处理 errors

## 概览

把 Go 端/运行时返回的原始错误转换为用户可读的中文提示，是异常路径 toast 文案的统一入口（治理红线：所有异常路径必须有 toast 反馈）。

## 核心职责

- Go 英文错误消息 → 中文友好提示（正则模式匹配）
- 已含中文的消息直接透传（Go 端已友好化/已翻译）
- 未匹配时拼接可配置的前缀兜底

## 对外 API / 入口

- `friendlyError(err: unknown, fallback = "操作失败"): string`
  - 空值 → `"未知错误"`；err 可为 Error 对象或字符串
  - 消息含汉字 → 原样返回
  - 模式库（按优先级）：**社区功能高频错误**（429/rate limit → GitHub API 频率受限、abort → 已取消、parse error → 数据格式异常、DNS → 域名解析失败、ECONNREFUSED/socket → 连接中断、SSL/TLS → 证书错误）**> 通用错误**（权限不足、文件不存在、文件被占用、目录为空、超时、网络异常、参数无效、文件已存在、磁盘空间不足、不支持的格式、操作过于频繁、目录类型错误）
  - 未命中 → `"${fallback}: ${原始消息}"`

## 与其他子系统关系

- 消费方覆盖全部异步操作层：`core/handler-sync` + `handler-other` + `context-menus`、`features/version-updater` + `recycle-bin` + `import-queue`、`app-tree`（instance-actions / bus-handlers / toolbar-events）、`app-content/community`（settings / site-view）、`app-sync-manager`
- 标准调用模式：`catch (e) { bus.emit("toast:show", { type: "error", message: friendlyError(e, "XX失败") }) }`，toast 呈现见 [app_toast](./app-toast.md)
- Go 端错误源头经 `types.AppError` 结构化错误码（ADR-051：Go 产 errno/哨兵/Code，前端 friendlyError 消费 Code 做 i18n，原 go/errors 文本匹配表已删除）

## 不变量

- 治理红线：**所有异常路径必须有 toast 反馈**（AGENTS.md §3.3），禁止静默 `catch {}`；catch 后消息一律经 friendlyError 再给用户
- 模式匹配有顺序依赖：社区错误在前、通用错误在后，新增模式注意不要覆盖更具体的规则。**子串匹配已加词边界/语境限定**（P3 修复：`\b429\b` 防路径误伤、`resolve` 仅 DNS 语境、裸 `refused` 移除改 `access refused` 归权限组——防 `permission refused` 被网络组抢走）
- 不把技术栈细节（堆栈/英文原文）直接暴露给用户，仅在 fallback 分支附原文以便排查

## 审计遗留备案（2026-08-11）

> 以下为多轮子代理审计确认的已知遗留，均属 ADR-051 收尾范畴，不阻塞当前功能；落地前先 Grep `docs/adr` 确认无重复实现。

- **正则表整体保留（ADR-051「已知遗留」）**：前端 friendlyError 的正则模式表（L64-88）应在 Go 端结构化错误码（Code/errno）改造完成后删除——当前是「Code 优先 + 正则兜底」混合态。若未来 Go 端继续收窄错误子串（如 EMFILE/ELOOP），前端表将漂移。删除时需同步更新 errors.test.ts 的 16 类正则断言（errors.test.ts:118 已断言 `"too many open files" → 操作过于频繁`，与 Go 端收窄口径不一致）。
- **`!err` 分支忽略 fallback 参数（低）**：`friendlyError(null, "重命名失败")` 返回「未知错误」而非带上下文前缀；测试仅覆盖无 fallback 情形。若需统一语义，应改为 `fallback` 兜底（与 L94 一致）。
- **透传剥离路径段（P2 已修复，2026-08-11）**：Go 端 `AppError.Error()` 拼入 `源路径：/目标路径：` 内部绝对路径，friendlyError 中文透传/兜底前经 `stripPathSegments` 剥离（ADR-051「透传截断」）；新增模式注意勿重新引入原文拼接。

## esc 转义统一备案（2026-08-11，子代理审计）

> esc（`utils/dom/html.ts`，5-replace 含引号）是全项目 HTML 转义唯一入口（陷阱 #15，check-redlines R10 扫描）。以下旁路属已知遗留，落地前先 Grep 确认无重复实现。

- **modal.ts re-export 双入口**：`dialogs/modal.ts:8` re-export `esc`，导致 version-updater.ts:4 / adv-filter.ts:7 / rename.ts:4 经 modal 导入、其余文件直连 html.ts——函数同一无行为分歧，但违反「统一入口」精神，且未来 modal.ts 改动 re-export 会漂移。建议统一从 `utils/dom/html.ts` 导入。
- **3 处手写部分转义绕过 esc**（均在 utils/dom 之外）：
  - `views/app-content/index.ts:321` — `String(insName).replace(/"/g, "&quot;")`：只转义引号，`&`/`<` 未转义，拼入 innerHTML 属性。
  - `views/app-content/site/render.ts:69` 与 `site/events.ts:149` — `fallbackDiv.replace(/"/g, '&quot;')`：已转义 HTML 嵌入单引号属性时手写引号转义。
  - 测试内联 mock（import-queue.test.ts:114 / community.test.ts:23 / site/events.test.ts:69）自建 3-replace esc（缺 `>`、`'`），与真实 5 字符 esc 不一致——测试断言无法锁定真实转义行为。
  - 建议统一改 `esc`（或与 html.ts 输出语义对齐的共享函数），并修正测试内联 mock。

## 相关

- [app_toast](./app-toast.md) — toast 呈现
- [event_bus](./event-bus.md) — toast:show 事件通道
- `frontend/src/utils/dom/errors.test.js` — 单元测试（验证入口）
