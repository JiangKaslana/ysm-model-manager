// 🥉 ui-helpers 组件库 — 图标工厂（替代 MikuMikuAR 的 iconify 图标系统）。
//
// MikuMikuAR 用 createIconifyIcon 渲染 SVG 图标，依赖其 iconify 运行时，本库不引入。
// 这里提供轻量替代：
//  - 含 ':' 的 iconify 风格名（如 'lucide:settings-2'）→ 返回 null，由调用方走文本兜底；
//  - 普通字形（如 '▶' '✕' '📁'）→ 渲染为 .cs-icon 文本节点。
// 这样组件 DOM 结构与 CSS 类保持不变，且不耦合任何图标运行时。

/** 创建一个图标元素（可能返回 null，调用方应走兜底层）。 */
export function createIcon(icon: string): HTMLElement | null {
    if (!icon) {
        return null;
    }
    if (icon.includes(':')) {
        // iconify 风格名：ysm 无 iconify 运行时，交还 null 触发文本兜底
        return null;
    }
    const span = document.createElement('span');
    span.className = 'cs-icon';
    span.textContent = icon;
    return span;
}
