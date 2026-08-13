#!/usr/bin/env node
/**
 * 项目健康诊断。一键检查 Go 编译、前端构建、文件完整性、治理红线。
 * 由 scripts/doctor.py 迁移（2026-08-03），逻辑逐点保真。
 * doctor.mjs — 全量治理检查编排
 * 设计意图：全量治理检查编排
 * 依赖：node:child_process / node:fs / node:path / node:url
 * 用法：
 *   node scripts/doctor.mjs                 # 默认行为（全量：编译+构建+文件+红线+Git）
 *   node scripts/doctor.mjs --docs   # 文档模式（轻量：仅文档/ADR/索引检查，跳过 Go/前端编译与测试）
 *   node scripts/doctor.mjs --gate       # 门禁模式（域感知，对齐 pre-push-gate，不触发 push）
 *   node scripts/doctor.mjs --gate <ref> # 指定 ref（默认 HEAD，用于预检未提交的改动）
 *   node scripts/doctor.mjs --check  # 启用 check
 *   node scripts/doctor.mjs --strict # 启用 strict
 * 退出码：任何非零检查([FAIL])均置 process.exitCode=1 阻断；仅 WARN/skip 不阻断
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './_lib/scan-files.mjs';
import { run as procRun } from './_lib/proc.mjs';

const PASS = '[OK]';
const FAIL = '[FAIL]';
const WARN = '[WARN]';

function run(cmd, cwd = ROOT, opts = {}) {
  /**
   * 运行命令，返回 {rc, out}。统一委托 _lib/proc.mjs（超时/错误分类契约，共享收敛）。
   * shell 仅在 win32 生效（P3 复核）：doctor 的 shell:true 只服务于 .cmd shim
   * （npx/tsc 无扩展名），POSIX 下这些是原生可执行文件，直接 exec 更安全——
   * 全平台 shell 会把含空格/元字符的 ROOT 路径交给 /bin/sh -c 拆词破坏。
   * grep/go/which 原生可执行保持默认（无 shell），避免 cmd.exe 找不到 Git Bash 工具。
   */
  const r = procRun(cmd[0], cmd.slice(1), {
    cwd,
    ...opts,
    // shell:true 降级为 win32-only（POSIX 直接 exec 原生 bin）
    shell: opts.shell === true ? process.platform === 'win32' : opts.shell,
    timeout: opts.timeout ?? 120000,
  });
  // out 回退 err：ENOENT 时 proc.mjs 的 r.out 为空、诊断在 r.err——FAIL 输出必须保留
  // 「command not found: go」类原因，否则检查失败但输出空白（P3 复核）
  return { rc: r.rc, out: r.out || r.err || '' };
}

/**
 * node 原生递归收集目录下指定扩展名文件（模拟 grep -rn 的目录遍历）。
 * 注意：Windows 下 execFileSync 直调 MSYS grep/rg 时参数反斜杠会被吞，
 * 正则检查全部改走本函数 + JS 正则，避免治理红线假绿（code_review 实证）。
 */
function scanAllFiles(dir, exts) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const d of entries) {
    if (d.isDirectory()) out.push(...scanAllFiles(path.join(dir, d.name), exts));
    else if (exts.some((e) => d.name.endsWith(e))) out.push(path.join(dir, d.name));
  }
  return out;
}

/** 返回文件中匹配正则的行，格式 `绝对路径:行号:内容`（与 grep -rn 输出一致）。 */
function grepLines(files, re) {
  const hits = [];
  for (const f of files) {
    let text;
    try {
      text = fs.readFileSync(f, 'utf-8');
    } catch {
      continue;
    }
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) hits.push(`${f}:${i + 1}:${lines[i]}`);
  }
  return hits;
}

function checkGoBuild() {
  console.log('=== Go Build ===');
  const { rc, out } = run(['go', 'build', './go/...']);
  if (rc === 0) {
    console.log(`  ${PASS} Go build passed`);
  } else {
    console.log(`  ${FAIL} Go build failed`);
    process.exitCode = 1;
    for (const line of out.trim().split('\n').slice(-5)) {
      console.log(`    ${line}`);
    }
  }
}

function checkGoTest() {
  // 原 ultrawork 独有步骤，并入 doctor（ultrawork.mjs 已废弃）
  console.log('\n=== Go Test ===');
  const { rc, out } = run(['go', 'test', '-race', './go/...', './internal/app/', '-count=1', '-timeout', '10m']);
  if (rc === 0) {
    console.log(`  ${PASS} Go test passed`);
  } else {
    console.log(`  ${FAIL} Go test failed`);
    process.exitCode = 1;
    for (const line of out.trim().split('\n').slice(-5)) {
      console.log(`    ${line}`);
    }
  }
}

