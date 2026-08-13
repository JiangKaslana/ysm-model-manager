#!/usr/bin/env node
/**
 * pre-push-gate.mjs — 本地质量门禁核心（.githooks/pre-push 的调度器）。
 *
 * 设计目标：CI 红之前，本地先红。按变更域（Go / 前端 / 数据 / 文档）只跑相关检查；
 * gofmt 修复下沉 pre-commit（提交时自动 -w 修复 + stage）；pre-push 对未格式化只读检出不阻断
 * （格式类债务，2026-08-13 决策）；
 * 需人工的（构建失败、断链、契约失败、红线扫描不可用）同样阻断推送。
 * 分层哲学（2026-08-13）：硬错误（编译/测试/契约/链接）阻断推送；基线债务
 * （红线新增、死代码等"没有报错"的治理欠账）只报告不阻断——推送后修，发布前全量 doctor 兜底。
 * 例外：红线扫描本身不可用（rg 缺失/fail-closed）必须阻断，扫描没跑成不等于债务。
 *
 * 用法（由 .githooks/pre-push 调用）：
 *   node scripts/pre-push-gate.mjs <remote-name> <remote-url>
 *     标准输入：每行 `<local ref> <local oid> <remote ref> <remote oid>`
 *   node scripts/pre-push-gate.mjs --dry-run <remote-name> <remote-url>
 *     只检查不修改（gofmt 只读检出、不自动修复），供调试与 CI 复用
 *
 * 已知坑（2026-08-03 确认，2026-08-07 更新，2026-08-12 增补）：
 *   - link-checker.mjs / type-consistency.mjs 正常路径退出码恒 0，
 *     必须用 --json 解析 _summary 判定，不得依赖退出码；
 *     type-consistency 数据损坏/缺失的 fatal 路径现在 exit 1（+哨兵 _summary.issues=9999，code_review P3）。
 *   - Windows 下 npx 是 npx.cmd，node spawn 需 shell:true。
 *   - 严禁在 pre-push 内 commit --amend：git push 在调用钩子前已快照要推送的 oid，
 *     钩子里 amend 只是改本地 HEAD，推送的仍是旧 oid → 本地与远端分叉、二次 push 必被拒
 *     （2026-08-12 实测：gofmt amend 3291cb16 假成功，实际推送 b644e96b）。
 *     gofmt 修复因此下沉 pre-commit，此处只读校验。
 * 设计意图：pre-push-gate 工具脚本
 * 依赖：node:child_process / node:fs / node:path / node:url
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './_lib/scan-files.mjs';
import { run as procRun } from './_lib/proc.mjs';


const B = { OK: '[OK]', FAIL: '[FAIL]', FIX: '[FIX]', SKIP: '[SKIP]' };
const TIMEOUT = 300_000;
/** 远端领先提示（SKIP 与 FAIL 共用，避免重复长文案） */
const PULL_HINT = '提示: git 报 rejected/non-fast-forward 时先 git pull 整合远端再重推。';

/* ---------------- 工具 ---------------- */

function sh(cmd, { cwd = ROOT, timeout = TIMEOUT } = {}) {
  /** shell 执行命令（win32 兼容 .cmd），返回 { rc, out }。
   * 统一委托 _lib/proc.mjs（超时/错误分类契约；shell:true 时 win32 走 cmd.exe、
   * POSIX 走 /bin/sh，承载管道/重定向命令）。
   * out 回退 err：ENOENT/超时诊断在 r.err，空 out 时保留原因（P3 复核）。 */
  const r = procRun(cmd, [], { cwd, timeout, shell: true });
  return { rc: r.rc, out: r.out || r.err || '' };
}

/**
 * shell 参数转义：文件名等动态值拼入命令字符串前必须包裹，防止含空格/元字符
 * 的路径被 shell 拆词或注入（code_review P1）。win32 走 cmd.exe 用双引号（"→""），
 * 其余平台走 /bin/sh 用单引号（'→'\''）。
 */
