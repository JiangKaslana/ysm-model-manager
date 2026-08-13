// ===== 诊断页：日志加载（操作日志 + 运行时日志） =====
// ADR-040 按职责切文件：原 init.ts（797 行）拆分——日志加载（本文件）/ 去重（dedup.ts）/ 冲突扫描（conflicts.ts）
import { t } from "../../../core/i18n/t.ts";
import { getApp } from "../../../backend/app.ts";
import { renderDisplayName } from "../../../utils/dom/display.ts";

/** 转义函数签名（与组件 _esc 一致） */
export type EscFn = (s: unknown) => string;

// P3 修复（子代理审计，代际守卫）：日志加载模块级序号——刷新/筛选/tab 切换可并发
// 触发 loadDiagnosticsLogs/loadRuntimeLogs，后端慢时旧响应后到会覆盖新响应（用户已
// 切筛选/搜索，列表却显示旧条件结果）；入口捕获 gen，await 后写 DOM 前比对丢弃陈旧
let diagLoadSeq = 0;

/** 绑定 ImportLog（仅用到的字段） */
interface ImportLogLike {
  Status?: string;
  Timestamp?: string | number;
  ModelName?: string;
  TargetDir?: string;
  SourcePath?: string;
  ErrorMsg?: string;
  Operation?: string;
}

/** 操作类型 → 中文标签 + 图标（分组标题与行内徽标共用） */
const OP_META: Record<string, { label: string; icon: string }> = {
  import: { label: t("diagnostics.opImport"), icon: "📥" },
  scan: { label: t("diagnostics.opScan"), icon: "🔍" },
  download: { label: t("diagnostics.opDownload"), icon: "⬇️" },
  sync: { label: t("diagnostics.opSync"), icon: "🔄" },
  rename: { label: t("diagnostics.opRename"), icon: "✏️" },
  delete: { label: t("diagnostics.opDelete"), icon: "🗑️" },
  ui: { label: t("diagnostics.opUI"), icon: "⚠️" },
};

/** 未知 op 回退到通用标签，避免显示裸英文 */
function opMeta(op: string | undefined): { label: string; icon: string } {
  if (op && OP_META[op]) return OP_META[op];
  return { label: op || "导入", icon: "🧾" };
}

