// ===== 诊断页：性能面板（single-bench / gui-flow / perf-log） =====
// ADR-040 按职责切文件：CLI 已有能力（single-bench 单模型基准 / gui-flow 全流程 / perf-log 优化历史）
// 本文件纯前端解析 CLI 文本输出，零 Go 改动；命令均在 cli-bridge 白名单内。
import { t } from "../../../core/i18n/t.ts";
import { executeCLI } from "../../../services/cli-bridge.ts";
import { resolveWebMode } from "../../../backend/platform.ts";
import { bus } from "../../../bus.ts";
import type { EscFn } from "./logs.ts";

// 代际守卫：single-bench/gui-flow/perf-log 三个命令各自可并发/快速连点，旧响应后到会覆盖
// 新响应（对齐 logs.ts 的 diagLoadSeq 做法）——入口捕获 gen，await 后写 DOM 前比对丢弃陈旧
let perfSingleSeq = 0;
let perfGuiSeq = 0;
let perfHistSeq = 0;

/** 绑定性能面板按钮点击事件 */
export function initPerfPanel(root: ShadowRoot, esc: EscFn): void {
  root
    .getElementById("diag-perf-run")
    ?.addEventListener("click", () => runSingleBench(root, esc));
  root
    .getElementById("diag-perf-gui")
    ?.addEventListener("click", () => runGuiFlow(root, esc));
  root
    .getElementById("diag-perf-log")
    ?.addEventListener("click", () => runPerfLog(root, esc));
}

/** 写入某容器 HTML；容器不存在时静默跳过 */
function setHTML(root: ShadowRoot, id: string, html: string): void {
  const el = root.getElementById(id);
  if (el) el.innerHTML = html;
}

/** 运行中占位 */
function busyHTML(): string {
  return `<div class="diag-stat diag-stat-muted">⏳ ${t("diagnostics.perfRunning")}</div>`;
}

/** 失败占位（复用 diag-stat diag-stat-error 样式） */
function errorHTML(msg: string, esc: EscFn): string {
  return `<div class="diag-stat diag-stat-error">❌ ${esc(msg)}</div>`;
}

/** 结果区段头 */
function sectionHeader(icon: string, label: string): string {
  return `<div class="perf-section" style="margin-top:10px;font-size:var(--fs-sm);font-weight:600;color:var(--txt);display:flex;align-items:center;gap:6px">
<span>${icon}</span><span>${label}</span></div>`;
}

