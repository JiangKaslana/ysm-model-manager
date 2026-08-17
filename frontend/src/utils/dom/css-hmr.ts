// ===== CSS Shadow Sheet HMR 热刷新（治理：消除 CSS 动态 import 的 as any 模板重复）=====
// 四个视图组件（sidebar / tree / content / preview）各自的 CSS HMR accept 回调
// 模式完全同构（new CSSStyleSheet → replaceSync → adoptedStyleSheets），
// 此前每处都写一遍，且因 Vite 无 .css.ts 的类型声明不得不 (newCssMod as any).xxxCSS。
// 本文件把模板收敛到一个函数，让 HMR 闭包内只需一行调用。

/**
 * 热刷指定自定义元素的 Shadow DOM 样式表。
 * @param cssText   新 CSS 文本（来自 CSS 模块的导出值），undefined 时跳过
 * @param selector  目标元素选择器，如 "app-sidebar"
 * @note 调用侧用 `newCssMod?.xxxCSS` 防御 undefined（Vite HMR 可能传 undefined）
 */
export function refreshAdoptedStyleSheets(cssText: string | undefined, selector: string): void {
  if (cssText === undefined) return;
  const style = new CSSStyleSheet();
  style.replaceSync(cssText);
  document.querySelectorAll(selector).forEach((el) => {
    const root = (el as Element).shadowRoot;
    if (root) root.adoptedStyleSheets = [style];
  });
}
