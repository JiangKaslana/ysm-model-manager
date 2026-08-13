#!/usr/bin/env node
/**
 * 代码红线审查。12 条规则 × 违规扫描（依赖 ripgrep）。
 * W3 empty JSDoc / W4 TODO 无编号已移交 comment-checker.mjs（避免双重扫描）。
 * 由 scripts/review.py 迁移（2026-08-03），规则与输出逻辑逐点保真。
 * 设计意图：治理审查工具（原 review.mjs，2026-08-05 更名去误导）
 * 用法：
 *   node scripts/check-redlines.mjs                 # 默认行为
 *   node scripts/check-redlines.mjs --json # JSON 输出（CI/子代理消费）
 * 退出码：0（成功）
 * 依赖：本地模块
 */
import { rg as rgStrict } from './_lib/ripgrep.mjs';
import { parseRgLine } from './_lib/rg-line.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './_lib/scan-files.mjs';

// rg 健康标志 + 本地包装：rgStrict 抛错（rg 缺失/坏正则/执行失败）时置 false 并返回 []，
// 保留「规则扫描不中断」，但 runBaseline 比对前会检查该标志——
// 扫描不可用即 fail-closed 拒绝放行，避免 rgSafe 失败返回 [] 使 --baseline newV=[] 退 0 假绿。
let rgHealthy = true;
function rg(pattern, paths, globs) {
  try { return rgStrict(pattern, paths, globs); }
  catch (e) { rgHealthy = false; console.error('[warn] ' + e.message); return []; }
}

/**
 * 基线比对模式：当前 1073 条违规是历史累积债务，强阻断会立刻卡死推送。
 * 与 check-deadcode-baseline 同构——建基线记录当前违规集，只阻断「新增」违规。
 * 键格式："file:line:ruleId"，跨平台路径统一 toPosix 归一化。
 */
const BASELINE_FILE = path.join(ROOT, 'scripts', 'baseline', 'redlines-baseline.json');

/**
 * 债务型规则（2026-08-12 治理，ADR-055 演进）：基线存量 >50 条且属命名/样式规范，
 * 新增仅 WARN 不阻断推送——存量累积导致行号/内容比对噪声高，阻断价值低。
 * 安全/缺陷类真红线（R1 window.__ / R8 innerHTML XSS / R10 esc 单点 / W7 缓存失效
 * / W6 bypass dialogs / R6 JS in public / R3 .file API / W2 window.go）保持阻断。
 */
const WARN_RULES = new Set(['R2', 'R5', 'R7', 'R4', 'W1']);

