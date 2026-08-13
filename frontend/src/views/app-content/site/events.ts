// ===== 站点视图浏览态事件绑定（从 site-view.ts 拆出，ADR-034 方向①）=====
import { dbg } from "../../../utils/debug/debug.ts";
import {
  getCreatorIdentity,
  getTagFromRole,
  parseDescTags,
  loadFavs,
  isFaved,
  toggleFav,
  type CreatorIdentityInput,
} from "../workshop-data.ts";
import { getSiteIcon, getTagIconFromRole } from "../../../utils/icon/workshop-icons.ts";
import { createCrCard, type CrCardCtx } from "./render.ts";
import { getApp } from "../../../backend/app.ts";
import { t } from "../../../core/i18n/t.ts";
import type { SiteViewState, CleanupFn } from "./types.ts";

// storage 监听器模块私有变量（防泄漏，bindBrowseEvents 返回的 cleanup 会清）
let _storageSyncFn: ((e: StorageEvent) => void) | null = null;

/**
 * 绑定浏览态事件：空状态按钮 / 创作者卡片网格 / 预设搜索 / 收藏 / 头像调试 /
 * 卡片点击详情浮层 / 键盘导航 / storage 同步。
 * 返回 cleanup：移除 storage 监听，供主入口在切页/重渲染时统一调用。
 */
