// ===== 诊断页：仓库体检（runHealthAudit） =====
// ADR-040 按职责切文件：体检 / 去重（dedup.ts）/ 冲突扫描（conflicts.ts）并列。
// 数据源：Go 端 RepoHealthAudit（go/repoaudit 唯一实现，GUI/CLI 同源消双轨）——
// 前端不再自算健康分，只做展示。
import { t } from "../../../core/i18n/t.ts";
import { getApp } from "../../../backend/app.ts";
import { friendlyError } from "../../../utils/dom/errors.ts";
import type { EscFn } from "./logs.ts";

// 重入守卫：体检扫描大量 await（Walk 全目录 + SHA256），快速连点并发覆盖 innerHTML
let _healthBusy = false;

/** Go 端 repoaudit.HealthReport 的 JSON 结构（字段与 go/repoaudit 对齐） */
interface HealthReport {
  timestamp: string;
  directory: string;
  score: number;
  completeness: {
    checked: number;
    valid: number;
    invalid: number;
    percentage: number;
  };
  cache: {
    cache_dir: string;
    cache_files: number;
    cache_size: number;
    hit_rate: number;
  };
  resources: {
    total_files: number;
    total_size: number;
    by_type: Record<string, number>;
  };
  dedup: {
    groups: number;
    extra_files: number;
    reclaim_bytes: number;
  };
  warnings?: string[];
}

/**
 * 仓库体检：调 Go 端 RepoHealthAudit（同源审计）并渲染结果。
 * @param list 结果容器（#diag-health-list）
 * @param esc HTML 转义函数
 * @param filesRoot 仓库根目录（缺省时后端自行解析；调用方传 GetRepoRoot 的返回值）
 */
export async function runHealthAudit(
  list: HTMLElement,
  esc: EscFn,
  filesRoot: string,
): Promise<void> {
  if (_healthBusy) return;
  _healthBusy = true;
  try {
    list.innerHTML =
      '<div class="stat-row diag-stat diag-stat-muted">⏳ ' + t("diagnostics.healthScanning") + "</div>";

    const { RepoHealthAudit } = await getApp();
    const raw = await RepoHealthAudit(filesRoot || "");
    const report = parseHealthReport(raw);
    if (!report) {
      list.innerHTML =
        '<div class="stat-row diag-msg diag-msg-error">❌ ' +
        esc(friendlyError(new Error(t("diagnostics.healthParseFailed")), t("diagnostics.healthParseFailed"))) +
        "</div>";
      _healthBusy = false;
      return;
    }

    list.innerHTML = renderHealthReport(report, esc);
  } catch (e) {
    // 后端 {error: string} 或调用失败：区分展示
    const msg = isBackendError(e) ? e.message : friendlyError(e, t("diagnostics.healthFailed"));
    list.innerHTML =
      '<div class="stat-row diag-msg diag-msg-error">❌ ' + esc(msg) + "</div>";
  } finally {
    _healthBusy = false;
  }
}

/** 解析 RepoHealthAudit 返回的 JSON 字符串；无效返回 null */
export function parseHealthReport(raw: string): HealthReport | null {
  try {
    const parsed = JSON.parse(raw) as HealthReport;
    if (typeof parsed.score !== "number" || !parsed.completeness) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 后端错误形态：Go 绑定失败返回 {error: string}（与其他绑定契约一致） */
function isBackendError(e: unknown): e is Error & { message: string } {
  return typeof e === "object" && e !== null && "message" in e;
}

/** 渲染体检报告（分数环 + 完整性/缓存/资源/去重 + 警告），全部走 esc() 防注入 */
export function renderHealthReport(r: HealthReport, esc: EscFn): string {
  const score = Math.max(0, Math.min(100, r.score));
  const color = score >= 80 ? "var(--free)" : score >= 60 ? "var(--tag-amber)" : "var(--paid)";
  const label =
    score >= 80 ? t("diagnostics.healthGood") : score >= 60 ? t("diagnostics.healthOk") : t("diagnostics.healthBad");

  const warnings = (r.warnings ?? [])
    .map((w) => '<div class="stat-row diag-warn">⚠️ ' + esc(w) + "</div>")
    .join("");

  return (
    '<div class="health-head" style="display:flex;align-items:center;gap:14px;padding:6px 12px">' +
    '<div class="health-ring" style="width:64px;height:64px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:conic-gradient(' +
    color +
    " " +
    score +
    "%, var(--bd) 0);" +
    '"><div class="health-ring-inner" style="width:52px;height:52px;border-radius:50%;background:var(--bg);display:flex;align-items:center;justify-content:center;flex-direction:column">' +
    '<span style="font-size:18px;font-weight:700;color:var(--txt)">' +
    score +
    '</span><span style="font-size:10px;color:var(--muted)">/100</span></div></div>' +
    '<div style="flex:1;min-width:0">' +
    '<div style="font-weight:600;color:var(--txt)">' +
    label +
    "</div>" +
    '<div style="font-size:var(--fs-sm);color:var(--muted);word-break:break-all">' +
    esc(r.directory) +
    "</div>" +
    "</div></div>" +
    '<div class="stat-row" style="justify-content:space-around;padding:8px 12px;border-top:1px solid var(--bd)">' +
    '<span>📋 ' + t("diagnostics.healthComplete") + " <b>" + formatPct(r.completeness.percentage, esc) + "</b></span>" +
    '<span>💾 ' + t("diagnostics.healthCache") + " <b>" + esc(r.cache.cache_files) + "</b></span>" +
    '<span>🗑️ ' + t("diagnostics.healthDedup") + " <b>" + esc(r.dedup.groups) + "</b></span>" +
    '<span>📦 ' + t("diagnostics.healthFiles") + " <b>" + esc(r.resources.total_files) + "</b></span>" +
    "</div>" +
    '<div class="stat-row" style="flex-direction:column;align-items:stretch;gap:2px;padding:8px 12px;border-top:1px solid var(--bd);font-size:var(--fs-sm);color:var(--muted)">' +
    '<div>✅ ' + t("diagnostics.healthValid") + ": " + esc(r.completeness.valid) + " · ❌ " + t("diagnostics.healthInvalid") + ": " + esc(r.completeness.invalid) + "</div>" +
    '<div>💾 ' + t("diagnostics.healthCacheSize") + ": " + esc(formatSize(r.cache.cache_size)) + (r.cache.hit_rate > 0 ? " · " + t("diagnostics.healthHitRate") + ": " + Math.round(r.cache.hit_rate) + "%" : "") + "</div>" +
    '<div>🗑️ ' + t("diagnostics.healthReclaim") + ": " + esc(formatSize(r.dedup.reclaim_bytes)) + "</div>" +
    "</div>" +
    (warnings ? '<div style="padding:6px 12px;border-top:1px solid var(--bd)">' + warnings + "</div>" : "") +
    '<div class="stat-row diag-stat diag-stat-muted" style="padding:6px 12px">⚙️ ' +
    t("diagnostics.healthSource") +
    "</div>"
  );
}

/** 百分比展示（带小数收敛） */
function formatPct(pct: number, esc: EscFn): string {
  return esc(Number.isFinite(pct) ? pct.toFixed(1) + "%" : "100.0%");
}

/** 字节大小人性化（与 Go 端 formatSize 同口径，纯展示） */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + "B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + "KB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + "MB";
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + "GB";
}