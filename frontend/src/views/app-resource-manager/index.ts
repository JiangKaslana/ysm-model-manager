// ===== 资源管理器 Web Component =====
// 通用资源管理（资源包/光影包/未来类型）
// 使用: <app-resource-manager rtype="resourcepack"></app-resource-manager>

import { sidebarHTML, itemHTML, detailHTML, placeholderHTML, type PackMetaDetail } from "./tpl.ts";
import { t } from "../../core/i18n/t.ts";
import { bus } from "../../bus.ts";
import { RESOURCE_TYPES } from "../../utils/resource/types.ts";
import { getApp } from "../../backend/app.ts";
import { isViewerMode } from "../../utils/dom/android-bridge.ts";
import { resolveAndroidRepoDir } from "../../utils/dom/directory-picker.ts";
import { esc } from "../../utils/dom/html.ts";
import { safeErrorMessage } from "../../utils/safe-error-msg.ts";
import { WebComponentBase } from "../../utils/dom/web-component-base.ts";
import { modalConfirm } from "../../utils/dom/dialogs/modal.ts";

/** 资源类型配置（resource_types.json 条目视图） */
interface ResourceTypeConfig {
  id: string;
  name?: string;
  icon?: string;
  actions?: string[];
  extensions?: string[];
  installDir?: string;   // 可选：已废弃，保留兼容
  instanceDir?: string;  // 整合包内实际存放目录
  isDir?: boolean;
}

/** 资源列表项 */
interface PackEntry {
  name: string;
  path: string;
  enabled: boolean;
}

const STORE: { _config: ResourceTypeConfig[] | null } = {
  _config: null,
}; // 模块级缓存（rtype → config）

async function _loadConfig(forceRefresh?: boolean): Promise<ResourceTypeConfig[]> {
  if (!forceRefresh && STORE._config) return STORE._config;
  const { LoadResourceTypes } = await getApp();
  const raw = await LoadResourceTypes();
  try {
    const parsed = JSON.parse(raw) as { resourceTypes?: ResourceTypeConfig[] };
    STORE._config = parsed.resourceTypes || [];
  } catch {
    STORE._config = [];
  }
  return STORE._config;
}

/**
 * 全局配置刷新监听：registerGlobalHandlers 统一收集 unsub
 * （替代顶层无守卫注册 — ADR-008 违规点，TS 化后收敛）
 * F8 修复：仅清模块缓存——组件生产零实例（initResourcePacks 调用点已删），且
 * document.querySelectorAll 不穿透 Shadow DOM，原「刷新所有实例」恒空转；
 * 缓存清空后实例下次 _init（_loadConfig 走缓存）自动重新拉取。
 */
export function registerResourceManagerGlobal(unsubs: Array<() => void>): void {
  unsubs.push(
    bus.on("config:updated", () => {
      STORE._config = null;
    }),
  );
}

function _findType(rtype: string): ResourceTypeConfig | undefined {
  return (STORE._config || []).find((t) => t.id === rtype);
}

function _esc(s: unknown): string {
  return esc(String(s ?? ""));
}

export class AppResourceManager extends WebComponentBase {
  static get observedAttributes(): string[] {
    return ["rtype", "instance"];
  }

  private _rtype: string;
  private _instance: string;
  private _typeLabel = "";
  private _typeIcon = "";
  private _actions: string[] = [];
  private _rpRoot = "";
  private _listEl: HTMLElement | null = null;
  private _contentEl: HTMLElement | null = null;
  private _packsCache: PackEntry[] = []; // 完整列表缓存（供搜索过滤）
  private _initGen = 0; // generation 守卫：rtype/instance 连变时作废在途 _init 的回写
  private _detailGen = 0; // generation 守卫：快速点列表项时作废在途 _showDetail 的回写
  // P3 修复（审核发现）：操作互斥守卫——import/openFolder/toggle 双击并发触发两次
  // 文件对话框/复制/改名（同名文件 rename 竞争，二次调用可能 FileNotFound→toast）
  private _opBusy = false;

  constructor() {
    super();
    this._rtype = this.getAttribute("rtype") || RESOURCE_TYPES.PACK;
    this._instance = this.getAttribute("instance") || "";
  }

  async connectedCallback(): Promise<void> {
    // P2 修复：_init 内部已闭环（try/catch + _initGen 守卫）永不 reject，
    // 外层 .catch 是无代际守卫的死代码陷阱，直接 void 调用
    void this._init();
  }

