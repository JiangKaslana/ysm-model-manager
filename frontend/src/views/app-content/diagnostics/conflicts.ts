// ===== 诊断页：冲突扫描（scanConflicts） =====
// ADR-040 按职责切文件：原 init.ts 拆分——日志加载（logs.ts）/ 去重（dedup.ts）/ 冲突扫描（本文件）
import { t } from "../../../core/i18n/t.ts";
import { bus } from "../../../bus.ts";
import { getApp } from "../../../backend/app.ts";
import { renderDisplayName } from "../../../utils/dom/display.ts";
import { RESOURCE_TYPES, RESOURCE_TYPE_LABELS } from "../../../utils/resource/types.ts";
import { resolveWebMode } from "../../../backend/platform.ts";
import { stagger } from "../../../utils/animation/stagger.ts";
import type { EscFn } from "./logs.ts";

// P3 修复（子代理审计，重入守卫）：scanConflicts 并发标志——快速 3 连点会并发扫描
// 同一 list 互相覆盖（结果写 innerHTML 竞争）；busy 命中直接返回
let diagScanning = false;

export async function scanConflicts(root: ShadowRoot, esc: EscFn): Promise<void> {
  // P2-2 修复（web 门控）：冲突扫描依赖 ListVersionInstances/ScanModelEntriesWithLabel 等
  // 桌面绑定（网页版 browser adapter 未实现 → fail-fast 抛错），web 模式 UI 显示但点击必败——
  // 入口直接提示返回（对齐同文件 diag-clear 的 isViewerMode 门控 toast 写法）
  if (resolveWebMode()) {
    bus.emit("toast:show", {
      msg: "网页版不支持冲突扫描",
      duration: 3000,
      type: "warn",
    });
    return;
  }
  const list = root.getElementById("diag-conflict-list");
  if (!list) return;
  // P3 修复（子代理审计，重入守卫）：在途扫描时丢弃重复点击（快速 3 连点防并发）
  if (diagScanning) return;
  diagScanning = true;
  // 扫描按钮雷达动画
  const scanBtn = root.getElementById("diag-scan-conflict") as HTMLElement | null;
  const resetBtn = (): void => {
    if (scanBtn) {
      scanBtn.classList.remove("scanning");
      scanBtn.textContent = t("diagnostics.startScan");
    }
  };
  if (scanBtn) {
    scanBtn.classList.add("scanning");
    scanBtn.textContent = t("diagnostics.scanningDot");
  }
  list.innerHTML =
    '<div class="scan-radar-wrap"><div class="scan-radar"></div><div class="scan-radar-dot"></div></div><div class="stat-row diag-msg diag-msg-muted" style="text-align:center">' +
    t("diagnostics.scanningConflicts") +
    "</div>";
  try {
    const { LoadAppConfig, ListVersionInstances, ScanModelEntriesWithLabel } =
      await getApp();
    const cfg = await LoadAppConfig();
    const mcRoot = cfg.mcRoot || "";
    if (!mcRoot) {
      resetBtn();
      list.innerHTML =
        '<div class="stat-row diag-msg diag-msg-error">' + t("diagnostics.configGameDir") + "</div>";
      return;
    }

    const instances = (await ListVersionInstances(mcRoot)) || [];
    if (!instances || !instances.length) {
      resetBtn();
      list.innerHTML =
        '<div class="stat-row diag-msg diag-msg-muted">' + t("diagnostics.noModpacks") + "</div>";
      return;
    }

    interface InstanceFile {
      name: string;
    }
    const instanceFiles: Record<string, InstanceFile[]> = {};
    for (const ins of instances) {
      if (!ins.Exists) continue;
      const entries = (await ScanModelEntriesWithLabel(ins.CustomDir, RESOURCE_TYPE_LABELS[RESOURCE_TYPES.YSM])) || [];
      instanceFiles[ins.Name] = entries.map((e) => ({
        name: e.Name.replace(/\.(disabled|ban)$/i, ""),
      }));
    }

    const nameMap: Record<string, string[]> = {};
    for (const [insName, files] of Object.entries(instanceFiles)) {
      for (const f of files) {
        if (!nameMap[f.name]) nameMap[f.name] = [];
        nameMap[f.name].push(insName);
      }
    }

    const conflicts = Object.entries(nameMap)
      .filter(([, v]) => v.length > 1)
      .sort((a, b) => b[1].length - a[1].length);

    if (!conflicts.length) {
      resetBtn();
      list.innerHTML =
        '<div class="stat-row diag-msg diag-msg-success">✅ ' + t("diagnostics.noNameConflict") + "</div>";
      return;
    }

    let html = `<div class="stat-row diag-msg diag-msg-error" style="animation:conflictRowIn .3s ease">⚠️ ${t("diagnostics.conflictsFound", { n: conflicts.length })}</div>`;
    conflicts.slice(0, 50).forEach(([name, insNames], i) => {
      const delay = stagger(i, 30, 600);
      html += `<div class="conflict-row" style="animation-delay:${delay}ms">
<span class="conflict-name">${renderDisplayName(name)}</span>
<span class="conflict-ver">${t("diagnostics.modpackCount", { n: insNames.length })}</span>
</div>`;
      insNames.forEach((n, j) => {
        html += `<div class="conflict-ins" style="animation-delay:${delay + (j + 1) * 15}ms">&nbsp;&nbsp;📦 ${esc(n)}</div>`;
      });
    });
    if (conflicts.length > 50) {
      html += `<div class="stat-row diag-msg diag-msg-muted" style="font-size:10px">...${t("diagnostics.moreCount", { n: conflicts.length - 50 })}</div>`;
    }
    resetBtn();
    list.innerHTML = html;
  } catch (err) {
    resetBtn();
    list.innerHTML = `<div class="stat-row diag-msg diag-msg-error">${t("diagnostics.scanFailed")}: ${esc(String(err))}</div>`;
  } finally {
    diagScanning = false; // P3：所有出口复位重入标志（含 early return 分支）
  }
}

