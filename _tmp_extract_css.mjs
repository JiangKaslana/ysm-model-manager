// 一次性脚本：从 MikuMikuAR app.css 抽取 🥉 组件库所用到的类规则。
import { readFileSync, writeFileSync } from "node:fs";

const SRC = "C:/Users/zhujieling11/MikuMikuAR/frontend/src/app.css";
const OUT = "C:/Users/zhujieling11/ysm-model-manager/_tmp_ui_components_raw.css";

const TARGETS = [
  "toggle-row", "toggle-left", "cs-icon", "cs-icon-fallback", "toggle-label", "toggle",
  "slider", "cs-row", "cs-top", "cs-label", "cs-value", "cs-fill", "cs-thumb", "cs-bar",
  "type-row", "type-label", "mode-btn", "slide-item", "slide-item-muted", "slide-focused",
  "slide-icon", "slide-label", "slide-sublabel", "slide-sublabel-inline", "slide-arrow",
  "danger-text", "accent-text", "wrap-2", "slide-add-btn", "slide-act-danger", "slide-lead-btn",
  "collapsible-wrapper", "collapsible-header", "collapsible-mat", "collapsible-icon",
  "collapsible-label", "collapsible-arrow", "collapsible-panel", "mat-slider-panel",
  "mat-cat-slider", "collapsible-inner", "section-title", "open",
  "clr-block", "clr-header", "clr-title", "clr-swatch", "clr-row", "clr-channel", "clr-value",
  "vec3-block", "vec3-header", "vec3-title", "vec3-row", "vec3-axis", "vec3-value",
  "card-title", "info-grid", "info-card", "info-card--wide", "info-card-label",
  "info-card-value", "info-card-sub", "field-row", "field-label", "field-value",
  "bone-select-row", "cs-label-sm", "full-input", "setting-select",
  "preset-group", "preset-chip", "active", "danger", "badge", "cs-btn", "cs-btn-sm",
  "render-card", "lcard", "header-toggle", "toggle-disabled",
];

const css = readFileSync(SRC, "utf8");
let depth = 0;
let buf = "";
const rules = [];
for (const ch of css) {
  buf += ch;
  if (ch === "{") depth++;
  else if (ch === "}") {
    depth--;
    if (depth === 0) {
      rules.push(buf.trim());
      buf = "";
    }
  }
}
if (buf.trim()) rules.push(buf.trim());

function ruleHasTarget(rule) {
  const idx = rule.indexOf("{");
  if (idx < 0) return false;
  const sel = rule.slice(0, idx);
  for (const t of TARGETS) {
    const re = new RegExp("(?:^|[^\\w-])\\." + t + "(?:[\\s.,:>{~+>]|$)");
    if (re.test(sel)) return true;
  }
  return false;
}

const picked = rules.filter(ruleHasTarget);
writeFileSync(OUT, picked.join("\n\n") + "\n", "utf8");
console.log("total rules:", rules.length, "picked:", picked.length);
console.log("picked bytes:", picked.join("\n").length);