  attributeChangedCallback(name: string, oldVal: string | null, newVal: string | null): void {
    if (oldVal === newVal || !this.isConnected) return;
    if (name === "rtype") {
      this._rtype = newVal || RESOURCE_TYPES.PACK;
      // P2 修复：_init 内部已闭环永不 reject，外层 .catch 是无代际守卫死代码，直接 void 调用
      void this._init();
    } else if (name === "instance") {
      this._instance = newVal || "";
      // P2 修复：同上，_init 内部已闭环，直接 void 调用
      void this._init();
    }
  }

  // P2 修复（TS 深层扫描）：生命周期成对（治理红线 frontend AGENTS.md「connected/
  // disconnectedCallback 必须成对」）。本组件为 light DOM、无 document/window 监听与
  // 定时器（config:updated bus 订阅走 registerResourceManagerGlobal 全局注册，由
  // app-content 统一回收，非实例级），disconnected 无需逐项清理；递增 _initGen 使
  // 在途 _init/_loadList 代际过期，卸载后不再向（可能被复用的）容器写回渲染结果。
  disconnectedCallback(): void {
    this._initGen++;
  }

  async _init(): Promise<void> {
    const gen = ++this._initGen;
    // P2 修复（子代理审计）：rtype 切换/config:updated 触发的重渲染必须使在途
    // _showDetail 过期——否则 await ReadPackMeta 期间切换 rtype，旧详情写回时
    // gen === _detailGen 仍成立，把旧 rtype 条目的详情写入新面板（stale-async-
    // overwrites-newer 同类，与 _applyFilter 的 _detailGen++ 对齐）
    this._detailGen++;
    try {
      await this._initInner(gen);
    } catch (e) {
      // P2 修复（code_review）：错误渲染移入 _init 内部并带 _initGen 守卫——
      // 原调用方 .catch 无条件写 innerHTML，rtype X→Y→Z 快速切换时 gen1(X) 失败迟到
      // 会覆盖已成功渲染的 Y 面板（stale-async-overwrites-newer 同类缺陷）
      console.error("[app-resource-manager] _init 失败:", e);
      if (gen === this._initGen) {
        this.innerHTML =
          '<div style="padding:12px;color:var(--paid)">⚠️ ' +
          t("resource.initFailed") + ": " +
          _esc(String((e as { message?: unknown })?.message || e)) +
          "</div>";
      }
    }
  }

