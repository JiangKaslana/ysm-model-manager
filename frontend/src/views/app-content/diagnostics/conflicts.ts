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
