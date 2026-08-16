// ===== 3D 预览底部根菜单（ADR-076 v3：底部根菜单 + SlideMenu 多层派生，按能力动态显示）=====
// 对齐 MikuMikuAR 范式：底部根按钮 → createSlideMenu 多层导航。
// 唯一事实来源：仅描述结构（id / icon / labelKey / fallback / kind / 能力门槛）。
// 渲染与 handler 见 preview-menu.ts；测试遍历本表 + 适配器真实注入项断言结构与
// dock 渲染（preview-menu-items.test.ts，对齐 MikuMikuAR 声明式菜单测试范式）。
//
// 能力驱动显示（用户 2026-08-16 决策）：
// - 有骨骼/模型工具（适配器注入 model 组项）→ 显示「🧍 模型」
// - 有动作/播放（适配器注入 motion 组项）→ 显示「💃 动作」
// - 有场景/相机/环境能力（shared 模式 + sky/ground cap）→ 显示「🌍 场景」

export type PreviewMenuItemKind = "panel" | "action" | "divider";
export type PreviewMenuGroupId = "model" | "motion" | "scene";

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
  /** 仅环境能力可用（skyCap/groundCap 任一非空）时显示 */
  requiresEnvironment?: boolean;
  /** 归属底栏分组（🧍 模型 / 💃 动作 / 🌍 场景）；无 dockGroup 的项只出现在设置聚合视图 */
  dockGroup?: PreviewMenuGroupId;
  /** 面板型保留 legacy data-testid（兼容既有 e2e 选择器，如 ysm-close-3d / env-menu-btn / mmd-switch） */
  legacyTestId?: string;
  /** panel 型：子面板填充（适配器注入的专属项必需；core 固定项走 fillers 映射） */
  render?: (list: HTMLElement, closePopup: () => void) => void;
  /** action 型：点击执行（适配器注入的专属项必需；core 固定项走 runners 映射） */
  run?: () => void;
}

/** 底栏分组定义（能力驱动：组内无任何可显示项时不渲染该组按钮） */
export interface PreviewMenuGroupDef {
  id: PreviewMenuGroupId;
  icon: string;
  fallback: string;
}

export const PREVIEW_MENU_GROUPS: PreviewMenuGroupDef[] = [
  { id: "model", icon: "🧍", fallback: "模型" },
  { id: "motion", icon: "💃", fallback: "动作" },
  { id: "scene", icon: "🌍", fallback: "场景" },
];

/**
 * core 固定菜单项（不依赖适配器注入）：
 * - switch：模型组（有 siblings 才显示）
 * - environment / camera：场景组（shared 模式才显示）
 * close 不在此表——关闭由 SlideMenu header 的 ✕ 承担（legacy ysm-close-3d 挂在关闭按钮）。
 */
export const CORE_MENU_ITEMS: PreviewMenuItemDef[] = [
  {
    id: "switch",
    icon: "🔁",
    labelKey: "preview.switchModel",
    fallback: "切换模型",
    kind: "panel",
    needsSiblings: true,
    dockGroup: "model",
    legacyTestId: "mmd-switch",
  },
  {
    id: "environment",
    icon: "🌍",
    labelKey: "preview.environment",
    fallback: "环境",
    kind: "panel",
    dockGroup: "scene",
    requiresEnvironment: true,
    legacyTestId: "env-menu-btn",
  },
  {
    id: "camera",
    icon: "🎥",
    labelKey: "preview.cameraView",
    fallback: "视图",
    kind: "panel",
    sharedOnly: true,
    dockGroup: "scene",
  },
];
