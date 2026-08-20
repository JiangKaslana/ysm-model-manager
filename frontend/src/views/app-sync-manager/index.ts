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
import { safeGet } from "../../utils/dom/storage.ts";
import { getApp } from "../../backend/app.ts";
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
  _subdirFilter: string;
  _singleBusy: boolean;
  _allItems: SyncItem[];
  _filteredItems: SyncItem[];
  _typeConfig: Array<{ id: string; name?: string; icon?: string; dirLevelSync?: boolean }>;
  _loading: boolean;
  /** 展开/折叠状态（dir-level 层级展示用，key = item path） */
  _dirOpen: Record<string, boolean>;
  /** 各资源类型在 FilesRoot 下的仓库根路径缓存 */
  _repoRoots: Record<string, string>;
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
// 2026-08-18：sm-tabs 移除后类型完全由全局 nav 下拉驱动——订阅 repo:rtype-changed 跟随，
// 状态主键统一 repo_rtype（state.ts），LAST_TYPE_KEY 仅历史兼容。

const TOAST_MS_LONG = 5000;

/** 按需加载当前 rtype 的 FilesRoot 仓库根路径（缓存到 _repoRoots，供 renderer 建树时扫描子条目） */
async function loadRepoRoots(self: SyncManagerSelf, rtype: string): Promise<void> {
  if (self._repoRoots[rtype]) return;
  try {
    const { GetRepoRoot } = await getApp();
    self._repoRoots[rtype] = (await GetRepoRoot(rtype || "")) || "";
  } catch {
    self._repoRoots[rtype] = "";
  }
}

export class AppSyncManager extends WebComponentBase {
  static get observedAttributes(): string[] {
    return ["instance", "default-type"];
  }

  private _instance = "";
  private _defaultType = RESOURCE_TYPES.YSM;
  private _selectedType = RESOURCE_TYPES.YSM;
  private _statusFilter = "all";
  private _subdirFilter = "";
  private _allItems: SyncItem[] = [];
  private _filteredItems: SyncItem[] = [];
  private _typeConfig: Array<{ id: string; name?: string; icon?: string }> = [];
  private _loading = false;
  private _gen = 0;
  private _unsubs: Array<() => void> = [];
  private _singleBusy = false;
  private _dirOpen: Record<string, boolean> = {};
  private _repoRoots: Record<string, string> = {};

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
    await loadRepoRoots(self, this._selectedType);

    if (gen !== this._gen || !this.isConnected) return;

    this._loading = false;
    try {
      // 初始化时从 localStorage 同步全局 MMD 子目录选择
      const savedSubdir = safeGet("repo_subdir") || "";
      if (savedSubdir && this._selectedType === RESOURCE_TYPES.MMD) {
        this._subdirFilter = savedSubdir;
      }
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
        .then(async () => {
          if (gen !== this._gen) return;
          await loadRepoRoots(self, this._selectedType);
          dbg("sync-manager", "_loadData 完成, items:", this._allItems ? this._allItems.length : 0);
          this._doRender();
        })
        .catch((err) => {
          console.warn("[sync-manager] stats:refresh 重载失败:", err);
        });
    });
    this._unsubs.push(unsub);

    // 全局焦点跟随（ADR-095 后续：sm-tabs 移除，类型切换归 app-nav 下拉）：
    // nav 切类型 → 重载该类型同步数据 + 重渲染；自身点击已不再触发此事件（sm-tab 已删），
    // 但仍保留 rt === _selectedType 防重入守卫（防未来其他发射源）。
    const unsubRtype = bus.on("repo:rtype-changed", (rt: string) => {
      if (!this.isConnected) return;
      if (!rt || rt === this._selectedType) return;
      this._selectedType = rt;
      setLastSelectedType(rt);
      this._statusFilter = "all";
      this._subdirFilter = ""; // 切类型重置子目录过滤（非 mmd 类型 subdir 无意义）
      const gen = this._gen;
      loadData(self)
        .then(async () => {
          if (gen !== this._gen) return;
          // 类型切换时重新加载类型配置，确保 _typeConfig 反映最新注册表（dirLevelSync 等字段生效）
          await loadTypeConfig(self);
          await loadRepoRoots(self, rt);
          this._doRender();
        })
        .catch((err) => {
          console.warn("[sync-manager] rtype 跟随重载失败:", err);
        });
    });
    this._unsubs.push(unsubRtype);

    // MMD 子目录过滤（ADR-095 后续）：app-nav MMD 下拉选子目录 → 仅显示该组。
    // 仅过滤重渲染（无需重载数据）；非 MMD 类型 app-nav 发射 subdir="" 自然重置。
    const unsubSubdir = bus.on("repo:subdir-changed", (subdir: string) => {
      if (!this.isConnected) return;
      const want = subdir || "";
      if (want === this._subdirFilter) return;
      this._subdirFilter = want;
      this._doRender();
    });
    this._unsubs.push(unsubSubdir);

  }

  /** 渲染 + 事件绑定的统一入口（供 _init 和 stats:refresh 复用） */
  private _doRender(): void {
    const self = this as unknown as SyncManagerSelf;
    const doLoadData = () => loadData(self);
    const doEmitStats = () => bus.emit("stats:refresh");

    // render 已改为 async（内部 await renderList，确保列表 HTML 就绪后再绑事件）
    render(self)
      .then(() => {
        bindEvents(self, {
          doRender: () => this._doRender(),
          doPerformOp: (op, path) => performSingleOp(self, op, path, {
            doLoadData,
            doRender: () => this._doRender(),
            doEmitStats,
          }),
        });
      })
      .catch((e) => console.error("[sync-manager] render 失败:", e));
  }
}

if (typeof customElements !== "undefined" && !customElements.get("app-sync-manager")) {
  customElements.define("app-sync-manager", AppSyncManager);
}
