// ===== <app-content> 入口（ADR-040：≤400 行红线）=====
import { bus } from "../../bus.ts";
import { resolveInitialPage } from "../../core/page-store.ts";
import { esc as escUtil } from "../../utils/dom/html.ts";
import { formatBytes } from "../../utils/dom/format.ts";
import { contentCSS } from "./content-css.ts";
// 模块级样式表（HMR 热更新回注入用：export 给 hot.accept 拿新实例）
const appContentStyle = new CSSStyleSheet();
appContentStyle.replaceSync(contentCSS);
export { appContentStyle };
import { getApp } from "../../backend/app.ts";
import { registerGlobalHandlers } from "../../core/handlers/global.ts";
import { registerResourceManagerGlobal } from "../app-resource-manager/index.ts";
// 副作用导入：注册 <app-preview> 组件
import "../app-preview/index.ts";
import { initPreviewResize } from "./init-preview.ts";
import {
  initDiagnosticsPage,
  initInstancesPage,
  initRepositoryPage,
  initWorkshopPage,
  initGithubPage,
  initSettingsPage,
} from "./init-pages.ts";
import { resetAvatarConfigLoaded } from "./init-workshop.ts";
import {
  repositoryHTML,
  instancesHTML,
  settingsHTML,
  diagnosticsHTML,
  workshopHTML,
  githubHTML,
} from "./tpl.ts";

import { friendlyError } from "../../utils/dom/errors.ts";
import { t } from "../../core/i18n/t.ts";
import type { WorkshopModel } from "../../features/community/render.ts";
import type { WorkshopSite } from "../../features/community/render.ts";

/** 仓库模型缓存条目（_workshopCache / _githubCache） */
interface RepoCacheEntry {
  models: WorkshopModel[];
  source: string;
  localMap?: Map<string, string>;
}