function buildUpdaterHelper() {
  // go/updater/updater.go 通过 //go:embed 内嵌 ysm-updater-helper.exe，
  // 该文件由 cmd/updater/main.go 编译生成（见 scripts/build-release.ps1 步骤 1b），
  // 且被 .gitignore(*.exe) 忽略、不入库。CI / 干净 checkout 缺此文件会导致
  // go vet / go build / go test 因 embed 找不到文件而失败。
  // 因此任何 Go 检查前必须先构建它（与 release.yml CI、windows Taskfile 一致）。
  console.log('=== Build Updater Helper ===');
  const { rc, out } = run(['go', 'build', '-o', 'go/updater/ysm-updater-helper.exe', './cmd/updater']);
  if (rc === 0) {
    console.log(`  ${PASS} updater helper built -> go/updater/ysm-updater-helper.exe`);
  } else {
    console.log(`  ${FAIL} updater helper build failed (go vet/build/test 将因此失败)`);
    process.exitCode = 1;
    for (const line of out.trim().split('\n').slice(-5)) console.log(`    ${line}`);
  }
}

function checkGoVet() {
  console.log('\n=== Go Vet ===');
  const { rc, out } = run(['go', 'vet', './go/...', './internal/app/...']);
  if (rc === 0) {
    console.log(`  ${PASS} go vet passed`);
  } else {
    console.log(`  ${FAIL} go vet failed`);
    process.exitCode = 1;
    for (const line of out.trim().split('\n').slice(-5)) console.log(`    ${line}`);
  }
}

