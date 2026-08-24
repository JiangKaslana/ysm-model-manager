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

// app-content 的 html 源：全目录 walk（不再维护任何「模式清单 / 逻辑白名单」——
// 手写清单是第二批漂移事实源，见评审 2026-08-24 第 2 条）。
// 规则：递归遍历 frontend/src/views/app-content/ + app-sync-manager/tpl.ts（内嵌 shadow 子树），
// 仅排除 content-*.ts（CSS 源已单列在 css 数组，避免自我断言）与 *.test.ts（测试不渲染生产 DOM）。
// 其余 .ts（含 index.ts / diagnostics/* / settings/* / site/* / init-*.ts 等）一律纳入——
// 纯逻辑文件不含 class="..." 模板字符串，提取时零命中，不贡献噪声；渲染模板文件自动覆盖。
// 逼出的 WARN 逐个审：真该有样式的补 CSS，纯 JS 锚点进 KNOWN_NO_CSS_CLASSES（见下方）。
function walkDir(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkDir(full));
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".ts") &&
      !entry.name.startsWith("content-") &&
      !entry.name.endsWith(".test.ts")
    ) {
      out.push(full);
    }
  }
  return out;
}
function collectAppContentHtml() {
  const base = path.resolve(ROOT, "frontend/src/views/app-content");
  const files = walkDir(base);
  const smTpl = path.resolve(ROOT, "frontend/src/views/app-sync-manager/tpl.ts");
  if (fs.existsSync(smTpl)) files.push(smTpl);
  return files.map((p) => path.relative(ROOT, p).split(path.sep).join("/"));
}

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
    // html 源由 collectAppContentHtml() 递归聚合（见上方说明），不再手写清单。
    html: collectAppContentHtml(),
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

// 已知「仅作 JS 钩子/容器锚点、样式全靠内联 style= 写死、无独立 shadow CSS 规则」的类。
// 这些类带本域专属前缀但刻意无 CSS 定义，属合法状态位，非漏迁。
// 未来若真要给它们加 shadow CSS 规则，从此集移除即会触发 WARN，倒逼复核（评审 2026-08-24 第 2 条）。
// 已知「仅作 JS 钩子/容器锚点、样式全靠内联 style= 写死、无独立 shadow CSS 规则」的类。
// 这些类带本域专属前缀但刻意无 CSS 定义，属合法状态位，非漏迁。
// 未来若真要给它们加 shadow CSS 规则，从此集移除即会触发 WARN，倒逼复核（评审 2026-08-24 第 2 条）。
// 分类依据（walk 全目录后逐一审）：
//   gh-repo-card   — 与 .gh-card 同用（class="gh-card gh-repo-card"），冗余修饰钩子，gh-card 已有定义
//   ws-name/ws-desc — init-github.ts 内联 style 写死字号（11px/9px），纯锚点
//   cr-avatar-fallback — 与 .cr-avatar 同用，子修饰钩子
//   cr-input-name/cr-order-up/cr-order-down/cr-del/cr-add/cr-del-preset — 与 .cr-input/.cr-btn-icon 等基础类组合，纯 JS 点击锚点
const KNOWN_NO_CSS_CLASSES = new Set([
  "recy-page", "repo-left", "diag-log-filter", "ws-creators-list", "ws-browser-bar", "ws-url",
  "gh-repo-card", "ws-name", "ws-desc",
  "cr-avatar-fallback", "cr-input-name", "cr-order-up", "cr-order-down", "cr-del", "cr-add", "cr-del-preset",
]);

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
  "app-content": ["stg-", "repo-", "cr-", "gh-", "ws-", "diag-", "recy-", "rm-", "set-", "settings-", "page", "section-title", "stat-card", "placeholder-box", "ptag"],
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

// 提取某 @keyframes 内 `from` 块的 translate 参数（如 "translateY(6px)"）。
// 兼容多行（components.css）与单行（shadow 侧）写法；忽略空格/分号差异，只比对参数值。
// 返回 null 表示未找到该 keyframe 或 from 无 translate。
function extractKeyframeTranslate(cssText, name) {
  const re = new RegExp(
    "@keyframes\\s+" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{",
    "g",
  );
  let m;
  while ((m = re.exec(cssText)) !== null) {
    // 取从 { 到下一个顶级 } 的区间（keyframe 体）
    const start = m.index + m[0].length;
    let depth = 1;
    let i = start;
    for (; i < cssText.length; i++) {
      if (cssText[i] === "{") depth++;
      else if (cssText[i] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    const body = cssText.slice(start, i);
    // 在 from 块内找 translate
    const fromMatch = body.match(/from\s*\{[^}]*\}/);
    if (!fromMatch) continue;
    const tr = fromMatch[0].match(/transform\s*:\s*translate[XY]\s*\(([^)]+)\)/);
    if (tr) return tr[1].replace(/\s+/g, "");
  }
  return null;
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

// ── 检查 1c：本地化 keyframe 参数一致性（铁律硬校验） ──
// 评审 2026-08-24 第 2 条：仅注释/知识卡里的"逐字节契约"仍靠人脑，本次漂移（6→10/-4→-10/-8→-14）
// 正是从这条逃逸路径溜过 pre-push。故从 components.css（全局副本）与 shadow 侧
// （content-layout.ts / sidebar-css.ts）正则提取 fadeSlideUp/Down/Left 的 from translate 参数值，
// 对不上即 ERROR。比较参数值（忽略空格/分号/多行差异），不要求字节级一致。
const KF_PARAM_NAMES = ["fadeSlideUp", "fadeSlideDown", "fadeSlideLeft"];
const compCssText = readSafe(DOCUMENT_LAYER_FILE) || "";
// shadow 侧 keyframe 来源：app-content(content-layout) + sidebar(sidebar-css)
const shadowKfSources = [
  "frontend/src/views/app-content/content-layout.ts",
  "frontend/src/views/app-sidebar/sidebar-css.ts",
];
let shadowKfAgg = "";
for (const f of shadowKfSources) {
  const t = readSafe(f);
  if (t) shadowKfAgg += "\n" + t;
}
for (const name of KF_PARAM_NAMES) {
  const globalVal = extractKeyframeTranslate(compCssText, name);
  const shadowVal = extractKeyframeTranslate(shadowKfAgg, name);
  if (globalVal === null || shadowVal === null) {
    // 任一侧缺失定义：检查 1 已覆盖 shadow 侧缺失；此处仅补全局侧缺失提示
    if (globalVal === null) {
      errorCount++;
      problems.push(`[ERROR] ${DOCUMENT_LAYER_FILE} 缺失 @keyframes '${name}' 的 from translate（本地化契约基准丢失）`);
    }
    continue;
  }
  if (globalVal !== shadowVal) {
    errorCount++;
    problems.push(`[ERROR] 本地化 keyframe 契约违例：'${name}' from translate 全局=${globalVal} / shadow=${shadowVal} 不一致（components.css 与 shadow 侧须参数值一致，见评审 2026-08-24 第 2 条）`);
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
for (const forbidden of [/\.stg-[a-z-]+/, /\.tab-body\b/, /\.settings-group\b/, /\.setting-row\b/]) {
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
      if (isOwnPrefix && !cssClasses.has(c) && !KNOWN_NO_CSS_CLASSES.has(c)) {
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
