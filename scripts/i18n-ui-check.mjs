// i18n-ui-check.mjs — i18n UI 漂移检查（治本：堵住"动态菜单漏译"盲区）
//
// 背景：
//   既有 i18n-check.mjs 只查 语言包(key parity/占位符/zh-CN 漏译/语言清单漂移)，
//   对「组件源码里硬写中文、且完全没调 t()」的 UI 完全失明——这类串切语言永远是
//   中文，但 key 检查器永远不报错（假绿）。典型：tpl.ts / render.ts / dialogs 里
//   用模板字符串拼的中文按钮、下拉项、placeholder、空状态文案。
//
//   本脚本专门抓这一类：扫描 frontend/src 下所有 .ts（排除 *.test.ts 与语言包源），
//   命中「含 HTML 标记 + 含中文 + 未包 t()」的字符串即判为漂移。
//
// 判定（精确、低误报）：
//   1. 先遮罩注释（行/块注释 → 同长空格，保留换行与偏移，行号才准）；
//   2. 抽所有字符串字面量（单/双/反引号，反引号可跨行）；
//   3. 字面量同时含 [汉字] + [HTML 信号] → 候选；
//   4. 若该字面量是 `t("...")` 直接参数（前缀 `\bt(\s*`）→ 已翻译，跳过；
//   5. 排除：语言选择器原生名（value="zh-CN"/"en"/"ja" 的 option 文本，标准 UX 刻意不翻）。
//
// HTML 信号 = 含 `<字母|/|!` 标签，或 class=/data-testid/placeholder=/title=/id=/</
//             /<option/<button 之一。只抓「渲染到 DOM 的用户可见文本」，避开标识符/数据映射。
//
// 用法：
//   node scripts/i18n-ui-check.mjs            # 文本报告（warning，不阻断）
//   node scripts/i18n-ui-check.mjs --json     # JSON（doctor/CI 消费）
//   node scripts/i18n-ui-check.mjs --strict   # 有漂移则 exit 1（CI 强阻断）
// 退出码：warning 模式恒 0（靠 doctor 侧 WARN 渲染）；--strict 且有漂移 → 1；干净 → 0。
//
// 零依赖（仅 node:fs / node:path / node:url / node:url）。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "frontend", "src");
const LOCALE_DIR = path.join(SRC, "core", "i18n", "locales");

const args = new Set(process.argv.slice(2));
const JSON_OUT = args.has("--json");
const STRICT = args.has("--strict");

const HAN = /[一-鿿]/;
const HTML_SIGNAL =
  /<[a-zA-Z/!]|class\s*=|data-testid|placeholder\s*=|title\s*=|id\s*=|<\/|<option|<button/;
// 语言选择器原生名（刻意不翻，标准 UX）
const LANG_PICKER = /value="(zh-CN|en|ja)"/;

/** 把注释遮罩成同长空格（保留换行与字符偏移，行号才准）。 */
function maskComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(?<!:)\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));
}

/**
 * 遮罩「含引号的正则字面量」（如 replace(/"/g, "&quot;")），
 * 避免正则体内的引号被 STR_RE 误判为字符串边界导致后续整段代码匹配错乱。
 * 只处理 replace/match/search/split 后紧跟的正则（几乎必为正则字面量），且仅当正则体内含引号时才遮。
 */
