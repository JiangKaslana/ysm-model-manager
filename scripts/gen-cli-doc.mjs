#!/usr/bin/env node
/**
 * gen-cli-doc.mjs — CLI 命令参考文档生成器（go/cli 注册表 → docs/cli-commands.md）。
 *
 * 设计意图：CLI 命令曾长期「命令已注册但文档停在 18 个」（AGENTS.md 章节漂移）。
 * 本脚本把 `go/cli/` 的 `RegisterCommandC` 注册表 + `print*Usage` 子命令文本设为
 * 唯一事实来源，静态提取顶层命令/分类/子命令/选项，生成 docs/cli-commands.md 的
 * GEN 区——新增命令只改源码注册，文档自动跟上，消灭手动同步。
 *
 * 依赖：零依赖（node:fs / node:path + scripts/_lib/scan-files.mjs 共享层）。
 *
 * 用法：
 *   node scripts/gen-cli-doc.mjs            # 写入 docs/cli-commands.md
 *   node scripts/gen-cli-doc.mjs --check    # 只对比不写盘（doctor/pre-push 守护）
 *   node scripts/gen-cli-doc.mjs --json     # JSON 摘要（命令清单，子代理消费）
 *
 * 退出码：--check 过期 → 1；否则 0（WARN 不阻断）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readText, writeText } from './_lib/scan-files.mjs';

const CLI_DIR = path.join(ROOT, 'go', 'cli');
const OUT = path.join(ROOT, 'docs', 'cli-commands.md');

const CHECK = process.argv.includes('--check');
const JSON_OUT = process.argv.includes('--json');

/* ---------------- 提取：注册表（唯一事实来源） ---------------- */

/** 顶层命令注册：RegisterCommandC("name", CatX, "desc", runFn)。支持跨行。 */
const CMD_RE = /RegisterCommandC\(\s*"([a-z0-9-]+)"\s*,\s*(\w+)\s*,\s*"((?:[^"\\]|\\.)*)"\s*,\s*(\w+)\s*\)/g;