// ===== 同步冲突检测与解决（P1 优先级） =====

// 同步冲突扫描并发标志
let diagSyncBusy = false;

// 存储当前检测到的冲突
let _syncConflicts: any[] = [];
let _syncRtype = "";
let _syncInstanceName = "";

export async function scanSyncConflicts(
  list: HTMLElement,
  esc: EscFn,
  rtype?: string,
  instanceName?: string,
): Promise<void> {
  if (resolveWebMode()) {
    bus.emit("toast:show", {
      msg: "网页版不支持同步冲突扫描",
      duration: 3000,
      type: "warn",
    });
    return;
  }

  if (diagSyncBusy) return;
  diagSyncBusy = true;

  try {
    const { DetectConflicts, ListVersionInstances, LoadAppConfig } = await getApp();

    // 获取可用的整合包列表
    const cfg = await LoadAppConfig();
    const mcRoot = cfg.mcRoot || "";
    if (!mcRoot) {
      list.innerHTML =
        '<div class="stat-row diag-msg diag-msg-error">' + t("diagnostics.configGameDir") + "</div>";
      return;
    }

    const instances = (await ListVersionInstances(mcRoot)) || [];
    const availableInstances = instances.filter((ins: any) => ins.Exists).map((ins: any) => ins.Name);

    // 如果没有指定参数，显示配置面板
    if (!rtype || !instanceName) {
      renderSyncConfigPanel(list, esc, availableInstances);
      return;
    }

    // 执行扫描
    list.innerHTML =
      '<div class="scan-radar-wrap"><div class="scan-radar"></div><div class="scan-radar-dot"></div></div><div class="stat-row diag-msg diag-msg-muted" style="text-align:center">' +
      t("diagnostics.scanningConflicts") +
      "</div>";

    const resultJSON = await DetectConflicts(rtype, instanceName);
    const result = JSON.parse(resultJSON);

    if (result.error) {
      list.innerHTML =
        '<div class="stat-row diag-msg diag-msg-error">❌ ' + esc(result.error) + "</div>";
      return;
    }

    const conflicts = result.conflicts || [];
    _syncConflicts = conflicts;
    _syncRtype = rtype;
    _syncInstanceName = instanceName;

    if (conflicts.length === 0) {
      list.innerHTML =
        '<div class="stat-row diag-msg diag-msg-success">✅ ' + t("diagnostics.noSyncConflict") + "</div>";
      return;
    }

    renderSyncConflictsResult(list, esc, conflicts, rtype, instanceName);
  } catch (err) {
    list.innerHTML =
      `<div class="stat-row diag-msg diag-msg-error">${t("diagnostics.scanFailed")}: ${esc(String(err))}</div>`;
  } finally {
    diagSyncBusy = false;
  }
}

