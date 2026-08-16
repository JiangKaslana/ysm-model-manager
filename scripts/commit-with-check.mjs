#!/usr/bin/env node
/**
 * commit-with-check.mjs — 验证 + 自动提交的 thin wrapper（ADR-086 配套，2026-08-17 重构）
 *
 * 核心洞察：把 AI 的「确认性循环」（改代码→tsc→build→test→git add→commit→git log）
 * 压缩为「改代码→commit-with-check」单条命令。
 *
 * 设计（thin wrapper）：
 *   1. 读 git staged files，仅作变更域摘要展示
 *   2. 检查全部委托给 pre-push-gate.mjs（--all --dry-run / --docs --dry-run）
 *      ——检查清单单一源头 = pre-push-gate，不再平行维护第二套
 *   3. 门禁全绿后自动 git commit（message 用数组参数传递，杜绝 shell 注入）
 *   4. 提交后自动显示 SHA + status（省 git log/git status 确认）
 *
 * 用法：
 *   node scripts/commit-with-check.mjs -m "feat: xxx"          # 全量门禁 + 提交
 *   node scripts/commit-with-check.mjs -m "feat: xxx" --docs   # 仅文档域门禁 + 提交
 *   node scripts/commit-with-check.mjs --check                 # 仅验证不提交
 *   node scripts/commit-with-check.mjs --check --docs          # 仅文档域验证
 *
 * 退出码：
 *   0 — 全绿且已提交（或 --check 模式全绿）
 *   1 — 门禁失败，未提交
 *   2 — 用法错误
 *
 * 依赖：node:child_process / _lib/scan-files / _lib/domain-classify
 */
import { execFileSync } from 'node:child_process';
import { ROOT } from './_lib/scan-files.mjs';
import { classify } from './_lib/domain-classify.mjs';

// ── 参数解析 ──
const args = process.argv.slice(2);
let message = '';
let docsMode = false;
let checkOnly = false;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '-m' || a === '--message') {
    message = args[++i] || '';
  } else if (a === '--docs') {
    docsMode = true;
  } else if (a === '--check') {
    checkOnly = true;
  } else if (a === '--fast') {
    console.warn('⚠️  --fast 已移除：thin wrapper 统一走 pre-push-gate 全量门禁，不再支持跳过 vitest。');
  } else if (a === '-h' || a === '--help') {
    console.log(`用法: node scripts/commit-with-check.mjs -m "<msg>" [--docs|--check]
  -m, --message   commit message（必填，除非 --check）
  --docs          仅文档域检查（等价 pre-push-gate --docs --dry-run）
  --check         仅验证不提交
  --fast          已移除（thin wrapper 统一全量门禁）`);
    process.exit(0);
  }
}

if (!checkOnly && !message) {
  console.error('用法: node scripts/commit-with-check.mjs -m "<msg>" [--docs|--check]');
  process.exit(2);
}

// ── 辅助函数 ──
function git(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function gitArray(args) {
  try {
    execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return 0;
  } catch (e) {
    return e.status ?? 1;
  }
}

// ── 1. 读 staged files，展示变更域（检查本身委托 pre-push-gate）──
const stagedRaw = git(['diff', '--cached', '--name-only']);
const stagedFiles = stagedRaw ? stagedRaw.split('\n').filter(Boolean) : [];

if (stagedFiles.length === 0) {
  console.error('⚠️  无 staged files。先 git add 再跑本脚本。');
  process.exit(1);
}

const byDomain = {};
for (const f of stagedFiles) (byDomain[classify(f)] = byDomain[classify(f)] || []).push(f);
const domainSummary = Object.keys(byDomain).length
  ? Object.entries(byDomain).map(([d, fs]) => `${d}:${fs.length}`).join('  ')
  : '无变更';

console.log('========== commit-with-check（thin wrapper → pre-push-gate）==========');
console.log(`变更域: ${domainSummary}`);
console.log(`门禁: ${docsMode ? 'pre-push-gate --docs --dry-run' : 'pre-push-gate --all --dry-run'}`);
console.log('');

// ── 2. 委托 pre-push-gate（唯一检查清单源头）──
const gateArgs = docsMode ? ['--docs', '--dry-run'] : ['--all', '--dry-run'];
let gateRc = 0;
try {
  execFileSync(process.execPath, ['scripts/pre-push-gate.mjs', ...gateArgs], {
    cwd: ROOT,
    stdio: 'inherit',
    timeout: 600_000,
  });
} catch (e) {
  gateRc = e.status ?? 1;
}

if (gateRc !== 0) {
  console.log('');
  console.log('结论: FAIL ❌ 门禁未通过，未提交');
  process.exit(1);
}

if (checkOnly) {
  console.log('');
  console.log('结论: PASS ✅ 门禁全绿（仅验证，未提交）');
  process.exit(0);
}

// ── 3. 全绿后自动 git commit（数组参数，杜绝命令注入）──
const commitRc = gitArray(['commit', '-m', message]);
if (commitRc !== 0) {
  console.error('❌ git commit 失败（可能是 pre-commit 钩子拦截，或 message 格式问题）');
  process.exit(1);
}

// ── 4. 提交后自动显示 SHA + status ──
const sha = git(['rev-parse', '--short', 'HEAD']);
const subject = git(['log', '-1', '--format=%s']);
console.log(`✅ 已提交: ${sha} ${subject}`);
console.log('');

const status = git(['status', '--short']);
if (status) {
  console.log('剩余未暂存改动:');
  console.log(status);
} else {
  console.log('工作区干净，无剩余改动。');
}

process.exit(0);