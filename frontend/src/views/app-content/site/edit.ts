// ===== 站点视图编辑模式事件（从 site-view.ts 拆出，ADR-034 方向①）=====
import { friendlyError } from "../../../utils/dom/errors.ts";
import { bus } from "../../../bus.ts";
import { getApp } from "../../../backend/app.ts";
import { moveItem } from "../../../utils/array.ts";
import { safeSet } from "../../../utils/dom/storage.ts";
import type { WorkshopPresetSearch } from "../../../utils/types-re-export.ts";
import type { LocalCreatorLike } from "../site-view.ts";
import type { SiteViewState, CleanupFn } from "./types.ts";
import * as m from "../community-data.ts";

interface DragStateShell {
  srcIdx: number;
  presetSrcIdx: number;
}

interface FilterStateShell {
  activeTag: string;
}

function eeSyncAllEditInputs(
  searchResults: HTMLElement,
  creators: LocalCreatorLike[],
  site: SiteViewState["site"],
): void {
  searchResults
    .querySelectorAll(
      ".cr-edit-card:not([data-edit='preset']) [data-idx][data-fld]",
    )
    .forEach((inp) => {
      const idx = parseInt((inp as HTMLElement).dataset.idx || "-1", 10);
      const fld = (inp as HTMLElement).dataset.fld || "";
      if (creators[idx]) {
        if (inp.tagName === "SELECT") {
          creators[idx][fld] = Array.from((inp as HTMLSelectElement).selectedOptions)
            .map((o) => o.value)
            .filter(Boolean)
            .join(";");
        } else {
          creators[idx][fld] = (inp as HTMLInputElement).value.trim();
        }
      }
    });
  searchResults
    .querySelectorAll(
      ".cr-edit-card[data-edit='preset'] input[data-fld='label']",
    )
    .forEach((inp) => {
      const idx = parseInt((inp as HTMLElement).dataset.idx || "-1", 10);
      if (site.presetSearches && site.presetSearches[idx]) {
        site.presetSearches[idx].label = (inp as HTMLInputElement).value.trim();
      }
    });
}

function eeClearDragState(
  searchResults: HTMLElement,
  ds: DragStateShell,
): void {
  ds.srcIdx = -1;
  ds.presetSrcIdx = -1;
  searchResults.querySelectorAll(".cr-edit-card").forEach((c) => {
    c.classList.remove("cr-dragging", "cr-drag-target", "cr-drag-before", "cr-drag-after");
  });
}

function eeApplyFilters(
  searchResults: HTMLElement,
  searchInput: HTMLInputElement | null,
  fs: FilterStateShell,
): void {
  const kw = (searchInput?.value || "").trim().toLowerCase();
  const cards = searchResults.querySelectorAll(".gh-card[data-name]");
  let visible = 0;
  cards.forEach((card) => {
    const name = ((card as HTMLElement).dataset.name || "").toLowerCase();
    const desc = (
      card.querySelector(".cr-card-desc")?.textContent || ""
    ).toLowerCase();
    const cardTag = ((card as HTMLElement).dataset.tag || "").toLowerCase();
    const matchName = !kw || name.includes(kw) || desc.includes(kw);
    const matchTag = !fs.activeTag || fs.activeTag === cardTag;
    card.classList.toggle("cr-card-hidden", !(matchName && matchTag));
    if (matchName && matchTag) visible++;
  });
  const countEl = searchResults.querySelector("#ws-cr-count");
  if (countEl) countEl.textContent = "(" + visible + "/" + cards.length + ")";
}

function eeBindToolbarBtns(
  state: SiteViewState,
  refreshView: () => void,
): void {
  const { searchResults, wsEditModeRef, site, creators, allSites, bus: busRef } = state;

  searchResults.querySelector(".cr-edit-btn")?.addEventListener("click", () => {
    wsEditModeRef.v = true;
    refreshView();
  });

  searchResults
    .querySelector(".cr-cancel-btn")
    ?.addEventListener("click", () => {
      wsEditModeRef.v = false;
      refreshView();
    });

  searchResults
    .querySelector(".cr-save-btn")
    ?.addEventListener("click", async () => {
      try {
        if (!site || !site.id) {
          busRef.emit("toast:show", {
            msg: "❌ 站点信息丢失",
            duration: 3000,
            type: "error",
          });
          return;
        }
        if (allSites && site) {
          const { SaveWorkshopPresetsBySite } = await getApp();
          const newPresets: WorkshopPresetSearch[] = [];
          searchResults
            .querySelectorAll(
              ".cr-edit-card[data-edit='preset'] input[data-fld='label']",
            )
            .forEach((inp) => {
              const val = (inp as HTMLInputElement).value.trim();
              if (val) newPresets.push({ label: val } as WorkshopPresetSearch);
            });
          await SaveWorkshopPresetsBySite(site.id, newPresets);
          site.presetSearches = newPresets;
        }
        eeSyncAllEditInputs(searchResults, creators, site);
        const siteCreators = creators.filter(
          (cr) => cr.type && cr.type.split(";").includes(site.id),
        );
        const { SaveWorkshopCreatorsBySite } = await getApp();
        await SaveWorkshopCreatorsBySite(site.id, siteCreators);
        wsEditModeRef.v = false;
        busRef.emit("toast:show", {
          msg: "✅ 已保存",
          duration: 2000,
          type: "success",
        });
        refreshView();
      } catch (e) {
        busRef.emit("toast:show", {
          msg: "❌ " + friendlyError(e, "保存失败"),
          duration: 4000,
          type: "error",
        });
      }
    });
}

