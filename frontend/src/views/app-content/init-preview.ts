// ===== 预览面板拖拽调整（为 app-content/index.ts 减负，ADR-040）=====
import { safeGet, safeSet } from "../../utils/dom/storage.ts";

/**
 * 初始化预览面板拖拽调整宽度
 * @param host - app-content 组件实例
 */
export function initPreviewResize(host: {
  _root: ShadowRoot;
  _resizeMove: ((e: PointerEvent) => void) | null;
  _resizeUp: ((e: PointerEvent) => void) | null;
  _setResizeMove(fn: ((e: PointerEvent) => void) | null): void;
  _setResizeUp(fn: ((e: PointerEvent) => void) | null): void;
}): void {
  const handle = host._root.getElementById("preview-resize-handle");
  const preview = host._root.getElementById("app-preview") as HTMLElement | null;
  if (!handle || !preview) return;

  // 从 localStorage 恢复宽度
  const savedWidth = safeGet("preview-width");
  if (savedWidth) {
    const w = Math.max(160, Math.min(500, parseInt(savedWidth, 10)));
    preview.style.width = w + "px";
  }

  // 先移除上一轮 _render 遗留的 document 监听器，防止切页累积泄漏
  if (host._resizeMove) document.removeEventListener("pointermove", host._resizeMove);
  if (host._resizeUp) document.removeEventListener("pointerup", host._resizeUp);

  let resizing = false;
  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return; // 左键守卫（右键不触发 resize）
    resizing = true;
    e.preventDefault();
    handle.style.background = "var(--accent)";
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    handle.setPointerCapture(e.pointerId);
  });
  const onMove = (e: PointerEvent): void => {
    if (!resizing) return;
    const rect = preview.getBoundingClientRect();
    const newW = Math.max(160, Math.min(500, rect.right - e.clientX));
    preview.style.width = newW + "px";
  };
  const onUp = (e: PointerEvent): void => {
    if (!resizing) return;
    resizing = false;
    handle.style.background = "transparent";
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    if (handle.hasPointerCapture(e.pointerId)) {
      handle.releasePointerCapture(e.pointerId);
    }
    // 保存宽度到 localStorage
    safeSet("preview-width", preview.style.width);
  };
  host._setResizeMove(onMove);
  host._setResizeUp(onUp);
  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", onUp);
}