function maskRegexLiterals(src) {
  return src.replace(
    /(replace|match|matchAll|search|split)\s*\(\s*\/((?:\\\/|[^/])*?)\/([dgimsuvy]*)/g,
    (m) => m.replace(/[^\n]/g, " "),
  );
}

/** 遮罩 TS 类型索引访问（如 `: BedrockGeometry["bones"]`）里的引号，避免类型 key 被误当字符串。 */
function maskTsTypeIndex(src) {
  return src.replace(
    /:\s*[A-Za-z$_][\w$]*\s*\[\s*["'][^"']*["']\s*\]/g,
    (m) => m.replace(/[^\n]/g, " "),
  );
}

/** 字符串字面量正则：单/双/反引号，反引号可跨行。 */
const STR_RE = /(["'`])((?:\\.|(?!\1)[^\\])*?)\1/gs;

function lineOf(src, idx) {
  let line = 1;
  for (let i = 0; i < idx && i < src.length; i++) {
    if (src[i] === "\n") line++;
  }
  return line;
}

function scanFile(file) {
  const raw = fs.readFileSync(file, "utf8");
  const masked = maskTsTypeIndex(maskRegexLiterals(maskComments(raw)));
  const hits = [];
  STR_RE.lastIndex = 0;
  let m;
  while ((m = STR_RE.exec(masked)) !== null) {
    const lit = m[2];
    const start = m.index;
    if (!HAN.test(lit)) continue;
    if (!HTML_SIGNAL.test(lit)) continue;
    if (/\bt\(\s*$/.test(masked.slice(0, start))) continue; // 已翻译
    // 拼接链（'a' + t("key") + 'b'）：剥离其中的 t("key") 调用段，若剩余中文都在 t() 里则视为已翻译
    if (/\bt\(/.test(lit)) {
      const strippedT = lit.replace(/\bt\s*\(\s*"[^"]*"(?:\s*,\s*\{[^}]*\})?\s*\)/gs, "");
      if (!HAN.test(strippedT)) continue;
    }
    if (m[1] === "`") {
      // 模板字符串：剥离所有 ${...} 插值块（支持嵌套大括号），若剩余不含中文则已翻译。
      // 插值块内要么是 t() 调用、要么是 JS 逻辑/数据值，都不作为 UI 文本判定。
      let stripped = "";
      let i = 0;
      while (i < lit.length) {
        const open = lit.indexOf("${", i);
        if (open === -1) {
          stripped += lit.slice(i);
          break;
        }
        // 拷贝 ${ 之前的内容
        stripped += lit.slice(i, open);
        // 找插值块的结束 }（跳过 "${"，对内部嵌套大括号计数）
        let depth = 0;
        let j = open + 2;
        for (; j < lit.length; j++) {
          if (lit[j] === "{") depth++;
          else if (lit[j] === "}") {
            if (depth === 0) break;
            depth--;
          }
        }
        i = (j < lit.length ? j + 1 : j); // 跳到插值块之后
      }
      if (!HAN.test(stripped)) continue;
    }
    if (LANG_PICKER.test(lit)) continue; // 语言选择器原生名
    hits.push({ line: lineOf(masked, start), snippet: lit.length > 60 ? lit.slice(0, 57) + "…" : lit });
  }
  return hits;
}

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (path.resolve(p) === LOCALE_DIR) continue; // 跳过语言包源
      walk(p, out);
    } else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) {
      out.push(p);
    }
  }
}

const files = [];
walk(SRC, files);
const report = [];
let total = 0;
for (const f of files) {
  const hits = scanFile(f);
  if (hits.length) {
    total += hits.length;
    report.push({ file: path.relative(ROOT, f).split(path.sep).join("/"), hits });
  }
}

if (JSON_OUT) {
  console.log(JSON.stringify({ drift: total, files: report.length, details: report }, null, 2));
  process.exit(STRICT && total ? 1 : 0);
}

console.log("i18n UI 漂移检查 (i18n-ui-check)");
console.log("规则: 含 HTML 标记 + 含中文 + 未包 t() → 漂移（已排除语言包/测试/语言选择器原生名）");
console.log(`扫描: ${files.length} 个 .ts`);
console.log("─".repeat(60));
if (!total) {
  console.log("✅ 未发现硬编码中文 UI（动态菜单已接入 t()）");
} else {
  for (const r of report) {
    console.log(`📄 ${r.file}  (${r.hits.length} 处)`);
    for (const h of r.hits) console.log(`   L${h.line}: ${h.snippet}`);
  }
  console.log("─".repeat(60));
  console.log(`共 ${total} 处漂移，涉及 ${report.length} 个文件`);
}
process.exit(STRICT && total ? 1 : 0);