export function bindBrowseEvents(state: SiteViewState, refreshView: () => void): CleanupFn {
  const {
    esc, searchResults, allCreators, wsEditModeRef, avatarCache,
    site, creators, authorCountMap,
    fillSearch, openUrl, bus: busRef,
  } = state;

  // P3 修复（子代理审计，问题 B）：代际守卫——fetch 在途时用户切站点/切 tab
  // （index.ts showSiteView 重渲染同一 searchResults），await 续体仍会执行
  // showProgress（清空 searchResults.innerHTML），把新站点
  // 视图冲掉（community/events.ts:56-58 的 disposed 同款修复）；cleanup 置位后
  // 所有 await 续体检查并提前返回
  let disposed = false;

  // 无创作者时「浏览本地模型」按钮
  const emptyLocalBtn = searchResults.querySelector("[data-local-empty]");
  if (emptyLocalBtn) {
    emptyLocalBtn.addEventListener("click", () => {
      busRef.emit("nav:change", { page: "repository" });
    });
  }

  // 用工厂函数填充创作者网格（替代内联字符串）
  const grid = searchResults.querySelector("#cr-creator-grid");
  if (grid && !wsEditModeRef.v && creators.length) {
    const cardCtx: CrCardCtx = {
      esc,
      isFaved,
      authorCountMap,
      avatarCache,
      creators,
      allCreators,
      site,
    };
    creators.forEach((cr) => {
      const card = createCrCard(cr, cardCtx);
      grid.appendChild(card);
    });
  }

  // 预设搜索按钮
  searchResults.querySelectorAll(".cr-preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const q = (btn as HTMLElement).dataset.q || "";
      if (site.searchUrl && openUrl) {
        openUrl(fillSearch(site.searchUrl, q));
      } else if (openUrl) {
        // 没有 searchUrl（如分类索引站），直接打开站点首页
        openUrl(site.url);
      }
    });
  });

  // ⭐ 收藏点击（阻止冒泡，不触发详情浮层）
  searchResults.querySelectorAll(".cr-star-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const name = (btn as HTMLElement).dataset.star || "";
      const now = toggleFav(name);
      btn.textContent = now ? "⭐" : "☆";
      const card = btn.closest(".gh-card");
      if (card) {
        // 重新排序：收藏→移到首部，取消→移到尾部（不 remove 以免丢失事件）
        const grid2 = card.closest(".cr-creator-grid");
        if (now) {
          grid2?.insertBefore(card, grid2.firstChild);
        } else {
          grid2?.appendChild(card);
        }
      }
      busRef.emit("toast:show", {
        msg: now ? t("content.favAddedName", { name }) : t("content.favRemovedName", { name }),
        duration: 1500,
        type: "success",
      });
    });
  });

  // 🔍 搜索快捷按钮（阻止冒泡，不触发详情浮层）——联网搜索创作者
  searchResults.querySelectorAll(".cr-card-search").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const name = (btn as HTMLElement).dataset.searchCreator || "";
      if (site.searchUrl && openUrl) {
        openUrl(fillSearch(site.searchUrl, name));
      } else if (openUrl) {
        // 无 searchUrl（如分类索引站）→ 直接打开站点首页
        openUrl(site.url);
      }
    });
  });

  // 📁 本地模型徽章（阻止冒泡，不触发详情浮层）——直达仓库页搜索该创作者
  searchResults.querySelectorAll(".cr-card-local-jump").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const name = (el as HTMLElement).dataset.localCreator || "";
      busRef.emit("repo:search-creator", name);
    });
  });

  // 头像调试点击 → 控制台输出调试信息
  searchResults.querySelectorAll("[data-debug-avatar]").forEach((img) => {
    img.addEventListener("click", async (e) => {
      e.stopPropagation();
      const name = (img as HTMLElement).dataset.debugAvatar;
      if (!name) return;
      try {
        const { DebugExtractCreatorAvatar } = await getApp();
        const info = await DebugExtractCreatorAvatar(name);
        dbg("avatar-debug", name, info);
      } catch (err) {
        dbg("avatar-debug", "调用失败", err);
      }
    });
  });

  // 创作者卡片点击 → 弹出详情浮层
  searchResults.querySelectorAll(".gh-card[data-name]").forEach((card) => {
    card.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (
        target.closest(".cr-star-btn") ||
        target.closest(".cr-card-search") ||
        target.closest(".cr-card-local-jump")
      )
        return;
      const name = (card as HTMLElement).dataset.name;
      const cr = creators.find((c) => c.name === name);
      if (!cr) return;

      const overlay = document.createElement("div");
      overlay.className = "cr-detail-overlay";
      overlay.onclick = (ev) => {
        if (ev.target === overlay) overlay.remove();
      };

      const identity = getCreatorIdentity(cr as CreatorIdentityInput);
      const descTags = parseDescTags(cr.desc);
      const isFav = isFaved(cr.name);
      const localCount = authorCountMap[cr.name] || 0;
      const detailFallbackChar = esc(cr.name.charAt(0)).toUpperCase();
      const detailFallbackDiv = '<div class="cr-avatar cr-detail-avatar-text">' + detailFallbackChar + "</div>";
      overlay.innerHTML =
        '<div class="cr-detail-box">' +
        '<div class="cr-detail-header">' +
        '<div class="cr-avatar-container cr-detail-avatar-container">' +
        (avatarCache && avatarCache[cr.name]
          ? '<img class="cr-avatar cr-detail-avatar-img" src="' +
            esc(avatarCache[cr.name]) +
            '" data-debug-avatar="' +
            esc(cr.name) +
            '" onerror="this.outerHTML=\'' + detailFallbackDiv.replace(/"/g, '&quot;') + '\'">'
          : detailFallbackDiv) +
        "</div>" +
        '<div class="cr-detail-fill">' +
        '<div class="cr-detail-name-row">' +
        '<span class="cr-detail-name">' +
        esc(cr.name) +
        "</span>" +
        (cr.role
          ? '<span class="cr-tag cr-tag-' +
            esc(getTagFromRole(cr.role)) +
            '">' +
            getTagIconFromRole(cr.role) +
            " <span>" +
            esc(getTagFromRole(cr.role)) +
            "</span>" +
            "</span>"
          : "") +
        "</div>" +
        (cr.type
          ? '<div class="cr-detail-platforms">' +
            cr.type
              .split(";")
              .filter(Boolean)
              .map(
                (platform: string) =>
                  '<span class="cr-platform-badge">' +
                  getSiteIcon(platform) +
                  " <span>" +
                  esc(platform) +
                  "</span>",
              )
              .join("") +
            "</div>"
          : "") +
        '<div class="cr-detail-identity">' +
        identity.icon +
        '<span>' + esc(identity.label) + "</span>" +
        "</div>" +
        "</div>" +
        '<span class="cr-star-btn" data-star="' +
        esc(cr.name) +
        '">' +
        (isFav ? "⭐" : "☆") +
        "</span>" +
        "</div>" +
        '<div class="cr-detail-desc">' +
        descTags
          .map(
            (tag) =>
              '<span class="cr-desc-tag">#' +
              esc(tag) +
              "</span>",
          )
          .join("") +
        (!descTags.length ? esc(cr.desc) : "") +
        "</div>" +
        '<div class="cr-detail-row cr-local-card">' +
        '<span class="cr-local-icon">📂</span>' +
        '<span class="cr-local-text">' + t("content.downloadedModels", { n: localCount }) + "</span>" +
        '<button class="cr-local-btn" data-local>' + t("content.viewArrow") + "</button>" +
        "</div>" +
        '<div class="cr-detail-actions">' +
        '<button class="secondary" data-search="' +
        esc(cr.name) +
        '">' + t("content.searchMoreModels") + "</button>" +
        '<button class="secondary" data-close>' + t("common.close") + "</button>" +
        "</div>" +
        "</div>";

      (searchResults.getRootNode() as Node).appendChild(overlay);

      // ⭐ 浮层内的收藏
      overlay.querySelector("[data-star]")?.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const now = toggleFav(cr.name);
        (ev.target as HTMLElement).textContent = now ? "⭐" : "☆";
        // 同时更新卡片
        // P3 修复（子代理审计）：esc 是 HTML 工具，DOM 里 data-star 属性值是原始
        // cr.name（esc 把 " 转 &quot; 查不到、\ 也会失配）——改用 CSS.escape 构造
        // 属性选择器（download-queue.ts:329 已有先例）
        const cardStar = searchResults.querySelector(
          '.cr-star-btn[data-star="' + CSS.escape(cr.name) + '"]',
        );
        if (cardStar) cardStar.textContent = now ? "⭐" : "☆";
        busRef.emit("toast:show", {
          msg: now ? t("content.favAdded") : t("content.favRemoved"),
          duration: 1500,
          type: "success",
        });
      });

      overlay
        .querySelector("[data-close]")
        ?.addEventListener("click", () => overlay.remove());

      const searchBtn = overlay.querySelector("[data-search]") as HTMLElement | null;
      if (searchBtn) {
        searchBtn.addEventListener("click", () => {
          overlay.remove();
          if (site.searchUrl && openUrl) {
            openUrl(fillSearch(site.searchUrl, searchBtn.dataset.search || ""));
          }
        });
      }

      // 📦 查看本地模型
      const localBtn = overlay.querySelector("[data-local]");
      if (localBtn) {
        localBtn.addEventListener("click", () => {
          overlay.remove();
          busRef.emit("repo:search-creator", cr.name);
        });
      }
    });
  });

  // 键盘导航 ←↑↓→
  const crGrid = searchResults.querySelector(".cr-creator-grid");
  if (crGrid) {
    crGrid.addEventListener("keydown", ((e: KeyboardEvent) => {
      const cards = [...crGrid.querySelectorAll(".gh-card[tabindex]")];
      const cur = document.activeElement as HTMLElement | null;
      const idx = cards.indexOf(cur as Element);
      if (idx < 0) return;
      if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault();
        const next = (cards[idx + 1] || cards[0]) as HTMLElement;
        next.focus();
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        const prev = (cards[idx - 1] || cards[cards.length - 1]) as HTMLElement;
        prev.focus();
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        cur?.click();
      }
    }) as EventListener);
  }

  // storage 事件：多标签页收藏同步（模块私有变量，不挂 window）
  if (_storageSyncFn) {
    window.removeEventListener("storage", _storageSyncFn);
  }
  _storageSyncFn = (e) => {
    if (e.key === "ysm-fav-creators") {
      const favs = loadFavs();
      searchResults.querySelectorAll(".cr-star-btn").forEach((btn) => {
        btn.textContent = favs.includes((btn as HTMLElement).dataset.star || "") ? "⭐" : "☆";
      });
    }
  };
  window.addEventListener("storage", _storageSyncFn);

  // cleanup：移除 storage 监听
  return () => {
    disposed = true; // P3：阻断在途 await 续体（代际守卫，问题 B）
    if (_storageSyncFn) {
      window.removeEventListener("storage", _storageSyncFn);
      _storageSyncFn = null;
    }
  };
}
