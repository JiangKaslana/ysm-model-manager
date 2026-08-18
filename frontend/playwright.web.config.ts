// ===== Playwright Web 版 E2E 配置（ADR-049 Phase 3）=====
// 与 playwright.config.ts（桌面 mock 模式，端口 5173）隔离：
// vite dev --mode web → import.meta.env.MODE="web" → browserAdapter 真链路
// （IndexedDB 模型库，零 Wails 壳依赖）。跑法：
//   npx playwright test --config playwright.web.config.ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e-web",
  timeout: 20000,
  globalTimeout: 3 * 60 * 1000,
  maxFailures: 2,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5199",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    locale: "en-US",
  },
  webServer: {
    command: "npx vite --mode web --port 5199 --host 127.0.0.1",
    url: "http://localhost:5199",
    reuseExistingServer: !process.env.CI,
    cwd: ".",
    timeout: 30000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
