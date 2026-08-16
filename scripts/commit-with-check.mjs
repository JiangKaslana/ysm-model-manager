#!/usr/bin/env node
/**
 * commit-with-check.mjs — 一次性验证脚本（ADR-086 配套）
 *
 * 核心洞察：把 AI 的「确认性循环」（改代码→tsc→build→test→git add→commit→git log）
 * 压缩为「改代码→commit-with-check」单条命令。
 *
 * 设计：
 *   1. 读 git staged files，基于 domain-classify 判断变更域
 *   2. 按域跑相关检查（秒级静态工具 + 相关域编译/测试）
 *   3. 全绿后自动 git commit（message 由调用方提供）
 *   4. 提交后自动显示 SHA + 状态（省 git log 确认）
 *
 * 用法：
 *   node scripts/commit-with-check.mjs -m "feat: xxx"          # 全流程
 *   node scripts/commit-with-check.mjs -m "feat: xxx" --fast   # 跳过 vitest（仅 tsc+build）
 *   node scripts/commit-with-check.mjs -m "feat: xxx" --docs   # 仅文档域检查
 *   node scripts/commit-with-check.mjs --check                 # 仅验证不提交
 *
 * 退出码：
 *   0 — 全绿且已提交（或 --check 模式全绿）
 *   1 — 检查失败，未提交
 *   2 — 用法错误
 *
 * 依赖：复用 scripts/_lib/ 共享层（domain-classify / proc / scan-files）
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './_lib/scan-files.mjs';
import { classify, planFromFiles } from './_lib/domain-classify.mjs';

// ── 参数解析 ──
const args = process.argv.slice(2);
let message = '';
let fastMode = false;
let docsMode = false;
let checkOnly = false;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '-m' || a === '--message') {
    message = args[++i] || '';
  } else if (a === '--fast') {
    fastMode = true;
  } else if (a === '--docs') {
    docsMode = true;
  } else if (a === '--check') {
    checkOnly = true;
  } else if (a === '-h' || a === '--help') {
    console.log(`用法: node scripts/commit-with-check.mjs -m "<msg>" [--fast|--docs|--check]
  -m, --message   commit message（必填，除非 --check）
  --fast          跳过 vitest（仅 tsc + build）
  --docs          仅文档域检查（等价 doctor --docs）
  --check         仅验证不提交`);
    process.exit(0);
  }
}

if (!checkOnly && !message) {
  console.error('用法: node scripts/commit-with-check.mjs -m "<msg>" [--fast|--docs|--check]');
  process.exit(2);
}

// ── 辅助函数 ──
function sh(cmd, opts = {}) {
  try {
    const out = execFileSync('sh', ['-c', cmd], {
      cwd: opts.cwd || ROOT,
      encoding: 'utf8',
      timeout: opts.timeout || 120_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { rc: 0, out };
  } catch (e) {
    return { rc: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') };
  }
}

function git(args) {
  const r = sh(`git ${args}`);
  return r.out.trim();
}

/**
 * 以数组参数直接执行 git，避免 shell 插值命令注入。
 * 用于 commit message 等用户可控/含特殊字符的输入（审计 2026-08-17 子代理）。
 */