  private async _initInner(gen: number): Promise<void> {
    await _loadConfig();
    if (gen !== this._initGen) return; // 过期：已有更新的 _init 发起
    const type = _findType(this._rtype);
    if (!type) {
      this.innerHTML =
        '<div style="padding:12px;color:var(--paid)">⚠️ ' +
        t("rm.unknownType", { type: _esc(this._rtype) }) +
        "</div>";
      return;
    }
    this._typeLabel = type.name || this._rtype;
    this._typeIcon = type.icon || "📦";
    this._actions = type.actions || [
      "import",
      "toggle",
      "delete",
      "openFolder",
    ];

    const {
      GetRepoRoot,
      ReadPackMeta,
      ScanModelEntries,
      ToggleResourcePack,
      IsResourcePackEnabled,
      SelectImportZip,
      SelectImportFile,
      ImportByType,
      DeleteResourcePack,
      OpenFolder,
    } = await getApp();
    if (gen !== this._initGen) return;

    // 实例隔离路径：当 instance 属性存在时，从 mcRoot + instanceDir 推导
    let rpRoot = "";
    if (this._instance && type.instanceDir) {
      const { LoadAppConfig, ListVersionInstances } =
        await getApp();
      const cfg = await LoadAppConfig();
      const mcRoot = cfg.mcRoot || "";
      if (mcRoot) {
        const all = await ListVersionInstances(mcRoot);
        const match = (all || []).find((i) => i.Name === this._instance);
        const relPath = type.instanceDir.replace(/\/$/, "");
        if (match) {
          rpRoot = relPath
            ? match.VersionDir + "/" + relPath
            : match.VersionDir;
        } else {
          rpRoot = relPath
            ? mcRoot + "/" + relPath
            : mcRoot;
        }
      }
      // mcRoot 为空：rpRoot 保持默认 ""
    } else {
      rpRoot = await GetRepoRoot(this._rtype);
    }
    if (gen !== this._initGen) return;
    this._rpRoot = rpRoot; // 代际校验通过后统一提交
    if (!this._rpRoot) {
      this.innerHTML =
        '<div class="dp-placeholder" style="display:flex;align-items:center;justify-content:center;flex-direction:column;color:var(--muted);font-size:12px;gap:8px;height:100%">' +
        '<div style="font-size:24px">⚠️</div>' +
        "<div>" +
        t("rm.notSetPath", { label: _esc(this._typeLabel) }) +
        "</div>" +
        '<div style="font-size:10px">' +
        t("rm.configureDirFirst", { label: _esc(this._typeLabel) }) +
        "</div>" +
        "</div>";
      return;
    }

    this.innerHTML =
      '<div class="repo-layout" style="height:100%">' +
      sidebarHTML(this._rpRoot, this._actions, this._typeLabel) +
      '<div class="rm-content" style="flex:1;overflow-y:auto;padding:12px">' +
      placeholderHTML(this._typeLabel) +
      "</div>" +
      "</div>";

    this._listEl = this.querySelector(".rm-list");
    this._contentEl = this.querySelector(".rm-content");

    // 绑定操作
    if (this._actions.includes("import")) {
      this.querySelector(".rm-import-btn")?.addEventListener(
        "click",
        async () => {
          // P3 修复：双击并发守卫——连点两次会弹两次文件对话框/复制两遍
          if (this._opBusy) return;
          this._opBusy = true;
          try {
            const type = _findType(this._rtype);
            const exts = (type && type.extensions) || [".zip"];
            const isZip = exts.every((e) => e === ".zip");
            let filePath: string;
            if (isZip) {
              filePath = await SelectImportZip();
            } else {
              const filter = (type ? type.name : "") + "|" + exts.map((e) => "*" + e).join(";");
              filePath = await SelectImportFile(filter, "选择" + (type ? type.name : ""));
            }
            if (!filePath) return;
            const errMsg = await ImportByType(this._rtype, filePath);
            if (errMsg) {
              this._toast("error", "导入失败", errMsg);
              return;
            }
            await this._loadList();
            this._toast(
              "ok",
              "导入成功",
              "已复制到 " + this._typeLabel + " 目录",
            );
          } catch (e) {
            this._toast("error", "导入失败", safeErrorMessage(e));
          } finally {
            this._opBusy = false;
          }
        },
      );
    }

    if (this._actions.includes("openFolder")) {
      this.querySelector(".rm-open-btn")?.addEventListener(
        "click",
        async () => {
          // P3 修复：双击并发守卫（与 import 对齐）
          if (this._opBusy) return;
          this._opBusy = true;
          try {
            // 查看器模式（Android/网页版）：OpenFolder 由 Go 守卫报错/浏览器无文件
            // 管理器 → 接 resolveAndroidRepoDir 定位仓库目录并提示路径
            if (isViewerMode()) {
              await resolveAndroidRepoDir();
              return;
            }
            await OpenFolder(this._rpRoot);
          } catch (e) {
            this._toast("error", "打开文件夹失败", safeErrorMessage(e));
          } finally {
            this._opBusy = false;
          }
        },
      );
    }

    // 列表点击
    this._listEl?.addEventListener("click", async (e) => {
      const target = e.target as HTMLElement | null;
      const item = target ? target.closest(".rm-item") : null;
      if (!item) return;

      try {
        // 切换
        if (this._actions.includes("toggle") && target && target.closest(".rm-toggle")) {
          // P3 修复：toggle 双击并发守卫——同名文件 rename 竞争，二次调用可能 FileNotFound
          if (this._opBusy) return;
          this._opBusy = true;
          try {
            // P1 修复：无论成功失败都刷新列表，保持 UI 同步
            const ok = await ToggleResourcePack((item as HTMLElement).dataset.path || "");
            if (!ok) {
              this._toast("error", t("rm.toggleFailed") || "切换失败");
            }
            await this._loadList();
          } finally {
            this._opBusy = false;
          }
          return;
        }

        // 选中
        this._listEl
          ?.querySelectorAll(".rm-item")
          .forEach((el) => (el as HTMLElement).style.background = "");
        (item as HTMLElement).style.background = "var(--hover)";
        await this._showDetail(
          (item as HTMLElement).dataset.path || "",
          (item as HTMLElement).dataset.name || "",
        );
      } catch (e) {
        this._toast("error", "操作失败", safeErrorMessage(e));
      }
    });

    // 搜索过滤
    const searchInput = this.querySelector(".rm-search") as HTMLInputElement | null;
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        this._applyFilter(searchInput.value);
      });
    }

    if (gen === this._initGen) await this._loadList();
  }

  async _loadList(): Promise<void> {
    if (!this._listEl) return;
    // 复用 _init 的 generation：await 期间 rtype/instance 变化时，旧结果不得回写新 DOM
    const gen = this._initGen;
    const { ScanModelEntriesWithLabel, IsResourcePackEnabled } =
      await getApp();
    const entries = await ScanModelEntriesWithLabel(this._rpRoot, this._typeLabel);
    if (gen !== this._initGen) return;
    // 从 resource_types.json 获取当前类型的扩展名列表
    const type = _findType(this._rtype);
    const exts = (type && type.extensions) || [".zip"];
    // 先按扩展名过滤（.disabled 后缀去后缀后判断）
    const filtered = (entries || []).filter((e) => {
      const lower = (e.Name || "").toLowerCase().replace(/\.disabled$/, "");
      return exts.some((ext) => lower.endsWith(ext));
    });
    // 并发查询启用状态（逐项串行在数百资源目录下明显卡顿；单项失败不阻塞整体）
    const enabledMap = new Map<string, boolean>();
    if (this._actions.includes("toggle") && filtered.length) {
      const results = await Promise.all(
        filtered.map((e) => IsResourcePackEnabled(e.Path || "").catch(() => false)),
      );
      filtered.forEach((e, i) => enabledMap.set(e.Path, results[i]));
    }
    const packs: PackEntry[] = filtered.map((e) => {
      const name = e.Name || "";
      const fullPath = e.Path || "";
      return {
        name: name.replace(/\.disabled$/i, ""),
        path: fullPath,
        enabled: this._actions.includes("toggle") ? (enabledMap.get(fullPath) ?? false) : true,
      };
    });
    if (gen !== this._initGen) return; // 过期：不写空态
    if (!packs.length) {
      this._packsCache = [];
      this._listEl.innerHTML =
        '<div style="padding:12px;text-align:center;color:var(--muted)">📭 ' +
        t("rm.emptyType", { label: _esc(this._typeLabel) }) +
        "</div>";
      return;
    }
    if (gen !== this._initGen) return; // 过期：不覆盖新 DOM
    this._packsCache = packs;
    // 如果有搜索关键字，应用过滤
    const searchInput = this.querySelector(".rm-search") as HTMLInputElement | null;
    const q = searchInput ? searchInput.value.toLowerCase().trim() : "";
    this._renderList(q);
  }

  _renderList(query: string): void {
    if (!this._listEl) return;
    const filtered = query
      ? this._packsCache.filter((p) => p.name.toLowerCase().includes(query))
      : this._packsCache;
    const type = _findType(this._rtype);
    const typeIcon = (type && type.icon) || "📦";
    this._listEl.innerHTML = filtered
      .map((p, i) => itemHTML(p.path, p.name, p.enabled, typeIcon, i))
      .join("");
  }

  _applyFilter(value: string): void {
    const q = value.toLowerCase().trim();
    // P2 修复（审核发现）：过滤/搜索时递增 _detailGen——否则在途 _showDetail 完成后
    // 越过 gen 比对（gen 未变）覆盖「搜索中...」为已被过滤掉条目的过期详情
    // （stale-async-overwrites-newer 同类，本文件其它处已显式防）
    this._detailGen++;
    this._renderList(q);
    // 清除选中高亮
    this._listEl
      ?.querySelectorAll(".rm-item")
      .forEach((el) => (el as HTMLElement).style.background = "");
    // 清除详情面板，避免显示与当前列表不匹配的内容
    if (this._contentEl) {
      const typeLabel = this._typeLabel || "";
      this._contentEl.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:center;flex-direction:column;color:var(--muted);font-size:12px;gap:8px;height:100%">' +
        '<div style="font-size:24px">🔍</div>' +
        "<div>" +
        t("rm.searching") +
        "</div>" +
        "</div>";
    }
  }

  async _showDetail(path: string, name: string): Promise<void> {
    if (!this._contentEl) return;
    // generation 守卫：快速点 A（慢）→ B（快）时，A 的 await 返回后不得覆盖 B 的详情
    const gen = ++this._detailGen;
    // 重启入场动画
    this._contentEl.style.animation = "none";
    this._contentEl.innerHTML =
      '<div style="padding:12px;text-align:center;color:var(--muted)">' + t("common.loading") + "</div>";
    this._contentEl.offsetHeight;
    this._contentEl.style.animation = "";
    try {
      // pack_format 不设（shaderpack 无此概念）；describeVersionRange 对 undefined 兜底输出 "?"
      let meta: PackMetaDetail = { description: "", thumbnail: null };
      let displayName = name;
      let enabled = true;

      if (this._rtype === RESOURCE_TYPES.SHADER) {
        // 光影包：从 lang/en_US.lang 提取显示名
        const { ReadShaderpackLang } =
          await getApp();
        const jsonStr = await ReadShaderpackLang(path);
        const spMeta = JSON.parse(jsonStr) as { name?: string; entries?: Record<string, string> };
        if (spMeta.name) displayName = spMeta.name;
        const entries = spMeta.entries || {};
        // 取前几条 option 描述作为简介
        const descs = Object.entries(entries)
          .filter(([k]) => k.includes(".comment"))
          .slice(0, 3)
          .map(([, v]) => v.replace(/§[0-9a-fklmnor]/g, ""))
          .filter(Boolean);
        meta.description = descs.length
          ? descs.join("\n")
          : `📦 光影包 (${Object.keys(entries).length} 项配置)`;
      } else {
        const { ReadPackMeta, IsResourcePackEnabled } =
          await getApp();
        const jsonStr = await ReadPackMeta(path);
        meta = JSON.parse(jsonStr) as PackMetaDetail;
        if (this._actions.includes("toggle")) {
          enabled = await IsResourcePackEnabled(path);
        }
      }

      if (gen !== this._detailGen) return; // 过期：用户已点击其他条目

      this._contentEl.innerHTML = detailHTML(
        displayName,
        meta,
        enabled,
        path,
        this._typeLabel,
        this._actions,
      );

      // 删除
      if (this._actions.includes("delete")) {
        const delBtn = this._contentEl.querySelector(".rm-del-btn") as HTMLElement | null;
        if (delBtn) {
          delBtn.addEventListener("click", async () => {
            // P2 修复（审核）：删除操作纳入 _opBusy + _detailGen 守卫——原实现
            // modalConfirm await 后无代际比对，用户等待期间切到其他条目会删错对象；
            // 连点也会并发执行删除
            if (this._opBusy) return;
            this._opBusy = true;
            const gen = this._detailGen;
            try {
              if (!(await modalConfirm({
                title: "删除资源",
                icon: "🗑️",
                message: `确定要删除 ${name} 吗？`,
                okText: "🗑️ 删除",
                danger: true,
              }))) return;
              if (gen !== this._detailGen) return; // 等待确认期间用户已切换条目
              // 从配置读取 isDir 字段，文件夹型资源（如 EntityPlayer/vrm）删整个目录
              const type = _findType(this._rtype);
              const isDirModel = type && type.isDir;
              const { DeleteResourcePack, DeleteModelDir } =
                await getApp();
              if (gen !== this._detailGen) return; // getApp await 后再次校验
              if (isDirModel) {
                await DeleteModelDir(path);
              } else {
                await DeleteResourcePack(path);
              }
              if (gen !== this._detailGen) return; // 删除完成前用户已切换
              await this._loadList();
              if (this._contentEl) {
                this._contentEl.innerHTML =
                  '<div class="dp-placeholder" style="display:flex;align-items:center;justify-content:center;flex-direction:column;color:var(--muted);font-size:12px;gap:8px;height:100%">' +
                  '<div style="font-size:24px">📦</div>' +
                  "<div>" +
                  t("rm.deleted") +
                  "</div>" +
                  "</div>";
              }
              this._toast("ok", t("rm.deleted"));
            } catch (delErr) {
              this._toast("error", "删除失败", safeErrorMessage(delErr));
            } finally {
              this._opBusy = false;
            }
          });
        }
      }
    } catch (e) {
      if (gen !== this._detailGen) return; // 过期：不覆盖新条目的详情
      if (this._contentEl) {
        this._contentEl.innerHTML =
          '<div style="padding:12px;color:var(--paid)">⚠️ ' +
          t("resource.loadFailed") + ": " +
          _esc(e instanceof Error ? e.message : e) +
          "</div>";
      }
    }
  }

  /** 统一反馈出口：直接走类型化事件总线（不再派发游离 DOM `toast` 事件） */
  private _toast(type: string, title: string, msg?: string): void {
    bus.emit("toast:show", {
      msg: title + (msg ? ": " + msg : ""),
      type: (type === "ok" ? "success" : (type || "info")) as "info" | "success" | "error" | "warn",
      duration: 3000,
    });
  }
}

// 注册组件
if (typeof customElements !== "undefined" && !customElements.get("app-resource-manager")) {
  customElements.define("app-resource-manager", AppResourceManager);
}
