// ===== 🥉 slide-menu 外壳构建器（ADR 去桶化配套）=====
// 复刻 MikuMikuAR 的 slide-menu 卡片外壳（menu-wrapper/slide-viewport/slide-panel/slide-list/slide-header），
// 但不搬其菜单导航引擎（registry/schema/stack 等业务层）。外壳仅提供「卡片视觉 + 标题栏 + 关闭」，
// 内容由调用方经 handle.list 注入（通常填 🥉 行组件：slideRow/addCollapsible/addSectionTitle…）。
//
// 解耦要点：
//  - 关闭按钮用字面量 glyph（✕），不依赖 iconify 运行时；
//  - 外壳恒含 🥉 行组件，故安装外壳样式时一并安装 ui-components 样式；
//  - 零业务依赖，可被任意预览/面板复用。

import { installUiComponentsStyles } from "./ui-components-styles.ts";
import { installSlideMenuStyles } from "./ui-slide-menu-styles.ts";

export interface SlideMenuHandle {
  /** 卡片根（.menu-wrapper.slide-menu），挂到定位容器即可 */
  root: HTMLElement;
  /** 内容挂载点（.slide-list.render-card），调用方在此填 🥉 行组件 */
  list: HTMLElement;
  /** 设置标题栏文字 */
  setTitle(title: string): void;
  /** 注册关闭回调（关闭按钮点击 / 回车 / 空格触发） */
  setOnClose(fn: () => void): void;
  /** 移除整个外壳 */
  dispose(): void;
}

/** 构建 slide-menu 卡片外壳。 */
export function createSlideMenu(opts?: { title?: string; closeIcon?: string }): SlideMenuHandle {
  installSlideMenuStyles();
  installUiComponentsStyles();

  const root = document.createElement("div");
  root.className = "menu-wrapper slide-menu";
  root.tabIndex = -1;

  const viewport = document.createElement("div");
  viewport.className = "slide-viewport";

  const header = document.createElement("div");
  header.className = "slide-header";

  const back = document.createElement("span");
  back.className = "slide-back";
  back.setAttribute("role", "button");
  back.tabIndex = 0;
  back.textContent = opts?.closeIcon ?? "✕";
  back.title = "关闭";

  const title = document.createElement("span");
  title.className = "slide-title";
  title.textContent = opts?.title ?? "";

  header.appendChild(back);
  header.appendChild(title);

  const panel = document.createElement("div");
  panel.className = "slide-panel";

  const list = document.createElement("div");
  list.className = "slide-list render-card";

  panel.appendChild(list);
  viewport.appendChild(header);
  viewport.appendChild(panel);
  root.appendChild(viewport);

  let onClose: (() => void) | undefined;
  const fireClose = (): void => onClose?.();
  back.onclick = fireClose;
  back.onkeydown = (e: KeyboardEvent): void => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fireClose();
    }
  };

  return {
    root,
    list,
    setTitle: (t: string): void => {
      title.textContent = t;
    },
    setOnClose: (fn: () => void): void => {
      onClose = fn;
    },
    dispose: (): void => {
      root.remove();
    },
  };
}
