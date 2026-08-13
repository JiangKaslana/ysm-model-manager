// ===== 整合包同步管理器 =====
// 展示整合包内所有资源类型的同步状态（扁平列表，一次加载，前端过滤）
// 使用: <app-sync-manager instance="1.20.1-Fabric"></app-sync-manager>

import { t } from "../../core/i18n/t.ts";
import { bus } from "../../bus.ts";
import { dbg } from "../../utils/debug/debug.ts";
import { RESOURCE_TYPES } from "../../utils/resource/types.ts";
import { friendlyError } from "../../utils/dom/errors.ts";
import { esc } from "../../utils/dom/html.ts";
import { safeGet, safeSet } from "../../utils/dom/storage.ts";
import { getApp } from "../../backend/app.ts";
import {
  containerHTML,
  itemHTML,
  statusTabHTML,
  emptyHTML,
  loadingHTML,
  type SyncItem,
} from "./tpl.ts";

/** 类型统计计数 */
interface TypeCounts {
  synced: number;
  missing: number;
  disabled: number;
  optional: number;
  legacy: number;
  total: number;
}

/** 资源类型配置（LoadResourceTypes 条目） */
interface RTypeConfig {
  id: string;
  name?: string;
  icon?: string;
}

/** 跨实例记住上次选中的类型（整合包间共享，localStorage 持久化） */
const LAST_TYPE_KEY = "ysm_syncLastType";
// P3 修复（子代理审计）：模块顶层裸调 localStorage——隐私模式/存储禁用时抛错会令
// 整个模块 import 失败（customElements.define 永不执行，组件不可用）；改 safeGet
let _lastSelectedType = safeGet(LAST_TYPE_KEY) || RESOURCE_TYPES.YSM;

export class AppSyncManager extends HTMLElement {
  static get observedAttributes(): string[] {
    return ["instance", "default-type"];
  }

  private _instance = "";
  private _defaultType = RESOURCE_TYPES.YSM;
  private _allItems: SyncItem[] = [];
  private _filteredItems: SyncItem[] = [];
  private _selectedType: string = RESOURCE_TYPES.YSM;
  private _statusFilter: string = "all";
  private _typeConfig: RTypeConfig[] = [];
  private _loading = false;
  /** _init 代际计数：instance 快速切换时丢弃过期加载的渲染与订阅，防并发覆盖 */
  private _gen = 0;
  private _unsubs: Array<() => void> = [];
  /** 单文件推送/拉取在途守卫：防连点并发（同 preview-skeleton _saving 模式） */
  private _singleBusy = false;

  connectedCallback(): void {
    this._instance = this.getAttribute("instance") || "";
    this._defaultType = this.getAttribute("default-type") || RESOURCE_TYPES.YSM;
    this._selectedType = _lastSelectedType || this._defaultType;
    if (!this._instance) {
      this.innerHTML =
        '<div style="padding:12px;color:var(--err)">⚠️ ' + t("sync.noInstance") + '</div>';
      return;
    }
    this._init();
  }

  attributeChangedCallback(name: string, oldVal: string | null, newVal: string | null): void {
    if (oldVal === newVal || !this.isConnected) return;
    if (name === "instance") {
      this._instance = newVal || "";
      if (this._instance) this._init();
    } else if (name === "default-type") {
      this._defaultType = newVal || "ysm";
    }
  }

