#!/usr/bin/env node
/**
 * audit-split.mjs — 拆分/重构提交审计工具（主动情报型）。
 *
 * 设计意图：把「AI 手打 40+ 条 pwsh 指令审计 refactor 提交」的固定套路固化为一条口令：
 *   提交概览（文件/±行数）→ 文件分类（被拆主文件/新子文件/边角修改）→ 行数统计 +
 *   ADR-040 ≤400 红线 → 函数级迁移（旧导出符号去哪了：保留/搬家/真删）→ 新文件入口
 *   导出清单 → 受影响文件历史提交。与防御型 check-*（fail-closed 门禁）不同，这是
 *   情报型（proactive audit）：输出洞察供 AI/人直接消费，不阻断任何流程。
 *
 * 依赖：node:fs / node:path / node:child_process + scripts/_lib/{source-graph,scan-files}.mjs
 * 用法：
 *   node scripts/audit-split.mjs <commit>            # 审计单次提交（人读文本）
 *   node scripts/audit-split.mjs <commit> --json     # 机读 JSON（供子代理/CI 消费）
 *   node scripts/audit-split.mjs <commit> --redline  # 仅红线 ≤400 校验（违反退出码 1）
 * 退出码：0 审计成功；--redline 且存在 >400 行文件 → 1；缺参/commit 无效 → 2（其余 0）。
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { getExportedSymbolsAny } from './_lib/source-graph.mjs';
import { getRoot } from './_lib/scan-files.mjs';

const ROOT = getRoot();
const REDLINE = 400; // ADR-040：拆分后每文件 ≤400 行

// ── git 封装（Windows 安全：execFileSync 无 shell 展开）──

function git(args) {
  return execFileSync('git', args, {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'], // 探测型调用成败均不向终端撒 stderr
  });
}

/** git 命令，失败返回 null（如路径不存在/二进制）。 */
function gitMaybe(args) {
  try { return git(args); } catch { return null; }
}

/** git show <ref>:<path> 的文本内容，失败返回 null。 */
function showAt(ref, path) {
  return gitMaybe(['show', `${ref}:${path}`]);
}

/** 路径在 <ref> 是否存在。 */
function existsAt(ref, path) {
  return gitMaybe(['cat-file', '-e', `${ref}:${path}`]) !== null;
}

/** 行数口径：换行数 +（非空且不以换行结尾 ? 1 : 0），与 line-counter 一致。 */
function countLines(text) {
  if (text === null || typeof text !== 'string') return null;
  const nl = (text.match(/\n/g) || []).length;
  return nl + (text.length > 0 && !text.endsWith('\n') ? 1 : 0);
}

// ── 提交信息 ──

function commitMeta(ref) {
  const fmt = '%H%x09%h%x09%an%x09%ad%x09%s';
  const line = git(['show', '-s', `--format=${fmt}`, '--date=short', ref]).trim();
  if (!line) return null;
  const [hash, short, author, date, ...rest] = line.split('\t');
  return { hash, short, author, date, subject: rest.join('\t') };
}

/** numstat 解析文件清单：adds	dels	path（--no-renames 防 rename 花括号污染）。 */
function fileList(commit) {
  const out = git(['show', '--numstat', '--format=', '--no-renames', commit]).trim();
  if (!out) return [];
  return out.split('\n').map((l) => {
    const [adds, dels, ...rest] = l.split('\t');
    const path = rest.join('\t').trim();
    if (!path) return null;
    return {
      path,
      insertions: adds === '-' ? null : Number(adds),
      deletions: dels === '-' ? null : Number(dels),
      binary: adds === '-',
    };
  }).filter(Boolean);
}

// ── 分类：被拆主文件 / 新子文件 / 边角修改 ──

function classify(files, commit) {
  const mainThreshold = 80; // 删除 ≥80 行才视为「被拆主文件」
  for (const f of files) {
    if (f.binary) { f.kind = 'binary'; continue; }
    const before = existsAt(`${commit}^`, f.path);
    if (!before) { f.kind = 'new'; continue; }
    f.kind = (f.deletions >= mainThreshold && f.deletions > f.insertions) ? 'split-main' : 'modified';
  }
  return files;
}