function runChecks() {
  const results = [];

  // 清洗 snippet 中的 C0/C1 控制字符（含 NUL、NEL、U+2028/U+2029 行分隔符等）。
  // 跨平台 rg 版本（如 CI 的 14.1.0 vs 本地 15.1.0）对二进制/生成文件的匹配行为不同，
  // 可能把含控制字符的行带进 snippet；这些字符会让 JSON.stringify 产出非法 JSON（被
  // JSON.parse 以 "Unterminated string" 拒绝），导致 CI 契约测试假红。此处源头归一。
  const CTRL_RE = new RegExp('[\\u0000-\\u001F\\u007F-\\u009F]', 'g');
  const cleanSnippet = (s) => String(s).replace(CTRL_RE, '').trim().slice(0, 120);
  const add = (ruleId, name, lines, fix = '') => {
    const violations = [];
    for (const l of lines) {
      const [file, lineno, text] = parseRgLine(l);
      // 基线文件自引用排除（2026-08-12）：R2 等扫 '.' 的规则会命中
      // scripts/baseline/redlines-baseline.json 自身（内容含违规键文本），
      // 基线格式变更时键错位产生大量假新增。基线文件不是代码，不应成为违规源。
      if (String(file).includes('scripts/baseline/')) continue;
      violations.push({ file: String(file), line: lineno, snippet: cleanSnippet(text) });
    }
    results.push({ rule_id: ruleId, name, fix, count: violations.length, violations });
  };

  add('R1', 'window.__ vars',
    rg('window\\.__', 'frontend/src', ['*.js', '*.ts']),
    'let + getter, PageStore');

  // R2 repoRoot 命名：测试文件豁免、Wails bindings 自动生成文件豁免
  add('R2', 'repoRoot name',
    rg('repoRoot', ['.', 'frontend/src'], ['*.go', '*.js', '*.ts', '*.json'])
      .filter((l) => { const [f] = parseRgLine(l); return !f.includes('.test.'); })
      .filter((l) => { const [f] = parseRgLine(l); return !f.includes('_test.go'); })
      .filter((l) => { const [f] = parseRgLine(l); return !f.includes('bindings/'); }),
    'cfg.FilesRoot / filesRoot');

  add('R3', 'callback .file() API',
    rg('\\.file\\s*\\(', 'frontend/src', ['*.js', '*.ts']),
    'new Promise(...)');

  // R4 display none/block：CSS 文件豁免、模板 CSS 文件（tpl.ts/content-css.ts）豁免；
  // 行注释豁免
  add('R4', 'display none/block',
    rg('display:\\s*(none|block)', 'frontend', ['*.js', '*.ts', '*.css'])
      .filter((l) => { const [f] = parseRgLine(l); return !f.endsWith('.css'); })
      .filter((l) => { const [f] = parseRgLine(l); return !f.endsWith('.tpl.ts') && !f.includes('content-css') && !f.includes('app-tree-styles'); })
      .filter((l) => !/:\d+:\s*\/\//.test(l)),
    'opacity/transform');

  // R5 硬编码颜色：variables.css 豁免、测试文件豁免、CSS-in-JS 模板文件豁免；
  // 这些文件中的颜色值是样式定义的固有部分
  add('R5', 'hardcoded colors',
    rg('#[0-9a-f]{6}\\b', 'frontend', ['*.js', '*.ts', '*.css'])
      .concat(rg('#[0-9a-f]{3}\\b', 'frontend', ['*.js', '*.ts', '*.css']))
      .concat(rg('rgba?\\(', 'frontend', ['*.js', '*.ts', '*.css']))
      .concat(rg('hsla?\\(', 'frontend', ['*.js', '*.ts', '*.css']))
      .filter((l) => { const [f] = parseRgLine(l); return !f.includes('variables.css'); })
      .filter((l) => { const [f] = parseRgLine(l); return !f.includes('.test.'); })
      .filter((l) => { const [f] = parseRgLine(l); return !f.endsWith('.tpl.ts') && !f.includes('content-css') && !f.includes('app-tree-styles'); }),
    'CSS vars');

  add('R6', 'JS in public/',
    rg('public/.*\\.js', ['.', 'frontend'], ['*.md', '*.html', '*.json'])
      .filter((l) => !l.includes('public/wasm/')), // WASM 胶水 JS 必须放 public/ 才能被 import，非手写业务 JS（2026-08-13 豁免）
    'ESM import');

  // R7 资源类型魔法字符串：测试代码中的字面量豁免（合理的 mock/fixture）；
  // 常量定义文件 types.ts 豁免（这是常量的声明位置）；
  // 注释中的字符串豁免（如 rename.ts 中描述扩展名提取逻辑）。
  add('R7', 'rtype magic strings',
    rg('"ysm"|"mmd-skin"|"vrchat-avatar"', 'frontend/src', ['*.js', '*.ts'])
      .filter((l) => { const [f] = parseRgLine(l); return !f.includes('.test.'); })
      .filter((l) => { const [f] = parseRgLine(l); return !f.includes('utils/resource/types'); })
      .filter((l) => !/:\d+:\s*(?:\/\/|\/\*|\*)/.test(l)),
    'RESOURCE_TYPES');

  // R8 innerHTML XSS 风险：
  // 豁免：纯字面量赋值（regex 已排除）、含 esc()/escUtil() 转义、空字符串、ICONS 常量、
  // shadowRoot 隔离（含非空断言 shadowRoot!）、测试文件、已知 HTML 构造函数
  // （*HTML/*html 结尾的函数调用，项目约定的安全 HTML 生成器）
  const r8Inner = rg('innerHTML\\s*=\\s+[^\'"`\\n]', 'frontend/src', ['*.js', '*.ts']).filter(
    (l) => {
      const [f] = parseRgLine(l);
      if (f.includes('.test.')) return false;
      if (/esc(Util)?\(/.test(l)) return false;
      if (/innerHTML\s*=\s*""/.test(l)) return false;
      if (/innerHTML\s*=\s*''/.test(l)) return false;
      if (/innerHTML\s*=\s*ICONS\./.test(l)) return false;
      if (/shadowRoot!?\./.test(l)) return false;
      // HTML 构造函数：函数名以 HTML/html 结尾的调用（项目约定的安全 HTML 生成器）
      if (/[A-Za-z]+HTML\s*\(/.test(l)) return false;
      if (/[A-Za-z]+html\s*\(/.test(l)) return false;
      // i18n-only 模板字面量：所有 ${...} 插值均为 t() 翻译调用
      if (/t\("/.test(l)) {
        const blocks = l.match(/\$\{[^}]+\}/g);
        if (blocks && blocks.every((b) => /t\(/.test(b))) return false;
      }
      return true;
    },
  );
  add('R8', 'innerHTML concat (non-literal)',
    r8Inner,
    'esc()');

  add('R9', 'manual sidebar',
    rg('sidebarItem|tb-btn.*title=', 'frontend', ['*.js', '*.ts']),
    'renderSidebar()');

  add('R10', 'private esc implementations',
    rg('replace\\(/&/g, "&amp;"\\)', 'frontend/src', ['*.ts', '*.js']).filter((l) => !l.includes('utils/dom/html.ts')),
    'import { esc } from utils/dom/html.ts (5-replace 单点，致命陷阱 #15)');

  // W1 排除正则/转义误报：[/\] 字符类、replace(/\\/g 归一化、\n \t \. \w \d \s \b 等
  // 额外豁免：i18n 语言包（locales/）、测试文件、正则字面量内的反斜杠、文件名非法字符正则
  add('W1', 'backslash paths',
    rg('\\\\', 'frontend/src', ['*.js', '*.ts']).filter(
      (l) =>
        !l.includes('node_modules') &&
        !l.includes('bus.js') &&
        !l.includes('bus.ts') &&
        !l.includes('font-display') &&
        !/\[?\/\\\\|\\[ntr]|\\[.wWdDsSb]/.test(l) &&
        !l.includes('locales/') &&
        /\/[^/]*\\\\[^/]*\/[^/]*\//.test(l) &&
        !/INVALID_NAME_CHARS|ILLEGAL_CHARS/.test(l),  // filename validation regex
    ).filter(
      (l) => { const [f] = parseRgLine(l); return !f.includes('.test.'); },
    ),
    '/ instead of \\');

  add('W2', 'window.go.main.App calls',
    rg('window\\.go\\.main\\.App', 'frontend/src', ['*.js', '*.ts']).filter(
      (l) => !/:\d+:\s*(?:\/\/|\/\*|\*)/.test(l), // 过滤注释行（//、/* 块注释、* 续行；wails/app.ts 治理注释等）
    ),
    'getApp()');

  // W3 empty JSDoc / W4 TODO no ticket 已移交 comment-checker.mjs（扫描范围更全，
  // W4 覆盖 go+frontend，避免双重扫描），此处不再重复。

  add('W5', 'async DOM race (callback sets innerHTML without stale guard)',
    rg('=>\\s*\\{[^}]*innerHTML\\s*=', 'frontend/src', ['*.js', '*.ts'])
      .concat(rg('\\.(then|finally)\\s*\\(.*innerHTML\\s*=', 'frontend/src', ['*.js', '*.ts']))
      .concat(rg('setTimeout\\s*\\(.*innerHTML\\s*=', 'frontend/src', ['*.js', '*.ts'])),
    'DOM writes in async callbacks need stale-request guards (fetchDone flag)');

  add('W6', 'bypass dialogs (dlg-overlay outside dialogs/modal.ts)',
    rg('className\\s*=\\s*"dlg-overlay"', 'frontend/src', ['*.ts', '*.js']).filter((l) => !l.includes('dialogs/modal.ts')),
    '统一走 modal.ts (modalConfirm/registerDlg 单例槽位，致命陷阱 #14)；合法旁路须确认 registerDlg 已登记');

  // W7 绑定层写操作须配缓存失效（scanner.InvalidateCache/InvalidatePath）：
  // 扫描 internal/app 中「删除/改名/移动」写调用点作为人工确认锚点——每个调用点所在
  // 函数必须已配缓存失效，否则 30s 陈旧缓存会让已删文件"复活"（2026-08-12 审计补丁）。
  // 排除：*_test.go（测试夹具）、defer 临时清理、os.MkdirAll（创建场景缓存本无旧条目）。
  // 注意：候选清单含已配失效的调用点（如 DeleteResourcePack），需人工核对函数体；
  // 基线记录当前全部调用点，新增写操作调用点将被 pre-push 阻断。
  add('W7', 'binding-layer write ops (need cache invalidation)',
    rg('os\\.(Remove|RemoveAll|Rename)\\s*\\(', 'internal/app', ['*.go', '!*_test.go'])
      .filter((l) => !/defer\s+os\./.test(l))
      .concat(rg('fileops\\.(RenameDir|RenameFile|RemoveDir|DeleteModelFile|WriteModelFolder)\\s*\\(', 'internal/app', ['*.go', '!*_test.go']))
      .concat(rg('recycle\\.(MoveEx|Restore|Delete|Empty)\\s*\\(', 'internal/app', ['*.go', '!*_test.go'])),
    '确认所在函数已配 scanner.InvalidateCache/InvalidatePath（防 30s 陈旧缓存"复活"）');

  return results;
}

function outputText(results) {
  const out = ['========== Check Redlines =========='];
  out.push('⚠️ 正则红线扫描候选清单，非审核结论——violations 需逐条人工确认，勿直接采信');
  for (const r of results) {
    if (r.count === 0) {
      out.push(`  [OK] [${r.rule_id}] ${r.name}`);
    } else {
      out.push(`  [WARN] [${r.rule_id}] ${r.name} (${r.count})`);
      for (const v of r.violations.slice(0, 10)) {
        out.push(`    ${v.file}:${v.line}  ${v.snippet.slice(0, 80)}`);
      }
      if (r.fix) out.push(`    -> ${r.fix}`);
    }
  }
  out.push(`${'='.repeat(10)} Check Complete ${'='.repeat(10)}`);
  process.stdout.write(out.join('\n') + '\n');
}

function outputJson(results, summary = null) {
  process.stdout.write(JSON.stringify({
    _summary: summary ?? {
      rules: results.length,
      violations: results.reduce((s, r) => s + r.count, 0),
      notice: '正则红线扫描候选清单，非审核结论——violations 需逐条人工确认，勿直接采信',
    },
    results,
  }, null, 2) + '\n');
}

function collectViolationKeys(results) {
  const blocking = [];
  const advisory = [];
  for (const r of results) {
    for (const v of r.violations) {
      // toPosix 归一化跨平台路径（Windows 反斜杠 → 正斜杠）
      const f = String(v.file).replace(/\\/g, '/');
      // 行号不敏感比对（2026-08-12 治理）：键用「文件 + 规则 + 行内容」而非 file:line——
      // 加首行注释/格式化等行号漂移不再产生假新增（曾因 58 个测试文件加
      // // @vitest-environment node 触发 91 条存量违规"假新增"阻断推送）；
      // 只有行内容真正变化或出现新行才算新增。行号仍保留在 violations 中供定位。
      const content = (v.snippet || '').trim();
      const key = `${f}:${r.rule_id}:${content}`;
      (WARN_RULES.has(r.rule_id) ? advisory : blocking).push(key);
    }
  }
  return {
    blocking: [...new Set(blocking)].sort(),
    advisory: [...new Set(advisory)].sort(),
  };
}

/** --baseline 模式：读入红线条目与基线比对，只报新增；阻断仅限真红线（债务型规则 WARN）。 */
function runBaseline(results) {
  const current = collectViolationKeys(results);
  const allKeys = [...current.blocking, ...current.advisory];
  // 扫描健康门（fail-closed，比对前）：rg 缺失/执行失败时上方 rg() 已返回 []，
  // 若不拦截，--baseline 模式 newV=[] 会退 0 假绿放行（code_review P1）。
  if (!rgHealthy) {
    return { ok: false,
      note: '[扫描不可用] ripgrep 缺失或执行失败，红线扫描未完整执行——拒绝放行（fail-closed）',
      current: allKeys, newViolations: allKeys, advisoryViolations: [] };
  }
  const update = process.argv.includes('--update-baseline');
  if (update) {
    fs.mkdirSync(path.dirname(BASELINE_FILE), { recursive: true });
    fs.writeFileSync(BASELINE_FILE, JSON.stringify(
      { generated: new Date().toISOString(), count: allKeys.length, violations: allKeys }, null, 2) + '\n');
    return { ok: true, note: `--update-baseline: 已写入 ${allKeys.length} 条红线基线`, current: allKeys };
  }
  if (!fs.existsSync(BASELINE_FILE)) {
    return { ok: false,
      note: `[缺失基线] redlines-baseline.json 不存在——无法比对新增违规，请先运行 node scripts/check-redlines.mjs --json --update-baseline 建立基线`,
      current: allKeys, newViolations: allKeys, advisoryViolations: [] };
  }
  let base;
  try { base = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf-8')); }
  catch {
    return { ok: false,
      note: `[基线损坏] redlines-baseline.json 无法解析，删除后重跑 --update-baseline`,
      current: allKeys };
  }
  const baseSet = new Set(base.violations || []);
  const newBlocking = current.blocking.filter((k) => !baseSet.has(k));
  const newAdvisory = current.advisory.filter((k) => !baseSet.has(k));
  const gone = [...baseSet].filter((k) => !allKeys.includes(k));
  const errors = newBlocking.map((k) => `[新增红线违规] ${k}`);
  const warns = newAdvisory.slice(0, 10).map((k) => `[债务规则 WARN] ${k}`);
  const infos = gone.slice(0, 10).map((k) => `[已清理] ${k}`);
  const blocking = newBlocking.length;
  const advisory = newAdvisory.length;
  return {
    ok: blocking === 0,
    note: blocking
      ? `${blocking} 条新增红线违规${errors[0]}`
      : (advisory
        ? `${advisory} 条债务规则新增（WARN 不阻断）${warns[0]}`
        : (gone.length ? `${gone.length} 条历史违规已清理` : '红线零新增')),
    current: allKeys, newViolations: newBlocking, advisoryViolations: newAdvisory,
    errors, warns, infos,
    baselineCount: baseSet.size, goneCount: gone.length,
  };
}

/**
 * --audit 模式：B 类审查（设计判断，无法自动化）的盘问锚点。
 * 输出审查框架 checklist，引导 AI 按「审核四件套 + 设计质量 + 反模式 + UX」逐一盘问，
 * 输出 P1-P4 风险表并落 docs/review-report.md。参照 AGENTS.md「审核代码可用性」章节。
 */
function outputAudit() {
  const out = [
    '========== Design Audit Checklist ==========',
    '> 按维度逐一盘问，输出 P1-P4 风险表，结果落 docs/review-report.md',
    '',
    '【1. 审核思维准则（盘问代码）】',
    '  [数据流]    状态从哪来？谁修改？流到哪？ → grep setter / bus.emit / PageStore. 写入点，查幽灵路径',
    '  [生命周期]  订阅/监听创建与销毁是否同层配对？ → bus.on 有 _unsubs 清理？EventsOn 有 _registered 守卫？',
    '  [并发边界]  异步有过期标记？连点 3 次是否竞态？ → 查 _loading/_pending/generation counter',
    '  [异常契约]  抛异常后调用方还能安全用吗？ → catch 后状态一致？finally emit 完成事件？',
    '',
    '【2. 设计质量检查项】',
    '  [状态唯一]  同一状态是否多处读写？ → PageStore/registry 唯一源 vs 模块级变量+localStorage 双源',
    '  [副作用]    函数是否隐式改外部状态？ → 模块级变量被多处直接写入',
    '  [并发安全]  异步有去重/锁？ → _registered 守卫防重复注册',
    '  [错误边界]  异常不吞没不扩散？ → 静默 catch {} 或 Promise 无 .catch 即违规',
    '  [资源释放]  订阅级联清理？ → _unsubs 数组统一 disconnectedCallback 清',
    '  [UI 文案]   可见文案走 TERMINOLOGY？ → 新造词 = 术语漂移',
    '',
    '【3. 反模式排查】',
    '  [隐式状态写入] 函数直接改模块级 _xxx 而非 setter/action',
    '  [职责过载]     一函数做数据获取+UI 更新+持久化（违反三层解耦）',
    '  [魔法数值]     硬编码常量/事件字符串；CSS 硬编码颜色（R5 已扫，但变量误用语义靠人）',
    '  [显著重复]     相似逻辑 ≥2 文件 → 抽 utils/ 公共函数',
    '  [Promise 断裂] .then() 无 .catch() 或 catch 静默吞错',
    '  [无守卫注册]   bus.on 顶层直接注册不查已注册（ADR-008）',
    '',
    '【4. UX 审核（代码模式识别体验问题）】',
    '  [路径深度]   核心功能 ≤3 层可达？',
    '  [异步反馈]   async 前后 UI 状态更新？按钮 loading → 完成 → 恢复',
    '  [破坏防呆]   remove/delete/reset 有二次确认？',
    '  [错误消息]   catch 抛给用户的是可理解文案（含文件名/原因）？',
    '  [交互一致]   同类操作复用 modal.js/.btn-base？',
    '  [空状态]     无数据时有行动入口？',
    '  [可撤销]     破坏性操作有恢复路径（回收站/撤销）？',
    '',
    '【5. 心理模拟】',
    '  ① 契约检查：公开函数签名 vs 内部实现一致？隐式依赖外部全局？',
    '  ② 状态机：快速点击 3 次，_loading/_pending 能拦截？',
    '  ③ 异常：第 N 行抛异常，第 M 行清理仍执行？（finally 覆盖）',
    '  ④ 引用计数：bus.on ↔ 清理、addEventListener ↔ removeEventListener 配对？',
    '',
    '【输出格式】',
    '## [模块名] — 审核结果',
    '**总体结论：通过 / 有条件通过 / 不通过**',
    '**亮点：** [模式 + 文件:行号]',
    '**风险：** P1-P4 表（级别 | 文件 | 观察 | 建议）',
    '',
    '落盘：docs/review-report.md',
  ];
  process.stdout.write(out.join('\n') + '\n');
}

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const auditMode = args.includes('--audit');
const baselineMode = args.includes('--baseline') || args.includes('--update-baseline');
if (auditMode) {
  outputAudit();
  process.exit(0);
}
const results = runChecks();
if (baselineMode) {
  const r = runBaseline(results);
  if (jsonMode) {
    outputJson(results, {
      rules: results.length,
      violations: results.reduce((s, rr) => s + rr.count, 0),
      baselineViolations: r.baselineCount ?? null,
      newViolations: r.newViolations?.length ?? null,
      advisoryViolations: r.advisoryViolations?.length ?? null,
      goneCount: r.goneCount ?? null,
      ok: r.ok,
      notice: r.note,
    });
  } else {
    console.log(`红线基线比对: ${r.ok ? '[OK]' : '[FAIL]'} ${r.note}`);
    for (const e of r.errors || []) console.log(`  ${e}`);
    for (const w of r.warns || []) console.log(`  ${w}`);
    for (const i of r.infos || []) console.log(`  ${i}`);
  }
  process.exitCode = r.ok ? 0 : 1;
} else if (jsonMode) {
  outputJson(results);
} else {
  outputText(results);
}
