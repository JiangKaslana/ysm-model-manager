// ===== E2E 测试：资源管理器（app-resource-manager）（ADR-037）=====
// 验证资源管理器的列表渲染、详情面板、操作按钮。
// 组件通过 <app-resource-manager rtype="resourcepack"> 挂载。
// 使用 data-testid 稳定钩子定位（Design.md §19.1）。
import { test, expect } from "./fixture.ts";
import { gotoApp } from "./helpers.ts";

test.describe("资源管理器", () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
  });

  test("直接挂载 app-resource-manager → 渲染列表和操作按钮", async ({ page }) => {
    // 在页面中直接挂载 app-resource-manager 组件（独立于 app-content）
    await page.evaluate(() => {
      const el = document.createElement("app-resource-manager");
      el.setAttribute("rtype", "resourcepack");
      document.body.appendChild(el);
    });
    // 轮询等待列表渲染（原 waitForTimeout(2000) 硬编码，慢环境易脆；改轮询）
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="rm-item"]').length >= 2,
      undefined,
      { timeout: 10000, polling: 200 },
    );
    // 检查操作按钮（rm-import, rm-open）
    const importBtn = page.locator('[data-testid="rm-import"]');
    const openBtn = page.locator('[data-testid="rm-open"]');
    await expect(importBtn.first()).toBeVisible({ timeout: 3000 });
    await expect(openBtn.first()).toBeVisible({ timeout: 3000 });
    // 列表项——mock-data 固定 2 个 pack（pack-a/pack-b）
    const items = page.locator('[data-testid="rm-item"]');
    const itemCount = await items.count();
    expect(itemCount).toBeGreaterThanOrEqual(2);
  });

  test("点击列表项 → 详情面板出现", async ({ page }) => {
    await page.evaluate(() => {
      const el = document.createElement("app-resource-manager");
      el.setAttribute("rtype", "resourcepack");
      document.body.appendChild(el);
    });
    // 轮询等待列表渲染（替代 waitForTimeout(2000)）
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="rm-item"]').length >= 2,
      undefined,
      { timeout: 10000, polling: 200 },
    );
    const items = page.locator('[data-testid="rm-item"]');
    const count = await items.count();
    if (count === 0) {
      test.skip("列表项未渲染");
      return;
    }
    // 点击第一个列表项
    await items.first().click();
    // 详情面板应出现（detailHTML 渲染 .rm-del-btn 操作按钮）
    const delBtn = page.locator(".rm-del-btn");
    await expect(delBtn.first()).toBeVisible({ timeout: 5000 });
  });
});