// ===== 主题与界面偏好 =====
export const TLABEL = {
  cyber: "🌙 赛博霓虹",
  warm: "☀️ 温暖木纹",
  pro: "⚪ 极简深邃",
  system: "💻 跟随系统",
};
export const TMODES = ["cyber", "warm", "pro", "system"];
export const DEFAULT_THEME = "system";

export function normalizeTheme(mode) {
  return TMODES.includes(mode) ? mode : DEFAULT_THEME;
}

export function applyTheme(mode) {
  const theme = normalizeTheme(mode);
  document.body.classList.remove("theme-cyber", "theme-warm", "theme-pro");
  if (theme === "system") {
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)",
    ).matches;
    document.body.classList.add(prefersDark ? "theme-cyber" : "theme-warm");
  } else {
    document.body.classList.add("theme-" + theme);
  }
  window.applyTheme = applyTheme;
  return theme;
}

export async function initTheme() {
  let theme = localStorage.getItem("theme") || DEFAULT_THEME;
  try {
    const { LoadAppConfig } = await import("../../wailsjs/go/main/App.js");
    const cfg = await LoadAppConfig();
    theme = localStorage.getItem("theme") || cfg.theme || cfg.Theme || theme;
  } catch (_) {}
  theme = applyTheme(theme);
  localStorage.setItem("theme", theme);
  updateThemeButton(theme);
  return theme;
}

export function applyUIPrefs(options = {}) {
  const fontSize = localStorage.getItem("ui-font-size") || "normal";
  const displayFont = localStorage.getItem("ui-display-font") || "kaiti";
  const density = localStorage.getItem("ui-card-density") || "compact";
  const anim = localStorage.getItem("ui-animations") !== "off";

  [
    "--fs-base",
    "--fs-xs",
    "--fs-sm",
    "--fs-md",
    "--fs-lg",
    "--fs-tiny",
    "--fs-xl",
  ].forEach((v) => document.documentElement.style.removeProperty(v));

  const scaleMap = { small: "-1px", normal: "0px", large: "2px" };
  document.documentElement.style.setProperty(
    "--fs-scale",
    scaleMap[fontSize] || "0px",
  );
  document.documentElement.style.setProperty("--fs-base-size", "12px");
  document.documentElement.style.setProperty(
    "--font-display",
    displayFont === "system"
      ? "var(--font-ui)"
      : "'STKaiti','KaiTi','楷体',serif",
  );
  document.documentElement.style.setProperty(
    "--card-padding",
    density === "compact" ? "6px 10px" : "10px 14px",
  );
  document.documentElement.style.setProperty(
    "--card-gap",
    density === "compact" ? "6px" : "10px",
  );
  document.documentElement.classList.toggle("no-animations", !anim);
  options.afterApply?.();
}

export function updateThemeButton(theme = localStorage.getItem("theme")) {
  const btn = document.getElementById("btn-theme");
  if (btn) btn.textContent = TLABEL[normalizeTheme(theme)] || TLABEL.system;
}

// 延迟到 DOM 就绪后获取按钮
export function bindThemeBtn() {
  const themeBtn = document.getElementById("btn-theme");
  if (!themeBtn) {
    setTimeout(bindThemeBtn, 100);
    return;
  }
  themeBtn.addEventListener("click", () => {
    const cur = normalizeTheme(localStorage.getItem("theme") || DEFAULT_THEME);
    const next = TMODES[(TMODES.indexOf(cur) + 1) % TMODES.length];
    applyTheme(next);
    localStorage.setItem("theme", next);
    updateThemeButton(next);
  });
}

export function watchSystemTheme() {
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => {
      const theme = localStorage.getItem("theme") || DEFAULT_THEME;
      if (theme === "system") applyTheme("system");
    });
}

window.applyTheme = applyTheme;
window.applyUIPrefs = applyUIPrefs;
