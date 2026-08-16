// ===== 诊断页初始化（为 _initDiagnostics 减负） =====
// ADR-040 按职责切文件：日志加载（logs.ts）/ 去重（dedup.ts）/ 冲突扫描（conflicts.ts）已拆出；
// 本文件保留 initDiagnostics 编排壳，并 re-export startDedup 保持外部 import 路径（./diagnostics/init.ts）不变
import { t } from "../../../core/i18n/t.ts";
import { bus } from "../../../bus.ts";
import { getApp } from "../../../backend/app.ts";
import { can } from "../../../utils/dom/capabilities.ts";
import { friendlyError } from "../../../utils/dom/errors.ts";
import { loadDiagnosticsLogs, loadRuntimeLogs, type EscFn } from "./logs.ts";
import { scanConflicts } from "./conflicts.ts";

// 对外 API 兼容：startDedup 已迁至 dedup.ts（外部仍从本文件 import，见 init-pages.ts / init.test.ts）
export { startDedup } from "./dedup.ts";

/**
 * 初始化诊断页所有功能
 * @param root - 组件 shadow root
 * @param esc - HTML 转义函数
 */
export function initDiagnostics(root: ShadowRoot, esc: EscFn): void {
  // 刷新按钮：按当前激活的诊断 tab 刷新对应面板
  root
    .getElementById("diag-refresh")
    ?.addEventListener("click", () => {
      const active = root.querySelector(".diag-btn[data-diag].active") as HTMLElement | null;
      const name = active?.dataset.diag;
      if (name === "runtime") loadRuntimeLogs(root, esc);
      else loadDiagnosticsLogs(root, esc);
    });
  root.getElementById("diag-clear")?.addEventListener("click", async () => {
    // 能力门控：web 已实现 ClearImportLogs/ClearRuntimeLogs（IDB 持久化）→ 解锁；
    // Android viewer 无此能力 → 封禁
    if (!can("ClearImportLogs")) {
      bus.emit("toast:show", {
        msg: "网页版不支持清除日志",
        duration: 3000,
        type: "warn",
      });
      return;
    }
    try {
      const { ClearImportLogs } = await getApp();
      await ClearImportLogs();
      loadDiagnosticsLogs(root, esc);
      bus.emit("toast:show", {
        msg: "🗑️ " + t("diagnostics.logsCleared"),
        duration: 2000,
        type: "info",
      });
    } catch (e) {
      // P2 修复（审核，ADR-044 ①）：async handler 最外层 catch 出口——原无 try/catch，
      // getApp/ClearImportLogs reject 时 unhandledrejection 且用户零反馈
      bus.emit("toast:show", {
        msg: "❌ " + friendlyError(e, t("diagnostics.clearFailed")),
        duration: 4000,
        type: "error",
      });
    }
  });
  // 复制日志：把当前激活面板（log/runtime）的可见文本复制到剪贴板。
  // Android WebView 长按选择文本受限（用户反馈「无法复制报错日志」），
  // 提供显式按钮；clipboard API + textarea 兜底（对齐 context-menus copy-path 模式）。
  // 面板定位与 diag-refresh 一致：active tab 的 data-diag → #diag-<name>。
  // 勿用 `[style*='display: none']` 子串匹配——初始 HTML 是 `display:none`（无空格），
  // 与带空格的写法不一致，靠 querySelector 返回首个面板纯属巧合（审核发现 P3）。
  root.getElementById("diag-copy")?.addEventListener("click", async () => {
    const active = root.querySelector(".diag-btn[data-diag].active") as HTMLElement | null;
    const name = active?.dataset.diag ?? "log";
    const list = root.getElementById(`diag-${name}`) as HTMLElement | null;
    // 排除 📋 复制按钮文本，避免 textContent 含冗余 emoji
    const clone = list?.cloneNode(true) as HTMLElement | null;
    clone?.querySelectorAll(".log-copy").forEach((b) => b.remove());
    const text = (clone?.textContent ?? "").trim();
    if (!text) {
      bus.emit("toast:show", {
        msg: "📋 当前无日志可复制",
        duration: 2000,
        type: "info",
      });
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    bus.emit("toast:show", {
      // P3 修复（审核，隐私）：复制内容含完整本地路径（SourcePath/TargetDir）——
      // 保留路径诊断价值，但提示勿公开分享（用户粘贴到支持渠道前有心理预期）
      msg: "📋 " + t("diagnostics.copiedLogPrivacy"),
      duration: 3000,
      type: "info",
    });
  });
  // 单条日志复制：行内 📋 按钮复制该行 log-msg 文本（事件委托到列表容器，
  // 行由 innerHTML 重建不丢绑定；复制按钮在 log/runtime 两面板模板中已渲染）
  const copyRowLog = (row: HTMLElement): void => {
    const msgEl = row.querySelector<HTMLElement>(".log-msg");
    const text = (msgEl?.textContent ?? "").trim();
    if (!text) return;
    navigator.clipboard
      .writeText(text)
      .then(() => {
        bus.emit("toast:show", {
          // P3 修复（审核，隐私）：同整面板复制——路径可能含本机信息，提示勿公开分享
          msg: "📋 " + t("diagnostics.copiedLogPrivacy"),
          duration: 3000,
          type: "info",
        });
      })
      .catch(() => {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        bus.emit("toast:show", {
          msg: "📋 " + t("diagnostics.copiedLog"),
          duration: 2000,
          type: "success",
        });
      });
  };
  ["diag-log-list", "diag-runtime-list"].forEach((listId) => {
    root.getElementById(listId)?.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>(".log-copy");
      if (!btn) return;
      const row = btn.closest<HTMLElement>(".log-row");
      if (row) copyRowLog(row);
    });
  });
  root
    .getElementById("diag-scan-conflict")
    ?.addEventListener("click", () => scanConflicts(root, esc));
  // 左栏按钮切换
  root.querySelectorAll(".diag-btn[data-diag]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const name = (btn as HTMLElement).dataset.diag;
      root
        .querySelectorAll(".diag-btn[data-diag]")
        .forEach((b) => b.classList.toggle("active", b === btn));
      const logPanel = root.getElementById("diag-log") as HTMLElement | null;
      const runtimePanel = root.getElementById("diag-runtime") as HTMLElement | null;
      const conflictPanel = root.getElementById("diag-conflict") as HTMLElement | null;
      if (logPanel) logPanel.style.display = name === "log" ? "" : "none";
      if (runtimePanel) runtimePanel.style.display = name === "runtime" ? "" : "none";
      if (conflictPanel) conflictPanel.style.display = name === "conflict" ? "" : "none";
      // 重启入场动画
      const activePanel =
        name === "log" ? logPanel : name === "runtime" ? runtimePanel : conflictPanel;
      if (activePanel) {
        activePanel.style.animation = "none";
        void activePanel.offsetHeight;
        activePanel.style.animation = "";
      }
      if (name === "log") loadDiagnosticsLogs(root, esc);
      if (name === "runtime") loadRuntimeLogs(root, esc);
    });
  });

  loadDiagnosticsLogs(root, esc);

  // 日志筛选按钮
  root.querySelectorAll(".diag-log-fbtn").forEach((btn) => {
    btn.addEventListener("click", () => {
      root
        .querySelectorAll(".diag-log-fbtn")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      loadDiagnosticsLogs(root, esc);
    });
  });

  // 日志搜索
  const logSearch = root.getElementById("diag-log-search") as HTMLInputElement | null;
  if (logSearch) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    logSearch.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => loadDiagnosticsLogs(root, esc), 300);
    });
  }
}

/** 👴 资历最深 + 📊 仓库评分 + 🎲 每日推荐 + 热力图（已迁移到 features/oldest-models.ts） */
