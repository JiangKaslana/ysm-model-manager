// ===== <app-nav> — 左侧导航菜单（类型化版 — ADR-014 P3 components）=====
// 事件：nav:change — 切换页面
import { bus, type PageName } from "../../bus.ts";
import { resolveInitialPage, sanitizePage } from "../../core/page-store.ts";
import { safeGet, safeSet } from "../../utils/dom/storage.ts";
import { t } from "../../core/i18n/t.ts";
import { getApp } from "../../backend/app.ts";
import { isViewerMode } from "../../utils/dom/android-bridge.ts";

class AppNav extends HTMLElement {
  _current: string;
  /** 导航折叠态：折叠后收成常驻窄条（仅图标），展开按钮/页面小图标始终可见 */
  _collapsed: boolean;
  _unsub: (() => void) | undefined;
  _unsubLang: (() => void) | undefined;

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    // 与 PageStore 同源初始化（原硬编码 "dashboard" 是幽灵值——PageName 中
    // 不存在此页，启动时导航高亮缺失，靠 nav:changed 收敛后才恢复）
    this._current = resolveInitialPage();
    // 折叠态持久化（用户手动折叠记忆；workshop 页自动折叠走 persist=false 不落盘）
    this._collapsed = safeGet("nav_collapsed") === "1";
  }

  connectedCallback(): void {
    this._unsub = bus.on("nav:changed", ({ page }) => {
      // P3 修复（子代理审计）：page 过 sanitizePage 白名单——非法页 emit（遗留 .js/
      // 未来调用方）会让高亮静默丢失 + 脏值入 nav_page（启动时虽被兜底，会话期 UI 脱节）；
      // 与 page-store 同款模式对齐
      this._current = sanitizePage(page);
      safeSet("nav_page", this._current);
      this.shadowRoot!.querySelectorAll(".nav-item").forEach((el) => {
        el.classList.toggle("active", (el as HTMLElement).dataset.page === this._current);
      });
    });
    // 语言切换时重渲染导航标签
    this._unsubLang = bus.on("lang:changed", () => this.render());
    this.render();
    // 恢复上次保存的页面（首次使用或仓库页也需发射，确保导航栏高亮和 app-content 渲染）
    // 用 queueMicrotask 确保其他组件的 connectedCallback 先完成注册
    // 恢复逻辑统一走 page-store.resolveInitialPage，避免两处漂移
    const targetPage = resolveInitialPage();
    queueMicrotask(() => bus.emit("nav:change", { page: targetPage }));
  }

  disconnectedCallback(): void {
    this._unsub?.();
    this._unsubLang?.();
  }

  render(): void {
    // 折叠态在 host 上以 data-collapsed 标记，CSS 据此切换窄条布局
    if (this._collapsed) this.setAttribute("data-collapsed", "");
    else this.removeAttribute("data-collapsed");
    // 查看器模式（Android/网页版 ADR-049）：整合包（ListVersionInstances）入口 binding
    // 仍属桌面专属、未桥接，隐藏对应 instances tab；GitHub 仓库列表（LoadGitHubRepos）
    // 已在 ADR-049 桥接增强 Batch 2 桥接（bundled workshop-github.json），网页版可用，
    // 故 github tab 不再对查看器模式隐藏。
    const isViewer = isViewerMode();
    const items = [
      { id: "repository", icon: "📚", key: "nav.repository" },
      ...(isViewer ? [] : [{ id: "instances", icon: "🎮", key: "nav.instances" }]),
      { id: "workshop", icon: "🎨", key: "nav.community" },
      { id: "github", icon: "🧩", key: "nav.workshop" },
      { id: "diagnostics", icon: "🛠️", key: "nav.diagnostics" },
      { id: "settings", icon: "⚙️", key: "nav.settings" },
    ];

    this.shadowRoot!.innerHTML = `
      <style>
        :host {
          display: flex;
          flex-direction: column;
          background: var(--bg);
          border-right: 1px solid var(--bd);
          width: 160px;
          font-family: var(--font-ui);
          font-size: var(--fs-base);
          transition: width var(--tr-fast);
          overflow: hidden;
        }
        /* 折叠态：收成常驻窄条，仅保留图标 + 展开按钮 */
        :host([data-collapsed]) { width: 48px; }
        :host([data-collapsed]) .logo { justify-content: center; padding: 16px 0 12px; }
        :host([data-collapsed]) .logo-text,
        :host([data-collapsed]) .menu-label,
        :host([data-collapsed]) .nav-text,
        :host([data-collapsed]) .version { display: none; }
        :host([data-collapsed]) .nav-item { justify-content: center; padding: 8px 0; }
        :host([data-collapsed]) .nav-item.active { border-left: none; padding-left: 0; }
        :host([data-collapsed]) .menu-head { justify-content: center; }
        .logo {
          padding: 16px 14px 12px;
          font-size: var(--fs-lg);
          font-weight: var(--fw-semibold);
          color: var(--txt);
          display: flex;
          align-items: center;
          gap: 8px;
          border-bottom: 1px solid var(--bd);
        }
        .logo-icon { font-size: 20px; }
        /* Logo 呼吸光晕 */
        @keyframes logoBreathe {
          0%, 100% { text-shadow: 0 0 4px color-mix(in srgb, var(--accent) 0%, transparent); }
          50% { text-shadow: 0 0 12px color-mix(in srgb, var(--accent) 35%, transparent), 0 0 4px color-mix(in srgb, var(--accent) 15%, transparent); }
        }
        .logo-icon { animation: logoBreathe 3s ease-in-out infinite; }
        :host-context(.no-animations) .logo-icon { animation: none !important; }
        /* 「🧭 导航栏」行：label 撑满，折叠按钮置于行尾（紧贴导航项上方，直觉位置） */
        .menu-head { display: flex; align-items: center; gap: 4px; cursor: pointer; }
        /* 折叠/展开按钮：常驻——折叠态窄条上仍可见，防意外找不回导航 */
        .nav-toggle {
          border: none;
          background: transparent;
          color: var(--muted);
          cursor: pointer;
          font-size: 14px;
          padding: 4px 6px;
          border-radius: 4px;
          transition: var(--tr-fast);
          flex-shrink: 0;
        }
        .nav-toggle:hover { color: var(--accent); background: var(--hover); }
        .menu { padding: 4px 8px 8px; flex: 1; display: flex; flex-direction: column; }
        .menu-label { flex: 1; font-size: var(--fs-xs); color: var(--muted); padding: 8px 10px 4px; text-transform: uppercase; letter-spacing: .5px; }
        .nav-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 10px;
          border-radius: 5px;
          font-size: calc(var(--fs-nav) + 2px);
          color: var(--muted);
          cursor: pointer;
          transition: var(--tr-fast);
          margin-bottom: 2px;
        }
        .nav-item:hover { background: var(--hover); color: var(--txt); }
        .nav-item.active {
          background: var(--hover);
          color: var(--txt);
          border-left: 3px solid var(--menu-indicator, var(--accent));
          padding-left: 7px;
        }
        .nav-item .icon { font-size: 15px; width: 20px; text-align: center; }
        .version {
          padding: 10px 14px;
          border-top: 1px solid var(--bd);
          font-size: var(--fs-sm);
          color: var(--muted);
        }
      </style>
      <div class="logo">
        <span class="logo-icon">💎</span>
        <span class="logo-text">${t("app.name")}</span>
      </div>
      <div class="menu">
        <div class="menu-head" data-menu-head title="${this._collapsed ? t("nav.expand") : t("nav.collapse")}">
          <div class="menu-label">🧭 ${t("nav.label")}</div>
          <button class="nav-toggle" data-testid="nav-toggle" aria-hidden="true">${this._collapsed ? "»" : "«"}</button>
        </div>
        ${items
          .map(
            (item) => `
          <div class="nav-item ${item.id === this._current ? "active" : ""}" data-testid="nav-item" data-page="${item.id}" title="${t(item.key)}">
            <span class="icon">${item.icon}</span>
            <span class="nav-text">${t(item.key)}</span>
          </div>
        `,
          )
          .join("")}
      </div>
      <div class="version" id="nav-version">${t("common.loading")}</div>
    `;

    this.shadowRoot!.querySelectorAll(".nav-item").forEach((el) => {
      (el as HTMLElement).onclick = () => {
        const page = (el as HTMLElement).dataset.page as PageName;
        // P2 修复（e2e 时序反推）：nav_page 持久化原依赖 nav:changed 回环写入——
        // app-content 未挂载时 nav:change 无人消费 → 回环不触发 → 上次停留页不落盘。
        // 点击时同步写入，事件丢失时下次启动仍能经 resolveInitialPage 恢复。
        // P3 修复（子代理审计）：safeSet 收敛裸调（storage.ts 红线：全项目统一经
        // 本模块读写）
        safeSet("nav_page", page);
        bus.emit("nav:change", { page });
      };
    });

    // 折叠/展开：整个「🧭 导航栏」行可点击（label + 箭头统一触发，扩大点击范围）
    const head = this.shadowRoot!.querySelector(".menu-head");
    head?.addEventListener("click", () => this.setCollapsed(!this._collapsed));

    // 异步加载版本号
    getApp()
      .then((App) =>
        App.GetAppVersion().then((v) => {
          const el = this.shadowRoot!.getElementById("nav-version");
          if (el) el.textContent = (v || "dev") + " \u2022 " + t("nav.preview");
        }),
      )
      .catch(() => {
        const el = this.shadowRoot!.getElementById("nav-version");
        // P2 修复（审核）：兜底不再硬编码 "v1.0.0"（网页版 browserAdapter 已实现
        // GetAppVersion 返回 "web"，此处仅剩真失败兜底；硬编码版本与实际发版脱节会误导）
        if (el) el.textContent = t("nav.preview");
      });
  }

  /**
   * 折叠/展开导航栏。
   * @param collapsed 是否折叠
   * @param persist 是否持久化到 localStorage。workshop 页自动折叠传 false，
   *                避免污染用户手动折叠记忆；用户点按钮传 true。
   */
  setCollapsed(collapsed: boolean, persist = true): void {
    if (this._collapsed === collapsed) return;
    this._collapsed = collapsed;
    if (persist) safeSet("nav_collapsed", collapsed ? "1" : "0");
    this.render();
  }
}
// 注册组件（防 HMR/重复 import 时重复 define）
if (!customElements.get("app-nav")) {
  customElements.define("app-nav", AppNav);
}
