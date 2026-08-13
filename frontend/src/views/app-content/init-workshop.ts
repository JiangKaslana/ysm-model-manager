// ===== 创意工坊页初始化（为 app-content/index.ts 减负，ADR-040）=====
import { bus } from "../../bus.ts";
import { getApp } from "../../backend/app.ts";
import { resolveWebMode } from "../../backend/platform.ts";
import { safeGet, safeSet } from "../../utils/dom/storage.ts";
import { Events } from "@wailsio/runtime";
import { dbg } from "../../utils/debug/debug.ts";
import { esc as escUtil } from "../../utils/dom/html.ts";
import { stagger } from "../../utils/animation/stagger.ts";
import { RESOURCE_TYPES, RESOURCE_TYPE_LABELS } from "../../utils/resource/types.ts";
import { getSiteIcon } from "../../utils/icon/workshop-icons.ts";
import { loadCommunityData, fillSearch, type LocalCreator } from "./community-data.ts";
import { renderSiteView, type RenderSiteViewCtx, type RepoAuthorLike } from "./site-view.ts";
import { countMissing, renderRepoHeaderHTML } from "../../features/community/render.ts";
import { bindRepoEvents } from "../../features/community/events.ts";
import { tryFetchModels } from "../../features/community/data.ts";
import { friendlyError } from "../../utils/dom/errors.ts";
import { t } from "../../core/i18n/t.ts";
import type { WorkshopModel } from "../../features/community/render.ts";
import type { WorkshopSite } from "../../../bindings/ysm-model-manager/go/types/models.ts";

/** app-content 组件完整接口（供 workshop/github 初始化函数访问） */
export interface AppContentHost {
  _root: ShadowRoot;
  _esc(s: unknown): string;
  _unsubs: Array<() => void>;
  _globalUnsubs: Array<() => void>;
  _repoEventsCleanup: (() => Promise<void>) | null;
  _setRepoEventsCleanup(fn: (() => Promise<void>) | null): void;
  _currentSite: WorkshopSite | null;
  _setCurrentSite(site: WorkshopSite | null): void;
  _avatarCache: Record<string, string>;
  _setAvatarCache(cache: Record<string, string>): void;
  _workshopCache: Map<string, { models: WorkshopModel[]; source: string; localMap?: Map<string, string> }> | null;
  _setWorkshopCache(cache: Map<string, { models: WorkshopModel[]; source: string; localMap?: Map<string, string> }>): void;
  _githubCache: Map<string, { models: WorkshopModel[]; source: string; localMap?: Map<string, string> }> | null;
  _setGithubCache(cache: Map<string, { models: WorkshopModel[]; source: string; localMap?: Map<string, string> }>): void;
  _workshopTimer: ReturnType<typeof setTimeout> | null;
  _setWorkshopTimer(timer: ReturnType<typeof setTimeout> | null): void;
  _avatarRefreshRegistered: boolean;
  _setAvatarRefreshRegistered(v: boolean): void;
}

/**
 * 初始化创意工坊页
 */
