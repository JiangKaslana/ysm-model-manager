// 🥉 ui-helpers 组件库 — 控件自更新注册表（替代 MikuMikuAR 的 render-context）。
//
// MikuMikuAR 原通过 getCurrentRenderingContext()?.registerControl(update) 把控件注册进
// 渲染上下文以实现「菜单重渲染时自动同步」。该上下文与 MikuMikuAR 强耦合，本库解耦为
// 可选注入：默认 registerControl 为 no-op（控件仍保留「bind 即时初始化」能力，由各自
// initControl 在挂载时立即调用一次 update），只有调用方通过 setControlRegistry 接入
// ysm 的响应式/重渲染系统时，持续自更新才会生效。

export type ControlUpdater = () => void;

let _registry: ((fn: ControlUpdater) => void) | null = null;

/**
 * 接入外部控件更新系统（如 ysm 的响应式链路）。
 * 传入 null 可取消接入（恢复为 no-op）。
 */
export function setControlRegistry(fn: ((fn: ControlUpdater) => void) | null): void {
    _registry = fn;
}

/** 注册一个控件更新回调。未接入外部系统时静默忽略。 */
export function registerControl(fn: ControlUpdater): void {
    _registry?.(fn);
}
