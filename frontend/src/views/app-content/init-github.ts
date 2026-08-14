// ===== GitHub 页初始化（为 app-content/index.ts 减负，ADR-040）=====
import { getApp } from "../../backend/app.ts";
import { safeGet } from "../../utils/dom/storage.ts";
import { dbg } from "../../utils/debug/debug.ts";
import { stagger } from "../../utils/animation/stagger.ts";
import { RESOURCE_TYPES, RESOURCE_TYPE_LABELS } from "../../utils/resource/types.ts";
import { countMissing, renderRepoHeaderHTML } from "../../features/community/render.ts";
import { bindRepoEvents } from "../../features/community/events.ts";
import { tryFetchModels } from "../../features/community/data.ts";
import { friendlyError } from "../../utils/dom/errors.ts";
import { t } from "../../core/i18n/t.ts";
import { esc as escUtil } from "../../utils/dom/html.ts";
import type { WorkshopModel } from "../../features/community/render.ts";

/** app-content 组件接口（供 github 初始化函数访问） */
export interface AppContentHost {
  _root: ShadowRoot;
  _esc(s: unknown): string;
  _unsubs: Array<() => void>;
  _globalUnsubs: Array<() => void>;
  _repoEventsCleanup: (() => Promise<void>) | null;
  _setRepoEventsCleanup(fn: (() => Promise<void>) | null): void;
  _githubCache: Map<string, { models: WorkshopModel[]; source: string; localMap?: Map<string, string> }> | null;
  _setGithubCache(cache: Map<string, { models: WorkshopModel[]; source: string; localMap?: Map<string, string> }>): void;
}

/**
 * 初始化 GitHub 页
 */
