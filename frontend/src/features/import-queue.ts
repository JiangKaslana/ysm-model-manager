// ===== import-queue.ts —— 主入口（薄壳，ADR-040 ≤400 行红线）=====
import { bus } from "../bus.ts";
import { initDataLayer } from "./import-queue-data.ts";
import { renderImportedList, bindQueueEvents, updateQueueCount } from "./import-queue-render.ts";
import { bindFormEvents, bindDragEvents, bindInputEvents, bindButtonEvents, renderFormData, renderHeaderData } from "./import-queue-events.ts";
import type { ImportFile, ImportQueueHost } from "./import-queue-data.ts";

export { normalizeRepoName, type ImportQueueHost } from "./import-queue-data.ts";

/** 初始化导入队列，返回清理函数 */
export function initImportQueue(app: ImportQueueHost): () => void {
  const root = app._root;
  const dropZone = root.getElementById("dl-drop") as HTMLElement;
  const fileInput = root.getElementById("dl-file-input") as HTMLInputElement;
  const folderInput = root.getElementById("dl-folder-input") as HTMLInputElement;
  const importedList = root.getElementById("dl-imported-list") as HTMLElement;
  const dlCount = root.getElementById("dl-count") as HTMLElement | null;
  const dlQueueCount = root.getElementById("dl-queue-count") as HTMLElement | null;
  const importBtn = root.getElementById("dl-import") as HTMLElement | null;
  const cancelBtn = root.getElementById("dl-cancel") as HTMLElement | null;
  const clearListBtn = root.getElementById("dl-clear-list") as HTMLElement | null;

  // 初始化数据层
  const { state, actions, cleanup: dataCleanup } = initDataLayer(app);

  // 共享 live ref：getter/setter 直连数据层 state —— 按钮/队列事件读取的必须永远是
  // 最新 currentFile/base64/name/relPath/isImporting。原实现为 init 时一次性快照
  // { current: state.currentX }，showForm 改 state 后 ref 不刷新 → 导入按钮永远读到
  // null：表单导入的 base64/relPath 恒为空、队列项导入后永不弹出（陷阱 #13 幽灵状态）
  const currentFileRef = {
    get current(): ImportFile | null { return state.currentFile; },
    set current(v: ImportFile | null) { state.currentFile = v; },
  };
  const currentBase64Ref = {
    get current(): string | null { return state.currentBase64; },
    set current(v: string | null) { state.currentBase64 = v; },
  };
  const currentFileNameRef = {
    get current(): string | null { return state.currentFileName; },
    set current(v: string | null) { state.currentFileName = v; },
  };
  const currentRelPathRef = {
    get current(): string { return state.currentRelPath; },
    set current(v: string) { state.currentRelPath = v; },
  };
  const isImportingRef = {
    get current(): boolean { return state.isImporting; },
    set current(v: boolean) { state.isImporting = v; },
  };

  // 渲染
  let queueCleanups: Array<() => void> = [];
  const renderImportedListFn = (): void => {
    renderImportedList(root, importedList, app._esc, state.currentFile, state.fileQueue, state.repoFiles);
    updateQueueCount(dlQueueCount, dlCount, state.fileQueue);
    // 先清理上一轮的事件绑定，再绑定新一轮（防重复绑定/泄漏）
    queueCleanups.forEach(fn => fn());
    queueCleanups = bindQueueEvents(
      importedList,
      state.fileQueue,
      currentFileRef,
      currentBase64Ref,
      actions.advanceQueue,
      renderImportedListFn,
      isImportingRef,
      actions.toggleForm,
    );
  };

  // 注入渲染函数到数据层
  actions.renderImportedList = renderImportedListFn;

  // === 注入 DOM 渲染回调（数据层 prepareFormData/loadHeaderData 为纯数据，DOM 操作在此完成）===
  actions.setRenderFormData((formData, base64) => {
    renderFormData(root, app._esc, formData, base64, actions.toggleForm, actions.updatePreview, actions.loadHeaderData, (header) => renderHeaderData(root, app._esc, header, actions.updatePreview), cleanups);
  });
  actions.setRenderHeaderData((header) => {
    renderHeaderData(root, app._esc, header, actions.updatePreview);
  });

  // 绑定事件
  const cleanups: Array<() => void> = [];

  bindFormEvents(root, app._esc, actions.updatePreview, actions.loadHeaderData, cleanups);
  bindDragEvents(dropZone, fileInput, folderInput, actions.readAndRouteFile, actions.processDropItems, () => updateQueueCount(dlQueueCount, dlCount, state.fileQueue), cleanups);
  bindInputEvents(fileInput, folderInput, actions.readAndRouteFile, actions.routeCollected, () => updateQueueCount(dlQueueCount, dlCount, state.fileQueue), cleanups);
  bindButtonEvents(
    root,
    importBtn,
    cancelBtn,
    clearListBtn,
    currentFileRef,
    currentBase64Ref,
    currentFileNameRef,
    currentRelPathRef,
    state.fileQueue,
    isImportingRef,
    renderImportedListFn,
    actions.advanceQueue,
    actions.toggleForm,
    actions.loadRepoFiles,
    cleanups,
  );

  // 初始渲染
  renderImportedListFn();

  // 监听全局导入历史变化
  const historyUnsub = bus.on("import:history-changed", () => {
    renderImportedListFn();
  });

  // 返回清理函数
  return () => {
    dataCleanup();
    cleanups.forEach(fn => fn());
    historyUnsub();
  };
}