function gitArray(args) {
  try {
    const out = execFileSync('git', args, {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 120_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { rc: 0, out };
  } catch (e) {
    return { rc: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') };
  }
}

const results = [];
let blocked = false;
const record = (label, ok, { time = 0, note = '', tail = '' } = {}) => {
  results.push({ label, ok, time, note, tail });
  if (!ok) blocked = true;
};

// ── 1. 读 staged files，判断变更域 ──
const stagedRaw = git('diff --cached --name-only');
const stagedFiles = stagedRaw ? stagedRaw.split('\n').filter(Boolean) : [];

if (stagedFiles.length === 0) {
  console.error('⚠️  无 staged files。先 git add 再跑本脚本。');
  process.exit(1);
}

const plan = docsMode
  ? { go: false, frontend: false, data: false, docs: true, adr: true, contractTests: false, redlines: false }
  : planFromFiles(stagedFiles);

const byDomain = {};
for (const f of stagedFiles) (byDomain[classify(f)] = byDomain[classify(f)] || []).push(f);
const domainSummary = Object.keys(byDomain).length
  ? Object.entries(byDomain).map(([d, fs]) => `${d}:${fs.length}`).join('  ')
  : '无变更';

console.log('========== commit-with-check ==========');
console.log(`变更域: ${domainSummary}`);
console.log(`计划: go=${plan.go} frontend=${plan.frontend} data=${plan.data} docs=${plan.docs} adr=${plan.adr}`);
console.log('');

// ── 2. 按域跑相关检查 ──

// Go 域
if (plan.go) {
  const t0 = Date.now();
  const goBuild = sh('go build ./go/...');
  record('go build', goBuild.rc === 0, { time: Date.now() - t0, tail: goBuild.rc ? goBuild.out.split('\n').slice(-4).join('\n') : '' });

  const t1 = Date.now();
  const goTest = sh('go test ./go/... -count=1 -timeout 5m');
  record('go test', goTest.rc === 0, { time: Date.now() - t1, tail: goTest.rc ? goTest.out.split('\n').slice(-4).join('\n') : '' });
}

// 前端域
if (plan.frontend) {
  const frontendDir = path.join(ROOT, 'frontend');

  // tsc --noEmit（秒级，先跑）
  const tT = Date.now();
  const tscBin = path.join(frontendDir, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');
  if (fs.existsSync(tscBin)) {
    const tt = sh(`"${tscBin}" --noEmit`, { cwd: frontendDir });
    const lines = (tt.out || '').trim().split('\n').filter(Boolean);
    record('tsc --noEmit', tt.rc === 0, { time: Date.now() - tT, note: tt.rc === 0 ? '' : `${lines.length} errors`, tail: tt.rc === 0 ? '' : lines.slice(-5).join('\n') });
  } else {
    record('tsc --noEmit', true, { time: 0, note: 'tsc 未安装，跳过' });
  }

  // vite build（~5s）
  const t0 = Date.now();
  const fb = sh('npx vite build', { cwd: frontendDir, timeout: 180_000 });
  record('vite build', fb.rc === 0, { time: Date.now() - t0, tail: fb.rc ? fb.out.split('\n').slice(-4).join('\n') : '' });

  // vitest run（~30s，--fast 跳过）
  if (!fastMode) {
    const t1 = Date.now();
    const ft = sh('npx vitest run --maxWorkers 8', { cwd: frontendDir, timeout: 300_000 });
    record('vitest run', ft.rc === 0, { time: Date.now() - t1, tail: ft.rc ? ft.out.split('\n').slice(-4).join('\n') : '' });
  }
}

// 数据域
if (plan.data) {
  const t0 = Date.now();
  const tc = sh('node scripts/type-consistency.mjs --json');
  let issues = null;
  try { issues = JSON.parse(tc.out)._summary?.issues ?? 0; } catch { /* parse fail */ }
  record('type-consistency', issues === 0, { time: Date.now() - t0, note: issues === null ? '解析失败' : (issues === 0 ? '一致' : `${issues} 个不一致`) });
}

// 文档域
if (plan.docs) {
  const t0 = Date.now();
  const lc = sh('node scripts/link-checker.mjs --json');
  let broken = null;
  try { broken = JSON.parse(lc.out)._summary?.links_broken ?? 0; } catch { /* parse fail */ }
  record('link-checker', broken === 0, { time: Date.now() - t0, note: broken === null ? '解析失败' : (broken === 0 ? '全部有效' : `${broken} 条断链`) });
}

// ADR 域
if (plan.adr) {
  const t0 = Date.now();
  const ac = sh('node scripts/adr-check.mjs');
  record('adr-check', ac.rc === 0, { time: Date.now() - t0, tail: ac.rc ? ac.out.split('\n').slice(-4).join('\n') : '' });
}

// 红线域
if (plan.redlines) {
  const t0 = Date.now();
  const rl = sh('node scripts/check-redlines.mjs --json --baseline');
  let ok = false;
  try { ok = JSON.parse(rl.out)._summary?.ok === true; } catch { ok = false; }
  record('check-redlines', ok, { time: Date.now() - t0, note: ok ? '红线零新增' : '有新增红线' });
}

// ── 3. 聚合摘要 ──
console.log('------------------- 结果 -------------------');
for (const r of results) {
  const status = r.ok ? '✅' : '❌';
  console.log(`${status} ${r.label.padEnd(20)} ${(r.time / 1000).toFixed(1)}s  ${r.note || ''}`);
  if (r.tail) for (const line of r.tail.split('\n')) console.log(`       ${line}`);
}
console.log('');

if (blocked) {
  console.log(`结论: FAIL ❌ ${results.filter((r) => r.ok).length}/${results.length} 项通过，未提交`);
  process.exit(1);
}

if (checkOnly) {
  console.log(`结论: PASS ✅ ${results.filter((r) => r.ok).length}/${results.length} 项通过（仅验证，未提交）`);
  process.exit(0);
}

// ── 4. 全绿后自动 git commit ──
// 审计修复：用数组参数传 message，杜绝反引号/$/;/| 命令注入（原来只转义双引号）
const commitRc = gitArray(['commit', '-m', message]).rc;
if (commitRc !== 0) {
  console.error('❌ git commit 失败（可能是 pre-commit 钩子拦截，或 message 格式问题）');
  process.exit(1);
}

// ── 5. 提交后自动显示 SHA + 状态（省 git log 确认）──
const sha = git('rev-parse --short HEAD');
const subject = git('log -1 --format=%s');
console.log(`✅ 已提交: ${sha} ${subject}`);
console.log('');

// 自动显示 git status（省 git status 确认）
const status = git('status --short');
if (status) {
  console.log('剩余未暂存改动:');
  console.log(status);
} else {
  console.log('工作区干净，无剩余改动。');
}

process.exit(0);
