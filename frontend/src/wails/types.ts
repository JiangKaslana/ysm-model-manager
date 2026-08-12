// ===== Wails App 绑定类型（ADR-049 Phase 1）=====
// 独立文件避免 app.ts ↔ browser-adapter.ts 循环引用（import type 虽擦除，
// vitest 模块图仍会死锁超时）。

/** Wails v3 生成的 App 绑定模块形状（bindings 目录下 app.ts） */
export type AppBindings = typeof import("../../bindings/ysm-model-manager/internal/app/app.js");