// ===== single-bench：7 阶段耗时柱状图 =====
async function runSingleBench(root: ShadowRoot, esc: EscFn): Promise<void> {
  const gen = ++perfSingleSeq;
  const out = root.getElementById("diag-perf-single");
  if (!out) return;
  const model = (root.getElementById("diag-perf-model") as HTMLInputElement | null)
    ?.value.trim() ?? "";
  const iterRaw =
    (root.getElementById("diag-perf-iter") as HTMLInputElement | null)?.value ?? "3";
  const iterations = Math.max(1, parseInt(iterRaw, 10) || 3);

  if (!model) {
    out.innerHTML = errorHTML(t("diagnostics.perfModelRequired"), esc);
    return;
  }
  out.innerHTML = busyHTML();
  try {
    const resp = await executeCLI("single-bench", { model, iterations });
    if (gen !== perfSingleSeq) return;
    if (resp.status !== "success" || !resp.data?.output) {
      out.innerHTML = errorHTML(
        resp.error?.message ?? t("diagnostics.perfFail"),
        esc,
      );
      return;
    }
    const lines = resp.data.output.split("\n");

    // 阶段行：`   ① 文件读取               12.34ms 🔴 瓶颈`（名称可含空格/编号前缀，
    // 状态后缀可能是单 token（✅/🟢）或多 token（🔴 瓶颈/🟡 注意），故整段捕获）
    const stageRe = /^\s+(.+?)\s+(\d+(?:\.\d+)?)ms(?:\s+(.*))?$/;
    // 总耗时行：`⏱️  总耗时（3 次迭代）: 123.45ms`
    const totalRe = /⏱️\s*总耗时.*?([\d.]+)ms/;

    interface Stage {
      name: string;
      ms: number;
      status: string;
    }
    const stages: Stage[] = [];
    let maxMs = 0;
    for (const raw of lines) {
      const line = raw.trimEnd();
      const m = line.match(stageRe);
      if (!m) continue;
      const name = m[1].trim();
      if (name === "总计") continue; // 每块行末“总计”非阶段，跳过避免混入柱状
      const ms = parseFloat(m[2]);
      const status = m[3] ?? "";
      stages.push({ name, ms, status });
      if (ms > maxMs) maxMs = ms;
    }
    const totalRes = lines.find((l) => totalRe.test(l));
    const total = totalRes ? parseFloat(totalRes.match(totalRe)![1]) : stages.reduce((s, x) => s + x.ms, 0);

    if (!stages.length) {
      out.innerHTML = errorHTML(t("diagnostics.perfFail"), esc);
      return;
    }
    const bars = stages
      .map((s) => {
        const pct = maxMs > 0 ? Math.max(3, Math.round((s.ms / maxMs) * 100)) : 3;
        const cls = s.ms > 100 ? "perf-bar-danger" : s.ms > 50 ? "perf-bar-warn" : "";
        return `<div class="perf-bar-row">
<span class="perf-bar-name" title="${esc(s.name)}">${esc(s.name)}</span>
<span class="perf-bar-track"><span class="perf-bar-fill ${cls}" style="width:${pct}%"></span></span>
<span class="perf-bar-val ${cls}">${s.ms.toFixed(2)}ms ${esc(s.status)}</span>
</div>`;
      })
      .join("");
    out.innerHTML =
      sectionHeader("⚡", t("diagnostics.perfSingleResult")) +
      `<div class="perf-bars" style="padding:8px 2px">${bars}</div>` +
      `<div class="perf-total">⏱️ ${t("diagnostics.perfTotal")}: ${total.toFixed(2)}ms</div>`;
  } catch (e) {
    if (gen !== perfSingleSeq) return;
    console.error("[diagnostics] single-bench 失败:", e);
    out.innerHTML = errorHTML(`${t("diagnostics.perfFail")}: ${String(e)}`, esc);
  }
}

// ===== gui-flow：6 阶段状态（✅/❌ + 耗时） =====
async function runGuiFlow(root: ShadowRoot, esc: EscFn): Promise<void> {
  const gen = ++perfGuiSeq;
  const out = root.getElementById("diag-perf-gui");
  if (!out) return;
  if (resolveWebMode()) {
    bus.emit("toast:show", {
      msg: "网页版不支持性能诊断",
      duration: 3000,
      type: "warn",
    });
    return;
  }
  out.innerHTML = busyHTML();
  try {
    const resp = await executeCLI("gui-flow", { verbose: true });
    if (gen !== perfGuiSeq) return;
    if (resp.status !== "success" || !resp.data?.output) {
      out.innerHTML = errorHTML(
        resp.error?.message ?? t("diagnostics.perfFail"),
        esc,
      );
      return;
    }
    const lines = resp.data.output.split("\n");

    // 阶段行：`✅ [1] ① 配置加载 (1.23ms)`；后续缩进行是该阶段描述
    const stageRe = /^([✅❌])\s*\[\d+\]\s*(.+?)\s*\(([\d.]+)ms\)$/;
    const totalRe = /⏱️\s*总耗时:\s*([\d.]+)ms/;

    interface FlowStage {
      status: string;
      name: string;
      ms: number;
      desc: string[];
    }
    const entries: FlowStage[] = [];
    let cur: FlowStage | null = null;
    let flowTotal: number | null = null;
    for (const raw of lines) {
      const line = raw.trimEnd();
      const sm = line.match(stageRe);
      if (sm) {
        cur = { status: sm[1], name: sm[2].trim(), ms: parseFloat(sm[3]), desc: [] };
        entries.push(cur);
        continue;
      }
      const tm = line.match(totalRe);
      if (tm) {
        flowTotal = parseFloat(tm[1]);
        continue;
      }
      if (cur && /^\s{3}/.test(line) && line.trim()) cur.desc.push(line.trim());
    }

    if (!entries.length) {
      out.innerHTML = errorHTML(t("diagnostics.perfFail"), esc);
      return;
    }
    const failed = entries.some((e) => e.status === "❌");
    const rows = entries
      .map((e) => {
        const desc = e.desc.length
          ? `<span class="perf-gui-desc">${esc(e.desc.join("<br>"))}</span>`
          : "";
        const cls = e.status === "❌" ? "perf-gui-fail" : "";
        return `<div class="perf-gui-stage ${cls}">
<span class="perf-gui-status">${e.status}</span>
<span class="perf-gui-name">${esc(e.name)}</span>
<span class="perf-gui-ms">${e.ms.toFixed(2)}ms</span>${desc}
</div>`;
      })
      .join("");
    const totalLine =
      flowTotal !== null
        ? `<div class="perf-total">⏱️ ${t("diagnostics.perfTotal")}: ${flowTotal.toFixed(2)}ms</div>`
        : "";
    const failLine = failed
      ? `<div class="diag-stat diag-stat-error">❌ ${t("diagnostics.perfGuiFailed")}</div>`
      : "";
    out.innerHTML =
      sectionHeader("🩺", t("diagnostics.perfGuiResult")) +
      `<div class="perf-gui" style="padding:8px 2px">${rows}</div>` +
      totalLine +
      failLine;
  } catch (e) {
    if (gen !== perfGuiSeq) return;
    console.error("[diagnostics] gui-flow 失败:", e);
    out.innerHTML = errorHTML(`${t("diagnostics.perfFail")}: ${String(e)}`, esc);
  }
}

