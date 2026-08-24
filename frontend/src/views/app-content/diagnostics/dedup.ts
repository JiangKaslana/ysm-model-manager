// ===== 诊断页：去重扫描（startDedup） =====
// ADR-040 按职责切文件：原 init.ts 拆分——日志加载（logs.ts）/ 去重（本文件）/ 冲突扫描（conflicts.ts）
import { t } from "../../../core/i18n/t.ts";
import { bus } from "../../../bus.ts";
import { getApp } from "../../../backend/app.ts";
import { loadResourceRegistry } from "../../../utils/resource/registry.ts";
import { friendlyError } from "../../../utils/dom/errors.ts";
import { renderDisplayName } from "../../../utils/dom/display.ts";
import { fileIcon } from "../../../utils/icon/icon.ts";
import type { EscFn } from "./logs.ts";

// P2-4 修复（重入守卫）：startDedup 重入标志——去重扫描大量 await（逐目录
// FindDuplicateFiles），快速连点会并发扫描同一 list 互相覆盖 innerHTML 且重复进
// 移入回收站流程；busy 命中直接返回（与 scanConflicts / dedup-exec 同一范式）
let _dedupBusy = false;

// P3 修复（子代理审计，重入守卫）：dedup-exec 并发标志——执行期间大量 MoveToRecycle
// await，重复点击会并行循环对同一批路径二次删除（误统计）；busy 命中直接返回
let diagExecBusy = false;

// ===== 全局配置状态（供 initDedupConfig 和 startDedup 共享） =====
let _dedupStrategy = "deep_hash";
let _keepPolicy = "oldest";
let _priorityPath = "";

/**
 * 根据保留策略决定默认保留的文件索引
 * - "oldest": 保留最早修改的文件
 * - "newest": 保留最新修改的文件
 * - "path": 保留指定路径前缀匹配的文件
 * - 其他/默认: 保留最大文件（size 最大）
 */
function getDefaultKeepIdx(
  files: { path: string; size: number; modTime?: string | number }[],
  policy: string,
  priorityPath: string,
): number {
  if (files.length === 0) return 0;

  // 辅助函数：将 modTime 转为数字时间戳。
  // Go 端 FileEntry.ModTime 是 UnixMilli 数字（JSON 数字），Date.parse 对数字
  // 字符串返回 NaN——必须按 number 直用，否则 oldest/newest 策略全部落到
  // MAX_SAFE_INTEGER 退化为「保留第一个」，keepPolicy 形同虚设（code_review P3）。
  const toTimestamp = (modTime?: string | number): number => {
    if (modTime === undefined || modTime === null || modTime === "") return Number.MAX_SAFE_INTEGER;
    const ts = typeof modTime === "number" ? modTime : Date.parse(modTime);
    return isNaN(ts) ? Number.MAX_SAFE_INTEGER : ts;
  };

  switch (policy) {
    case "oldest":
      return files.reduce(
        (best, e, i, arr) =>
          toTimestamp(e.modTime) < toTimestamp(arr[best].modTime) ? i : best,
        0,
      );
    case "newest":
      return files.reduce(
        (best, e, i, arr) =>
          toTimestamp(e.modTime) > toTimestamp(arr[best].modTime) ? i : best,
        0,
      );
    case "path":
      if (priorityPath) {
        const idx = files.findIndex((f) =>
          f.path.toLowerCase().startsWith(priorityPath.toLowerCase()),
        );
        if (idx >= 0) return idx;
      }
      // 未匹配时回退到 size 最大
      return files.reduce(
        (best, e, i, arr) => (e.size > arr[best].size ? i : best),
        0,
      );
    default:
      return files.reduce(
        (best, e, i, arr) => (e.size > arr[best].size ? i : best),
        0,
      );
  }
}

/**
 * 初始化去重配置面板（标签页打开时调用，配置实时保存）
 * @param list 配置面板容器（dedup-config-panel，独立于 result-list——
 *             扫描结果不覆盖面板，控件扫描后仍可改；code_review P3）
 */
