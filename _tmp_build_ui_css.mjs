// 一次性脚本：构建 🥉 组件库自包含 CSS（TS 字符串模块）。
// - MikuMikuAR 专属 token 统一加 --uih- 命名空间（零碰撞）
// - 撞色 token（--text/--text-dim/--text-bright/--text-muted/--danger/--danger-hover）映射为 ysm 等价
// - rgba(var(--accent-rgb), a) → color-mix(in srgb, var(--accent) a%, transparent)
// 产物：frontend/src/ui/ui-components-styles.ts
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const APP_CSS = "C:/Users/zhujieling11/MikuMikuAR/frontend/src/app.css";
const PICKED = "C:/Users/zhujieling11/ysm-model-manager/_tmp_ui_components_raw.css";
const OUT = "C:/Users/zhujieling11/ysm-model-manager/frontend/src/ui/ui-components-styles.ts";

const TARGETS = [
  "toggle-row","toggle-left","cs-icon","cs-icon-fallback","toggle-label","toggle",
  "slider","cs-row","cs-top","cs-label","cs-value","cs-fill","cs-thumb","cs-bar",
  "type-row","type-label","mode-btn","slide-item","slide-item-muted","slide-focused",
  "slide-icon","slide-label","slide-sublabel","slide-sublabel-inline","slide-arrow",
  "danger-text","accent-text","wrap-2","slide-add-btn","slide-act-danger","slide-lead-btn",
  "collapsible-wrapper","collapsible-header","collapsible-mat","collapsible-icon",
  "collapsible-label","collapsible-arrow","collapsible-panel","mat-slider-panel",
  "mat-cat-slider","collapsible-inner","section-title","open",
  "clr-block","clr-header","clr-title","clr-swatch","clr-row","clr-channel","clr-value",
  "vec3-block","vec3-header","vec3-title","vec3-row","vec3-axis","vec3-value",
  "card-title","info-grid","info-card","info-card--wide","info-card-label",
  "info-card-value","info-card-sub","field-row","field-label","field-value",
  "bone-select-row","cs-label-sm","full-input","setting-select",
  "preset-group","preset-chip","active","danger","badge","cs-btn","cs-btn-sm",
  "render-card","lcard","header-toggle","toggle-disabled",
];

// ---- 1. 解析 app.css 全部 --token: val 定义（last wins） ----
const appCss = readFileSync(APP_CSS, "utf8");
const decls = new Map();
for (const m of appCss.matchAll(/\s(--[a-zA-Z0-9_-]+)\s*:\s*([^;{}]+);/g)) {
  decls.set(m[1].slice(2), m[2].trim());
}

// ---- 2. 切分 picked 规则 ----
const picked = readFileSync(PICKED, "utf8");
let depth = 0, buf = "", rules = [];
for (const ch of picked) {
  buf += ch;
  if (ch === "{") depth++;
  else if (ch === "}") { depth--; if (depth === 0) { rules.push(buf.trim()); buf = ""; } }
}
if (buf.trim()) rules.push(buf.trim());

// ---- 3. 收集 usedTokens ----
const usedTokens = new Set();
const varRe = /var\(--([a-zA-Z0-9_-]+)\)/g;
for (const r of rules) { let m; while ((m = varRe.exec(r))) usedTokens.add(m[1]); }

const keepList = ["accent","txt","muted","status-success","status-error","bg","surf","card","hover","act","bd","menu-indicator"];
const colorRewrite = {
  "text": "txt", "text-dim": "muted", "text-bright": "txt", "text-muted": "muted",
  "danger": "status-error", "danger-hover": "status-error",
};

function rewriteVars(text) {
  // rgba(var(--accent-rgb), a) → color-mix
  text = text.replace(/rgba\(\s*var\(--accent-rgb\)\s*,\s*([0-9.]+)\s*\)/g,
    (_m, a) => `color-mix(in srgb, var(--accent) ${Math.round(parseFloat(a) * 100)}%, transparent)`);
  // 其余 var(--X)
  text = text.replace(varRe, (m, name) => {
    if (name in colorRewrite) return `var(--${colorRewrite[name]})`;
    if (name === "accent-rgb") return "var(--accent)";
    if (keepList.includes(name)) return m;
    return `var(--uih-${name})`;
  });
  return text;
}

// ---- 4. 构建 token 层（仅 usedTokens 中、非撞色、非 accent/accent-rgb） ----
const layerLines = [];
for (const t of usedTokens) {
  if (t in colorRewrite) continue;       // 映射为 ysm，不入层
  if (t === "accent" || t === "accent-rgb") continue;
  const val = decls.get(t);
  if (val === undefined) { console.warn("  [warn] token --" + t + " 无定义，跳过"); continue; }
  layerLines.push(`  --uih-${t}: ${rewriteVars(val)};`);
}

// ---- 5. 重写 picked 规则 ----
const outRules = rules.map((r) => rewriteVars(r));

// 加载遮罩（withLoadingIndicator 自包含覆盖层）样式
const LOADING_CSS = `
/* 加载遮罩（withLoadingIndicator 自包含覆盖层） */
.loading-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--bg, #11111b) 55%, transparent);
  opacity: 0;
  transition: opacity 0.18s ease;
  pointer-events: none;
}
.loading-overlay.visible { opacity: 1; }
.loading-overlay-text {
  padding: 10px 18px;
  border-radius: var(--r, 8px);
  background: var(--card, #24243e);
  color: var(--txt, #e0d5f5);
  border: 1px solid var(--bd, transparent);
  font-size: 13px;
}
`;
outRules.push(LOADING_CSS.trim());

const css =
`/* ===== 🥉 ui-helpers 组件库样式（自 MikuMikuAR app.css 迁移，ADR 去桶化配套） ===== */
/* 专用 token 加 --uih- 命名空间以防与 ysm 全局主题冲突；撞色 token 已映射为 ysm 等价变量。 */
:root {
${layerLines.join("\n")}
}

` + outRules.join("\n\n") + "\n";

const ts =
`// 自动生成：🥉 ui-helpers 组件库样式（MikuMikuAR app.css 迁移）。
// 消费方式：
//  - Shadow DOM 组件：root.adoptedStyleSheets = [uiComponentsStyleSheet, ...others];
//  - 全局/light-DOM：installUiComponentsStyles() 会把样式注入 document.head 一次。
// 注意：请勿手动编辑本文件字符串；改样式请改 MikuMikuAR 源后重跑迁移脚本。

export const uiComponentsCss = ${JSON.stringify(css)};

const _sheet = new CSSStyleSheet();
try {
  _sheet.replaceSync(uiComponentsCss);
} catch (e) {
  console.error("[ui-components] CSS 解析失败", e);
}
export const uiComponentsStyleSheet = _sheet;

let _installed = false;
/** 将组件样式注入 document.head（全局/light-DOM 场景）。幂等，仅注入一次。 */
export function installUiComponentsStyles(doc: Document = document): void {
  if (_installed) return;
  const st = doc.createElement("style");
  st.setAttribute("data-ui-helpers", "");
  st.textContent = uiComponentsCss;
  doc.head.appendChild(st);
  _installed = true;
}
`;

mkdirSync("C:/Users/zhujieling11/ysm-model-manager/frontend/src/ui", { recursive: true });
writeFileSync(OUT, ts, "utf8");
console.log("usedTokens:", usedTokens.size, "layerLines:", layerLines.length, "rules:", rules.length);
console.log("out bytes:", css.length, "ts bytes:", ts.length);
