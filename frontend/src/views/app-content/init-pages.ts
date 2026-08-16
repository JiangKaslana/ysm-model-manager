// ===== 页面初始化函数集合（为 app-content/index.ts 减负，ADR-040）=====
import { bus } from "../../bus.ts";
import { initDiagnostics } from "./diagnostics/init.ts";
import { initSettings } from "./settings/init.ts";
import { initImportQueue } from "../../features/import-queue.ts";
import { initRecycleBin } from "../../features/recycle-bin.ts";
import { loadOldestModel } from "../../features/oldest-models.ts";
import { startDedup } from "./diagnostics/init.ts";
import { RESOURCE_TYPES } from "../../utils/resource/types.ts";
import { safeGet } from "../../utils/dom/storage.ts";
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

  // 资源类型 subtab 切换（全局生效）
  const root = host._root;
  const subtabs = root.querySelectorAll(".repo-subtab");
  const treeBody = root.getElementById("repo-tab-tree");
  let curRtype = safeGet("repo_rtype") || RESOURCE_TYPES.YSM;

  // 统一应用资源类型：无条件重建 tree + 更新 active，仅真正变化时写 localStorage + emit。
  // （审核修复：原 click 里 `if (rtype === curRtype) return` 早退 + 初始化 savedTab.click()
  //  的组合，在 localStorage 存非默认 rtype 时初始化 click 被早退拦截——tree 停在模板写死的
  //  ysm、active 错位、curRtype 却已是非默认值；用户点当前 rtype 对应按钮时二次被早退拦截，
  //  表现为「首次点击无反应，必须点另一个资源按钮才刷新」。去早退，改为无条件应用。）
  const applyRtype = (rtype: string): void => {
    const prev = curRtype;
    curRtype = rtype;
    try {
      localStorage.setItem("repo_rtype", rtype);
    } catch {}
    subtabs.forEach((t) => {
      t.classList.toggle("active", (t as HTMLElement).dataset.rtab === rtype);
    });
    // 更新文件树（预览已在外层共享，不重复创建）
    if (treeBody) {
      treeBody.innerHTML =
        '<app-tree root="' +
        rtype +
        '" style="flex:1;min-width:0"></app-tree>';
    }
    // 通知其他 tab（仅当 rtype 真正变化时）
    if (rtype !== prev) {
      bus.emit("repo:rtype-changed", rtype);
    }
  };
  subtabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      applyRtype((btn as HTMLElement).dataset.rtab || "");
    });
  });
  // 初始化：应用 curRtype（对齐 tree + active——模板 tree root 写死 ysm，localStorage 可能存别的）
  applyRtype(curRtype);
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