function shq(s) {
  const str = String(s);
  if (process.platform === 'win32') return `"${str.replace(/"/g, '""')}"`;
  return `'${str.replace(/'/g, `'\\''`)}'`;
}

function git(args, { cwd = ROOT } = {}) {
  // core.quotepath=false：非 ASCII 文件名输出原始 UTF-8，避免引号/八进制转义破坏域匹配。
  // 数组参数直走 procRun（无 shell 拼接）：git ref 允许 $/`/;/| 等元字符，
  // 拼字符串后交给 sh() 经 shell 执行会构成命令注入（pre-push stdin 的 localRef 可被攻击者控制）。
  const r = procRun('git', ['-c', 'core.quotepath=false', ...args], { cwd });
  return { rc: r.ok ? 0 : r.rc, out: r.out || '' };
}

/* ---------------- 变更域分析 ---------------- */

const DATA_FILES = new Set([
  'resource_types.json', 'creators.json', 'workshop_sites.json', 'workshop-github.json',
]);

function classify(f) {
  /** 文件路径 → 域。返回 'go' | 'frontend' | 'data' | 'docs' | 'tests' | 'other'。 */
  if (f.endsWith('.go')) return 'go';
  if (f === 'go.mod' || f === 'go.sum') return 'go';
  if (f === 'wails.json') return 'frontend';
  if (f.startsWith('frontend/')) return 'frontend';
  if (DATA_FILES.has(f)) return 'data';
  if (f.startsWith('docs/') || f.endsWith('.md')) return 'docs';
  if (f.startsWith('tests/') || f.startsWith('scripts/')) return 'tests';
  return 'other';
}

function resolveChanges(localRef, localOid, remoteOid) {
  /**
   * 计算本次 push 的变更文件集（相对被推送的 localOid，而非当前检出 HEAD——
   * 推非当前分支时 HEAD 与推送对象不一致，用 HEAD 会分析错快照，2026-08-12 排查）。
   * remoteOid 全 0（新分支/新仓库）→ 回退最近一次提交；
   * 无祖先提交 → 首个提交的完整文件清单。
   * 返回文件数组；解析彻底失败（git diff/show 均不可用）返回 null，
   * 由调用方阻断推送而非静默空跑放行（fail-closed）。
   */
  const isNew = /^0+$/.test(remoteOid || '');
  if (!isNew && remoteOid !== localOid) {
    const { rc, out } = git(['diff', '--name-only', `${remoteOid}..${localOid}`]);
    if (rc === 0) return out.trim().split('\n').filter(Boolean); // 成功即权威答案（空 = 本次无变更）
  }
  // 新分支：优先 merge-base（有远端追踪分支时），否则 fallback 链
  // origin/<分支名> → origin/HEAD → origin/main → origin/master，最后才最近提交，
  // 避免多提交新分支只看 HEAD~1..HEAD 漏检中间提交（code_review P3）。
  // 分支名取自 stdin 的 localRef（推非当前分支时不能用 CURRENT_BRANCH）。
  // 不用 `2>/dev/null`：cmd.exe 下会解析为 dev\null 相对路径并中止整条命令（code_review P3）
  const mergeBase = (ref) => {
    const r = git(['merge-base', localOid, ref]);
    return r.rc === 0 ? r.out.trim() : '';
  };
  const branchName = localRef.startsWith('refs/heads/') ? localRef.slice('refs/heads/'.length) : null;
  let mb = (branchName && mergeBase(`origin/${branchName}`)) || mergeBase('origin/HEAD') || mergeBase('origin/main') || mergeBase('origin/master');
  if (mb) {
    const { rc, out } = git(['diff', '--name-only', `${mb}..${localOid}`]);
    if (rc === 0) return out.trim().split('\n').filter(Boolean);
  }
  const { rc, out } = git(['diff', '--name-only', `${localOid}~1..${localOid}`]);
  if (rc === 0) return out.trim().split('\n').filter(Boolean);
  // 首个提交（diff-tree 对 root commit 默认忽略，须用 git show）
  const t = git(['show', '--name-only', '--format=', localOid]);
  return t.rc === 0 && t.out.trim() ? t.out.trim().split('\n').filter(Boolean) : null;
}

