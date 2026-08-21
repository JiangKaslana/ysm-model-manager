// ===== 诊断页：性能面板（single-bench / gui-flow / perf-log） =====
// ADR-040 按职责切文件：CLI 已有能力（single-bench 单模型基准 / gui-flow 全流程 / perf-log 优化历史）
// 本文件纯前端解析 CLI 文本输出，零 Go 改动；命令均在 cli-bridge 白名单内。
import { t } from "../../../core/i18n/t.ts";
import { executeCLI } from "../../../services/cli-bridge.ts";
import { resolveWebMode } from "../../../backend/platform.ts";
import { bus } from "../../../bus.ts";
import { safeGet, safeSet } from "../../../utils/dom/storage.ts";
import type { EscFn } from "./logs.ts";
import { safeErrorMessage } from "../../../utils/safe-error-msg.ts";
import { getLoadTraces, type LoadTrace } from "../../../utils/3d/load-trace.ts";

// 代际守卫：single-bench/gui-flow/perf-log 三个命令各自可并发/快速连点，旧响应后到会覆盖
// 新响应（对齐 logs.ts 的 diagLoadSeq 做法）——入口捕获 gen，await 后写 DOM 前比对丢弃陈旧
let perfSingleSeq = 0;
let perfGuiSeq = 0;
let perfHistSeq = 0;

/** 初始化性能面板（single-bench / gui-flow / perf-log / 加载剖析） */
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
  root
    .getElementById("diag-perf-refresh-trace")
    ?.addEventListener("click", () => renderLoadTraceSection(root, esc));
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

// ===== B-3 性能趋势图：single-bench 历史存储（safeGet/safeSet，localStorage）+ SVG 折线 =====
// 存储：每次 single-bench 成功后追加一条 {ts, stages:{name:ms}}，FIFO 限长防无限增长；
// 趋势图：原生 SVG polyline，每阶段一条线（时间 → 耗时），看清优化趋势 / 突然变慢。
// 隐私模式（safeSet 静默降级）无持久化不影响功能，只是历史不跨会话。
interface PerfRecord {
  ts: number;
  stages: Record<string, number>;
}
const PERF_HISTORY_KEY = "perf-history";
const MAX_PERF_RECORDS = 100;
const MAX_TREND_POINTS = 20;
const STAGE_COLORS = ["#4caf50", "#2196f3", "#ff9800", "#e91e63", "#9c27b0", "#00bcd4", "#ff5722"];

function loadPerfHistory(): PerfRecord[] {
  try {
    const raw = safeGet(PERF_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r) => r && typeof r.ts === "number" && r.stages && typeof r.stages === "object",
    ) as PerfRecord[];
  } catch {
    return [];
  }
}

function savePerfRecord(stages: { name: string; ms: number }[]): void {
  const stageMap: Record<string, number> = {};
  for (const s of stages) stageMap[s.name] = s.ms;
  const hist = loadPerfHistory();
  hist.push({ ts: Date.now(), stages: stageMap });
  safeSet(PERF_HISTORY_KEY, JSON.stringify(hist.slice(-MAX_PERF_RECORDS)));
}