/** 按 `\nfunc ` 切函数块（Go 顶层声明不缩进，函数体内嵌闭包缩进，不会误切）。 */
function funcBlocks(text) {
  return text
    .split(/\n(?=func )/)
    .map((p) => {
      const m = p.match(/^func (\w+)\(/);
      return m ? { name: m[1], body: p } : null;
    })
    .filter(Boolean);
}

/** 取名称精确匹配的函数体（如 runTags）。 */
function findFunc(blocks, name) {
  return blocks.find((b) => b.name === name);
}

/**
 * 提取 flag：fs.String/Bool/Int/Float64/Var 调用 → { flag, type, help, def }。
 * 括号配对截取调用文本，取首字符串为 flag 名、末字符串为 help、
 * 若有三个字符串则中间为字符串字面量默认值。
 */
function extractFlags(body) {
  const flags = [];
  const re = /fs\.(String|Bool|Int|Float64|StringVar|BoolVar|IntVar|Float64Var)\(/g;
  let m;
  while ((m = re.exec(body))) {
    let depth = 0;
    let i = m.index + m[0].length;
    for (; i < body.length; i++) {
      if (body[i] === '(') depth++;
      else if (body[i] === ')') {
        if (depth === 0) break;
        depth--;
      }
    }
    const call = body.slice(m.index, i + 1);
    const nameM = call.match(/\(\s*"([^"]+)"/);
    if (!nameM) continue;
    const strs = [...call.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((a) => a[1]);
    const entry = {
      flag: nameM[1],
      type: m[1].toLowerCase().replace(/var$/, ''),
      help: strs.length >= 2 ? strs[strs.length - 1] : '',
      def: '',
    };
    // 三字符串形态：name, 默认值, help（默认值为字符串字面量）
    if (strs.length >= 3) entry.def = strs[strs.length - 2];
    else if (!entry.help && strs.length >= 2) entry.def = strs[strs.length - 1];
    flags.push(entry);
  }
  return flags;
}

/** 提取函数体内子命令（父命令统一 `switch sub {` 分发，case "xxx" 即子命令；排除 *format/ext 等值 switch）。 */
function extractSubcommands(body) {
  const out = [];
  const sw = body.indexOf('switch sub {');
  if (sw < 0) return out;
  const re = /case\s+"([a-z0-9-]+)":/g;
  let m;
  while ((m = re.exec(body.slice(sw)))) out.push(m[1]);
  return out;
}

/** 收集全部 print*Usage 函数体中的 `  <子命令>  <描述>` 行，按 Usage 函数名归档（Go 源码 fmt.Println 包裹）。 */
function collectSubDescByFunc() {
  const byFunc = {};
  for (const f of fs.readdirSync(CLI_DIR)) {
    if (!f.endsWith('.go') || f.endsWith('_test.go')) continue;
    const text = readText(path.join(CLI_DIR, f));
    for (const fn of funcBlocks(text)) {
      if (!/^print\w+Usage$/.test(fn.name)) continue;
      const desc = {};
      const re = /fmt\.Println\("  ([a-z0-9-]+)\s{2,}([^"]*)"\)/g;
      let m;
      while ((m = re.exec(fn.body))) desc[m[1]] = m[2].trim();
      byFunc[fn.name] = desc;
    }
  }
  return byFunc;
}

/** 从 run 函数体中找它实际调用的 print*Usage 函数名（父命令 → 其专属子命令描述表）。 */
function findUsageFunc(body) {
  const m = body.match(/print(\w+)Usage\(\)/);
  return m ? `print${m[1]}Usage` : null;
}

/* ---------------- 解析 ---------------- */

/** 分类名常量（与 go/cli/registry.go 一致）。 */
const CAT_NAMES = {
  CatModel: '模型管理',
  CatPerf: '性能诊断',
  CatCache: '缓存管理',
  CatResource: '资源仓库',
  CatConfig: '配置',
  CatOther: '其他',
};
/** 分类展示顺序（与 go/cli/cli.go printCLIHelp 一致）。 */
const CAT_ORDER = ['CatModel', 'CatPerf', 'CatCache', 'CatResource', 'CatConfig', 'CatOther'];

function parse() {
  const regs = [];
  const blocks = [];
  for (const f of fs.readdirSync(CLI_DIR)) {
    if (!f.endsWith('.go') || f.endsWith('_test.go')) continue;
    const text = readText(path.join(CLI_DIR, f));
    blocks.push(...funcBlocks(text));
    let m;
    const local = new RegExp(CMD_RE.source, 'g');
    while ((m = local.exec(text))) {
      regs.push({ name: m[1], category: m[2], description: m[3], runFn: m[4], file: f });
    }
  }

  const subDescByFunc = collectSubDescByFunc();
  const commands = regs.map((r) => {
    const fn = findFunc(blocks, r.runFn);
    const body = fn ? fn.body : '';
    const subs = extractSubcommands(body);
    const usageFn = findUsageFunc(body);
    const subDesc = (usageFn && subDescByFunc[usageFn]) || {};
    return {
      name: r.name,
      category: r.category,
      description: r.description,
      subcommands: subs.map((s) => ({ name: s, desc: subDesc[s] || '' })),
      flags: extractFlags(body),
    };
  });
  commands.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return commands;
}

/* ---------------- 渲染 ---------------- */

function flagTypeLabel(type) {
  return { string: 'string', bool: 'bool', int: 'int', float64: 'float' }[type] || type;
}

function renderFlags(flags) {
  if (flags.length === 0) return '';
  const rows = flags
    .map((fl) => {
      const def = fl.def ? `（默认: ${fl.def}）` : '';
      const help = fl.help ? ` ${def}— ${fl.help}` : def;
      return `| \`--${fl.flag}\` | ${flagTypeLabel(fl.type)}${help || ''} |`;
    })
    .join('\n');
  return `\n| 选项 | 类型 | 说明 |\n|------|------|------|\n${rows}\n`;
}

function renderSubcommands(cmdName, subs) {
  if (subs.length === 0) return '';
  const rows = subs
    .map((s) => `| \`${s.name}\` | ${s.desc || '—'} |`)
    .join('\n');
  return `\n**子命令**（用法：\`app --cli --files-root <路径> ${cmdName} <子命令> [选项...]\`）：\n\n| 子命令 | 说明 |\n|--------|------|\n${rows}\n`;
}

function renderCommands(commands) {
  const byCat = {};
  for (const c of commands) (byCat[c.category] ||= []).push(c);

  const parts = [];
  for (const cat of CAT_ORDER) {
    const list = byCat[cat];
    if (!list || list.length === 0) continue;
    parts.push(`## ${CAT_NAMES[cat] || cat}\n`);
    for (const c of list) {
      parts.push(`### \`${c.name}\``);
      parts.push(c.description);
      parts.push('');
      const usage = `app --cli --files-root <路径> ${c.name} [选项...]`;
      parts.push(`\`\`\`bash\n${usage}\n\`\`\``);
      parts.push(renderSubcommands(c.name, c.subcommands));
      parts.push(renderFlags(c.flags));
      parts.push('');
    }
  }
  return parts.join('\n');
}

/* ---------------- 主流程 ---------------- */

const commands = parse();
const body = renderCommands(commands);

const md = `# CLI 命令参考

> **自动生成**：由 \`node scripts/gen-cli-doc.mjs\` 从 \`go/cli/\` 命令注册表（\`RegisterCommandC\` + \`print*Usage\`）
> 静态提取生成，**单一事实来源 = 源码注册**。新增命令/子命令/选项只改 \`go/cli/\` 源码，
> 重跑本脚本即同步；\`--check\` 已接入 \`doctor.mjs\` 防漂移。
>
> 顶层命令共 **${commands.length}** 个。入口姿势与常用场景见根 \`AGENTS.md\`「CLI 模式使用说明」。

<!-- GEN: cli-commands -->
${body}
<!-- /GEN: cli-commands -->
`;

let rc = 0;
if (CHECK) {
  const onDisk = fs.existsSync(OUT) ? readText(OUT) : '';
  if (onDisk !== md) {
    rc = 1;
    if (!JSON_OUT) console.error(`[gen-cli-doc] docs/cli-commands.md 过期，运行 \`node scripts/gen-cli-doc.mjs\` 刷新。`);
  } else if (!JSON_OUT) {
    console.log('[gen-cli-doc] docs/cli-commands.md 最新。');
  }
} else {
  writeText(OUT, md);
  if (!JSON_OUT) console.log(`[gen-cli-doc] 已写入 ${path.relative(ROOT, OUT)}（${commands.length} 个顶层命令）`);
}

if (JSON_OUT) {
  console.log(
    JSON.stringify({
      ok: rc === 0,
      check: CHECK,
      generated: !CHECK,
      count: commands.length,
      commands: commands.map((c) => ({
        name: c.name,
        category: CAT_NAMES[c.category] || c.category,
        description: c.description,
        subcommands: c.subcommands.map((s) => s.name),
        flags: c.flags.map((f) => f.flag),
      })),
    }),
  );
}

process.exitCode = rc;