// ===== 页面初始化函数集合（为 app-content/index.ts 减负，ADR-040）=====
import { bus } from "../../bus.ts";
import { initDiagnostics } from "./diagnostics/init.ts";
import { initSettings } from "./settings/init.ts";
import { initImportQueue } from "../../features/import-queue.ts";
import { initRecycleBin } from "../../features/recycle-bin.ts";
import { loadOldestModel } from "../../features/oldest-models.ts";
import { startDedup } from "./diagnostics/init.ts";
import { RESOURCE_TYPES, GROUP_META, GROUP_OF, GROUP_TYPE_OPTIONS, MMD_SUBTYPES } from "../../utils/resource/types.ts";
import { safeGet, safeSet } from "../../utils/dom/storage.ts";
import { t } from "../../core/i18n/t.ts";
import { friendlyError } from "../../utils/dom/errors.ts";
import { initWorkshopPage as _initWorkshopPage } from "./init-workshop.ts";
import { initGithubPage as _initGithubPage } from "./init-github.ts";

/** app-content 组件接口（供页面初始化函数访问） */
export interface AppContentHost {
  _root: ShadowRoot;
  _esc(s: unknown): string;
  _unsubs: Array<() => void>;
}

/**
 * 初始化诊断页
 */
export function initDiagnosticsPage(host: AppContentHost): void {
  initDiagnostics(host._root, (s) => host._esc(s));
}

/**
 * 初始化实例页
 */
