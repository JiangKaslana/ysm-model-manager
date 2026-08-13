// ===== E2E 测试：右键菜单触发与交互（ADR-037）=====
// 验证右键菜单的触发、显示和点击。
// 使用 data-testid 稳定钩子定位（Design.md §19.1）。
// 注意：tree-file 在 app-content → app-tree 两层 Shadow DOM 内，
// 穿透查询/坐标获取复用 e2e/helpers.ts（消除内联重复实现）。
// 文案定位说明（P3-8 子代理审计）：本文件断言「Copy File Path」等文案来自
// en.ts 的 menu.copyFilePath，调整文案需同步本 spec（文案定位较脆弱）。
import { test, expect } from "./fixture.ts";
import { gotoApp, waitForTreeCount, getTreeFileBox, rightClickTree } from "./helpers.ts";

/** 轮询等待 tree-file 在嵌套 Shadow DOM 中出现（复用 helpers 的 waitForTreeCount） */
async function waitForTreeFile(page: import("@playwright/test").Page, timeout = 8000): Promise<boolean> {
  return (await waitForTreeCount(page, "tree-file", timeout)) > 0;
}

test.describe("右键菜单", () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
  });

  test("页面加载 → 菜单组件已注册", async ({ page }) => {
    const ctxMenu = page.locator("context-menu");
    const ctxCount = await ctxMenu.count();
    // 弱断言改实断言：组件应恰好 1 个（静态存在于 DOM），防注册静默失效
    expect(ctxCount).toBe(1);
  });

  test("文件树文件上右键 → contextmenu 事件触发", async ({ page }) => {
    // 轮询等待 tree-file 渲染
    const hasTreeFile = await waitForTreeFile(page);
    if (!hasTreeFile) {
      test.skip("tree-file 未在 Shadow DOM 中渲染");
      return;
    }
    await rightClickTree(page, "tree-file");
    // 右键后菜单项应出现（原 expect(true).toBe(true) 恒真，itemCount 是死代码）
    const ctxItems = page.locator('[data-testid="ctx-item"]');
    const itemCount = await ctxItems.count();
    expect(itemCount).toBeGreaterThan(0);
  });

  test("右键菜单项可点击", async ({ page }) => {
    const hasTreeFile = await waitForTreeFile(page);
    if (!hasTreeFile) {
      test.skip("tree-file 未在 Shadow DOM 中渲染");
      return;
    }
    await rightClickTree(page, "tree-file");
    // 尝试点击菜单项
    const ctxItems = page.locator('[data-testid="ctx-item"]');
    const itemCount = await ctxItems.count();
    if (itemCount === 0) {
      test.skip("右键菜单未渲染菜单项");
      return;
    }
    await ctxItems.first().click();
    // 弱断言改实断言：点击后菜单应隐藏（onClick 的 finally 调 hide）
    await expect(ctxItems.first()).not.toBeVisible({ timeout: 3000 });
  });

  test("右键 → 点击「Copy File Path」→ action 执行 + toast 反馈", async ({ page }) => {
    const hasTreeFile = await waitForTreeFile(page);
    if (!hasTreeFile) {
      test.skip("tree-file 未在 Shadow DOM 中渲染");
      return;
    }
    await rightClickTree(page, "tree-file");

    // 定位菜单项：file.copy-path action（menu-defs.ts，e2e 环境为英文语言包）
    const copyItem = page
      .locator('[data-testid="ctx-item"]')
      .filter({ hasText: "Copy File Path" });
    const copyCount = await copyItem.count();
    if (copyCount === 0) {
      test.skip("右键菜单未渲染 Copy File Path 项");
      return;
    }
    await copyItem.click();
    // action 执行后 toast「路径已复制到剪贴板」（copy-path 成功/catch 兜底均触发，
    // 文案硬编码中文、语言无关；原「任一 toast 可见」会被 index.html 欢迎 toast 假绿）
    const toast = page
      .locator('[data-testid="toast"]')
      .filter({ hasText: "已复制到剪贴板" });
    await expect(toast.first()).toBeVisible({ timeout: 5000 });
    // 顺带断言菜单已隐藏（onClick finally 调 hide）
    await expect(page.locator('[data-testid="ctx-item"]').first()).not.toBeVisible({
      timeout: 3000,
    });
  });
});