export async function loadDiagnosticsLogs(root: ShadowRoot, esc: EscFn): Promise<void> {
  const list = root.getElementById("diag-log-list");
  if (!list) return;
  // 代际守卫：入口捕获，await 后写 DOM 前比对（防旧响应覆盖新筛选结果）
  const gen = ++diagLoadSeq;
  // 预取复制按钮文案——模板内局部变量 `const t = <时间字符串>` 会遮蔽 i18n 的 t()，
  // 直接调 t("diagnostics.copyLog") 会 TS 报 not callable
  const copyLogTitle = t("diagnostics.copyLog");
  try {
    const { GetImportLogs } = await getApp();
    const logs: ImportLogLike[] = (await GetImportLogs()) || [];
    if (gen !== diagLoadSeq) return; // 已被更新的加载取代，丢弃陈旧响应
    if (!logs || !logs.length) {
      list.innerHTML =
        '<div class="stat-row diag-stat diag-stat-muted">' + t("diagnostics.noLogs") + "</div>";
      return;
    }
    // 读筛选状态
    const activeBtn = root.querySelector(".diag-log-fbtn.active");
    const filter = activeBtn ? (activeBtn as HTMLElement).dataset.status : "all";
    const search = (root.getElementById("diag-log-search") as HTMLInputElement | null)
      ?.value?.trim().toLowerCase() || "";

    const filtered = logs
      .slice(-500)
      .reverse()
      .filter((l) => {
        if (filter !== "all" && l.Status !== filter) return false;
        if (search && !(l.ModelName || "").toLowerCase().includes(search)) return false;
        return true;
      });

    if (!filtered.length) {
      list.innerHTML =
        '<div class="stat-row diag-stat diag-stat-muted">' + t("diagnostics.noMatchLogs") + "</div>";
      return;
    }

    // 按操作类型分组（保持时间倒序），组内行带中文徽标
    const groups = new Map<string, ImportLogLike[]>();
    for (const l of filtered) {
      const key = l.Operation || "import";
      const arr = groups.get(key);
      if (arr) arr.push(l);
      else groups.set(key, [l]);
    }

    const parts: string[] = [];
    for (const [op, items] of groups) {
      const meta = opMeta(op);
      parts.push(
        `<div class="log-group" style="padding:4px 16px 2px;font-size:var(--fs-xs);color:var(--muted);display:flex;align-items:center;gap:6px;border-bottom:1px solid var(--bd);background:var(--surf)">
<span>${meta.icon} ${meta.label}</span><span style="margin-left:auto">${t("diagnostics.itemsCount", { n: items.length })}</span></div>`,
      );
      items.forEach((l, i) => {
        // P3 修复（子代理审计）：warn 被误标为 ⏭️（跳过）——success/failed 之外
        // 全部归 ⏭️ 掩盖了 warn（同步被跳过等警示）；warn 显式标 ⚠️，仅 skipped 用 ⏭️
        const statusLabel =
          l.Status === "success"
            ? "✅"
            : l.Status === "failed"
              ? "❌"
              : l.Status === "warn"
                ? "⚠️"
                : "⏭️";
        const timeStr = l.Timestamp
          ? new Date(l.Timestamp).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })
          : "";
        const msg = ((): string => {
          const dir =
            l.TargetDir || l.SourcePath ? "<br>📂 " + esc(l.TargetDir || l.SourcePath) : "";
          // 预处理 ErrorMsg：去 Go 端已拼接的 ❌/✅/⚠️ 前缀（statusLabel 已提供语义），
          // 避免 「❌」+「❌ 请求已取消」→ 三连重复
          const raw = l.ErrorMsg || "";
          const cleanErr = esc(raw)
            .replace(/^[❌✅⚠️⏭️]\s*/, "")
            .replace(/\s+(问题描述|操作|源路径|目标路径|解决建议)[：:]?/g, "<br>$1：");
          const modelDisplay = renderDisplayName(l.ModelName || "");
          // 模型名可能与错误消息相同（如 Go 端把 err.Error() 同时写入 ModelName 和 ErrorMsg），
          // 此时跳过模型名避免「请求已取消<br>请求已取消」
          const modelPart =
            modelDisplay && modelDisplay !== cleanErr ? modelDisplay : "";
          if (!modelPart && !cleanErr) return dir || "";
          if (!modelPart) return (dir || cleanErr ? dir + cleanErr : "");
          if (!cleanErr) return modelPart + dir;
          return modelPart + dir + "<br>" + cleanErr;
        })();
        // ⚠️ 原 JS 的 `${status}` 引用了未定义变量（模板串求值抛 ReferenceError，
        // 被外层 catch 吞掉 → 日志列表永远显示「加载日志失败」）。TS 编译期暴露，
        // 按意图改为 l.Status（与 statusLabel 同源）
        parts.push(
          `<div class="log-row" style="animation-delay:${Math.min(i * 20, 400)}ms">
<span class="log-status ${l.Status || ""}">${statusLabel}</span>
<span class="log-msg">${msg}</span>
<span class="log-time">${timeStr}</span>
<button class="log-copy" title="${copyLogTitle}">📋</button>
</div>`,
        );
      });
    }
    list.innerHTML = parts.join("");
  } catch (e) {
    // P3 修复（审核）：catch(_) 静默吞错——诊断页加载失败必须留痕（此前曾因被吞错
    // 长期显示假错误占位），console.error 供开发者排查；用户侧保留占位反馈即可
    console.error("[diagnostics] 加载操作日志失败:", e);
    list.innerHTML =
      '<div class="stat-row diag-stat diag-stat-error">' + t("diagnostics.loadLogsFailed") + "</div>";
  }
}

/** 运行时日志条目（仅用到的字段） */
interface RuntimeLogLike {
  Message?: string;
  Timestamp?: string | number;
}

/** 加载运行时日志（watcher/sync 等标准库 log 输出） */
export async function loadRuntimeLogs(root: ShadowRoot, esc: EscFn): Promise<void> {
  const list = root.getElementById("diag-runtime-list");
  if (!list) return;
  // 代际守卫（同 loadDiagnosticsLogs）
  const gen = ++diagLoadSeq;
  // 预取复制按钮文案（同 loadDiagnosticsLogs：局部 `const t` 遮蔽 i18n t()）
  const copyLogTitle = t("diagnostics.copyLog");
  try {
    const { GetRuntimeLogs } = await getApp();
    const logs: RuntimeLogLike[] = (await GetRuntimeLogs()) || [];
    if (gen !== diagLoadSeq) return; // 已被更新的加载取代，丢弃陈旧响应
    if (!logs || !logs.length) {
      list.innerHTML =
        '<div class="stat-row diag-stat diag-stat-muted">' + t("diagnostics.noRuntimeLogs") + "</div>";
      return;
    }
    list.innerHTML = logs
      .slice(-300)
      .reverse()
      .map((l, i) => {
        const timeStr = l.Timestamp
          ? new Date(l.Timestamp).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })
          : "";
        return `<div class="log-row" style="animation-delay:${Math.min(i * 20, 400)}ms">
<span class="log-status">🕹️</span>
<span class="log-msg" style="white-space:pre-wrap">${esc(l.Message || "")}</span>
<span class="log-time">${timeStr}</span>
<button class="log-copy" title="${copyLogTitle}">📋</button>
</div>`;
      })
      .join("");
  } catch (e) {
    // P3 修复（审核）：同 loadDiagnosticsLogs——运行时日志加载失败留痕，供开发者排查
    console.error("[diagnostics] 加载运行时日志失败:", e);
    list.innerHTML =
      '<div class="stat-row diag-stat diag-stat-error">' + t("diagnostics.loadRuntimeLogsFailed") + "</div>";
  }
}
