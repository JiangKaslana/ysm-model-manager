// ===== 创意工坊事件绑定（类型化版 — ADR-014 P3 features）=====
// 下载队列逻辑已拆到 download-queue.js，本文件只做事件绑定 + 协调。
import { bus } from "../../bus.ts";
import { t } from "../../core/i18n/t.ts";
import { modalConfirm } from "../../utils/dom/dialogs/modal.ts";
import { buildModelRow, filterModels, isModelMissing, type WorkshopModel } from "./render.ts";
import { createVirtualList, type VirtualList } from "./virtual-list.ts";
import { createDownloadQueue, type DownloadQueue } from "./download-queue.ts";
import { buildDownloadTasks, classifyDownloadSize } from "./download-tasks.ts";
import { ICONS } from "../../utils/icon/workshop-icons.ts";
import { parseModelName } from "../../utils/dom/display.ts";
import { friendlyError } from "../../utils/dom/errors.ts";
import { getApp } from "../../backend/app.ts";

/** bindRepoEvents 上下文 */
export interface RepoEventsContext {
  esc: (s: string) => string;
  models: WorkshopModel[];
  dlPrefix: string;
  repo: string;
  source: string;
  showRepoModels: () => void;
  backToSite: () => void;
  localMap: Map<string, string>;
}

/** 绑定返回值 */
export interface RepoEventsHandle {
  renderList: (filter?: string) => void;
  updateSelectedUI: () => void;
  cleanup: () => Promise<void>;
}

interface CmReState {
  showAll: boolean;
  disposed: boolean;
  currentFilter: string;
  currentFiltered: WorkshopModel[];
}

interface CmReCtx {
  sr: HTMLElement;
  esc: (s: string) => string;
  models: WorkshopModel[];
  dlPrefix: string;
  repo: string;
  source: string;
  showRepoModels: () => void;
  backToSite: () => void;
  localMap: Map<string, string>;
  state: CmReState;
  selectedSet: Set<string>;
  queue: DownloadQueue;
  virtualList: VirtualList<WorkshopModel> | null;
}

const GH_ROW_H = 42;

function cmReRenderList(ctx: CmReCtx, filter?: string): void {
  const { state, models, virtualList, localMap } = ctx;
  if (filter !== undefined) state.currentFilter = filter;
  state.currentFiltered = filterModels(models, state.currentFilter, state.showAll, localMap);
  virtualList?.refresh(state.currentFiltered);
}

function cmReUpdateSelectedUI(ctx: CmReCtx): void {
  const { sr, selectedSet } = ctx;
  const checked = selectedSet.size;
  const btn = sr.querySelector(".gh-dl-selected") as HTMLButtonElement | null;
  if (btn) {
    btn.textContent = "⬇️ " + t("workshop.downloadSelected", { n: checked });
    btn.disabled = checked === 0;
  }
}

function cmReBindBack(ctx: CmReCtx): void {
  ctx.sr.querySelector(".gh-back-repo")?.addEventListener("click", () => {
    ctx.backToSite();
  });
}

function cmReBindSearch(ctx: CmReCtx): void {
  const srch = ctx.sr.querySelector("#gh-repo-srch") as HTMLInputElement | null;
  if (srch) {
    srch.addEventListener("input", () => {
      cmReRenderList(ctx, srch.value);
    });
  }
}

function cmReBindToggle(ctx: CmReCtx): void {
  const { sr, state } = ctx;
  const toggleBtn = sr.querySelector(".gh-toggle-missing") as HTMLElement | null;
  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      state.showAll = !state.showAll;
      toggleBtn.textContent = state.showAll ? t("workshop.showAll") : t("workshop.showMissing");
      toggleBtn.classList.toggle("active", state.showAll);
      cmReRenderList(ctx);
    });
  }
}

function cmReBindSelChecks(ctx: CmReCtx): void {
  const { sr, selectedSet } = ctx;
  const selContainer = sr.querySelector("#gh-repo-list");
  if (selContainer) {
    selContainer.addEventListener("change", (e: Event) => {
      const target = e.target as HTMLInputElement;
      if (!target.classList.contains("gh-sel")) return;
      const name = target.dataset.name || "";
      if (target.checked) selectedSet.add(name);
      else selectedSet.delete(name);
      cmReUpdateSelectedUI(ctx);
    });
  }
}

