// ===== E2E 测试：文件树展开/折叠 + 资源类型切换（ADR-037）=====
// 验证文件树的交互路径：展开目录、切换资源类型子标签。
// 断言基于 data-testid 稳定钩子（Design.md §19.1）。
// 注意：tree-file/tree-dir 在 app-content → app-tree 两层 Shadow DOM 内，
// 穿透查询复用 e2e/helpers.ts（子代理审核 P4：消除重复实现）。
import { test, expect } from "./fixture.ts";
import { countInTree, waitForTreeCount, gotoApp, getTreeBox } from "./helpers.ts";

test.describe("文件树交互", () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
  });

  test("树渲染硬性冒烟（不 skip，防 mock 链路回归被 skip 掩蔽）", async ({ page }) => {
    // 子代理审计 P2：file-tree/context-menu/resource-manager 多处「tree-file 未渲染则
    // test.skip」——若 mock/加载链路回归（如 IsFileBanned 缺失事件），整套树相关测试
    // 全部 skip 仍绿。此处硬断言 tree-file 必须渲染：回归时此测试红，不让 skip 掩盖。
    const fileCount = await waitForTreeCount(page, "tree-file", 10000);
    expect(fileCount).toBeGreaterThan(0);
  });

  test("点击资源类型子标签 → 切换类型", async ({ page }) => {
    const subtabs = page.locator('[data-testid="content-subtab"]');
    await expect(subtabs.first()).toBeVisible({ timeout: 5000 });
    const count = await subtabs.count();
    expect(count).toBeGreaterThanOrEqual(3);
    await subtabs.nth(1).click();
    // 弱断言改实断言：点击后该标签应有 active 高亮（切换生效）
    await expect(subtabs.nth(1)).toHaveClass(/active/, { timeout: 3000 });
  });

  test("文件树目录展开/折叠", async ({ page }) => {
    // P3 修复（审核）：原 `countInTree` 一次性读——树未渲染完即得 0 → test.skip
    // 假绿（正是冒烟测试要防的 skip 掩盖路径）；改 waitForTreeCount 轮询
    const dirCount = await waitForTreeCount(page, "tree-dir");
    if (dirCount === 0) {
      test.skip("文件树目录元素未在 Shadow DOM 中渲染");
      return;
    }
    // 记录展开前 tree-file 计数（mock 含 subdir/subdir-model.ysm，展开后应增加）
    const before = await countInTree(page, "tree-file");
    // 通过 evaluate 找到 tree-dir 的坐标，点击展开
    const box = await getTreeBox(page, "tree-dir");
    await page.mouse.click(box.x, box.y);
    // 实断言（子代理审核 P3）：原 `afterCount > 0` 近乎恒真（点击后目录行必然
    // 仍在，无论展开是否生效）。改为断言展开后子文件行出现/计数增加——
    // mock 含嵌套条目 subdir/subdir-model.ysm，展开后 tree-file 应多出子行。
    await expect
      .poll(
        async () => (await countInTree(page, "tree-file")) > before,
        { timeout: 5000 },
      )
      .toBe(true);
  });

  test("文件树文件行存在", async ({ page }) => {
    const fileCount = await waitForTreeCount(page, "tree-file");
    // 有文件行即通过
    expect(fileCount).toBeGreaterThan(0);
  });

  test("文件树目录切换按钮存在", async ({ page }) => {
    // 原实现：toggleCount>0 才动作，末尾 expect(true) 恒真——toggle 缺失也绿
    // 改实断言：mock 已含 subdir 嵌套目录，tree-dir-toggle 必须渲染
    await page.waitForFunction(
      () => {
        const content = document.querySelector("app-content");
        const tree = content?.shadowRoot?.querySelector("app-tree");
        return Boolean(tree?.shadowRoot?.querySelector('[data-testid="tree-dir-toggle"]'));
      },
      undefined,
      { timeout: 10000, polling: 200 },
    );
    const toggleCount = await page.evaluate(() => {
      const content = document.querySelector("app-content")!;
      const tree = content.shadowRoot!.querySelector("app-tree")!;
      return tree.shadowRoot!.querySelectorAll('[data-testid="tree-dir-toggle"]').length;
    });
    expect(toggleCount).toBeGreaterThan(0);
  });
});