function checkContractTests() {
  // 契约测试为宪法基石，禁止修改（AGENTS.md 红线）。失败即阻断。
  console.log('\n=== Contract Tests (tests/*.mjs) ===');
  const dir = path.join(ROOT, 'tests');
  if (!fs.existsSync(dir)) {
    console.log(`  ${WARN} tests/ not found — skip`);
    return;
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.mjs'));
  if (files.length === 0) {
    console.log(`  ${WARN} no .mjs contract tests`);
    return;
  }
  let failed = 0;
  for (const f of files) {
    const { rc } = run(['node', path.join('tests', f)]);
    if (rc === 0) console.log(`  ${PASS} ${f}`);
    else {
      failed += 1;
      console.log(`  ${FAIL} ${f}`);
    }
  }
  if (failed === 0) console.log(`  ${PASS} all contract tests passed`);
  else {
    console.log(`  ${FAIL} ${failed} contract test(s) failed`);
    process.exitCode = 1;
  }
}

/**
 * 前端工具探测：直接查 frontend/node_modules/.bin/{name}，不依赖 npx/PATH。
 * Git Bash 环境下 `which npx` 会失败（which 不在 Windows PATH、npx 是 .cmd shim），
 * 导致前端检查被误跳过；与 check-deadcode-baseline.mjs 的 bin() 模式对齐。
 * Windows 下带 .cmd 后缀 + shell:true 经 cmd.exe 执行。
 */
function frontendBin(name) {
  const dir = path.join(ROOT, 'frontend', 'node_modules', '.bin');
  const candidates = process.platform === 'win32'
    ? [path.join(dir, name + '.cmd'), path.join(dir, name)]
    : [path.join(dir, name)];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function checkFrontendBuild() {
  console.log('\n=== Frontend Build ===');
  const bin = frontendBin('vite');
  if (!bin) {
    console.log(`  ${WARN} vite not found in node_modules/.bin — skip frontend build`);
    console.log('        run manually: cd frontend && npx vite build');
    return;
  }
  const { rc, out } = run([bin, 'build'], path.join(ROOT, 'frontend'), { shell: true });
  if (rc === 0) {
    console.log(`  ${PASS} Frontend build passed`);
  } else {
    console.log(`  ${FAIL} Frontend build failed`);
    process.exitCode = 1;
    for (const line of out.trim().split('\n').slice(-5)) {
      console.log(`    ${line}`);
    }
  }
}

function checkFrontendTest() {
  // ADR-023 P3：L3 Vitest 前端单测并入全量自检（写了要跑、坏了要红）
  console.log('\n=== Frontend Test (Vitest) ===');
  const bin = frontendBin('vitest');
  if (!bin) {
    console.log(`  ${WARN} vitest not found in node_modules/.bin — skip vitest`);
    console.log('        run manually: cd frontend && npx vitest run');
    return;
  }
  // 与 frontend/package.json test 对齐：--maxWorkers 8 实测比默认并发快约 10s
  // （24 核机器默认 fork 过多 worker 反有调度开销）
  const { rc, out } = run([bin, 'run', '--maxWorkers', '8'], path.join(ROOT, 'frontend'), { shell: true });
  if (rc === 0) {
    console.log(`  ${PASS} vitest run passed`);
  } else {
    console.log(`  ${FAIL} vitest run failed`);
    process.exitCode = 1;
    for (const line of out.trim().split('\n').slice(-5)) {
      console.log(`    ${line}`);
    }
  }
}

function checkTypeScript() {
  console.log('\n=== TypeScript Check ===');
  // ADR-014：前端 .ts 类型检查（tsc --noEmit，见 frontend/package.json typecheck）
  const bin = frontendBin('tsc');
  if (!bin) {
    console.log(`  ${WARN} tsc not found in node_modules/.bin — skip typecheck`);
    console.log('        run manually: cd frontend && npx tsc --noEmit');
    return;
  }
  const { rc, out } = run([bin, '--noEmit'], path.join(ROOT, 'frontend'), { shell: true });
  if (rc === 0) {
    console.log(`  ${PASS} tsc --noEmit passed`);
  } else {
    // 空输出时 trim().split 得 ['']，直接 length 会假报 1 errors（code_review P2）
    const lines = out.trim().split('\n').filter(Boolean);
    console.log(`  ${FAIL} tsc --noEmit failed (${lines.length} errors)`);
    process.exitCode = 1;
    for (const line of lines.slice(-5)) {
      console.log(`    ${line}`);
    }
  }
}

function checkKeyFiles() {
  console.log('\n=== Key Files ===');
  const files = [
    'main.go', 'wails.json',
    'internal/app/app.go', 'internal/app/resource_bindings.go',
    'resource_types.json', 'go.mod', 'AGENTS.md',
    'frontend/index.html', 'frontend/src/bus.ts', 'frontend/src/app-modules.ts',
  ];
  for (const f of files) {
    const p = path.join(ROOT, f);
    const ok = fs.existsSync(p);
    console.log(`  ${ok ? PASS : FAIL} ${f}`);
    if (!ok) process.exitCode = 1;
  }
}

function checkGovernance() {
  console.log('\n=== Governance Rules ===');
  let errors = 0;

  // 规则 1: window.__* 全局变量（ERROR 硬门槛，doctor 退出码 1 阻断提交）
  // node 原生扫描（grep 直调在 Windows MSYS 下吞反斜杠，`window\.__` 变 `window.__` 假绿）
  const srcTs = scanAllFiles(path.join(ROOT, 'frontend/src'), ['.js', '.ts']);
  const r1 = grepLines(srcTs, /window\.__/).map((l) => l.replace(/:\d+:.*$/, '')); // 右剥 :行号:内容，Windows 盘符路径不受 split(':')[0] 截断（code_review P2）
  if (r1.length) {
    errors += 1;
    console.log(`  ${FAIL} [rule1] window.__ global vars:`);
    for (const f of [...new Set(r1)]) console.log(`    ${f}`);
  }

  // 规则 8 动态拼接: innerHTML 含表达式插值（非纯标识符，如 ${e.message}）必须 esc()（ERROR 硬门槛）
  // 纯标识符插值（${inner} 等受信 HTML 片段）放行；命中行含 esc( 视为已转义
  // t(...) 插值豁免：i18n 化后文案走 t()（语言包受信内容，非用户输入，XSS 面为零），
  // 与 esc() 已转义同权；若与不可信数据拼接则禁止（该场景不在 t() 插值内）
  const r8dyn = grepLines(srcTs, /innerHTML\s*=[^;]*\$\{[^}]*[^A-Za-z0-9_$}][^}]*\}/);
  if (r8dyn.length) {
    const unescaped = r8dyn.filter((l) => !/esc\(/.test(l) && !/\$\{t\(/.test(l));
    if (unescaped.length) {
      errors += 1;
      console.log(`  ${FAIL} [rule8] innerHTML 表达式插值未 esc()`);
      for (const line of unescaped) console.log(`    ${line}`);
    }
  }

  // 规则 5: 硬编码颜色（WARN 级，存量允许）
  const r5 = grepLines(scanAllFiles(path.join(ROOT, 'frontend'), ['.js', '.ts', '.css']), /#[0-9a-f]{6}\b/);
  if (r5.length) {
    console.log(`  ${WARN} [rule5] hardcoded colors (${r5.length} hits, top 10):`);
    for (const line of r5.slice(0, 10)) console.log(`    ${line}`);
  }

  // Wails 调用检查（WARN 级）。过滤注释行：`// ...`、`/* ... */`、` * ...` 里出现
  // window.go.main.App 只是文档说明（如 wails/app.ts 治理注释），非真实调用。
  const w = grepLines(srcTs, /window\.go\.main\.App/)
    .filter((l) => l && !/:\d+:\s*(?:\/\/|\/\*|\*)/.test(l))
    .join('\n');
  if (w) {
    console.log(`  ${WARN} [Wails] direct window.go calls:`);
    for (const line of w.split('\n')) console.log(`    ${line}`);
  }

  if (errors === 0) {
    console.log(`  ${PASS} all rules passed`);
  } else {
    console.log(`  ${FAIL} ${errors} ERROR rule(s) found`);
    process.exitCode = 1;
  }
}

function checkConfig() {
  console.log('\n=== Config Consistency ===');
  // node 原生计数（grep -c 直调在 Windows MSYS 下吞反斜杠，正则失效；且 rc 是退出码不是计数）
  let pluginsCount = '0（无匹配或文件缺失）';
  try {
    const toml = fs.readFileSync(path.join(ROOT, 'reasonix.toml'), 'utf-8');
    const n = (toml.match(/^\[\[plugins\]\]/gm) || []).length;
    pluginsCount = String(n);
  } catch { /* 文件缺失保持提示 */ }
  console.log(`  reasonix.toml plugins: ${pluginsCount}`);

  // wails.json name 提取（node 原生，消除 grep 依赖）
  try {
    const wailsJson = fs.readFileSync(path.join(ROOT, 'wails.json'), 'utf-8');
    const m = wailsJson.match(/"name"\s*:\s*"[^"]*"/);
    if (m) console.log(`  ${PASS} wails.json: ${m[0]}`);
    else {
      console.log(`  ${FAIL} wails.json parse failed`);
      process.exitCode = 1;
    }
  } catch {
    console.log(`  ${FAIL} wails.json parse failed`);
    process.exitCode = 1;
  }
}

function checkGit() {
  console.log('\n=== Git Status ===');
  const { out } = run(['git', 'status', '--short']);
  if (out.trim()) console.log(out);
  else console.log(`  ${PASS} clean`);
}

// 全量静态检查列表（保持原 12 项顺序，向后兼容既有输出 / CI）
const STATIC_TOOLS = [
  'check-doc-drift.mjs',
  'check-adr-health.mjs',
  'check-boolean-naming.mjs',
  'check-circular.mjs',
  'check-circular-go.mjs',
  'check-orphan-exports.mjs',
  'check-deadcode-baseline.mjs',
  // 前端分层依赖方向守护（views → features → services → utils → core，零容忍 + 基线）
  'check-layering.mjs',
  // 前端 JS id 引用 ↔ 模板定义交叉核对（幽灵 id 断链检测，防事件绑定静默失效）
  'check-tpl-refs.mjs',
  // 动态 import() 合理性审查（对照 app_modules 规范：失败处理/轻量工具/.js 后缀）
  'check-dynamic-import.mjs',
  // auto-import 默认只提示（rc=0），加 --strict 让缺失 import 成为真检查项
  { tool: 'auto-import.mjs', args: ['--strict'] },
  // 生成器守护：adr 登记表/规范索引 + releases 索引 + knowledge 委托校验，防生成产物静默过期
  { tool: 'gen-docs-index.mjs', args: ['--check'] },
  // 项目结构地图：目录结构 vs 磁盘扫描（AGENTS.md §4.1 指针指向 docs/project-map.md）
  { tool: 'gen-project-map.mjs', args: ['--check'] },
  // 小说总索引：docs/novel/ 目录树 vs docs/novel/index.md，防新增章节漏入索引
  { tool: 'build-novel-index.mjs', args: ['--check'] },
  // 脚本卫生：退出码失效 / 共享层内联 / --json 契约（WARN 不阻断，默认 rc=0）
  'check-script-hygiene.mjs',
  // 工作流引用完整性：.github/workflows/*.yml 的 run: 路径引用必须存在（防迁移类死引用）
  'check-workflow-refs.mjs',
  // i18n key 契约：parity/占位符/漏译/语言清单漂移（warning 模式，缺口不阻断；--strict 留给 CI）
  'i18n-check.mjs',
  // i18n UI 漂移：组件源码硬写中文且零 t() 调用（治本，堵"动态菜单漏译"盲区；
  // warning 模式恒 0，缺口不阻断；--strict 留给 CI 强阻断）
  'i18n-ui-check.mjs',
  // Go 绑定契约对账：Go 导出函数 vs frontend/bindings -ts 产物（缺失/多余/arity 不一致 → 阻断）
  'binding-check.mjs',
];

// —— 静态检查工具分组（从 STATIC_TOOLS 派生，避免清单漂移）——
// 文档相关（--docs 模式运行，轻量、不碰 Go/前端编译）：
// 文档漂移 / ADR 登记健康 / 索引生成器守卫 / 知识卡 / 脚本卫生
const DOC_RELEVANT = new Set([
  'check-doc-drift.mjs',
  'check-adr-health.mjs',
  'gen-docs-index.mjs',
  'gen-project-map.mjs',
  'build-novel-index.mjs',
  'check-script-hygiene.mjs',
  'check-workflow-refs.mjs',
]);
const toolName = (entry) => (typeof entry === 'string' ? entry : entry.tool);
const DOC_STATIC_TOOLS = STATIC_TOOLS.filter((e) => DOC_RELEVANT.has(toolName(e)));
const CODE_STATIC_TOOLS = STATIC_TOOLS.filter((e) => !DOC_RELEVANT.has(toolName(e)));

function runStaticTools(tools, label) {
  console.log(`\n=== Static Analysis: ${label} (${tools.length} tools) ===`);
  let failed = 0;
  for (const entry of tools) {
    const tool = typeof entry === 'string' ? entry : entry.tool;
    const extraArgs = typeof entry === 'string' ? [] : entry.args || [];
    const { rc, out } = run(['node', path.join('scripts', tool), '--json', ...extraArgs]);
    // P2-2（子代理审核）：i18n-check 告警可见化——此前 runStaticTools 只取 rc 不打印
    // stdout，而 i18n-check --json 抑制人类日志、非 strict 恒 0，key 缺失/占位符漂移/
    // 漏译在 doctor 入口全部无声；解析其 JSON 把非空告警渲染为 WARN 行（不阻断）
    if (tool === 'i18n-check') {
      try {
        const j = JSON.parse(out);
        const warns = [];
        // keyParity.length 按语言计数恒为 REFERENCE_LANGS 数（与问题无关），
        // 须用 totalMissing（实际缺失 key 数）判据（code_review P3）
        if (j.totalMissing > 0) warns.push(`key 缺失 ${j.totalMissing} 条`);
        if (j.placeholderMismatches && j.placeholderMismatches.length) warns.push(`占位符不一致 ${j.placeholderMismatches.length} 条`);
        if (j.untranslated && j.untranslated.length) warns.push(`zh-CN 疑似漏译 ${j.untranslated.length} 条`);
        const drift = j.langListDrift;
        if (drift && ((drift.inAvailNotFile && drift.inAvailNotFile.length) || (drift.inFileNotAvail && drift.inFileNotAvail.length))) {
          warns.push(`语言清单漂移 ${drift.inAvailNotFile?.length ?? 0}/${drift.inFileNotAvail?.length ?? 0}`);
        }
        if (warns.length) {
          console.log(`  ${WARN} ${tool}: ${warns.join('；')}（详情: node scripts/${tool} --json）`);
        }
      } catch {
        // JSON 解析失败：保持原有 rc 判定，不额外输出
      }
    } else if (tool === 'i18n-ui-check') {
      // 同 i18n-check：默认 warning 恒 0，漂移在 doctor 入口无声；解析 JSON 渲染为 WARN 行（不阻断）
      try {
        const j = JSON.parse(out);
        if (j.drift > 0) {
          console.log(`  ${WARN} ${tool}: UI 硬编码中文漂移 ${j.drift} 处 / ${j.files} 文件（详情: node scripts/${tool} --json）`);
        }
      } catch {
        // JSON 解析失败：保持原有 rc 判定，不额外输出
      }
    }
    if (rc === 0) console.log(`  ${PASS} ${tool}`);
    else {
      failed += 1;
      console.log(`  ${FAIL} ${tool}`);
    }
  }
  if (failed === 0) console.log(`  ${PASS} all static checks passed`);
  else {
    console.log(`  ${FAIL} ${failed} tool(s) failed`);
    process.exitCode = 1;
  }
}

function checkStaticAnalysis() {
  runStaticTools(STATIC_TOOLS, 'full');
}

// —— 文档模式专属检查 ——
// 断链 + 知识卡漂移 + ADR 登记一致性（撞号/漏登/幽灵/跳号）。
// 注意：check-doc-drift / check-adr-health 已并入 DOC_STATIC_TOOLS，此处不重复运行。
// link-checker 必须带 --strict：其 --json 模式默认恒 exit 0（仅 strict 才按断链非零退出，
// 避免断链时 doctor 误判 passed——code_review P2）。
const DOC_EXTRA_SCRIPTS = [
  { tool: 'link-checker.mjs', args: ['--strict'] },
  'check-knowledge-drift.mjs',
  'adr-check.mjs',
];

function checkDocExtra() {
  console.log('\n=== Doc Checks (links / drift / ADR registry) ===');
  let failed = 0;
  for (const s of DOC_EXTRA_SCRIPTS) {
    const tool = typeof s === 'string' ? s : s.tool;
    const extra = typeof s === 'string' ? [] : s.args || [];
    const { rc } = run(['node', path.join('scripts', tool), '--json', ...extra]);
    if (rc === 0) console.log(`  ${PASS} ${tool}`);
    else {
      failed += 1;
      console.log(`  ${FAIL} ${tool}`);
    }
  }
  if (failed === 0) console.log(`  ${PASS} all doc checks passed`);
  else {
    console.log(`  ${FAIL} ${failed} doc check(s) failed`);
    process.exitCode = 1;
  }
}

const DOCS_MODE = process.argv.includes('--docs');
const GATE_MODE = process.argv.includes('--gate');

if (GATE_MODE) {
  // --gate 模式：域感知门禁，对齐 pre-push-gate（不触发 push）
  // 用法：node scripts/doctor.mjs --gate [ref]
  //   ref 默认 HEAD（预检未提交改动）；也可传具体 commit oid。
  //   与 pre-push-gate 共享同一套域分类 + 检查链，不做 gofmt amend（只读校验）。
  const GATE_SKIP = process.env.YSM_SKIP_GATE;
  if (GATE_SKIP === '1') {
    console.log('[--gate] YSM_SKIP_GATE=1, 跳过');
    process.exit(0);
  }

  const DATA_FILES = new Set([
    'resource_types.json', 'creators.json', 'workshop_sites.json', 'workshop-github.json',
  ]);
  function classify(f) {
    if (f.endsWith('.go')) return 'go';
    if (f === 'go.mod' || f === 'go.sum') return 'go';
    if (f === 'wails.json') return 'frontend';
    if (f.startsWith('frontend/')) return 'frontend';
    if (DATA_FILES.has(f)) return 'data';
    if (f.startsWith('docs/') || f.endsWith('.md')) return 'docs';
    if (f.startsWith('tests/') || f.startsWith('scripts/')) return 'tests';
    return 'other';
  }

  // 解析 ref → oid，再算变更集
  const refArgIdx = process.argv.indexOf('--gate') + 1;
  const refArg = process.argv[refArgIdx];
  const baseRef = refArg || 'HEAD';
  const { rc, out: oidOut } = run(['git', 'rev-parse', '--verify', baseRef]);
  if (rc !== 0) {
    console.log(`[--gate] 无法解析 ref "${baseRef}"，退化为全量`);
    console.log('========== YSM Doctor (gate fallback: bad ref) ==========');
    buildUpdaterHelper();
    checkGoBuild();
    checkGoVet();
    checkGoTest();
    checkContractTests();
    checkFrontendBuild();
    checkFrontendTest();
    checkTypeScript();
    checkKeyFiles();
    checkGovernance();
    checkConfig();
    checkStaticAnalysis();
    checkGit();
    console.log('\n========== Done ==========');
    process.exit(process.exitCode ?? 0);
  }
  const localOid = oidOut.trim();

  // 找远端基准：origin/<branch> / origin/HEAD / origin/main / origin/master
  const { rc: rcBranch, out: branchOut } = run(['git', 'branch', '--show-current']);
  const branch = rcBranch === 0 && branchOut.trim() ? branchOut.trim() : null;
  const candidates = branch ? [`origin/${branch}`, 'origin/HEAD', 'origin/main', 'origin/master'] : ['origin/HEAD', 'origin/main', 'origin/master'];
  let mergeBase = null;
  for (const c of candidates) {
    const { rc: rcMb, out: outMb } = run(['git', 'merge-base', localOid, c]);
    if (rcMb === 0 && outMb.trim()) { mergeBase = outMb.trim(); break; }
  }
  // 无基准（新分支/新仓库）→ 取上一个 commit 作为 diff 起点
  const diffBase = mergeBase || `${localOid}~1`;
  const { rc: rcDiff, out: diffOut } = run(['git', 'diff', '--name-only', `${diffBase}..${localOid}`]);
  const files = rcDiff === 0 ? diffOut.trim().split('\n').filter(Boolean) : [];
  const plan = { go: false, frontend: false, data: false, docs: false, adr: false, contractTests: false, redlines: false };
  for (const f of files) {
    const d = classify(f);
    if (d === 'go') plan.go = true;
    if (d === 'frontend') { plan.frontend = true; plan.redlines = true; }
    if (d === 'data') plan.data = true;
    if (d === 'docs') { plan.docs = true; plan.adr = true; }
    if (d === 'tests') plan.contractTests = true;
    if (f.startsWith('docs/adr/') || f.startsWith('docs/architecture/adr/')) plan.adr = true;
  }
  // Go 变更也触发红线（红线覆盖 go 与 frontend）
  if (plan.go) plan.redlines = true;

  const domainSummary = Object.entries(plan)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .join(', ') || '无变更';
  console.log(`========== YSM Doctor (--gate mode) ==========`);
  console.log(`ref: ${baseRef} (oid ${localOid.slice(0, 7)})  diffBase: ${mergeBase ? mergeBase.slice(0, 7) : 'root'}  files: ${files.length}`);
  console.log(`变更域: ${domainSummary}`);
  console.log('');

  let blocked = false;
  const results = [];
  function record(label, ok, note) {
    results.push({ label, ok, note });
    if (!ok) blocked = true;
  }

  // --- Go 域 ---
  if (plan.go) {
    const t0 = Date.now();
    const gb = run(['go', 'build', './go/...']);
    record('go build', gb.rc === 0, gb.rc ? gb.out.trim().split('\n').slice(-3).join(' | ') : '');
    const t1 = Date.now();
    const gt = run(['go', 'test', '-race', './go/...', './internal/app/', '-count=1', '-timeout', '10m']);
    record('go test', gt.rc === 0, gt.rc ? gt.out.trim().split('\n').slice(-3).join(' | ') : `${(t1 - t0) / 1000}s`);
    const tV = Date.now();
    const gv = run(['go', 'vet', './go/...', './internal/app/...']);
    record('go vet', gv.rc === 0, gv.rc ? gv.out.trim().split('\n').slice(-3).join(' | ') : `${(Date.now() - tV) / 1000}s`);
    const t2 = Date.now();
    const bc = run(['node', path.join('scripts', 'binding-check.mjs'), '--json']);
    record('binding-check', bc.rc === 0, bc.rc ? bc.out.trim().split('\n').slice(-2).join(' | ') : '');
  }

  // --- 前端域 ---
  if (plan.frontend) {
    const tL = Date.now();
    const ll = run(['node', path.join('scripts', 'check-layering.mjs'), '--json']);
    let lz = null;
    try { lz = JSON.parse(ll.out || '{}')._summary; } catch { /* ignore */ }
    const lOk = ll.rc === 0;
    record('check-layering', lOk, lz ? `零容忍 ${lz.zero_tolerance} / 回归 ${lz.regressions}` : '');
    const t0 = Date.now();
    // 对齐 pre-push-gate：用 npx + shell:true（Windows .cmd shim 需 cmd.exe）
    const fb = run(['npx', 'vite', 'build'], path.join(ROOT, 'frontend'), { shell: true });
    record('vite build', fb.rc === 0, fb.rc ? fb.out.trim().split('\n').slice(-3).join(' | ') : `${(Date.now() - t0) / 1000}s`);
    const t1 = Date.now();
    // 对齐 pre-push-gate：统一用 npx + shell:true（Windows 下 .cmd shim 需 cmd.exe 承载）
    const ft = run(['npx', 'vitest', 'run', '--maxWorkers', '8'], path.join(ROOT, 'frontend'), { shell: true });
    record('vitest run', ft.rc === 0, ft.rc ? ft.out.trim().split('\n').slice(-3).join(' | ') : `${(Date.now() - t1) / 1000}s`);
  }

  // --- 数据域 ---
  if (plan.data) {
    const t0 = Date.now();
    const tc = run(['node', path.join('scripts', 'type-consistency.mjs'), '--json']);
    let issues = null;
    try { issues = JSON.parse(tc.out || '{}')._summary?.issues ?? 0; } catch { /* ignore */ }
    const ok = issues === 0;
    record('type-consistency', ok, ok ? '一致' : `${issues} 个不一致`);
  }

  // --- 文档域 ---
  if (plan.docs) {
    const t0 = Date.now();
    const lc = run(['node', path.join('scripts', 'link-checker.mjs'), '--json']);
    let broken = null;
    try { broken = JSON.parse(lc.out || '{}')._summary?.links_broken ?? 0; } catch { /* ignore */ }
    record('link-checker', broken === 0, broken === null ? '' : `${broken} 条断链`);
    const t1 = Date.now();
    const rn = run(['node', path.join('scripts', 'release-notes-gen.mjs'), '--check']);
    record('release-notes', rn.rc === 0, rn.rc ? rn.out.trim().split('\n').slice(-3).join(' | ') : '');
    const t2 = Date.now();
    const gd = run(['node', path.join('scripts', 'gen-docs-index.mjs'), '--check']);
    record('gen-docs-index', gd.rc === 0, gd.rc ? gd.out.trim().split('\n').slice(-2).join(' | ') : '');
  }

  // --- 红线 ---
  if (plan.redlines) {
    const t0 = Date.now();
    const rl = run(['node', path.join('scripts', 'check-redlines.mjs'), '--json', '--baseline']);
    let newV = null, ok = false, baseCount = 0;
    try {
      const parsed = JSON.parse(rl.out || '{}');
      const s = parsed._summary;
      newV = s.newViolations ?? null;
      baseCount = s.baselineViolations ?? 0;
      ok = s.ok === true;
    } catch { ok = false; }
    record('check-redlines', ok, newV === null ? '' : `${newV} 条新增（基线 ${baseCount} 条）`);
  }

  // --- ADR ---
  if (plan.adr) {
    const t0 = Date.now();
    const ac = run(['node', path.join('scripts', 'adr-check.mjs')]);
    record('adr-check', ac.rc === 0, ac.rc ? ac.out.trim().split('\n').slice(-3).join(' | ') : '');
  }

  // --- 契约测试 ---
  if (plan.contractTests) {
    const t0 = Date.now();
    const testsDir = path.join(ROOT, 'tests');
    if (fs.existsSync(testsDir)) {
      const testFiles = fs.readdirSync(testsDir).filter((f) => f.endsWith('.mjs')).sort();
      let failed = 0;
      for (const f of testFiles) {
        const r = run(['node', path.join('tests', f)]);
        if (r.rc !== 0) failed++;
      }
      record(`contract-tests (${testFiles.length})`, failed === 0, failed ? `${failed} 失败` : '全部通过');
    } else {
      record('contract-tests', true, '无 tests/ 目录，跳过');
    }
  }

  // --- 聚合摘要 ---
  console.log('------------------- 结果 -------------------');
  for (const r of results) {
    const status = r.ok ? PASS : FAIL;
    console.log(`${status} ${r.label.padEnd(20)} ${r.note || ''}`);
  }
  console.log('');
  if (!results.length) {
    console.log(`${WARN} 无相关域变更（${domainSummary}），无需检查`);
    process.exit(0);
  }
  if (!blocked) {
    console.log(`结论: PASS ✅ ${results.filter((r) => r.ok).length}/${results.length} 项通过`);
    process.exit(0);
  }
  console.log(`结论: FAIL ❌ ${results.filter((r) => r.ok).length}/${results.length} 项通过`);
  process.exit(1);
} else if (DOCS_MODE) {
  // —— 文档模式：轻量，跳过一切 Go / 前端编译与测试 ——
  console.log('========== YSM Doctor (docs mode) ==========');
  console.log('跳过：Updater Helper / Go Build / Go Vet / Go Test / Contract Tests');
  console.log('跳过：Frontend Build / Frontend Test (Vitest) / TypeScript Check');
  console.log('跳过：Key Files / Governance / Config Consistency');
  checkDocExtra();
  runStaticTools(DOC_STATIC_TOOLS, 'docs');
  checkGit();
  console.log('\n========== Done (docs mode) ==========');
} else {
  // —— 全量模式：编译 + 构建 + 文件 + 红线 + Git ——
  console.log('========== YSM Doctor ==========');
  buildUpdaterHelper();
  checkGoBuild();
  checkGoVet();
  checkGoTest();
  checkContractTests();
  checkFrontendBuild();
  checkFrontendTest();
  checkTypeScript();
  checkKeyFiles();
  checkGovernance();
  checkConfig();
  checkStaticAnalysis();
  checkGit();
  console.log('\n========== Done ==========');
}
