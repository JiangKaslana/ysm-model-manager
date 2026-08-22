# ADR-115：➕ 追加语义收敛：同类型 switchTo / 跨类型 switchExternal 类型分发（ADR-093 T4-b）

- **状态**：✅ 已采纳
- **日期**：2026-08-23
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`ADR-093 T4-b 多模型同台追加、preview-menu ➕ 按钮`

---

## 1. 背景（Context）

多模型同台追加（keepInScene，ADR-093 T4）引入后，「➕ 追加」按钮的**跨类型语义**在提交间反复横跳：

- `f86129bf` 移除类型守卫（假设跨类型可直接喂当前 adapter 追加）
- `933c8839` 恢复守卫（实测把 .vrm/.pmx 喂给 ysm/mmd adapter 会解析失败崩掉）
- `14fcb0ac` 收敛：跨类型 ➕ 改走 switchExternal 类型分发（不是直接不给，而是走对函数）

根因（git bisect 实证）：`switchToSession`（switch-preview.ts:87）**无类型 dispatch**——keepInScene 追加直接用当前会话 `adapter.build`（mount-preview-core.ts:365-368 → switchToSession → ctx.adapter.build）。跨类型文件喂给当前适配器必崩。「跨类型能否 keepInScene」这个决策点在提交间来回摇摆，是这条功能线折腾多轮的根因——不是实现难，是语义没凝固。

## 2. 决策（Decision）

「➕ 追加」按目标候选与当前会话的类型关系分三态，语义单点收敛：

1. **同类型候选 ➕** → `ctx.switchTo(p, { keepInScene: true })`：复用当前会话 adapter 追加（switchToSession keep 模式，跳过旧内容层移除/dispose，仅 sceneRegistry.register，MAX_MODELS=8 超限拦截）。
2. **跨类型候选 ➕** → `ctx.switchExternal(p, siblings, { keepInScene: true })`：`switchExternal`（preview-library.ts:119）→ `openModel3DFullscreen({ cooperate })` → 有活跃会话时 `switchPreview(path, { keepInScene: true })`（preview-library.ts:59-61）——注册表主门按目标 rtype 路由到对应 opener 同台追加（ADR-093 T4-b 扩展点，用目标类型 opener，**不喂给当前会话 adapter**）。
3. **行本体点击跨类型** → `ctx.switchExternal(p, siblings)`（无 keepInScene）= 替换语义（整段重建，非追加）。

**禁止**：把跨类型文件直接喂给当前会话 `adapter.build`（走错适配器解析失败）。

配套契约：`switchExternal` 签名统一为 `(path, siblings?, options?: { keepInScene?: boolean })`（Mount3DOptions / PreviewMenuCtx / PreviewExtras 三处 + 透传实现同步，typecheck 把关）；keepInScene → cooperate（openModel3DFullscreen 选项）。

## 3. 后果（Consequences）

**正面**：
- 三态语义清晰且已测试锁定（preview-menu.test.ts：同类型 ➕ 走 switchTo keepInScene、跨类型 ➕ 走 switchExternal keepInScene、行本体点击跨类型走 switchExternal 替换）
- 跨类型同台追加可用（MMD+VRM 同框）——走 switchPreview 主门按类型路由，不依赖当前会话适配器

**负面**：
- 跨类型 ➕ 依赖 switchPreview 主门有对应 rtype 的 opener；未注册类型直接 toast 提示（不回退 YSM opener——YSM opener 无法加载非 YSM 文件，回退只产生误导）

**已知遗留**：
- cooperate 追加的按类型解析依赖 opener 注册表完备（ADR-111 收口后类型 tab 从 resource_types.json 派生，opener 注册表与其保持单源）
- switchPreview 主门按类型路由的 keepInScene 语义细节（目标 opener 追加到活跃场景的实现）以 ADR-093 T4 为准

## 4. 数据溯源

- 链路：preview-menu.ts:1069-1088（➕ 显示与点击两条分支）→ switchExternal（preview-library.ts:119）→ openModel3DFullscreen cooperate（preview-library.ts:59-61）→ switchPreview({keepInScene}) → switchToSession（switch-preview.ts:87，keep=true 跳过移除/dispose、MAX_MODELS=8 拦截）
- 反复提交记录：`git log -S switchExternal`——f86129bf（移除守卫）→ 933c8839（恢复守卫）→ 14fcb0ac（走对函数，本 ADR 定稿）
- 测试锁定：preview-menu.test.ts 跨类型 ➕ 断言（switchExternal 带 keepInScene 调用）

<!-- 文件名: append-semantics.md → 实际文件 ADR-115-append-semantics.md -->