function cmReBindDlSelected(ctx: CmReCtx): void {
  const { sr, selectedSet, queue, models, dlPrefix } = ctx;
  const dlSelBtn = sr.querySelector(".gh-dl-selected") as HTMLElement | null;
  if (dlSelBtn) {
    dlSelBtn.addEventListener("click", async () => {
      if (queue.isDownloading()) {
        bus.emit("toast:show", {
          msg: "下载进行中，请等待当前任务完成",
          duration: 2000,
          type: "info",
        });
        return;
      }
      if (!selectedSet.size) return;
      try {
        const tasks = buildDownloadTasks(models, selectedSet, dlPrefix);
        await queue.enqueue(tasks);
      } catch (e) {
        bus.emit("toast:show", {
          msg: friendlyError(e, "下载失败"),
          duration: 3000,
          type: "error",
        });
      }
    });
  }
}

function cmReBindSelAll(ctx: CmReCtx): void {
  const { sr, state, selectedSet, localMap } = ctx;
  const selAllCb = sr.querySelector(
    ".gh-select-all input[type=checkbox]",
  ) as HTMLInputElement | null;
  if (selAllCb) {
    selAllCb.addEventListener("change", () => {
      const checked = selAllCb.checked;
      for (const m of state.currentFiltered) {
        if (isModelMissing(m, localMap)) {
          if (checked) selectedSet.add(m.name);
          else selectedSet.delete(m.name);
        }
      }
      cmReUpdateSelectedUI(ctx);
      cmReRenderList(ctx);
    });
  }
}

function cmReBindContextMenu(ctx: CmReCtx): void {
  const { sr, models } = ctx;
  const listEl = sr.querySelector("#gh-repo-list") as HTMLElement | null;
  if (listEl) {
    listEl.addEventListener("contextmenu", (e: MouseEvent) => {
      const row = (e.target as Element).closest(".gh-row") as HTMLElement | null;
      if (!row) return;
      e.preventDefault();
      e.stopPropagation();
      const name = row.dataset.name || "";
      const m = models.find((x) => x.name === name);
      if (!m) return;
      const sizeStr = (m.size ?? 0) > 0 ? (m.size! / 1024).toFixed(0) + "KB" : "?KB";
      bus.emit("menu:show", {
        x: e.clientX,
        y: e.clientY,
        items: [
          { label: "📄 " + m.name, onClick: () => {} },
          { label: "📂 " + m.path, onClick: () => {} },
          { label: "🔐 " + (m.hash ? m.hash : "—"), onClick: () => {} },
          { label: "📏 " + sizeStr, onClick: () => {} },
        ],
      });
    });
  }
}

async function cmReHandleSingleDownload(
  ctx: CmReCtx,
  btn: HTMLElement,
  row: Element | null,
): Promise<void> {
  const { selectedSet, queue } = ctx;
  const cbName = btn.dataset.name || "";
  const url = btn.dataset.url || "";
  const parsedSize = parseInt(btn.dataset.size || "", 10);
  const size = Number.isFinite(parsedSize) && parsedSize > 0 ? parsedSize : 0;
  const decision = classifyDownloadSize(size);
  if (decision === "reject") {
    bus.emit("toast:show", {
      msg: `📏 ${t("workshop.fileTooLarge")}`,
      duration: 3000,
      type: "warn",
    });
    return;
  }
  if (decision === "confirm") {
    let ok: boolean;
    try {
      ok = await modalConfirm({
        title: t("workshop.largeFile"),
        icon: "📏",
        message: (size / 1024 / 1024).toFixed(1) + "MB，" + t("workshop.confirmDownload"),
        okText: t("workshop.download"),
      });
    } catch {
      ok = false;
    }
    if (ctx.state.disposed) return;
    if (!ok) return;
  }

  const cb = row?.querySelector(".gh-sel") as HTMLInputElement | null;
  if (cb && cbName) {
    cb.checked = true;
    selectedSet.add(cbName);
    cmReUpdateSelectedUI(ctx);
  }

  btn.innerHTML = ICONS.HOURGLASS;
  try {
    await queue.enqueue([{ url, saveDir: "", name: cbName, size }]);
  } finally {
    btn.innerHTML = ICONS.DOWNLOAD;
  }
}

