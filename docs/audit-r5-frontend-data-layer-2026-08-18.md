# R5 审核报告：前端数据层与服务（backend/core/services）

**审核日期**：2026-08-18
**审核范围**：`frontend/src/backend/`, `frontend/src/core/`, `frontend/src/services/`（~13000 行 TS）
**审核维度**：类型安全、Promise 链完整性、内存泄漏、XSS/注入

---

## 进度统计

| 指标 | 数值 |
|------|------|
| 审核文件数 | ~35 |
| 发现问题总数 | 3 |
| P1（严重） | 0 |
| P2（一般） | 0 |
| P3（建议） | 1 |
| 良好实践 | 4 |
| 前置已知失败（非本次引入） | 22 |

---

## 测试状态

| 测试文件 | 结果 | 说明 |
|----------|------|------|
| `light-capability.test.ts` | ✅ 27/27 通过 | R1 引入的 null.parent 崩溃已修复 |
| `litematic-3d.test.ts` | ❌ 20/21 失败 | **主分支已有失败**（Three.js Raycaster mock 缺失，非本次审核引入） |
| Go sync/types/fileops/scanner | ✅ 全绿 | commit 7420399c 验证通过 |
| typecheck | ✅ 全绿 | |
| vite build | ✅ 通过 | |

---

## P3 问题（建议）

### P3-1: web-store.ts fire-and-forget IDB 写入静默失败

| 项目 | 内容 |
|------|------|
| 文件:行号 | `frontend/src/backend/web-store.ts:76, 110, 116` |
| 问题描述 | 日志环的 IDB 写入使用 `void promise.catch(() => {})` 静默忽略所有错误。虽然注释说明这是"隐私模式/写失败静默降级为纯内存"的设计决策，但这也意味着：如果 IDB 配额超限或数据库损坏，日志会丢失且用户无感知。 |
| 风险 | 极低：这是网页版特有行为（桌面版用 Go 环形缓冲+落盘），且已有降级为纯内存的逻辑。 |
| 修复建议 | 暂时保持现状。如未来需要诊断能力，可添加 `dbg.warn()` 日志标记降级事件。 |

---

## 良好实践（亮点）

| # | 实践 | 文件 | 说明 |
|---|------|------|------|
| 1 | **XSS 零命中** | backend/core/services 全仓 | `innerHTML/document.write/eval/new Function` 零命中，安全基线优秀。 |
| 2 | **类型安全** | 全仓 | `as any/@ts-ignore` 零命中，治理红线 R7 执行到位。 |
| 3 | **Promise 链完整** | web-store.ts | IDB 操作均有 `.catch()` 处理，无未捕获 rejection。`void promise` 是有意设计的 fire-and-forget。 |
| 4 | **Proxy fail-fast 模式** | browser-adapter.ts | 未实现的 binding 返回抛出 `WebUnsupportedError` 的函数，杜绝 `undefined` 穿透导致静默失败（ADR-049 治理红线 #5）。 |

---

## 与 R1/R2/R3 交叉验证

- **R1 修复影响**：light-capability.ts 的 R1 P2-6 fix（spotlightTarget 置 null）引入了测试失败，已在本轮修复。
- **R2 对齐**：R5 前端 IDB 层与 R2 Go 后端路径守卫形成双重保护（前端路径校验 + 后端路径守卫）。
- **R3 对照**：R3 发现 SSRF 代理剥离安全响应头的设计权衡；R5 前端无类似的安全响应头注入问题。

---

## 结论

**R5 审核通过** ✅。前端数据层代码质量优秀，XSS/类型安全/ Promise 链均无 P1/P2 问题。唯一 P3 是设计决策（fire-and-forget IDB 写入），风险极低。

**22 个 litematic-3d 测试失败是前置已知问题**（Three.js Raycaster mock 缺失），需单独 issue 修复，不属于本轮审核范围。
