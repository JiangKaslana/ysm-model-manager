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