function eeBindFetchBtn(
  state: SiteViewState,
  refreshView: () => void,
): void {
  const { searchResults, allCreators, allSites, bus: busRef } = state;

  searchResults
    .querySelector(".cr-fetch-btn")
    ?.addEventListener("click", async () => {
      const btn = searchResults.querySelector(".cr-fetch-btn") as HTMLButtonElement;
      btn.textContent = "⏳";
      btn.disabled = true;
      try {
        const App = await getApp();
        const results = await Promise.all([
          m.fetchCommunityCreators(m.DEFAULT_COMMUNITY_URL),
          m.fetchCommunitySites(),
          App.LoadGitHubRepos().catch(function () {
            return [];
          }),
          App.LoadResourceTypes().catch(function () {
            return "{}";
          }),
        ]);
        const community = results[0],
          sitesData = results[1],
          gitHubRepos = results[2],
          resourceTypesRaw = results[3];
        const logs: string[] = [];
        let changed = false;

        if (community && community.length) {
          const r1 = m.mergeCommunityCreators(allCreators, community);
          await App.SaveWorkshopCreators(allCreators);
          if (r1.added || r1.updated) {
            logs.push(
              "创作者: +" + r1.added + " 补" + r1.updated,
            );
            changed = true;
          }
        }
        if (sitesData && sitesData.length) {
          const r2 = m.mergeCommunitySites(allSites, sitesData);
          if (r2.added > 0) {
            await App.SaveWorkshopSites(allSites);
            logs.push("站点: +" + r2.added);
            changed = true;
          }
        }
        if (gitHubRepos && gitHubRepos.length) {
          logs.push("GitHub: " + gitHubRepos.length + " 仓库");
          changed = true;
        }
        let resourceTypes: unknown[] = [];
        try {
          const parsed = JSON.parse(resourceTypesRaw || "{}") as { resourceTypes?: unknown[] };
          resourceTypes = parsed.resourceTypes || [];
        } catch (e) { console.warn("[site-edit] parse resourceTypes:", e); }
        if (resourceTypes.length) {
          logs.push("类型: " + resourceTypes.length + " 种");
          changed = true;
        }

        if (changed) {
          busRef.emit("toast:show", {
            msg: "🌐 " + logs.join(" · "),
            duration: 4000,
            type: "success",
          });
          refreshView();
        } else {
          busRef.emit("toast:show", {
            msg: "🌐 已是最新配置",
            duration: 3000,
            type: "success",
          });
        }
      } catch (e) {
        const err = e as Error;
        const errMsg = err.message === "NetworkOffline"
          ? "🌐 无网络连接，请检查网络后重试"
          : err.message === "NoIndex"
            ? "📭 社区索引文件不存在"
            : err.message === "RateLimited"
              ? "⏱️ GitHub API 频率限制，请稍后重试"
              : "🌐 " + friendlyError(e, "拉取失败");
        busRef.emit("toast:show", {
          msg: errMsg,
          duration: 5000,
          type: "error",
        });
      } finally {
        btn.textContent = "🌐 更新配置";
        btn.disabled = false;
      }
    });
}