  async _init(): Promise<void> {
    const gen = ++this._gen;
    this._loading = true;
    this.innerHTML = containerHTML();
    const listEl = this.querySelector(".sm-list");
    if (listEl) listEl.innerHTML = loadingHTML();

    // 先清旧订阅（移到加载前，异常路径也能清理，防 handler 累积泄漏）
    if (this._unsubs) {
      this._unsubs.forEach((fn) => fn());
      this._unsubs = [];
    }

    await this._loadTypeConfig();
    await this._loadData();

    // 期间有更新的 _init 启动（instance 切换）：丢弃本次过期加载的渲染与订阅；
    // P2 修复（审核发现）：无 isConnected 检查——组件在 await 期间被卸载（快速切包），
    // gen 未变仍会注册 stats:refresh 订阅并闭包持有已卸载元素（监听器泄漏竞态）
    if (gen !== this._gen || !this.isConnected) return;

    this._loading = false;
    try {
      this._render();
    } catch (e) {
      console.error("[sync-manager] _render 出错:", e);
      // 保留加载界面不消失也至少显示错误提示
      this.innerHTML +=
        '<div style="padding:12px;color:var(--err)">' +
        t("sync.renderFailed") + ": " +
        esc(String(e)) +
        "</div>";
      bus.emit("toast:show", { msg: "❌ " + friendlyError(e, t("sync.renderFailed")), duration: 5000, type: "error" });
    }

    const unsub = bus.on("stats:refresh", () => {
      if (!this.isConnected) return;
      const gen = this._gen; // P2 修复：捕获当前代际，防 instance 快速切换后旧代际 .then 重渲染新面板
      dbg("sync-manager", "stats:refresh 收到");
      this._loadData()
        .then(() => {
          if (gen !== this._gen) return; // P2 修复：过期代际丢弃
          dbg(
            "sync-manager",
            "_loadData 完成, items:",
            this._allItems ? this._allItems.length : 0,
          );
          // P3 修复（子代理审计）：无条件 _render——原仅 `_allItems.length` 非空时
          // 重渲染，清空实例/删除全部文件后 stats:refresh → 空列表 → 跳过渲染，
          // 界面仍显示旧列表（陈旧 UI，与 _init 初始路径渲染空态不一致）；
          // _render 内部自会渲染空态
          if (this._allItems && this._allItems.length) {
            const counts: Record<string, number> = {};
            this._allItems.forEach((i) => {
              counts[i.status] = (counts[i.status] || 0) + 1;
            });
            dbg("sync-manager", "重渲染, 计数:", counts);
          }
          this._render();
        })
        .catch((err) => {
          console.warn("[sync-manager] stats:refresh 重载失败:", err);
        });
    });
    this._unsubs = this._unsubs || [];
    this._unsubs.push(unsub);
  }

  disconnectedCallback(): void {
    if (this._unsubs) {
      this._unsubs.forEach((fn) => fn());
      this._unsubs = [];
    }
  }

  async _loadTypeConfig(): Promise<void> {
    // P2 修复（审核发现）：getApp() 原在 try 之外——import 失败/桥接异常时 reject 逸出
    // 为 unhandledrejection（connectedCallback 无 catch）；移入 try 统一兜底
    const gen = this._gen; // P3 修复（审核发现）：捕获当前代际——await 期间 instance 可能已切换
    try {
      const { LoadResourceTypes } = await getApp();
      const raw = await LoadResourceTypes();
      const parsed = JSON.parse(raw) as { resourceTypes?: RTypeConfig[] };
      if (gen !== this._gen) return; // 过期代际丢弃，防覆盖新代际已加载配置
      this._typeConfig = parsed.resourceTypes || [];
    } catch {
      // 过期代际/已卸载：不作废新代际数据，也不弹误导性失败 toast（对齐 _loadData 守卫）
      if (gen !== this._gen || !this.isConnected) return;
      this._typeConfig = [];
      // P3 修复（审核发现）：静默降级（类型标签全消失无反馈）与 _loadData 的 toast 不一致
      bus.emit("toast:show", {
        msg: "⚠️ 资源类型配置加载失败",
        duration: 3000,
        type: "warn",
      });
    }
  }

  async _loadData(): Promise<void> {
    // P2 修复：捕获当前代际——await getApp 期间 instance 可能已切换，
    // 旧代际晚到的 _allItems 写入不得覆盖新代际数据（后续过滤交互基于错误数据）
    const gen = this._gen;
    try {
      // P2 修复（审核发现）：getApp() 原在 try 之外，reject 会逸出为 unhandledrejection
      const { GetInstanceSyncStatus } = await getApp();
      const json = await GetInstanceSyncStatus(this._instance);
      if (gen !== this._gen) return; // 过期代际丢弃
      this._allItems = (JSON.parse(json) as SyncItem[]) || [];
    } catch {
      if (gen !== this._gen) return; // 过期代际丢弃（失败 toast 同样作废）
      this._allItems = [];
      // 失败不静默：避免界面显示「暂无资源文件」误导（坑史同款静默路径）
      bus.emit("toast:show", {
        msg: "⚠️ 同步状态加载失败",
        duration: 3000,
        type: "warn",
      });
    }
  }

