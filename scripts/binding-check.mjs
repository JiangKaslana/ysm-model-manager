#!/usr/bin/env node
/**
 * Wails Binding 签名检查。对比 Go 端导出函数 vs 前端生成的 wailsjs。
 * 由 scripts/binding-check.py 迁移（2026-08-03），逻辑逐点保真。
 * binding-check.mjs — Go binding 一致性检查
 * 设计意图：Go binding 一致性检查
 * 依赖：node:fs / node:path / node:url
 * 用法：
 *   node scripts/binding-check.mjs                 # 默认行为
 * 退出码：发现 missing_in_js / extra_in_js / signature_mismatch 不一致 → 1；一致 → 0
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './_lib/scan-files.mjs';


// Go 文件：动态扫描 internal/app/ 下所有非测试 .go（避免硬编码清单漏扫新增文件）
function listGoFiles() {
  const dir = path.join(ROOT, 'internal/app');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.go') && !f.endsWith('_test.go')).sort();
}
const GO_FILES = listGoFiles();
// Wails 绑定统一走 -ts 契约（frontend/bindings），对照 v3 生成的 app.ts。
// 模块名从 go.mod 推导（P2-1）：硬编码 ysm-model-manager 在模块重命名时会静默退化
const goModText = fs.existsSync(path.join(ROOT, 'go.mod')) ? fs.readFileSync(path.join(ROOT, 'go.mod'), 'utf-8') : '';
const BIND_MODULE = (goModText.match(/^module\s+(\S+)/m) || [])[1];
const BINDINGS_FILE = BIND_MODULE
  ? path.join(ROOT, 'frontend/bindings', BIND_MODULE, 'internal/app/app.ts')
  : path.join(ROOT, 'frontend/bindings/ysm-model-manager/internal/app/app.ts');

// 框架生命周期方法（带 context/application 参数），Wails 不生成绑定，应排除
const FRAMEWORK_METHODS = new Set(['ServiceStartup', 'ServiceShutdown']);

/** 括号配对：从 open 位置找到与之匹配的右括号（跳过嵌套层级），找不到返回文本末尾。 */
function matchingParen(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return text.length;
}

/** 粗略 arity：参数段内逗号数 + 1（无参为 0），仅用于绑定签名对账。 */
function paramArity(text, open, close) {
  const params = text.slice(open + 1, close).trim();
  if (params === '') return 0;
  return 1 + (params.match(/,/g) ?? []).length;
}

function extractGoExports() {
  /** 从 Go 源码提取所有 func (a *App) 导出函数（name → {file, arity}）。 */
  const exports = {};
  for (const fname of GO_FILES) {
    const fp = path.join(ROOT, 'internal/app', fname);
    if (!fs.existsSync(fp)) continue;
    const text = fs.readFileSync(fp, 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '') // P2-3：块注释剥离（防注释里的假签名干扰正则/arity）
      .replace(/^\s*\/\/.*$/gm, '');    // P2-3：行注释剥离
    // P2-2：接收者名任意 + 指针/值均可（`func (a *App)` / `func (app *App)` / `func (a App)`），
    // 硬编码 `a *App` 会把合法变体静默漏扫（假阳性 extra_in_js 或假绿）
    for (const m of text.matchAll(/func \(\w+ \*?App\) (\w+)\(/g)) {
      const name = m[1];
      // 跳过大写开头的非导出函数（Go 惯例）+ 框架生命周期方法
      if (name[0] === name[0].toLowerCase()) continue;
      if (FRAMEWORK_METHODS.has(name)) continue;
      if (!(name in exports)) {
        const open = m.index + m[0].length - 1; // m[0] 以参数列表的 `(` 收尾
        const close = matchingParen(text, open);
        exports[name] = { file: path.basename(fp), arity: paramArity(text, open, close) };
      }
    }
  }
  return exports;
}

function extractBindingsExports() {
  /** 从 v3 契约产物 app.ts 提取所有导出的包装函数（name → {file, arity}）。 */
  const exports = {};
  if (!fs.existsSync(BINDINGS_FILE)) return exports;
  const text = fs.readFileSync(BINDINGS_FILE, 'utf-8');
  for (const m of text.matchAll(/export function (\w+)\(/g)) {
    const name = m[1];
    if (!(name in exports)) {
      const open = m.index + m[0].length - 1; // m[0] 以参数列表的 `(` 收尾
      const close = matchingParen(text, open);
      exports[name] = { file: path.basename(BINDINGS_FILE), arity: paramArity(text, open, close) };
    }
  }
  return exports;
}

const goExports = extractGoExports();
const jsExports = extractBindingsExports();

const issues = [];

// Go 有但 JS 没有，或 Go/JS 粗略 arity 不一致（签名漂移）
for (const [name, f] of Object.entries(goExports).sort(([a], [b]) => a.localeCompare(b))) {
  if (!(name in jsExports)) {
    issues.push({ type: 'missing_in_js', func: name, go_file: f.file });
  } else if (f.arity !== jsExports[name].arity) {
    issues.push({ type: 'signature_mismatch', name, goArity: f.arity, jsArity: jsExports[name].arity, file: f.file });
  }
}

// JS 有但 Go 没有
const jsNames = new Set(Object.keys(jsExports));
const goNames = new Set(Object.keys(goExports));
for (const name of [...jsNames].filter((n) => !goNames.has(n)).sort()) {
  issues.push({ type: 'extra_in_js', func: name, js_file: path.relative(ROOT, BINDINGS_FILE) });
}

const out = { _summary: { go_functions: Object.keys(goExports).length, js_functions: Object.keys(jsExports).length, issues: issues.length }, issues };
process.stdout.write(JSON.stringify(out, null, 2) + '\n');

// 退出码：契约不一致即非 0，供 doctor / CI 真实阻断（原实现恒 exit 0，假绿）
// 用 exitCode 而非 process.exit()：让 stdout 管道下的异步写入排空后再退出，避免 JSON 被截断
process.exitCode = issues.length ? 1 : 0;