function cmReBindRowClick(ctx: CmReCtx): void {
  const { sr, queue } = ctx;
  const dlContainer = sr.querySelector("#gh-repo-list") as HTMLElement | null;
  if (dlContainer) {
    dlContainer.addEventListener("click", async (e: MouseEvent) => {
      try {
        const target = e.target as HTMLElement;
        if (target.classList.contains("gh-sel")) return;

        const dlBtn = target.closest(
          '.gh-icon-btn[data-action="download"]',
        ) as HTMLElement | null;
        if (dlBtn) {
          if (queue.isDownloading()) {
            bus.emit("toast:show", {
              msg: t("workshop.downloading"),
              duration: 2000,
              type: "info",
            });
            return;
          }
          const row = dlBtn.closest(".gh-row");
          await cmReHandleSingleDownload(ctx, dlBtn, row);
          return;
        }

        const searchBtn = target.closest(
          '.gh-icon-btn[data-action="search-bili"]',
        ) as HTMLElement | null;
        if (searchBtn) {
          e.stopPropagation();
          const row = searchBtn.closest("[data-name]");
          if (row) {
            const { author } = parseModelName(
              (row as HTMLElement).dataset.name || "",
            );
            if (author) {
              try {
                const { OpenInBrowser } = await getApp();
                OpenInBrowser(
                  "https://search.bilibili.com/all?keyword=" +
                    encodeURIComponent(author),
                );
              } catch (openErr) {
                console.warn("[workshop] OpenInBrowser 失败:", openErr);
              }
            }
          }
          return;
        }
      } catch (e) {
        bus.emit("toast:show", {
          msg: friendlyError(e, "操作失败"),
          duration: 3000,
          type: "error",
        });
      }
    });
  }
}

async function cmReCleanup(ctx: CmReCtx): Promise<void> {
  const { sr, state, virtualList, queue, selectedSet } = ctx;
  state.disposed = true;
  virtualList?.destroy();
  sr.querySelectorAll(".gh-back-repo, #gh-repo-srch, .gh-toggle-missing, #gh-repo-list, .gh-dl-selected, .gh-cancel-queue, .gh-select-all input[type=checkbox]").forEach((el) => {
    el.replaceWith(el.cloneNode(true));
  });
  await queue.cancel();
  selectedSet.clear();
  queue.destroy();
}

/**
 * 绑定仓库模型页面的所有事件。
 * 管理 showAll / selectedSet 内部状态。
 *
 * @param sr searchResults DOM 容器
 * @param ctx 上下文
 */
export function bindRepoEvents(sr: HTMLElement, ctx: RepoEventsContext): RepoEventsHandle {
  const { esc, models, dlPrefix, repo, source, showRepoModels, backToSite, localMap } = ctx;
  const state: CmReState = { showAll: false, disposed: false, currentFilter: "", currentFiltered: [] };
  const selectedSet = new Set<string>();
  const reCtxShell: { ctx: CmReCtx | null } = { ctx: null };

  const queue = createDownloadQueue({
    sr, esc, getLocalMap: () => localMap,
    onFileSuccess: (name) => { selectedSet.delete(name); if (reCtxShell.ctx) cmReUpdateSelectedUI(reCtxShell.ctx); },
    onAllDone: () => { selectedSet.clear(); setTimeout(() => { if (state.disposed) return; showRepoModels(); }, 200); },
  });

  const listEl = sr.querySelector("#gh-repo-list") as HTMLElement | null;
  const virtualList = listEl ? createVirtualList<WorkshopModel>({
    scrollEl: sr, listEl, rowH: GH_ROW_H,
    renderItem: (m) => buildModelRow(m, { dlPrefix, localMap, showAll: state.showAll, selectedSet, esc }),
    renderEmpty: () => { const empty = document.createElement("div"); empty.className = "gh-empty"; return empty; },
  }) : null;

  const reCtx: CmReCtx = { sr, esc, models, dlPrefix, repo, source, showRepoModels, backToSite, localMap, state, selectedSet, queue, virtualList };
  reCtxShell.ctx = reCtx;

  cmReBindBack(reCtx); cmReBindSearch(reCtx); cmReBindToggle(reCtx); cmReBindSelChecks(reCtx);
  cmReBindDlSelected(reCtx); cmReBindSelAll(reCtx); cmReBindContextMenu(reCtx); cmReBindRowClick(reCtx);

  const renderList = (f?: string): void => cmReRenderList(reCtx, f);
  const updateSelectedUI = (): void => cmReUpdateSelectedUI(reCtx);
  const cleanup = (): Promise<void> => cmReCleanup(reCtx);
  return { renderList, updateSelectedUI, cleanup };
}