export function initInstancesPage(host: AppContentHost): void {
  bindTabs(host, ".repo-tab", "ins", ["versions"]);

  // 只注册一次，避免重复监听
  const insKey = "_insListenerReg";
  if ((host as unknown as Record<string, unknown>)[insKey]) return;
  (host as unknown as Record<string, unknown>)[insKey] = true;

  host._unsubs.push(
    bus.on("package:selected", (pkg) => {
      const content = host._root.getElementById("ins-content");
      if (!content) return;
      const insName = pkg.name || "";
      const defaultType = pkg.rtype || RESOURCE_TYPES.YSM;
      content.innerHTML =
        '<app-sync-manager instance="' +
        String(insName).replace(/"/g, "&quot;") +
        '" default-type="' +
        defaultType +
        '" style="display:flex;flex-direction:column;flex:1;overflow:hidden;height:100%"></app-sync-manager>';
    }),
  );
}

/**
 * 初始化仓库页
 */
export function initRepositoryPage(host: AppContentHost): void {
  bindTabs(host, ".repo-tab", "repo", ["tree", "import", "recycle", "dedup", "oldest"]);

  // ADR-092/094 双下拉导航：大类(group) → 子类型(资源类型/mmd子目录)
  const root = host._root;
  const treeBody = root.getElementById("repo-tab-tree");
  const groupSel = root.getElementById("group-select") as HTMLSelectElement | null;
  const subtypeSel = root.getElementById("subtype-select") as HTMLSelectElement | null;
  let curGroup = "";
  let curRtype = safeGet("repo_rtype") || RESOURCE_TYPES.YSM;
  let curSubdir = ""; // ADR-094 位置路由：mmd 子类型子目录

  // 子类型选项：mmd 用 MMD_SUBTYPES（子目录），其他 group 用 GROUP_TYPE_OPTIONS（资源类型）
  const buildSubtypeOptions = (group: string): Array<{ label: string; rtype: string; subdir: string }> => {
    if (group === "mmd") {
      return MMD_SUBTYPES.map((s) => ({ label: s.label, rtype: RESOURCE_TYPES.MMD, subdir: s.subdir }));
    }
    return (GROUP_TYPE_OPTIONS[group] || []).map((o) => ({ label: o.label, rtype: o.rtype, subdir: "" }));
  };

  // 填充大类下拉（GROUP_META 按 order 排序）
  const groups = Object.entries(GROUP_META)
    .sort((a, b) => a[1].order - b[1].order)
    .map(([gid, meta]) => ({ gid, label: meta.icon + " " + meta.name }));
  if (groupSel) {
    groupSel.innerHTML = groups
      .map((g) => `<option value="${g.gid}">${g.label}</option>`)
      .join("");
  }

  // 填充子类型下拉并返回当前选中项
  const fillSubtypes = (group: string): { label: string; rtype: string; subdir: string } => {
    const opts = buildSubtypeOptions(group);
    const savedRtype = safeGet("repo_rtype") || "";
    const savedSubdir = curSubdir || "";
    let idx = 0;
    const savedIdx = opts.findIndex((o) => o.rtype === savedRtype && o.subdir === savedSubdir);
    if (savedIdx >= 0) idx = savedIdx;
    if (subtypeSel) {
      subtypeSel.innerHTML = opts.map((o, i) => `<option value="${i}">${o.label}</option>`).join("");
      subtypeSel.selectedIndex = idx;
    }
    return opts[idx] || opts[0] || { label: "", rtype: RESOURCE_TYPES.YSM, subdir: "" };
  };

  // 统一应用导航：大类+子类型 → 重建 tree
  const applyNav = (group: string): void => {
    curGroup = group;
    const sel = fillSubtypes(group);
    curRtype = sel.rtype;
    curSubdir = sel.subdir;
    try {
      safeSet("repo_rtype", sel.rtype);
    } catch {}
    if (treeBody) {
      treeBody.innerHTML =
        '<app-tree root="' +
        sel.rtype +
        '"' +
        (sel.subdir ? ' subdir="' + sel.subdir + '"' : "") +
        ' style="flex:1;min-width:0"></app-tree>';
    }
    bus.emit("repo:rtype-changed", sel.rtype);
  };

  // 大类下拉变化 → 联动子类型并重建
  groupSel?.addEventListener("change", () => {
    applyNav(groupSel.value);
  });
  // 子类型下拉变化 → 重建 tree
  subtypeSel?.addEventListener("change", () => {
    const opts = buildSubtypeOptions(curGroup);
    const idx = Number(subtypeSel.value);
    const sel = opts[idx] || opts[0];
    if (!sel) return;
    curRtype = sel.rtype;
    curSubdir = sel.subdir;
    try {
      safeSet("repo_rtype", sel.rtype);
    } catch {}
    if (treeBody) {
      treeBody.innerHTML =
        '<app-tree root="' +
        sel.rtype +
        '"' +
        (sel.subdir ? ' subdir="' + sel.subdir + '"' : "") +
        ' style="flex:1;min-width:0"></app-tree>';
    }
    bus.emit("repo:rtype-changed", sel.rtype);
  });

  // 初始化：从 localStorage 恢复大类 + 子类型
  const savedRtype = safeGet("repo_rtype") || RESOURCE_TYPES.YSM;
  const savedGroup = GROUP_META[GROUP_OF[savedRtype] || ""] ? GROUP_OF[savedRtype] : groups[0]?.gid;
  if (groupSel) groupSel.value = savedGroup || groups[0]?.gid || "";
  curGroup = groupSel?.value || groups[0]?.gid || "";
  const sel = fillSubtypes(curGroup);
  // 若 localStorage 有具体 rtype/subdir，恢复到该子类型
  const savedIdx = (subtypeSel ? Number(subtypeSel.value) : 0) || 0;
  curRtype = sel.rtype;
  curSubdir = sel.subdir;
  if (treeBody) {
    treeBody.innerHTML =
      '<app-tree root="' +
      curRtype +
      '"' +
      (curSubdir ? ' subdir="' + curSubdir + '"' : "") +
      ' style="flex:1;min-width:0"></app-tree>';
  }
}

/**
 * 绑定 tab 按钮切换。按钮选择器与内容卡前缀解耦（样式类可复用，语义前缀独立）：
 *   bindTabs(host, ".repo-tab", "ins", ["versions"]) —— 按钮用 repo-tab 样式类，内容卡 id 为 ins-tab-versions
 */
function bindTabs(
  host: AppContentHost,
  tabSelector: string,
  prefix: string,
  ids: string[],
): void {
  const tabs = host._root.querySelectorAll(tabSelector);
  if (!tabs.length) return;
  const inited: Record<string, boolean> = {};
  tabs.forEach((btn) => {
    btn.addEventListener("click", async () => {
      const tab = (btn as HTMLElement).dataset.tab || "";
      tabs.forEach((t) => t.classList.toggle("active", t === btn));
      ids.forEach((id) => {
        const el = host._root.getElementById(prefix + "-tab-" + id);
        if (el) el.style.display = id === tab ? "" : "none";
      });
      // 首次切换到非默认 tab 时初始化内容
      if (!inited[tab] && tab !== ids[0]) {
        const container = host._root.getElementById(prefix + "-tab-" + tab);
        if (!container) return;
        // P3 修复（审核，陷阱 #3）：懒初始化是 async 链（动态 import / 业务 init），
        // 原在 await 前就置 inited=true 且无 try/catch——动态导入失败或 init 抛错时
        // tab 永久卡死（重试被 inited 拦截）且无用户反馈。先置位防并发重复初始化，
        // catch 中复位以允许重试并 toast 提示（ADR-044 ①：async handler 最外层必有 catch）。
        inited[tab] = true;
        try {
          if (tab === "import") {
            const { downloadsHTML } = await import("./tpl-downloads.ts");
            container.innerHTML = downloadsHTML();
            const importCleanup = initImportQueue(host as never);
            host._unsubs = host._unsubs || [];
            if (importCleanup) host._unsubs.push(importCleanup);
          } else if (tab === "recycle") {
            const { recycleHTML } = await import("./tpl-recycle.ts");
            container.innerHTML = recycleHTML();
            const recycleCleanup = initRecycleBin(host as never);
            host._unsubs = host._unsubs || [];
            if (recycleCleanup) host._unsubs.push(recycleCleanup);
          } else if (tab === "dedup") {
            let dedupType = safeGet("repo_rtype") || RESOURCE_TYPES.YSM;
            container.innerHTML =
              '<div style="display:flex;flex-direction:column;height:100%">' +
              '<div style="display:flex;align-items:center;gap:8px;padding:4px 12px;border-bottom:1px solid var(--bd)">' +
              '<span style="flex:1;font-size:var(--fs-sm);color:var(--muted)">📌 ' + t("dedup.sha256Hint") + '</span>' +
              '<button class="btn-base accent" id="dedup-start-btn">🔗 ' + t("dedup.startDedup") + '</button>' +
              "</div>" +
              '<div id="dedup-result-list" style="flex:1;overflow-y:auto;padding:8px 0"></div>' +
              "</div>";
            const doDedup = (): void => {
              const list = container.querySelector("#dedup-result-list");
              if (list)
                startDedup(
                  list as HTMLElement,
                  (s: unknown) => host._esc(s),
                  dedupType,
                );
            };
            container
              .querySelector("#dedup-start-btn")
              ?.addEventListener("click", doDedup);
            // 全局类型切换时自动重复
            const _unsub = bus.on("repo:rtype-changed", (rt) => {
              if (rt !== dedupType) {
                dedupType = rt;
                doDedup();
              }
            });
            // 组件卸载时清理
            host._unsubs = host._unsubs || [];
            host._unsubs.push(_unsub);
          } else if (tab === "oldest") {
            const oldestCleanup = await loadOldestModel(container, (s) =>
              host._esc(s),
            );
            host._unsubs = host._unsubs || [];
            if (oldestCleanup) host._unsubs.push(oldestCleanup);
          }
        } catch (e) {
          inited[tab] = false;
          bus.emit("toast:show", {
            msg: "❌ " + friendlyError(e, t("common.loadFailed")),
            duration: 4000,
            type: "error",
          });
        }
        // 注意：resourcepacks/shaderpacks/blueprint/MMD/VRC/LITEMATIC 六个
        // initResourcePacks 分支已删除（P2 审计：tpl 无对应 repo-tab 按钮与容器 id，
        // 双重复死不可达；资源类型切换改由 .repo-subtab 重渲染 <app-tree>）。
        // wrapper（features/resource-packs.ts）保留作兼容层，见 resource-packs 知识卡。
      }
    });
  });
}

/**
 * 初始化设置页
 */
export async function initSettingsPage(host: AppContentHost): Promise<void> {
  bindTabs(host, ".stg-tab", "stg", ["basic", "ui", "about", "credits"]);
  try {
    await initSettings(host._root);
  } catch (e) {
    console.error("[settings] 初始化失败:", e);
    bus.emit("toast:show", { msg: "❌ " + friendlyError(e, "设置页初始化失败"), duration: 5000, type: "error" });
  }
}

/**
 * 初始化创意工坊页（委托到 init-workshop.ts）
 */
export function initWorkshopPage(host: never): void {
  _initWorkshopPage(host as never);
}

/**
 * 初始化 GitHub 页（委托到 init-github.ts）
 */
export function initGithubPage(host: never): void {
  _initGithubPage(host as never);
}

// ===== 最近选中模型（供导航栏 3D 一键跳转复用；app-tree 在 model:select 时写入）=====
let _lastModelPath: string | null = null;

/** 记住最后选中的模型路径（供文件树等外部调用） */
export function rememberModelPath(path: string | null): void {
  _lastModelPath = path;
}

export function getLastModelPath(): string | null {
  return _lastModelPath;
}
