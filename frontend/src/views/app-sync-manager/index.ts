// ===== 整合包同步管理器（生命周期壳） =====
// 展示整合包内所有资源类型的同步状态（扁平列表，一次加载，前端过滤）
// 使用: <app-sync-manager instance="1.20.1-Fabric"></app-sync-manager>
// 拆分：store / renderer / events / network 四模块，本文件仅负责生命周期编排
// 依赖 DAG：index → store / renderer / events / network / state（leaf modules 间无循环，
// events 的 LAST_TYPE_KEY 等共享状态走 state.ts，不再反向依赖 index）

import { t } from "../../core/i18n/t.ts";
import { bus } from "../../bus.ts";
import { dbg } from "../../utils/debug/debug.ts";
import { RESOURCE_TYPES } from "../../utils/resource/types.ts";
import { friendlyError } from "../../utils/dom/errors.ts";
import { esc } from "../../utils/dom/html.ts";
import { WebComponentBase } from "../../utils/dom/web-component-base.ts";
import {
  containerHTML,
  loadingHTML,
} from "./tpl.ts";
import { loadTypeConfig, loadData } from "./store.ts";
import type { SyncItem } from "./tpl.ts";

/** 合并四子模块（store / renderer / events / network）对组件实例的接口需求，
 * 一统江湖，消除各处 `as any` 桥接。各子模块可改从此导入。 */
export interface SyncManagerSelf {
  _gen: number;
  _instance: string;
  _selectedType: string;
  _statusFilter: string;
  _singleBusy: boolean;
  _allItems: SyncItem[];
  _filteredItems: SyncItem[];
  _typeConfig: Array<{ id: string; name?: string; icon?: string }>;
  _loading: boolean;
  isConnected?: boolean;
  innerHTML: string;
  querySelector(sel: string): HTMLElement | null;
  querySelectorAll(sel: string): NodeList;
}
import { render } from "./renderer.ts";
import { bindEvents } from "./events.ts";
import { performSingleOp } from "./network.ts";
import { LAST_TYPE_KEY, _lastSelectedType, setLastSelectedType } from "./state.ts";

// P3 修复（子代理审计）：共享状态（LAST_TYPE_KEY / _lastSelectedType / setLastSelectedType）
// 已下沉至 state.ts，打破 index ↔ events 循环依赖

const TOAST_MS_LONG = 5000;

export class AppSyncManager extends WebComponentBase {
  static get observedAttributes(): string[] {
    return ["instance", "default-type"];
  }

  private _instance = "";
  private _defaultType = RESOURCE_TYPES.YSM;
  private _selectedType = RESOURCE_TYPES.YSM;
  private _statusFilter = "all";
  private _allItems: SyncItem[] = [];
  private _filteredItems: SyncItem[] = [];
  private _typeConfig: Array<{ id: string; name?: string; icon?: string }> = [];
  private _loading = false;
  private _gen = 0;
  private _unsubs: Array<() => void> = [];
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
      this._defaultType = newVal || RESOURCE_TYPES.YSM;
    }
  }

  disconnectedCallback(): void {
    if (this._unsubs) {
      this._unsubs.forEach((fn) => fn());
      this._unsubs = [];
    }
  }

  async _init(): Promise<void> {
    const self = this as unknown as SyncManagerSelf;
    const gen = ++this._gen;
    this._loading = true;
    this.innerHTML = containerHTML();
    const listEl = this.querySelector(".sm-list");
    if (listEl) listEl.innerHTML = loadingHTML();

    if (this._unsubs) {
      this._unsubs.forEach((fn) => fn());
      this._unsubs = [];
    }

    await loadTypeConfig(self);
    await loadData(self);

    if (gen !== this._gen || !this.isConnected) return;

    this._loading = false;
    try {
      this._doRender();
    } catch (e) {
      console.error("[sync-manager] _render 出错:", e);
      this.innerHTML +=
        '<div style="padding:12px;color:var(--err)">' +
        t("sync.renderFailed") + ": " +
        esc(String(e)) +
        "</div>";
      bus.emit("toast:show", { msg: "❌ " + friendlyError(e, t("sync.renderFailed")), duration: TOAST_MS_LONG, type: "error" });
    }

    const unsub = bus.on("stats:refresh", () => {
      if (!this.isConnected) return;
      const gen = this._gen;
      dbg("sync-manager", "stats:refresh 收到");
      loadData(self)
        .then(() => {
          if (gen !== this._gen) return;
          dbg("sync-manager", "_loadData 完成, items:", this._allItems ? this._allItems.length : 0);
          if (this._allItems) {
            const counts: Record<string, number> = {};
            this._allItems.forEach((i: any) => { counts[i.status] = (counts[i.status] || 0) + 1; });
            dbg("sync-manager", "重渲染, 计数:", counts);
          }
          this._doRender();
        })
        .catch((err) => {
          console.warn("[sync-manager] stats:refresh 重载失败:", err);
        });
    });
    this._unsubs.push(unsub);

    this._syncRM();
    this._bindRmToggle();
  }

  /** 渲染 + 事件绑定的统一入口（供 _init 和 stats:refresh 复用） */
  private _doRender(): void {
    const self = this as unknown as SyncManagerSelf;
    const doLoadData = () => loadData(self);
    const doEmitStats = () => bus.emit("stats:refresh");

    render(self);
    bindEvents(self, {
      doRender: () => this._doRender(),
      doSyncRM: () => this._syncRM(),
      doPerformOp: (op, path) => performSingleOp(self, op, path, {
        doLoadData,
        doRender: () => this._doRender(),
        doEmitStats,
      }),
    });
  }

  /** 将 instance + 当前资源类型透传给 <app-resource-manager> */
  private _syncRM(): void {
    const el = this.querySelector<HTMLElement>(".sm-rm-el");
    if (!el) return;
    if (el.getAttribute("instance") !== this._instance) {
      el.setAttribute("instance", this._instance);
    }
    if (el.getAttribute("rtype") !== this._selectedType) {
      el.setAttribute("rtype", this._selectedType);
    }
  }

  /** 资源管理器折叠区展开/收起 */
  private _bindRmToggle(): void {
    const toggleEl = this.querySelector<HTMLElement>(".sm-rm-toggle");
    const bodyEl = this.querySelector<HTMLElement>(".sm-rm-body");
    if (toggleEl && bodyEl) {
      toggleEl.addEventListener("click", () => {
        const expanded = bodyEl.style.display !== "none";
        bodyEl.style.display = expanded ? "none" : "";
        toggleEl.textContent = (expanded ? "📁 " : "▸ 📁 ") + t("syncManager.rmTitle");
        this._syncRM();
      });
    }
  }
}

if (typeof customElements !== "undefined" && !customElements.get("app-sync-manager")) {
  customElements.define("app-sync-manager", AppSyncManager);
}
