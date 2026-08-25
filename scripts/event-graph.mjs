#!/usr/bin/env node
/**
 * event-graph.mjs — Bus 事件契约守护者。
 * 从 bus.ts 的 BusEvents 接口提取权威事件清单，扫描 frontend/src/ 和 index.html，
 * 报告未声明事件 / 孤儿发射 / 鬼订阅 / 跨行调用。
 * 用法：node scripts/event-graph.mjs [--check] [--json] [--strict]
 */
import fs from 'node:fs';
import path from 'node:path';
import { getRoot, relPosix } from './_lib/scan-files.mjs';

const ROOT = getRoot();
const SRC_DIR = path.join(ROOT, 'frontend', 'src');
const INDEX_HTML = path.join(ROOT, 'frontend', 'index.html');
const BUS_TS = path.join(SRC_DIR, 'bus.ts');
const OUT = path.join(ROOT, 'docs', 'event-graph.md');
const ARGS = new Set(process.argv.slice(2));
const CHECK = ARGS.has('--check');
const JSON_OUT = ARGS.has('--json');
const STRICT = ARGS.has('--strict');

function readBusEvents() {
  const text = fs.readFileSync(BUS_TS, 'utf-8');
  const events = new Set();
  const re = /"([^"]+)"\s*:/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const ev = m[1];
    const lineStart = text.lastIndexOf('\n', m.index) + 1;
    const line = text.slice(lineStart, text.indexOf('\n', m.index)).trim();
    if (line.startsWith('//') || line.startsWith('*') || line.startsWith('-')) continue;
    events.add(ev);
  }
  return events;
}

function stripNoise(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ');
}

function collectSrcFiles() {
  const files = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name.startsWith('.')) continue;
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (/\.(ts|js)$/.test(ent.name) && !ent.name.endsWith('.test.ts') && !ent.name.endsWith('.spec.ts')) {
        files.push(p);
      }
    }
  };
  walk(SRC_DIR);
  return files;
}

