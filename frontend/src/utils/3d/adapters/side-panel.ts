// ===== 3D 预览侧栏面板装配（从 mount-preview-core.ts 抽出）=====
// 职责：为适配器专属面板（ysm 骨骼列表/详情等）提供通用外壳：
//   面板容器 + 拖拽调整宽度柄 + 折叠/展开切换按钮。
// 内容由适配器经 built.extraPanel(panel) 填充，核心不关心具体 UI。

/** 侧栏装配结果（供 mount3D 主流程写入 panelEl / panelCleanup 引用） */
export interface SidePanelResult {
  panelEl: HTMLElement;
  panelCleanup: () => void;
}

/**
 * 挂载适配器专属侧栏面板。
 * @param body       3D 预览主体容器（flex row）
 * @param topBar     底部导航栏（追加折叠按钮）
 * @param built      适配器返回的内容场景（含 extraPanel 回调）
 * @returns SidePanelResult 或 null（无 extraPanel 时）
 */
export function mountSidePanel(
  body: HTMLElement,
  topBar: HTMLElement,
  built: { extraPanel?: (panel: HTMLElement) => void },
): SidePanelResult | null {
  if (!built.extraPanel) return null;

  const panel = document.createElement("div");
  panel.id = "preview-panel"; // 对齐旧 skeleton panel：fill3DPanel 内部选择器依赖此 id
  panel.style.cssText =
    "width:260px;flex-shrink:0;overflow:auto;background:rgba(0,0,0,0.25);color:#fff;" +
    "font-size:12px;display:flex;flex-direction:column;border-left:1px solid rgba(255,255,255,0.1)";

  const resizeHandle = document.createElement("div");
  resizeHandle.style.cssText =
    "width:4px;flex-shrink:0;cursor:col-resize;background:rgba(255,255,255,0.2);touch-action:none";
  body.appendChild(resizeHandle);
  body.appendChild(panel);

  const panelToggle = document.createElement("button");
  panelToggle.textContent = "▾";
  panelToggle.style.cssText =
    "font-size:11px;padding:2px 6px;border-radius:4px;border:1px solid rgba(255,255,255,0.2);" +
    "background:rgba(0,0,0,0.3);color:rgba(255,255,255,0.8);cursor:pointer;margin-left:4px";
  topBar.appendChild(panelToggle);

  let panelVisible = true;
  panelToggle.onclick = (): void => {
    panelVisible = !panelVisible;
    panel.style.display = panelVisible ? "flex" : "none";
    resizeHandle.style.display = panelVisible ? "" : "none";
    panelToggle.textContent = panelVisible ? "▾" : "▸";
  };

  let resizing = false;
  const onRM = (e: PointerEvent): void => {
    if (!resizing) return;
    panel.style.width = Math.max(160, Math.min(500, body.getBoundingClientRect().right - e.clientX)) + "px";
  };
  const onRU = (e: PointerEvent): void => {
    resizing = false;
    if (resizeHandle.hasPointerCapture(e.pointerId)) resizeHandle.releasePointerCapture(e.pointerId);
  };
  resizeHandle.addEventListener("pointerdown", (e: PointerEvent) => {
    if (e.button !== 0) return;
    resizing = true;
    e.preventDefault();
    resizeHandle.setPointerCapture(e.pointerId);
  });
  document.addEventListener("pointermove", onRM);
  document.addEventListener("pointerup", onRU);

  built.extraPanel(panel);

  return {
    panelEl: panel,
    panelCleanup: () => {
      document.removeEventListener("pointermove", onRM);
      document.removeEventListener("pointerup", onRU);
    },
  };
}
