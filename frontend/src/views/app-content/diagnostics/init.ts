// ===== 诊断页初始化（为 _initDiagnostics 减负） =====
import { t } from "../../../core/i18n/t.ts";
import { bus } from "../../../bus.ts";
import { renderDisplayName } from "../../../utils/dom/display.ts";
import { getApp } from "../../../backend/app.ts";
import { loadResourceRegistry } from "../../../utils/resource/registry.ts";
import { RESOURCE_TYPES, RESOURCE_TYPE_LABELS } from "../../../utils/resource/types.ts";
import { isViewerMode } from "../../../utils/dom/android-bridge.ts";
import { resolveWebMode } from "../../../backend/platform.ts";
import { friendlyError } from "../../../utils/dom/errors.ts";

/** 转义函数签名（与组件 _esc 一致） */
type EscFn = (s: unknown) => string;

// P3 修复（子代理审计，代际守卫）：日志加载模块级序号——刷新/筛选/tab 切换可并发
// 触发 loadDiagnosticsLogs/loadRuntimeLogs，后端慢时旧响应后到会覆盖新响应（用户已
// 切筛选/搜索，列表却显示旧条件结果）；入口捕获 gen，await 后写 DOM 前比对丢弃陈旧
let diagLoadSeq = 0;

// P3 修复（子代理审计，重入守卫）：scanConflicts / dedup-exec 并发标志——快速 3 连点
// 会并发扫描同一 list 互相覆盖（结果写 innerHTML 竞争）；busy 命中直接返回
let diagScanning = false;
let diagExecBusy = false;