/** 渲染趋势区段（<2 次时提示收集数据；否则渲染 SVG 折线 + 图例） */
function renderPerfTrendSection(esc: EscFn): string {
  const hist = loadPerfHistory();
  const head = sectionHeader("📈", t("diagnostics.perfTrendTitle"));
  if (hist.length < 2) {
    return (
      head +
      `<div class="perf-trend" style="padding:8px 2px"><div style="color:var(--muted);font-size:var(--fs-sm)">${t("diagnostics.perfTrendNoData")}</div></div>`
    );
  }
  const pts = hist.slice(-MAX_TREND_POINTS); // 时间从旧到新
  const stageNames = Object.keys(pts[pts.length - 1].stages);
  let maxMs = 0;
  for (const p of pts) for (const v of Object.values(p.stages)) if (v > maxMs) maxMs = v;
  if (maxMs <= 0) maxMs = 1;

  const W = 560, H = 150, padL = 30, padR = 10, padT = 10, padB = 20;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const n = pts.length;
  const x = (i: number) => padL + (n === 1 ? plotW / 2 : (i * plotW) / (n - 1));
  const y = (ms: number) => padT + plotH - (ms / maxMs) * plotH;

  // y 轴网格 + 刻度（0% / 50% / 100%）
  let grid = "";
  for (const frac of [0, 0.5, 1]) {
    const gy = padT + plotH - frac * plotH;
    grid += `<line x1="${padL}" y1="${gy}" x2="${W - padR}" y2="${gy}" stroke="var(--bd)" stroke-width="1"/>`;
    grid += `<text x="${padL - 4}" y="${(gy + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--muted)">${Math.round(maxMs * frac)}</text>`;
  }

  const polys = stageNames
    .map((name, si) => {
      const ptsStr = pts
        .map((p, i) => `${x(i).toFixed(1)},${y(p.stages[name] ?? 0).toFixed(1)}`)
        .join(" ");
      return `<polyline points="${ptsStr}" fill="none" stroke="${STAGE_COLORS[si % STAGE_COLORS.length]}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><title>${esc(name)}</title></polyline>`;
    })
    .join("");

  const legend = stageNames
    .map(
      (name, si) =>
        `<span class="perf-legend-item" style="display:inline-flex;align-items:center;gap:4px;margin:2px 10px 0 0;font-size:var(--fs-xs);color:var(--muted)">
<span style="width:12px;height:3px;background:${STAGE_COLORS[si % STAGE_COLORS.length]}"></span>${esc(name)}</span>`,
    )
    .join("");

  return (
    head +
    `<div class="perf-trend" style="padding:8px 2px">
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block;width:100%;height:auto">${grid}${polys}</svg>
<div class="perf-legend" style="display:flex;flex-wrap:wrap;padding:4px 2px 0">${legend}</div>
</div>`
  );
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
    savePerfRecord(stages);
    out.innerHTML =
      sectionHeader("⚡", t("diagnostics.perfSingleResult")) +
      `<div class="perf-bars" style="padding:8px 2px">${bars}</div>` +
      `<div class="perf-total">⏱️ ${t("diagnostics.perfTotal")}: ${total.toFixed(2)}ms</div>` +
      renderPerfTrendSection(esc);
  } catch (e) {
    if (gen !== perfSingleSeq) return;
    console.error("[diagnostics] single-bench 失败:", e);
    out.innerHTML = errorHTML(`${t("diagnostics.perfFail")}: ${safeErrorMessage(e)}`, esc);
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
    out.innerHTML = errorHTML(`${t("diagnostics.perfFail")}: ${safeErrorMessage(e)}`, esc);
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
    out.innerHTML = errorHTML(`${t("diagnostics.perfFail")}: ${safeErrorMessage(e)}`, esc);
  }
}

