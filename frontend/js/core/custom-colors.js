const LS_KEY = "ui-custom-colors";

export const COLOR_VARS = {
  accent: ["--accent", "--menu-indicator", "--meta-author"],
  bg: ["--bg"],
  surf: ["--surf"],
  card: ["--card", "--hover"],
};

export const ACCENT_PRESETS = [
  "#66d9ef",
  "#89b4fa",
  "#bd93f9",
  "#f38ba8",
  "#a6e3a1",
  "#f9a826",
  "#f1fa8c",
  "#8b4513",
];

export function loadCustomColors() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY)) || {};
  } catch {
    return {};
  }
}

export function saveCustomColors(obj) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(obj || {}));
  } catch {}
}

export function applyCustomColors(colors = loadCustomColors()) {
  const body = document.body;
  if (!body) return;
  Object.values(COLOR_VARS)
    .flat()
    .forEach((v) => body.style.removeProperty(v));
  for (const [key, val] of Object.entries(colors)) {
    if (!val) continue;
    const vars = COLOR_VARS[key];
    if (!vars) continue;
    vars.forEach((v) => body.style.setProperty(v, val));
  }
}

export function setColor(key, val) {
  if (!COLOR_VARS[key]) return;
  const colors = loadCustomColors();
  if (val) colors[key] = val;
  else delete colors[key];
  saveCustomColors(colors);
  applyCustomColors(colors);
}

export function resetCustomColors() {
  saveCustomColors({});
  applyCustomColors({});
}

export function currentColor(key) {
  const saved = loadCustomColors()[key];
  if (saved) return toHex(saved);
  const probe = COLOR_VARS[key]?.[0] || "--accent";
  const raw = getComputedStyle(document.body).getPropertyValue(probe).trim();
  return toHex(raw) || "#66d9ef";
}

export function toHex(color) {
  if (!color) return "";
  const c = color.trim();
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(c)) {
    return (
      "#" +
      c
        .slice(1)
        .split("")
        .map((x) => x + x)
        .join("")
        .toLowerCase()
    );
  }
  const m = c.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (m) {
    const h = (n) =>
      Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, "0");
    return ("#" + h(m[1]) + h(m[2]) + h(m[3])).toLowerCase();
  }
  return "";
}