export function initWorkshopPage(host: AppContentHost): void {
  const root = host._root;
  const browserEl = root.getElementById("ws-browser") as HTMLElement | null;
  const iframe = root.getElementById("ws-iframe") as HTMLIFrameElement | null;
  const urlEl = root.getElementById("ws-url") as HTMLElement | null;
  const blockedEl = root.getElementById("ws-blocked") as HTMLElement | null;
  const searchResults = root.getElementById("ws-search-results") as HTMLElement | null;
  const creatorView = root.getElementById("ws-creator-view") as HTMLElement | null;
  const creatorList = root.getElementById("ws-cr-list") as HTMLElement | null;
  const creatorTitle = root.getElementById("ws-cr-title") as HTMLElement | null;
  host._setCurrentSite(null);
  let allSites: WorkshopSite[] = [];
  let allCreators: LocalCreator[] = [];
  let repoAuthors: RepoAuthorLike[] = [];
  // 创意工坊创作者编辑模式（放在外面以持久化）
  const wsEditModeRef = { v: false }; // 可共享引用，供 renderSiteView 读写
  if (!host._workshopCache) host._setWorkshopCache(new Map());
  const repoModelCache = host._workshopCache;

  // 点击模式切换：外链 / 内嵌 / 窗口（localStorage 持久化，按钮在 renderSiteView 中动态渲染）
  type BrowseMode = 'external' | 'embed' | 'window';
  const loadMode = (): BrowseMode => {
    const v = safeGet("ysm-browse-mode");
    if (v === "embed" || v === "window") return v;
    // 兼容旧 boolean 存储
    if (safeGet("ysm-embed-mode") === "1") return "embed";
    return "external";
  };
  let browseMode: BrowseMode = loadMode();

  // B站/爱发电 tab 点击 → 在右侧显示对应站点的创作者（不打开网站）
  const showCreatorsBySite = async (siteType: string): Promise<void> => {
    try {
      const { sites, creators, authors } = await loadCommunityData();
      allSites = sites;
      allCreators = creators;
      repoAuthors = (authors || []) as RepoAuthorLike[];
      const site = sites.find((s) => s.id === siteType);
      if (!site) return;
      host._setCurrentSite(site);
      safeSet("ysm-ws-last-tab", site.id);
      // tab 切换高亮
      root
        .querySelectorAll(".repo-tab")
        .forEach((t) => t.classList.remove("active"));
      root.querySelector(`[data-tab="${siteType}"]`)?.classList.add("active");
      showSiteView(host._currentSite);
    } catch (e) {
      // P2 修复（审核）：async handler 最外层 catch 出口（ADR-044 ①）——
      // loadCommunityData/showSiteView 抛错原逸出为 unhandled rejection
      bus.emit("toast:show", {
        msg: "❌ " + friendlyError(e, "加载社区数据失败"),
        duration: 3000,
        type: "error",
      });
    }
  };
  // 默认显示第一个站点
  host._setWorkshopTimer(setTimeout(async () => {
    const { sites } = await loadCommunityData();
    allSites = sites;
    // 动态生成 Tab
    const tabsEl = root.getElementById("ws-tabs");
    if (tabsEl && sites.length) {
      tabsEl.innerHTML = "";
      sites.forEach((s, i) => {
        const btn = document.createElement("button");
        btn.className = "repo-tab" + (i === 0 ? " active" : "");
        btn.dataset.tab = s.id;
        btn.innerHTML = getSiteIcon(s.id) + " " + escUtil(s.label);
        btn.addEventListener("click", () => showCreatorsBySite(s.id));
        tabsEl.appendChild(btn);
      });
      // 默认显示第一个
      if (sites[0]) {
        // 恢复上次选中的 tab
        const last = safeGet("ysm-ws-last-tab") || sites[0].id;
        const target = sites.find((s) => s.id === last) || sites[0];
        showCreatorsBySite(target.id);
      }
    } else if (tabsEl) {
      // 空态提示（e2e 反推）：原实现 sites 为空时永久停留 loading 占位，
      // 加载失败/无配置用户无感知——显示「暂无数据」并允许手动导入站点配置
      tabsEl.innerHTML =
        '<span style="padding:4px 12px;font-size:var(--fs-sm);color:var(--muted)">' +
        t("common.empty") +
        " 📤 " +
        t("workshop.exportSite") +
        "</span>";
    }
  }, 100));

  // 后台批量提取创作者头像（仅首次完成后刷新）
  host._setAvatarCache({});
  const extractAvatars = async (): Promise<void> => {
    try {
      const { BatchExtractCreatorAvatars } =
        await getApp();
      const result = await BatchExtractCreatorAvatars();
      const avatars = (result || {}) as Record<string, string>;
      const keys = Object.keys(avatars);
      if (keys.length > 0) {
        dbg("avatar", "提取了 " + keys.length + " 个头像: " + keys.join(", "));
        host._setAvatarCache(avatars);
        if (host._currentSite) showSiteView(host._currentSite);
      } else {
        dbg("avatar", "无头像可提取（无 .ysm 文件或无 avatar/ 目录）");
      }
    } catch (e) {
      dbg("avatar", "提取失败:", (e as Error)?.message);
    }
  };
  extractAvatars();

  // 配置加载完成后重新提取（覆盖用户在创意工坊内改仓库路径的场景）
  if (!(_avatarConfigLoadedRegistered)) {
    _avatarConfigLoadedRegistered = true;
    _avatarConfigLoadedUnsub = Events.On("config-loaded", () => {
      dbg("avatar", "配置已加载，重新提取头像");
      extractAvatars();
    });
  }

  // 卡片点击 → 正文切换右侧视图，右侧 ↗ 按开关打开
  const openSite = (site: WorkshopSite | null, external = false): void => {
    if (!site) return;
    if (browseMode === "embed") {
      openEmbedded(site);
    } else if (browseMode === "window") {
      // 窗口模式直连（独立 WebView2 窗口，非 iframe，无需反代绕 X-Frame-Options）
      getApp().then(({ NavigatePlazaWindow }) =>
        NavigatePlazaWindow(site.url, true),
      ).catch(() => {});
    } else {
      getApp().then(({ OpenInBrowser }) =>
        OpenInBrowser(site.url),
      ).catch(() => {});
    }
  };

  // 内嵌浏览：直连官网（参考 MikuMikuAR——本地反代拦截内嵌下载过于复杂，
  // 最终放弃代理改直连）。被 X-Frame-Options/CSP frame-ancestors 拦截的站点
  // iframe 会显示空白，由 URL 栏常驻的「↗ 浏览器打开」按钮兜底；
  // 加载超时（网络/站点拒绝）15s 后显示 noEmbed 提示。
  // [ADR-077] ws-iframe sandbox 已含 allow-same-origin（tpl.ts），勿删：
  // 缺它 iframe origin 变 opaque null，登录站 SPA 的 fetch/XHR 被 CORS 拦死。
  let wsLoadTimer: number | undefined;
  const openEmbedded = (site: WorkshopSite): void => {
    if (urlEl) urlEl.textContent = site.url;
    if (blockedEl) blockedEl.style.display = "none";
    if (browserEl) browserEl.style.display = "flex";
    if (iframe) {
      iframe.style.display = "";
      iframe.src = site.url;
      // 加载超时兜底：15s 未完成加载 → 提示「此站点不允许内嵌浏览」+ 外链打开
      window.clearTimeout(wsLoadTimer);
      wsLoadTimer = window.setTimeout(() => {
        if (blockedEl) blockedEl.style.display = "flex";
      }, 15000);
      iframe.onload = () => window.clearTimeout(wsLoadTimer);
    }
  };

  root.getElementById("ws-back")?.addEventListener("click", () => {
    if (iframe) iframe.src = "";
    if (browserEl) browserEl.style.display = "none";
    window.clearTimeout(wsLoadTimer);
  });
  const openCurrent = (): void => {
    const cs = host._currentSite;
    if (cs) {
      getApp().then(({ OpenInBrowser }) =>
        OpenInBrowser(cs.url),
      ).catch(() => {});
    }
  };
  root.getElementById("ws-open")?.addEventListener("click", openCurrent);
  root
    .getElementById("ws-open-fallback")
    ?.addEventListener("click", openCurrent);

  // 🖥️ 窗口模式：在预热 WebView2 窗口中直连打开（ADR-050）
  root.getElementById("ws-win-open")?.addEventListener("click", () => {
    const cs = host._currentSite;
    if (cs) {
      getApp().then(({ NavigatePlazaWindow }) =>
        NavigatePlazaWindow(cs.url, true),
      ).catch(() => {});
    }
  });

  // 站点导出/导入
  root
    .getElementById("ws-export-btn")
    ?.addEventListener("click", async () => {
      // 网页版（ADR-049）：无本地文件系统，站点配置导出/导入不可用
      if (resolveWebMode()) {
        bus.emit("toast:show", {
          msg: "网页版暂不支持导出站点配置，请使用桌面版",
          duration: 3000,
          type: "warn",
        });
        return;
      }
      try {
        const { ExportWorkshopSitesJSONFile } =
          await getApp();
        const path = await ExportWorkshopSitesJSONFile();
        bus.emit("toast:show", {
          msg: "📤 站点已导出: " + path,
          duration: 2000,
          type: "success",
        });
      } catch (e) {
        bus.emit("toast:show", {
          msg: "❌ " + friendlyError(e, "导出失败"),
          duration: 4000,
          type: "error",
        });
      }
    });
  root
    .getElementById("ws-import-btn")
    ?.addEventListener("click", async () => {
      // 网页版（ADR-049）：无本地文件系统，站点配置导出/导入不可用
      if (resolveWebMode()) {
        bus.emit("toast:show", {
          msg: "网页版暂不支持导入站点配置，请使用桌面版",
          duration: 3000,
          type: "warn",
        });
        return;
      }
      try {
        const { ValidateWorkshopSites } =
          await getApp();
        const n = await ValidateWorkshopSites();
        await showCreatorsBySite("bilibili");
        bus.emit("toast:show", {
          msg: "✅ 已导入 " + n + " 个站点",
          duration: 2000,
          type: "success",
        });
      } catch (e) {
        bus.emit("toast:show", {
          msg: "❌ " + friendlyError(e, t("content.importFailed")),
          duration: 4000,
          type: "error",
        });
      }
    });

  // ===== 右栏：JSON驱动的站点视图 =====
  // 保存站点视图的 cleanup 函数，用于在重新渲染前清理 storage 等监听
  let siteViewCleanup: (() => void) | null = null;
  const showSiteView = (site: WorkshopSite | null): void => {
    if (!site) return;
    // 先清理上一次的监听，防止 storage 事件监听泄漏
    if (siteViewCleanup) {
      siteViewCleanup();
      siteViewCleanup = null;
    }
    const openUrl = (url: string): void => {
      if (browseMode === "embed") {
        host._setCurrentSite({ url } as unknown as WorkshopSite);
        openEmbedded(host._currentSite!);
      } else if (browseMode === "window") {
        // 窗口模式直连
        getApp().then(({ NavigatePlazaWindow }) =>
          NavigatePlazaWindow(url, true),
        ).catch(() => {});
      } else {
        // 外链模式：走系统浏览器，共享用户登录态
        getApp().then(({ OpenInBrowser }) =>
          OpenInBrowser(url),
        ).catch(() => {});
      }
    };
    const ctx: RenderSiteViewCtx = {
      esc: (s) => host._esc(s),
      searchResults: searchResults as HTMLElement,
      creatorView: creatorView as HTMLElement,
      allSites,
      allCreators,
      repoAuthors,
      wsEditModeRef,
      showRepoModels: async (repo, models, source) => {
        await showRepoModels(repo, models as WorkshopModel[], source);
      },
      fillSearch,
      repoModelCache: repoModelCache!,
      openUrl,
      avatarCache: host._avatarCache,
      browseMode,
      activeTag: safeGet("ysm-ws-active-tag") || "",
      searchKw: safeGet("ysm-ws-search-kw") || "",
      backToSite: () => {
        if (host._currentSite) showSiteView(host._currentSite);
      },
    };
    siteViewCleanup = renderSiteView(site, ctx);
    // 外链/内嵌/窗口切换（按钮在 renderSiteView 中动态渲染）
    const toggleBtn = searchResults?.querySelector("#cr-mode-toggle") as HTMLElement | null;
    if (toggleBtn) {
      const cycleMode = (current: BrowseMode): BrowseMode => {
        const modes: BrowseMode[] = ["external", "embed", "window"];
        return modes[(modes.indexOf(current) + 1) % modes.length];
      };
      toggleBtn.onclick = (e) => {
        const target = e.target as HTMLElement;
        const modes: BrowseMode[] = ["external", "embed", "window"];
        let newMode: BrowseMode;
        if (target.classList.contains("cr-mode-opt")) {
          newMode = target.classList.contains("cr-mode-ext") ? "external"
            : target.classList.contains("cr-mode-emb") ? "embed" : "window";
        } else {
          // 点击按钮本身 → 循环到下一个模式
          newMode = cycleMode(browseMode);
        }
        browseMode = newMode;
        safeSet("ysm-browse-mode", browseMode);
        // 兼容旧 key
        safeSet("ysm-embed-mode", browseMode === "embed" ? "1" : "0");
        // 更新 UI active 状态
        toggleBtn.querySelectorAll(".cr-mode-opt").forEach((el) => {
          el.classList.toggle("active",
            (el.classList.contains("cr-mode-ext") && browseMode === "external") ||
            (el.classList.contains("cr-mode-emb") && browseMode === "embed") ||
            (el.classList.contains("cr-mode-win") && browseMode === "window"));
        });
      };
    }
  };

  // 下载完成后增量刷新创作者头像
  if (!host._avatarRefreshRegistered) {
    host._setAvatarRefreshRegistered(true);
    host._globalUnsubs.push(
      bus.on("avatar:refresh", ({ author, dataUri }) => {
        if (host._avatarCache[author] === dataUri) return;
        host._avatarCache[author] = dataUri;
        // 单卡片定点更新，避免整页重渲染
        let found = false;
        root.querySelectorAll(".cr-creator-card").forEach((c) => {
          if ((c as HTMLElement).dataset.name === author) {
            const img = c.querySelector(".cr-avatar") as HTMLImageElement | null;
            if (img && img.tagName === "IMG") img.src = dataUri;
            found = true;
          }
        });
        if (!found && host._currentSite) showSiteView(host._currentSite);
      }),
    );
  }

  // 📦 显示 GitHub 仓库模型列表（比对本地已有文件）
  // _currentRepo 检测过时的异步响应（与 _initGithub 的 showRepo 同模式，防快速切换乱序覆盖）
  let _currentRepo = "";
  const showRepoModels = async (
    repo: string,
    models: WorkshopModel[],
    source: string,
  ): Promise<void> => {
    _currentRepo = repo;
    // 加载本地仓库已有文件列表 + 镜像配置
    const localMap = new Map<string, string>();
    let mirror = "";
    try {
      const AppM = await getApp();
      const cfg = await AppM.LoadAppConfig();
      mirror = cfg.mirror || "";
      const filesRoot = AppM.GetRepoRoot ? await AppM.GetRepoRoot(RESOURCE_TYPES.YSM) : "";
      if (filesRoot) {
        if (AppM.ClearScanCache) await AppM.ClearScanCache();
        const entries = (await AppM.ScanModelEntriesWithLabel(filesRoot, RESOURCE_TYPE_LABELS[RESOURCE_TYPES.YSM])) || [];
        entries.forEach((e) => {
          let n = e.Name || "";
          if (n.endsWith(".ban")) n = n.slice(0, -4);
          localMap.set(n, e.Hash || "");
        });
      }
    } catch (_) {
      // 加载失败不影响列表显示
    }
    if (_currentRepo !== repo) return; // 已切换仓库，丢弃过期结果

    // 下载 URL 统一用 raw 前缀：Go 端 downloadFileWithQueue 按 LoadAppConfig().Mirror
    // 重排 raw/jsd/api 顺序（jsdelivr 直通会令 ResolveSavePath 解析失败、回退失效、子目录被扁平化）
    const dlPrefix =
      "https://raw.githubusercontent.com/" + repo + "/main/";

    const sourceLabel =
      (source === "raw"
        ? '<span class="link-badge link-badge-raw">raw</span>'
        : source === "jsd"
          ? '<span class="link-badge link-badge-jsd">⚡jsd</span>'
          : source === "api"
            ? '<span class="link-badge link-badge-api">API</span>'
            : "") +
      (mirror === "jsdelivr"
        ? '<span class="link-badge link-badge-cdn">⚡CDN</span>'
        : mirror === "githubapi"
          ? '<span class="link-badge link-badge-ghapi">🐙API</span>'
          : "");

    const missingCount = countMissing(models, localMap);

    if (_currentRepo !== repo) return; // 已切换，丢弃
    if (searchResults) {
      searchResults.innerHTML = renderRepoHeaderHTML({
        esc: (s) => host._esc(s),
        repo,
        sourceLabel,
        modelsLength: models.length,
        missingCount,
      });
    }

    // 清理前一次绑定
    if (host._repoEventsCleanup) await host._repoEventsCleanup();
    if (_currentRepo !== repo) return; // 清理期间已切换，丢弃

    // 委托 bindRepoEvents 管理所有事件 + 内部状态 (showAll/selectedSet/renderList)
    if (searchResults) {
      const { renderList, cleanup } = bindRepoEvents(searchResults, {
        esc: (s) => host._esc(s),
        models,
        dlPrefix,
        repo,
        source,
        showRepoModels: () => showRepoModels(repo, models, source),
        backToSite: () => {
          if (host._currentSite) showSiteView(host._currentSite);
        },
        localMap,
      });
      host._setRepoEventsCleanup(cleanup);

      // 初始渲染
      const listContainer = searchResults.querySelector("#gh-repo-list");
      if (listContainer) listContainer.appendChild(renderList());
    }
  }; // end showRepoModels
}

/** 防止 avatar:config-loaded 事件重复注册（模块级状态，与 index.ts 共享） */
let _avatarConfigLoadedRegistered = false;
let _avatarConfigLoadedUnsub: (() => void) | null = null;