export function initGithubPage(host: AppContentHost): void {
  const root = host._root;
  const grid = root.getElementById("gh-grid") as HTMLElement | null;
  const resultsBody = root.getElementById("gh-results-body") as HTMLElement | null;
  const sourceInfo = root.getElementById("gh-source-info") as HTMLElement | null;
  if (!host._githubCache) host._setGithubCache(new Map());
  const repoModelCache = host._githubCache!;

  const loadRepos = async (): Promise<void> => {
    if (grid) {
      grid.innerHTML =
        '<div style="padding:24px;text-align:center;color:var(--muted);font-size:11px">' + t("downloads.loading") + "</div>";
    }
    try {
      const App = await getApp();
      const repos = await App.LoadGitHubRepos();
      const ghCreators = repos || [];
      if (sourceInfo)
        sourceInfo.textContent = t("downloads.repoCountDesc", { n: ghCreators.length });
      if (!ghCreators.length) {
        if (grid) {
          grid.innerHTML =
            '<div style="padding:24px;text-align:center;color:var(--muted);font-size:10px">' +
            t("downloads.noRepos") +
            "</div>";
        }
        return;
      }
      if (grid) {
        grid.innerHTML = ghCreators
          .map(
            (cr, idx) =>
              '<div class="gh-card gh-repo-card" style="animation-delay:' + stagger(idx, 30, 300) + 'ms" data-index="' +
              idx +
              '" data-repo="' +
              host._esc(cr.name) +
              '">' +
              '<div class="gh-card-body">' +
              '<div class="ws-name" style="font-size:11px">🐙 ' +
              host._esc(cr.name) +
              "</div>" +
              '<div class="ws-desc" style="font-size:9px">' +
              host._esc(cr.desc) +
              "</div>" +
              "</div></div>",
          )
          .join("");
        // 点击仓库
        grid.querySelectorAll(".gh-repo-card").forEach((card) => {
          card.addEventListener("click", () => {
            grid
              .querySelectorAll(".gh-card")
              .forEach((c) => c.classList.remove("active"));
            card.classList.add("active");
            const repo = (card as HTMLElement).dataset.repo || "";
            showRepo(repo);
          });
        });
      }
    } catch (e) {
      if (grid) {
        grid.innerHTML =
          '<div style="padding:24px;text-align:center;color:var(--muted);font-size:10px">' +
          t("common.loadFailed") +
          "</div>";
      }
    }
  };

  // _currentRepo 用于检测过时的异步响应（竞态防护）
  let _currentRepo = "";

  const showRepo = async (repo: string): Promise<void> => {
    _currentRepo = repo;
    if (resultsBody) {
      resultsBody.innerHTML =
        '<div style="padding:24px;text-align:center;color:var(--muted);font-size:11px">' +
        t("downloads.loadingModels") +
        "</div>";
    }
    // 使用缓存
    if (repoModelCache.has(repo)) {
      const cached = repoModelCache.get(repo);
      if (cached) {
        const { models, source, localMap } = cached;
        if (_currentRepo !== repo) return; // 已切换，丢弃
        renderModels(repo, models, source, localMap || new Map());
        return;
      }
    }
    let mirror = "";
    try {
      const { LoadAppConfig, ScanModelEntriesWithLabel, GetRepoRoot } =
        await getApp();
      const cfg = await LoadAppConfig();
      mirror = cfg.mirror || "";
      const filesRoot = await GetRepoRoot(RESOURCE_TYPES.YSM);
      const localMap = new Map<string, string>();
      if (filesRoot) {
        const entries = (await ScanModelEntriesWithLabel(filesRoot, RESOURCE_TYPE_LABELS[RESOURCE_TYPES.YSM])) || [];
        entries.forEach((e) => {
          let n = e.Name || "";
          if (n.endsWith(".ban")) n = n.slice(0, -4);
          localMap.set(n, e.Hash || "");
        });
      }
      let fetchDone = false;
      const result = await tryFetchModels(repo, (mirror || "") as "" | "jsdelivr" | "githubapi", (pct, label) => {
        if (fetchDone || _currentRepo !== repo) return;
        if (resultsBody) {
          resultsBody.innerHTML =
            '<div style="padding:24px;text-align:center;color:var(--muted);font-size:11px">' +
            (label || t("common.loading")) +
            "</div>";
        }
      });
      fetchDone = true;
      if (result && result.models) {
        repoModelCache.set(repo, {
          models: result.models as WorkshopModel[],
          source: result.source,
          localMap,
        });
        if (_currentRepo !== repo) return;
        renderModels(repo, result.models as WorkshopModel[], result.source, localMap);
      } else {
        if (_currentRepo !== repo) return;
        if (resultsBody) {
          resultsBody.innerHTML =
            '<div style="padding:24px;text-align:center;color:var(--muted);font-size:11px">❌ ' +
            t("downloads.noModelList") +
            "</div>" +
            '<div style="text-align:center;padding:8px"><button class="btn-base sm ws-btn-txt" id="gh-open-repo-dl">↗ ' +
            t("downloads.openInGithub") +
            "</button></div>";
        }
      }
    } catch (e) {
      const err = e as Error;
      if (_currentRepo !== repo) return;
      const msg =
        err.message === "NetworkOffline"
          ? "🌐 无网络连接，请检查网络后重试"
          : err.message === "NoIndex"
            ? "📭 该仓库没有 index.json（尚未建立创意工坊索引）"
            : err.message === "RateLimited"
              ? "⏱️ GitHub API 频率限制，请稍后重试或改用浏览器打开"
              : "❌ 加载失败，请检查网络或稍后重试";
      if (resultsBody) {
        resultsBody.innerHTML =
          '<div style="padding:24px;text-align:center;color:var(--muted);font-size:11px">❌ ' +
          host._esc(msg) +
          "</div>" +
          '<div style="text-align:center;padding:8px"><button class="btn-base sm ws-btn-txt" id="gh-open-repo">↗ ' +
          t("downloads.openInGithub") +
          "</button></div>";
      }
    }
    // 绑定打开 GitHub 按钮
    const openBtn = resultsBody?.querySelector("#gh-open-repo, #gh-open-repo-dl");
    if (openBtn)
      openBtn.addEventListener("click", () => {
        getApp().then(({ OpenInBrowser }) =>
          OpenInBrowser("https://github.com/" + repo),
        ).catch(() => {});
      });
  };

  const renderModels = async (
    repo: string,
    models: WorkshopModel[],
    source: string,
    localMap: Map<string, string>,
  ): Promise<void> => {
    // 同上：下载 URL 统一 raw，镜像优先级由 Go 端 mirror 配置统一重排
    const dlPrefix =
      "https://raw.githubusercontent.com/" + repo + "/main/";
    const sourceLabel =
      source === "raw"
        ? '<span class="link-badge link-badge-raw">raw</span>'
        : source === "jsd"
          ? '<span class="link-badge link-badge-jsd">⚡jsd</span>'
          : source === "api"
            ? '<span class="link-badge link-badge-api">API</span>'
            : "";
    const missingCount = countMissing(models, localMap);
    if (resultsBody) {
      resultsBody.innerHTML = renderRepoHeaderHTML({
        esc: (s) => host._esc(s),
        repo,
        sourceLabel,
        modelsLength: models.length,
        missingCount,
      });
      // 清理前一次绑定
      if (host._repoEventsCleanup) {
        try {
          await host._repoEventsCleanup();
        } catch (e) {
          // 与 init-workshop 同模式（c7cd6363 漏修此处）：cleanup（含 queue.cancel）
          // 失败不阻断新仓库绑定——裸 await 会把 reject 逸出成 unhandled rejection
          dbg("repo-events", "清理旧仓库事件失败:", (e as Error)?.message);
        }
      }
      const { renderList, cleanup } = bindRepoEvents(resultsBody, {
        esc: (s) => host._esc(s),
        models,
        dlPrefix,
        repo,
        source,
        showRepoModels: () => showRepo(repo),
        backToSite: () => loadRepos(),
        localMap,
      });
      host._setRepoEventsCleanup(cleanup);
      const listContainer = resultsBody.querySelector("#gh-repo-list");
      if (listContainer) listContainer.appendChild(renderList());
    }
  };

  // 刷新按钮已移除
  loadRepos();
}
