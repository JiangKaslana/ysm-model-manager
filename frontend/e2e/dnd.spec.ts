// ===== E2E 测试：拖拽导入（DnD，ADR-037 动机之一）=====
// jsdom 无法模拟 DragEvent/DataTransfer（ADR-037 引入 e2e 的理由），
// 这里在真实浏览器构造 DataTransfer + File，走 document 级 dragenter/drop
// 全局监听（import-dnd.ts），断言：
//   1. dragenter 文件 → 拖拽遮罩 #global-drop-overlay 出现
//   2. drop → 遮罩收起 + 导入链路触发（mock ImportModelFile 被调）
//   3. 非文件 dataTransfer → 遮罩不出现
//
// 注意（Chromium 陷阱）：`new DragEvent(type, { dataTransfer })` 构造器会忽略
// dataTransfer（只读属性，构造后为 null）→ onDragEnter 的 types 检查失败、
// onDrop 读到空 files 发 noSupportedFiles 误报。必须用 Object.defineProperty
// 强制注入 dataTransfer（业界标准绕过只读属性的方案）。
import { test, expect, type Page } from "./fixture.ts";
import { gotoApp } from "./helpers.ts";

/** 在页面构造 DataTransfer + File，dispatch 拖拽三事件（dataTransfer 强制注入） */
async function dispatchFileDrag(page: Page, fileName: string, dragenterOnly = false): Promise<void> {
  await page.evaluate(
    async ({ name, only }) => {
      const dt = new DataTransfer();
      dt.items.add(new File(["e2e-content"], name, { type: "" }));
      const fire = (type: string): void => {
        const ev = new DragEvent(type, { bubbles: true, cancelable: true });
        // Chromium 构造器忽略 dataTransfer → 只读属性强制注入
        Object.defineProperty(ev, "dataTransfer", {
          value: dt,
          configurable: true,
        });
        document.dispatchEvent(ev);
      };
      fire("dragenter");
      if (only) return;
      fire("drop");
      fire("dragend");
    },
    { name: fileName, only: dragenterOnly },
  );
}

/** 查询全局拖拽遮罩是否可见（穿透 body 级元素） */
async function isDropOverlayVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const el = document.getElementById("global-drop-overlay");
    return Boolean(el && el.style.display !== "none");
  });
}

test.describe("拖拽导入（DnD）", () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
  });

  test("仓库页 dragenter 文件 → 拖拽遮罩出现", async ({ page }) => {
    // P1 修复（子代理审计）：原实现 `new DragEvent("dragenter", { dataTransfer: dt })`
    // 未用 Object.defineProperty 注入——Chromium 构造器忽略 dataTransfer（只读属性，
    // 构造后为 null，见本文件头注释），onDragEnter 的 types 检查失败 → 遮罩不出现，
    // 用例确定性失败或随浏览器版本时好时坏。统一走 dispatchFileDrag 的注入路径。
    await dispatchFileDrag(page, "a.ysm", true);
    expect(await isDropOverlayVisible(page)).toBe(true);
  });

  test("drop 文件 → 遮罩收起 + toast 反馈", async ({ page }) => {
    await dispatchFileDrag(page, "model-a.ysm");
    // drop 后遮罩应隐藏（hideDropOverlay + dragend 兜底）
    expect(await isDropOverlayVisible(page)).toBe(false);
    // 导入链路触发 → toast 反馈：directImport 成功 toast 含文件名
    // （原「任一 toast 可见」会被 index.html 欢迎 toast 假绿）
    const toast = page
      .locator('[data-testid="toast"]')
      .filter({ hasText: "model-a.ysm" });
    await expect(toast.first()).toBeVisible({ timeout: 5000 });
  });

  test("无文件 dataTransfer → 遮罩不出现", async ({ page }) => {
    await page.evaluate(() => {
      const dt = new DataTransfer(); // 无 items
      const ev = new DragEvent("dragenter", { bubbles: true, cancelable: true });
      Object.defineProperty(ev, "dataTransfer", { value: dt, configurable: true });
      document.dispatchEvent(ev);
    });
    expect(await isDropOverlayVisible(page)).toBe(false);
  });
});