function eeBindCreatorsEdit(
  state: SiteViewState,
  refreshView: () => void,
): void {
  const { searchResults, creators, allCreators, site } = state;

  searchResults
    .querySelectorAll(".cr-edit-card:not([data-edit='preset']) [data-idx][data-fld]")
    .forEach((inp) => {
      inp.addEventListener("input", () => {
        const idx = parseInt((inp as HTMLElement).dataset.idx || "-1", 10);
        const fld = (inp as HTMLElement).dataset.fld || "";
        if (creators[idx]) {
          if (inp.tagName === "SELECT") {
            creators[idx][fld] = Array.from((inp as HTMLSelectElement).selectedOptions)
              .map((o) => o.value)
              .filter(Boolean)
              .join(";");
          } else {
            creators[idx][fld] = (inp as HTMLInputElement).value.trim();
          }
        }
      });
    });

  searchResults.querySelectorAll(".cr-del").forEach((btn) => {
    btn.addEventListener("click", () => {
      eeSyncAllEditInputs(searchResults, creators, site);
      const idx = parseInt((btn as HTMLElement).dataset.idx || "-1", 10);
      if (creators[idx]) {
        const realIdx = allCreators.indexOf(creators[idx]);
        if (realIdx >= 0) allCreators.splice(realIdx, 1);
        refreshView();
      }
    });
  });

  searchResults.querySelector(".cr-add")?.addEventListener("click", () => {
    eeSyncAllEditInputs(searchResults, creators, site);
    creators.push({ name: "新作者", desc: "描述", type: site.id, tag: "" } as LocalCreatorLike);
    allCreators.push(creators[creators.length - 1]);
    refreshView();
  });
}

function eeBindCreatorsDrag(
  state: SiteViewState,
  refreshView: () => void,
  ds: DragStateShell,
): void {
  const { searchResults, creators, allCreators, site } = state;

  searchResults
    .querySelectorAll(".cr-edit-card:not([data-edit='preset'])")
    .forEach((card) => {
      const handle = card.querySelector(".cr-drag-handle");
      if (!handle) return;
      handle.addEventListener("pointerdown", () => {
        (card as HTMLElement).draggable = true;
      });
      card.addEventListener("dragstart", (e: Event) => {
        const de = e as DragEvent;
        (card as HTMLElement).draggable = false;
        ds.srcIdx = parseInt((card as HTMLElement).dataset.editIdx || "-1", 10);
        card.classList.add("cr-dragging");
        de.dataTransfer!.effectAllowed = "move";
        de.dataTransfer!.setData("text/plain", "");
      });
      card.addEventListener("dragend", () => {
        (card as HTMLElement).draggable = false;
        eeClearDragState(searchResults, ds);
      });
      card.addEventListener("dragover", (e: Event) => {
        e.preventDefault();
        (e as DragEvent).dataTransfer!.dropEffect = "move";
      });
      card.addEventListener("dragenter", (e) => {
        e.preventDefault();
        card.classList.add("cr-drag-target");
        if (ds.srcIdx >= 0) {
          const tgt = parseInt((card as HTMLElement).dataset.editIdx || "-1", 10);
          if (ds.srcIdx < tgt) {
            card.classList.add("cr-drag-before");
          } else if (ds.srcIdx > tgt) {
            card.classList.add("cr-drag-after");
          }
        }
      });
      card.addEventListener("dragleave", () => {
        card.classList.remove("cr-drag-target", "cr-drag-before", "cr-drag-after");
      });
      card.addEventListener("drop", (e) => {
        e.preventDefault();
        card.classList.remove("cr-drag-target");
        const targetIdx = parseInt((card as HTMLElement).dataset.editIdx || "-1", 10);
        if (ds.srcIdx < 0 || ds.srcIdx === targetIdx) return;
        eeSyncAllEditInputs(searchResults, creators, site);
        const src = creators[ds.srcIdx];
        const realSrc = allCreators.indexOf(src);
        const realTgt = allCreators.indexOf(creators[targetIdx]);
        if (realSrc < 0 || realTgt < 0) {
          ds.srcIdx = -1;
          return;
        }
        moveItem(allCreators, realSrc, realTgt);
        ds.srcIdx = -1;
        refreshView();
      });
    });
}

