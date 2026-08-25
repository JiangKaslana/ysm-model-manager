#!/usr/bin/env node
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