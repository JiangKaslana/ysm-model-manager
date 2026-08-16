// ===== 3D 预览声明式根菜单（ADR-076 v2：顶栏收敛为单一根菜单；对齐 menu-defs.ts ADR-021 范式）=====
// 唯一事实来源：仅描述结构（id / icon / labelKey / fallback / kind / sharedOnly / needsSiblings）。
// 渲染与 handler 见 preview-menu.ts；e2e 遍历本表断言结构与可解析性，告别飘忽 overlay DOM。
//
// 设计要点：
// - 顶栏已移除（用户 2026-08-16 决策：顶栏整体砍掉，关闭收进根菜单）。
// - 本表仅为 core 固定项；适配器专属项（模型/材质/截图/播放/骨骼/分层）在 Phase 2
//   经 PreviewAdapter 契约注入，届时本表由 core 项 + 适配器项聚合而成。

export type PreviewMenuItemKind = "panel" | "action" | "divider";

export interface PreviewMenuItemDef {
  /** 稳定 id；渲染为 data-testid="preview-<id>"，必要时保留 legacyTestId 兼容既有 e2e 选择器 */
  id: string;
  icon: string;
  /** i18n 键；缺失时回退 fallback（tr 兜底，杜绝原始键名显示） */
  labelKey: string;
  /** i18n 缺失时的回退文案 */
  fallback: string;
  kind: PreviewMenuItemKind;
  danger?: boolean;
  /** 仅 shared 模式显示（self 模式相机由适配器底部导航提供，避免双份） */
  sharedOnly?: boolean;
  /** 仅 siblings.length > 0 显示（3D 内模型切换） */
  needsSiblings?: boolean;
  /** 面板型保留 legacy data-testid（兼容既有 e2e 选择器，如 ysm-close-3d / env-menu-btn / mmd-switch） */
  legacyTestId?: string;
  /** panel 型：子面板填充（适配器注入的专属项必需；core 固定项走 fillers 映射） */
  render?: (list: HTMLElement, closePopup: () => void) => void;
  /** action 型：点击执行（适配器注入的专属项必需；core 固定项走 runners 映射） */
  run?: () => void;
}

/** 核心根菜单项（适配器专属项在 Phase 2 经契约注入） */
export const PREVIEW_MENU_DEFS: PreviewMenuItemDef[] = [
  {
    id: "close",
    icon: "✕",
    labelKey: "preview.close3d",
    fallback: "关闭",
    kind: "action",
    danger: true,
    legacyTestId: "ysm-close-3d",
  },
  {
    id: "switch",
    icon: "🔁",
    labelKey: "preview.switchModel",
    fallback: "切换模型",
    kind: "panel",
    needsSiblings: true,
    legacyTestId: "mmd-switch",
  },
  { id: "div-env", icon: "", labelKey: "", fallback: "", kind: "divider" },
  {
    id: "environment",
    icon: "🌍",
    labelKey: "preview.environment",
    fallback: "环境",
    kind: "panel",
    legacyTestId: "env-menu-btn",
  },
  {
    id: "camera",
    icon: "🎥",
    labelKey: "preview.cameraView",
    fallback: "视图",
    kind: "panel",
    sharedOnly: true,
  },
];
