#!/usr/bin/env node
/**
 * event-graph.mjs — Bus 事件发射↔订阅映射生成器。
 *
 * 扫描 frontend/src/ 下所有 .ts（排除 .test.），提取：
 *   - bus.emit("eventName", ...)   → 发射方
 *   - bus.on("eventName", ...)     → 订阅方
 *   - bus.once("eventName", ...)   → 一次性订阅方
 *   - bus.off("eventName", ...)    → 退订方（仅统计，不纳入映射）
 *
 * 输出：docs/event-graph.md
 *
 * 用法：
 *   node scripts/event-graph.mjs                # 写入 docs/event-graph.md
 *   node scripts/event-graph.mjs --check        # 只对比不写盘（doctor 守护）
 *   node scripts/event-graph.mjs --json         # JSON 摘要（CI 消费）
 *
 * 零依赖（仅 node:fs / node:path + scripts/_lib/scan-files.mjs）。
 * 设计意图：event-graph 工具脚本
 * 退出码：0（无 process.exit 调用）
 */
import fs from 'node:fs';
import path from 'node:path';
import { getRoot, relPosix, walk } from './_lib/scan-files.mjs';

const ROOT = getRoot();
const SRC_DIR = path.join(ROOT, 'frontend', 'src');
const OUT = path.join(ROOT, 'docs', 'event-graph.md');

const ARGS = new Set(process.argv.slice(2));
const CHECK = ARGS.has('--check');
const JSON_OUT = ARGS.has('--json');

// ── 正则提取 ──

/** 匹配 bus.emit("name", ...) / bus.on("name", ...) 等，捕获事件名和文件:行。 */
const BUS_CALL_RE = /bus\.(emit|on|once|off)\(\s*['"]([^'"]+)['"]/g;

/** 剥离注释（保留字符串，事件名在字符串字面量里）。 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ');
}

// ── 扫描 ──

function collectFiles() {
  const files = walk(SRC_DIR);
  return files.filter((f) => !f.endsWith('.test.ts') && !f.endsWith('.spec.ts'));
}

function scanCalls(files) {
  /** @type {Map<string, { emit: string[], on: string[], once: string[] }>} */
  const eventMap = new Map();

  for (const f of files) {
    const text = fs.readFileSync(f, 'utf-8');
    const cleaned = stripComments(text);
    const lines = cleaned.split('\n');
    const rel = relPosix(f);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let m;
      const re = new RegExp(BUS_CALL_RE.source, 'g');
      while ((m = re.exec(line)) !== null) {
        const method = m[1]; // emit | on | once | off
        const event = m[2];
        if (!eventMap.has(event)) {
          eventMap.set(event, { emit: [], on: [], once: [], off: [] });
        }
        const entry = { file: rel, line: i + 1 };
        if (method === 'emit') eventMap.get(event).emit.push(entry);
        else if (method === 'on') eventMap.get(event).on.push(entry);
        else if (method === 'once') eventMap.get(event).once.push(entry);
        else if (method === 'off') eventMap.get(event).off.push(entry);
      }
    }
  }

  return eventMap;
}

// ── 渲染 ──

function renderMarkdown(eventMap) {
  const lines = [];
  lines.push('# Bus 事件映射表');
  lines.push('');
  lines.push('> **自动生成** — 由 `scripts/event-graph.mjs` 生成。');
  lines.push('> 改事件名 / payload 时，先看此表定位影响面。');
  lines.push('');

  // 总览
  const events = [...eventMap.keys()].sort();
  lines.push('## 总览');
  lines.push('');
  lines.push('| 事件 | 发射方 | 订阅方 | 一次性订阅 | 退订方 |');
  lines.push('|------|--------|--------|-----------|--------|');
  for (const ev of events) {
    const d = eventMap.get(ev);
    lines.push(`| \`${ev}\` | ${d.emit.length} | ${d.on.length} | ${d.once.length} | ${d.off.length} |`);
  }
  lines.push('');

  // 详细映射
  lines.push('## 事件详情');
  lines.push('');

  for (const ev of events) {
    const d = eventMap.get(ev);
    lines.push(`### \`${ev}\``);
    lines.push('');

    if (d.emit.length) {
      lines.push('**发射方（emit）：**');
      lines.push('');
      lines.push('| 文件 | 行 |');
      lines.push('|------|----|');
      for (const e of d.emit) {
        lines.push(`| \`${e.file}\` | ${e.line} |`);
      }
      lines.push('');
    }

    if (d.on.length) {
      lines.push('**订阅方（on）：**');
      lines.push('');
      lines.push('| 文件 | 行 |');
      lines.push('|------|----|');
      for (const e of d.on) {
        lines.push(`| \`${e.file}\` | ${e.line} |`);
      }
      lines.push('');
    }

    if (d.once.length) {
      lines.push('**一次性订阅（once）：**');
      lines.push('');
      lines.push('| 文件 | 行 |');
      lines.push('|------|----|');
      for (const e of d.once) {
        lines.push(`| \`${e.file}\` | ${e.line} |`);
      }
      lines.push('');
    }

    if (d.off.length) {
      lines.push('**退订方（off）：**');
      lines.push('');
      lines.push('| 文件 | 行 |');
      lines.push('|------|----|');
      for (const e of d.off) {
        lines.push(`| \`${e.file}\` | ${e.line} |`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

function renderJSON(eventMap) {
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
  return JSON.stringify({ _summary: { events: events.length }, events: data }, null, 2);
}

// ── 主流程 ──

function main() {
  if (!fs.existsSync(SRC_DIR)) {
    console.error('✖ frontend/src 不存在');
    process.exit(1);
  }

  const files = collectFiles();
  const eventMap = scanCalls(files);
  const md = renderMarkdown(eventMap);
  const json = renderJSON(eventMap);

  if (JSON_OUT) {
    console.log(json);
    return;
  }

  if (CHECK) {
    const existing = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf-8') : '';
    if (existing !== md) {
      console.error('✖ docs/event-graph.md 过期，运行 `node scripts/event-graph.mjs` 刷新。');
      process.exit(1);
    }
    console.log('✅ docs/event-graph.md 最新。');
    return;
  }

  fs.writeFileSync(OUT, md, 'utf-8');
  console.log(`📦 已写入 ${OUT}（${eventMap.size} 个事件）`);
}

main();