// ── 函数级迁移：旧导出符号 → 保留/搬家/真删 ──

// 顶层声明提取（导出+私有）。Go 拆分通常把私有实现搬去子文件、导出符号留壳，
// 只追导出符号会漏掉真正去向，故迁移追踪用全量顶层声明口径。
function goTopFuncs(text) {
  const out = new Set();
  const re = /\bfunc\s+(?:\(([^)]*)\)\s+)?([A-Za-z0-9_]+)\s*\(/gm;
  let m;
  while ((m = re.exec(text))) {
    const name = m[2];
    let key = name;
    if (m[1]) {
      const tm = m[1].match(/([A-Za-z0-9_]+)(?:\s*\[[^\]]*\])?\s*$/);
      const t = tm ? tm[1] : '';
      key = t ? `${t}.${name}` : name;
    }
    out.add(key);
  }
  return [...out];
}

function tsTopDecls(text) {
  const out = new Set();
  const re1 = /^(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|enum)\s+([A-Za-z0-9_]+)/gm;
  let m;
  while ((m = re1.exec(text))) out.add(m[1]);
  const re2 = /^(?:export\s+)?(?:const|let)\s+([A-Za-z0-9_]+)\s*=/gm;
  while ((m = re2.exec(text))) out.add(m[1]);
  return [...out];
}

function topDeclsAny(path, text) {
  return path.toLowerCase().endsWith('.go') ? goTopFuncs(text) : tsTopDecls(text);
}

function funcMigration(commit, mainPath, allPaths) {
  const oldText = showAt(`${commit}^`, mainPath);
  const oldAll = oldText ? topDeclsAny(mainPath, oldText) : [];
  const oldExp = oldText ? getExportedSymbolsAny(mainPath, oldText) : [];
  const fileAll = new Map(); // path -> Set(顶层声明)
  const fileExp = new Map(); // path -> Set(导出符号)
  for (const p of allPaths) {
    const t = showAt(commit, p);
    const empty = new Set();
    if (t === null) { fileAll.set(p, empty); fileExp.set(p, empty); continue; }
    fileAll.set(p, new Set(topDeclsAny(p, t)));
    fileExp.set(p, new Set(getExportedSymbolsAny(p, t)));
  }
  const mainNew = fileAll.get(mainPath) ?? new Set();
  const kept = [], moved = {}, deleted = [];
  for (const sym of oldAll) {
    if (mainNew.has(sym)) { kept.push(sym); continue; } // 留在主文件（壳）
    let where = null, exported = false;
    for (const [p, s] of fileAll) {
      if (p === mainPath) continue; // 已确认不在主文件，只看子文件
      if (s.has(sym)) { where = p; exported = fileExp.get(p)?.has(sym) ?? false; break; }
    }
    if (where) moved[sym] = { to: where, exported, wasExport: oldExp.includes(sym) };
    else deleted.push({ name: sym, wasExport: oldExp.includes(sym) });
  }
  return { kept, moved, deleted, oldAll: oldAll.length, oldExports: oldExp.length };
}

// ── 输出──

