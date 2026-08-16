// ===== 🥉 slide-menu 外壳构建器（ADR 去桶化配套）=====
// 复刻 MikuMikuAR 的 slide-menu 卡片外壳（menu-wrapper/slide-viewport/slide-panel/slide-list/slide-header），
// 但不搬其菜单导航引擎（registry/schema/stack 等业务层）——而是在外壳层提供一组【轻量导航栈】能力
// （home/navigate/back/refresh/isShowing/reset/isAtRoot），供调用方以最小成本组织多级菜单
// （例如 YSM 的「模型信息 → 表情 / 切换模型」两级）。外壳仍是卡片视觉 + 标题栏 + 关闭/返回按钮，
// 内容由调用方经视图（SlideMenuView.render）注入，通常填 🥉 行组件：slideRow/addCollapsible/...。
//
// 解耦要点：
//  - 关闭/返回按钮用字面量 glyph（根级 ✕，子集 ←），不依赖 iconify 运行时；
//  - 外壳恒含 🥉 行组件，故安装外壳样式时一并安装 ui-components 样式；
//  - 零业务依赖，可被任意预览/面板复用；
//  - 向后兼容：不调用 home/navigate 的调用方（直接操作 menu.list）行为不变——
//    此时导航栈为空，slide-back 在根级仍触发 onClose（即关闭）。

import { installUiComponentsStyles } from "./ui-components-styles.ts";
import { installSlideMenuStyles } from "./ui-slide-menu-styles.ts";

/** 单个菜单视图：标题 + 把内容渲染进给定的 list 容器。 */
export interface SlideMenuView {
  /** 视图标题（写入标题栏；根级即菜单名） */
  title: string;
  /** 渲染该视图内容到 list（每次进入/刷新都会调用，须幂等） */
  render(list: HTMLElement): void;
}

export interface SlideMenuHandle {
  /** 卡片根（.menu-wrapper.slide-menu），挂到定位容器即可 */
  root: HTMLElement;
  /** 内容挂载点（.slide-list.render-card），legacy 直接操作时可用 */
  list: HTMLElement;
  /** 设置标题栏文字（legacy 直接操作；经导航栈时由视图 title 托管） */
  setTitle(title: string): void;
  /** 注册关闭回调（根级返回按钮点击 / 回车 / 空格触发） */
  setOnClose(fn: () => void): void;
  /** 以给定视图为根重置导航栈并渲染（用于顶部菜单进入一级） */
  home(view: SlideMenuView): void;
  /** 下钻到子视图（压栈并渲染） */
  navigate(view: SlideMenuView): void;
  /** 返回上一级；已在根级则触发关闭回调 */
  back(): void;
  /** 重渲染当前栈顶视图（内容变化后调用，如开关态更新） */
  refresh(): void;
  /** 当前栈顶是否为给定视图（异步填充场景守卫用） */
  isShowing(view: SlideMenuView): boolean;
  /** 清空导航栈（不渲染、不关闭，供调用方关闭弹窗时复位） */
  reset(): void;
  /** 当前是否处于根视图（栈深 ≤ 1） */
  isAtRoot(): boolean;
  /** 移除整个外壳 */
  dispose(): void;
}

/** 构建 slide-menu 卡片外壳（含轻量导航栈）。 */
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

  const backBtn = document.createElement("span");
  backBtn.className = "slide-back";
  backBtn.setAttribute("role", "button");
  backBtn.tabIndex = 0;
  backBtn.textContent = opts?.closeIcon ?? "✕";
  backBtn.title = "关闭";

  const title = document.createElement("span");
  title.className = "slide-title";
  title.textContent = opts?.title ?? "";

  header.appendChild(backBtn);
  header.appendChild(title);

  const panel = document.createElement("div");
  panel.className = "slide-panel";

  const list = document.createElement("div");
  list.className = "slide-list render-card";

  panel.appendChild(list);
  viewport.appendChild(header);
  viewport.appendChild(panel);
  root.appendChild(viewport);

  // ── 轻量导航栈 ──
  // 不搬 MikuMikuAR 的 registry/schema 业务层，仅保留「栈 + 返回」的纯视觉语义：
  // 根级 slide-back 显示 ✕（关闭），子集显示 ←（返回上一级）。
  const stack: SlideMenuView[] = [];

  const renderTop = (): void => {
    const top = stack[stack.length - 1];
    if (!top) return;
    list.innerHTML = "";
    title.textContent = top.title;
    const atRoot = stack.length <= 1;
    backBtn.textContent = atRoot ? opts?.closeIcon ?? "✕" : "←";
    backBtn.title = atRoot ? "关闭" : "返回";
    top.render(list);
  };

  const handleBack = (): void => {
    if (stack.length > 1) {
      stack.pop();
      renderTop();
    } else {
      fireClose();
    }
  };

  let onClose: (() => void) | undefined;
  const fireClose = (): void => onClose?.();

  backBtn.onclick = handleBack;
  backBtn.onkeydown = (e: KeyboardEvent): void => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleBack();
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
    home: (view: SlideMenuView): void => {
      stack.length = 0;
      stack.push(view);
      renderTop();
    },
    navigate: (view: SlideMenuView): void => {
      stack.push(view);
      renderTop();
    },
    back: (): void => handleBack(),
    refresh: (): void => {
      renderTop();
    },
    isShowing: (view: SlideMenuView): boolean => stack[stack.length - 1] === view,
    reset: (): void => {
      stack.length = 0;
    },
    isAtRoot: (): boolean => stack.length <= 1,
    dispose: (): void => {
      root.remove();
    },
  };
}
