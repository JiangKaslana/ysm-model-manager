#!/usr/bin/env node
/**
 * check-adr-drift.mjs — ADR 描述与代码现实漂移检测。
 *
 * 背景：ADR-002 等健康检查文档在代码还债后常忘记翻牌，导致 AI 把已完成的活
 * 反复当成开放债（实测：app_install.go 已还债成 10 行薄壳、DownloadQueue↔App
 * 循环已改 callback 模式，但 ADR-002 文本仍标"待办/未下沉"）。
 *
 * 本脚本做双向校验：
 *   A) 文档侧：若 ADR-002 文本仍含已知"已还债但标开放"的旧表述 → 报 DRIFT。
 *   B) 代码侧（正向事实源）：直接读源码断言现实，与文档声明对账。
 *      - app_install.go 行数应 < 50（薄壳），否则 DRIFT（它本应已下沉）。
 *      - DownloadQueue 结构体不应含 *App 字段（循环应已打破）。
 *
 * 零依赖（仅 node:fs / node:path / node:url，复用 _lib/scan-files.mjs 的 ROOT）。
 *
 * 用法：
 *   node scripts/check-adr-drift.mjs           # 文本报告
 *   node scripts/check-adr-drift.mjs --json    # JSON（CI / 子代理消费）
 *
 * 退出码：发现漂移 → 1；一致或仅警告 → 0。
 *
 * 新增"已还债事实"时，在此文件的 KNOWN_REPAID 与 CODE_ASSERTS 同步登记。
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './_lib/scan-files.mjs';

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');

// ---- 已知"已还债但历史文档可能仍标开放"的表述（文档侧漂移特征串）----
// 每条用 tokens（必须同时出现的子串）+ exclude（出现则排除漂移，即已翻牌）判定。
// 用 token 组合而非长正则，避免中英文括号/全半角差异导致漏匹配。
// 每条：{ tokens: string[], exclude?: string[], fact: '人类可读的事实描述' }
const KNOWN_REPAID = [
  {
    // 原表述「app_install.go（1,315 行）仍未下沉」的高区分度组合
    tokens: ['1,315', '仍未下沉'],
    fact: 'app_install.go 已还债：现为薄壳（< 50 行），逻辑迁至 app_install_instance.go',
  },
  {
    // 原表述「分散在 17 个文件中」且未加翻牌注记
    tokens: ['分散在', '17', '个文件'],
    exclude: ['评估时点'],
    fact: 'god-object 散布文件数已变（实测 21 个），且 app_install.go 已下沉，原 17 文件表述失真',
  },
  {
    // 原表述「DownloadQueue ↔ App 存在对象级循环引用（NewDownloadQueue(a) 持有 *App）」
    tokens: ['DownloadQueue', '↔', 'App', '对象级循环引用', '持有', '*App'],
    fact: 'DownloadQueue↔App 循环已打破：改为回调注入（downloadFn/emitFn/logFn），无 *App 字段',
  },
];

// 文档侧漂移：全部 token 同时出现，且 exclude 中无一出现 → 命中
function docHasDrift(text, item) {
  const hit = item.tokens.every((t) => text.includes(t));
  if (!hit) return false;
  if (item.exclude && item.exclude.length) {
    // code review P3：exclude 限定在含 token 的段落内判断——整文档判断会让
    // 泛用短语（如「评估时点」）在无关段落出现一次就整条失效（护栏 fail-open，
    // 该抓的漂移抓不到）。翻牌标记须与漂移表述同段才算数。
    const paras = text.split(/\n\s*\n/);
    const tokenParas = paras.filter((p) => item.tokens.some((t) => p.includes(t)));
    if (tokenParas.some((p) => item.exclude.some((x) => p.includes(x)))) return false;
  }
  return true;
}

// ---- 代码侧正向断言（事实源 = 源码）----
// 每项返回 { ok: boolean, detail: string }
function codeAsserts() {
  const results = [];

  // 1. app_install.go 应为薄壳（< 50 行）
  const installPath = path.join(ROOT, 'internal/app/app_install.go');
  try {
    const lines = fs.readFileSync(installPath, 'utf-8').split('\n').length;
    results.push({
      name: 'app_install.go 薄壳',
      ok: lines < 50,
      detail: `app_install.go = ${lines} 行（阈值 < 50，薄壳判定）`,
    });
  } catch (e) {
    results.push({ name: 'app_install.go 薄壳', ok: false, detail: `读取失败: ${e.message}` });
  }

  // 2. DownloadQueue 结构体不应含 *App 字段
  const dlPath = path.join(ROOT, 'internal/app/app_download.go');
  try {
    const text = fs.readFileSync(dlPath, 'utf-8');
    const structM = text.match(/type DownloadQueue struct\s*\{([\s\S]*?)\n\}/);
    const body = structM ? structM[1] : '';
    const hasAppField = /\*\s*App\b/.test(body);
    results.push({
      name: 'DownloadQueue 无 *App 字段',
      ok: !hasAppField,
      detail: hasAppField
        ? 'DownloadQueue 仍持有 *App 字段（循环未打破）'
        : 'DownloadQueue 无 *App 字段（循环已打破，回调注入）',
    });
  } catch (e) {
    results.push({ name: 'DownloadQueue 无 *App 字段', ok: false, detail: `读取失败: ${e.message}` });
  }

  return results;
}

// ---- 主流程 ----
const adr002Path = path.join(ROOT, 'docs/adr/ADR-002-project-health-assessment.md');
const drifts = [];      // 硬漂移（文档标开放但代码已还债 / 代码断言失败）
const warnings = [];

if (fs.existsSync(adr002Path)) {
  const adrText = fs.readFileSync(adr002Path, 'utf-8');
  for (const item of KNOWN_REPAID) {
    if (docHasDrift(adrText, item)) {
      drifts.push(`DOC_DRIFT: ADR-002 仍含已还债表述「${item.fact}」——请同步翻牌`);
    }
  }
} else {
  warnings.push(`WARN: ${path.relative(ROOT, adr002Path)} 不存在，跳过文档侧校验`);
}

const codeResults = codeAsserts();
for (const r of codeResults) {
  if (!r.ok) drifts.push(`CODE_DRIFT: ${r.name} — ${r.detail}`);
}

// ---- 输出 ----
const summary = {
  docDriftPatterns: KNOWN_REPAID.length,
  codeAsserts: codeResults.length,
  drifts: drifts.length,
  warnings: warnings.length,
};

if (jsonMode) {
  process.stdout.write(
    JSON.stringify({ _summary: summary, codeAsserts: codeResults, drifts, warnings }, null, 2) + '\n',
  );
} else {
  console.log('=== ADR 漂移检测 ===');
  console.log(`代码侧断言：${codeResults.length} 项`);
  for (const r of codeResults) {
    console.log(`  ${r.ok ? '✅' : '❌'} ${r.name} — ${r.detail}`);
  }
  if (warnings.length) {
    console.log('\n警告：');
    for (const w of warnings) console.log(`  ⚠️  ${w}`);
  }
  if (drifts.length) {
    console.log(`\nFAILED: 发现 ${drifts.length} 处漂移\n`);
    for (const d of drifts) console.log(`  [${d}]`);
    process.exit(1);
  } else {
    console.log('\nOK: ADR 描述与代码现实一致，无漂移');
  }
}

process.exit(drifts.length ? 1 : 0);
