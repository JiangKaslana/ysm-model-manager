#!/usr/bin/env node
/**
 * api-break.mjs — 任意两 ref 之间的破坏性变更检测（audit-split 的通用化）。
 *
 * 设计意图：audit-split 只比 `commit^` vs `commit`；本工具把比对泛化为
 * **任意两点**（分支间 / 标签间 / 任意两 commit 间）。对给定 ref 对，输出：
 *   1. 文件变更概览（新增/删除/修改/重命名）；
 *   2. 破坏性变更：older 有但在 newer 消失的**导出符号** → 在 newer 下扫调用方；
 *   3. 新增导出符号清单（情报，供下游参考）；
 *   4. 红线提醒：newer 下任何文件 > 400 行（ADR-040）。
 *
 * 典型用法：
 *   node scripts/api-break.mjs main HEAD                    # 分支合并前检查
 *   node scripts/api-break.mjs v1.11 v1.12                  # 版本发布间检查
 *   node scripts/api-break.mjs abc123 def456 --scope go/    # 限定扫描范围
 *
 * 依赖：scripts/_lib/{git-ref,source-graph,scan-files}.mjs（零外部依赖）。
 *
 * 退出码：0 成功；`--redline` 且存在 >400 行文件 → 1；缺参/ref 无效 → 2。
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  showAt, existsAt, renamePairs, gitMaybe,
} from './_lib/git-ref.mjs';
import { getExportedSymbolsAny } from './_lib/source-graph.mjs';
import { walk, ROOT, toPosix } from './_lib/scan-files.mjs';

const REDLINE = 400; // ADR-040：单文件 ≤400 行

// ── 顶层声明提取（与 audit-split / rollback-impact 同源口径）──
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
function topDeclsAny(p, text) {
  return p.toLowerCase().endsWith('.go') ? goTopFuncs(text) : tsTopDecls(text);
}
function searchName(sym) { return sym.includes('.') ? sym.split('.').pop() : sym; }
function countLines(t) {
  if (!t) return null;
  const nl = (t.match(/\n/g) || []).length;
  return nl + (t.length > 0 && !t.endsWith('\n') ? 1 : 0);
}

// ── 核心比对 ──
// 优化：只用 git diff --name-only 拿变更文件清单（而非 diffTree 全量遍历），
// 大幅减少 showAt 调用次数。对大 diff（如 merge base → HEAD）可快 10x+。
const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.go']);
function isSourceFile(p) {
  const ext = path.extname(p).toLowerCase();
  return SOURCE_EXTS.has(ext);
}

function gitDiffNames(older, newer) {
  // git diff --name-only older newer：只列变更路径，O(1) 次调用
  const out = gitMaybe(['diff', '--name-only', older, newer]);
  if (!out) return [];
  return out.trim().split('\n').filter(Boolean);
}

function compare(older, newer, scope) {
  // 1. 变更文件清单（git diff --name-only，只列实际变化的文件）
  const allChanged = gitDiffNames(older, newer);
  // 2. rename 配对（用于从"删除"和"新增"中排除 rename 产生的假象）
  const renames = renamePairs(older, newer, 50);
  const renameFromSet = new Set(renames.map((r) => r.oldPath));
  const renameToSet = new Set(renames.map((r) => r.newPath));

  // 3. 分类
  const addedFiles = [];
  const removedFiles = [];
  const modifiedFiles = [];
  for (const p of allChanged) {
    if (renameFromSet.has(p)) continue; // rename 的 from 侧，后续用 renames 处理
    const inOlder = existsAt(older, p);
    const inNewer = existsAt(newer, p);
    if (!inOlder && inNewer) addedFiles.push(p);
    else if (inOlder && !inNewer) removedFiles.push(p);
    else if (inOlder && inNewer) modifiedFiles.push(p);
  }
  // 排除 rename 到处的"新增"（from 已在上面跳过，to 侧如果也在 allChanged 里会进 addedFiles，需要排除）
  const finalAdded = addedFiles.filter((p) => !renameToSet.has(p));
  const finalRemoved = removedFiles.filter((p) => !renameFromSet.has(p));

  // 4. 对 modified 文件提取新旧顶层声明（仅分析源码文件）
  const mods = [];
  for (const p of modifiedFiles) {
    if (!isSourceFile(p)) continue;
    const oldText = showAt(older, p);
    const newText = showAt(newer, p);
    if (oldText === null && newText === null) continue;
    const oldAll = new Set(oldText ? topDeclsAny(p, oldText) : []);
    const newAll = new Set(newText ? topDeclsAny(p, newText) : []);
    const oldExp = new Set(oldText ? getExportedSymbolsAny(p, oldText) : []);
    const newExp = new Set(newText ? getExportedSymbolsAny(p, newText) : []);
    const deleted = [...oldAll].filter((s) => !newAll.has(s));
    const added = [...newAll].filter((s) => !oldAll.has(s));
    const deletedExp = deleted.filter((s) => oldExp.has(s));
    const addedExp = added.filter((s) => newExp.has(s));
    const newLines = countLines(newText);
    if (deleted.length || added.length) {
      mods.push({
        path: p,
        deleted, added, deletedExp, addedExp,
        oldLines: countLines(oldText),
        newLines,
        redline: newLines !== null && newLines > REDLINE,
      });
    }
  }

  // 5. 对 removed 文件整体视为"全部符号消失"（仅源码文件）
  const removedTraces = [];
  for (const p of finalRemoved) {
    if (!isSourceFile(p)) continue;
    const oldText = showAt(older, p);
    if (oldText === null) continue;
    const oldAll = topDeclsAny(p, oldText);
    const oldExp = new Set(getExportedSymbolsAny(p, oldText));
    removedTraces.push({ path: p, syms: oldAll, exp: oldExp, lines: countLines(oldText) });
  }

  return {
    older, newer,
    renames,
    mods, removedTraces,
    addedFiles: finalAdded, removedFiles: finalRemoved,
    modifiedCount: modifiedFiles.length,
  };
}

// ── 调用方扫描（基于 newer ref 的文本）──
// 只对 go/ + frontend/src 扫描：源码目录才有导出符号，docs/novel 等目录
// 即使路径存在也不含顶层声明，盲目全仓扫描会触发大量 git show 噪音并超时。
function scanCallersInRef(terms, newer, scope) {
  if (!terms.length) return new Map();
  const callers = new Map();
  const exts = ['.ts', '.tsx', '.js', '.jsx', '.go'];
  const skipFileRe = /\.(test|spec)\.[jt]sx?$/;
  const scanRoots = [];
  if (scope) {
    const abs = scope.startsWith('/') || scope.startsWith('C:\\') ? scope : path.join(ROOT, scope);
    if (fs.existsSync(abs)) scanRoots.push(abs);
  } else {
    // 只扫源码目录（和 rollback-impact 默认口径一致）
    const goDir = ROOT + '/go';
    const srcDir = ROOT + '/frontend/src';
    if (fs.existsSync(goDir)) scanRoots.push(goDir);
    if (fs.existsSync(srcDir)) scanRoots.push(srcDir);
  }
  for (const dir of scanRoots) {
    try {
      const files = walk(dir, { exts, skipFile: (n) => skipFileRe.test(n) });
      for (const f of files) {
        if (typeof f !== 'string') continue;
        const rel = toPosix(path.relative(ROOT, f));
        // 跳过二进制 / 不存在于 newer 的文件（避免 git show 噪声）
        if (rel.endsWith('.png') || rel.endsWith('.gif') || rel.endsWith('.jpg')) continue;
        // R5 修复：existsAt/showAt 的 toGitPath 假设绝对路径（path.relative(ROOT, p)），
        // 传相对路径 rel 在 cwd≠ROOT 时解析错位 → 漏报断链调用方；walk 返回绝对路径 f
        if (!existsAt(newer, f)) continue; // 磁盘有但 newer ref 无（并行拆分的在建文件）→ 跳过，否则 git show 报 fatal 噪声
        const text = showAt(newer, f);
        if (!text) continue;
        for (const sym of terms) {
          const nm = searchName(sym);
          const escaped = nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const re = new RegExp('\\b' + escaped + '\\b', 'g');
          if (re.test(text)) {
            let arr = callers.get(sym);
            if (!arr) { arr = []; callers.set(sym, arr); }
            arr.push(rel);
          }
        }
      }
    } catch (e) {
      console.error(`[api-break] 扫描失败 ${dir}: ${e.message}`);
    }
  }
  return callers;
}

// ── 输出 ──
function human(report, callers, compact) {
  const L = [];
  L.push('\u2550'.repeat(66));
  L.push(` api-break —— ${report.older} ←→ ${report.newer}`);
  L.push('\u2550'.repeat(66));
  L.push('');
  L.push('① 文件变更概览');
  L.push(`   新增: ${report.addedFiles.length} · 删除: ${report.removedFiles.length} · 修改: ${report.mods.length} · 重命名: ${report.renames.length} 对`);
  if (report.renames.length && !compact) {
    for (const r of report.renames.slice(0, 10)) {
      L.push(`   ▸ ${r.oldPath}  →  ${r.newPath}`);
    }
    if (report.renames.length > 10) L.push(`   … 以及 ${report.renames.length - 10} 对（--json 全量）`);
  }

  const allDeletedExp = report.mods.flatMap((m) => m.deletedExp).concat(
    report.removedTraces.flatMap((r) => [...r.exp].map((s) => s))
  );
  if (allDeletedExp.length) {
    L.push('');
    L.push('② 破坏性变更（导出符号消失）');
    let totalCalls = 0;
    for (const m of report.mods) {
      if (!m.deletedExp.length) continue;
      L.push(`   ▸ ${m.path}  删除 ${m.deletedExp.length} 个导出`);
      for (const sym of m.deletedExp) {
        const list = callers.get(sym) || [];
        if (list.length) {
          totalCalls += list.length;
          L.push(`       ✗ ${sym}  （${list.length} 处引用）`);
          for (const c of list.slice(0, 5)) L.push(`           ↳ ${c}`);
          if (list.length > 5) L.push(`           … 以及 ${list.length - 5} 处`);
        } else {
          L.push(`       ✓ ${sym}  （当前无引用）`);
        }
      }
    }
    for (const r of report.removedTraces) {
      if (!r.exp.size) continue;
      L.push(`   ▸ ${r.path}  （整文件删除，导出 ${r.exp.size} 个）`);
      for (const sym of [...r.exp].sort()) {
        const list = callers.get(sym) || [];
        if (list.length) {
          totalCalls += list.length;
          L.push(`       ✗ ${sym}  （${list.length} 处引用）`);
          for (const c of list.slice(0, 5)) L.push(`           ↳ ${c}`);
        } else {
          L.push(`       ✓ ${sym}  （当前无引用）`);
        }
      }
    }
    L.push('');
    L.push('   共 ' + allDeletedExp.length + ' 个导出符号消失' + (totalCalls ? ` · ${totalCalls} 处潜在断链` : ' · 当前无断链'));
  } else {
    if (!compact) L.push('');
    L.push('② 破坏性变更：✅ 无导出符号消失');
  }

  const allAddedExp = report.mods.flatMap((m) => m.addedExp);
  if (allAddedExp.length) {
    L.push('');
    L.push('③ 新增导出符号（' + allAddedExp.length + ' 个）');
    for (const m of report.mods) {
      if (!m.addedExp.length) continue;
      L.push(`   ▸ ${m.path}`);
      for (const sym of m.addedExp) L.push(`       ✓ ${sym}`);
    }
  }

  const redlineFiles = report.mods.filter((m) => m.redline);
  if (redlineFiles.length) {
    L.push('');
    L.push('④ 红线 ADR-040（单文件 > ' + REDLINE + ' 行）');
    for (const m of redlineFiles) {
      L.push(`   ✗ ${m.path}  ${m.newLines} 行 > ${REDLINE}`);
    }
  }

  L.push('');
  L.push('⑤ 综合结论');
  const broken = allDeletedExp.length;
  const newExports = allAddedExp.length;
  const overRedline = redlineFiles.length;
  if (!broken && !newExports && !overRedline) L.push('   ✅ 无破坏性变更，两条 ref 兼容');
  else {
    const parts = [];
    if (broken) parts.push(broken + ' 个导出消失');
    if (allDeletedExp.length && callers) {
      const totalC = allDeletedExp.reduce((s, sym) => s + (callers.get(sym) || []).length, 0);
      if (totalC) parts.push(totalC + ' 处潜在断链');
    }
    if (newExports) parts.push(newExports + ' 个新增导出');
    if (overRedline) parts.push(overRedline + ' 个超红线文件');
    L.push('   ⚠️  ' + parts.join(' · '));
  }
  return L.join('\n');
}

function toJ(report, callers) {
  const allDeletedExp = report.mods.flatMap((m) => m.deletedExp).concat(
    report.removedTraces.flatMap((r) => [...r.exp])
  );
  const allAddedExp = report.mods.flatMap((m) => m.addedExp);
  const redlineFiles = report.mods.filter((m) => m.redline);
  let totalCalls = 0;
  for (const sym of allDeletedExp) totalCalls += (callers.get(sym) || []).length;
  return {
    kind: 'api-break',
    older: report.older,
    newer: report.newer,
    fileSummary: {
      added: report.addedFiles.length,
      removed: report.removedFiles.length,
      modified: report.mods.length,
      renamed: report.renames.length,
    },
    renames: report.renames,
    breakingChanges: allDeletedExp.length,
    callers: Object.fromEntries(
      allDeletedExp.map((sym) => [sym, callers.get(sym) || []])
    ),
    totalCallers: totalCalls,
    newExports: allAddedExp.length,
    newExportDetails: report.mods.map((m) => ({
      path: m.path,
      symbols: m.addedExp,
      oldLines: m.oldLines,
      newLines: m.newLines,
    })),
    redline: {
      limit: REDLINE,
      over: redlineFiles.length,
      files: redlineFiles.map((m) => ({ path: m.path, lines: m.newLines })),
    },
    safe: allDeletedExp.length === 0 && totalCalls === 0,
  };
}

// ── CLI ──

const argv = process.argv.slice(2);
const JSON_OUT = argv.includes('--json');
const QUIET = argv.includes('--quiet');
const REDLINE_ONLY = argv.includes('--redline');
const SCOPE = argv.includes('--scope') ? argv[argv.indexOf('--scope') + 1] : null;
const COMPACT = argv.includes('--compact');
const nonOpts = argv.filter((a) => !a.startsWith('--'));
if (nonOpts.length < 2) {
  console.error('用法: node scripts/api-break.mjs <older> <newer> [--scope <dir>] [--json] [--quiet] [--redline] [--compact]');
  process.exit(2);
}
const [older, newer] = nonOpts;

const report = compare(older, newer, SCOPE);
const allDeletedExp = report.mods.flatMap((m) => m.deletedExp).concat(
  report.removedTraces.flatMap((r) => [...r.exp])
);
const callers = allDeletedExp.length
  ? scanCallersInRef(allDeletedExp, newer, SCOPE)
  : new Map();

if (JSON_OUT) {
  console.log(JSON.stringify(toJ(report, callers), null, 2));
} else if (QUIET && allDeletedExp.length === 0) {
  // 静默模式（--quiet）：无破坏性变更时只输出一行结论，供 CI/脚本消费（Q1 实现）
  console.log('✅ 无破坏性变更');
} else {
  console.log(human(report, callers, COMPACT));
}
if (REDLINE_ONLY && report.mods.some((m) => m.redline)) process.exit(1);
process.exit(0);