export function initDedupConfig(list: HTMLElement): void {
  const renderConfigPanel = () => {
    list.innerHTML = `
      <div class="diag-dedup-config">
        <div class="diag-config-item">
          <label for="dedup-strategy">🔍 ${t("diagnostics.dedupStrategy")}:</label>
          <select id="dedup-strategy" class="diag-config-select">
            <option value="deep_hash"${_dedupStrategy === "deep_hash" ? " selected" : ""}>${t("diagnostics.strategyDeepHash")} (SHA256)</option>
            <option value="quick_hash"${_dedupStrategy === "quick_hash" ? " selected" : ""}>${t("diagnostics.strategyQuickHash")} (MD5)</option>
            <option value="name_size"${_dedupStrategy === "name_size" ? " selected" : ""}>${t("diagnostics.strategyNameSize")} (${t("diagnostics.fastest")})</option>
          </select>
        </div>
        <div class="diag-config-item">
          <label for="keep-policy">💾 ${t("diagnostics.keepPolicy")}:</label>
          <select id="keep-policy" class="diag-config-select">
            <option value="oldest"${_keepPolicy === "oldest" ? " selected" : ""}>${t("diagnostics.keepOldest")}</option>
            <option value="newest"${_keepPolicy === "newest" ? " selected" : ""}>${t("diagnostics.keepNewest")}</option>
            <option value="path"${_keepPolicy === "path" ? " selected" : ""}>${t("diagnostics.keepByPath")}</option>
          </select>
        </div>
        <div class="diag-config-item" id="priority-path-item" style="${_keepPolicy === "path" ? "" : "display:none"}">
          <label for="priority-path">📁 ${t("diagnostics.priorityPath")}:</label>
          <input type="text" id="priority-path" class="diag-config-input" placeholder="/path/to/priority" value="">
        </div>
      </div>
    `;

    // 绑定事件（配置实时保存到全局变量）
    list.querySelector("#dedup-strategy")?.addEventListener("change", (e) => {
      _dedupStrategy = (e.target as HTMLSelectElement).value;
    });

    list.querySelector("#keep-policy")?.addEventListener("change", (e) => {
      _keepPolicy = (e.target as HTMLSelectElement).value;
      const pathItem = list.querySelector("#priority-path-item") as HTMLElement;
      if (pathItem) {
        pathItem.style.display = _keepPolicy === "path" ? "" : "none";
      }
    });

    list.querySelector("#priority-path")?.addEventListener("input", (e) => {
      _priorityPath = (e.target as HTMLInputElement).value;
    });
  };

  renderConfigPanel();
}

/**
 * 获取当前去重配置（供外部调用）
 */
export function getDedupConfig(): { strategy: string; keepPolicy: string; priorityPath: string } {
  return {
    strategy: _dedupStrategy,
    keepPolicy: _keepPolicy,
    priorityPath: _priorityPath,
  };
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

    // ===== 执行去重扫描（使用全局配置） =====
    const executeDedupScan = async () => {
      try {
        // ===== 原有扫描逻辑 =====
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
      // 传递配置到 Go 后端
      const dedupConfig = getDedupConfig();
      const configStr = JSON.stringify(dedupConfig);
      const jsonStr = await FindDuplicateFiles(target.dir, configStr);
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
        const defaultIdx = getDefaultKeepIdx(files, _keepPolicy, _priorityPath);
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
<span class="diag-dedup-file-name-text" title="${t("oldest.clickDetail", { name: esc(e.path) })}" data-path="${esc(e.path)}"><span class="diag-dedup-file-ic">${fileIcon(e.name)}</span>${renderDisplayName(e.name)}</span>
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
    };

    // 直接执行去重扫描（配置已在 initDedupConfig 中初始化）
    await executeDedupScan();

  } catch (e) {
    list.innerHTML =
      '<div class="stat-row diag-stat diag-stat-muted">❌ ' +
      esc(friendlyError(e, "加载去重配置失败")) +
      "</div>";
    _dedupBusy = false; // P2-4：复位（早退路径）
  }
  _dedupBusy = false; // P2-4：复位
}