function human(report) {
  const c = report.commit;
  const L = [];
  L.push('═'.repeat(66));
  L.push(` audit-split —— ${c.short} ${c.subject}`);
  L.push(` (${c.author} · ${c.date})  ${report.files.length} 文件, +${report.totalIns}/-${report.totalDel}`);
  L.push('═'.repeat(66));

  L.push('');
  L.push('① 文件清单与分类');
  for (const f of report.files) {
    const ins = f.insertions ?? 'Bin', del = f.deletions ?? 'Bin';
    const tag = f.kind === 'split-main' ? '拆' : f.kind === 'new' ? '新' : f.kind === 'binary' ? '二' : '改';
    const lines = f.linesAtCommit ?? '-';
    const col = f.path.length > 45 ? f.path : f.path.padEnd(45);
    L.push(`   [${tag}] ${col}  ${String(ins).padStart(4)}+/${String(del).padStart(4)}-  ${String(lines).padStart(4)}行`);
  }

  L.push('');
  L.push('② 函数级迁移（旧导出符号去向）');
  const mains = report.files.filter((f) => f.kind === 'split-main');
  if (!mains.length) {
    L.push('   （无被拆主文件，跳过）');
  }
  for (const m of mains) {
    const mg = report.migrations[m.path];
    const mv = Object.entries(mg.moved);
    L.push(`   ▸ ${m.path}  顶层声明 ${mg.oldAll}（导出 ${mg.oldExports}）→ 保留 ${mg.kept.length} · 搬家 ${mv.length} · 真删 ${mg.deleted.length}`);
    for (const [sym, info] of mv) {
      const tag = info.exported ? '导出' : '私有';
      L.push(`       ↳ [${tag}] ${sym}  →  ${info.to}`);
    }
    for (const d of mg.deleted) {
      const tag = d.wasExport ? '导出' : '私有';
      L.push(`       ✗ [${tag}] ${d.name}  （彻底删除）`);
    }
  }

  const newFiles = report.files.filter((f) => f.kind === 'new');
  if (newFiles.length) {
    L.push('');
    L.push('③ 新文件入口（导出符号）');
    for (const n of newFiles) {
      const ex = report.newExports[n.path] || [];
      L.push(`   ▸ ${n.path}  (${n.linesAtCommit}行) 导出: ${ex.length ? ex.join(', ') : '—'}`);
    }
  }

  L.push('');
  L.push('④ 红线 ADR-040（拆分后 ≤400 行）');
  if (report.redline.over.length) {
    for (const o of report.redline.over) L.push(`   ✗ ${o.path}  ${o.lines} 行 > 400`);
  } else {
    L.push(`   ✅ 全部合规（本提交涉及文件最大 ${report.redline.max} 行）`);
  }

  L.push('');
  L.push('⑤ 受影响文件历史提交（拆/新文件，各至多 5 条）');
  for (const f of [...mains, ...newFiles]) {
    const h = report.history[f.path] || [];
    L.push(`   ▸ ${f.path}`);
    for (const line of h) L.push(`       ${line}`);
  }
  return L.join('\n');
}

// ── 主流程 ──

function audit(commit) {
  const meta = commitMeta(commit);
  if (!meta) return { error: `commit 无效: ${commit}` };
  const files = classify(fileList(commit), commit);
  const totalIns = files.reduce((s, f) => s + (f.insertions ?? 0), 0);
  const totalDel = files.reduce((s, f) => s + (f.deletions ?? 0), 0);
  const paths = files.map((f) => f.path);

  const migrations = {};
  const newExports = {};
  const history = {};
  const over = [];
  let max = 0;
  for (const f of files) {
    f.linesAtCommit = f.binary ? null : countLines(showAt(commit, f.path));
    if (!f.binary && f.linesAtCommit !== null) {
      max = Math.max(max, f.linesAtCommit);
      if (f.linesAtCommit > REDLINE) over.push({ path: f.path, lines: f.linesAtCommit });
    }
    if (f.kind === 'split-main') migrations[f.path] = funcMigration(commit, f.path, paths);
    if (f.kind === 'new') {
      const t = showAt(commit, f.path);
      newExports[f.path] = t ? getExportedSymbolsAny(f.path, t) : [];
    }
    if (f.kind === 'split-main' || f.kind === 'new') {
      const log = gitMaybe(['log', '--oneline', '-5', '--', f.path]);
      history[f.path] = log ? log.trim().split('\n').filter(Boolean) : [];
    }
  }

  return {
    kind: 'audit-split',
    commit: meta,
    files,
    totalIns,
    totalDel,
    migrations,
    newExports,
    redline: { limit: REDLINE, max, over },
    history,
  };
}

// ── CLI ──

const argv = process.argv.slice(2);
const json = argv.includes('--json');
const redlineOnly = argv.includes('--redline');
const commitArg = argv.find((a) => !a.startsWith('--') && !a.endsWith('..') && !a.startsWith('..'));

if (!commitArg) {
  console.error('用法: node scripts/audit-split.mjs <commit> [--json|--redline]');
  process.exit(2);
}

const report = audit(commitArg);
if (report.error) {
  console.error(report.error);
  process.exit(2);
}

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(human(report));
}
if (redlineOnly && report.redline.over.length) process.exit(1);
process.exit(0);