  _render(): void {
    try {
      this.innerHTML = containerHTML();
    } catch (e) {
      console.error("[sync-manager] _render 设置 innerHTML 失败:", e);
      return;
    }

    const modelTypes = [RESOURCE_TYPES.YSM, RESOURCE_TYPES.MMD, RESOURCE_TYPES.VRC];
    const resourceTypes = [RESOURCE_TYPES.PACK, RESOURCE_TYPES.SHADER, RESOURCE_TYPES.BLUEPRINT, RESOURCE_TYPES.LITEMATIC];
    const shortLabel: Record<string, string> = {
      ysm: "YSM",
      "mmd-skin": "MMD",
      "vrchat-avatar": "VRC",
      resourcepack: t("rtype.pack"),
      shaderpack: t("rtype.shader"),
      "create-blueprint": t("rtype.blueprint"),
      litematic: t("rtype.litematic"),
    };

    const tabsEl = this.querySelector(".sm-tabs");
    const statusTabsEl = this.querySelector(".sm-status-tabs");
    const summaryEl = this.querySelector(".sm-summary");
    const listEl = this.querySelector(".sm-list");
    if (!tabsEl || !statusTabsEl || !summaryEl || !listEl) {
      console.warn("[sync-manager] _render DOM 查询失败, 放弃渲染");
      return;
    }

    // — 类型统计 —
    const typeCounts: Record<string, TypeCounts> = {};
    for (const t of this._typeConfig) {
      typeCounts[t.id] = {
        synced: 0,
        missing: 0,
        disabled: 0,
        optional: 0,
        legacy: 0,
        total: 0,
      };
    }
    for (const item of this._allItems) {
      const c = typeCounts[item.type];
      if (c) {
        (c as unknown as Record<string, number>)[item.status]++;
        c.total++;
      }
    }
    const globalCounts: TypeCounts = {
      synced: 0,
      missing: 0,
      disabled: 0,
      optional: 0,
      legacy: 0,
      total: 0,
    };
    for (const item of this._allItems) {
      (globalCounts as unknown as Record<string, number>)[item.status]++;
    }

    // — 类型标签（分组：模型类 | 资源类）—
    const renderGroup = (types: string[], sep: boolean): string => {
      let html = "";
      for (const id of types) {
        const t = this._typeConfig.find((c) => c.id === id);
        if (!t) continue;
        const c = typeCounts[id];
        const count = c ? c.total : 0;
        const active = this._selectedType === id;
        html +=
          '<button class="sm-tab' +
          (active ? " active" : "") +
          '" data-type="' +
          id +
          '" style="padding:var(--pad-tab) 14px;border-radius:5px 5px 0 0;border:none;background:' +
          (active ? "var(--surf)" : "transparent") +
          ";color:" +
          (active ? "var(--accent)" : "var(--muted)") +
          ';cursor:pointer;font-family:inherit;font-size:var(--fs-tab);white-space:nowrap">' +
          (t.icon || "📦") +
          " " +
          (shortLabel[id] || t.name) +
          (count > 0
            ? ' <span style="font-size:var(--fs-xs);opacity:0.7">' +
              "(" +
              count +
              ")</span>"
            : "") +
          "</button>";
      }
      if (sep) html += '<span style="color:var(--bd);padding:0 2px">│</span>';
      return html;
    };
    tabsEl.innerHTML =
      renderGroup(modelTypes, true) + renderGroup(resourceTypes, false);

    // — 状态筛选标签 —
    const curCounts: TypeCounts = this._selectedType
      ? typeCounts[this._selectedType] || globalCounts
      : globalCounts;
    const statusDefs: Array<[string, string, number]> = [
      [
        "all",
        "📊 " + t("syncManager.status.all"),
        this._selectedType ? curCounts.total || 0 : this._allItems.length,
      ],
      ["synced", "✅ " + t("syncManager.status.synced"), curCounts.synced || 0],
      ["missing", "⬇️ " + t("syncManager.status.missing"), curCounts.missing || 0],
      ["disabled", "⛔ " + t("syncManager.status.disabled"), curCounts.disabled || 0],
      ["optional", "📤 " + t("syncManager.status.optional"), curCounts.optional || 0],
      ["legacy", "🔗 " + t("syncManager.status.legacy"), curCounts.legacy || 0],
    ];
    statusTabsEl.innerHTML = statusDefs
      .map(([id, label, count]) =>
        statusTabHTML(id, label, count, this._statusFilter === id),
      )
      .join("");

    // — 列表 —
    this._applyFilter();
    this._renderList(listEl as HTMLElement);

    // — 事件绑定 —
    this._bindEvents();
  }

  _applyFilter(): void {
    let items = this._allItems;
    if (this._selectedType) {
      items = items.filter((i) => i.type === this._selectedType);
    }
    if (this._statusFilter !== "all") {
      items = items.filter((i) => i.status === this._statusFilter);
    }
    this._filteredItems = items;
  }