// ===== 加载剖析：实时 trace 甘特图 + 资产清单 =====
function formatTime(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  if (ms >= 100) return `${ms.toFixed(0)}ms`;
  return `${ms.toFixed(1)}ms`;
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${bytes}B`;
}

/** 渲染加载剖析区段 */
export function renderLoadTraceSection(root: ShadowRoot, esc: EscFn): void {
  const container = root.getElementById("diag-load-trace");
  if (!container) return;
  const traces = getLoadTraces();
  if (!traces.length) {
    container.innerHTML =
      `<div class="perf-no-data">${t("diagnostics.loadTraceNoData")}</div>` +
      `<div class="perf-no-hint">${t("diagnostics.loadTraceHint")}</div>`;
    return;
  }
  // 取最近一条（最新的加载）
  const latest = traces[traces.length - 1];
  const totalMs = latest.stages.reduce((s, st) => s + st.ms, 0);
  const maxMs = Math.max(...latest.stages.map(s => s.ms), 1);

  // 甘特图 SVG（横向条状）
  const W = 560, H = 40, padL = 72, padR = 10;
  const plotW = W - padL - padR;
  const rowH = 18;
  let ganttSvg = `<svg width="${W}" height="${latest.stages.length * rowH + 8}" viewBox="0 0 ${W} ${latest.stages.length * rowH + 8}" style="display:block;width:100%;height:auto">`;
  latest.stages.forEach((st, i) => {
    const y = i * rowH + 4;
    const x = padL;
    const w = Math.max(2, (st.ms / maxMs) * plotW);
    const color = st.ms > 500 ? "#e91e63" : st.ms > 200 ? "#ff9800" : "#4caf50";
    ganttSvg += `<rect x="${x}" y="${y}" width="${w}" height="${rowH - 4}" fill="${color}" rx="2" opacity="0.85"><title>${esc(st.name)}: ${st.ms}ms</title></rect>`;
    ganttSvg += `<text x="${x - 4}" y="${y + rowH / 2 + 4}" text-anchor="end" font-size="10" fill="var(--muted)">${esc(st.name)}</text>`;
    ganttSvg += `<text x="${x + w + 4}" y="${y + rowH / 2 + 4}" font-size="10" fill="var(--txt)">${st.ms}ms</text>`;
  });
  ganttSvg += `</svg>`;

  // 资产清单
  const a = latest.assets || {};
  const assetRows = [
    a.bones ? `<span class="perf-asset-item">🦴 ${t("diagnostics.assetsBones")}: ${a.bones}</span>` : "",
    a.materials ? `<span class="perf-asset-item">🎨 ${t("diagnostics.assetsMats")}: ${a.materials}</span>` : "",
    a.textures ? `<span class="perf-asset-item">🖼 ${t("diagnostics.assetsTex")}: ${a.textures}</span>` : "",
    a.morphs ? `<span class="perf-asset-item">😀 ${t("diagnostics.assetsMorphs")}: ${a.morphs}</span>` : "",
    a.animations ? `<span class="perf-asset-item">🎬 ${t("diagnostics.assetsAnims")}: ${a.animations}</span>` : "",
    a.pmxWorker !== undefined ? `<span class="perf-asset-item ${a.pmxWorker ? "perf-badge-ok" : "perf-badge-warn"}">${a.pmxWorker ? "⚡" : "🔄"} ${t("diagnostics.assetsPmxWorker")}: ${a.pmxWorker ? "ON" : "OFF"}</span>` : "",
    a.ktx2Hits !== undefined ? `<span class="perf-asset-item">${t("diagnostics.assetsKtx2")}: ${a.ktx2Hits}/${a.ktx2Total ?? a.ktx2Hits}</span>` : "",
    latest.gpuMb ? `<span class="perf-asset-item">💾 ${t("diagnostics.assetsGpu")}: ~${latest.gpuMb}MB</span>` : "",
  ].filter(Boolean).join("");

  // 纹理详情列表
  let texDetailHtml = "";
  if (latest.textureDetails?.length) {
    const rows = latest.textureDetails.slice(0, 10).map(t => {
      const badge = t.cached ? `<span class="perf-ktx2-badge">KTX2</span>` : "";
      return `<div class="perf-tex-row">${badge}<span class="perf-tex-name">${esc(t.path)}</span><span class="perf-tex-size">${esc(t.size ?? "")}</span></div>`;
    }).join("");
    const more = latest.textureDetails.length > 10 ? `<div class="perf-tex-more">${t("diagnostics.loadTraceMore", { n: latest.textureDetails.length - 10 })}</div>` : "";
    texDetailHtml = `<div class="perf-tex-section">${t("diagnostics.loadTraceTexDetail")}:<br>${rows}${more}</div>`;
  }

  const fmtTs = new Date(latest.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  container.innerHTML =
    sectionHeader("🔍", t("diagnostics.loadTraceTitle")) +
    `<div class="perf-trace-meta" style="padding:6px 2px;font-size:var(--fs-xs);color:var(--muted)">${esc(latest.path)} · ${fmtTs} · ${latest.format.toUpperCase()}</div>` +
    `<div class="perf-gantt-wrap" style="padding:8px 2px">${ganttSvg}</div>` +
    `<div class="perf-total">⏱️ ${t("diagnostics.perfTotal")}: ${formatTime(totalMs)}</div>` +
    `<div class="perf-asset-grid">${assetRows}</div>` +
    texDetailHtml +
    `<div class="perf-trace-hint">${t("diagnostics.loadTraceHint")}</div>`;
}