function eeBindPresetsEdit(
  state: SiteViewState,
  refreshView: () => void,
): void {
  const { searchResults, site, creators } = state;

  searchResults.querySelectorAll(".cr-del-preset").forEach((btn) => {
    btn.addEventListener("click", () => {
      eeSyncAllEditInputs(searchResults, creators, site);
      const idx = parseInt((btn as HTMLElement).dataset.idx || "-1", 10);
      if (site.presetSearches && site.presetSearches[idx]) {
        site.presetSearches.splice(idx, 1);
        refreshView();
      }
    });
  });

  searchResults.querySelectorAll(".cr-order-up").forEach((btn) => {
    btn.addEventListener("click", () => {
      eeSyncAllEditInputs(searchResults, creators, site);
      const idx = parseInt((btn as HTMLElement).dataset.idx || "-1", 10);
      if (site.presetSearches && idx > 0) {
        const arr = site.presetSearches;
        [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
        refreshView();
      }
    });
  });
  searchResults.querySelectorAll(".cr-order-down").forEach((btn) => {
    btn.addEventListener("click", () => {
      eeSyncAllEditInputs(searchResults, creators, site);
      const idx = parseInt((btn as HTMLElement).dataset.idx || "-1", 10);
      if (site.presetSearches && idx < site.presetSearches.length - 1) {
        const arr = site.presetSearches;
        [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
        refreshView();
      }
    });
  });

  searchResults
    .querySelector(".cr-add-preset")
    ?.addEventListener("click", () => {
      eeSyncAllEditInputs(searchResults, creators, site);
      if (!site.presetSearches) site.presetSearches = [];
      site.presetSearches.push({ label: "", q: "" });
      refreshView();
    });
}

function eeBindPresetsDrag(
  state: SiteViewState,
  refreshView: () => void,
  ds: DragStateShell,
): void {
  const { searchResults, site, creators } = state;

  searchResults
    .querySelectorAll(".cr-edit-card[data-edit='preset']")
    .forEach((card) => {
      const handle = card.querySelector(".cr-drag-handle");
      if (!handle) return;
      handle.addEventListener("pointerdown", () => {
        (card as HTMLElement).draggable = true;
      });
      card.addEventListener("dragstart", (e: Event) => {
        const de = e as DragEvent;
        (card as HTMLElement).draggable = false;
        ds.presetSrcIdx = parseInt((card as HTMLElement).dataset.editIdx || "-1", 10);
        card.classList.add("cr-dragging");
        de.dataTransfer!.effectAllowed = "move";
        de.dataTransfer!.setData("text/plain", "");
      });
      card.addEventListener("dragend", () => {
        (card as HTMLElement).draggable = false;
        eeClearDragState(searchResults, ds);
      });
      card.addEventListener("dragover", (e: Event) => {
        e.preventDefault();
        (e as DragEvent).dataTransfer!.dropEffect = "move";
      });
      card.addEventListener("dragenter", (e) => {
        e.preventDefault();
        card.classList.add("cr-drag-target");
        if (ds.presetSrcIdx >= 0) {
          const tgt = parseInt((card as HTMLElement).dataset.editIdx || "-1", 10);
          if (ds.presetSrcIdx < tgt) {
            card.classList.add("cr-drag-before");
          } else if (ds.presetSrcIdx > tgt) {
            card.classList.add("cr-drag-after");
          }
        }
      });
      card.addEventListener("dragleave", () => {
        card.classList.remove("cr-drag-target", "cr-drag-before", "cr-drag-after");
      });
      card.addEventListener("drop", (e) => {
        e.preventDefault();
        card.classList.remove("cr-drag-target");
        const targetIdx = parseInt((card as HTMLElement).dataset.editIdx || "-1", 10);
        if (
          ds.presetSrcIdx < 0 ||
          ds.presetSrcIdx === targetIdx ||
          !site.presetSearches
        )
          return;
        eeSyncAllEditInputs(searchResults, creators, site);
        moveItem(site.presetSearches, ds.presetSrcIdx, targetIdx);
        ds.presetSrcIdx = -1;
        refreshView();
      });
    });
}

function eeBindGithubFilter(
  state: SiteViewState,
  fs: FilterStateShell,
): void {
  const { searchResults } = state;

  const searchInput = searchResults.querySelector("#ws-cr-search") as HTMLInputElement | null;
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      safeSet("ysm-ws-search-kw", searchInput.value);
      eeApplyFilters(searchResults, searchInput, fs);
    });
  }

  searchResults.querySelectorAll(".cr-tag-filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      fs.activeTag = (btn as HTMLElement).dataset.tag || "";
      safeSet("ysm-ws-active-tag", fs.activeTag);
      searchResults
        .querySelectorAll(".cr-tag-filter-btn")
        .forEach((b) => b.classList.toggle("active", b === btn));
      eeApplyFilters(searchResults, searchInput, fs);
    });
  });

  eeApplyFilters(searchResults, searchInput, fs);
}

/**
 * 绑定编辑模式事件：编辑入口 / 拉取配置 / 取消 / 保存 / 行内编辑 /
 * 删除创作者 / 拖拽排序 / 增删搜索词 / 搜索过滤。
 * 拖拽排序属编辑模式强相关，一并迁此。
 */
export function bindEditEvents(state: SiteViewState, refreshView: () => void): CleanupFn {
  const {
    esc: _esc,
  } = state;
  void _esc;

  const ds: DragStateShell = { srcIdx: -1, presetSrcIdx: -1 };
  const fs: FilterStateShell = { activeTag: state.activeTag };

  eeBindToolbarBtns(state, refreshView);
  eeBindFetchBtn(state, refreshView);
  eeBindCreatorsEdit(state, refreshView);
  eeBindCreatorsDrag(state, refreshView, ds);
  eeBindPresetsEdit(state, refreshView);
  eeBindPresetsDrag(state, refreshView, ds);
  eeBindGithubFilter(state, fs);

  return () => {};
}