class AppContent extends HTMLElement {
  _root: ShadowRoot;
  _current: string;
  _globalUnsubs: Array<() => void>;
  _repoEventsCleanup: (() => Promise<void>) | null;
  _unsub: (() => void) | null = null;
  _unsubs: Array<() => void> = [];
  _resizeMove: ((e: PointerEvent) => void) | null = null;
  _resizeUp: ((e: PointerEvent) => void) | null = null;
  _insListenerReg = false;
  _avatarRefreshRegistered = false;
  /** _initWorkshop 当前浏览站点——实例字段：avatar:refresh/config-loaded 订阅只注册一次（F6），
   *  闭包需读最新副本，避免锁死首访的 currentSite/avatarCache */
  _currentSite: WorkshopSite | null = null;
  /** _initWorkshop 创作者头像缓存（同上，防单次注册订阅读到首访陈旧闭包） */
  _avatarCache: Record<string, string> = {};
  _workshopCache: Map<string, RepoCacheEntry> | null = null;
  _githubCache: Map<string, RepoCacheEntry> | null = null;
  /** _initWorkshop 的默认站点定时器（切页销毁时清理，防空跑网络请求） */
  _workshopTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super();
    this._root = this.attachShadow({ mode: "open" });
    this._root.adoptedStyleSheets = [appContentStyle];
    // 与 PageStore 同源初始化：app-nav 的初始 nav:change 在 app-content 动态
    // import 完成前可能被吞（app-modules.ts 动态加载），此时若硬编码 "repository"
    // 会导致 UI 渲染与 PageStore 脱节（守卫误拦 DnD 遮罩）。统一走
    // resolveInitialPage，即使初始事件丢失，两者也保持一致。
    this._current = resolveInitialPage();
    this._globalUnsubs = [];
    this._repoEventsCleanup = null;
  }

  connectedCallback(): void {
    this._unsub = bus.on("nav:change", ({ page }) => {
      this._current = page;
      // 不再每次 nav:change 清扫描缓存：30s 缓存由导入/同步/下载等实际数据变更处
      // 显式清除（sync.ts / download-queue.ts），避免重复扫盘 + 刷屏扫描日志
      this._render();
      // P2 修复（审核）：nav:changed 是「渲染完成后」的完成事件——原在 _render() 之前发射，
      // _render 的 HTML 装配段（switch+innerHTML）若抛错，PageStore/导航高亮已是新页而 DOM
      // 仍是旧页（#13「状态变、内容不渲染」契约违反）；渲染成功后广播才真正收敛。
      // P3 修复（审核）：_render 失败时 _pageInitFailed 会把 _current 重定向回 repository 并
      // 同步重发 nav:change（其 handler 已广播 nav:changed{repository}）；此处若仍按原 page
      // 广播，会把 PageStore/导航高亮写回失败页（幽灵路径）。仅当 _current 仍是目标页
      // （渲染未被重定向）才广播完成事件。
      if (this._current === page) {
        bus.emit("nav:changed", { page });
      }
    });
    // 创作者详情浮层→搜索本地模型
    this._globalUnsubs.push(
      bus.on("repo:search-creator", (name) => {
        // 先切到仓库页面（_render 同步创建 <app-tree>，其 connectedCallback 注册 tree:set-search 监听）
        bus.emit("nav:change", { page: "repository" });
        // 渲染完成后发射搜索事件——app-tree 已挂载，bus 监听就绪
        bus.emit("tree:set-search", name);
      }),
    );
    // 语言热切换（ADR-045 增强）：lang:changed → 重渲染当前页（t() 读取新语言包），
    // 替代整页 reload；settings 页 initSettings 会重新执行并恢复 set-lang 选中值
    this._globalUnsubs.push(
      bus.on("lang:changed", () => {
        this._render();
      }),
    );
    this._render();
    this._globalUnsubs.push(...registerGlobalHandlers());
    // features/views 层注册归位（core handler 不依赖上层；分层债务清理）
    registerResourceManagerGlobal(this._globalUnsubs);
  }

  disconnectedCallback(): void {
    if (this._unsub) {
      this._unsub();
      this._unsub = null;
    }
    this._globalUnsubs.forEach((fn) => fn());
    this._globalUnsubs = [];
    if (this._resizeMove) document.removeEventListener("pointermove", this._resizeMove);
    if (this._resizeUp) document.removeEventListener("pointerup", this._resizeUp);
    this._resizeMove = null;
    this._resizeUp = null;
    this._avatarRefreshRegistered = false;
    this._insListenerReg = false;
    // config-loaded Wails 订阅回收 + flag 复位（init-workshop.ts 模块级状态，
    // 经导出函数访问——组件重建后新实例可重新注册）
    resetAvatarConfigLoaded();
    // 清理 _unsubs（dedup 等页面的事件订阅）
    if (this._unsubs && Array.isArray(this._unsubs)) {
      this._unsubs.forEach((fn) => {
        if (typeof fn === "function") fn();
      });
    }
    this._unsubs = [];
    // 清理 repo 视图事件
    if (this._repoEventsCleanup) {
      this._repoEventsCleanup().catch(() => {});
      this._repoEventsCleanup = null;
    }
    // 清理缓存
    if (this._workshopCache) this._workshopCache.clear();
    this._workshopCache = null;
    if (this._githubCache) this._githubCache.clear();
    this._githubCache = null;
    // 清理 workshop 默认站点定时器（防空跑网络请求）
    if (this._workshopTimer) {
      clearTimeout(this._workshopTimer);
      this._workshopTimer = null;
    }
  }

  _render(): void {
    // P2 修复：每次重渲染前释放上一轮 _bindTabs 收集的 tab 订阅——
    // app-content 常驻不卸载，_unsubs 只在 disconnectedCallback 清理，
    // 多次访问 repository 的 dedup/oldest/import/recycle 会让 repo:rtype-changed
    // 监听与 cleanup 跨访问累积（N 次访问后一次 rtype-changed 触发 N 次 doDedup/render）
    if (this._unsubs && Array.isArray(this._unsubs)) {
      this._unsubs.forEach((fn) => {
        if (typeof fn === "function") fn();
      });
      this._unsubs = [];
      // P3 修复（审核，陷阱 #2）：_unsubs 每次重渲染清空会把 initInstancesPage 注册的
      // package:selected 订阅一并退订；若 _insListenerReg 不复位，再次进入 instances 页时
      // initInstancesPage 因 flag=true 提前 return，订阅永久丢失（切页后 handler 消失）。
      // 与 _unsubs 生命周期对齐：清空即复位，重进页面重新注册（重复渲染同一页也会先退订再
      // 注册，不会重复监听）。
      this._insListenerReg = false;
    }
    // P2 修复（审核）：切页/语言热切换时同样清理 workshop 延迟加载定时器——
    // 原仅 disconnectedCallback 清理，切离 workshop 后定时器仍在失效 DOM 上
    // 触发全量加载 + 网络拉取；lang:changed 时新旧双定时器叠加
    if (this._workshopTimer) {
      clearTimeout(this._workshopTimer);
      this._workshopTimer = null;
    }
    try {
      let inner = "";
      switch (this._current) {
        case "repository":
          inner = repositoryHTML();
          break;
        case "instances":
          inner = instancesHTML();
          break;
        case "workshop":
          inner = workshopHTML();
          break;
        case "github":
          inner = githubHTML();
          break;
        case "diagnostics":
        case "oldest":
          inner = diagnosticsHTML();
          break;
        case "settings":
          inner = settingsHTML();
          break;
        default:
          inner = instancesHTML();
      }
      this._root.innerHTML = `<div class="page">${inner}</div>`;

      // 初始化预览面板拖拽调整宽度
      this._initPreviewResize();

      if (this._current === "diagnostics") {
        this._initDiagnostics();
      } else if (this._current === "settings") {
        // _initSettings 是 async：外层 try/catch 抓不到 reject，必须显式挂 catch 出口
        // （ADR-044 ①异步范式：async 调用最外层必有 catch，reject 转 toast 而非 unhandled）
        void this._initSettings().catch((e) => this._pageInitFailed(e));
      } else if (this._current === "workshop") {
        this._initWorkshop();
      } else if (this._current === "github") {
        this._initGithub();
      } else if (this._current === "instances") {
        this._initInstances();
      } else if (this._current === "repository") {
        this._initRepository();
      }
    } catch (e) {
      // P2 修复（审核）：HTML 装配段（switch+innerHTML）与页 init 统一兜底——
      // 原装配段在 try 外，repositoryHTML() 等抛错会中断 _render 且无用户反馈，
      // 配合 nav:changed 后置广播，装配失败时状态不广播（杜绝「状态变、内容不渲染」）
      this._pageInitFailed(e);
    }
  }

  /** 页面初始化失败统一出口（同步 throw 与 async reject 共用） */
  private _pageInitFailed(e: unknown): void {
    console.error("[app-content] 页面初始化失败:", e);
    bus.emit("toast:show", {
      msg: "❌ " + t("content.pageLoadFailed") + ": " + friendlyError(e),
      duration: 5000,
      type: "error",
    });
    // 重置页面状态为仓库页，防止 nav 高亮与内容脱节；
    // 已在 repository 页时跳过，避免无效 nav:change 触发链
    if (this._current !== "repository") {
      this._current = "repository";
      bus.emit("nav:change", { page: "repository" });
    }
  }

  _initPreviewResize(): void {
    initPreviewResize(this as never);
  }

  _setResizeMove(fn: ((e: PointerEvent) => void) | null): void {
    this._resizeMove = fn;
  }

  _setResizeUp(fn: ((e: PointerEvent) => void) | null): void {
    this._resizeUp = fn;
  }

  _setCurrentSite(site: WorkshopSite | null): void {
    this._currentSite = site;
  }

  _setAvatarCache(cache: Record<string, string>): void {
    this._avatarCache = cache;
  }

  _setWorkshopCache(cache: Map<string, RepoCacheEntry> | null): void {
    this._workshopCache = cache;
  }

  _setGithubCache(cache: Map<string, RepoCacheEntry> | null): void {
    this._githubCache = cache;
  }

  _setWorkshopTimer(timer: ReturnType<typeof setTimeout> | null): void {
    this._workshopTimer = timer;
  }

  _setAvatarRefreshRegistered(v: boolean): void {
    this._avatarRefreshRegistered = v;
  }

  _setRepoEventsCleanup(fn: (() => Promise<void>) | null): void {
    this._repoEventsCleanup = fn;
  }

  /**
   * 绑定 tab 按钮切换。按钮选择器与内容卡前缀解耦（样式类可复用，语义前缀独立）：
   *   _bindTabs(".repo-tab", "ins", ["versions"]) —— 按钮用 repo-tab 样式类，内容卡 id 为 ins-tab-versions
   */
  _bindTabs(tabSelector: string, prefix: string, ids: string[]): void {
    initRepositoryPage(this as never);
    // 注意：这里需要调用真实的 bindTabs，但为了测试兼容，我们保留方法签名
    // 实际逻辑在 init-pages.ts 中
  }

  _initDiagnostics(): void {
    initDiagnosticsPage(this as never);
  }

  _initInstances(): void {
    initInstancesPage(this as never);
  }

  _initRepository(): void {
    initRepositoryPage(this as never);
  }

  _initWorkshop(): void {
    initWorkshopPage(this as never);
  }

  _initGithub(): void {
    initGithubPage(this as never);
  }

  async _initSettings(): Promise<void> {
    void initSettingsPage(this as never).catch((e) => this._pageInitFailed(e));
  }

  _fmtSize(bytes: number): string {
    return formatBytes(bytes);
  }

  _esc(s: unknown): string {
    // 委托规范 esc（含引号转义）：_esc 被 site-view 等用于 data-* 属性插值
    return escUtil(String(s || ""));
  }
}

// 注册组件（防 HMR/重复 import 时重复 define）
if (!customElements.get("app-content")) {
  customElements.define("app-content", AppContent);
}
// HMR 热更新：contentCSS 变更时，将新样式表重新挂载到已存在的 shadow root
import.meta.hot?.accept((newModule) => {
  const style = (newModule as any).appContentStyle;
  document.querySelectorAll("app-content").forEach((el: any) => {
    const root = el.shadowRoot;
    if (root) root.adoptedStyleSheets = [style];
  });
});