  _renderList(listEl: HTMLElement): void {
    if (!listEl) return;
    if (this._filteredItems.length === 0) {
      const statusLabels: Record<string, string> = {
        all: "",
        synced: t("syncManager.status.synced"),
        missing: t("syncManager.status.missing"),
        disabled: t("syncManager.status.disabled"),
        optional: t("syncManager.status.optional"),
        legacy: t("syncManager.status.legacy"),
      };
      const hint =
        this._statusFilter !== "all"
          ? t("syncManager.emptyFiltered", { status: statusLabels[this._statusFilter] || "" })
          : t("syncManager.emptyType");
      listEl.innerHTML = emptyHTML(hint);
      return;
    }
    listEl.innerHTML = this._filteredItems.map((it, i) => itemHTML(it, i)).join("");
  }

  _bindEvents(): void {
    // 类型标签切换
    this.querySelectorAll(".sm-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        this._selectedType = (btn as HTMLElement).dataset.type || "";
        _lastSelectedType = this._selectedType;
        // P3 修复（子代理审计）：裸调 setItem 抛错会中断后续 _statusFilter/emit/_render
        // （一次存储异常让类型切换 UI 完全不更新）；改 safeSet（存储不可用静默忽略）
        safeSet(LAST_TYPE_KEY, this._selectedType);
        this._statusFilter = "all";
        bus.emit("repo:rtype-changed", this._selectedType);
        this._render();
      });
    });

    // 状态标签切换
    this.querySelectorAll(".sm-status-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        this._statusFilter = (btn as HTMLElement).dataset.status || "all";
        this._render();
      });
    });

    // 单行按钮
    this.querySelectorAll(".sm-item-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const row = (e.currentTarget as HTMLElement).closest("[data-path]");
        if (!row) return;
        const path = (row as HTMLElement).dataset.path || "";
        const action = (btn as HTMLElement).dataset.action;
        if (action === "push") this._pushSingleFile(path);
        else if (action === "pull") this._pullSingleFile(path);
      });
    });
  }

  async _pushSingleFile(path: string): Promise<void> {
    if (this._singleBusy) return;
    this._singleBusy = true;
    // P3 修复（子代理审计）：入口同步捕获 instance/type——原实现 await getApp() 之后
    // 才读 this._instance/this._selectedType，await 期间同元素 attributeChangedCallback
    // 触发 _init() 复用元素时会把旧实例列表的 path 推入新实例（TOCTOU）；
    // _pullSingleFile 已对 rtype 入口捕获，此处补齐 instance 并统一两处
    const targetInstance = this._instance;
    const rtype = this._selectedType;
    try {
      const { PushSingleResourceToInstance } =
        await getApp();
      await PushSingleResourceToInstance(
        rtype,
        targetInstance,
        path,
      );
      bus.emit("toast:show", { msg: "✅ 已推送", duration: 2000 });
      const gen = this._gen; // P2：捕获代际，防 await 期间 instance 切换后旧代际重渲染
      await this._loadData();
      if (gen !== this._gen) return;
      this._render();
      bus.emit("stats:refresh");
    } catch (e) {
      bus.emit("toast:show", {
        msg: "❌ " + friendlyError(e),
        duration: 3000,
        type: "error",
      });
    } finally {
      this._singleBusy = false;
    }
  }

  async _pullSingleFile(path: string): Promise<void> {
    if (this._singleBusy) return;
    this._singleBusy = true;
    // P3 修复（子代理审计）：入口捕获 rtype 与 instance（await 期间属性切换不再
    // 打到错误目标，与 _pushSingleFile 对称）
    const rtype = this._selectedType;
    const targetInstance = this._instance;
    try {
      const { PullSingleResourceFromInstance } =
        await getApp();
      await PullSingleResourceFromInstance(rtype, path, targetInstance);
      bus.emit("toast:show", { msg: "✅ 已拉取", duration: 2000 });
      const gen = this._gen; // P2：捕获代际，防 await 期间 instance 切换后旧代际重渲染
      await this._loadData();
      if (gen !== this._gen) return;
      this._render();
      bus.emit("stats:refresh");
    } catch (e) {
      bus.emit("toast:show", {
        msg: "❌ " + friendlyError(e),
        duration: 3000,
        type: "error",
      });
    } finally {
      this._singleBusy = false;
    }
  }
}

// 注册
// 注册组件（防 HMR/重复 import 时重复 define）
if (!customElements.get("app-sync-manager")) {
  customElements.define("app-sync-manager", AppSyncManager);
}
