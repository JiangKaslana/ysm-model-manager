#!/usr/bin/env node
/**
 * event-graph.mjs — Bus 事件契约守护者。
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