function planFromFiles(files) {
  /** 文件集 → 需要跑的检查计划 { go, frontend, data, docs, adr, contractTests }。 */
  const p = { go: false, frontend: false, data: false, docs: false, adr: false, contractTests: false };
  for (const f of files) {
    const d = classify(f);
    if (d === 'go') p.go = true;
    if (d === 'frontend') p.frontend = true;
    if (d === 'data') p.data = true;
    if (d === 'docs') p.docs = true;
    if (d === 'tests') p.contractTests = true;
    if (f.startsWith('docs/adr/') || f.startsWith('docs/architecture/adr/')) p.adr = true;
  }
  // redlines 门禁：任意非纯文档/纯测试变更都触发——红线规则覆盖 go 与 frontend，
  // 纯 docs/contracts 变更无代码面无需跑（code_review F 落地：把 R1-R10/W1-W6 从运动式
  // 子代理走查升级为 pre-push 强制门禁，不再靠"出问题 → 开批走查"脉冲修复）
  p.redlines = p.go || p.frontend;
  return p;
}

/* ---------------- 检查执行 ---------------- */

function runContractTests() {
  /** tests/*.mjs 全量契约测试（宪法基石，退出码可信）。 */
  const testsDir = path.join(ROOT, 'tests');
  if (!fs.existsSync(testsDir)) return [];
  const testFiles = fs.readdirSync(testsDir)
    .filter((f) => f.endsWith('.mjs')).sort();
  const results = [];
  for (const f of testFiles) {
    const { rc, out } = sh(`node ${path.join('tests', f)}`);
    results.push({ name: f, ok: rc === 0, out: rc === 0 ? '' : out.trim().split('\n').slice(-4).join('\n') });
  }
  return results;
}

/* ---------------- gofmt 只读校验 ---------------- */

function gofmtCheck(goFiles) {
  /** gofmt -l 只读检出未格式化文件（不修改）。修复由 pre-commit 提交时自动完成；
   * 此处若仍检出，说明提交绕过了 pre-commit（--no-verify 等），阻断并提示手动修复。 */
  return sh(`gofmt -l ${goFiles.map(shq).join(' ')}`).out.trim()
    .split('\n').filter((f) => f.endsWith('.go'));
}

/* ---------------- 主流程 ---------------- */

function parseStdin() {
  try { return fs.readFileSync(0, 'utf-8').trim(); } catch { return ''; }
}