// ===== perf-log：优化历史（按时间倒序） =====
async function runPerfLog(root: ShadowRoot, esc: EscFn): Promise<void> {
  const gen = ++perfHistSeq;
  const out = root.getElementById("diag-perf-hist");
  if (!out) return;
  out.innerHTML = busyHTML();
  try {
    const resp = await executeCLI("perf-log", {});
    if (gen !== perfHistSeq) return;
    if (resp.status !== "success" || !resp.data?.output) {
      out.innerHTML = errorHTML(
        resp.error?.message ?? t("diagnostics.perfFail"),
        esc,
      );
      return;
    }
    const lines = resp.data.output.split("\n");

    // 条目头：`─ 2026-08-19 ─ 纹理编码 ─ abc1234`；后续 `  问题/做法/效果:` 为明细
    const headRe = /^─\s*(.+?)\s*─\s*(.+?)\s*─\s*(.+?)\s*$/;
    interface PerfEntry {
      date: string;
      area: string;
      commit: string;
      body: string[];
    }
    const entries: PerfEntry[] = [];
    let cur: PerfEntry | null = null;
    for (const raw of lines) {
      const line = raw;
      const hm = line.match(headRe);
      if (hm) {
        cur = { date: hm[1].trim(), area: hm[2].trim(), commit: hm[3].trim(), body: [] };
        entries.push(cur);
        continue;
      }
      if (cur && (line.startsWith("  问题:") || line.startsWith("  做法:") || line.startsWith("  效果:")) && line.trim()) {
        cur.body.push(line.trim());
      }
    }

    if (!entries.length) {
      out.innerHTML = errorHTML(t("diagnostics.perfFail"), esc);
      return;
    }
    const cards = entries
      .map((e, i) => {
        const body = e.body.length
          ? `<span class="perf-hist-body">${e.body.map((d) => esc(d)).join("<br>")}</span>`
          : "";
        return `<div class="perf-hist-card" style="animation-delay:${Math.min(i * 30, 300)}ms">
<span class="perf-hist-head">🗓️ ${esc(e.date)} · ${esc(e.area)} · <code>${esc(e.commit)}</code></span>${body}
</div>`;
      })
      .join("");
    out.innerHTML =
      sectionHeader("🗒️", t("diagnostics.perfHistResult")) +
      `<div class="perf-hist" style="padding:8px 2px">${cards}</div>`;
  } catch (e) {
    if (gen !== perfHistSeq) return;
    console.error("[diagnostics] perf-log 失败:", e);
    out.innerHTML = errorHTML(`${t("diagnostics.perfFail")}: ${String(e)}`, esc);
  }
}