function scanFiles(files, includeHtml) {
  const eventMap = new Map();
  function add(event, method, file, line) {
    if (!eventMap.has(event)) eventMap.set(event, { emit: [], on: [], once: [], off: [] });
    eventMap.get(event)[method].push({ file, line });
  }
  function scanFile(filePath, rel) {
    const text = stripNoise(fs.readFileSync(filePath, 'utf-8'));
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineRe = /(?:^|[^A-Za-z0-9_$])([A-Za-z_$][\w$]*)\.(emit|on|once|off)\s*\(\s*['"]([^'"]+)['"]/g;
      let m;
      while ((m = lineRe.exec(line)) !== null) add(m[3], m[2], rel, i + 1);
      if (/\.((?:emit|on|once|off)\s*\(\s*)$/.test(line.trimEnd())) {
        if (i + 1 < lines.length) {
          const next = lines[i + 1].trimStart();
          const crossM = next.match(/^(['"])([^'"]+)\1/);
          if (crossM) {
            const parentM = line.match(/([A-Za-z_$][\w$]*)\.(emit|on|once|off)$/);
            if (parentM) add(crossM[2], parentM[2], rel, i + 1);
          }
        }
      }
    }
  }
  for (const f of files) scanFile(f, relPosix(f));
  if (includeHtml && fs.existsSync(INDEX_HTML)) scanFile(INDEX_HTML, relPosix(INDEX_HTML));
  return { eventMap };
}

function checkContract(eventMap, declaredEvents) {
  const undeclared = [], orphans = [], ghosts = [];
  for (const [ev, d] of eventMap) {
    if (!declaredEvents.has(ev) && !undeclared.includes(ev)) undeclared.push(ev);
    if (d.emit.length > 0 && d.on.length === 0 && d.once.length === 0 && !orphans.includes(ev)) orphans.push(ev);
    if ((d.on.length > 0 || d.once.length > 0) && d.emit.length === 0 && !ghosts.includes(ev)) ghosts.push(ev);
  }
  return { undeclared, orphans, ghosts };
}

function renderMarkdown(eventMap, anomalies) {
  const out = [];
  out.push('# Bus 事件契约报告');
  out.push('');
  out.push('> **自动生成** — 由 `scripts/event-graph.mjs` 生成。');
  out.push('> 基于 `frontend/src/bus.ts` 的 `BusEvents` 接口校验所有调用方。');
  out.push('');
  if (anomalies.undeclared.length || anomalies.orphans.length || anomalies.ghosts.length) {
    out.push('## \u26a0\ufe0f 异常摘要');
    out.push('');
    if (anomalies.undeclared.length) {
      out.push('### 未声明事件（不在 BusEvents 中，可能是 typo 或漏声明）');
      out.push('');
      for (const ev of anomalies.undeclared) { const d = eventMap.get(ev); out.push(`- \`${ev}\` — emit×${d.emit.length} on×${d.on.length}`); }
      out.push('');
    }
    if (anomalies.orphans.length) {
      out.push('### 孤儿发射（emit 了但无 on/once 订阅方）');
      out.push('');
      for (const ev of anomalies.orphans) { const d = eventMap.get(ev); out.push(`- \`${ev}\` — emit×${d.emit.length}`); }
      out.push('');
    }
    if (anomalies.ghosts.length) {
      out.push('### 鬼订阅（有 on/once 但从未被 emit）');
      out.push('');
      for (const ev of anomalies.ghosts) { const d = eventMap.get(ev); out.push(`- \`${ev}\` — on×${d.on.length}`); }
      out.push('');
    }
  } else {
    out.push('## \u2705 无异常');
    out.push('');
    out.push("所有调用均在 BusEvents 契约内，无孤儿发射 / 鬼订阅 / 未声明事件。");
    out.push('');
  }
  const events = [...eventMap.keys()].sort();
  out.push('## 事件总览');
  out.push('');
  out.push('| 事件 | 发射方 | 订阅方 | 一次性订阅 | 退订方 | 状态 |');
  out.push('|------|--------|--------|-----------|--------|------|');
  for (const ev of events) {
    const d = eventMap.get(ev);
    let status = "\u2705";
    if (anomalies.undeclared.includes(ev)) status = "\u26a0\ufe0f 未声明";
    else if (d.emit.length > 0 && d.on.length === 0 && d.once.length === 0) status = "\ud83d\udd07 孤儿发射";
    else if (d.emit.length === 0 && (d.on.length > 0 || d.once.length > 0)) status = "\ud83d\udc7b 鬼订阅";
    out.push(`| \`${ev}\` | ${d.emit.length} | ${d.on.length} | ${d.once.length} | ${d.off.length} | ${status} |`);
  }
  out.push('');
  out.push('## 调用详情');
  out.push('');
  for (const ev of events) {
    const d = eventMap.get(ev);
    out.push(`### \`${ev}\``);
    out.push('');
    if (d.emit.length) { out.push("**发射方：**"); out.push("| 文件 | 行 |"); out.push("|------|----|"); for (const e of d.emit) out.push(`| \`${e.file}\` | ${e.line} |`); out.push(""); }
    if (d.on.length) { out.push("**订阅方（on）：**"); out.push("| 文件 | 行 |"); out.push("|------|----|"); for (const e of d.on) out.push(`| \`${e.file}\` | ${e.line} |`); out.push(""); }
    if (d.once.length) { out.push("**一次性订阅（once）：**"); out.push("| 文件 | 行 |"); out.push("|------|----|"); for (const e of d.once) out.push(`| \`${e.file}\` | ${e.line} |`); out.push(""); }
    if (d.off.length) { out.push("**退订方：**"); out.push("| 文件 | 行 |"); out.push("|------|----|"); for (const e of d.off) out.push(`| \`${e.file}\` | ${e.line} |`); out.push(""); }
  }
  return out.join('\n');
}

function renderJSON(eventMap, anomalies) {
  const events = [...eventMap.keys()].sort();
  const data = {};
  for (const ev of events) {
    const d = eventMap.get(ev);
    data[ev] = {
      emit: d.emit.map((e) => `${e.file}:${e.line}`),
      on: d.on.map((e) => `${e.file}:${e.line}`),
      once: d.once.map((e) => `${e.file}:${e.line}`),
      off: d.off.map((e) => `${e.file}:${e.line}`),
    };
  }
  return JSON.stringify({
    _summary: { events: events.length, undeclared: anomalies.undeclared, orphans: anomalies.orphans, ghosts: anomalies.ghosts },
    events: data,
  }, null, 2);
}

function printAnomalyReport(anomalies) {
  if (!anomalies.undeclared.length && !anomalies.orphans.length && !anomalies.ghosts.length) {
    console.warn("[event-graph] \u2705 无异常");
    return;
  }
  console.warn('');
  console.warn('\u2550'.repeat(37));
  console.warn(' Bus 事件契约检查报告');
  console.warn('\u2550'.repeat(37));
  if (anomalies.undeclared.length) {
    console.warn('\u26a0\ufe0f  未声明事件（需审查是否 typo 或漏声明）：');
    for (const ev of anomalies.undeclared) console.warn(`   ${ev}`);
  }
  if (anomalies.orphans.length) {
    console.warn('\ud83d\udd07 孤儿发射（emit 无 on/once）：');
    for (const ev of anomalies.orphans) console.warn(`   ${ev}`);
  }
  if (anomalies.ghosts.length) {
    console.warn('\ud83d\udc7b 鬼订阅（on/once 无 emit）：');
    for (const ev of anomalies.ghosts) console.warn(`   ${ev}`);
  }
  console.warn('\u2550'.repeat(37));
  console.warn("说明：未声明事件是硬错误（建议修复）；孤儿/鬼订阅可能是有意设计，仅作记录。--strict 会把未声明事件升级为 exit(1)。");
}

function main() {
  if (!fs.existsSync(BUS_TS)) { console.error('\u274c frontend/src/bus.ts 不存在'); process.exit(1); }
  if (!fs.existsSync(SRC_DIR)) { console.error('\u274c frontend/src 不存在'); process.exit(1); }
  const declaredEvents = readBusEvents();
  console.warn(`[event-graph] BusEvents 权威清单：${declaredEvents.size} 个事件`);
  const files = collectSrcFiles();
  console.warn(`[event-graph] 扫描源码文件：${files.length} 个`);
  const { eventMap } = scanFiles(files, true);
  console.warn(`[event-graph] 扫描到事件：${eventMap.size} 个`);
  const anomalies = checkContract(eventMap, declaredEvents);
  console.warn(`[event-graph] 异常：未声明 ${anomalies.undeclared.length}，孤儿发射 ${anomalies.orphans.length}，鬼订阅 ${anomalies.ghosts.length}`);
  if (STRICT && anomalies.undeclared.length > 0) {
    console.error('');
    console.error('\u274c --strict 下发现未声明事件，阻断退出：');
    for (const ev of anomalies.undeclared) console.error(`  ${ev}`);
    process.exit(1);
  }
  if (JSON_OUT) { console.log(renderJSON(eventMap, anomalies)); return; }
  if (CHECK) {
    const existing = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf-8') : '';
    const md = renderMarkdown(eventMap, anomalies);
    if (existing !== md) {
      console.error('\u274c docs/event-graph.md 过期，运行 `node scripts/event-graph.mjs` 刷新。');
      printAnomalyReport(anomalies);
      process.exit(1);
    }
    console.log('\u2705 docs/event-graph.md 最新。');
    printAnomalyReport(anomalies);
    return;
  }
  fs.writeFileSync(OUT, renderMarkdown(eventMap, anomalies), 'utf-8');
  console.log(`\ud83d\udce6 已写入 ${OUT}（${eventMap.size} 个事件）`);
  printAnomalyReport(anomalies);
}
main();