function main() {
  const dryRun = process.argv[2] === '--dry-run';
  const argBase = dryRun ? 3 : 2;
  const remoteName = process.argv[argBase];
  const remoteUrl = process.argv[argBase + 1];

  console.log('========== YSM 本地质量门禁 ==========');

  if (!remoteName) {
    console.log('用法: node scripts/pre-push-gate.mjs [--dry-run] <remote-name> <remote-url>');
    console.log('      stdin: <local ref> <local oid> <remote ref> <remote oid>');
    return 2;
  }

  const lines = parseStdin().split('\n').filter(Boolean);
  if (!lines.length) {
    console.log(`${B.SKIP} 无可推送 ref（空 stdin），跳过`);
    console.log(`${B.SKIP} ${PULL_HINT}`);
    return 0;
  }

  // 多 ref 推送（git push origin a b）逐行分析，按文件集并集计算变更域；
  // delete 行（local oid 全零）跳过。全零 localOid = 删除远端 ref，无本地文件可查。
  const fileSet = new Set();
  const pushed = [];
  for (const line of lines) {
    const [localRef, localOid, , remoteOid] = line.trim().split(/\s+/);
    if (!localOid || /^0+$/.test(localOid)) continue; // delete ref，跳过
    const refFiles = resolveChanges(localRef, localOid, remoteOid);
    if (refFiles === null) {
      console.log(`${B.FAIL} 变更集解析失败（git diff/show 均不可用），拒绝空跑放行 — 请检查本地 git 状态后重推`);
      console.log(PULL_HINT);
      return 1;
    }
    for (const f of refFiles) fileSet.add(f);
    pushed.push({ localRef, localOid, remoteOid });
  }
  if (!pushed.length) {
    console.log(`${B.SKIP} 无有效推送 ref（均为删除/空 oid），跳过`);
    return 0;
  }
  const files = [...fileSet];
  const plan = planFromFiles(files);
  const byDomain = {};
  for (const f of files) (byDomain[classify(f)] = byDomain[classify(f)] || []).push(f);

  const { localRef, localOid } = pushed[0];
  const multiRef = pushed.length > 1;
  console.log(`推送: ${multiRef ? `${pushed.length} 个 ref` : localRef} ${multiRef ? '' : `${localOid.slice(0, 7)} `}→ ${remoteName} (${remoteUrl || '?'})`);
  const domainSummary = Object.keys(byDomain).length
    ? Object.entries(byDomain).map(([d, fs2]) => `${d}:${fs2.length}`).join('  ')
    : '无变更';
  console.log(`变更域: ${domainSummary}`);
  console.log('');

  const results = [];
  let blocked = false;

  /* --- Go 域 --- */
  if (plan.go) {
    const goFiles = (byDomain.go || []).filter((f) => f.endsWith('.go'));

    const t0 = Date.now();
    const goBuild = sh('go build ./go/...');
    results.push({ label: 'go build', ok: goBuild.rc === 0, time: Date.now() - t0,
      tail: goBuild.rc ? goBuild.out.trim().split('\n').slice(-4).join('\n') : '' });
    if (goBuild.rc !== 0) blocked = true;

    const t1 = Date.now();
    const goTest = sh('go test -race ./go/... -count=1 -timeout 10m');
    results.push({ label: 'go test', ok: goTest.rc === 0, time: Date.now() - t1,
      tail: goTest.rc ? goTest.out.trim().split('\n').slice(-4).join('\n') : '' });
    if (goTest.rc !== 0) blocked = true;

    const tV = Date.now();
    const goVet = sh('go vet ./go/... ./internal/app/...');
    results.push({ label: 'go vet', ok: goVet.rc === 0, time: Date.now() - tV,
      tail: goVet.rc ? goVet.out.trim().split('\n').slice(-4).join('\n') : '' });
    if (goVet.rc !== 0) blocked = true;

    // gofmt：只读校验（修复已下沉 pre-commit；此处检出即阻断，防止绕过提交）
    const t2 = Date.now();
    const unformatted = gofmtCheck(goFiles);
    results.push({ label: 'gofmt', ok: unformatted.length === 0, time: Date.now() - t2,
      note: unformatted.length
        ? `检出 ${unformatted.length} 个未格式化文件（pre-commit 应已自动修复；疑似 --no-verify 绕过）`
        : '无未格式化文件',
      tail: unformatted.length ? unformatted.join('\n') : '' });
    // 格式类债务不阻断推送（2026-08-13 决策：与红线一致，推送后修；pre-commit 正常已自动 gofmt -w）

    const t3 = Date.now();
    const bc = sh('node scripts/binding-check.mjs --json');
    results.push({ label: 'binding-check', ok: bc.rc === 0, time: Date.now() - t3,
      tail: bc.rc ? bc.out.trim().split('\n').slice(-4).join('\n') : '' });
    if (bc.rc !== 0) blocked = true;
  }

  /* --- 前端域 --- */
  if (plan.frontend) {
    // 分层守护：前端目录间反向依赖（R1/R2 零容忍 + R3/R4 基线，现基线 0 条）
    const tL = Date.now();
    const ll = sh('node scripts/check-layering.mjs --json');
    let lz = null;
    try { lz = JSON.parse(ll.out)._summary; } catch { /* parse fail */ }
    const lOk = ll.rc === 0;
    results.push({ label: 'check-layering', ok: lOk, time: Date.now() - tL,
      note: lz === null ? '输出解析失败（scripts/check-layering.mjs 缺失？）'
        : (lOk ? `分层合规（零容忍 ${lz.zero_tolerance} / 回归 ${lz.regressions}）`
          : `零容忍 ${lz.zero_tolerance} + 新增回归 ${lz.regressions}`) });
    if (!lOk) blocked = true;

    const t0 = Date.now();
    const fb = sh('npx vite build', { cwd: path.join(ROOT, 'frontend') });
    results.push({ label: 'vite build', ok: fb.rc === 0, time: Date.now() - t0,
      tail: fb.rc ? fb.out.trim().split('\n').slice(-4).join('\n') : '' });
    if (fb.rc !== 0) blocked = true;

    // ADR-023 P3：L3 Vitest 随前端域变更回归（写了要跑、坏了要红）
    const t1 = Date.now();
    // 与 frontend/package.json test 对齐：--maxWorkers 8（24 核默认并发过载反慢 ~10s）
    const ft = sh('npx vitest run --maxWorkers 8', { cwd: path.join(ROOT, 'frontend') });
    results.push({ label: 'vitest run', ok: ft.rc === 0, time: Date.now() - t1,
      tail: ft.rc ? ft.out.trim().split('\n').slice(-4).join('\n') : '' });
    if (ft.rc !== 0) blocked = true;
  }

  /* --- 数据域 --- */
  if (plan.data) {
    const t0 = Date.now();
    const tc = sh('node scripts/type-consistency.mjs --json');
    let issues = null;
    try { issues = JSON.parse(tc.out)._summary?.issues ?? 0; } catch { /* parse fail */ }
    const ok = issues === 0;
    results.push({ label: 'type-consistency', ok, time: Date.now() - t0,
      note: issues === null ? '输出解析失败（scripts/type-consistency.mjs 缺失？）'
        : (ok ? 'resource_types.json ↔ extensions.js 一致' : `${issues} 个不一致`) });
    if (!ok) blocked = true;
  }

  /* --- 文档域 --- */
  if (plan.docs) {
    const t0 = Date.now();
    const lc = sh('node scripts/link-checker.mjs --json');
    let broken = null;
    try { broken = JSON.parse(lc.out)._summary?.links_broken ?? 0; } catch { /* parse fail */ }
    const ok = broken === 0;
    results.push({ label: 'link-checker', ok, time: Date.now() - t0,
      note: broken === null ? '输出解析失败（scripts/link-checker.mjs 缺失？）'
        : (ok ? '全部链接有效' : `${broken} 条断链`) });
    if (!ok) blocked = true;

    // 发版说明漂移守护：git tag 单一事实源——每个正式 tag 必须有 docs/releases/<tag>.md
    // （失败输出 AI 友好：--check 自带每条缺失的 git 区间补写命令）
    const t1 = Date.now();
    const rn = sh('node scripts/release-notes-gen.mjs --check');
    results.push({ label: 'release-notes', ok: rn.rc === 0, time: Date.now() - t1,
      tail: rn.rc ? rn.out.trim().split('\n').slice(-14).join('\n') : '' });
    if (rn.rc !== 0) blocked = true;
  }
  if (plan.redlines) {
    const t0 = Date.now();
    const rl = sh('node scripts/check-redlines.mjs --json --baseline');
    let newV = null, ok = false, scanHealthy = false, baseCount = 0, rlTail = '';
    try {
      const parsed = JSON.parse(rl.out);
      const s = parsed._summary;
      newV = s.newViolations ?? null;
      baseCount = s.baselineViolations ?? 0;
      ok = s.ok === true;
      // 扫描健康门（fail-closed）：rg 缺失/执行失败时 check-redlines 输出
      // scanHealthy:false——必须阻断推送，否则红线门禁静默放行（P1 修复）
      scanHealthy = s.scanHealthy === true;
      // 违规详情（供 tail 展示方向，不阻断推送）
      if (!ok && Array.isArray(parsed.results)) {
        rlTail = parsed.results
          .filter((r) => r.count > 0)
          .map((r) => `[${r.rule_id} ${r.name}] ` + r.violations.map((v) => `${v.file}:${v.line}`).join(', '))
          .join('\n');
      }
    } catch { /* parse fail */ ok = false; scanHealthy = false; }
    results.push({ label: 'check-redlines', ok, time: Date.now() - t0,
      note: !scanHealthy ? '扫描不可用（rg 缺失/执行失败）——fail-closed 阻断，红线门禁未执行'
        : (newV === null ? '输出解析失败'
          : (ok ? `红线零新增（基线 ${baseCount} 条）`
            : `${newV} 条新增红线违规（基线 ${baseCount} 条）——债务项，推送后处理`)),
      tail: rlTail });
    // 基线债务（红线新增）不阻断推送：推送后修；发布前全量 doctor 仍会报告（2026-08-13 决策）
    // 但扫描不可用（fail-closed）必须阻断——扫描本身没跑成，不能当作「债务」放行
    if (!scanHealthy) blocked = true;
  }
  if (plan.adr) {
    const t0 = Date.now();
    const ac = sh('node scripts/adr-check.mjs');
    results.push({ label: 'adr-check', ok: ac.rc === 0, time: Date.now() - t0,
      tail: ac.rc ? ac.out.trim().split('\n').slice(-4).join('\n') : '' });
    if (ac.rc !== 0) blocked = true;
  }

  /* --- 生成器守护：索引产物是否过期（docs 或 adr 变更时） --- */
  if (plan.docs || plan.adr) {
    const t0 = Date.now();
    const gd = sh('node scripts/gen-docs-index.mjs --check');
    results.push({ label: 'gen-docs-index', ok: gd.rc === 0, time: Date.now() - t0,
      tail: gd.rc ? gd.out.trim().split('\n').slice(-4).join('\n') : '' });
    if (gd.rc !== 0) blocked = true;
  }

  /* --- 契约测试 --- */
  if (plan.contractTests) {
    const t0 = Date.now();
    const tests = runContractTests();
    const ok = tests.length === 0 || tests.every((t) => t.ok);
    results.push({ label: `contract tests (${tests.length})`, ok, time: Date.now() - t0,
      note: tests.length === 0 ? '无 tests/*.mjs，跳过'
        : (ok ? '全部通过' : tests.filter((t) => !t.ok).map((t) => `${t.name}\n${t.out}`).join('\n')) });
    if (!ok) blocked = true;
  }

  /* --- 聚合摘要 --- */
  console.log('------------------- 结果 -------------------');
  for (const r of results) {
    const status = r.ok ? B.OK : B.FAIL;
    console.log(`${status} ${r.label.padEnd(20)} ${(r.time / 1000).toFixed(1)}s  ${r.note || ''}`);
    if (r.tail) {
      for (const line of r.tail.split('\n')) console.log(`       ${line}`);
    }
  }
  console.log('');
  if (!results.length) {
    console.log(`${B.SKIP} 无相关域变更（${domainSummary}），无需检查`);
    return 0;
  }
  if (!blocked) {
    console.log(`结论: PASS ✅ ${dryRun ? '（DRY-RUN）' : '放行推送'} ${results.filter((r) => r.ok).length}/${results.length} 项通过`);
    return 0;
  }
  console.log(`结论: FAIL ❌ ${results.filter((r) => r.ok).length}/${results.length} 项通过，推送已${dryRun ? '将被' : ''}阻断`);
  // 修复指引：gofmt 检出未格式化（疑似 --no-verify 绕过 pre-commit）→ 手动修复后重推
  const gofmt = results.find((r) => r.label === 'gofmt');
  let gofmtHint = '';
  if (gofmt && !gofmt.ok) {
    gofmtHint = 'gofmt 检出未格式化——gofmt -w 修复后 git add + git commit 重推。';
  }
  console.log(`修复指引: 按上方 [FAIL] 项处理；${gofmtHint}紧急绕过: git push --no-verify`);
  console.log(PULL_HINT);
  return 1;
}

const GATE_CODE = main();

// ── 文档待补地图：仅门禁 PASS 时刷新（非阻断），供文档类 AI 定位「哪块城邦失修、该补哪里」──
// 失败/用法错误时跳过：失败推送无地图消费方，且 gen-doc-next-steps 内部会重跑
// check-knowledge-drift / link-checker / adr-check 三个重型检查，会延迟失败回执（2026-08-12 排查）。
if (GATE_CODE === 0) {
  try {
    execFileSync('node', ['scripts/gen-doc-next-steps.mjs'], {
      cwd: ROOT, stdio: 'ignore', shell: true, timeout: 300_000,
    });
    console.log('[MAP] 已刷新 docs/.doc-next-steps.md（AI 待补地图，非阻断）');
  } catch {
    /* 非阻断：地图生成失败不影响推送 */
  }
}

process.exit(GATE_CODE);