// P2-4 修复（重入守卫）：startDedup 重入标志——去重扫描大量 await（逐目录
// FindDuplicateFiles），快速连点会并发扫描同一 list 互相覆盖 innerHTML 且重复进
// 移入回收站流程；busy 命中直接返回（与 scanConflicts / dedup-exec 同一范式）
let _dedupBusy = false;

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
    // 查看器模式（Android/网页版 ADR-049）：无本地日志文件，清除操作不可用
    if (isViewerMode()) {
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

async function loadDiagnosticsLogs(root: ShadowRoot, esc: EscFn): Promise<void> {
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
async function loadRuntimeLogs(root: ShadowRoot, esc: EscFn): Promise<void> {
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

/**
 * 去重结果容器统一显式传入（消除 mock root 包装 + 幽灵 id diag-dedup-list）。
 * 之前调用方传 { getElementById: () => list } 包装对象，startDedup 内部查
 * "diag-dedup-list"——模板中并无此 id，靠包装对象兜底才不崩，报错无法定位。
 */
export async function startDedup(
  list: HTMLElement,
  esc: EscFn,
  rtype?: string,
): Promise<void> {
  // P2-4 修复（重入守卫）：在途去重扫描时丢弃重复点击（快速连点防并发覆盖）
  if (_dedupBusy) return;
  _dedupBusy = true;
  // P3 修复（子代理审计）：loadResourceRegistry 移入 try——原在 try（L404）之外，
  // reject（注册表加载失败）时 unhandledrejection、DOM 无占位、用户零反馈。
  // reg/typeLabel/typeIcon 声明提升到函数顶部：第二个 try（L441 目标目录收集）
  // 仍需引用，块内声明会超出作用域（TS 推断 unknown / 未找到）
  let reg: Awaited<ReturnType<typeof loadResourceRegistry>> | null = null;
  let typeLabel = "";
  let typeIcon = "📦";
  try {
    reg = await loadResourceRegistry();
    const entry = rtype ? reg[rtype] : undefined;
    const entryName = entry && typeof entry.name === "string" ? entry.name : "";
    const entryIcon = entry && typeof entry.icon === "string" ? entry.icon : "";
    typeLabel = rtype ? entryName || rtype : "所有";
    typeIcon = rtype ? entryIcon || "📦" : "📦";

    list.innerHTML =
      '<div class="stat-row diag-stat diag-stat-muted">' +
      // P2 修复（审核，R10）：t() 只做 {key} 字符串替换不转义 HTML——label/icon 源自
      // 资源注册表（配置可编辑），插值前 esc 防属性/元素上下文注入
      t("diagnostics.scanHash", { icon: esc(typeIcon), label: esc(typeLabel) }) +
      "</div>";
  } catch (e) {
    list.innerHTML =
      '<div class="stat-row diag-stat diag-stat-muted">❌ ' +
      esc(friendlyError(e, "加载资源类型失败")) +
      "</div>";
    _dedupBusy = false; // P2-4：复位（早退路径）
    return;
  }

  try {
    const { FindDuplicateFiles, GetRepoRoot, MoveToRecycle } =
      await getApp();

    // 收集目标目录
    interface DedupTarget {
      id: string;
      icon: string;
      label: string;
      dir: string;
    }
    const targets: DedupTarget[] = [];
    if (rtype && rtype !== "all") {
      const dir = await GetRepoRoot(rtype);
      if (dir)
        targets.push({ id: rtype, icon: typeIcon, label: typeLabel, dir });
    } else {
      for (const rt of Object.values(reg)) {
        const dir = await GetRepoRoot(rt.id);
        if (dir) {
          const rtName = typeof rt.name === "string" ? rt.name : rt.id;
          const rtIcon = typeof rt.icon === "string" ? rt.icon : "📦";
          targets.push({ id: rt.id, icon: rtIcon, label: rtName, dir });
        }
      }
    }

    if (!targets.length) {
      list.innerHTML =
        '<div class="stat-row diag-msg diag-msg-error">' + t("diagnostics.configResourceDir") + "</div>";
      _dedupBusy = false; // P2-4：复位（早退路径）
      return;
    }

    // 逐目录扫描
    interface DedupFile {
      path: string;
      name: string;
      size: number;
      modTime?: string;
    }
    interface DedupGroup {
      files: DedupFile[];
    }
    interface DedupGroupResult {
      icon: string;
      label: string;
      groups: DedupGroup[];
    }
    const allResults: DedupGroupResult[] = [];
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      list.innerHTML =
        '<div class="stat-row diag-stat diag-stat-muted">' +
        t("diagnostics.scanningProgress", {
          cur: i + 1,
          total: targets.length,
          // P2 修复（审核，R10）：icon/label 源自注册表，插值前 esc
          icon: esc(target.icon),
          label: esc(target.label),
        }) +
        "</div>";
      await new Promise((r) => setTimeout(r, 10));
      const jsonStr = await FindDuplicateFiles(target.dir);
      // P2 修复（子代理审计）：绑定层出错时返回 {"error":...}——原把扫描失败当
      // 「✅ 无重复」假绿（根符号链接/权限错误时用户以为全扫到了而实际没扫）；
      // 此处区分失败与无重复，失败立即中断并提示
      const parsed = JSON.parse(jsonStr || "[]") as
        | DedupGroup[]
        | { error?: string };
      if (!Array.isArray(parsed) && parsed.error) {
        list.innerHTML =
          '<div class="stat-row diag-msg diag-msg-error" style="justify-content:center">❌ ' +
          // P2 修复（审核，R10）：reason 是 Go binding 原始错误串（可含 <>&"），
          // t() 不转义，插值前 esc 防元素上下文注入
          t("diagnostics.scanFailed", { reason: esc(parsed.error) }) +
          "</div>";
        _dedupBusy = false; // P2-4：复位（早退路径）
        return;
      }
      const groups = (parsed as DedupGroup[]) || [];
      if (groups.length)
        allResults.push({ icon: target.icon, label: target.label, groups });
    }

    const totalGroups = allResults.reduce((s, r) => s + r.groups.length, 0);
    const totalDups = allResults.reduce(
      (s, r) => s + r.groups.reduce((s2, g) => s2 + g.files.length - 1, 0),
      0,
    );

    if (!totalGroups) {
      list.innerHTML =
        '<div class="stat-row diag-msg diag-msg-success" style="justify-content:center">✅ ' +
        t("diagnostics.noDups") +
        "</div>";
      _dedupBusy = false; // P2-4：复位（早退路径）
      return;
    }

    let html = `<div class="diag-dedup-summary">
${t("diagnostics.dupSummary", { groups: totalGroups, dups: totalDups })}
<span class="diag-dedup-summary-hint">${t("diagnostics.dupSummaryHint")}</span>
</div>`;

    let groupIndex = 0;
    for (const rtResult of allResults) {
      html += `<div class="diag-dedup-rt">
${rtResult.icon} ${rtResult.label}
<span class="diag-dedup-rt-sep"></span>
<span class="diag-dedup-rt-count">${t("diagnostics.fileCount", { n: rtResult.groups.reduce((s, g) => s + g.files.length, 0) })}</span>
</div>`;

      for (const group of rtResult.groups) {
        const files = group.files || [];
        const defaultIdx = files.reduce(
          (best, e, i, arr) => (e.size > arr[best].size ? i : best),
          0,
        );
        const totalSize = files.reduce((s, e) => s + e.size, 0);
        const gi = groupIndex++;

        html += `<div class="diag-dedup-group">
<div class="diag-dedup-group-head">
<span>📎 ${t("diagnostics.group", { n: gi + 1 })}</span>
<span class="diag-dedup-group-fill"></span>
<span class="diag-dedup-group-info">${t("diagnostics.groupInfo", { n: files.length, size: totalSize })}</span>
</div>`;
        files.forEach((e, fi) => {
          const checked = fi === defaultIdx ? " checked" : "";
          const isDefault = fi === defaultIdx;
          const dateStr = e.modTime
            ? new Date(e.modTime).toLocaleDateString()
            : "";
          const lastSep = Math.max(
            e.path.lastIndexOf("/"),
            e.path.lastIndexOf("\\"),
          );
          const dir = lastSep >= 0 ? e.path.substring(0, lastSep) : "";
          html += `<label class="diag-dedup-file${isDefault ? " diag-dedup-file-default" : ""}">
<input type="radio" name="dedup-keep-${gi}" value="${fi}"${checked} class="diag-dedup-radio">
<span class="diag-dedup-file-name">
<span class="diag-dedup-file-name-text" title="${t("oldest.clickDetail", { name: esc(e.path) })}" data-path="${esc(e.path)}">${renderDisplayName(e.name)}</span>
<span class="diag-dedup-file-dir">📁 ${esc(dir)}</span>
</span>
<span class="diag-dedup-file-size">${(e.size / 1024).toFixed(0)}KB</span>
${dateStr ? '<span class="diag-dedup-file-date">' + dateStr + "</span>" : ""}
${isDefault ? '<span class="diag-dedup-recommend">' + t("diagnostics.recommended") + "</span>" : ""}
</label>`;
        });
        html += `<label class="diag-dedup-keep-all">
<input type="radio" name="dedup-keep-${gi}" value="-1" class="diag-dedup-radio">
<span class="diag-dedup-keep-all-label">🔀 ${t("diagnostics.keepAll")}</span>
</label>`;
        html += `</div>`;
      }
    }

    html += `<div class="diag-dedup-actions">
<button id="diag-dedup-exec" class="diag-dedup-exec">🗑️ ${t("diagnostics.deleteUnselected")}</button>
<button id="diag-dedup-cancel" class="diag-dedup-cancel">${t("common.cancel")}</button>
</div>`;
    list.innerHTML = html;

    // 文件名点击预览（渲染后立即绑定，不等到 exec 之后）
    list.querySelectorAll("[data-path]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const path = (el as HTMLElement).dataset.path;
        if (path) bus.emit("model:select", { path });
      });
    });

    list.querySelector("#diag-dedup-cancel")?.addEventListener("click", () => {
      list.innerHTML =
        '<div class="stat-row diag-msg diag-msg-muted">' + t("diagnostics.dedupCancelled") + "</div>";
    });

    list
      .querySelector("#diag-dedup-exec")
      ?.addEventListener("click", async () => {
        // P3 修复（子代理审计，重入守卫）：exec 并发标志——执行期间大量 MoveToRecycle
        // await，重复点击会并行循环对同一批路径二次删除（误统计）；busy 命中直接返回
        if (diagExecBusy) return;
        diagExecBusy = true;
        let del = 0,
          fail = 0,
          gi2 = 0;
        try {
          for (const rtResult of allResults) {
            for (const group of rtResult.groups) {
              const files = group.files || [];
              const selEl = list.querySelector(
                'input[name="dedup-keep-' + gi2 + '"]:checked',
              ) as HTMLInputElement | null;
              const selected = selEl ? parseInt(selEl.value, 10) : 0;
              // 选中「保留全部」(-1) 时跳过改组
              if (selected === -1) {
                gi2++;
                continue;
              }
              for (let fi = 0; fi < files.length; fi++) {
                if (fi === selected) continue;
                try {
                  await MoveToRecycle(files[fi].path);
                  del++;
                } catch {
                  fail++;
                }
              }
              gi2++;
            }
          }
          if (del > 0) {
            bus.emit("stats:refresh");
            bus.emit("tree:reload");
          }
          list.innerHTML =
            '<div class="stat-row diag-msg ' +
            (fail > 0 ? "diag-msg-warn" : "diag-msg-success") +
            '">✅ ' +
            t("diagnostics.dedupDone", { del, fail }) +
            "</div>";
        } catch (err) {
          list.innerHTML =
            '<div class="stat-row diag-msg diag-msg-error">' +
            t("diagnostics.dedupFailed") +
            ": " +
            esc(String(err)) +
            "</div>";
        } finally {
          diagExecBusy = false; // P3：复位（含异常路径）
        }
      });
  } catch (err) {
    list.innerHTML =
      '<div class="stat-row diag-msg diag-msg-error">' +
      t("diagnostics.dedupFailed") +
      ": " +
      esc(String(err)) +
      "</div>";
  }
  _dedupBusy = false; // P2-4：复位（含 catch 异常路径）
}

async function scanConflicts(root: ShadowRoot, esc: EscFn): Promise<void> {
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
        name: e.Name.replace(/\.ban$/i, ""),
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
      const delay = Math.min(i * 30, 600);
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

/** 👴 资历最深 + 📊 仓库评分 + 🎲 每日推荐 + 热力图（已迁移到 features/oldest-models.ts） */
