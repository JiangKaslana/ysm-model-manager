#!/usr/bin/env node
/**
 * css-layer-check.mjs — Shadow DOM 样式越界检查器（零依赖）。
 *
 * 问题背景：
 *   本项目大量组件使用 Shadow DOM（attachShadow + adoptedStyleSheets）。
 *   document 层 frontend/css/components.css 经 index.html 全局 <link> 加载，
 *   但 Shadow DOM 边界会阻断：① 全局 CSS 类在 shadow 内不生效；
 *                                     ② 全局 @keyframes 在 shadow 内不生效
 *                                       （CSS 自定义属性可穿透，@keyframes 不可）。
 *   因此「类/keyframe 定义在 components.css」≠「在 shadow 内生效」。这类 bug
 *   纯靠 grep 看不出来，且 build/typecheck 不验证 CSS 实际生效，CI 全绿也能过境。
 *
 * 检查项（ERROR 阻断 / WARN 提示）：
 *   [ERROR] shadow 内 CSS 的 `animation: <name>` 引用，但在同 shadow 层无 @keyframes 定义
 *           → 跨 shadow keyframe 静默失效（getAnimations()=0，无动画不破功能故潜伏）
 *   [ERROR] 反向断言：frontend/css/components.css 仍含 .stg-* / .tab-body
 *           → 这些已回迁 shadow（见 21c01725 / 9942ada3），全局副本是漂移源
 *   [WARN]  shadow tpl/组件 HTML 的 class="..." 使用的类，在当前 shadow 层无定义
 *           → 可能是漏迁/误归全局；WARN 因部分类来自内联或 document 层白名单
 *
 * 用法：
 *   node scripts/css-layer-check.mjs            # 报告，ERROR 也只提示（非阻断）
 *   node scripts/css-layer-check.mjs --strict   # ERROR 时 exit 1（供 pre-push 门禁）
 *   YSM_SKIP_CSS_LAYER=1 node ...               # 逃生阀，跳过本检查
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const STRICT = process.argv.includes("--strict");
if (process.env.YSM_SKIP_CSS_LAYER === "1") {
  console.log("[css-layer-check] YSM_SKIP_CSS_LAYER=1, 跳过");
  process.exit(0);
}

// ── Shadow 域定义：每域 = 一组 CSS 源 + 一组使用这些类的 HTML/tpl 源 ──
// app-content 由 content-css.ts 组合 6 个域文件；sidebar / app-tree / app-preview 各自独立。
const SHADOW_DOMAINS = [
  {
    name: "app-content",
    css: [
      "frontend/src/views/app-content/content-layout.ts",
      "frontend/src/views/app-content/content-repo.ts",
      "frontend/src/views/app-content/content-creator.ts",
      "frontend/src/views/app-content/content-diag.ts",
      "frontend/src/views/app-content/content-util.ts",
      "frontend/src/views/app-content/content-stg.ts",
      // app-sync-manager 光 DOM 自定义元素内嵌在 app-content shadow 内，其 tpl.ts 内联了 .sm-* 样式 + @keyframes sk-shimmer，
      // 作为本域 css 源参与 keyframes/class 聚合（同时也在下方 html 扫描其 class 使用）。
      "frontend/src/views/app-sync-manager/tpl.ts",
    ],
    // 使用 app-content 样式层的 tpl/组件（HTML 模板字符串 + 行内 class）
    // 含 app-sync-manager（光 DOM 自定义元素，被内嵌在 app-content shadow 内，共享其样式层）
    html: [
      "frontend/src/views/app-content/tpl-settings.ts",
      "frontend/src/views/app-content/settings/path-cards.ts",
      "frontend/src/views/app-content/index.ts",
      "frontend/src/views/app-sync-manager/tpl.ts",
    ],
  },
  {
    name: "sidebar",
    css: ["frontend/src/views/app-sidebar/sidebar-css.ts"],
    html: ["frontend/src/views/app-sidebar/index.ts", "frontend/src/views/app-sidebar/tpl.ts"],
  },
  {
    name: "app-tree",
    css: ["frontend/src/views/app-tree/app-tree-styles.ts"],
    html: ["frontend/src/views/app-tree/index.ts", "frontend/src/views/app-tree/tpl.ts"],
  },
  {
    name: "app-preview",
    css: ["frontend/src/views/app-preview/css.ts"],
    html: ["frontend/src/views/app-preview/index.ts"],
  },
];

// document 层类白名单：这些类定义在 components.css（全局 <link>），被 document 层 DOM 用，
// 不进 shadow，故 shadow tpl 不应引用它们（若引用是潜在越界，但此处不阻断，仅统计）。
const DOCUMENT_LAYER_FILE = "frontend/css/components.css";

// 提取 CSS 文本中的类名（.foo / .foo-bar）与 @keyframes 名
function extractClasses(cssText) {
  const classes = new Set();
  const re = /\.([a-zA-Z][a-zA-Z0-9-]*)/g;
  let m;
  while ((m = re.exec(cssText)) !== null) classes.add(m[1]);
  return classes;
}
function extractKeyframes(cssText) {
  const kf = new Set();
  const re = /@keyframes\s+([a-zA-Z0-9_-]+)/g;
  let m;
  while ((m = re.exec(cssText)) !== null) kf.add(m[1]);
  return kf;
}
// 提取 animation: 引用的 keyframe 名（含简写 animation: name dur ...）
function extractAnimationRefs(cssText) {
  const refs = new Set();
  const re = /animation\s*:\s*([^;]+)/g;
  let m;
  while ((m = re.exec(cssText)) !== null) {
    const body = m[1];
    if (/\bnone\b/.test(body)) continue;
    // 取第一个 token 作为关键帧名（animation: name duration ...）
    const first = body.trim().split(/\s+/)[0];
    if (first && !/^(infinite|both|forwards|backwards|linear|ease|ease-in|ease-out|ease-in-out|alternate|normal|\d|\.)/.test(first)) {
      refs.add(first);
    }
  }
  return refs;
}
// 提取 HTML 模板里 class="..." 使用的类名（仅纯 CSS 标识符，过滤拼接噪声如 ' + ( ? ')
function extractHtmlClasses(htmlText) {
  const classes = new Set();
  const re = /class\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(htmlText)) !== null) {
    for (const c of m[1].split(/\s+/)) {
      // 仅收「字母开头、仅含字母数字连字符」的 token；排除 ' + ( ? : ) 等模板拼接碎片
      if (/^[a-zA-Z][a-zA-Z0-9-]*$/.test(c)) classes.add(c);
    }
  }
  return classes;
}

// 各域「专属前缀」：本域内定义、不应出现在 document 层/其他域的专属类。
// 仅当类名匹配本域专属前缀且本域无定义时 WARN（精准锁定"自己域的专属类漏定义"）。
const DOMAIN_PREFIXES = {
  "app-content": ["stg-", "repo-", "cr-", "gh-", "ws-", "diag-", "recy-", "rm-", "set-", "page", "section-title", "stat-card", "placeholder-box", "ptag"],
  sidebar: ["instance-card", "card-", "footer", "sk-", "tag", "pkg-icon", "list"],
  "app-tree": ["tree-", "node-"],
  "app-preview": ["preview", "dp-"],
};

function readSafe(p) {
  const abs = path.resolve(ROOT, p);
  try {
    return fs.readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}

let errorCount = 0;
let warnCount = 0;
const problems = [];

// ── 检查 1：shadow 内 animation 引用的 keyframe 是否同层有 @keyframes ──
for (const dom of SHADOW_DOMAINS) {
  let cssAgg = "";
  for (const f of dom.css) {
    const t = readSafe(f);
    if (t) cssAgg += "\n" + t;
  }
  const kf = extractKeyframes(cssAgg);
  const refs = extractAnimationRefs(cssAgg);
  for (const r of refs) {
    if (!kf.has(r)) {
      errorCount++;
      problems.push(`[ERROR] ${dom.name}: animation 引用 @keyframes '${r}' 但在本 shadow 层无定义（跨 shadow keyframe 静默失效）`);
    }
  }
}

// ── 检查 1b：shadow tpl 内联 style="animation:<name>..." 引用的 keyframe 是否同层有 @keyframes ──
// 覆盖 app-sync-manager 等光 DOM 子树：其内联 style 的 animation 引用在 app-content shadow 层生效，
// 若同层无 @keyframes 则静默失效（与检查 1 同理，但源在内联 HTML 而非 CSS 文件）。
for (const dom of SHADOW_DOMAINS) {
  let cssAgg = "";
  for (const f of dom.css) {
    const t = readSafe(f);
    if (t) cssAgg += "\n" + t;
  }
  const kf = extractKeyframes(cssAgg);
  for (const f of dom.html) {
    const t = readSafe(f);
    if (!t) continue;
    const refs = extractAnimationRefs(t); // 复用：内联 style 的 animation: 同语法
    for (const r of refs) {
      if (!kf.has(r)) {
        errorCount++;
        problems.push(`[ERROR] ${dom.name}: tpl ${path.basename(f)} 内联 style 引用 @keyframes '${r}' 但在本 shadow 层无定义（跨 shadow keyframe 静默失效）`);
      }
    }
  }
}

// ── 检查 2：反向断言 components.css 不含已回迁 shadow 的类 ──
const compCss = readSafe(DOCUMENT_LAYER_FILE) || "";
for (const forbidden of [/\.stg-[a-z-]+/, /\.tab-body\b/]) {
  const re = new RegExp(forbidden.source, "g");
  if (re.test(compCss)) {
    errorCount++;
    problems.push(`[ERROR] ${DOCUMENT_LAYER_FILE} 仍含已回迁 shadow 的类（${forbidden}）—— 全局副本是漂移源，应仅在 shadow 层定义`);
  }
}

// ── 检查 3（WARN）：本域专属前缀的类是否在 shadow 层有定义 ──
for (const dom of SHADOW_DOMAINS) {
  let cssAgg = "";
  for (const f of dom.css) {
    const t = readSafe(f);
    if (t) cssAgg += "\n" + t;
  }
  const cssClasses = extractClasses(cssAgg);
  const prefixes = DOMAIN_PREFIXES[dom.name] || [];
  for (const f of dom.html) {
    const t = readSafe(f);
    if (!t) continue;
    const used = extractHtmlClasses(t);
    for (const c of used) {
      const isOwnPrefix = prefixes.some((p) => c === p || c.startsWith(p));
      if (isOwnPrefix && !cssClasses.has(c)) {
        warnCount++;
        problems.push(`[WARN] ${dom.name}: tpl ${path.basename(f)} 使用本域专属类 '${c}' 但在本 shadow 层无定义（疑似漏迁/误归全局，需人工确认）`);
      }
    }
  }
}

// ── 输出 ──
if (problems.length === 0) {
  console.log("[css-layer-check] ✅ 无 shadow 样式越界（keyframe 本地化 + 类归属正确）");
  process.exit(0);
}
console.log("[css-layer-check] 发现 " + errorCount + " 个 ERROR / " + warnCount + " 个 WARN：");
for (const p of problems) console.log("  " + p);
if (STRICT && errorCount > 0) {
  console.log("[css-layer-check] --strict: ERROR 阻断（pre-push 门禁）");
  process.exit(1);
}
process.exit(0);