function renderSyncConfigPanel(
  list: HTMLElement,
  esc: EscFn,
  instances: string[],
): void {
  // 默认选中第一个整合包和第一个资源类型
  let selectedInstance = instances[0] || "";
  const rtypeOptions = Object.entries(RESOURCE_TYPE_LABELS);
  let selectedRtype = rtypeOptions[0]?.[0] || "";

  const renderPanel = () => {
    const instanceOptions = instances
      .map((ins) => `<option value="${esc(ins)}"${ins === selectedInstance ? " selected" : ""}>${esc(ins)}</option>`)
      .join("");

    const rtypeSelectOptions = rtypeOptions
      .map(([id, label]) => `<option value="${esc(id)}"${id === selectedRtype ? " selected" : ""}>${esc(label)}</option>`)
      .join("");

    list.innerHTML = `
      <div class="diag-sync-config">
        <div class="diag-config-item">
          <label for="sync-rtype">📦 ${t("diagnostics.selectResourceType")}:</label>
          <select id="sync-rtype" class="diag-config-select">
            ${rtypeSelectOptions}
          </select>
        </div>
        <div class="diag-config-item">
          <label for="sync-instance">🎮 ${t("diagnostics.selectInstance")}:</label>
          <select id="sync-instance" class="diag-config-select">
            ${instanceOptions}
          </select>
        </div>
        <button id="sync-scan-btn" class="diag-dedup-exec">🔍 ${t("diagnostics.scanSyncConflict")}</button>
      </div>
    `;

    list.querySelector("#sync-rtype")?.addEventListener("change", (e) => {
      selectedRtype = (e.target as HTMLSelectElement).value;
    });

    list.querySelector("#sync-instance")?.addEventListener("change", (e) => {
      selectedInstance = (e.target as HTMLSelectElement).value;
    });

    list.querySelector("#sync-scan-btn")?.addEventListener("click", async () => {
      await scanSyncConflicts(list, esc, selectedRtype, selectedInstance);
    });
  };

  renderPanel();
}

function renderSyncConflictsResult(
  list: HTMLElement,
  esc: EscFn,
  conflicts: any[],
  rtype: string,
  instanceName: string,
): void {
  let html = `<div class="stat-row diag-msg diag-msg-error">⚠️ ${t("diagnostics.syncConflictFound", { n: conflicts.length })}</div>`;

  conflicts.forEach((c, i) => {
    const conflictTypeLabel = c.type === "content_modified"
      ? t("diagnostics.conflictTypeContent")
      : t("diagnostics.conflictTypeBoth");

    const suggestedLabel = c.suggestedStrategy === "force_remote"
      ? t("diagnostics.resolveForceRemote")
      : c.suggestedStrategy === "force_local"
      ? t("diagnostics.resolveForceLocal")
      : t("diagnostics.resolveManual");

    const delay = stagger(i, 30, 600);
    html += `<div class="conflict-row" style="animation-delay:${delay}ms">
<span class="conflict-name">${esc(c.path)}</span>
<span class="conflict-ver">${conflictTypeLabel}</span>
</div>`;
    html += `<div class="conflict-ins" style="animation-delay:${delay + 15}ms">
&nbsp;&nbsp;📏 ${esc(String(c.localSize))} ↔ ${esc(String(c.remoteSize))} | 💡 ${suggestedLabel}
</div>`;
  });

  // 解决策略选择
  html += `<div class="diag-sync-resolve" style="margin-top:16px;padding:12px;background:var(--diag-stat-bg);border-radius:8px">
<div class="diag-config-item">
  <label for="resolve-strategy">🎯 ${t("diagnostics.resolveConflicts")}:</label>
  <select id="resolve-strategy" class="diag-config-select">
    <option value="force_remote">${t("diagnostics.resolveForceRemote")}</option>
    <option value="force_local">${t("diagnostics.resolveForceLocal")}</option>
    <option value="manual">${t("diagnostics.resolveManual")}</option>
  </select>
</div>
<button id="do-resolve-btn" class="diag-dedup-exec" style="margin-top:8px">✅ ${t("diagnostics.resolveConflicts")}</button>
</div>`;

  list.innerHTML = html;

  list.querySelector("#do-resolve-btn")?.addEventListener("click", async () => {
    const strategyEl = list.querySelector("#resolve-strategy") as HTMLSelectElement;
    const strategy = strategyEl?.value || "force_remote";

    try {
      const { ResolveConflicts } = await getApp();
      const conflictsJSON = JSON.stringify(conflicts);
      const resultJSON = await ResolveConflicts(conflictsJSON, strategy, rtype, instanceName);
      const result = JSON.parse(resultJSON);

      let resultMsg = `✅ ${t("diagnostics.resolvedCount", { n: result.resolved || 0 })}`;
      if (result.failed > 0) resultMsg += ` | ❌ ${t("diagnostics.failedCount", { n: result.failed })}`;
      if (result.manual > 0) resultMsg += ` | ⚠️ ${t("diagnostics.manualCount", { n: result.manual })}`;

      if (result.error) {
        list.innerHTML = `<div class="stat-row diag-msg diag-msg-error">❌ ${esc(result.error)}</div>`;
      } else {
        list.innerHTML += `<div class="stat-row diag-msg diag-msg-success" style="margin-top:12px">${resultMsg}</div>`;
        // 重新扫描
        setTimeout(() => scanSyncConflicts(list, esc, rtype, instanceName), 1500);
      }
    } catch (err) {
      list.innerHTML += `<div class="stat-row diag-msg diag-msg-error" style="margin-top:12px">❌ ${esc(String(err))}</div>`;
    }
  });
}
